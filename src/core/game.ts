/**
 * Pure game rules: move, undo, solved-check.
 *
 * Everything here is a plain function over GameState. No I/O, no rendering.
 * The invariant that matters most: `undo` exactly reverses `step`, so a random
 * walk of N moves followed by N undos returns to the starting state. That
 * property is unit-tested and catches essentially every undo bug.
 */

import {
  DELTA,
  OPPOSITE,
  Tile,
  type DirValue,
  type GameState,
  type Level,
  type Move,
} from './types.js';

/** Build a fresh playable state from a level's starting position. */
export function createState(level: Level): GameState {
  const boxes = new Uint8Array(level.width * level.height);
  for (const cell of level.startBoxes) boxes[cell] = 1;

  return {
    level,
    player: level.startPlayer,
    boxes,
    moves: 0,
    pushes: 0,
    history: [],
  };
}

/** Reset a state to the level's starting position, reusing the object. */
export function resetState(state: GameState): void {
  state.boxes.fill(0);
  for (const cell of state.level.startBoxes) state.boxes[cell] = 1;
  state.player = state.level.startPlayer;
  state.moves = 0;
  state.pushes = 0;
  state.history.length = 0;
}

/**
 * Translate a cell index one step in `dir`, or -1 if that would leave the grid.
 *
 * Parsed levels are always wall-enclosed, so in practice we never fall off the
 * edge during play - but the bounds check keeps this function safe to call on
 * any index, which the deadlock scanner relies on.
 */
export function neighbour(level: Level, cell: number, dir: DirValue): number {
  const [dx, dy] = DELTA[dir];
  const x = (cell % level.width) + dx;
  const y = ((cell / level.width) | 0) + dy;
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) return -1;
  return y * level.width + x;
}

export interface StepResult {
  /** Did the player actually move? */
  moved: boolean;
  /** Did this move push a box? */
  pushed: boolean;
  /** Cell the box landed on, or -1 if nothing was pushed. */
  boxTo: number;
}

const NO_MOVE: StepResult = { moved: false, pushed: false, boxTo: -1 };

/**
 * Attempt to move the player one square in `dir`, mutating `state`.
 *
 * Rules: you may walk onto floor. You may push a single box if the square
 * beyond it is free floor. You may never push two boxes at once, and never
 * push a box into a wall.
 */
export function step(state: GameState, dir: DirValue): StepResult {
  const { level, boxes } = state;
  const target = neighbour(level, state.player, dir);

  if (target === -1 || level.tiles[target] === Tile.Wall) return NO_MOVE;

  let pushed = false;
  let boxTo = -1;

  if (boxes[target] === 1) {
    const beyond = neighbour(level, target, dir);
    // Can't push into a wall, off the grid, or into a second box.
    if (beyond === -1 || level.tiles[beyond] === Tile.Wall || boxes[beyond] === 1) {
      return NO_MOVE;
    }
    boxes[target] = 0;
    boxes[beyond] = 1;
    pushed = true;
    boxTo = beyond;
    state.pushes++;
  }

  state.player = target;
  state.moves++;
  state.history.push({ dir, pushed });

  return { moved: true, pushed, boxTo };
}

/**
 * Undo the most recent move. Returns false if there is nothing to undo.
 *
 * This is the single most important feature in the game for its audience: it
 * is what makes experimenting safe, so it is unlimited and always available.
 */
export function undo(state: GameState): boolean {
  const move: Move | undefined = state.history.pop();
  if (move === undefined) return false;

  const { level, boxes } = state;
  const back = OPPOSITE[move.dir];

  // Where the player currently stands is where the box was pushed FROM, so if
  // this move was a push, the box is now one further along in `dir`.
  if (move.pushed) {
    const boxCell = neighbour(level, state.player, move.dir);
    if (boxCell !== -1) {
      boxes[boxCell] = 0;
      boxes[state.player] = 1;
    }
    state.pushes--;
  }

  const prev = neighbour(level, state.player, back);
  if (prev !== -1) state.player = prev;
  state.moves--;

  return true;
}

/** Every goal has a box on it. */
export function isSolved(state: GameState): boolean {
  const { goals } = state.level;
  const { boxes } = state;
  for (let i = 0; i < goals.length; i++) {
    if (goals[i] === 1 && boxes[i] === 0) return false;
  }
  return true;
}

/** Count boxes currently sitting on goals - used for the HUD. */
export function boxesOnGoals(state: GameState): number {
  const { goals } = state.level;
  const { boxes } = state;
  let n = 0;
  for (let i = 0; i < goals.length; i++) {
    if (goals[i] === 1 && boxes[i] === 1) n++;
  }
  return n;
}

/** Total number of goals in the level. */
export function goalCount(level: Level): number {
  let n = 0;
  for (let i = 0; i < level.goals.length; i++) n += level.goals[i];
  return n;
}
