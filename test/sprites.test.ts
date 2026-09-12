/**
 * Guards on the pixel art.
 *
 * Sprites are hand-counted ASCII, and the failure mode is not a crash - it is a
 * tile that is one pixel short and looks very slightly wrong in a terminal
 * nobody is currently looking at. These checks catch that at build time.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZES, tileSet } from '../src/render/sprites.js';
import {
  CHROME_ROWS,
  chooseTileSize,
  chromeRows,
  fitsAtMinimumTile,
  facingOf,
  renderBoard,
  TIGHT_ROWS,
} from '../src/render/board.js';
import { bg } from '../src/render/color.js';
import { theme } from '../src/render/theme.js';
import { createState, step } from '../src/core/game.js';
import { parseLevel } from '../src/core/sok.js';
import { Dir } from '../src/core/types.js';

const LEVEL = parseLevel(
  ['#######', '#  .  #', '# $@$ #', '#  .  #', '#######'].join('\n'),
  { id: 'test', title: 'Test' },
);

describe('sprites', () => {
  test('the tile ladder is strictly descending', () => {
    for (let i = 1; i < TILE_SIZES.length; i++) {
      assert.ok(
        TILE_SIZES[i] < TILE_SIZES[i - 1],
        `TILE_SIZES must descend: ${TILE_SIZES[i - 1]} then ${TILE_SIZES[i]}`,
      );
    }
  });

  test('every sprite is square and the size it claims', () => {
    for (const size of TILE_SIZES) {
      const set = tileSet(size);
      const named = [
        ['wall', set.wall],
        ['wallTop', set.wallTop],
        ['floor', set.floor],
        ['goal', set.goal],
        ['crate', set.crate],
        ['crateDone', set.crateDone],
        ['crateStuck', set.crateStuck],
        ...set.player.map((s, i) => [`player[${i}]`, s] as const),
      ] as const;

      for (const [name, sprite] of named) {
        assert.equal(sprite.w, size, `${size}px ${name} is ${sprite.w} wide`);
        assert.equal(sprite.h, size, `${size}px ${name} is ${sprite.h} tall`);
        assert.equal(
          sprite.px.length,
          size * size,
          `${size}px ${name} has ${sprite.px.length} pixels`,
        );
      }
    }
  });

  test('every tile set has four player facings', () => {
    for (const size of TILE_SIZES) {
      assert.equal(tileSet(size).player.length, 4, `${size}px has no facings`);
    }
  });

  /**
   * Tiles bigger than 8px only exist because a 5x5 crate is unreadable. They
   * are worthless if the art is only drawn at one end of the ladder, so check
   * the opaque area actually grows - a sprite of nothing but transparency
   * would satisfy every other test here.
   */
  test('bigger tiles carry more drawn detail', () => {
    const drawn = (size: (typeof TILE_SIZES)[number]): number =>
      tileSet(size).crate.px.filter((p) => p !== null).length;
    for (let i = 1; i < TILE_SIZES.length; i++) {
      assert.ok(
        drawn(TILE_SIZES[i - 1]) > drawn(TILE_SIZES[i]),
        `crate at ${TILE_SIZES[i - 1]}px should have more drawn pixels ` +
          `than at ${TILE_SIZES[i]}px`,
      );
    }
  });
});

describe('tile size choice', () => {
  test('never returns a size that overflows the window it was given', () => {
    for (let cols = 34; cols <= 220; cols += 7) {
      for (let rows = 12; rows <= 60; rows += 3) {
        const size = chooseTileSize(LEVEL, cols, rows);
        if (size === TILE_SIZES[TILE_SIZES.length - 1]) continue; // the floor
        assert.ok(
          LEVEL.width * size <= cols - 2 &&
            Math.ceil((LEVEL.height * size) / 2) <= rows - chromeRows(rows),
          `${cols}x${rows} chose ${size}px, which does not fit`,
        );
      }
    }
  });

  test('a roomier window never gets smaller art', () => {
    let previous = 0;
    for (let rows = 12; rows <= 70; rows++) {
      const size = chooseTileSize(LEVEL, 200, rows);
      // chromeRows steps up at TIGHT_ROWS, which is the one place a taller
      // window can legitimately hold the size rather than grow it.
      if (rows !== TIGHT_ROWS) {
        assert.ok(size >= previous, `${rows} rows gave ${size}px after ${previous}px`);
      }
      previous = size;
    }
  });

  test('the minimum-tile promise uses the roomy chrome, not the tight one', () => {
    // fitsAtMinimumTile is the contract with level authors. If it quietly used
    // the tight chrome, a level could pass the shipped-levels test and still be
    // cropped on the window that test claims to model.
    assert.ok(chromeRows(TIGHT_ROWS - 1) < CHROME_ROWS);
    const tall = parseLevel(
      ['##########', ...Array(11).fill('#  $  .  #'), '##########'].join('\n').replace('#  $  .  #', '#  $@ .  #'),
      { id: 'tall', title: 'Tall' },
    );
    assert.equal(fitsAtMinimumTile(tall, 100, 28), false);
  });
});

describe('board rendering', () => {
  test('the player faces the way they last moved', () => {
    const state = createState(LEVEL);
    assert.equal(facingOf(state), Dir.Down, 'a fresh level faces forward');

    step(state, Dir.Left);
    assert.equal(facingOf(state), Dir.Left);
    step(state, Dir.Right);
    assert.equal(facingOf(state), Dir.Right);
  });

  test('a rendered board is exactly the size the tile implies', () => {
    for (const size of TILE_SIZES) {
      const render = renderBoard(createState(LEVEL), size);
      assert.equal(render.cols, LEVEL.width * size);
      assert.equal(render.rows, Math.ceil((LEVEL.height * size) / 2));
    }
  });

  test('facing changes what is drawn, at sizes with room for a face', () => {
    const pixels = (s: { px: ReadonlyArray<unknown> }): string =>
      s.px.map((p) => (p === null ? '.' : String(p))).join('|');

    // Below 6px there is no room to turn a head, so those sets share one
    // sprite deliberately. From 6px up all four facings must really differ.
    for (const size of TILE_SIZES.filter((t) => t >= 6)) {
      const drawn = new Set(tileSet(size).player.map(pixels));
      assert.equal(drawn.size, 4, `${size}px has ${drawn.size} distinct facings`);
    }
    for (const size of TILE_SIZES.filter((t) => t < 6)) {
      const drawn = new Set(tileSet(size).player.map(pixels));
      assert.equal(drawn.size, 1, `${size}px should share one sprite`);
    }
  });
});

/**
 * The art is authored in 24-bit colour and downgraded per terminal. Two colours
 * that are clearly different in truecolor can land on the same ANSI-16 bucket,
 * and the result is an object that vanishes into the floor for anyone on an
 * older terminal - a failure nobody developing on a modern one would ever see.
 */
describe('colour survives the downgrade', () => {
  const distinctFromFloor = (name: string, rgb: typeof theme.floor): void => {
    for (const mode of ['truecolor', 'ansi256', 'ansi16'] as const) {
      assert.notEqual(
        bg(rgb, mode),
        bg(theme.floor, mode),
        `${name} is indistinguishable from the floor in ${mode}`,
      );
    }
  };

  test('everything that sits on the floor stays visible against it', () => {
    distinctFromFloor('crate', theme.crateMid);
    distinctFromFloor('crate highlight', theme.crateHighlight);
    distinctFromFloor('solved crate', theme.crateDoneMid);
    distinctFromFloor('goal', theme.goal);
    distinctFromFloor('goal glow', theme.goalGlow);
    distinctFromFloor('the stuck warning', theme.stuck);
    distinctFromFloor("the player's shirt", theme.shirt);
    distinctFromFloor("the player's skin", theme.skin);
    distinctFromFloor('wall', theme.wallLight);
  });

  test('a wall cap is distinguishable from the wall below it', () => {
    for (const mode of ['truecolor', 'ansi256', 'ansi16'] as const) {
      assert.notEqual(
        bg(theme.wallTop, mode),
        bg(theme.wallLight, mode),
        `the lit wall cap disappears in ${mode}`,
      );
    }
  });

  test('a solved crate never looks like an unsolved one', () => {
    for (const mode of ['truecolor', 'ansi256', 'ansi16'] as const) {
      assert.notEqual(bg(theme.crateDoneMid, mode), bg(theme.crateMid, mode));
      assert.notEqual(bg(theme.stuck, mode), bg(theme.crateMid, mode));
    }
  });
});
