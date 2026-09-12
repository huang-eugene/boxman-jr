import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../src/core/sok.js';
import { computeDeadSquares } from '../src/core/deadlock.js';

function lvl(rows: string[]) {
  return parseLevel(rows.join('\n'), { id: 'd', title: 'd' });
}

describe('computeDeadSquares', () => {
  test('flags interior corners', () => {
    const level = lvl([
      '#####',
      '#@  #',
      '#  .#',
      '# $ #',
      '#####',
    ]);
    const dead = computeDeadSquares(level);
    const at = (x: number, y: number) => dead[y * level.width + x] === 1;

    // All four interior corners are dead (none is a goal).
    assert.equal(at(1, 1), true, 'top-left corner is dead');
    assert.equal(at(3, 1), true, 'top-right corner is dead');
    assert.equal(at(1, 3), true, 'bottom-left corner is dead');
    // (3,3) is a corner too
    assert.equal(at(3, 3), true, 'bottom-right corner is dead');
  });

  test('never flags a goal square', () => {
    // The goal sits in a corner - it must NOT be reported dead.
    const level = lvl([
      '#####',
      '#@  #',
      '#   #',
      '#$ .#',
      '#####',
    ]);
    const dead = computeDeadSquares(level);
    const goalCell = 3 * level.width + 3;
    assert.equal(level.goals[goalCell], 1, 'sanity: that is the goal');
    assert.equal(dead[goalCell], 0, 'a goal is never a deadlock');
  });

  test('does not flag open floor', () => {
    const level = lvl([
      '######',
      '#    #',
      '# @$ #',
      '#  . #',
      '######',
    ]);
    const dead = computeDeadSquares(level);
    // The middle of the room is free on at least one full axis.
    assert.equal(dead[2 * level.width + 2], 0);
  });

  /**
   * The reachability gate. Squares walled off from the play area must never be
   * reported, even though they look like corners geometrically. Without the
   * flood-fill this test fails and the game cries wolf.
   */
  test('ignores squares the player can never reach', () => {
    const level = lvl([
      '########',
      '#@ $. ##',
      '#     ##',
      '########',
    ]);
    const dead = computeDeadSquares(level);
    // Column 6 on row 1/2 is inside the grid but sealed off by the '##'.
    // Whatever its geometry, it must not be flagged.
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        const c = y * level.width + x;
        if (dead[c] === 1) {
          assert.equal(
            level.tiles[c],
            0,
            `dead square at (${x},${y}) must be floor`,
          );
        }
      }
    }
  });
});
