/**
 * Core domain types. This module is PURE: no I/O, no ANSI, no node: imports.
 * Everything here must be unit-testable without any terminal.
 */

/** Static geometry of a square. Boxes/player/goals live in separate layers. */
export const enum Tile {
  Floor = 0,
  Wall = 1,
}

/** Direction indices. Kept as a const enum so they're plain numbers at runtime. */
export const enum Dir {
  Up = 0,
  Down = 1,
  Left = 2,
  Right = 3,
}

export type DirValue = 0 | 1 | 2 | 3;

/** Row/column deltas for each Dir, indexed by DirValue. */
export const DELTA: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // Up
  [0, 1], // Down
  [-1, 0], // Left
  [1, 0], // Right
];

/** The reverse of each direction, indexed by DirValue. */
export const OPPOSITE: ReadonlyArray<DirValue> = [1, 0, 3, 2];

/**
 * An immutable parsed level.
 *
 * Cell indices are `y * width + x` throughout. `tiles` and `goals` are the
 * static layers; boxes and the player start position are only the *initial*
 * state, which `createState` copies into a mutable GameState.
 */
export interface Level {
  /** Stable id from pack.json. NEVER derived from position in a list. */
  readonly id: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  /** width*height of Tile */
  readonly tiles: Uint8Array;
  /** width*height of 0|1 */
  readonly goals: Uint8Array;
  /** Sorted cell indices of the starting box positions. */
  readonly startBoxes: Int32Array;
  readonly startPlayer: number;
  /**
   * Optimal push count, measured by the solver at import time and carried in
   * pack.json. Used to award stars against what the puzzle actually needs.
   * Absent for hand-made packs loaded via --levels.
   */
  readonly optimalPushes?: number;
}

/**
 * One recorded move. This is all we need to undo: two bits of meaning.
 * Storing moves rather than board snapshots keeps unlimited undo cheap.
 */
export interface Move {
  readonly dir: DirValue;
  readonly pushed: boolean;
}

/** Mutable play state for one attempt at a level. */
export interface GameState {
  readonly level: Level;
  /** Cell index of the player. */
  player: number;
  /** width*height occupancy grid, 0|1. O(1) collision tests. */
  boxes: Uint8Array;
  moves: number;
  pushes: number;
  /** The undo stack, oldest first. */
  history: Move[];
}

/** Thrown by the parser when a level file is malformed. */
export class LevelParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LevelParseError';
  }
}
