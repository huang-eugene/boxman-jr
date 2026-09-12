/**
 * Microban importer. DEV-ONLY: never shipped in the npm tarball.
 *
 * Turns the Microban collection in tools/data/ into the level packs the game
 * ships. This replaces the old random level generator: generated Sokoban is
 * always *valid* and almost never *interesting*, because nothing in a random
 * board search knows what an idea is. Microban is 155 hand-built puzzles, each
 * one small and each one about something.
 *
 * Nothing is taken on trust. Every candidate is parsed with the game's own
 * parser, measured against the terminal budget, and solved by the BFS solver
 * before it can ship, exactly as generated levels were:
 *
 *   1. parses, is properly enclosed, boxes match goals   (src/core/sok.ts)
 *   2. fits 100x28 at the minimum tile size              (render/board.ts)
 *   3. at most MAX_BOXES crates
 *   4. solvable inside SOLVER_BUDGET expansions
 *   5. needs at most MAX_PUSHES pushes
 *
 * The survivors are then SORTED BY `explored` - how many positions the solver
 * had to expand - and cut into three packs. That is the difficulty curve: it is
 * measured, not guessed, and it is the reason the packs climb steadily instead
 * of flattening out.
 *
 *   node dist-test/tools/import-microban.js
 *   node dist-test/tools/import-microban.js --dry-run
 *
 * The puzzles themselves are Microban by David W. Skinner, freely distributable
 * with credit. See levels/microban1/CREDITS.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevel } from '../src/core/sok.js';
import type { Level } from '../src/core/types.js';
import { fitsAtMinimumTile } from '../src/render/board.js';
import { solve } from './solver.js';
import {
  BUDGET_COLS,
  BUDGET_ROWS,
  MAX_BOXES,
  MAX_PUSHES,
  SOLVER_BUDGET,
} from './difficulty.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** dist-test/tools -> dist-test -> package root. */
const root = path.resolve(here, '..', '..');
const SOURCE = path.join(root, 'tools', 'data', 'Microban.txt');
const LEVELS = path.join(root, 'levels');

export const ATTRIBUTION =
  'Puzzles from Microban by David W. Skinner, used with credit.';
export const SOURCE_URL =
  'http://www.abelmartin.com/rj/sokobanJS/Skinner/David%20W.%20Skinner%20-%20Sokoban.htm';

/* ------------------------------------------------------------ collection --- */

export interface RawLevel {
  /** Position in the original collection, 1-based. This is its identity. */
  number: number;
  /** Skinner's own name for it, where he gave one. */
  name?: string;
  rows: string[];
}

/**
 * Split the collection file into levels.
 *
 * The format is a `;<number> ['<name>']` header line followed by the board.
 * Trailing spaces inside a board are significant - they are floor - so rows are
 * never trimmed on the right.
 */
export function parseCollection(text: string): RawLevel[] {
  const levels: RawLevel[] = [];
  let current: RawLevel | null = null;

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith(';')) {
      if (current !== null && current.rows.length > 0) levels.push(current);
      const header = line.slice(1).trim();
      const quoted = /'([^']*)'/.exec(header);
      current = {
        number: Number.parseInt(header, 10),
        ...(quoted ? { name: quoted[1] } : {}),
        rows: [],
      };
      continue;
    }
    if (current === null || line.trim() === '') continue;
    current.rows.push(line);
  }

  if (current !== null && current.rows.length > 0) levels.push(current);
  return levels;
}

/** Geometry fingerprint, for "is this the same puzzle we already have?". */
export function fingerprint(level: Level): string {
  return [
    level.width,
    level.height,
    Array.from(level.tiles).join(''),
    Array.from(level.goals).join(''),
    Array.from(level.startBoxes).join(','),
    level.startPlayer,
  ].join('|');
}

/* ----------------------------------------------------------------- pack --- */

interface Tier {
  id: string;
  name: string;
  order: number;
}

const TIERS: readonly Tier[] = [
  { id: 'microban1', name: 'Warming Up', order: 1 },
  { id: 'microban2', name: 'Getting Tricky', order: 2 },
  { id: 'microban3', name: 'Proper Puzzles', order: 3 },
];

/**
 * Titles, in difficulty order, keyed by the original Microban number.
 *
 * Skinner named only one puzzle in this selection (#44, "Duh!"); the rest are
 * ours, written to sound like an invitation rather than a warning. The original
 * number and name travel in each .sok file's comment header regardless, so the
 * provenance of every board is recoverable from the level file alone.
 */
const TITLES: Record<number, string> = {
  44: 'Easy Does It', 2: 'Two in the Corner', 56: 'Room to Turn',
  1: 'The Little Room', 9: 'Two Ways Out', 46: 'Through the Gap',
  23: 'Middle Ground', 21: 'Side by Side', 12: 'The Long Way',
  30: 'Three in a Row', 67: 'In and Out', 14: 'Past the Pillars',
  32: 'All in a Line', 51: 'Squeeze Past', 31: 'Little Cluster',
  27: 'Round the Bend', 15: 'Up and Over', 25: 'Nearly There',
  28: 'The Pair', 24: 'Two Below', 50: 'Across the Hall',
  19: 'The Corridor', 3: 'Two Little Rooms', 58: 'Shuffle Along',
  82: 'Zig and Zag', 17: 'Three to Place', 38: 'The Cross Hall',
  18: 'Down the Stairs', 40: 'In the Middle', 57: 'The Long Drop',
  55: 'Two Floors', 11: 'Up the Steps', 20: 'Straight Ahead',
  29: 'The Big Room', 22: 'Around the Post', 26: 'Three Together',
  39: 'Two Little Doors', 10: 'The Ladder', 47: 'Four Corners',
  53: 'The Diamond', 45: 'Mind the Post', 81: 'Single File',
  42: 'Three on the Wall', 71: 'The Courtyard', 13: 'Stack Them Up',
  41: 'Neat and Tidy', 61: 'The Basement', 37: 'The Chimney',
  4: 'Push the Line', 33: 'Three Doors', 43: 'The Store Room',
  68: 'The Side Room', 79: 'Cross Over', 48: 'Tuck Them In',
  119: 'The Back Room', 52: 'Top and Tail', 104: 'Middle Muddle',
  94: 'Down the Middle', 103: 'Round and Round', 91: 'Both Ways',
  49: 'Drop Them Down', 6: 'The Old Warehouse', 64: 'The Staircase',
  73: 'Through the House', 86: 'Four in the Corner', 34: 'All Together Now',
  5: 'The Windmill', 16: 'Two by Two', 110: 'The Pinwheel',
  128: 'Cross the Yard', 72: 'Two Halves', 96: 'The Crossroads',
  136: 'Left and Right', 132: 'The Top Corner', 142: 'The Flower',
  62: 'The Long Hall', 75: 'Four in a Row', 74: 'The Narrow Way',
  69: 'Four Rooms', 127: 'Right in the Middle', 80: 'Up and Around',
  152: 'The Maze', 124: 'The Great Hall', 70: 'Two Pairs',
  90: 'Meet in the Middle', 131: 'Up to the Top', 89: 'The Deep Room',
  135: 'Round the Houses', 125: 'The Winding Way', 54: 'The Grand Tour',
  130: 'The Last Push',
};

/* ------------------------------------------------------------- selection --- */

export interface Rated {
  raw: RawLevel;
  level: Level;
  pushes: number;
  explored: number;
}

/** Pad a Microban number into the stable level id used for progress records. */
export const levelId = (n: number): string => `m${String(n).padStart(3, '0')}`;

/**
 * Apply every gate, then order by measured difficulty.
 *
 * Exported so the test suite can re-derive the same selection and prove the
 * shipped packs really are what this function produces.
 */
export function select(raws: readonly RawLevel[]): Rated[] {
  const kept: Rated[] = [];
  const seen = new Set<string>();

  for (const raw of raws) {
    const id = levelId(raw.number);

    let level: Level;
    try {
      level = parseLevel(raw.rows.join('\n'), { id, title: id });
    } catch {
      continue; // malformed or unenclosed: not ours to fix
    }

    if (!fitsAtMinimumTile(level, BUDGET_COLS, BUDGET_ROWS)) continue;
    if (level.startBoxes.length > MAX_BOXES) continue;

    const print = fingerprint(level);
    if (seen.has(print)) continue;

    const result = solve(level, SOLVER_BUDGET);
    if (!result.solved) continue;
    if (result.pushes > MAX_PUSHES) continue;

    seen.add(print);
    kept.push({ raw, level, pushes: result.pushes, explored: result.explored });
  }

  // The curve. `explored` first, pushes to break ties, original number last so
  // the ordering is total and a re-run produces a byte-identical set of packs.
  kept.sort(
    (a, b) =>
      a.explored - b.explored ||
      a.pushes - b.pushes ||
      a.raw.number - b.raw.number,
  );

  return kept;
}

/** Cut the ordered list into the three shipped packs. */
export function split(rated: readonly Rated[]): Rated[][] {
  const n = rated.length;
  return TIERS.map((_, i) =>
    rated.slice(Math.round((i * n) / 3), Math.round(((i + 1) * n) / 3)),
  );
}

/* ---------------------------------------------------------------- write --- */

const CREDITS = `# Where these puzzles come from

The puzzles in this game are **Microban**, by **David W. Skinner**.

> These sets may be freely distributed provided they remain properly credited.
> -- David W. Skinner

Source: ${SOURCE_URL}

Microban was released in April 2000: 155 small puzzles, most of them built
around a single idea, and explicitly recommended by their author as a good set
for beginners and for children. This game ships the subset that fits a terminal
window, uses at most ${MAX_BOXES} crates, and can be solved in at most
${MAX_PUSHES} pushes - selected, verified and ordered by difficulty using the
solver in tools/, by tools/import-microban.ts.

Each level file names the puzzle it came from in its first line, so any board
here can be traced back to its number in the original collection.

**The MIT licence in this repository covers the game's code. It does not cover
these puzzles**, which remain David W. Skinner's work and are included here on
the terms quoted above.
`;

function sokText(rated: Rated): string {
  const { raw } = rated;
  const named = raw.name ? ` "${raw.name}"` : '';
  return (
    `; Microban #${raw.number}${named} by David W. Skinner.\n` +
    `; Freely distributable with credit - see CREDITS.md.\n` +
    `${raw.rows.join('\n')}\n`
  );
}

function writePack(tier: Tier, levels: readonly Rated[], dryRun: boolean): void {
  const dir = path.join(LEVELS, tier.id);

  const manifest = {
    schemaVersion: 1,
    id: tier.id,
    name: tier.name,
    author: 'David W. Skinner',
    attribution: ATTRIBUTION,
    order: tier.order,
    levels: levels.map((r) => ({
      id: levelId(r.raw.number),
      file: `${levelId(r.raw.number)}.sok`,
      title: TITLES[r.raw.number] ?? `Microban ${r.raw.number}`,
      // The solver's optimal push count, so the game can award stars against
      // what the puzzle actually needs rather than a guess from goal count.
      pushes: r.pushes,
    })),
  };

  if (dryRun) return;

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const rated of levels) {
    fs.writeFileSync(path.join(dir, `${levelId(rated.raw.number)}.sok`), sokText(rated));
  }
  fs.writeFileSync(path.join(dir, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'CREDITS.md'), CREDITS);
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const raws = parseCollection(fs.readFileSync(SOURCE, 'utf8'));
  const rated = select(raws);
  const packs = split(rated);

  console.log(`read ${raws.length} puzzles from ${path.relative(root, SOURCE)}`);
  console.log(`kept ${rated.length} after every gate\n`);

  let slot = 0;
  packs.forEach((levels, i) => {
    const tier = TIERS[i];
    writePack(tier, levels, dryRun);
    const ex = levels.map((r) => r.explored);
    const pu = levels.map((r) => r.pushes);
    console.log(
      `${tier.id.padEnd(11)} ${String(levels.length).padStart(3)} levels  ` +
        `explored ${Math.min(...ex)}-${Math.max(...ex)}  ` +
        `pushes ${Math.min(...pu)}-${Math.max(...pu)}`,
    );
    for (const r of levels) {
      slot++;
      console.log(
        `  ${String(slot).padStart(3)}. ${levelId(r.raw.number)} ` +
          `${(TITLES[r.raw.number] ?? '?').padEnd(20)} ` +
          `${String(r.pushes).padStart(3)} pushes  ${String(r.explored).padStart(6)} expansions`,
      );
    }
  });

  console.log(dryRun ? '\n(dry run: nothing written)' : `\nwrote ${LEVELS}/microban{1,2,3}`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
