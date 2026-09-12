/**
 * Pixel-art sprites.
 *
 * Sprites are authored as arrays of strings so they can be read and edited as
 * pictures rather than as data. Each character is a palette key; '.' means
 * transparent, so sprites composite over the floor beneath them.
 *
 * Every tile exists at nine sizes. The renderer picks the largest that fits the
 * terminal, so a small level in a roomy window gets genuinely detailed art and
 * a big level in a small window degrades gracefully instead of being cropped.
 *
 * Why the ladder goes so high: a tile of N pixels costs N terminal columns and
 * N/2 rows, and ROWS are what bind. A nine-row level at 8px needs 36 rows of
 * board, which is why the old four-step ladder topped out at 8 and almost never
 * got to use it. Going to 24 costs nothing in a small window - `chooseTileSize`
 * simply never picks it - and doubles the detail in a maximised one.
 *
 * Three rules hold the art together at every size:
 *
 *   1. Everything that sits on the floor - crate, player, goal - is drawn
 *      inside a near-black outline. This is the single biggest thing that makes
 *      a 5x5 tile legible.
 *   2. Walls come in two variants. `wallTop` has a lit cap and is used wherever
 *      the square above is floor, which is what makes the shape of a room
 *      visible rather than an undifferentiated field of texture.
 *   3. The player faces the way they last moved, at sizes where a face fits.
 */

import type { RGB } from './color.js';
import type { DirValue } from '../core/types.js';
import { theme } from './theme.js';

export type TileSize = 4 | 5 | 6 | 8 | 10 | 12 | 16 | 20 | 24 | 32;

/**
 * Largest first - `chooseTileSize` returns the first entry that fits, and
 * `fitsAtMinimumTile` uses the last as the floor. Both depend on this order.
 */
export const TILE_SIZES: readonly TileSize[] = [
  32, 24, 20, 16, 12, 10, 8, 6, 5, 4,
];

/** Palette keys shared by every sprite. */
const PALETTE: Record<string, RGB | null> = {
  '.': null, // transparent
  T: theme.wallTop,
  L: theme.wallLight,
  D: theme.wallDark,
  M: theme.wallMortar,
  E: theme.wallEdge,
  F: theme.floor,
  o: theme.floorDot,
  S: theme.shadow,
  O: theme.outline,
  C: theme.crateHighlight,
  c: theme.crateLight,
  m: theme.crateMid,
  k: theme.crateDark,
  A: theme.crateBand,
  H: theme.crateDoneHighlight,
  g: theme.crateDoneLight,
  n: theme.crateDoneMid,
  j: theme.crateDoneDark,
  i: theme.crateDoneBand,
  G: theme.goal,
  W: theme.goalGlow,
  h: theme.goalDim,
  s: theme.skin,
  p: theme.skinShadow,
  b: theme.shirt,
  l: theme.shirtLight,
  B: theme.shirtDark,
  r: theme.hair,
  R: theme.hairLight,
  e: theme.eye,
  u: theme.mouth,
  x: theme.stuck,
};

export interface Sprite {
  readonly w: number;
  readonly h: number;
  /** Row-major; null means transparent. */
  readonly px: ReadonlyArray<RGB | null>;
}

/**
 * Build a square sprite, checking it really is the size it claims.
 *
 * The size argument is not redundant. Sprites are hand-counted ASCII, and a row
 * one character short used to be silently padded with transparent pixels - a
 * mis-drawn sprite that looked almost right and was invisible in review. Now it
 * fails at import time, before anything renders.
 */
function spr(size: number, rows: string[]): Sprite {
  if (rows.length !== size) {
    throw new Error(`Sprite claims ${size}x${size} but has ${rows.length} rows`);
  }
  const px: (RGB | null)[] = [];
  for (let y = 0; y < size; y++) {
    const row = rows[y];
    if (row.length !== size) {
      throw new Error(
        `Sprite row ${y} is ${row.length} wide, expected ${size}: ${JSON.stringify(row)}`,
      );
    }
    for (const key of row) {
      if (!(key in PALETTE)) {
        throw new Error(`Sprite uses unknown palette key ${JSON.stringify(key)}`);
      }
      px.push(PALETTE[key]);
    }
  }
  return { w: size, h: size, px };
}

/** Mirror a sprite left-to-right. Used to face the player right from `left`. */
function mirror(s: Sprite): Sprite {
  const px: (RGB | null)[] = [];
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) px.push(s.px[y * s.w + (s.w - 1 - x)]);
  }
  return { w: s.w, h: s.h, px };
}

/**
 * Double a sprite by pixel replication.
 *
 * The 20px and 24px tiles are 10px and 12px art doubled rather than drawn
 * again. At that size the art already carries the detail the eye can use, and
 * chunky pixels read as a deliberate style rather than as a shortcut - whereas
 * two more hand-drawn sizes would be two more sets of sprites to keep in step.
 */
function scale2(s: Sprite): Sprite {
  const w = s.w * 2;
  const px: (RGB | null)[] = new Array(w * s.h * 2);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const v = s.px[y * s.w + x];
      px[y * 2 * w + x * 2] = v;
      px[y * 2 * w + x * 2 + 1] = v;
      px[(y * 2 + 1) * w + x * 2] = v;
      px[(y * 2 + 1) * w + x * 2 + 1] = v;
    }
  }
  return { w, h: s.h * 2, px };
}

/* ---------------------------------------------------------------- 4x4 ---- */

const WALL_4 = spr(4, [
  'LLLL',
  'LLML',
  'MMMM',
  'LMLL',
]);

const WALL_TOP_4 = spr(4, [
  'TTTT',
  'LLML',
  'MMMM',
  'LMLL',
]);

const FLOOR_4 = spr(4, [
  'oFFF',
  'FFFF',
  'FFFF',
  'FFFo',
]);

const GOAL_4 = spr(4, [
  '.GG.',
  'GWWG',
  'GWWG',
  '.GG.',
]);

const CRATE_4 = spr(4, [
  'OOOO',
  'OCCO',
  'OmmO',
  'OOOO',
]);

const CRATE_DONE_4 = spr(4, [
  'OOOO',
  'OHHO',
  'OnnO',
  'OOOO',
]);

const CRATE_STUCK_4 = spr(4, [
  'xxxx',
  'xCCx',
  'xmmx',
  'xxxx',
]);

const PLAYER_4 = spr(4, [
  '.rr.',
  'OssO',
  'ObbO',
  '.BB.',
]);

/* ---------------------------------------------------------------- 5x5 ---- */

const WALL_5 = spr(5, [
  'LLLML',
  'LLLML',
  'MMMMM',
  'LMLLL',
  'LMLLL',
]);

const WALL_TOP_5 = spr(5, [
  'TTTTT',
  'LLLML',
  'MMMMM',
  'LMLLL',
  'LMLLL',
]);

const FLOOR_5 = spr(5, [
  'oFFFF',
  'FFFFF',
  'FFFFF',
  'FFFFF',
  'FFFFo',
]);

const GOAL_5 = spr(5, [
  '.GGG.',
  'G...G',
  'G.W.G',
  'G...G',
  '.GGG.',
]);

const CRATE_5 = spr(5, [
  'OOOOO',
  'OCCCO',
  'OmmmO',
  'OkkkO',
  'OOOOO',
]);

const CRATE_DONE_5 = spr(5, [
  'OOOOO',
  'OHHHO',
  'OnnnO',
  'OjjjO',
  'OOOOO',
]);

const CRATE_STUCK_5 = spr(5, [
  'xxxxx',
  'xCCCx',
  'xmmmx',
  'xkkkx',
  'xxxxx',
]);

const PLAYER_5 = spr(5, [
  '.rrr.',
  'OsssO',
  'OeseO',
  'ObbbO',
  '.B.B.',
]);

/* ---------------------------------------------------------------- 6x6 ---- */

const WALL_6 = spr(6, [
  'LLLLML',
  'LLLLML',
  'MMMMMM',
  'LMLLLL',
  'LMLLLL',
  'MMMMMM',
]);

const WALL_TOP_6 = spr(6, [
  'TTTTTT',
  'LLLLML',
  'MMMMMM',
  'LMLLLL',
  'LMLLLL',
  'MMMMMM',
]);

const FLOOR_6 = spr(6, [
  'oFFFFF',
  'FFFFFF',
  'FFFFFF',
  'FFFFFF',
  'FFFFFF',
  'FFFFFo',
]);

const GOAL_6 = spr(6, [
  '..GG..',
  '.G..G.',
  'G.WW.G',
  'G.WW.G',
  '.G..G.',
  '..GG..',
]);

const CRATE_6 = spr(6, [
  'OOOOOO',
  'OCCCCO',
  'OcAAcO',
  'OcmmcO',
  'OkkkkO',
  'OOOOOO',
]);

const CRATE_DONE_6 = spr(6, [
  'OOOOOO',
  'OHHHHO',
  'OgiigO',
  'OgnngO',
  'OjjjjO',
  'OOOOOO',
]);

const CRATE_STUCK_6 = spr(6, [
  'xxxxxx',
  'xCCCCx',
  'xcxxcx',
  'xcmmcx',
  'xkkkkx',
  'xxxxxx',
]);

const PLAYER_DOWN_6 = spr(6, [
  '.OOOO.',
  'ORRRRO',
  'OesseO',
  'OsuusO',
  'ObbbbO',
  '.B..B.',
]);

const PLAYER_UP_6 = spr(6, [
  '.OOOO.',
  'ORRRRO',
  'OrrrrO',
  'OrrrrO',
  'ObbbbO',
  '.B..B.',
]);

const PLAYER_LEFT_6 = spr(6, [
  '.OOOO.',
  'ORRRRO',
  'OessrO',
  'OussrO',
  'ObbbbO',
  '.B..B.',
]);

/* ---------------------------------------------------------------- 8x8 ---- */

const WALL_8 = spr(8, [
  'LLLLLMLL',
  'LLLLLMLL',
  'MMMMMMMM',
  'LMLLLLLM',
  'LMLLLLLM',
  'MMMMMMMM',
  'LLLLLMLL',
  'LLLLLMLL',
]);

const WALL_TOP_8 = spr(8, [
  'TTTTTTTT',
  'LLLLLMLL',
  'MMMMMMMM',
  'LMLLLLLM',
  'LMLLLLLM',
  'MMMMMMMM',
  'LLLLLMLL',
  'LLLLLMLL',
]);

const FLOOR_8 = spr(8, [
  'oFFFFFFF',
  'FFFFFFFF',
  'FFFFFFFF',
  'FFFFoFFF',
  'FFFFFFFF',
  'FFFFFFFF',
  'FFFFFFFF',
  'FFFFFFFo',
]);

const GOAL_8 = spr(8, [
  '..GGGG..',
  '.G....G.',
  'G..WW..G',
  'G.WWWW.G',
  'G.WWWW.G',
  'G..WW..G',
  '.G....G.',
  '..GGGG..',
]);

const CRATE_8 = spr(8, [
  'OOOOOOOO',
  'OCCCCCCO',
  'OcAAAAcO',
  'OcmmmmcO',
  'OcmmmmcO',
  'OcAAAAcO',
  'OkkkkkkO',
  'OOOOOOOO',
]);

const CRATE_DONE_8 = spr(8, [
  'OOOOOOOO',
  'OHHHHHHO',
  'OgiiiigO',
  'OgnnnngO',
  'OgnnnngO',
  'OgiiiigO',
  'OjjjjjjO',
  'OOOOOOOO',
]);

const CRATE_STUCK_8 = spr(8, [
  'xxxxxxxx',
  'xCCCCCCx',
  'xcxxxxcx',
  'xcmmmmcx',
  'xcmmmmcx',
  'xcxxxxcx',
  'xkkkkkkx',
  'xxxxxxxx',
]);

const PLAYER_DOWN_8 = spr(8, [
  '..OOOO..',
  '.ORRRRO.',
  '.OssssO.',
  '.OesseO.',
  '.ObbbbO.',
  'ObllllbO',
  '.OBBBBO.',
  '..B..B..',
]);

const PLAYER_UP_8 = spr(8, [
  '..OOOO..',
  '.ORRRRO.',
  '.OrrrrO.',
  '.OrrrrO.',
  '.ObbbbO.',
  'ObllllbO',
  '.OBBBBO.',
  '..B..B..',
]);

const PLAYER_LEFT_8 = spr(8, [
  '..OOOO..',
  '.ORRRRO.',
  '.OssrrO.',
  '.OesrrO.',
  '.ObbbbO.',
  'OblllbbO',
  '.OBBBBO.',
  '..B..B..',
]);

/* -------------------------------------------------------------- 10x10 ---- */

const WALL_10 = spr(10, [
  'LLLLLLMLLL',
  'LLLLLLMLLL',
  'LLLLLLMLLL',
  'MMMMMMMMMM',
  'LLMLLLLLLM',
  'LLMLLLLLLM',
  'LLMLLLLLLM',
  'MMMMMMMMMM',
  'LLLLLLMLLL',
  'LLLLLLMLLL',
]);

const WALL_TOP_10 = spr(10, [
  'TTTTTTTTTT',
  'LLLLLLMLLL',
  'LLLLLLMLLL',
  'MMMMMMMMMM',
  'LLMLLLLLLM',
  'LLMLLLLLLM',
  'LLMLLLLLLM',
  'MMMMMMMMMM',
  'LLLLLLMLLL',
  'LLLLLLMLLL',
]);

const FLOOR_10 = spr(10, [
  'oFFFFFFFFF',
  'FFFFFFFFFF',
  'FFFFFFFFFF',
  'FFFFFFFFFF',
  'FFFFFoFFFF',
  'FFFFFFFFFF',
  'FFFFFFFFFF',
  'FFFFFFFFFF',
  'FFFFFFFFFF',
  'FFFFFFFFFo',
]);

const GOAL_10 = spr(10, [
  '...GGGG...',
  '..G....G..',
  '.G......G.',
  'G...WW...G',
  'G..WWWW..G',
  'G..WWWW..G',
  'G...WW...G',
  '.G......G.',
  '..G....G..',
  '...GGGG...',
]);

const CRATE_10 = spr(10, [
  'OOOOOOOOOO',
  'OCCCCCCCCO',
  'OcccccccmO',
  'OcAAAAAAmO',
  'OcmmmmmmmO',
  'OcmmmmmmmO',
  'OcAAAAAAmO',
  'OcmmmmmmmO',
  'OkkkkkkkkO',
  'OOOOOOOOOO',
]);

const CRATE_DONE_10 = spr(10, [
  'OOOOOOOOOO',
  'OHHHHHHHHO',
  'OgggggggnO',
  'OgiiiiiinO',
  'OgnnnnnnnO',
  'OgnnnnnnnO',
  'OgiiiiiinO',
  'OgnnnnnnnO',
  'OjjjjjjjjO',
  'OOOOOOOOOO',
]);

const CRATE_STUCK_10 = spr(10, [
  'xxxxxxxxxx',
  'xCCCCCCCCx',
  'xcccccccmx',
  'xcxxxxxxmx',
  'xcmmmmmmmx',
  'xcmmmmmmmx',
  'xcxxxxxxmx',
  'xcmmmmmmmx',
  'xkkkkkkkkx',
  'xxxxxxxxxx',
]);

const PLAYER_DOWN_10 = spr(10, [
  '...OOOO...',
  '..ORRRRO..',
  '.ORRRRRRO.',
  '.OssssssO.',
  '.OsessesO.',
  '.OssuussO.',
  '.ObbbbbbO.',
  'ObbllllbbO',
  '.OBBBBBBO.',
  '..BB..BB..',
]);

const PLAYER_UP_10 = spr(10, [
  '...OOOO...',
  '..ORRRRO..',
  '.ORRRRRRO.',
  '.OrrrrrrO.',
  '.OrrrrrrO.',
  '.OrrrrrrO.',
  '.ObbbbbbO.',
  'ObbllllbbO',
  '.OBBBBBBO.',
  '..BB..BB..',
]);

const PLAYER_LEFT_10 = spr(10, [
  '...OOOO...',
  '..ORRRRO..',
  '.ORRRRRRO.',
  '.OssssrrO.',
  '.OesssrrO.',
  '.OusssrrO.',
  '.ObbbbbbO.',
  'OblllbbbbO',
  '.OBBBBBBO.',
  '..BB..BB..',
]);

/* -------------------------------------------------------------- 12x12 ---- */

const WALL_12 = spr(12, [
  'LLLLLLLMLLLL',
  'LLLLLLLMLLLL',
  'LLLLLLLMLLLL',
  'MMMMMMMMMMMM',
  'LLMLLLLLLLLL',
  'LLMLLLLLLLLL',
  'LLMLLLLLLLLL',
  'MMMMMMMMMMMM',
  'LLLLLLLMLLLL',
  'LLLLLLLMLLLL',
  'LLLLLLLMLLLL',
  'MMMMMMMMMMMM',
]);

const WALL_TOP_12 = spr(12, [
  'TTTTTTTTTTTT',
  'LLLLLLLMLLLL',
  'LLLLLLLMLLLL',
  'MMMMMMMMMMMM',
  'LLMLLLLLLLLL',
  'LLMLLLLLLLLL',
  'LLMLLLLLLLLL',
  'MMMMMMMMMMMM',
  'LLLLLLLMLLLL',
  'LLLLLLLMLLLL',
  'LLLLLLLMLLLL',
  'MMMMMMMMMMMM',
]);

const FLOOR_12 = spr(12, [
  'oFFFFFFFFFFF',
  'FFFFFFFFFFFF',
  'FFFFFFFFFFFF',
  'FFFFFFFFFFFF',
  'FFFFFoFFFFFF',
  'FFFFFFFFFFFF',
  'FFFFFFFFFFFF',
  'FFFFFFFFFFFF',
  'FFFFFFFFoFFF',
  'FFFFFFFFFFFF',
  'FFFFFFFFFFFF',
  'FFFFFFFFFFFo',
]);

const GOAL_12 = spr(12, [
  '....GGGG....',
  '..GGGGGGGG..',
  '.GGG....GGG.',
  '.GG......GG.',
  'GG...WW...GG',
  'GG..WWWW..GG',
  'GG..WWWW..GG',
  'GG...WW...GG',
  '.GG......GG.',
  '.GGG....GGG.',
  '..GGGGGGGG..',
  '....GGGG....',
]);

const CRATE_12 = spr(12, [
  'OOOOOOOOOOOO',
  'OCCCCCCCCCCO',
  'OccccccccccO',
  'OcAAAAAAAAmO',
  'OcAAAAAAAAmO',
  'OcmmmmmmmmmO',
  'OcmmmmmmmmmO',
  'OcAAAAAAAAmO',
  'OcAAAAAAAAmO',
  'OcmmmmmmmmmO',
  'OkkkkkkkkkkO',
  'OOOOOOOOOOOO',
]);

const CRATE_DONE_12 = spr(12, [
  'OOOOOOOOOOOO',
  'OHHHHHHHHHHO',
  'OggggggggggO',
  'OgiiiiiiiinO',
  'OgiiiiiiiinO',
  'OgnnnnnnnnnO',
  'OgnnnnnnnnnO',
  'OgiiiiiiiinO',
  'OgiiiiiiiinO',
  'OgnnnnnnnnnO',
  'OjjjjjjjjjjO',
  'OOOOOOOOOOOO',
]);

const CRATE_STUCK_12 = spr(12, [
  'xxxxxxxxxxxx',
  'xCCCCCCCCCCx',
  'xccccccccccx',
  'xcxxxxxxxxmx',
  'xcxxxxxxxxmx',
  'xcmmmmmmmmmx',
  'xcmmmmmmmmmx',
  'xcxxxxxxxxmx',
  'xcxxxxxxxxmx',
  'xcmmmmmmmmmx',
  'xkkkkkkkkkkx',
  'xxxxxxxxxxxx',
]);

const PLAYER_DOWN_12 = spr(12, [
  '....OOOO....',
  '..OORRRROO..',
  '.ORRRRRRRRO.',
  '.ORRRRRRRRO.',
  '.OssssssssO.',
  '.OsessssesO.',
  '.OssssssssO.',
  '.OsssuusssO.',
  '.ObbbbbbbbO.',
  'ObbllllllbbO',
  '.OBBBBBBBBO.',
  '..BBB..BBB..',
]);

const PLAYER_UP_12 = spr(12, [
  '....OOOO....',
  '..OORRRROO..',
  '.ORRRRRRRRO.',
  '.ORRRRRRRRO.',
  '.OrrrrrrrrO.',
  '.OrrrrrrrrO.',
  '.OrrrrrrrrO.',
  '.OrrrrrrrrO.',
  '.ObbbbbbbbO.',
  'ObbllllllbbO',
  '.OBBBBBBBBO.',
  '..BBB..BBB..',
]);

const PLAYER_LEFT_12 = spr(12, [
  '....OOOO....',
  '..OORRRROO..',
  '.ORRRRRRRRO.',
  '.ORRRRRRRRO.',
  '.OssssssrrO.',
  '.OsessssrrO.',
  '.OssssssrrO.',
  '.OusssssrrO.',
  '.ObbbbbbbbO.',
  'OblllllbbbbO',
  '.OBBBBBBBBO.',
  '..BBB..BBB..',
]);

/* -------------------------------------------------------------- 16x16 ---- */

const WALL_16 = spr(16, [
  'LLLLLLLLLMLLLLLL',
  'LLLLLLLLLMLLLLLL',
  'LLLLLLLLLMLLLLLL',
  'MMMMMMMMMMMMMMMM',
  'LLLMLLLLLLLLLLLL',
  'LLLMLLLLLLLLLLLL',
  'LLLMLLLLLLLLLLLL',
  'MMMMMMMMMMMMMMMM',
  'LLLLLLLLLMLLLLLL',
  'LLLLLLLLLMLLLLLL',
  'LLLLLLLLLMLLLLLL',
  'MMMMMMMMMMMMMMMM',
  'LLLMLLLLLLLLLLLL',
  'LLLMLLLLLLLLLLLL',
  'LLLMLLLLLLLLLLLL',
  'MMMMMMMMMMMMMMMM',
]);

const WALL_TOP_16 = spr(16, [
  'TTTTTTTTTTTTTTTT',
  'TTTTTTTTTTTTTTTT',
  'LLLLLLLLLMLLLLLL',
  'MMMMMMMMMMMMMMMM',
  'LLLMLLLLLLLLLLLL',
  'LLLMLLLLLLLLLLLL',
  'LLLMLLLLLLLLLLLL',
  'MMMMMMMMMMMMMMMM',
  'LLLLLLLLLMLLLLLL',
  'LLLLLLLLLMLLLLLL',
  'LLLLLLLLLMLLLLLL',
  'MMMMMMMMMMMMMMMM',
  'LLLMLLLLLLLLLLLL',
  'LLLMLLLLLLLLLLLL',
  'LLLMLLLLLLLLLLLL',
  'MMMMMMMMMMMMMMMM',
]);

const FLOOR_16 = spr(16, [
  'oFFFFFFFFFFFFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFFFoFFFFFFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFFFFFFFFoFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFoFFFFFFFFFFF',
  'FFFFFFFFFFFFFFFF',
  'FFFFFFFFFFFFFFFo',
]);

const GOAL_16 = spr(16, [
  '.....GGGGGG.....',
  '...GGGGGGGGGG...',
  '..GGGG....GGGG..',
  '.GGG........GGG.',
  '.GG..........GG.',
  'GGG..........GGG',
  'GG.....WW.....GG',
  'GG....WWWW....GG',
  'GG....WWWW....GG',
  'GG.....WW.....GG',
  'GGG..........GGG',
  '.GG..........GG.',
  '.GGG........GGG.',
  '..GGGG....GGGG..',
  '...GGGGGGGGGG...',
  '.....GGGGGG.....',
]);

const CRATE_16 = spr(16, [
  'OOOOOOOOOOOOOOOO',
  'OCCCCCCCCCCCCCCO',
  'OccccccccccccccO',
  'OcAAAAAAAAAAAAmO',
  'OcAAAAAAAAAAAAmO',
  'OcmmmmmmmmmmmmmO',
  'OcmmmmmmmmmmmmmO',
  'OcmmmmmmmmmmmmmO',
  'OcmmmmmmmmmmmmmO',
  'OcAAAAAAAAAAAAmO',
  'OcAAAAAAAAAAAAmO',
  'OcmmmmmmmmmmmmmO',
  'OcmmmmmmmmmmmmmO',
  'OkkkkkkkkkkkkkkO',
  'OkkkkkkkkkkkkkkO',
  'OOOOOOOOOOOOOOOO',
]);

const CRATE_DONE_16 = spr(16, [
  'OOOOOOOOOOOOOOOO',
  'OHHHHHHHHHHHHHHO',
  'OggggggggggggggO',
  'OgiiiiiiiiiiiinO',
  'OgiiiiiiiiiiiinO',
  'OgnnnnnnnnnnnnnO',
  'OgnnnnnnnnnnnnnO',
  'OgnnnnnnnnnnnnnO',
  'OgnnnnnnnnnnnnnO',
  'OgiiiiiiiiiiiinO',
  'OgiiiiiiiiiiiinO',
  'OgnnnnnnnnnnnnnO',
  'OgnnnnnnnnnnnnnO',
  'OjjjjjjjjjjjjjjO',
  'OjjjjjjjjjjjjjjO',
  'OOOOOOOOOOOOOOOO',
]);

const CRATE_STUCK_16 = spr(16, [
  'xxxxxxxxxxxxxxxx',
  'xCCCCCCCCCCCCCCx',
  'xccccccccccccccx',
  'xcxxxxxxxxxxxxmx',
  'xcxxxxxxxxxxxxmx',
  'xcmmmmmmmmmmmmmx',
  'xcmmmmmmmmmmmmmx',
  'xcmmmmmmmmmmmmmx',
  'xcmmmmmmmmmmmmmx',
  'xcxxxxxxxxxxxxmx',
  'xcxxxxxxxxxxxxmx',
  'xcmmmmmmmmmmmmmx',
  'xcmmmmmmmmmmmmmx',
  'xkkkkkkkkkkkkkkx',
  'xkkkkkkkkkkkkkkx',
  'xxxxxxxxxxxxxxxx',
]);

const PLAYER_DOWN_16 = spr(16, [
  '.....OOOOOO.....',
  '...OOORRRROOO...',
  '..ORRRRRRRRRRO..',
  '.ORRRRRRRRRRRRO.',
  '.ORRRRRRRRRRRRO.',
  '.OssssssssssssO.',
  '.OsseesssseessO.',
  '.OsseesssseessO.',
  '.OssssssssssssO.',
  '.OssssuuuussssO.',
  '.ObbbbbbbbbbbbO.',
  'ObbllllllllllbbO',
  'ObbllllllllllbbO',
  '.OBBBBBBBBBBBBO.',
  '.OBBBB....BBBBO.',
  '..BBBB....BBBB..',
]);

const PLAYER_UP_16 = spr(16, [
  '.....OOOOOO.....',
  '...OOORRRROOO...',
  '..ORRRRRRRRRRO..',
  '.ORRRRRRRRRRRRO.',
  '.ORRRRRRRRRRRRO.',
  '.OrrrrrrrrrrrrO.',
  '.OrrrrrrrrrrrrO.',
  '.OrrrrrrrrrrrrO.',
  '.OrrrrrrrrrrrrO.',
  '.OrrrrrrrrrrrrO.',
  '.ObbbbbbbbbbbbO.',
  'ObbllllllllllbbO',
  'ObbllllllllllbbO',
  '.OBBBBBBBBBBBBO.',
  '.OBBBB....BBBBO.',
  '..BBBB....BBBB..',
]);

const PLAYER_LEFT_16 = spr(16, [
  '.....OOOOOO.....',
  '...OOORRRROOO...',
  '..ORRRRRRRRRRO..',
  '.ORRRRRRRRRRRRO.',
  '.ORRRRRRRRRRRRO.',
  '.OssssssssrrrrO.',
  '.OsseessssrrrrO.',
  '.OsseessssrrrrO.',
  '.OssssssssrrrrO.',
  '.OsuuussssrrrrO.',
  '.ObbbbbbbbbbbbO.',
  'ObbllllllllbbbbO',
  'ObbllllllllbbbbO',
  '.OBBBBBBBBBBBBO.',
  '.OBBBB....BBBBO.',
  '..BBBB....BBBB..',
]);

/* ---------------------------------------------------------------- coach --- */

/**
 * The coach. Two sizes only - this is chrome beside the board, not a tile on
 * it, so the nine-rung ladder would be a lot of art for no gain.
 *
 * Drawn as a friendly face with the same outline rule as everything else, so
 * it reads as belonging to the same world as the player and the crates.
 */
const COACH_8 = spr(8, [
  '..OOOO..',
  '.ORRRRO.',
  '.OssssO.',
  '.OesseO.',
  '.OsuusO.',
  '.ObbbbO.',
  'OblllbbO',
  '.OBBBBO.',
]);

const COACH_12 = spr(12, [
  '....OOOO....',
  '..OORRRROO..',
  '.ORRRRRRRRO.',
  '.OssssssssO.',
  '.OsessssesO.',
  '.OssssssssO.',
  '.OsssuusssO.',
  '.ObbbbbbbbO.',
  'ObbllllllbbO',
  'ObbllllllbbO',
  '.OBBBBBBBBO.',
  '..BBB..BBB..',
]);

export interface CoachArt {
  readonly small: Sprite;
  readonly large: Sprite;
}

export const coachArt: CoachArt = { small: COACH_8, large: COACH_12 };

/* ----------------------------------------------------------------- sets --- */

export interface TileSet {
  readonly size: TileSize;
  readonly wall: Sprite;
  /** Wall with a lit cap, drawn wherever the square above it is floor. */
  readonly wallTop: Sprite;
  readonly floor: Sprite;
  readonly goal: Sprite;
  readonly crate: Sprite;
  readonly crateDone: Sprite;
  readonly crateStuck: Sprite;
  /** Indexed by DirValue: 0 up, 1 down, 2 left, 3 right. */
  readonly player: readonly [Sprite, Sprite, Sprite, Sprite];
}

/** Four facings from three sprites - right is left, mirrored. */
function facings(
  up: Sprite,
  down: Sprite,
  left: Sprite,
): readonly [Sprite, Sprite, Sprite, Sprite] {
  return [up, down, left, mirror(left)];
}

/** One sprite used for every facing, where a face is too small to turn. */
function noFacing(s: Sprite): readonly [Sprite, Sprite, Sprite, Sprite] {
  return [s, s, s, s];
}

const SET_10: TileSet = {
  size: 10,
  wall: WALL_10,
  wallTop: WALL_TOP_10,
  floor: FLOOR_10,
  goal: GOAL_10,
  crate: CRATE_10,
  crateDone: CRATE_DONE_10,
  crateStuck: CRATE_STUCK_10,
  player: facings(PLAYER_UP_10, PLAYER_DOWN_10, PLAYER_LEFT_10),
};

const SET_12: TileSet = {
  size: 12,
  wall: WALL_12,
  wallTop: WALL_TOP_12,
  floor: FLOOR_12,
  goal: GOAL_12,
  crate: CRATE_12,
  crateDone: CRATE_DONE_12,
  crateStuck: CRATE_STUCK_12,
  player: facings(PLAYER_UP_12, PLAYER_DOWN_12, PLAYER_LEFT_12),
};

/** Double every sprite in a set, for the two largest tiles. */
function doubled(set: TileSet, size: TileSize): TileSet {
  return {
    size,
    wall: scale2(set.wall),
    wallTop: scale2(set.wallTop),
    floor: scale2(set.floor),
    goal: scale2(set.goal),
    crate: scale2(set.crate),
    crateDone: scale2(set.crateDone),
    crateStuck: scale2(set.crateStuck),
    player: [
      scale2(set.player[0]),
      scale2(set.player[1]),
      scale2(set.player[2]),
      scale2(set.player[3]),
    ],
  };
}

const SET_16: TileSet = {
  size: 16,
  wall: WALL_16,
  wallTop: WALL_TOP_16,
  floor: FLOOR_16,
  goal: GOAL_16,
  crate: CRATE_16,
  crateDone: CRATE_DONE_16,
  crateStuck: CRATE_STUCK_16,
  player: facings(PLAYER_UP_16, PLAYER_DOWN_16, PLAYER_LEFT_16),
};

const SETS: Record<TileSize, TileSet> = {
  // The two largest exist for quadrant rendering, where a given cell budget
  // affords twice the pixels. Doubled rather than hand-drawn, like 24 and 20.
  32: doubled(SET_16, 32),
  24: doubled(SET_12, 24),
  20: doubled(SET_10, 20),
  16: SET_16,
  12: SET_12,
  10: SET_10,
  8: {
    size: 8,
    wall: WALL_8,
    wallTop: WALL_TOP_8,
    floor: FLOOR_8,
    goal: GOAL_8,
    crate: CRATE_8,
    crateDone: CRATE_DONE_8,
    crateStuck: CRATE_STUCK_8,
    player: facings(PLAYER_UP_8, PLAYER_DOWN_8, PLAYER_LEFT_8),
  },
  6: {
    size: 6,
    wall: WALL_6,
    wallTop: WALL_TOP_6,
    floor: FLOOR_6,
    goal: GOAL_6,
    crate: CRATE_6,
    crateDone: CRATE_DONE_6,
    crateStuck: CRATE_STUCK_6,
    player: facings(PLAYER_UP_6, PLAYER_DOWN_6, PLAYER_LEFT_6),
  },
  5: {
    size: 5,
    wall: WALL_5,
    wallTop: WALL_TOP_5,
    floor: FLOOR_5,
    goal: GOAL_5,
    crate: CRATE_5,
    crateDone: CRATE_DONE_5,
    crateStuck: CRATE_STUCK_5,
    player: noFacing(PLAYER_5),
  },
  4: {
    size: 4,
    wall: WALL_4,
    wallTop: WALL_TOP_4,
    floor: FLOOR_4,
    goal: GOAL_4,
    crate: CRATE_4,
    crateDone: CRATE_DONE_4,
    crateStuck: CRATE_STUCK_4,
    player: noFacing(PLAYER_4),
  },
};

export function tileSet(size: TileSize): TileSet {
  return SETS[size];
}

/** The player sprite for a facing, for callers that have a DirValue to hand. */
export function playerSprite(set: TileSet, facing: DirValue): Sprite {
  return set.player[facing];
}
