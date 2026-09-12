/**
 * Parser for the standard Sokoban `.sok` text format.
 *
 *   #  wall          $  box            .  goal
 *   @  player        *  box on goal    +  player on goal
 *   (space) floor
 *
 * PURE module: no I/O. Callers read the file and hand us the text.
 */

import { LevelParseError, Tile, type Level } from './types.js';

/** Characters that mean "there is a box here". */
const BOX_CHARS = new Set(['$', '*']);
/** Characters that mean "there is a goal here". */
const GOAL_CHARS = new Set(['.', '*', '+']);
/** Characters that mean "the player starts here". */
const PLAYER_CHARS = new Set(['@', '+']);
/** Every legal glyph. */
const LEGAL = new Set(['#', '$', '.', '@', '*', '+', ' ', '-', '_']);

export interface ParseOptions {
  /** Stable level id, supplied by the pack loader. */
  id: string;
  title: string;
  /** Optimal pushes from the manifest, if the pack records one. */
  optimalPushes?: number;
}

/**
 * Split raw file text into grid rows.
 *
 * Two things matter here and both have bitten every Sokoban implementation
 * ever written:
 *
 *  1. CRLF. Level files are routinely authored on Windows.
 *  2. Trailing spaces are SIGNIFICANT - they are floor tiles. We must pad rows
 *     out to the max width, never trim them. Editors love to strip them, so we
 *     also accept `-` and `_` as explicit floor characters.
 */
function toRows(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  // Drop comment lines (';' prefix, used by some collections) and leading or
  // trailing blank lines, but keep interior blank lines out entirely: a blank
  // line inside a level would mean a row of nothing, which is never valid.
  const content = lines.filter((l) => !l.startsWith(';'));

  let start = 0;
  let end = content.length;
  while (start < end && content[start].trim() === '') start++;
  while (end > start && content[end - 1].trim() === '') end--;

  return content.slice(start, end).filter((l) => l.trim() !== '');
}

/**
 * Flood-fill from the player to find every square reachable without crossing a
 * wall. Used both to validate enclosure and, later, by the deadlock checker.
 *
 * Exported because `deadlock.ts` needs exactly this and there is no reason to
 * write it twice.
 */
export function floodFill(
  tiles: Uint8Array,
  width: number,
  height: number,
  from: number,
): Uint8Array {
  const seen = new Uint8Array(width * height);
  if (tiles[from] === Tile.Wall) return seen;

  // Explicit stack rather than recursion: levels are small, but a pathological
  // file shouldn't be able to blow the call stack.
  const stack: number[] = [from];
  seen[from] = 1;

  while (stack.length > 0) {
    const cell = stack.pop()!;
    const x = cell % width;
    const y = (cell / width) | 0;

    // Up, Down, Left, Right - inlined to avoid allocating per neighbour.
    if (y > 0) pushIf(cell - width);
    if (y < height - 1) pushIf(cell + width);
    if (x > 0) pushIf(cell - 1);
    if (x < width - 1) pushIf(cell + 1);
  }

  function pushIf(n: number): void {
    if (seen[n] === 0 && tiles[n] !== Tile.Wall) {
      seen[n] = 1;
      stack.push(n);
    }
  }

  return seen;
}

/**
 * Check the level is sealed: the player must not be able to walk off the edge
 * of the grid. An unsealed level means a malformed file, and would otherwise
 * produce very confusing behaviour at play time.
 */
function assertEnclosed(
  tiles: Uint8Array,
  width: number,
  height: number,
  player: number,
  id: string,
): Uint8Array {
  const reachable = floodFill(tiles, width, height, player);

  for (let i = 0; i < reachable.length; i++) {
    if (reachable[i] === 0) continue;
    const x = i % width;
    const y = (i / width) | 0;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      throw new LevelParseError(
        `Level "${id}" is not enclosed: the player can reach the grid edge at ` +
          `(${x}, ${y}). Every level needs a complete wall around it.`,
      );
    }
  }

  return reachable;
}

/** Parse `.sok` text into an immutable Level, validating as we go. */
export function parseLevel(text: string, opts: ParseOptions): Level {
  const { id, title, optimalPushes } = opts;
  const rows = toRows(text);

  if (rows.length === 0) {
    throw new LevelParseError(`Level "${id}" is empty.`);
  }

  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));

  const tiles = new Uint8Array(width * height);
  const goals = new Uint8Array(width * height);
  const boxList: number[] = [];
  let player = -1;

  for (let y = 0; y < height; y++) {
    const row = rows[y];
    for (let x = 0; x < width; x++) {
      // Right-pad short rows with floor. This is the padding rule: we extend,
      // we never trim.
      const ch = x < row.length ? row[x] : ' ';
      const cell = y * width + x;

      if (!LEGAL.has(ch)) {
        throw new LevelParseError(
          `Level "${id}" has an unexpected character ${JSON.stringify(ch)} at ` +
            `(${x}, ${y}). Legal characters are: # $ . @ * + and space.`,
        );
      }

      if (ch === '#') {
        tiles[cell] = Tile.Wall;
        continue;
      }

      tiles[cell] = Tile.Floor;
      if (GOAL_CHARS.has(ch)) goals[cell] = 1;
      if (BOX_CHARS.has(ch)) boxList.push(cell);
      if (PLAYER_CHARS.has(ch)) {
        if (player !== -1) {
          throw new LevelParseError(
            `Level "${id}" has more than one player start position.`,
          );
        }
        player = cell;
      }
    }
  }

  if (player === -1) {
    throw new LevelParseError(
      `Level "${id}" has no player start position (expected "@" or "+").`,
    );
  }

  const goalCount = goals.reduce((n, g) => n + g, 0);
  if (boxList.length === 0) {
    throw new LevelParseError(`Level "${id}" has no boxes.`);
  }
  if (boxList.length !== goalCount) {
    throw new LevelParseError(
      `Level "${id}" has ${boxList.length} box(es) but ${goalCount} goal(s). ` +
        `These must match or the level can never be solved.`,
    );
  }

  assertEnclosed(tiles, width, height, player, id);

  return {
    id,
    title,
    width,
    height,
    tiles,
    goals,
    startBoxes: Int32Array.from(boxList.sort((a, b) => a - b)),
    startPlayer: player,
    ...(typeof optimalPushes === 'number' ? { optimalPushes } : {}),
  };
}
