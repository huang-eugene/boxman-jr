/**
 * What "hard enough" means, in one place.
 *
 * Both the importer and the test suite read this module, so a puzzle can only
 * ship if it meets the same bar the importer was filtering for. Keeping the
 * limits here rather than inlining numbers in the test is what makes it
 * possible to retune the game without hunting for magic numbers.
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
 * `explored` is also what the shipped packs are SORTED by. Ordering by pushes
 * was tried and produces long runs of same-length puzzles; ordering by
 * expansions produces a curve that climbs the whole way and, as a free bonus,
 * satisfies the anti-plateau rule below without any special pleading.
 */

/** Never more than this many pushes, anywhere, ever. A child has to finish. */
export const MAX_PUSHES = 40;

/** Never more than this many crates to keep track of at once. */
export const MAX_BOXES = 4;

/**
 * How hard the solver is allowed to work before we call a level too hard.
 * "Ran out of budget" and "past what we would ship" are the same answer.
 */
export const SOLVER_BUDGET = 400_000;

/**
 * The terminal we promise to fit in: PowerShell at 100x28, tile >= 4px.
 * The importer rejects anything larger and the test suite re-checks it.
 */
export const BUDGET_COLS = 100;
export const BUDGET_ROWS = 28;

/**
 * How many distinct optimal-push values a window of consecutive levels must
 * show. This is the anti-plateau rule: it is what forbids shipping thirteen
 * levels in a row that are all exactly five pushes long.
 */
export const PLATEAU_WINDOW = 8;
export const PLATEAU_MIN_DISTINCT = 4;
