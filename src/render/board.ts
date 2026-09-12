/**
 * Draws the play board as pixel art into a Framebuffer.
 *
 * Tile size is chosen per level: the largest that fits the current terminal,
 * so small levels look chunky and detailed while larger ones still fit.
 *
 * Beyond straight sprite blitting this module adds the three depth cues that
 * turn a flat grid of tiles into a room: walls get a lit cap where they meet
 * open floor, floor beneath a wall is darkened, and crates and the player cast
 * a small drop shadow. None of that needs extra art - the shadow is the sprite's
 * own silhouette, offset and drawn in one colour.
 */

import { deadSquaresFor } from '../core/deadlock.js';
import { Dir, Tile, type DirValue, type GameState, type Level } from '../core/types.js';
import { Framebuffer } from './framebuffer.js';
import { TILE_SIZES, tileSet, type Sprite, type TileSize } from './sprites.js';
import { theme } from './theme.js';

/**
 * Rows of terminal chrome (title, HUD, controls) we must leave room for.
 *
 * The play screen spaces those out with blank lines when there is room and
 * drops them when there isn't, because on a short window those two blank rows
 * are the difference between a 4-pixel tile and a 5-pixel one for a third of
 * the shipped levels.
 */
export const CHROME_ROWS = 4;
export const CHROME_ROWS_TIGHT = 3;
/** Below this many terminal rows, the play screen drops its spacer lines. */
export const TIGHT_ROWS = 30;

export function chromeRows(rows: number): number {
  return rows < TIGHT_ROWS ? CHROME_ROWS_TIGHT : CHROME_ROWS;
}

/**
 * The bottom row the frame painter never writes to.
 *
 * `paintLines` deliberately leaves the last terminal row empty, because writing
 * into the final cell of the final row scrolls the whole screen on many
 * terminals. Both budget calculations below have to account for it - they did
 * not, which meant a board could be sized to exactly fill the window and push
 * the controls line off the bottom.
 */
export const RESERVED_ROWS = 1;

/** Terminal rows a board may occupy in a window this tall. */
export function boardRowBudget(rows: number): number {
  return Math.max(rows - chromeRows(rows) - RESERVED_ROWS, 1);
}

/**
 * How the two block schemes convert pixels into terminal cells.
 *
 *   half-block  a tile of N pixels costs N columns and N/2 rows
 *   quadrant    a tile of N pixels costs N/2 columns and N/2 rows
 *
 * Both put two pixels in a cell vertically; quadrants add two horizontally.
 *
 * This lives in ONE place on purpose. chooseTileSize, fitsAtMinimumTile and
 * paintTooBig each used to carry their own copy of the half-block arithmetic,
 * which is exactly the sort of duplication that lets a board be sized against a
 * budget the painter does not honour.
 */
export type BlockScheme = 'half' | 'quad';

export function tileCellCost(
  level: Level,
  size: TileSize,
  scheme: BlockScheme,
): { cols: number; rows: number } {
  const pxW = level.width * size;
  return {
    cols: scheme === 'quad' ? Math.ceil(pxW / 2) : pxW,
    rows: Math.ceil((level.height * size) / 2),
  };
}

/**
 * Pick the largest tile size whose rendered board fits in the given terminal.
 */
export function chooseTileSize(
  level: Level,
  cols: number,
  rows: number,
  scheme: BlockScheme = 'half',
): TileSize {
  const availCols = Math.max(cols - 2, 1);
  const availRows = boardRowBudget(rows);

  for (const size of TILE_SIZES) {
    const need = tileCellCost(level, size, scheme);
    if (need.cols <= availCols && need.rows <= availRows) return size;
  }
  // Smallest we ever go. The level loader rejects levels that don't fit here,
  // so reaching this means a very small terminal rather than a bad level.
  return TILE_SIZES[TILE_SIZES.length - 1];
}

/**
 * Does this level fit on screen at the minimum legible tile size?
 *
 * This is the promise made to level authors and the gate the importer applies,
 * so it models exactly what the play screen does at that window size - same
 * chrome, same reserved row - rather than an optimistic approximation of it.
 */
export function fitsAtMinimumTile(
  level: Level,
  cols: number,
  rows: number,
  scheme: BlockScheme = 'half',
): boolean {
  const size = TILE_SIZES[TILE_SIZES.length - 1];
  const need = tileCellCost(level, size, scheme);
  return need.cols <= cols - 2 && need.rows <= boardRowBudget(rows);
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

/**
 * Draw a sprite's silhouette, offset, in a single colour.
 *
 * This is the drop shadow. Using the sprite's own shape means every object gets
 * a correct shadow for free, and a new sprite can never forget to have one.
 */
function blitShadow(
  fb: Framebuffer,
  sprite: Sprite,
  x0: number,
  y0: number,
  offset: number,
): void {
  for (let y = 0; y < sprite.h; y++) {
    for (let x = 0; x < sprite.w; x++) {
      if (sprite.px[y * sprite.w + x] === null) continue;
      fb.set(x0 + x + offset, y0 + y + offset, theme.shadow);
    }
  }
}

/** How far an object's shadow falls, in pixels. */
const shadowOffset = (tile: TileSize): number => (tile >= 16 ? 2 : 1);
/** How deep the shade cast by a wall onto the floor below it is, in pixels. */
const wallShade = (tile: TileSize): number => Math.max(1, Math.floor(tile / 8));

export interface BoardRender {
  fb: Framebuffer;
  tile: TileSize;
  /** Width in terminal columns. */
  cols: number;
  /** Height in terminal rows. */
  rows: number;
}

/**
 * Which way the player is looking.
 *
 * Derived from the undo history rather than stored on GameState: facing is a
 * presentation detail, and the core game rules have no business knowing about
 * it. Facing down is the resting pose a level opens on.
 */
export function facingOf(state: GameState): DirValue {
  return state.history.length > 0
    ? state.history[state.history.length - 1].dir
    : Dir.Down;
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
  const player = set.player[facingOf(state)];
  const drop = shadowOffset(tile);
  const shade = wallShade(tile);

  const isWall = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < level.width &&
    y < level.height &&
    level.tiles[y * level.width + x] === Tile.Wall;

  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const cell = y * level.width + x;
      const px = x * tile;
      const py = y * tile;

      if (level.tiles[cell] === Tile.Wall) {
        // A wall with open floor above it gets the lit cap, which is what makes
        // the outline of a room readable at a glance.
        blit(fb, isWall(x, y - 1) ? set.wall : set.wallTop, px, py);
        continue;
      }

      // Floor first, then the shade a wall above casts onto it, then the goal
      // marker, then whatever sits on top.
      blit(fb, set.floor, px, py);
      if (isWall(x, y - 1)) fb.rect(px, py, tile, shade, theme.shadow);
      if (level.goals[cell] === 1) blit(fb, set.goal, px, py);

      if (boxes[cell] === 1) {
        const crate =
          level.goals[cell] === 1
            ? set.crateDone
            : dead !== null && dead[cell] === 1
              ? set.crateStuck
              : set.crate;
        blitShadow(fb, crate, px, py, drop);
        blit(fb, crate, px, py);
      } else if (state.player === cell) {
        blitShadow(fb, player, px, py, drop);
        blit(fb, player, px, py);
      }
    }
  }

  return { fb, tile, cols: pxW, rows: fb.charRows };
}
