/**
 * Draws the play board as pixel art into a Framebuffer.
 *
 * Tile size is chosen per level: the largest that fits the current terminal,
 * so small levels look chunky and detailed while larger ones still fit.
 */

import { deadSquaresFor } from '../core/deadlock.js';
import { Tile, type GameState, type Level } from '../core/types.js';
import { Framebuffer } from './framebuffer.js';
import { TILE_SIZES, tileSet, type Sprite, type TileSize } from './sprites.js';
import { theme } from './theme.js';

/** Rows of terminal chrome (title, HUD, controls) we must leave room for. */
export const CHROME_ROWS = 6;

/**
 * Pick the largest tile size whose rendered board fits in the given terminal.
 *
 * A tile of N pixels occupies N columns and N/2 character rows, because each
 * character cell holds two vertically-stacked pixels.
 */
export function chooseTileSize(
  level: Level,
  cols: number,
  rows: number,
): TileSize {
  const availCols = Math.max(cols - 2, 1);
  const availRows = Math.max(rows - CHROME_ROWS, 1);

  for (const size of TILE_SIZES) {
    const needCols = level.width * size;
    const needRows = Math.ceil((level.height * size) / 2);
    if (needCols <= availCols && needRows <= availRows) return size;
  }
  // Smallest we ever go. The level loader rejects levels that don't fit here,
  // so reaching this means a very small terminal rather than a bad level.
  return 4;
}

/** Does this level fit on screen at the minimum legible tile size? */
export function fitsAtMinimumTile(
  level: Level,
  cols: number,
  rows: number,
): boolean {
  const size = TILE_SIZES[TILE_SIZES.length - 1];
  return (
    level.width * size <= cols - 2 &&
    Math.ceil((level.height * size) / 2) <= rows - CHROME_ROWS
  );
}

function blit(fb: Framebuffer, sprite: Sprite, x0: number, y0: number): void {
  for (let y = 0; y < sprite.h; y++) {
    for (let x = 0; x < sprite.w; x++) {
      const rgb = sprite.px[y * sprite.w + x];
      if (rgb === null) continue; // transparent - let the floor show through
      fb.set(x0 + x, y0 + y, rgb);
    }
  }
}

export interface BoardRender {
  fb: Framebuffer;
  tile: TileSize;
  /** Width in terminal columns. */
  cols: number;
  /** Height in terminal rows. */
  rows: number;
}

/** Render the current position into a fresh framebuffer. */
export function renderBoard(
  state: GameState,
  tile: TileSize,
  opts: { showStuck?: boolean } = {},
): BoardRender {
  const { level, boxes } = state;
  const set = tileSet(tile);
  const pxW = level.width * tile;
  const pxH = level.height * tile;

  const fb = new Framebuffer(pxW, pxH, theme.floor);
  const dead = opts.showStuck ? deadSquaresFor(level) : null;

  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const cell = y * level.width + x;
      const px = x * tile;
      const py = y * tile;

      if (level.tiles[cell] === Tile.Wall) {
        blit(fb, set.wall, px, py);
        continue;
      }

      // Floor first, then goal marker, then whatever sits on top.
      blit(fb, set.floor, px, py);
      if (level.goals[cell] === 1) blit(fb, set.goal, px, py);

      if (boxes[cell] === 1) {
        if (level.goals[cell] === 1) {
          blit(fb, set.crateDone, px, py);
        } else if (dead !== null && dead[cell] === 1) {
          blit(fb, set.crateStuck, px, py);
        } else {
          blit(fb, set.crate, px, py);
        }
      } else if (state.player === cell) {
        blit(fb, set.player, px, py);
      }
    }
  }

  return { fb, tile, cols: pxW, rows: fb.charRows };
}
