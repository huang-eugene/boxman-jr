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

function readManifest(dir: string): PackManifest {
  const file = path.join(dir, 'pack.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as PackManifest;

  if (!raw.id || typeof raw.id !== 'string') {
    throw new Error(`${file}: pack is missing a string "id".`);
  }
  if (!Array.isArray(raw.levels)) {
    throw new Error(`${file}: pack is missing a "levels" array.`);
  }

  // The guardrail that keeps future expansion safe. Duplicate ids would make
  // two different levels share one progress record, silently.
  const seen = new Set<string>();
  for (const entry of raw.levels) {
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

  return {
    schemaVersion: raw.schemaVersion ?? 1,
    id: raw.id,
    name: raw.name ?? raw.id,
    author: raw.author,
    attribution: raw.attribution,
    order: typeof raw.order === 'number' ? raw.order : 99,
    unlockAfter: raw.unlockAfter,
    levels: raw.levels,
  };
}

function loadPack(dir: string): Pack {
  const manifest = readManifest(dir);
  const levels: Level[] = [];

  for (const entry of manifest.levels) {
    const file = path.join(dir, entry.file);
    const text = fs.readFileSync(file, 'utf8');
    levels.push(
      parseLevel(text, { id: entry.id, title: entry.title ?? entry.id }),
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
