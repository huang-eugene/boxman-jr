/**
 * Level generator. DEV-ONLY: never shipped in the npm tarball.
 *
 * Generate-and-verify, not generate-and-hope. Candidate boards are thrown out
 * at random, then the real BFS solver in solver.ts rates each one, and a
 * candidate is kept only if it lands inside the difficulty band its slot asks
 * for (tools/difficulty.ts). Everything a player ever sees has therefore been
 * solved by machine first, and its optimal push count and search size measured
 * rather than guessed.
 *
 * The run is seeded, so regenerating a pack twice gives the same puzzles and a
 * diff is reviewable.
 *
 *   node dist-test/tools/generate.js warehouse
 *   node dist-test/tools/generate.js warehouse --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevel } from '../src/core/sok.js';
import { Tile, type Level } from '../src/core/types.js';
import { solve } from './solver.js';
import {
  targetFor,
  MAX_BOXES,
  MAX_PUSHES,
  PLATEAU_MIN_DISTINCT,
  PLATEAU_WINDOW,
  type Target,
} from './difficulty.js';

/* ----------------------------------------------------------- randomness --- */

/** mulberry32: tiny, fast, and - the point here - reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rand: () => number, xs: readonly T[]): T =>
  xs[Math.floor(rand() * xs.length)];

/* ------------------------------------------------------------- boards ----- */

interface Candidate {
  width: number;
  height: number;
  tiles: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** Flood fill over floor, ignoring crates. */
function reachable(tiles: Uint8Array, w: number, h: number, from: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  if (tiles[from] === Tile.Wall) return seen;
  const stack = [from];
  seen[from] = 1;
  while (stack.length > 0) {
    const c = stack.pop()!;
    const x = c % w;
    const y = (c / w) | 0;
    const step = (n: number): void => {
      if (seen[n] === 0 && tiles[n] !== Tile.Wall) {
        seen[n] = 1;
        stack.push(n);
      }
    };
    if (y > 0) step(c - w);
    if (y < h - 1) step(c + w);
    if (x > 0) step(c - 1);
    if (x < w - 1) step(c + 1);
  }
  return seen;
}

/**
 * A walled room with a scattering of interior obstacles.
 *
 * Obstacles are what turn a push into a decision, so the density scales with
 * how hard the slot wants to be - but any floor the player cannot reach is
 * filled back in, because a sealed-off pocket just looks like a drawing error.
 */
function makeRoom(rand: () => number, w: number, h: number, obstacles: number): Uint8Array {
  const tiles = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      tiles[y * w + x] = edge ? Tile.Wall : Tile.Floor;
    }
  }

  // Interior walls are placed one or two cells at a time. Never on the ring
  // just inside the outer wall at a corner, which would create dead squares a
  // crate can be lost in before the player has done anything.
  for (let i = 0; i < obstacles; i++) {
    const x = 1 + Math.floor(rand() * (w - 2));
    const y = 1 + Math.floor(rand() * (h - 2));
    tiles[y * w + x] = Tile.Wall;
    if (rand() < 0.4) {
      const horizontal = rand() < 0.5;
      const nx = horizontal ? x + 1 : x;
      const ny = horizontal ? y : y + 1;
      if (nx < w - 1 && ny < h - 1) tiles[ny * w + nx] = Tile.Wall;
    }
  }

  return tiles;
}

/** Fill in any floor the player's region cannot see, so the room reads cleanly. */
function sealPockets(tiles: Uint8Array, w: number, h: number, from: number): number {
  const seen = reachable(tiles, w, h, from);
  let open = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === Tile.Wall) continue;
    if (seen[i] === 1) open++;
    else tiles[i] = Tile.Wall;
  }
  return open;
}

/** Render a candidate back to `.sok` text. */
export function toSok(c: Candidate): string {
  const goals = new Set(c.goals);
  const boxes = new Set(c.boxes);
  const rows: string[] = [];
  for (let y = 0; y < c.height; y++) {
    let row = '';
    for (let x = 0; x < c.width; x++) {
      const i = y * c.width + x;
      if (c.tiles[i] === Tile.Wall) row += '#';
      else if (boxes.has(i)) row += goals.has(i) ? '*' : '$';
      else if (c.player === i) row += goals.has(i) ? '+' : '@';
      else if (goals.has(i)) row += '.';
      else row += ' ';
    }
    // Trailing floor is significant, and editors strip trailing spaces, so any
    // trailing run is written as the explicit floor character the parser takes.
    rows.push(row.replace(/ +$/, (run) => '-'.repeat(run.length)));
  }
  return rows.join('\n') + '\n';
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

/* ---------------------------------------------------------- generation ---- */

export interface Rated {
  level: Level;
  sok: string;
  pushes: number;
  explored: number;
}

/**
 * Draw one candidate and rate it, or return null if it is unusable.
 *
 * Rejections are cheap and common - most random boards are trivial or
 * unsolvable - so this stays deliberately simple and the caller just retries.
 */
function attempt(rand: () => number, target: Target, id: string): Rated | null {
  const { width: w, height: h } = target;
  const obstacles = 2 + Math.floor(rand() * Math.max(2, Math.floor((w * h) / 12)));
  const tiles = makeRoom(rand, w, h, obstacles);

  // Pick somewhere for the player first; everything else hangs off their region.
  const floor: number[] = [];
  for (let i = 0; i < tiles.length; i++) if (tiles[i] === Tile.Floor) floor.push(i);
  if (floor.length < target.boxes * 3 + 2) return null;

  const player = pick(rand, floor);
  const open = sealPockets(tiles, w, h, player);
  if (open < target.boxes * 3 + 2) return null;

  const usable: number[] = [];
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === Tile.Floor && i !== player) usable.push(i);
  }

  // Crates never start on a goal: "Crates 0/3" on the opening frame is a
  // clearer promise to a young player than a free one already banked.
  const chosen = new Set<number>();
  const take = (): number | null => {
    for (let tries = 0; tries < 40; tries++) {
      const c = pick(rand, usable);
      if (!chosen.has(c)) {
        chosen.add(c);
        return c;
      }
    }
    return null;
  };

  const boxes: number[] = [];
  const goals: number[] = [];
  for (let i = 0; i < target.boxes; i++) {
    const b = take();
    const g = take();
    if (b === null || g === null) return null;
    boxes.push(b);
    goals.push(g);
  }

  const candidate: Candidate = { width: w, height: h, tiles, goals, boxes, player };
  const sok = toSok(candidate);

  let level: Level;
  try {
    level = parseLevel(sok, { id, title: id });
  } catch {
    return null; // Unenclosed, no boxes, whatever - the parser is the arbiter.
  }

  const result = solve(level, target.budget);
  if (!result.solved) return null;
  if (result.pushes < target.minPushes || result.pushes > target.maxPushes) return null;
  if (result.pushes > MAX_PUSHES) return null;
  if (result.explored < target.minExplored) return null;
  if (level.startBoxes.length > MAX_BOXES) return null;

  return { level, sok, pushes: result.pushes, explored: result.explored };
}

/**
 * Generate one level for a slot, retrying until it lands in the band.
 *
 * `seen` holds the fingerprints already accepted, so a pack can never ship the
 * same puzzle twice - the bug that put two byte-identical boards at numbers 6
 * and 7 of First Steps.
 */
export function generate(
  seed: number,
  target: Target,
  id: string,
  seen: ReadonlySet<string>,
  avoidPushes: ReadonlySet<number> = new Set(),
  maxAttempts = 6000,
  timeLimitMs = 20_000,
): Rated | null {
  const rand = rng(seed);
  const deadline = Date.now() + timeLimitMs;
  // Distance in log space: being twice as hard as the slot wants and half as
  // hard are equally wrong, and only a ratio says that.
  const miss = (r: Rated): number =>
    Math.abs(Math.log(r.explored / target.idealExplored));

  const search = (avoid: ReadonlySet<number>): Rated | null => {
    let best: Rated | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      // Checked every few attempts rather than every one: Date.now() is not
      // free next to a board that rejects in microseconds.
      if ((i & 15) === 0 && Date.now() > deadline && best !== null) break;

      const got = attempt(rand, target, id);
      if (got === null) continue;
      if (avoid.has(got.pushes)) continue;
      if (seen.has(fingerprint(got.level))) continue;

      if (best === null || miss(got) < miss(best)) best = got;
      // Close enough: a slot asking for ~2000 expansions does not care about
      // the difference between 1900 and 2100, and the search is not cheap.
      if (miss(best) < 0.15) break;
    }
    return best;
  };

  // Aiming every slot at the same expansion count clusters puzzle *lengths*
  // even when the thinking each demands is well spread - which rebuilds the
  // plateau in the one dimension a player notices first. When the run so far
  // has gone monotonous, the caller says which lengths are spent and we insist
  // on a fresh one; only if nothing in the band qualifies do we relax.
  return search(avoidPushes) ?? (avoidPushes.size > 0 ? search(new Set()) : null);
}

/* ------------------------------------------------------------- driver ----- */

const here = path.dirname(fileURLToPath(import.meta.url));
const levelsDir = path.resolve(here, '..', '..', 'levels');

interface ManifestEntry {
  id: string;
  file: string;
  title?: string;
}

function main(): void {
  const args = process.argv.slice(2);
  const packId = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const onlyFailing = !args.includes('--all');

  if (!packId) {
    console.error('usage: generate <packId> [--all] [--dry-run]');
    process.exit(1);
  }

  const dir = path.join(levelsDir, packId);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'),
  ) as { levels: ManifestEntry[] };
  const n = manifest.levels.length;

  // Keep every level we are not touching in the duplicate set, so a regenerated
  // slot can never collide with one we left alone.
  const seen = new Set<string>();
  const existing = new Map<string, Level>();
  for (const entry of manifest.levels) {
    const text = fs.readFileSync(path.join(dir, entry.file), 'utf8');
    const level = parseLevel(text, { id: entry.id, title: entry.title ?? entry.id });
    existing.set(entry.id, level);
    seen.add(fingerprint(level));
  }

  let replaced = 0;
  // Push counts of the levels immediately before this one, kept and regenerated
  // alike, so the anti-plateau rule is enforced as we go rather than discovered
  // by the test suite afterwards.
  const recent: number[] = [];

  manifest.levels.forEach((entry, j) => {
    const target = targetFor(packId, j, n);
    const current = existing.get(entry.id)!;
    const rated = solve(current, 400_000);

    const remember = (pushes: number): void => {
      recent.push(pushes);
      if (recent.length >= PLATEAU_WINDOW) recent.shift();
    };

    if (target === null) {
      remember(rated.pushes);
      return;
    }

    const passes =
      rated.solved &&
      rated.pushes >= target.minPushes &&
      rated.pushes <= target.maxPushes &&
      rated.explored >= target.minExplored;

    if (passes && onlyFailing) {
      console.log(
        `${entry.id} keep    pushes=${rated.pushes} explored=${rated.explored}`,
      );
      remember(rated.pushes);
      return;
    }

    // Only insist on an unused length when the run behind us has actually gone
    // monotonous - otherwise we would be forcing variety that is already there
    // and throwing away good candidates for nothing.
    const distinct = new Set(recent);
    const avoid = distinct.size < PLATEAU_MIN_DISTINCT ? distinct : new Set<number>();

    seen.delete(fingerprint(current));
    // Seed from the pack and slot, so re-running reproduces the same puzzle and
    // regenerating slot 12 never disturbs slot 11.
    const seed = hash(`${packId}:${entry.id}`);
    const got = generate(seed, target, entry.id, seen, avoid);

    if (got === null) {
      seen.add(fingerprint(current));
      remember(rated.pushes);
      console.log(
        `${entry.id} FAILED  no candidate in band ` +
          `(pushes ${target.minPushes}-${target.maxPushes}, explored >=${target.minExplored})`,
      );
      return;
    }

    seen.add(fingerprint(got.level));
    remember(got.pushes);
    replaced++;
    console.log(
      `${entry.id} REGEN   pushes=${got.pushes} explored=${got.explored} ` +
        `(was pushes=${rated.pushes} explored=${rated.explored})`,
    );
    if (!dryRun) fs.writeFileSync(path.join(dir, entry.file), got.sok, 'utf8');
  });

  console.log(
    `\n${replaced} level(s) ${dryRun ? 'would be ' : ''}regenerated in ${packId}.`,
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
