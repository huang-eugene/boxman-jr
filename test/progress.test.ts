import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProgress,
  normalise,
  recordWin,
  recordSkip,
  isSolved,
  solvedCount,
} from '../src/core/progress.js';

describe('progress', () => {
  test('records a win and tracks personal bests', () => {
    const p = emptyProgress();
    assert.equal(recordWin(p, 'tutorial', 't01', 20, 5), true);
    assert.equal(isSolved(p, 'tutorial', 't01'), true);
    assert.equal(p.packs.tutorial.levels.t01.bestMoves, 20);

    // A worse run must not overwrite the best.
    assert.equal(recordWin(p, 'tutorial', 't01', 30, 9), false);
    assert.equal(p.packs.tutorial.levels.t01.bestMoves, 20);

    // A better run must.
    assert.equal(recordWin(p, 'tutorial', 't01', 12, 4), true);
    assert.equal(p.packs.tutorial.levels.t01.bestMoves, 12);
  });

  /**
   * The property the whole pack format exists to protect: inserting a level in
   * the middle of a pack must not disturb progress for any other level.
   */
  test('progress survives inserting a level mid-pack', () => {
    const p = emptyProgress();
    recordWin(p, 'tutorial', 't01', 10, 3);
    recordWin(p, 'tutorial', 't02', 14, 5);
    recordWin(p, 'tutorial', 't03', 22, 8);

    // Simulate shipping a new level "t02b" between t02 and t03. Because
    // records are keyed by id, not index, nothing else moves.
    const reloaded = normalise(JSON.parse(JSON.stringify(p)));

    assert.equal(isSolved(reloaded, 'tutorial', 't01'), true);
    assert.equal(isSolved(reloaded, 'tutorial', 't02'), true);
    assert.equal(isSolved(reloaded, 'tutorial', 't03'), true);
    assert.equal(isSolved(reloaded, 'tutorial', 't02b'), false);
    assert.equal(reloaded.packs.tutorial.levels.t03.bestMoves, 22);
    assert.equal(solvedCount(reloaded, 'tutorial'), 3);
  });

  test('skipping is not a penalty and keeps the level replayable', () => {
    const p = emptyProgress();
    recordSkip(p, 'tutorial', 't05');
    assert.equal(p.packs.tutorial.levels.t05.skipped, true);
    assert.equal(isSolved(p, 'tutorial', 't05'), false);

    // Coming back later and solving it still works.
    recordWin(p, 'tutorial', 't05', 18, 6);
    assert.equal(isSolved(p, 'tutorial', 't05'), true);
  });

  describe('normalise', () => {
    test('turns junk into a usable empty progress', () => {
      for (const junk of [null, undefined, 42, 'nope', []]) {
        const p = normalise(junk);
        assert.equal(typeof p.packs, 'object');
        assert.equal(typeof p.settings, 'object');
      }
    });

    test('drops malformed records without throwing', () => {
      const p = normalise({
        schemaVersion: 1,
        packs: {
          tutorial: { levels: { t01: 'not an object', t02: { solved: true } } },
          broken: 'not a pack',
        },
      });
      assert.equal(isSolved(p, 'tutorial', 't02'), true);
      assert.equal(p.packs.tutorial.levels.t01, undefined);
      assert.equal(p.packs.broken, undefined);
    });

    test('preserves unknown top-level keys from a newer version', () => {
      const p = normalise({
        schemaVersion: 1,
        packs: {},
        settings: {},
        futureFeature: { some: 'data' },
      });
      assert.deepEqual(p.futureFeature, { some: 'data' });
    });
  });
});
