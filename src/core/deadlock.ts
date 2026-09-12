/**
 * Conservative deadlock detection.
 *
 * Design rule, and it matters more than coverage: only ever report a deadlock
 * we can PROVE. Missing one is harmless - the kid presses U and carries on. A
 * false alarm, on the other hand, teaches an 8-year-old to distrust the game's
 * advice, which is much worse.
 *
 * We therefore implement only simple corner deadlocks, gated on reachability.
 * Frozen-box and corral deadlocks are deliberately out of scope.
 */

import { floodFill } from './sok.js';
import { Tile, type GameState, type Level } from './types.js';

/**
 * Compute the set of squares from which a box can never reach any goal,
 * as a width*height mask of 0|1. Computed once per level and cached.
 *
 * A square is "dead" when it is boxed in on two perpendicular sides: a box
 * there can only ever be pushed along an axis it is already walled against,
 * i.e. not at all.
 *
 * The reachability gate is MANDATORY, not an optimisation. Without it, the
 * naive corner test flags every enclosed nook in the outer wall padding -
 * squares no box can ever occupy - and produces a flurry of false positives.
 */
export function computeDeadSquares(level: Level): Uint8Array {
  const { width, height, tiles, goals } = level;
  const dead = new Uint8Array(width * height);

  // Only squares the player can actually walk to are candidates. Anything
  // outside that region is structurally irrelevant.
  const reachable = floodFill(tiles, width, height, level.startPlayer);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;

      if (reachable[cell] === 0) continue;
      if (tiles[cell] === Tile.Wall) continue;
      // A goal is never dead - that is where boxes are supposed to end up.
      if (goals[cell] === 1) continue;

      const wallUp = y === 0 || tiles[cell - width] === Tile.Wall;
      const wallDown = y === height - 1 || tiles[cell + width] === Tile.Wall;
      const wallLeft = x === 0 || tiles[cell - 1] === Tile.Wall;
      const wallRight = x === width - 1 || tiles[cell + 1] === Tile.Wall;

      const blockedVertically = wallUp || wallDown;
      const blockedHorizontally = wallLeft || wallRight;

      if (blockedVertically && blockedHorizontally) dead[cell] = 1;
    }
  }

  return dead;
}

/** Per-level cache so we compute the mask once, not once per move. */
const cache = new WeakMap<Level, Uint8Array>();

export function deadSquaresFor(level: Level): Uint8Array {
  let mask = cache.get(level);
  if (mask === undefined) {
    mask = computeDeadSquares(level);
    cache.set(level, mask);
  }
  return mask;
}

/**
 * Is the box that just landed on `cell` now unrecoverable?
 * O(1) - a single mask lookup.
 */
export function isBoxStuck(state: GameState, cell: number): boolean {
  if (cell < 0) return false;
  return deadSquaresFor(state.level)[cell] === 1;
}

/**
 * Scan the whole board for any stuck box, returning its cell index or -1.
 *
 * Used after undo/restart to clear or re-raise the hint, so the warning never
 * lingers once the kid has fixed the problem.
 */
export function findStuckBox(state: GameState): number {
  const mask = deadSquaresFor(state.level);
  const { boxes } = state;
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i] === 1 && mask[i] === 1) return i;
  }
  return -1;
}
