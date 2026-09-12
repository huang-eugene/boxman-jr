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
import { solve } from '../tools/solver.js';
import { fitsAtMinimumTile } from '../src/render/board.js';

/** The design budget from the plan: PowerShell at 100x28, tile >= 4px. */
const BUDGET_COLS = 100;
const BUDGET_ROWS = 28;

/** Difficulty gate for an 8-year-old. */
const MAX_PUSHES = 25;
const MAX_BOXES = 4;

const levelsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'levels',
);

const packs = loadPacks(levelsDir);
const refs = flatten(packs);

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

  // The expensive one: prove every level is solvable and rate its difficulty.
  test('every level is solvable and within the difficulty band', { timeout: 120_000 }, () => {
    const failures: string[] = [];

    for (const ref of refs) {
      const result = solve(ref.level, 400_000);
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
    const result = solve(first, 10_000);
    assert.ok(result.solved);
    assert.ok(
      result.pushes <= 3,
      `first level needs ${result.pushes} pushes; it should be nearly free`,
    );
    assert.equal(first.startBoxes.length, 1, 'first level should have one box');
  });

  test('difficulty increases across the whole game', () => {
    // Compare the average difficulty of the first and last ten levels.
    const rate = (r: (typeof refs)[number]): number => {
      const res = solve(r.level, 400_000);
      return res.solved ? res.pushes : 99;
    };
    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

    const firstTen = avg(refs.slice(0, 10).map(rate));
    const lastTen = avg(refs.slice(-10).map(rate));

    assert.ok(
      lastTen > firstTen,
      `difficulty should rise: first ten avg ${firstTen}, last ten avg ${lastTen}`,
    );
  });
});
