/**
 * Level pack discovery and loading.
 *
 * Packs are directories under levels/, each with a pack.json manifest. Adding
 * a pack means dropping in a folder - there is no central registry to edit,
 * which is exactly the "expandable without breaking anything" property we want.
 *
 * The critical invariant: level ids are STABLE and come from the manifest.
 * They are never derived from list position, so inserting a level in the
 * middle of a pack changes display order only, and every saved progress record
 * still resolves.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevel } from '../core/sok.js';
import type { Level } from '../core/types.js';

export interface PackEntry {
  id: string;
  file: string;
  title?: string;
  /** Optimal push count, measured by the solver when the pack was built. */
  pushes?: number;
}

export interface PackManifest {
  schemaVersion: number;
  id: string;
  name: string;
  author?: string;
  attribution?: string;
  order: number;
  unlockAfter?: string;
  levels: PackEntry[];
}

export interface Pack {
  manifest: PackManifest;
  dir: string;
  /** Lazily-parsed levels, in manifest order. */
  levels: Level[];
}

/** Locate the bundled levels/ directory, whether running from src or dist. */
export function bundledLevelsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/io/packs.js -> dist/io -> dist -> package root
  const candidates = [
    path.resolve(here, '..', '..', 'levels'),
    path.resolve(here, '..', '..', '..', 'levels'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

/**
 * Longest display string we accept from a manifest.
 *
 * Every one of these is drawn on a single centred line, so a pathologically
 * long title is a layout problem regardless of intent.
 */
const MAX_TEXT = 200;

/**
 * Strip control characters from a manifest string.
 *
 * A pack is data from outside the program - `--levels=DIR` is an advertised
 * feature, so these strings routinely come from somewhere we did not write -
 * and they are drawn straight to the terminal. A terminal treats control bytes
 * as INSTRUCTIONS, not text: an ESC in a level title can retitle the user's
 * window, clear the screen, or leave colour state nobody chose. Strings that
 * are displayed must therefore carry no C0/C1 controls at all.
 *
 * We strip rather than reject so one stray byte in an otherwise fine
 * community pack does not make the pack unplayable. Stripping happens HERE, at
 * the load boundary, rather than at each render site: `name`, `title` and
 * `attribution` reach the screen through several different paths, and a
 * boundary that sanitises once cannot be forgotten by a later one.
 */
function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // C0 (\x00-\x1f, \x7f) and C1 (\x80-\x9f). \x9b is a bare CSI introducer, so
  // dropping the C1 range matters as much as dropping ESC itself.
  const stripped = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
  return stripped.slice(0, MAX_TEXT);
}

function readManifest(dir: string): PackManifest {
  const file = path.join(dir, 'pack.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as PackManifest;

  if (!raw.id || typeof raw.id !== 'string') {
    throw new Error(`${file}: pack is missing a string "id".`);
  }
  if (!Array.isArray(raw.levels)) {
    throw new Error(`${file}: pack is missing a "levels" array.`);
  }

  // Clean ids BEFORE the uniqueness check, not after: two ids that differ only
  // by a control character are the same id once stripped, and checking the raw
  // values would wave that collision through into the progress file.
  const levels = raw.levels.map((entry) => ({
    ...entry,
    id: clean(entry.id) ?? '',
    title: clean(entry.title),
  }));

  // The guardrail that keeps future expansion safe. Duplicate ids would make
  // two different levels share one progress record, silently.
  const seen = new Set<string>();
  for (const entry of levels) {
    if (!entry.id) {
      throw new Error(`${file}: every level needs a stable "id".`);
    }
    if (seen.has(entry.id)) {
      throw new Error(
        `${file}: duplicate level id "${entry.id}". Level ids must be unique ` +
          `within a pack - progress is saved against them.`,
      );
    }
    seen.add(entry.id);
  }

  // Ids are not display strings, but they are interpolated into error messages
  // (which are printed) and used as progress keys, so they get cleaned too.
  const id = clean(raw.id) ?? '';
  if (id === '') {
    throw new Error(`${file}: pack "id" must contain printable characters.`);
  }

  return {
    schemaVersion: raw.schemaVersion ?? 1,
    id,
    name: clean(raw.name) ?? id,
    author: clean(raw.author),
    attribution: clean(raw.attribution),
    order: typeof raw.order === 'number' ? raw.order : 99,
    unlockAfter: clean(raw.unlockAfter),
    levels,
  };
}

/**
 * Resolve a level file against its pack directory, refusing to escape it.
 *
 * `entry.file` comes from the manifest, so `"../../.ssh/id_rsa"` is a thing a
 * pack can ask for. The `.sok` parser happens to reject almost anything that
 * is not a level, which makes this hard to turn into a real disclosure - but
 * that is the parser's strictness doing containment work it was never meant to
 * do, and it still leaves a file-existence oracle. A pack reads its own files
 * and nothing else.
 */
function resolveLevelFile(dir: string, entry: PackEntry): string {
  if (typeof entry.file !== 'string' || entry.file === '') {
    throw new Error(`${dir}: level "${entry.id}" is missing a "file".`);
  }

  const base = path.resolve(dir);
  const file = path.resolve(base, entry.file);

  if (file !== base && !file.startsWith(base + path.sep)) {
    throw new Error(
      `${path.join(dir, 'pack.json')}: level "${entry.id}" points outside its ` +
        `pack directory. Level files must live inside the pack.`,
    );
  }

  return file;
}

function loadPack(dir: string): Pack {
  const manifest = readManifest(dir);
  const levels: Level[] = [];

  for (const entry of manifest.levels) {
    const file = resolveLevelFile(dir, entry);
    const text = fs.readFileSync(file, 'utf8');
    levels.push(
      parseLevel(text, {
        id: entry.id,
        title: entry.title ?? entry.id,
        ...(typeof entry.pushes === 'number' ? { optimalPushes: entry.pushes } : {}),
      }),
    );
  }

  return { manifest, dir, levels };
}

/**
 * Discover and load every pack under `root`, sorted by manifest order then id.
 */
export function loadPacks(root: string = bundledLevelsDir()): Pack[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const packs: Pack[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    if (!fs.existsSync(path.join(dir, 'pack.json'))) continue;
    packs.push(loadPack(dir));
  }

  packs.sort(
    (a, b) =>
      a.manifest.order - b.manifest.order ||
      a.manifest.id.localeCompare(b.manifest.id),
  );

  return packs;
}

/** Flattened (pack, level) pair, for the level-select screen and resume. */
export interface LevelRef {
  pack: Pack;
  level: Level;
  /** Index within the flattened list, for "level 7 of 80" display only. */
  index: number;
}

export function flatten(packs: Pack[]): LevelRef[] {
  const refs: LevelRef[] = [];
  for (const pack of packs) {
    for (const level of pack.levels) {
      refs.push({ pack, level, index: refs.length });
    }
  }
  return refs;
}

/**
 * Note there is deliberately no "find the level the player last saved"
 * helper here. Opening the game on that level is what stranded players
 * ahead of their own progress; where to resume is a progress question, and
 * `resumeIndex` in core/progress.ts answers it.
 */
