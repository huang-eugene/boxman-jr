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
import type { Caps } from '../render/caps.js';
import { BOLD, paint, RESET } from '../render/color.js';
import { renderAscii } from '../render/ascii.js';
import {
  chooseTileSize,
  chromeRows,
  fitsAtMinimumTile,
  renderBoard,
  RESERVED_ROWS,
  TIGHT_ROWS,
} from '../render/board.js';
import { TILE_SIZES } from '../render/sprites.js';
import { theme } from '../render/theme.js';
import {
  centre,
  controlsLine,
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
        this.maybeOfferSkip();
      }
      return;
    }

    if (key.name === 'restart') {
      resetState(this.state);
      this.restarts++;
      this.stuckCell = -1;
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

  private boardLines(cols: number, rows: number): string[] {
    const showStuck = this.stuckCell >= 0;

    if (this.caps.glyphs === 'ascii') {
      const lines = renderAscii(this.state, this.mode(), { showStuck });
      return lines.map((l) => centre(l, cols));
    }

    const tile = chooseTileSize(this.state.level, cols, rows);
    const { fb } = renderBoard(this.state, tile, { showStuck });
    // Centre by the pixel width, since the line is mostly escape codes.
    const pad = Math.max(0, Math.floor((cols - this.state.level.width * tile) / 2));
    return fb.renderRows(this.mode()).map((l) => ' '.repeat(pad) + l);
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
    const needCols = level.width * min + 2;
    const needRows =
      Math.ceil((level.height * min) / 2) + chromeRows(rows) + RESERVED_ROWS;

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
        paint('Esc  choose a different puzzle      Q  quit', theme.textDim, m),
        cols,
      ),
    ]);
  }

  private paintPlay(cols: number, rows: number): void {
    if (this.caps.glyphs === 'blocks' && !fitsAtMinimumTile(this.state.level, cols, rows)) {
      this.paintTooBig(cols, rows);
      return;
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

    const lines: string[] = [];
    if (roomy) lines.push('');
    lines.push(titleLine(info, this.mode(), cols));
    if (roomy) lines.push('');
    lines.push(...board);
    if (roomy) lines.push('');
    lines.push(statusLine(info, this.mode(), cols));
    lines.push(
      this.stuckCell >= 0
        ? stuckLine(this.mode(), cols)
        : controlsLine(this.mode(), cols),
    );

    this.paintLines(lines);
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
    lines.push(centre(paint('Esc  choose a puzzle      Q  quit', theme.textDim, m), cols));

    // The puzzles are not ours, and their licence asks that they stay credited.
    for (const credit of this.credits()) {
      lines.push('');
      lines.push(centre(paint(credit, theme.textDim, m), cols));
    }

    // Tile size is driven by how many ROWS the window has, so a player on a
    // default 80x24 terminal gets the coarsest art and no idea that a taller
    // window would give them the detailed version.
    if (this.caps.glyphs === 'blocks' && chooseTileSize(ref.level, cols, rows) < 8) {
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

  private paintWon(cols: number, rows: number): void {
    const m = this.mode();
    const stars = this.starsFor();

    const lines: string[] = ['', ''];
    lines.push(centre(BOLD + paint('WELL DONE!', theme.good, m) + RESET, cols));
    lines.push('');
    lines.push(centre(paint(stars, theme.accent, m), cols));
    lines.push('');
    const moves = this.state.moves;
    lines.push(
      centre(
        paint(
          `${this.refs[this.index].level.title} solved in ${moves} ` +
            `${moves === 1 ? 'move' : 'moves'}`,
          theme.text,
          m,
        ),
        cols,
      ),
    );
    if (this.lastWinWasBest) {
      lines.push('');
      lines.push(centre(paint('A new personal best!', theme.accent, m), cols));
    }
    lines.push('');
    lines.push('');
    const more = this.index + 1 < this.refs.length;
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

    this.paintLines(lines);
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
      centre(`${k('Arrow keys')} or ${k('W A S D')}   move`, cols),
      centre(`${k('U')} or ${k('Backspace')}        undo (as much as you like!)`, cols),
      centre(`${k('R')}                     start this puzzle again`, cols),
      centre(`${k('Esc')}                   choose a different puzzle`, cols),
      centre(`${k('Q')}                     quit`, cols),
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
