/**
 * What "hard enough" means, in one place.
 *
 * Both the generator and the test suite read this module, so a puzzle can only
 * ship if it meets the same bar the generator was aiming at. Keeping the curve
 * here rather than inlining numbers in the test is what makes it possible to
 * retune the game without hunting for magic numbers.
 *
 * Two measures, because push count alone is a poor proxy for difficulty:
 *
 *   pushes    - optimal number of crate pushes. Sets the *length* of a puzzle,
 *               and is what tires a young player out, so it stays capped.
 *   explored  - positions the breadth-first solver had to expand before it
 *               found that solution. This is the one that says whether a puzzle
 *               makes you *think*. A level solvable in twelve expansions has an
 *               answer you can see at a glance, however many pushes it takes.
 *
 * The original Warehouse pack is exactly why the second measure exists: forty
 * levels sharing five distinct push counts, eight of which the solver finished
 * in under a dozen expansions. Long, but never interesting.
 */

/** Never more than this many pushes, anywhere, ever. A child has to finish. */
export const MAX_PUSHES = 25;

/** Never more than this many crates to keep track of at once. */
export const MAX_BOXES = 4;

export interface Target {
  minPushes: number;
  maxPushes: number;
  /** Lower bound on solver expansions: the "you have to think" floor. */
  minExplored: number;
  /**
   * What the slot is actually aiming at. The generator picks the candidate
   * nearest this rather than the hardest one it can find - left to maximise,
   * it hands every slot a puzzle at the top of its band and rebuilds the very
   * plateau this file exists to prevent, just higher up.
   */
  idealExplored: number;
  boxes: number;
  width: number;
  height: number;
  /**
   * Solver budget while searching for a candidate.
   *
   * Most random boards are junk, and a junk 4-crate board is exactly the kind
   * that makes the solver grind through hundreds of thousands of positions
   * before admitting defeat. Capping the search makes each rejection cheap, and
   * costs nothing real: a puzzle that needs more expansions than this is past
   * what we would ship anyway, so "ran out of budget" and "too hard" are the
   * same answer.
   */
  budget: number;
}

/** Geometric interpolation - difficulty grows multiplicatively, not linearly. */
function ramp(from: number, to: number, j: number, n: number): number {
  if (n <= 1) return to;
  return Math.round(from * Math.pow(to / from, j / (n - 1)));
}

/**
 * The difficulty a pack's j-th level (0-based) is expected to hit.
 *
 * Returns null for packs we do not generate - First Steps is hand-designed and
 * deliberately teaches one idea at a time, so a mechanical curve is the wrong
 * tool there. It gets the looser `tutorialFloor` check instead.
 */
export function targetFor(packId: string, j: number, n: number): Target | null {
  if (packId === 'warehouse') {
    const minPushes = 4 + Math.floor((j * 7) / n);
    const ideal = ramp(70, 2000, j, n);
    return {
      minPushes,
      // Room to breathe: a tight band plus a single expansion target makes
      // every level in a stretch come out the same length, which is the
      // plateau all over again in the dimension a player notices first.
      maxPushes: Math.min(MAX_PUSHES, minPushes + 5),
      minExplored: Math.round(ideal / 2),
      idealExplored: ideal,
      boxes: j < Math.floor(n / 4) ? 2 : 3,
      width: j < Math.floor(n / 2) ? 9 : 10,
      height: j < Math.floor(n / 4) ? 6 : 7,
      budget: 40_000,
    };
  }

  if (packId === 'bigpuzzles') {
    // Starts where the Warehouse pack finishes - about a dozen pushes and a
    // couple of thousand expansions - rather than dropping back down, which is
    // what a new pack of "big" puzzles opening easier than the old one's ending
    // would feel like.
    const minPushes = 10 + Math.floor((j * 6) / n);
    const ideal = ramp(2600, 22000, j, n);
    return {
      minPushes,
      maxPushes: MAX_PUSHES,
      minExplored: Math.round(ideal / 2),
      idealExplored: ideal,
      boxes: j < Math.floor(n / 3) ? 3 : 4,
      width: 11,
      height: j < Math.floor(n / 3) ? 7 : 8,
      budget: 90_000,
    };
  }

  return null;
}

/**
 * The floor for the hand-designed First Steps pack.
 *
 * The first ten levels teach the rules and are allowed to be nearly free. After
 * that, a puzzle may be gentle but must not be *easier than the tutorial's own
 * opening* - a two-push, three-expansion level sitting at number 24 is the kind
 * of thing that makes a player put the game down.
 */
export function tutorialFloor(j: number): { minPushes: number; minExplored: number } {
  if (j < 10) return { minPushes: 1, minExplored: 0 };
  if (j < 20) return { minPushes: 4, minExplored: 20 };
  return { minPushes: 5, minExplored: 60 };
}

/**
 * How many distinct optimal-push values a window of consecutive levels must
 * show. This is the anti-plateau rule: it is what forbids shipping thirteen
 * levels in a row that are all exactly five pushes long.
 */
export const PLATEAU_WINDOW = 8;
export const PLATEAU_MIN_DISTINCT = 4;
