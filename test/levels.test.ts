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
import {
  fingerprint,
  levelId,
  readCollections,
  select,
  split,
} from '../tools/import-microban.js';
import {
  BUDGET_COLS,
  BUDGET_ROWS,
  MAX_BOXES,
  MAX_PUSHES,
  PLATEAU_MIN_DISTINCT,
  PLATEAU_WINDOW,
  SOLVER_BUDGET,
} from '../tools/difficulty.js';
import { fitsAtMinimumTile } from '../src/render/board.js';

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
 * Solving 90-odd Sokoban levels is the expensive part of this suite; doing it
 * per test would make adding a check something you think twice about, which is
 * exactly the wrong incentive.
 */
const rated = new Map<string, SolveResult>(
  refs.map((r) => [`${r.pack.manifest.id}/${r.level.id}`, solve(r.level, SOLVER_BUDGET)]),
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

  /**
   * Ids must be unique across ALL packs, not just within one.
   *
   * Progress is keyed by (packId, levelId), but `reconcile` follows a level's
   * record between packs by level id alone - it is the durable identity of a
   * puzzle. Two puzzles sharing one id would therefore swap stars as the tiers
   * get re-cut. The risk arrived with the second and third Microban sets, whose
   * numbering starts again at 1; the `m2-`/`m3-` id prefixes are what keep them
   * apart, and this is the test that says so.
   */
  test('level ids are unique across every pack', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];

    for (const ref of refs) {
      const previous = seen.get(ref.level.id);
      if (previous !== undefined) {
        clashes.push(`${ref.pack.manifest.id}/${ref.level.id} clashes with ${previous}`);
      } else {
        seen.set(ref.level.id, `${ref.pack.manifest.id}/${ref.level.id}`);
      }
    }

    assert.deepEqual(clashes, [], `\n${clashes.join('\n')}\n`);
  });

  /**
   * Microban is not ours. The licence is "freely distributable provided they
   * remain properly credited", so shipping a pack without the credit attached
   * is a licence breach, not a missing nicety - which makes it a test.
   */
  test('every pack credits where its puzzles came from', () => {
    for (const pack of packs) {
      assert.ok(
        pack.manifest.attribution && pack.manifest.attribution.length > 0,
        `${pack.manifest.id} has no attribution`,
      );
      assert.ok(
        pack.manifest.author && pack.manifest.author.length > 0,
        `${pack.manifest.id} has no author`,
      );
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

  test('no two levels share a title', () => {
    const seen = new Map<string, string>();
    for (const ref of refs) {
      const previous = seen.get(ref.level.title);
      assert.equal(
        previous,
        undefined,
        `${ref.level.id} and ${previous} are both called "${ref.level.title}"`,
      );
      seen.set(ref.level.title, ref.level.id);
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

  /**
   * The recorded par must be the truth.
   *
   * pack.json carries each level's optimal push count so the win screen can
   * award stars against what the puzzle actually needs. A stale number there
   * would silently make a puzzle ungradeable, so it is checked against a fresh
   * solve rather than trusted.
   */
  test('the par recorded in pack.json is the solver-optimal push count', () => {
    const failures: string[] = [];
    for (const ref of refs) {
      const result = rate(ref);
      if (!result.solved) continue;
      if (ref.level.optimalPushes !== result.pushes) {
        failures.push(
          `${ref.pack.manifest.id}/${ref.level.id}: pack.json says ` +
            `${ref.level.optimalPushes}, solver says ${result.pushes}`,
        );
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
   * The curve, stated as an invariant.
   *
   * The packs are built by sorting on `explored` - how many positions the
   * breadth-first solver had to expand - because push count alone is a poor
   * proxy for difficulty: the old Warehouse pack had eight-push levels the
   * solver finished in eighteen expansions, because every crate started next to
   * its goal and the answer was visible at a glance.
   *
   * So the ordering must never go backwards. This is what stops someone
   * dropping a new puzzle into the middle of a pack by hand and quietly
   * flattening the curve.
   */
  test('difficulty never goes backwards across the whole game', () => {
    const failures: string[] = [];
    let previous = { name: '(start)', explored: -1 };

    for (const ref of refs) {
      const result = rate(ref);
      const name = `${ref.pack.manifest.id}/${ref.level.id} "${ref.level.title}"`;
      if (result.solved && result.explored < previous.explored) {
        failures.push(
          `${name} needs ${result.explored} expansions but follows ` +
            `${previous.name} at ${previous.explored} - the curve dips here`,
        );
      }
      if (result.solved) previous = { name, explored: result.explored };
    }

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

  /**
   * The shipped packs must be exactly what the importer produces.
   *
   * Everything above checks the levels on disk against the rules. This checks
   * them against the CODE that is supposed to have put them there, which is a
   * different question and catches a different bug: before the second and third
   * Microban sets were added, `select` returned 93 levels and the packs held 91,
   * because two had been dropped by hand and nothing noticed for the life of the
   * project. A hand-edited pack.json is not a sin - but it has to be a change
   * the importer would make too, or the next re-import silently reverts it.
   */
  test('the packs on disk are what the importer produces', { timeout: 180_000 }, () => {
    const expected = split(select(readCollections()));

    assert.equal(packs.length, expected.length, 'wrong number of packs');

    const failures: string[] = [];
    packs.forEach((pack, i) => {
      const want = expected[i].map((r) => levelId(r.raw));
      const got = pack.levels.map((l) => l.id);
      if (want.join(',') !== got.join(',')) {
        failures.push(
          `${pack.manifest.id}:\n  on disk:  ${got.join(' ')}\n  importer: ${want.join(' ')}`,
        );
      }
    });

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
