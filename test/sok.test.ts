import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../src/core/sok.js';
import { LevelParseError, Tile } from '../src/core/types.js';

const OPTS = { id: 'test', title: 'Test' };

describe('parseLevel', () => {
  test('parses a minimal level', () => {
    const lvl = parseLevel(
      [
        '#####',
        '#@$.#',
        '#####',
      ].join('\n'),
      OPTS,
    );
    assert.equal(lvl.width, 5);
    assert.equal(lvl.height, 3);
    assert.equal(lvl.startPlayer, 1 * 5 + 1);
    assert.deepEqual([...lvl.startBoxes], [1 * 5 + 2]);
    assert.equal(lvl.goals[1 * 5 + 3], 1);
    assert.equal(lvl.tiles[0], Tile.Wall);
  });

  test('handles box-on-goal (*) and player-on-goal (+)', () => {
    const lvl = parseLevel(
      ['######', '#+$* #', '######'].join('\n'),
      OPTS,
    );
    // '+' is both player and goal
    assert.equal(lvl.startPlayer, 6 + 1);
    assert.equal(lvl.goals[6 + 1], 1);
    // '*' is both box and goal; the plain '$' at x=2 is a box only.
    assert.equal(lvl.goals[6 + 3], 1);
    assert.equal(lvl.goals[6 + 2], 0);
    assert.deepEqual([...lvl.startBoxes], [6 + 2, 6 + 3]);
  });

  test('right-pads short rows instead of trimming them', () => {
    // Row 1 is deliberately short - the trailing floor was "stripped by an
    // editor". Padding must restore it as floor, not leave the grid ragged.
    const text = '######\n#@$. #\n#   #\n######';
    const lvl = parseLevel(text, OPTS);
    assert.equal(lvl.width, 6);
    // The padded cell on the short row must be floor, not wall.
    assert.equal(lvl.tiles[2 * 6 + 5], Tile.Floor);
  });

  test('handles CRLF line endings', () => {
    const lvl = parseLevel('#####\r\n#@$.#\r\n#####', OPTS);
    assert.equal(lvl.height, 3);
    assert.equal(lvl.width, 5);
  });

  test('ignores comment lines and surrounding blank lines', () => {
    const lvl = parseLevel('; a comment\n\n#####\n#@$.#\n#####\n\n', OPTS);
    assert.equal(lvl.height, 3);
  });

  test('rejects mismatched box and goal counts', () => {
    assert.throws(
      () => parseLevel(['#######', '#@$$. #', '#######'].join('\n'), OPTS),
      LevelParseError,
    );
  });

  test('rejects a level with no player', () => {
    assert.throws(
      () => parseLevel(['#####', '# $.#', '#####'].join('\n'), OPTS),
      LevelParseError,
    );
  });

  test('rejects two players', () => {
    assert.throws(
      () => parseLevel(['######', '#@$.@#', '######'].join('\n'), OPTS),
      LevelParseError,
    );
  });

  test('rejects an unenclosed level', () => {
    // No bottom wall: the player can walk off the grid.
    assert.throws(
      () => parseLevel(['#####', '#@$.#'].join('\n'), OPTS),
      LevelParseError,
    );
  });

  test('rejects illegal characters', () => {
    assert.throws(
      () => parseLevel(['#####', '#@$X#', '#####'].join('\n'), OPTS),
      LevelParseError,
    );
  });

  test('rejects an empty level', () => {
    assert.throws(() => parseLevel('', OPTS), LevelParseError);
  });
});
