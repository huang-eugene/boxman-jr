/**
 * Plain-ASCII renderer.
 *
 * This is a genuinely separate implementation, not the pixel renderer with
 * colour stripped out. It is the guaranteed-to-work fallback for terminals
 * that cannot draw half-blocks, so it is built early and exercised constantly
 * rather than being a theoretical branch nobody runs.
 */

import { Tile, type GameState } from '../core/types.js';
import { deadSquaresFor } from '../core/deadlock.js';
import type { ColorMode } from './caps.js';
import { paint } from './color.js';
import { theme } from './theme.js';

/** Render the board as an array of text lines (no trailing newline). */
export function renderAscii(
  state: GameState,
  mode: ColorMode,
  opts: { showStuck?: boolean } = {},
): string[] {
  const { level, boxes } = state;
  const dead = opts.showStuck ? deadSquaresFor(level) : null;
  const lines: string[] = [];

  for (let y = 0; y < level.height; y++) {
    let line = '';
    for (let x = 0; x < level.width; x++) {
      const cell = y * level.width + x;
      const isGoal = level.goals[cell] === 1;
      const hasBox = boxes[cell] === 1;
      const isPlayer = state.player === cell;

      if (level.tiles[cell] === Tile.Wall) {
        line += paint('#', theme.wallLight, mode);
      } else if (hasBox && isGoal) {
        line += paint('*', theme.crateDoneMid, mode);
      } else if (hasBox) {
        const stuck = dead !== null && dead[cell] === 1;
        line += paint('$', stuck ? theme.stuck : theme.crateMid, mode);
      } else if (isPlayer && isGoal) {
        line += paint('+', theme.shirt, mode);
      } else if (isPlayer) {
        line += paint('@', theme.shirt, mode);
      } else if (isGoal) {
        line += paint('.', theme.goal, mode);
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }

  return lines;
}

/** Width in terminal columns of an ASCII-rendered board. */
export function asciiWidth(state: GameState): number {
  return state.level.width;
}

/** Height in terminal rows of an ASCII-rendered board. */
export function asciiHeight(state: GameState): number {
  return state.level.height;
}
