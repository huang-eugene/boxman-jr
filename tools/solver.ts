/**
 * Breadth-first Sokoban solver. DEV-ONLY: never shipped in the npm tarball.
 *
 * Its job is not to be fast or clever - it is to answer two questions about a
 * candidate level before we ship it to a child:
 *
 *   1. Is it actually solvable?
 *   2. How hard is it, objectively? (optimal pushes, and search size)
 *
 * BFS over (player-normalised position, box multiset) guarantees the push
 * count it reports is genuinely optimal, which is what makes it usable as a
 * difficulty gate.
 */

import { floodFill } from '../src/core/sok.js';
import { Tile, type Level } from '../src/core/types.js';

export interface SolveResult {
  solved: boolean;
  /** Optimal number of pushes, when solved. */
  pushes: number;
  /** Number of player moves along that solution. */
  moves: number;
  /** States expanded - a decent proxy for "how much thinking is required". */
  explored: number;
  /** True if we gave up before proving anything. */
  exhausted: boolean;
}

const DIRS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/**
 * Canonical key for a position. The player's exact square doesn't matter, only
 * which region it can reach without pushing - so we normalise to the smallest
 * reachable cell index. This collapses a huge number of equivalent states.
 */
function encode(boxes: Int32Array, playerZone: number): string {
  return `${playerZone}:${boxes.join(',')}`;
}

function reachableFrom(
  level: Level,
  boxSet: Set<number>,
  player: number,
): Uint8Array {
  const { width, height, tiles } = level;
  const seen = new Uint8Array(width * height);
  const stack = [player];
  seen[player] = 1;

  while (stack.length > 0) {
    const cell = stack.pop()!;
    const x = cell % width;
    const y = (cell / width) | 0;

    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (seen[n] === 1) continue;
      if (tiles[n] === Tile.Wall) continue;
      if (boxSet.has(n)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }

  return seen;
}

/** Smallest reachable cell index - the canonical representative of the zone. */
function zoneOf(reach: Uint8Array): number {
  for (let i = 0; i < reach.length; i++) if (reach[i] === 1) return i;
  return -1;
}

/** Squares from which a box can never reach a goal (simple corner rule). */
function deadMask(level: Level): Uint8Array {
  const { width, height, tiles, goals } = level;
  const dead = new Uint8Array(width * height);
  const reachable = floodFill(tiles, width, height, level.startPlayer);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
      if (reachable[c] === 0 || tiles[c] === Tile.Wall || goals[c] === 1) continue;
      const up = y === 0 || tiles[c - width] === Tile.Wall;
      const dn = y === height - 1 || tiles[c + width] === Tile.Wall;
      const lf = x === 0 || tiles[c - 1] === Tile.Wall;
      const rt = x === width - 1 || tiles[c + 1] === Tile.Wall;
      if ((up || dn) && (lf || rt)) dead[c] = 1;
    }
  }
  return dead;
}

interface Node {
  boxes: Int32Array;
  player: number;
  pushes: number;
  moves: number;
}

/**
 * Solve `level`, exploring at most `maxStates` positions.
 *
 * Returns `exhausted: true` if the budget ran out, which for our purposes we
 * treat the same as "too hard for this game".
 */
export function solve(level: Level, maxStates = 400_000): SolveResult {
  const goalCells = new Set<number>();
  for (let i = 0; i < level.goals.length; i++) {
    if (level.goals[i] === 1) goalCells.add(i);
  }

  const dead = deadMask(level);
  const startBoxes = Int32Array.from(level.startBoxes).sort((a, b) => a - b);

  const isWin = (boxes: Int32Array): boolean => {
    for (const b of boxes) if (!goalCells.has(b)) return false;
    return true;
  };

  const startSet = new Set(startBoxes);
  const startReach = reachableFrom(level, startSet, level.startPlayer);
  const start: Node = {
    boxes: startBoxes,
    player: level.startPlayer,
    pushes: 0,
    moves: 0,
  };

  if (isWin(startBoxes)) {
    return { solved: true, pushes: 0, moves: 0, explored: 0, exhausted: false };
  }

  const seen = new Set<string>([encode(startBoxes, zoneOf(startReach))]);
  let frontier: Node[] = [start];
  let explored = 0;

  while (frontier.length > 0) {
    const next: Node[] = [];

    for (const node of frontier) {
      if (explored >= maxStates) {
        return {
          solved: false,
          pushes: -1,
          moves: -1,
          explored,
          exhausted: true,
        };
      }
      explored++;

      const boxSet = new Set(node.boxes);
      const reach = reachableFrom(level, boxSet, node.player);

      for (const box of node.boxes) {
        const bx = box % level.width;
        const by = (box / level.width) | 0;

        for (const [dx, dy] of DIRS) {
          // To push a box in (dx,dy) the player must stand on the opposite side.
          const standX = bx - dx;
          const standY = by - dy;
          const toX = bx + dx;
          const toY = by + dy;

          if (standX < 0 || standY < 0 || standX >= level.width || standY >= level.height) continue;
          if (toX < 0 || toY < 0 || toX >= level.width || toY >= level.height) continue;

          const stand = standY * level.width + standX;
          const to = toY * level.width + toX;

          if (reach[stand] !== 1) continue;
          if (level.tiles[to] === Tile.Wall) continue;
          if (boxSet.has(to)) continue;
          if (dead[to] === 1) continue; // pruning: never push into a dead square

          const moved = Int32Array.from(node.boxes);
          const idx = moved.indexOf(box);
          moved[idx] = to;
          moved.sort((a, b) => a - b);

          const newSet = new Set(moved);
          const newReach = reachableFrom(level, newSet, box);
          const key = encode(moved, zoneOf(newReach));
          if (seen.has(key)) continue;
          seen.add(key);

          const child: Node = {
            boxes: moved,
            player: box, // the player ends up where the box was
            pushes: node.pushes + 1,
            moves: node.moves + 1,
          };

          if (isWin(moved)) {
            return {
              solved: true,
              pushes: child.pushes,
              moves: child.moves,
              explored,
              exhausted: false,
            };
          }

          next.push(child);
        }
      }
    }

    frontier = next;
  }

  return { solved: false, pushes: -1, moves: -1, explored, exhausted: false };
}
