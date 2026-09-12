/**
 * Text chrome drawn around the board: title, progress, and the control hints.
 *
 * The controls are always on screen. An 8-year-old does not read a manual, and
 * should never have to remember that undo exists - especially since undo is
 * what makes the game safe to experiment in.
 */

import type { ColorMode } from '../render/caps.js';
import { BOLD, paint, RESET } from '../render/color.js';
import { theme } from '../render/theme.js';

export function centre(text: string, width: number): string {
  // Measure the visible text, not the escape sequences.
  const visible = text.replace(/\x1b\[[0-9;]*m/g, '').length;
  if (visible >= width) return text;
  const pad = Math.floor((width - visible) / 2);
  return ' '.repeat(pad) + text;
}

export interface HudInfo {
  packName: string;
  levelTitle: string;
  levelNumber: number;
  levelTotal: number;
  moves: number;
  done: number;
  goals: number;
  best?: number;
}

/** The line above the board. */
export function titleLine(info: HudInfo, mode: ColorMode, width: number): string {
  const n = paint(
    `Puzzle ${info.levelNumber} of ${info.levelTotal}`,
    theme.textDim,
    mode,
  );
  const t =
    mode === 'ascii'
      ? info.levelTitle
      : BOLD + paint(info.levelTitle, theme.accent, mode);
  return centre(`${t}  ${n}`, width);
}

/** The status line below the board. */
export function statusLine(info: HudInfo, mode: ColorMode, width: number): string {
  const crates = paint(
    `Crates: ${info.done}/${info.goals}`,
    info.done === info.goals ? theme.good : theme.text,
    mode,
  );
  const moves = paint(`Moves: ${info.moves}`, theme.textDim, mode);
  const best =
    info.best !== undefined
      ? '  ' + paint(`Best: ${info.best}`, theme.textDim, mode)
      : '';
  return centre(`${crates}   ${moves}${best}`, width);
}

/** Always-visible controls. */
export function controlsLine(mode: ColorMode, width: number): string {
  const key = (k: string): string => paint(k, theme.accent, mode);
  const parts = [
    `${key('Arrows')} move`,
    `${key('U')} undo`,
    `${key('R')} restart`,
    `${key('Esc')} menu`,
  ];

  // The quit hint is a footnote, not a control: dimmed, and the first thing to
  // go when the window is too narrow to hold the line that actually matters.
  const quit = paint('Ctrl+C quit', theme.textDim, mode);
  const full = parts.join('   ') + '   ' + quit;
  const visible = (t: string): number =>
    t.replace(/\x1b\[[0-9;]*m/g, '').length;

  return centre(visible(full) <= width ? full : parts.join('   '), width);
}

/** A gentle nudge when a crate has been pushed somewhere unrecoverable. */
export function stuckLine(mode: ColorMode, width: number): string {
  const msg =
    'That crate is stuck in a corner! Press ' +
    paint('U', theme.accent, mode) +
    ' to undo.';
  return centre(paint('', theme.bad, mode) + msg + RESET, width);
}

/**
 * Stamp a banner over a frame's lines, replacing whole rows.
 *
 * Deliberately replaces rows outright rather than splicing text into them.
 * Board lines are almost entirely SGR escapes, and slicing one at a visible
 * column would cut an escape sequence in half and leave the terminal in a
 * colour state nobody chose. Losing a few rows of pixels behind the banner is
 * what "printed over the level" means anyway.
 *
 * `at` is the first row to overwrite; rows outside the frame are ignored.
 */
export function overlayBanner(
  lines: string[],
  banner: string[],
  at: number,
): string[] {
  const out = [...lines];
  for (let i = 0; i < banner.length; i++) {
    const row = at + i;
    if (row < 0 || row >= out.length) continue;
    // Re-open with a reset so no colour from the frame we covered leaks in.
    out[row] = RESET + banner[i];
  }
  return out;
}

/** Row to start a banner of `height` rows on, centred within `total` rows. */
export function bannerRow(total: number, height: number): number {
  return Math.max(0, Math.floor((total - height) / 2));
}

/**
 * Word-wrap text to a width, never splitting a word.
 *
 * A word longer than the width is allowed to overhang rather than being
 * chopped: a broken word is harder for a new reader than a slightly wide line.
 */
export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = '';

  for (const w of words) {
    if (line === '') line = w;
    else if (line.length + 1 + w.length <= width) line += ' ' + w;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** How many lines a bubble may grow to before anything is trimmed. */
export const MAX_BUBBLE_LINES = 4;

/**
 * Lines a bubble needs for `text` at a given outer width. Lets the caller
 * choose a width that fits rather than discovering the trim afterwards.
 */
export function bubbleHeight(text: string, width: number): number {
  return Math.min(
    MAX_BUBBLE_LINES,
    wrap(text, Math.max(8, width - 4)).length,
  );
}

/**
 * A rounded speech bubble with a tail, for the coach.
 *
 * Capped at two lines of text on purpose: that is a young reader's budget for
 * something they did not ask to read, and it also bounds how much room the
 * coach can steal from the board.
 */
export function speechBubble(
  text: string,
  width: number,
  mode: ColorMode,
  maxLines = MAX_BUBBLE_LINES,
): string[] {
  const inner = Math.max(8, width - 4);
  let body = wrap(text, inner);

  // Truncating is a last resort, not a layout strategy. The coach writes in
  // whole sentences and half of them need three lines at a sensible bubble
  // width; cutting them mid-word made the stuck warning - the one line that
  // tells a child how to recover - unreadable. Callers size the bubble to fit
  // instead, and this only bites when the window genuinely cannot hold it.
  if (body.length > maxLines) {
    const kept = body.slice(0, maxLines);
    const last = kept.length - 1;
    kept[last] = kept[last].slice(0, Math.max(0, inner - 1)) + '…';
    body = kept;
  }

  const w = Math.max(...body.map((l) => l.length));
  const dim = (s: string): string => paint(s, theme.textDim, mode);

  const out = [dim('╭' + '─'.repeat(w + 2) + '╮')];
  for (const l of body) {
    out.push(dim('│ ') + paint(l.padEnd(w), theme.text, mode) + dim(' │'));
  }
  out.push(dim('╰─' + '┬' + '─'.repeat(Math.max(0, w)) + '╯'));
  out.push(dim('  ▼'));
  return out;
}

/**
 * Lay out key/description pairs as an aligned block, centred as a whole.
 *
 * Centring each row on its own lines the descriptions up only by accident of
 * length - rename one key and the column bends. Measuring visible width (the
 * keys carry colour escapes) and padding to a shared gutter keeps it straight.
 */
export function keyTable(
  rows: ReadonlyArray<readonly [key: string, desc: string]>,
  width: number,
): string[] {
  const visible = (t: string): number =>
    t.replace(/\x1b\[[0-9;]*m/g, '').length;

  const gutter = Math.max(...rows.map(([key]) => visible(key)));
  const built = rows.map(
    ([key, desc]) => key + ' '.repeat(gutter - visible(key) + 3) + desc,
  );

  const blockW = Math.max(...built.map(visible));
  const pad = ' '.repeat(Math.max(0, Math.floor((width - blockW) / 2)));
  return built.map((l) => pad + l);
}
