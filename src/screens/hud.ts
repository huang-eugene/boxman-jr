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
  return centre(parts.join('   '), width);
}

/** A gentle nudge when a crate has been pushed somewhere unrecoverable. */
export function stuckLine(mode: ColorMode, width: number): string {
  const msg =
    'That crate is stuck in a corner! Press ' +
    paint('U', theme.accent, mode) +
    ' to undo.';
  return centre(paint('', theme.bad, mode) + msg + RESET, width);
}
