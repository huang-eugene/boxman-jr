/**
 * Pixel-art sprites.
 *
 * Sprites are authored as arrays of strings so they can be read and edited as
 * pictures rather than as data. Each character is a palette key; '.' means
 * transparent, so sprites composite over the floor beneath them.
 *
 * Every tile exists at four sizes. The renderer picks the largest that fits
 * the terminal, so a small level gets chunky, detailed art and a bigger one
 * degrades gracefully instead of being cropped.
 */

import type { RGB } from './color.js';
import { theme } from './theme.js';

export type TileSize = 8 | 6 | 5 | 4;
export const TILE_SIZES: readonly TileSize[] = [8, 6, 5, 4];

/** Palette keys shared by every sprite. */
const PALETTE: Record<string, RGB | null> = {
  '.': null, // transparent
  L: theme.wallLight,
  D: theme.wallDark,
  E: theme.wallEdge,
  F: theme.floor,
  o: theme.floorDot,
  c: theme.crateLight,
  m: theme.crateMid,
  k: theme.crateDark,
  g: theme.crateDoneLight,
  n: theme.crateDoneMid,
  j: theme.crateDoneDark,
  G: theme.goal,
  h: theme.goalDim,
  s: theme.skin,
  b: theme.shirt,
  B: theme.shirtDark,
  r: theme.hair,
  e: theme.eye,
  x: theme.stuck,
};

export interface Sprite {
  readonly w: number;
  readonly h: number;
  /** Row-major; null means transparent. */
  readonly px: ReadonlyArray<RGB | null>;
}

function spr(rows: string[]): Sprite {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const px: (RGB | null)[] = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y].padEnd(w, '.');
    for (let x = 0; x < w; x++) {
      const key = row[x];
      if (!(key in PALETTE)) {
        throw new Error(`Sprite uses unknown palette key ${JSON.stringify(key)}`);
      }
      px.push(PALETTE[key]);
    }
  }
  return { w, h, px };
}

/* ---------------------------------------------------------------- 8x8 ---- */

const WALL_8 = spr([
  'LLLLLLLL',
  'LDDDLDDD',
  'LDDDLDDD',
  'LLLLLLLL',
  'DLDDDLDD',
  'DLDDDLDD',
  'LLLLLLLL',
  'EEEEEEEE',
]);

const FLOOR_8 = spr([
  'oFFFFFFF',
  'FFFFFFFF',
  'FFFFFFFF',
  'FFFFFFFF',
  'FFFFFFFF',
  'FFFFFFFF',
  'FFFFFFFF',
  'FFFFFFFo',
]);

const GOAL_8 = spr([
  '........',
  '...GG...',
  '..GhhG..',
  '.Gh..hG.',
  '.Gh..hG.',
  '..GhhG..',
  '...GG...',
  '........',
]);

const CRATE_8 = spr([
  'kkkkkkkk',
  'kccccccm',
  'kcmkkmck',
  'kckkkmck',
  'kckkkmck',
  'kcmkkmck',
  'kmmmmmmk',
  'kkkkkkkk',
]);

const CRATE_DONE_8 = spr([
  'jjjjjjjj',
  'jgggggnj',
  'jgnjjngj',
  'jgjjjngj',
  'jgjjjngj',
  'jgnjjngj',
  'jnnnnnnj',
  'jjjjjjjj',
]);

const CRATE_STUCK_8 = spr([
  'xxxxxxxx',
  'xccccccm',
  'xcmxxmcx',
  'xcxxxmcx',
  'xcxxxmcx',
  'xcmxxmcx',
  'xmmmmmmx',
  'xxxxxxxx',
]);

const PLAYER_8 = spr([
  '..rrrr..',
  '.rssssr.',
  '.seesse.',
  '.ssssss.',
  '..bbbb..',
  '.bBbbBb.',
  '.b.bb.b.',
  '..B..B..',
]);

/* ---------------------------------------------------------------- 6x6 ---- */

const WALL_6 = spr([
  'LLLLLL',
  'LDDLDD',
  'LLLLLL',
  'DLDDLD',
  'LLLLLL',
  'EEEEEE',
]);

const FLOOR_6 = spr([
  'oFFFFF',
  'FFFFFF',
  'FFFFFF',
  'FFFFFF',
  'FFFFFF',
  'FFFFFo',
]);

const GOAL_6 = spr([
  '......',
  '..GG..',
  '.GhhG.',
  '.GhhG.',
  '..GG..',
  '......',
]);

const CRATE_6 = spr([
  'kkkkkk',
  'kcccmk',
  'kcmmck',
  'kcmmck',
  'kmmmmk',
  'kkkkkk',
]);

const CRATE_DONE_6 = spr([
  'jjjjjj',
  'jgggnj',
  'jgnngj',
  'jgnngj',
  'jnnnnj',
  'jjjjjj',
]);

const CRATE_STUCK_6 = spr([
  'xxxxxx',
  'xcccmx',
  'xcmmcx',
  'xcmmcx',
  'xmmmmx',
  'xxxxxx',
]);

const PLAYER_6 = spr([
  '.rrrr.',
  'rssssr',
  'sessee',
  '.bbbb.',
  'bBbbBb',
  '.B..B.',
]);

/* ---------------------------------------------------------------- 5x5 ---- */

const WALL_5 = spr([
  'LLLLL',
  'LDDLD',
  'LLLLL',
  'DLDDL',
  'EEEEE',
]);

const FLOOR_5 = spr([
  'oFFFF',
  'FFFFF',
  'FFFFF',
  'FFFFF',
  'FFFFo',
]);

const GOAL_5 = spr([
  '.....',
  '.GGG.',
  '.GhG.',
  '.GGG.',
  '.....',
]);

const CRATE_5 = spr([
  'kkkkk',
  'kccmk',
  'kcmck',
  'kmmmk',
  'kkkkk',
]);

const CRATE_DONE_5 = spr([
  'jjjjj',
  'jggnj',
  'jgngj',
  'jnnnj',
  'jjjjj',
]);

const CRATE_STUCK_5 = spr([
  'xxxxx',
  'xccmx',
  'xcmcx',
  'xmmmx',
  'xxxxx',
]);

const PLAYER_5 = spr([
  '.rrr.',
  'rsssr',
  'sesse',
  '.bbb.',
  'bB.Bb',
]);

/* ---------------------------------------------------------------- 4x4 ---- */

const WALL_4 = spr([
  'LLLL',
  'LDDL',
  'LLLL',
  'EEEE',
]);

const FLOOR_4 = spr([
  'oFFF',
  'FFFF',
  'FFFF',
  'FFFo',
]);

const GOAL_4 = spr([
  '....',
  '.GG.',
  '.GG.',
  '....',
]);

const CRATE_4 = spr([
  'kkkk',
  'kccm',
  'kmmm',
  'kkkk',
]);

const CRATE_DONE_4 = spr([
  'jjjj',
  'jggn',
  'jnnn',
  'jjjj',
]);

const CRATE_STUCK_4 = spr([
  'xxxx',
  'xccm',
  'xmmm',
  'xxxx',
]);

const PLAYER_4 = spr([
  'rrrr',
  'sees',
  '.bb.',
  'B..B',
]);

export interface TileSet {
  readonly size: TileSize;
  readonly wall: Sprite;
  readonly floor: Sprite;
  readonly goal: Sprite;
  readonly crate: Sprite;
  readonly crateDone: Sprite;
  readonly crateStuck: Sprite;
  readonly player: Sprite;
}

const SETS: Record<TileSize, TileSet> = {
  8: {
    size: 8,
    wall: WALL_8,
    floor: FLOOR_8,
    goal: GOAL_8,
    crate: CRATE_8,
    crateDone: CRATE_DONE_8,
    crateStuck: CRATE_STUCK_8,
    player: PLAYER_8,
  },
  6: {
    size: 6,
    wall: WALL_6,
    floor: FLOOR_6,
    goal: GOAL_6,
    crate: CRATE_6,
    crateDone: CRATE_DONE_6,
    crateStuck: CRATE_STUCK_6,
    player: PLAYER_6,
  },
  5: {
    size: 5,
    wall: WALL_5,
    floor: FLOOR_5,
    goal: GOAL_5,
    crate: CRATE_5,
    crateDone: CRATE_DONE_5,
    crateStuck: CRATE_STUCK_5,
    player: PLAYER_5,
  },
  4: {
    size: 4,
    wall: WALL_4,
    floor: FLOOR_4,
    goal: GOAL_4,
    crate: CRATE_4,
    crateDone: CRATE_DONE_4,
    crateStuck: CRATE_STUCK_4,
    player: PLAYER_4,
  },
};

export function tileSet(size: TileSize): TileSet {
  return SETS[size];
}
