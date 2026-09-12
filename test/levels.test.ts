/**
 * The age-appropriateness regression test.
 *
 * This is the guard that stops a level that is too hard, too big, or simply
 * broken from ever reaching a child. Anyone adding levels later runs `npm test`
 * and finds out immediately - which is the whole point of shipping levels as
 * data rather than burying them in code.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flatten, loadPacks } from '../src/io/packs.js';
import { solve, type SolveResult } from '../tools/solver.js';
import { fingerprint } from '../tools/generate.js';
import {
  MAX_BOXES,
  MAX_PUSHES,
  PLATEAU_MIN_DISTINCT,
  PLATEAU_WINDOW,
  targetFor,
  tutorialFloor,
} from '../tools/difficulty.js';
import { fitsAtMinimumTile } from '../src/render/board.js';

/** The design budget from the plan: PowerShell at 100x28, tile >= 4px. */
const BUDGET_COLS = 100;
const BUDGET_ROWS = 28;

const levelsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'levels',
);

const packs = loadPacks(levelsDir);
const refs = flatten(packs);

/**
 * Every level, solved once, shared by every test below.
 *
 * Solving 100-odd Sokoban levels is the expensive part of this suite; doing it
 * per test would make adding a check something you think twice about, which is
 * exactly the wrong incentive.
 */
const rated = new Map<string, SolveResult>(
  refs.map((r) => [`${r.pack.manifest.id}/${r.level.id}`, solve(r.level, 400_000)]),
);
const rate = (ref: (typeof refs)[number]): SolveResult =>
  rated.get(`${ref.pack.manifest.id}/${ref.level.id}`)!;

describe('shipped levels', () => {
  test('packs were discovered', () => {
    assert.ok(packs.length > 0, 'no packs found');
    assert.ok(refs.length >= 50, `expected a decent number of levels, got ${refs.length}`);
  });

  test('level ids are unique within each pack', () => {
    for (const pack of packs) {
      const seen = new Set<string>();
      for (const level of pack.levels) {
        assert.ok(
          !seen.has(level.id),
          `${pack.manifest.id}: duplicate level id ${level.id}`,
        );
        seen.add(level.id);
      }
    }
  });

  test('every level fits the terminal budget at a legible tile size', () => {
    for (const ref of refs) {
      assert.ok(
        fitsAtMinimumTile(ref.level, BUDGET_COLS, BUDGET_ROWS),
        `${ref.pack.manifest.id}/${ref.level.id} (${ref.level.width}x${ref.level.height}) ` +
          `does not fit in ${BUDGET_COLS}x${BUDGET_ROWS}`,
      );
    }
  });

  test('every level has a title', () => {
    for (const ref of refs) {
      assert.ok(
        ref.level.title && ref.level.title !== ref.level.id,
        `${ref.pack.manifest.id}/${ref.level.id} has no proper title`,
      );
    }
  });

  test('no level uses more than the box budget', () => {
    for (const ref of refs) {
      assert.ok(
        ref.level.startBoxes.length <= MAX_BOXES,
        `${ref.pack.manifest.id}/${ref.level.id} has ${ref.level.startBoxes.length} boxes`,
      );
    }
  });

  test('no level starts already solved', () => {
    for (const ref of refs) {
      const onGoal = [...ref.level.startBoxes].filter(
        (c) => ref.level.goals[c] === 1,
      ).length;
      assert.notEqual(
        onGoal,
        ref.level.startBoxes.length,
        `${ref.pack.manifest.id}/${ref.level.id} starts solved`,
      );
    }
  });

  /**
   * No two levels may be the same puzzle.
   *
   * This shipped: First Steps 6 and 7 were byte-identical files under different
   * ids and different titles, so a player solved "Round the Post", was
   * congratulated, and was handed the identical board again called "Go Around".
   */
  test('no two levels are the same puzzle', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];

    for (const ref of refs) {
      const name = `${ref.pack.manifest.id}/${ref.level.id} "${ref.level.title}"`;
      const print = fingerprint(ref.level);
      const previous = seen.get(print);
      if (previous !== undefined) clashes.push(`${name} is identical to ${previous}`);
      else seen.set(print, name);
    }

    assert.deepEqual(clashes, [], `\n${clashes.join('\n')}\n`);
  });

  // The expensive one: prove every level is solvable and rate its difficulty.
  test('every level is solvable and within the difficulty band', { timeout: 120_000 }, () => {
    const failures: string[] = [];

    for (const ref of refs) {
      const result = rate(ref);
      const name = `${ref.pack.manifest.id}/${ref.level.id} "${ref.level.title}"`;

      if (!result.solved) {
        failures.push(`${name}: UNSOLVABLE`);
        continue;
      }
      if (result.pushes > MAX_PUSHES) {
        failures.push(`${name}: too hard (${result.pushes} pushes)`);
      }
    }

    assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
  });

  test('the first level is genuinely trivial', () => {
    // An 8-year-old must succeed almost immediately, or they never see level 2.
    const first = refs[0].level;
    const result = rate(refs[0]);
    assert.ok(result.solved);
    assert.ok(
      result.pushes <= 3,
      `first level needs ${result.pushes} pushes; it should be nearly free`,
    );
    assert.equal(first.startBoxes.length, 1, 'first level should have one box');
  });

  /**
   * The "too easy / boring" guard.
   *
   * Push count alone does not catch it: the original Warehouse pack had levels
   * eight pushes long that the solver finished in eighteen expansions, because
   * every crate started next to its goal and the answer was visible at a
   * glance. `explored` - how many positions the breadth-first solver had to
   * expand - is what separates a puzzle from a chore, so each slot has a floor
   * on both.
   */
  test('every generated level meets the difficulty its slot asks for', () => {
    const failures: string[] = [];

    for (const pack of packs) {
      const n = pack.manifest.levels.length;
      pack.levels.forEach((level, j) => {
        const target = targetFor(pack.manifest.id, j, n);
        if (target === null) return;
        const result = rated.get(`${pack.manifest.id}/${level.id}`)!;
        const name = `${pack.manifest.id}/${level.id} "${level.title}" (#${j + 1})`;

        if (result.pushes < target.minPushes) {
          failures.push(
            `${name}: ${result.pushes} pushes, slot wants at least ${target.minPushes}`,
          );
        }
        if (result.pushes > target.maxPushes) {
          failures.push(
            `${name}: ${result.pushes} pushes, slot allows at most ${target.maxPushes}`,
          );
        }
        if (result.explored < target.minExplored) {
          failures.push(
            `${name}: solved in ${result.explored} expansions, slot wants at ` +
              `least ${target.minExplored} - this one is a chore, not a puzzle`,
          );
        }
      });
    }

    assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
  });

  test('First Steps never drops below its own opening difficulty', () => {
    // Hand-designed, so no mechanical curve - but a two-push level the solver
    // cracks in three expansions has no business being puzzle 24.
    const tutorial = packs.find((p) => p.manifest.id === 'tutorial');
    assert.ok(tutorial, 'the tutorial pack should exist');

    const failures: string[] = [];
    tutorial.levels.forEach((level, j) => {
      const floor = tutorialFloor(j);
      const result = rated.get(`tutorial/${level.id}`)!;
      const name = `tutorial/${level.id} "${level.title}" (#${j + 1})`;

      if (result.pushes < floor.minPushes) {
        failures.push(`${name}: ${result.pushes} pushes, floor is ${floor.minPushes}`);
      }
      if (result.explored < floor.minExplored) {
        failures.push(
          `${name}: ${result.explored} expansions, floor is ${floor.minExplored}`,
        );
      }
    });

    assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
  });

  /**
   * The anti-plateau rule.
   *
   * The Warehouse pack once ran w01-w08 at exactly three pushes each, then
   * thirteen levels at exactly five. Every level passed a "solvable and not too
   * hard" gate individually; the monotony only shows up when you look at a run
   * of them, which is exactly how a player meets them.
   */
  test('no pack has a long run of identically-sized puzzles', () => {
    const failures: string[] = [];

    for (const pack of packs) {
      const pushes = pack.levels.map(
        (l) => rated.get(`${pack.manifest.id}/${l.id}`)!.pushes,
      );
      for (let i = 0; i + PLATEAU_WINDOW <= pushes.length; i++) {
        const window = pushes.slice(i, i + PLATEAU_WINDOW);
        const distinct = new Set(window).size;
        if (distinct < PLATEAU_MIN_DISTINCT) {
          failures.push(
            `${pack.manifest.id} #${i + 1}-#${i + PLATEAU_WINDOW}: only ` +
              `${distinct} distinct push counts (${window.join(',')})`,
          );
        }
      }
    }

    assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
  });

  test('difficulty increases across the whole game', () => {
    // Compare the average difficulty of the first and last ten levels.
    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const pushesOf = (r: (typeof refs)[number]): number =>
      rate(r).solved ? rate(r).pushes : 99;

    const firstTen = avg(refs.slice(0, 10).map(pushesOf));
    const lastTen = avg(refs.slice(-10).map(pushesOf));

    assert.ok(
      lastTen > firstTen,
      `difficulty should rise: first ten avg ${firstTen}, last ten avg ${lastTen}`,
    );
  });
});
