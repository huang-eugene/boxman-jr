/**
 * Microban importer. DEV-ONLY: never shipped in the npm tarball.
 *
 * Turns the Microban collections in tools/data/ into the level packs the game
 * ships. This replaces the old random level generator: generated Sokoban is
 * always *valid* and almost never *interesting*, because nothing in a random
 * board search knows what an idea is. Microban is hand-built puzzles, each one
 * small and each one about something.
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
 *   6. is not a board we are already shipping from another set
 *
 * The survivors are then SORTED BY `explored` - how many positions the solver
 * had to expand - and cut into the packs in TIERS. That is the difficulty
 * curve: it is measured, not guessed, and it is the reason the packs climb
 * steadily instead of flattening out.
 *
 *   node dist-test/tools/import-microban.js
 *   node dist-test/tools/import-microban.js --dry-run
 *
 * The puzzles themselves are Microban by David W. Skinner, freely distributable
 * with credit. See levels/pack1/CREDITS.md.
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
const DATA = path.join(root, 'tools', 'data');
const LEVELS = path.join(root, 'levels');

export const ATTRIBUTION =
  'Puzzles from Microban by David W. Skinner, used with credit.';
export const SOURCE_URL =
  'http://www.abelmartin.com/rj/sokobanJS/Skinner/David%20W.%20Skinner%20-%20Sokoban.htm';

/* ----------------------------------------------------------- collections --- */

export interface Collection {
  /** Skinner's name for the set. Goes in the credits and in every .sok file. */
  label: string;
  /** File under tools/data/, kept byte-for-byte as downloaded. */
  file: string;
  /**
   * Level id prefix.
   *
   * Microban I's prefix is `m` and CAN NEVER CHANGE: saved progress is keyed by
   * level id, so renaming `m044` would silently orphan every record a child has
   * earned on it. That is the only reason the prefixes are not symmetrical -
   * `m`, then `m2-`, `m3-` - and it is a good enough one.
   */
  prefix: string;
  released: string;
}

/**
 * The sets we ship, oldest first.
 *
 * All four complete Microban sets carry the same licence and the same design
 * brief, so adding one is a line here plus its titles below. Microban IV is
 * deliberately absent: it is largely the alphabet series, big boards spelling
 * out letters, and only 18 of its 102 puzzles survive the gates above - so it
 * buys little and most of what it does buy is at the hard end.
 */
export const COLLECTIONS: readonly Collection[] = [
  {
    label: 'Microban',
    file: 'Microban.txt',
    prefix: 'm',
    released: 'April 2000',
  },
  {
    label: 'Microban II',
    file: 'Microban2.txt',
    prefix: 'm2-',
    released: 'April 2002',
  },
  {
    label: 'Microban III',
    file: 'Microban3.txt',
    prefix: 'm3-',
    released: 'December 2009',
  },
];

export interface RawLevel {
  /** Which collection this came from. */
  set: Collection;
  /** Position in that collection, 1-based. This is its identity. */
  number: number;
  /** Skinner's own name for it, where he gave one. */
  name?: string;
  rows: string[];
}

/** The stable level id used for progress records and for the .sok filename. */
export const levelId = (raw: RawLevel): string =>
  `${raw.set.prefix}${String(raw.number).padStart(3, '0')}`;

/**
 * Split a collection file into levels.
 *
 * The format is a `;<number> ['<name>']` header line followed by the board.
 * Trailing spaces inside a board are significant - they are floor - so rows are
 * never trimmed on the right.
 */
export function parseCollection(text: string, set: Collection): RawLevel[] {
  const levels: RawLevel[] = [];
  let current: RawLevel | null = null;

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith(';')) {
      if (current !== null && current.rows.length > 0) levels.push(current);
      const header = line.slice(1).trim();
      const quoted = /'([^']*)'/.exec(header);
      current = {
        set,
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

/** Read every collection in COLLECTIONS, in order. */
export function readCollections(dir: string = DATA): RawLevel[] {
  const raws: RawLevel[] = [];
  for (const set of COLLECTIONS) {
    raws.push(
      ...parseCollection(fs.readFileSync(path.join(dir, set.file), 'utf8'), set),
    );
  }
  return raws;
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

/* ----------------------------------------------------------------- packs --- */

interface Tier {
  id: string;
  name: string;
  order: number;
}

/**
 * The shipped packs, gentlest first.
 *
 * These are difficulty tiers, not collections: the selection from all three
 * Microban sets is sorted into one curve and then cut into these, so a single
 * pack routinely draws from every set. Pack ids are progress keys, so they are
 * as stable as level ids - but unlike level ids they are not tied to a puzzle's
 * provenance, which is why they are numbered plainly.
 *
 * Seven packs of about thirty: small enough that finishing one is an event a
 * child gets to have fairly often, which is the whole point of having tiers at
 * all rather than one list of two hundred puzzles.
 */
const TIERS: readonly Tier[] = [
  { id: 'pack1', name: 'Warming Up', order: 1 },
  { id: 'pack2', name: 'Finding Your Feet', order: 2 },
  { id: 'pack3', name: 'Getting Tricky', order: 3 },
  { id: 'pack4', name: 'Think It Through', order: 4 },
  { id: 'pack5', name: 'Proper Puzzles', order: 5 },
  { id: 'pack6', name: 'Head Scratchers', order: 6 },
  { id: 'pack7', name: 'For Real Experts', order: 7 },
];

/**
 * Titles, keyed by level id, in difficulty order within each set.
 *
 * Skinner named only a handful of these puzzles; the rest are ours, written to
 * sound like an invitation rather than a warning. Every shipped level needs one
 * - `writePack` refuses to write a pack with an untitled level in it, because
 * "Microban II #13" is not a name you hand a seven-year-old - and no two may be
 * the same, which the test suite checks.
 *
 * The original set and number travel in each .sok file's comment header
 * regardless, so the provenance of every board is recoverable from the level
 * file alone.
 */
const TITLES: Record<string, string> = {
  /* Microban I - the 2000 set. */
  'm044': 'Easy Does It', 'm002': 'Two in the Corner',
  'm056': 'Room to Turn', 'm001': 'The Little Room',
  'm009': 'Two Ways Out', 'm046': 'Through the Gap',
  'm023': 'Middle Ground', 'm021': 'Side by Side',
  'm012': 'The Long Way', 'm030': 'Three in a Row',
  'm067': 'In and Out', 'm014': 'Past the Pillars',
  'm032': 'All in a Line', 'm051': 'Squeeze Past',
  'm031': 'Little Cluster', 'm027': 'Round the Bend',
  'm015': 'Up and Over', 'm025': 'Nearly There',
  'm028': 'The Pair', 'm024': 'Two Below',
  'm050': 'Across the Hall', 'm019': 'The Corridor',
  'm003': 'Two Little Rooms', 'm058': 'Shuffle Along',
  'm082': 'Zig and Zag', 'm017': 'Three to Place',
  'm038': 'The Cross Hall', 'm018': 'Down the Stairs',
  'm040': 'In the Middle', 'm057': 'The Long Drop',
  'm055': 'Two Floors', 'm011': 'Up the Steps',
  'm020': 'Straight Ahead', 'm029': 'The Big Room',
  'm022': 'Around the Post', 'm026': 'Three Together',
  'm039': 'Two Little Doors', 'm010': 'The Ladder',
  'm047': 'Four Corners', 'm053': 'The Diamond',
  'm045': 'Mind the Post', 'm081': 'Single File',
  'm042': 'Three on the Wall', 'm071': 'The Courtyard',
  'm013': 'Stack Them Up', 'm041': 'Neat and Tidy',
  'm061': 'The Basement', 'm037': 'The Chimney',
  'm004': 'Push the Line', 'm033': 'Three Doors',
  'm043': 'The Store Room', 'm068': 'The Side Room',
  'm079': 'Cross Over', 'm048': 'Tuck Them In',
  'm119': 'The Back Room', 'm052': 'Top and Tail',
  'm104': 'Middle Muddle', 'm094': 'Down the Middle',
  'm103': 'Round and Round', 'm091': 'Both Ways',
  'm049': 'Drop Them Down', 'm006': 'The Old Warehouse',
  'm064': 'The Staircase', 'm073': 'Through the House',
  'm086': 'Four in the Corner', 'm034': 'All Together Now',
  'm005': 'The Windmill', 'm016': 'Two by Two',
  'm110': 'The Pinwheel', 'm128': 'Cross the Yard',
  'm072': 'Two Halves', 'm096': 'The Crossroads',
  'm136': 'Left and Right', 'm132': 'The Top Corner',
  'm142': 'The Flower', 'm062': 'The Long Hall',
  'm075': 'Four in a Row', 'm074': 'The Narrow Way',
  'm069': 'Four Rooms', 'm127': 'Right in the Middle',
  'm080': 'Up and Around', 'm152': 'The Maze',
  'm124': 'The Great Hall', 'm070': 'Two Pairs',
  'm090': 'Meet in the Middle', 'm131': 'Up to the Top',
  'm089': 'The Deep Room', 'm135': 'Round the Houses',
  'm125': 'The Winding Way', 'm054': 'The Grand Tour',
  'm130': 'The Last Push',
  /* Microban I - two more that pass the gates. */
  'm008': 'The Long Way Home', 'm149': 'Crates Down the Corridor',

  /* Microban II - the 2002 set. */
  'm2-001': 'Two Along the Row', 'm2-002': 'One More to Go',
  'm2-003': 'Up and In', 'm2-004': 'Room to Spare',
  'm2-005': 'Down to the Corner', 'm2-006': 'The Far Crate',
  'm2-007': 'Round Two Bends', 'm2-008': 'Through the Middle',
  'm2-009': 'Between the Walls', 'm2-010': 'Row Upon Row',
  'm2-011': 'The Tight Corner', 'm2-012': 'Two Columns',
  'm2-013': 'Under the Big Room', 'm2-014': 'Three in a Column',
  'm2-015': 'Nudge Them Along', 'm2-016': 'The Long Detour',
  'm2-017': 'Down to the Floor', 'm2-018': 'Two Rooms Down',
  'm2-019': 'Three on the Right', 'm2-020': 'Round the Middle',
  'm2-021': 'The Long Climb', 'm2-022': 'The Far Room',
  'm2-023': 'The Two Wings', 'm2-024': 'The Big Loop',
  'm2-025': 'The Plus Sign', 'm2-026': 'Up the Side',
  'm2-028': 'Along the Top', 'm2-029': 'The Little Landing',
  'm2-031': 'The Whole Way Round', 'm2-032': 'Down the Chute',
  'm2-033': 'The Narrow Squeeze', 'm2-034': 'Up the Column',
  'm2-036': 'The Straight Push', 'm2-037': 'The Right-Hand Wall',
  'm2-038': 'Three Up', 'm2-039': 'The Little Loop',
  'm2-040': 'Straight Down', 'm2-041': 'Corner to Corner',
  'm2-042': 'Three to the Left', 'm2-043': 'The Two Nooks',
  'm2-044': 'Around the Block', 'm2-045': 'The Four Square',
  'm2-048': 'The Crowded Middle', 'm2-049': 'The Ring',
  'm2-050': 'Mirror Image', 'm2-051': 'Four in Pairs',
  'm2-052': 'From Upstairs', 'm2-053': 'Three at the Top',
  'm2-056': 'The Middle Squeeze', 'm2-057': 'The Big Cluster',
  'm2-058': 'Four to the Left', 'm2-059': 'Three Doorways',
  'm2-062': 'The Four Nooks', 'm2-063': 'The Grand Sweep',
  'm2-064': 'The Long Room', 'm2-079': 'Four Down the Side',
  'm2-080': 'The Far Four', 'm2-081': 'The Big House',
  'm2-088': 'Four at the Top', 'm2-098': 'The Tall Column',
  'm2-106': 'The Winding Four', 'm2-122': 'Four Together',
  'm2-128': 'The Long Line',

  /* Microban III - the 2009 set. */
  'm3-001': 'Three in the Hall', 'm3-002': 'Two and One',
  'm3-003': 'Three Alcoves', 'm3-004': 'The Narrow Three',
  'm3-005': 'Sweep Them In', 'm3-006': 'The Twin Pairs',
  'm3-008': 'The Five Slots', 'm3-012': 'Into the Corner Room',
  'm3-013': 'Three and One', 'm3-014': 'Four to the Middle',
  'm3-015': 'The Four Across', 'm3-016': 'Round the Nooks',
  'm3-017': 'The Wide Room', 'm3-021': 'Up to the Landing',
  'm3-037': 'Four Along the Row', 'm3-045': 'The Four Pillars',
  'm3-048': 'The Double Pair', 'm3-049': 'The Swap',
  'm3-050': 'The Second Swap', 'm3-051': 'The Crossing',

  /*
   * Microban III #60-100 are Skinner's LOMA puzzles: families of four or five
   * variations on one idea, which is why these titles come in families too.
   */
  /* LOMA 1: three crates beside three slots. */
  'm3-060': 'The Three Slots', 'm3-061': 'Slot by Slot',
  'm3-062': 'Three in the Stack', 'm3-063': 'Up the Slots',
  'm3-064': 'The Far Slots',
  /* LOMA 2: the same, taken in turns. */
  'm3-065': 'Every Other One', 'm3-066': 'The Zigzag Slots',
  'm3-067': 'In Turn', 'm3-068': 'One Then the Next',
  /* LOMA 3: a column of crates, pushed upward. */
  'm3-069': 'The Tall Stack', 'm3-070': 'Over the Wall',
  'm3-071': 'Four Straight Up', 'm3-072': 'The Tall Order',
  /* LOMA 4: the bent corridor. */
  'm3-073': 'The Crooked Hall', 'm3-074': 'The Twisty Bit',
  'm3-075': 'Up the Narrow Hall', 'm3-076': 'The Bent Corridor',
  /* LOMA 5: crates above, spots below. */
  'm3-077': 'Two Over Two', 'm3-078': 'The Low Room',
  'm3-079': 'The High Room', 'm3-080': 'Down from the Top',
  /* LOMA 6: the cross. */
  'm3-081': 'The Little Cross', 'm3-082': 'The Crooked Cross',
  'm3-083': 'The Wide Cross', 'm3-084': 'The Flat Cross',
  /* LOMA 7: one step at a time. */
  'm3-085': 'The Three Steps', 'm3-086': 'The Little Step',
  'm3-087': 'Step by Step', 'm3-088': 'The Long Step',
  /* LOMA 8: crates all around you. */
  'm3-089': 'One Each Way', 'm3-090': 'Three Around You',
  'm3-091': 'All Around You', 'm3-092': 'Three at Your Feet',
  /* LOMA 9: on the slant. */
  'm3-093': 'The Diagonal', 'm3-094': 'The Slanted Pair',
  'm3-095': 'Across the Slant', 'm3-096': 'The Tilted Room',
  /* LOMA 10: the huddle. */
  'm3-097': 'The Little Huddle', 'm3-098': 'The Huddle Upstairs',
  'm3-099': 'The Snug Corner', 'm3-100': 'The Tidy Huddle',
};

/* ------------------------------------------------------------- selection --- */

export interface Rated {
  raw: RawLevel;
  level: Level;
  pushes: number;
  explored: number;
}

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
    const id = levelId(raw);

    let level: Level;
    try {
      level = parseLevel(raw.rows.join('\n'), { id, title: id });
    } catch {
      continue; // malformed or unenclosed: not ours to fix
    }

    if (!fitsAtMinimumTile(level, BUDGET_COLS, BUDGET_ROWS)) continue;
    if (level.startBoxes.length > MAX_BOXES) continue;

    // Across sets as well as within one: Skinner reuses an idea now and then,
    // and two identical boards under two names is the one bug a player is
    // guaranteed to notice.
    const print = fingerprint(level);
    if (seen.has(print)) continue;

    const result = solve(level, SOLVER_BUDGET);
    if (!result.solved) continue;
    if (result.pushes > MAX_PUSHES) continue;

    seen.add(print);
    kept.push({ raw, level, pushes: result.pushes, explored: result.explored });
  }

  // The curve. `explored` first, pushes to break ties, then set order and
  // original number, so the ordering is total and a re-run produces a
  // byte-identical set of packs.
  kept.sort(
    (a, b) =>
      a.explored - b.explored ||
      a.pushes - b.pushes ||
      COLLECTIONS.indexOf(a.raw.set) - COLLECTIONS.indexOf(b.raw.set) ||
      a.raw.number - b.raw.number,
  );

  return kept;
}

/** Cut the ordered list into the shipped packs. */
export function split(rated: readonly Rated[]): Rated[][] {
  const n = rated.length;
  const t = TIERS.length;
  return TIERS.map((_, i) =>
    rated.slice(Math.round((i * n) / t), Math.round(((i + 1) * n) / t)),
  );
}

/* ---------------------------------------------------------------- write --- */

/** Count puzzles per collection, for the credits file's "N of M". */
function tally(raws: readonly RawLevel[]): Map<Collection, number> {
  const counts = new Map<Collection, number>(COLLECTIONS.map((c) => [c, 0]));
  for (const raw of raws) counts.set(raw.set, (counts.get(raw.set) ?? 0) + 1);
  return counts;
}

function creditsText(
  counts: Map<Collection, number>,
  totals: Map<Collection, number>,
): string {
  const rows = COLLECTIONS.map(
    (c) =>
      `- **${c.label}** (${c.released}): ${counts.get(c) ?? 0} of its ` +
      `${totals.get(c) ?? 0} puzzles`,
  ).join('\n');

  return `# Where these puzzles come from

The puzzles in this game are **Microban**, by **David W. Skinner**.

> These sets may be freely distributed provided they remain properly credited.
> -- David W. Skinner

Source: ${SOURCE_URL}

Skinner wrote four Microban sets between 2000 and 2010 - small puzzles, most of
them built around a single idea, and explicitly recommended by their author as
"good for beginners and children". This game ships the subset of three of them
that fits a terminal window, uses at most ${MAX_BOXES} crates, and can be solved
in at most ${MAX_PUSHES} pushes - selected, verified and ordered by difficulty
using the solver in tools/, by tools/import-microban.ts:

${rows}

Each level file names the set and number it came from in its first line, so any
board here can be traced back to its place in the original collection.

**The MIT licence in this repository covers the game's code. It does not cover
these puzzles**, which remain David W. Skinner's work and are included here on
the terms quoted above.
`;
}

function sokText(rated: Rated): string {
  const { raw } = rated;
  const named = raw.name ? ` "${raw.name}"` : '';
  return (
    `; ${raw.set.label} #${raw.number}${named} by David W. Skinner.\n` +
    `; Freely distributable with credit - see CREDITS.md.\n` +
    `${raw.rows.join('\n')}\n`
  );
}

function writePack(
  tier: Tier,
  levels: readonly Rated[],
  credits: string,
  dryRun: boolean,
): void {
  const dir = path.join(LEVELS, tier.id);

  const manifest = {
    schemaVersion: 1,
    id: tier.id,
    name: tier.name,
    author: 'David W. Skinner',
    attribution: ATTRIBUTION,
    order: tier.order,
    levels: levels.map((r) => ({
      id: levelId(r.raw),
      file: `${levelId(r.raw)}.sok`,
      title: TITLES[levelId(r.raw)]!,
      // The solver's optimal push count, so the game can award stars against
      // what the puzzle actually needs rather than a guess from goal count.
      pushes: r.pushes,
    })),
  };

  if (dryRun) return;

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const rated of levels) {
    fs.writeFileSync(path.join(dir, `${levelId(rated.raw)}.sok`), sokText(rated));
  }
  fs.writeFileSync(path.join(dir, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'CREDITS.md'), credits);
}

/**
 * Packs we wrote last time that this run no longer produces.
 *
 * Retiring a tier has to remove its directory, or the game would go on loading
 * a stale pack full of levels that are now also shipped somewhere else - two
 * progress records for one puzzle, and a duplicate in the level list.
 */
function stalePackDirs(): string[] {
  const live = new Set(TIERS.map((t) => t.id));
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(LEVELS, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (e) =>
        e.isDirectory() &&
        !live.has(e.name) &&
        fs.existsSync(path.join(LEVELS, e.name, 'pack.json')),
    )
    .map((e) => e.name);
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const raws = readCollections();
  const rated = select(raws);
  const packs = split(rated);

  const totals = tally(raws);
  const kept = tally(rated.map((r) => r.raw));
  for (const set of COLLECTIONS) {
    console.log(
      `read ${totals.get(set)} puzzles from ${set.file} (${set.label}), ` +
        `kept ${kept.get(set)}`,
    );
  }
  console.log(`kept ${rated.length} after every gate\n`);

  const untitled = rated.filter((r) => !TITLES[levelId(r.raw)]);
  if (untitled.length > 0) {
    console.log(`${untitled.length} levels have no title yet:`);
    for (const r of untitled) {
      console.log(
        `  ${levelId(r.raw).padEnd(7)} ${r.raw.set.label} #${r.raw.number}  ` +
          `${String(r.pushes).padStart(3)} pushes  ` +
          `${String(r.explored).padStart(6)} expansions`,
      );
      for (const row of r.raw.rows) console.log(`      ${row}`);
    }
    console.log('');
    if (!dryRun) {
      throw new Error(
        `${untitled.length} shipped levels have no title. Add them to TITLES ` +
          `in tools/import-microban.ts - a child should never be handed a ` +
          `puzzle called "Microban II #13".`,
      );
    }
  }

  const credits = creditsText(kept, totals);

  let slot = 0;
  packs.forEach((levels, i) => {
    const tier = TIERS[i];
    writePack(tier, levels, credits, dryRun);
    const ex = levels.map((r) => r.explored);
    const pu = levels.map((r) => r.pushes);
    console.log(
      `${tier.id.padEnd(7)} ${tier.name.padEnd(18)} ${String(levels.length).padStart(3)} levels  ` +
        `explored ${Math.min(...ex)}-${Math.max(...ex)}  ` +
        `pushes ${Math.min(...pu)}-${Math.max(...pu)}`,
    );
    for (const r of levels) {
      slot++;
      console.log(
        `  ${String(slot).padStart(3)}. ${levelId(r.raw).padEnd(7)} ` +
          `${(TITLES[levelId(r.raw)] ?? '?').padEnd(22)} ` +
          `${String(r.pushes).padStart(3)} pushes  ${String(r.explored).padStart(6)} expansions`,
      );
    }
  });

  const stale = stalePackDirs();
  if (stale.length > 0) {
    console.log(`\nremoving retired packs: ${stale.join(', ')}`);
    if (!dryRun) {
      for (const name of stale) {
        fs.rmSync(path.join(LEVELS, name), { recursive: true, force: true });
      }
    }
  }

  console.log(
    dryRun
      ? '\n(dry run: nothing written)'
      : `\nwrote ${TIERS.length} packs to ${LEVELS}`,
  );
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
