import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel } from '../src/core/sok.js';
import {
  createState,
  step,
  undo,
  isSolved,
  resetState,
  boxesOnGoals,
} from '../src/core/game.js';
import { Dir, type DirValue, type GameState } from '../src/core/types.js';

function lvl(rows: string[], id = 'test') {
  return parseLevel(rows.join('\n'), { id, title: id });
}

/** Compact snapshot of everything that defines a position. */
function snapshot(s: GameState): string {
  return `${s.player}|${s.boxes.join('')}|${s.moves}|${s.pushes}`;
}

describe('step', () => {
  test('walks onto floor', () => {
    const s = createState(lvl(['#####', '#@  #', '#  .#', '# $ #', '#####']));
    const before = s.player;
    const r = step(s, Dir.Right);
    assert.equal(r.moved, true);
    assert.equal(r.pushed, false);
    assert.equal(s.player, before + 1);
    assert.equal(s.moves, 1);
  });

  test('refuses to walk into a wall', () => {
    const s = createState(lvl(['#####', '#@$.#', '#####']));
    const r = step(s, Dir.Up);
    assert.equal(r.moved, false);
    assert.equal(s.moves, 0);
    assert.equal(s.history.length, 0);
  });

  test('pushes a box onto free floor', () => {
    const s = createState(lvl(['#####', '#@$.#', '#####']));
    const r = step(s, Dir.Right);
    assert.equal(r.pushed, true);
    assert.equal(s.pushes, 1);
    assert.equal(s.boxes[1 * 5 + 3], 1, 'box moved to the goal');
    assert.equal(s.boxes[1 * 5 + 2], 0, 'box left its old square');
  });

  test('refuses to push a box into a wall', () => {
    //  box is directly against the right wall
    const s = createState(lvl(['#####', '#@.$#', '#####']));
    const r = step(s, Dir.Right);
    // player walks onto the goal square first
    assert.equal(r.moved, true);
    const r2 = step(s, Dir.Right);
    assert.equal(r2.moved, false, 'cannot push box into wall');
    assert.equal(s.pushes, 0);
  });

  test('refuses to push two boxes at once', () => {
    const s = createState(lvl(['#######', '#@$$..#', '#######']));
    const r = step(s, Dir.Right);
    assert.equal(r.moved, false);
    assert.equal(s.pushes, 0);
  });
});

describe('isSolved', () => {
  test('detects the solved position', () => {
    const s = createState(lvl(['#####', '#@$.#', '#####']));
    assert.equal(isSolved(s), false);
    step(s, Dir.Right);
    assert.equal(isSolved(s), true);
    assert.equal(boxesOnGoals(s), 1);
  });

  test('is false while any goal is empty', () => {
    const s = createState(lvl(['#######', '#@$ $.#', '#  .  #', '#######']));
    assert.equal(isSolved(s), false);
  });
});

describe('undo', () => {
  test('returns false with empty history', () => {
    const s = createState(lvl(['#####', '#@$.#', '#####']));
    assert.equal(undo(s), false);
  });

  test('exactly reverses a simple push', () => {
    const s = createState(lvl(['#####', '#@$.#', '#####']));
    const before = snapshot(s);
    step(s, Dir.Right);
    assert.notEqual(snapshot(s), before);
    assert.equal(undo(s), true);
    assert.equal(snapshot(s), before);
  });

  test('exactly reverses a non-push walk', () => {
    const s = createState(lvl(['######', '#@  .#', '#  $ #', '######']));
    const before = snapshot(s);
    step(s, Dir.Right);
    undo(s);
    assert.equal(snapshot(s), before);
  });

  /**
   * The property test that earns its keep. A random walk of N moves followed
   * by N undos must return to the exact starting state - player, every box,
   * and both counters. This catches essentially every undo bug there is.
   */
  test('random walk then full undo returns to the start state', () => {
    const level = lvl([
      '########',
      '#  .   #',
      '# $$   #',
      '#  @.  #',
      '#   $. #',
      '########',
    ]);

    // Deterministic PRNG so a failure is reproducible.
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let trial = 0; trial < 200; trial++) {
      const s = createState(level);
      const start = snapshot(s);
      const applied: DirValue[] = [];

      for (let i = 0; i < 60; i++) {
        const dir = (Math.floor(rnd() * 4) % 4) as DirValue;
        if (step(s, dir).moved) applied.push(dir);
      }

      for (let i = 0; i < applied.length; i++) {
        assert.equal(undo(s), true, 'history should not run dry early');
      }

      assert.equal(undo(s), false, 'history must be empty at the start state');
      assert.equal(
        snapshot(s),
        start,
        `trial ${trial}: state diverged after ${applied.length} moves`,
      );
    }
  });
});

describe('resetState', () => {
  test('restores the starting position and clears history', () => {
    const s = createState(lvl(['######', '#@$ .#', '######']));
    const before = snapshot(s);
    step(s, Dir.Right);
    step(s, Dir.Right);
    resetState(s);
    assert.equal(snapshot(s), before);
    assert.equal(s.history.length, 0);
  });
});
