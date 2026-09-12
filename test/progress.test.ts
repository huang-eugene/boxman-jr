import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProgress,
  normalise,
  recordWin,
  recordSkip,
  recordPosition,
  resumeIndex,
  isSolved,
  solvedCount,
  type LevelCursor,
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

  /**
   * The invariant behind all of these: whatever the title screen's "you have
   * solved N" says, pressing a key must land the player on a puzzle that makes
   * sense next to that number. The old rule - resume wherever you last stood -
   * broke it, which read to players as the game losing their progress.
   */
  describe('resumeIndex', () => {
    const cursors: LevelCursor[] = Array.from({ length: 8 }, (_, i) => ({
      packId: 'tutorial',
      levelId: `t0${i + 1}`,
    }));

    test('a brand new player starts at the very first puzzle', () => {
      assert.equal(resumeIndex(cursors, emptyProgress()), 0);
    });

    test('resumes on the first unsolved puzzle', () => {
      const p = emptyProgress();
      recordWin(p, 'tutorial', 't01', 5, 2);
      recordWin(p, 'tutorial', 't02', 5, 2);
      recordPosition(p, 'tutorial', 't03');
      assert.equal(resumeIndex(cursors, p), 2);
    });

    test('a jump through the level menu does not strand the player', () => {
      // Solve one puzzle, then wander off to puzzle 7 via the menu and quit
      // there. Next launch must not open on puzzle 7 while announcing "solved 1".
      const p = emptyProgress();
      recordWin(p, 'tutorial', 't01', 3, 1);
      recordPosition(p, 'tutorial', 't07');
      assert.equal(resumeIndex(cursors, p), 1);
    });

    test('skipped puzzles are stepped over, then offered again at the end', () => {
      const p = emptyProgress();
      recordWin(p, 'tutorial', 't01', 3, 1);
      recordSkip(p, 'tutorial', 't02');
      assert.equal(resumeIndex(cursors, p), 2, 'skips past the skipped one');

      // Once everything else is done, the skipped puzzle comes back round.
      for (const id of ['t03', 't04', 't05', 't06', 't07', 't08']) {
        recordWin(p, 'tutorial', id, 5, 2);
      }
      assert.equal(resumeIndex(cursors, p), 1);
    });

    test('a finished game stays where the player left off', () => {
      const p = emptyProgress();
      for (const c of cursors) recordWin(p, c.packId, c.levelId, 5, 2);
      recordPosition(p, 'tutorial', 't04');
      assert.equal(resumeIndex(cursors, p), 3);
    });

    test('a saved level that no longer exists does not break resuming', () => {
      const p = emptyProgress();
      for (const c of cursors) recordWin(p, c.packId, c.levelId, 5, 2);
      recordPosition(p, 'tutorial', 'retired-level');
      assert.equal(resumeIndex(cursors, p), cursors.length - 1);
    });

    test('handles an empty level list', () => {
      assert.equal(resumeIndex([], emptyProgress()), 0);
    });
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
