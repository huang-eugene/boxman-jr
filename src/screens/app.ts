/**
 * The game application: screen state machine, input loop, and frame painting.
 *
 * Rendering is turn-based - we repaint on input and on resize, never on a
 * timer. Combined with the alternate screen buffer and a cursor-home repaint
 * (rather than a clear-then-draw), that gives a flicker-free display cheaply.
 */

import {
  boxesOnGoals,
  createState,
  goalCount,
  isSolved,
  resetState,
  step,
  undo,
} from '../core/game.js';
import { findStuckBox } from '../core/deadlock.js';
import {
  coachLine,
  HOLD_MOVES,
  MANY_UNDOS,
  outranks,
  STALL_MOVES,
  type CoachEvent,
  type CoachLine,
} from '../core/coach.js';
import {
  recordPosition,
  recordSkip,
  recordWin,
  solvedCount,
  type Progress,
} from '../core/progress.js';
import type { DirValue, GameState } from '../core/types.js';
import { saveProgress } from '../io/store.js';
import type { LevelRef, Pack } from '../io/packs.js';
import { readKeys, type Key } from '../io/keys.js';
import { ansi, onResize, out, restore, terminalSize } from '../io/term.js';
import { isPixelMode, schemeFor, type Caps } from '../render/caps.js';
import { BOLD, paint, RESET } from '../render/color.js';
import { renderAscii } from '../render/ascii.js';
import { Framebuffer } from '../render/framebuffer.js';
import {
  chooseTileSize,
  chromeRows,
  fitsAtMinimumTile,
  renderBoard,
  RESERVED_ROWS,
  TIGHT_ROWS,
  tileCellCost,
} from '../render/board.js';
import { coachArt, TILE_SIZES } from '../render/sprites.js';
import { theme } from '../render/theme.js';
import {
  bannerRow,
  centre,
  keyTable,
  controlsLine,
  overlayBanner,
  speechBubble,
  statusLine,
  stuckLine,
  titleLine,
} from './hud.js';

type Screen = 'title' | 'play' | 'won' | 'select' | 'help' | 'skipOffer';

/** Minimum terminal we can draw anything sensible in. */
const MIN_COLS = 34;
const MIN_ROWS = 12;

export interface AppOptions {
  refs: LevelRef[];
  packs: Pack[];
  progress: Progress;
  caps: Caps;
  startAt: number;
  recoveredFrom?: string;
  /** --no-coach, or a remembered preference. */
  coach?: boolean;
}

export class App {
  private readonly refs: LevelRef[];
  private readonly packs: Pack[];
  private readonly progress: Progress;
  private readonly caps: Caps;

  private screen: Screen = 'title';
  private index: number;
  private state: GameState;
  private stuckCell = -1;

  /** Struggle tracking, for the gentle skip offer. */
  private restarts = 0;
  private undos = 0;
  private skipOffered = false;

  private selectCursor = 0;
  private lastWinWasBest = false;

  /** Coach state: what is on screen, why, and when it may be replaced. */
  private readonly coachEnabled: boolean;
  private coachSaid: CoachLine | null = null;
  private coachEvent: CoachEvent | null = null;
  private coachSinceMove = 0;
  private coachRotation = 0;
  /** Crates home as of the previous move, to spot one landing or leaving. */
  private lastDone = 0;
  /** Move count when a crate last landed home, for the stall check. */
  private lastProgressMove = 0;
  private stopKeys: (() => void) | null = null;
  private stopResize: (() => void) | null = null;
  private done = false;

  constructor(opts: AppOptions) {
    this.refs = opts.refs;
    this.packs = opts.packs;
    this.progress = opts.progress;
    this.caps = opts.caps;
    this.index = opts.startAt;
    this.state = createState(this.refs[this.index].level);
    this.selectCursor = this.index;
    this.coachEnabled = opts.coach ?? true;
    this.lastDone = boxesOnGoals(this.state);
    this.say('levelStart');
  }

  run(): void {
    this.stopKeys = readKeys((k) => this.onKey(k));
    this.stopResize = onResize(() => this.paint());
    this.paint();
  }

  private quit(): void {
    if (this.done) return;
    this.done = true;
    this.stopKeys?.();
    this.stopResize?.();
    this.save();
    restore();
    process.exit(0);
  }

  /**
   * Persist position. Deliberately does NOT write settings.glyphMode: the caps
   * we are running with may have come from a one-off `--ascii`, a piped stdout
   * or NO_COLOR, and writing those back turned a temporary fallback into a
   * permanent one that only --reset-progress could clear. Only an explicit
   * answer to the calibration prompt is worth remembering, and main.ts saves
   * that itself.
   */
  private save(): void {
    const ref = this.refs[this.index];
    recordPosition(this.progress, ref.pack.manifest.id, ref.level.id);
    saveProgress(this.progress);
  }

  /* ------------------------------------------------------------- input --- */

  private onKey(key: Key): void {
    if (key.name === 'quit') {
      this.quit();
      return;
    }

    switch (this.screen) {
      case 'title':
        this.onTitleKey(key);
        break;
      case 'play':
        this.onPlayKey(key);
        break;
      case 'won':
        this.onWonKey(key);
        break;
      case 'select':
        this.onSelectKey(key);
        break;
      case 'help':
        if (key.name !== 'char') this.screen = 'play';
        break;
      case 'skipOffer':
        this.onSkipKey(key);
        break;
    }

    this.paint();
  }

  private onTitleKey(key: Key): void {
    if (key.name === 'escape') {
      this.selectCursor = this.index;
      this.screen = 'select';
      return;
    }
    this.screen = 'play';
  }

  private onPlayKey(key: Key): void {
    const dirs: Partial<Record<Key['name'], DirValue>> = {
      up: 0,
      down: 1,
      left: 2,
      right: 3,
    };

    if (key.name === 'escape') {
      this.selectCursor = this.index;
      this.screen = 'select';
      return;
    }

    if (key.name === 'help') {
      this.screen = 'help';
      return;
    }

    if (key.name === 'undo') {
      if (undo(this.state)) {
        this.undos++;
        this.refreshStuck();
        this.observeMove();
        this.maybeOfferSkip();
      }
      return;
    }

    if (key.name === 'restart') {
      resetState(this.state);
      this.restarts++;
      this.stuckCell = -1;
      this.lastDone = boxesOnGoals(this.state);
      this.lastProgressMove = 0;
      this.say('restart');
      this.maybeOfferSkip();
      return;
    }

    const dir = dirs[key.name];
    if (dir === undefined) return;

    const result = step(this.state, dir);
    if (!result.moved) return;

    if (isSolved(this.state)) {
      this.onWin();
      return;
    }

    if (result.pushed) this.refreshStuck();
    this.observeMove();
  }

  private onWonKey(key: Key): void {
    if (key.name === 'escape') {
      this.selectCursor = this.index;
      this.screen = 'select';
      return;
    }
    this.advance();
  }

  private onSelectKey(key: Key): void {
    switch (key.name) {
      case 'up':
        this.selectCursor = Math.max(0, this.selectCursor - 1);
        break;
      case 'down':
        this.selectCursor = Math.min(this.refs.length - 1, this.selectCursor + 1);
        break;
      case 'left':
        this.selectCursor = Math.max(0, this.selectCursor - 10);
        break;
      case 'right':
        this.selectCursor = Math.min(
          this.refs.length - 1,
          this.selectCursor + 10,
        );
        break;
      case 'enter':
      case 'space':
        this.goTo(this.selectCursor);
        this.screen = 'play';
        break;
      case 'escape':
        this.screen = 'play';
        break;
      default:
        break;
    }
  }

  private onSkipKey(key: Key): void {
    if (key.name === 'yes') {
      const ref = this.refs[this.index];
      recordSkip(this.progress, ref.pack.manifest.id, ref.level.id);
      this.save();
      this.advance();
      return;
    }
    // Anything else means "no, I want to keep trying".
    this.screen = 'play';
  }

  /* -------------------------------------------------------------- flow --- */

  /* ------------------------------------------------------------- coach --- */

  /**
   * Offer the coach an event. It may decline - a line already on screen holds
   * for HOLD_MOVES unless something more urgent arrives, so a child reading
   * slowly is never interrupted mid-sentence.
   */
  private say(event: CoachEvent): void {
    if (!this.coachEnabled) return;

    const held = this.state.moves - this.coachSinceMove < HOLD_MOVES;
    if (this.coachSaid !== null && this.coachEvent !== null) {
      if (held && !outranks(event, this.coachEvent)) return;
      // Never repeat the same prompt back to back.
      if (event === this.coachEvent) this.coachRotation++;
    }

    this.coachSaid = coachLine({
      event,
      done: boxesOnGoals(this.state),
      goals: goalCount(this.state.level),
      rotation: this.coachRotation,
    });
    this.coachEvent = event;
    this.coachSinceMove = this.state.moves;
  }

  /**
   * Watch a completed move for anything worth remarking on.
   *
   * Silence is the default: during fluent play - crates going home, no trouble -
   * this returns without saying anything at all.
   */
  private observeMove(): void {
    if (!this.coachEnabled) return;

    const done = boxesOnGoals(this.state);

    // A warning that has been acted on must go: leaving "that crate is stuck"
    // up after the undo that fixed it tells the child the game did not notice.
    if (this.stuckCell < 0 && this.coachEvent === 'stuck') {
      this.coachSaid = null;
      this.coachEvent = null;
    }

    if (this.stuckCell >= 0) {
      this.say('stuck');
    } else if (done > this.lastDone) {
      this.lastProgressMove = this.state.moves;
      // The last crate landing home is the win, which speaks for itself.
      if (done < goalCount(this.state.level)) this.say('crateOnGoal');
    } else if (done < this.lastDone) {
      this.say('crateOffGoal');
    } else if (this.undos >= MANY_UNDOS && this.undos % MANY_UNDOS === 0) {
      this.say('manyUndos');
    } else if (this.state.moves - this.lastProgressMove >= STALL_MOVES) {
      this.lastProgressMove = this.state.moves;
      this.say('stalled');
    }

    this.lastDone = done;
  }

  private hasCoach(): boolean {
    return this.coachEnabled && this.coachSaid !== null;
  }

  /** The coach's bubble and sprite, as terminal rows. */
  private coachLines(width: number, big: boolean): string[] {
    if (!this.coachEnabled || this.coachSaid === null) return [];

    const bubble = speechBubble(this.coachSaid.text, width, this.mode());
    if (this.caps.glyphs === 'ascii') return bubble;

    const art = big ? coachArt.large : coachArt.small;
    const fb = new Framebuffer(art.w, art.h, theme.floor);
    for (let y = 0; y < art.h; y++) {
      for (let x = 0; x < art.w; x++) {
        const rgb = art.px[y * art.w + x];
        if (rgb !== null) fb.set(x, y, rgb);
      }
    }
    const quad = schemeFor(this.caps.glyphs) === 'quad';
    const sprite = quad
      ? fb.renderQuadRows(this.mode())
      : fb.renderRows(this.mode());

    return [...bubble, ...sprite.map((l) => '  ' + l)];
  }

  private refreshStuck(): void {
    this.stuckCell = findStuckBox(this.state);
  }

  /**
   * Offer to move on after real struggle - never as a penalty, never as a
   * modal that interrupts play mid-thought. The level stays replayable.
   */
  private maybeOfferSkip(): void {
    if (this.skipOffered) return;
    if (this.restarts >= 3 || this.undos >= 40) {
      this.skipOffered = true;
      this.screen = 'skipOffer';
    }
  }

  private onWin(): void {
    const ref = this.refs[this.index];
    this.lastWinWasBest = recordWin(
      this.progress,
      ref.pack.manifest.id,
      ref.level.id,
      this.state.moves,
      this.state.pushes,
    );
    this.save();
    this.say('solved');
    this.screen = 'won';
  }

  private advance(): void {
    if (this.index + 1 < this.refs.length) {
      this.goTo(this.index + 1);
      this.screen = 'play';
    } else {
      this.selectCursor = this.index;
      this.screen = 'select';
    }
  }

  private goTo(index: number): void {
    this.index = index;
    this.state = createState(this.refs[index].level);
    this.stuckCell = -1;
    this.restarts = 0;
    this.undos = 0;
    this.skipOffered = false;
    this.coachSaid = null;
    this.coachEvent = null;
    this.coachSinceMove = 0;
    this.lastDone = boxesOnGoals(this.state);
    this.lastProgressMove = 0;
    this.say('levelStart');
    this.save();
  }

  /* ------------------------------------------------------------- paint --- */

  private paint(): void {
    const { cols, rows } = terminalSize();

    if (cols < MIN_COLS || rows < MIN_ROWS) {
      this.paintLines([
        '',
        centre('Please make this window a bit bigger!', cols),
        '',
        centre(`(it needs about ${MIN_COLS} x ${MIN_ROWS})`, cols),
      ]);
      return;
    }

    switch (this.screen) {
      case 'title':
        this.paintTitle(cols, rows);
        break;
      case 'play':
        this.paintPlay(cols, rows);
        break;
      case 'won':
        this.paintWon(cols, rows);
        break;
      case 'select':
        this.paintSelect(cols, rows);
        break;
      case 'help':
        this.paintHelp(cols, rows);
        break;
      case 'skipOffer':
        this.paintSkipOffer(cols, rows);
        break;
    }
  }

  /**
   * Write a full frame. We move the cursor home and overwrite, clearing each
   * line as we go, rather than clearing the whole screen first - clear-then-draw
   * is what produces visible flicker.
   */
  private paintLines(lines: string[]): void {
    const { rows } = terminalSize();
    let buf = ansi.cursorHome;
    for (let i = 0; i < rows - 1; i++) {
      buf += (lines[i] ?? '') + ansi.clearLine;
      if (i < rows - 2) buf += '\n';
    }
    out(buf);
  }

  private mode = (): Caps['color'] => this.caps.color;

  private boardLines(
    cols: number,
    rows: number,
  ): { lines: string[]; width: number } {
    const showStuck = this.stuckCell >= 0;

    if (this.caps.glyphs === 'ascii') {
      const lines = renderAscii(this.state, this.mode(), { showStuck });
      const width = Math.max(...lines.map((l) => l.length));
      return { lines, width };
    }

    const scheme = schemeFor(this.caps.glyphs);
    const tile = chooseTileSize(this.state.level, cols, rows, scheme);
    const { fb } = renderBoard(this.state, tile, { showStuck });
    const quad = scheme === 'quad';

    // The rendered CELL width, not the pixel width: under quadrants a cell is
    // two pixels wide, and measuring in pixels would double-count.
    const width = quad ? fb.quadCols : fb.width;
    const painted = quad
      ? fb.renderQuadRows(this.mode())
      : fb.renderRows(this.mode());
    return { lines: painted, width };
  }

  /**
   * Put the coach beside the board when there is room, otherwise under it.
   *
   * Beside is strongly preferred: rows are what bind the tile size, so stacking
   * the coach vertically would cost pixel resolution directly. The quadrant
   * renderer halves the board's width, and this is what that width is for.
   */
  private composeBoard(
    board: { lines: string[]; width: number },
    cols: number,
  ): { lines: string[]; coachBeside: boolean } {
    const GAP = 2;
    const bubbleW = Math.min(30, Math.max(18, cols - board.width - GAP - 2));
    const coach =
      board.width + GAP + bubbleW <= cols
        ? this.coachLines(bubbleW, board.width >= 40)
        : [];

    if (coach.length === 0) {
      // No room beside: centre the board alone and let the caller put a single
      // coach line under the status row instead.
      const pad = Math.max(0, Math.floor((cols - board.width) / 2));
      return {
        lines: board.lines.map((l) => ' '.repeat(pad) + l),
        coachBeside: false,
      };
    }

    const blockW = board.width + GAP + bubbleW;
    const pad = ' '.repeat(Math.max(0, Math.floor((cols - blockW) / 2)));
    const height = Math.max(board.lines.length, coach.length);
    // Sit the coach block against the middle of the board rather than its top,
    // so a short bubble does not float at the ceiling of a tall puzzle.
    const coachTop = Math.max(
      0,
      Math.round((board.lines.length - coach.length) / 2),
    );

    const out: string[] = [];
    for (let i = 0; i < height; i++) {
      const left = board.lines[i];
      const c = coach[i - coachTop];
      if (left === undefined && c === undefined) continue;
      let row = pad + (left ?? '');
      if (c !== undefined) {
        // Pad to the board's width in VISIBLE columns - the board line is
        // mostly escapes, so its .length is not its width.
        const used = left === undefined ? 0 : board.width;
        row += ' '.repeat(Math.max(0, board.width - used) + GAP) + c;
      }
      out.push(row);
    }
    return { lines: out, coachBeside: true };
  }

  /**
   * Ask for a slightly bigger window, for a puzzle that cannot fit this one.
   *
   * Every shipped level fits 100x28, but a few of the tallest do not fit a
   * default 80x24 terminal even at the smallest tile. Painting them anyway
   * silently crops the bottom of the board and the controls line - a child
   * pushing crates towards a goal they cannot see. Saying so is kinder, and
   * Esc still works, so they are never stuck on this screen.
   */
  private paintTooBig(cols: number, rows: number): void {
    const m = this.mode();
    const level = this.state.level;
    const min = TILE_SIZES[TILE_SIZES.length - 1];
    const need = tileCellCost(level, min, schemeFor(this.caps.glyphs));
    const needCols = need.cols + 2;
    const needRows = need.rows + chromeRows(rows) + RESERVED_ROWS;

    this.paintLines([
      '',
      '',
      centre(paint('This puzzle needs a little more room!', theme.accent, m), cols),
      '',
      centre(`"${level.title}" needs a window about ${needCols} x ${needRows}.`, cols),
      '',
      centre(`This one is ${cols} x ${rows} - try dragging it a bit bigger.`, cols),
      '',
      '',
      centre(
        paint(
          'Esc  choose a different puzzle      Q or Ctrl+C  quit',
          theme.textDim,
          m,
        ),
        cols,
      ),
    ]);
  }

  private paintPlay(cols: number, rows: number): void {
    const lines = this.playLines(cols, rows);
    if (lines === null) {
      this.paintTooBig(cols, rows);
      return;
    }
    this.paintLines(lines);
  }

  /**
   * Build the play frame. Returns null when the level cannot fit, so callers
   * can fall back to paintTooBig rather than overlaying onto a board that was
   * never drawn.
   */
  private playLines(cols: number, rows: number): string[] | null {
    if (
      this.caps.glyphs !== 'ascii' &&
      !fitsAtMinimumTile(this.state.level, cols, rows, schemeFor(this.caps.glyphs))
    ) {
      return null;
    }

    const ref = this.refs[this.index];
    const record =
      this.progress.packs[ref.pack.manifest.id]?.levels[ref.level.id];

    const info = {
      packName: ref.pack.manifest.name,
      levelTitle: ref.level.title,
      levelNumber: this.index + 1,
      levelTotal: this.refs.length,
      moves: this.state.moves,
      done: boxesOnGoals(this.state),
      goals: goalCount(this.state.level),
      best: record?.bestMoves,
    };

    // On a short window the spacer rows are worth more as board: dropping them
    // buys a whole tile size on a third of the shipped levels. chromeRows() is
    // what chooseTileSize budgets against, so the two must agree.
    const roomy = rows >= TIGHT_ROWS;
    const board = this.boardLines(cols, rows);
    const composed = this.composeBoard(board, cols);
    // The coach needs its own row only when it could not fit beside the board.
    const coachInline = this.hasCoach() && !composed.coachBeside;

    // These spacer rows are exactly what chromeRows() budgets for, so the two
    // must stay in step: CHROME_ROWS counts title + status + controls + one
    // spacer, CHROME_ROWS_TIGHT drops the spacer.
    const lines: string[] = [];
    lines.push(titleLine(info, this.mode(), cols));
    if (roomy) lines.push('');
    lines.push(...composed.lines);
    if (roomy) lines.push('');
    lines.push(statusLine(info, this.mode(), cols));

    // The coach absorbs the stuck warning: both want the same row and say the
    // same thing, and two systems competing for one line is how you get a
    // flicker between them.
    if (coachInline && this.coachSaid !== null) {
      lines.push(centre(paint(this.coachSaid.text, theme.textDim, this.mode()), cols));
    } else {
      lines.push(
        this.stuckCell >= 0
          ? stuckLine(this.mode(), cols)
          : controlsLine(this.mode(), cols),
      );
    }

    return lines;
  }

  private paintTitle(cols: number, rows: number): void {
    const m = this.mode();
    const art = [
      '  ___  _____  _  _ __  __  ___  _  _ ',
      ' | _ )/ _ \\ \\/ /| \\/ |/ _ \\| \\| |',
      ' | _ \\ (_) >  < | |\\/| | (_) | .` |',
      ' |___/\\___/_/\\_\\|_|  |_|\\___/|_|\\_|',
    ];

    const solved = this.packs.reduce(
      (n, p) => n + solvedCount(this.progress, p.manifest.id),
      0,
    );

    const lines: string[] = [''];
    lines.push(centre(paint('B O X M A N   J R', theme.accent, m), cols));
    lines.push('');
    lines.push(centre(paint('A crate-pushing puzzle game', theme.textDim, m), cols));
    lines.push('');
    lines.push('');
    lines.push(
      centre(
        paint(`You have solved ${solved} of ${this.refs.length} puzzles`, theme.good, m),
        cols,
      ),
    );
    lines.push('');
    const ref = this.refs[this.index];
    // Name the puzzle NUMBER, not just its title. Without it, "you have solved
    // 3" followed by a board the player doesn't recognise looks like the game
    // lost their progress.
    lines.push(
      centre(
        paint(
          `Up next: Puzzle ${this.index + 1} - ${ref.level.title}`,
          theme.text,
          m,
        ),
        cols,
      ),
    );
    lines.push('');
    lines.push('');
    lines.push(centre(paint('Press any key to play', theme.accent, m), cols));
    lines.push('');
    lines.push(
      centre(
        paint('Esc  choose a puzzle      Q or Ctrl+C  quit', theme.textDim, m),
        cols,
      ),
    );

    // The puzzles are not ours, and their licence asks that they stay credited.
    for (const credit of this.credits()) {
      lines.push('');
      lines.push(centre(paint(credit, theme.textDim, m), cols));
    }

    // Tile size is driven by how many ROWS the window has, so a player on a
    // default 80x24 terminal gets the coarsest art and no idea that a taller
    // window would give them the detailed version.
    if (
      isPixelMode(this.caps.glyphs) &&
      chooseTileSize(ref.level, cols, rows, schemeFor(this.caps.glyphs)) < 8
    ) {
      lines.push('');
      lines.push(
        centre(
          paint('Tip: a bigger window means bigger pictures!', theme.textDim, m),
          cols,
        ),
      );
    }

    if (this.caps.glyphs === 'ascii') {
      lines.push('');
      lines.push(
        centre(
          paint(
            'Plain-text mode. For pixel art, run with --pixel-art',
            theme.textDim,
            m,
          ),
          cols,
        ),
      );
    }

    this.paintLines(lines);
  }

  /**
   * The congratulation, printed OVER the finished board.
   *
   * The board stays on screen because the picture the child just solved is the
   * reward - every crate drawn with `crateDone` - and replacing it with a card
   * threw that away at the exact moment it mattered. Any key still advances.
   *
   * Falls back to a full-screen card when the level does not fit the window,
   * since there is no board underneath to overlay onto.
   */
  private paintWon(cols: number, rows: number): void {
    const banner = this.winBanner(cols);
    const frame = this.playLines(cols, rows);

    if (frame === null) {
      this.paintLines(this.winCard(cols));
      return;
    }

    this.paintLines(overlayBanner(frame, banner, bannerRow(frame.length, banner.length)));
  }

  /** The congratulation lines, shared by the overlay and the fallback card. */
  private winBanner(cols: number): string[] {
    const m = this.mode();
    const moves = this.state.moves;
    const more = this.index + 1 < this.refs.length;

    const lines = [
      centre(BOLD + paint('WELL DONE!', theme.good, m) + RESET, cols),
      centre(paint(this.starsFor(), theme.accent, m), cols),
      centre(
        paint(
          `Solved in ${moves} ${moves === 1 ? 'move' : 'moves'}`,
          theme.text,
          m,
        ),
        cols,
      ),
    ];

    if (this.lastWinWasBest) {
      lines.push(centre(paint('A new personal best!', theme.accent, m), cols));
    }

    lines.push(
      centre(
        paint(
          more ? 'Press any key for the next puzzle' : 'You finished them all!',
          theme.accent,
          m,
        ),
        cols,
      ),
    );

    return lines;
  }

  /** Full-screen win card, for when the board could not be drawn. */
  private winCard(cols: number): string[] {
    return ['', '', ...this.winBanner(cols)];
  }

  /**
   * Stars are a reward, never a judgement: the floor is one star, so finishing
   * a puzzle always feels like a win regardless of how long it took.
   *
   * Graded against the level's par - the optimal push count the solver measured
   * when the pack was built - rather than a guess from the goal count. The old
   * guess assumed six moves per crate, which on these puzzles means a child who
   * solves a twenty-push level perfectly is told they earned one star.
   */
  private starsFor(): string {
    const par = this.state.level.optimalPushes;

    if (par !== undefined && par > 0) {
      if (this.state.pushes <= Math.ceil(par * 1.3)) return '* * *';
      if (this.state.pushes <= par * 2) return '* *';
      return '*';
    }

    // No par recorded: a pack loaded with --levels. Fall back to the old guess.
    const optimalish = goalCount(this.state.level) * 6;
    const moves = this.state.moves;
    if (moves <= optimalish) return '* * *';
    if (moves <= optimalish * 2) return '* *';
    return '*';
  }

  /** Distinct puzzle attributions across the loaded packs, in pack order. */
  private credits(): string[] {
    const seen: string[] = [];
    for (const pack of this.packs) {
      const credit = pack.manifest.attribution;
      if (credit && !seen.includes(credit)) seen.push(credit);
    }
    return seen;
  }

  private paintSelect(cols: number, rows: number): void {
    const m = this.mode();
    const lines: string[] = [''];
    lines.push(centre(BOLD + paint('CHOOSE A PUZZLE', theme.accent, m) + RESET, cols));
    lines.push('');

    const listRows = Math.max(4, rows - 8);
    const half = Math.floor(listRows / 2);
    let start = Math.max(0, this.selectCursor - half);
    start = Math.min(start, Math.max(0, this.refs.length - listRows));

    for (let i = start; i < Math.min(this.refs.length, start + listRows); i++) {
      const ref = this.refs[i];
      const rec = this.progress.packs[ref.pack.manifest.id]?.levels[ref.level.id];
      const mark = rec?.solved ? '[x]' : rec?.skipped ? '[-]' : '[ ]';
      const label = `${mark} ${String(i + 1).padStart(3)}. ${ref.level.title}`;
      const colour = rec?.solved ? theme.good : theme.text;

      if (i === this.selectCursor) {
        lines.push(centre(BOLD + paint(`> ${label}`, theme.accent, m) + RESET, cols));
      } else {
        lines.push(centre(paint(`  ${label}`, colour, m), cols));
      }
    }

    lines.push('');
    lines.push(
      centre(
        paint('Up/Down  move    Enter  play    Esc  back', theme.textDim, m),
        cols,
      ),
    );

    this.paintLines(lines);
  }

  private paintHelp(cols: number, rows: number): void {
    const m = this.mode();
    const k = (s: string): string => paint(s, theme.accent, m);
    const lines = [
      '',
      centre(BOLD + paint('HOW TO PLAY', theme.accent, m) + RESET, cols),
      '',
      centre('Push every crate onto a marked spot.', cols),
      '',
      // Centre the BLOCK, not each line: centring them one by one lines the
      // text up only by luck, and any change to a key name breaks the column.
      ...keyTable(
        [
          [`${k('Arrow keys')} or ${k('W A S D')}`, 'move'],
          [`${k('U')} or ${k('Backspace')}`, 'undo (as much as you like!)'],
          [k('R'), 'start this puzzle again'],
          [k('Esc'), 'choose a different puzzle'],
          [`${k('Q')} or ${k('Ctrl+C')}`, 'quit'],
        ],
        cols,
      ),
      '',
      centre(paint('You can never lose. Undo as much as you need.', theme.good, m), cols),
      '',
      ...this.credits().map((c) => centre(paint(c, theme.textDim, m), cols)),
      '',
      centre(paint('Press any key to go back', theme.textDim, m), cols),
    ];
    this.paintLines(lines);
  }

  private paintSkipOffer(cols: number, rows: number): void {
    const m = this.mode();
    const lines = [
      '',
      '',
      centre(paint('This one is tricky!', theme.accent, m), cols),
      '',
      centre('Would you like to try a different puzzle?', cols),
      '',
      centre(paint('You can always come back to this one later.', theme.textDim, m), cols),
      '',
      '',
      centre(`${paint('Y', theme.accent, m)}  yes, try another    ${paint('N', theme.accent, m)}  no, keep trying`, cols),
    ];
    this.paintLines(lines);
  }
}
