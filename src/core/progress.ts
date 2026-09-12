/**
 * Progress data model and its pure operations.
 *
 * The single most important property here: progress is keyed by
 * (packId, levelId) using MAPS, never arrays indexed by position. That is what
 * lets us insert a level into the middle of a pack later without scrambling
 * what the kids have already solved.
 *
 * File I/O lives in io/store.ts; this module stays pure and testable.
 */

import type { GlyphMode } from '../render/caps.js';

export const PROGRESS_SCHEMA_VERSION = 1;

export interface LevelRecord {
  solved: boolean;
  bestMoves?: number;
  bestPushes?: number;
  /** True when the kid chose "try a different puzzle" on this level. */
  skipped?: boolean;
}

export interface PackRecord {
  levels: Record<string, LevelRecord>;
}

export interface Settings {
  colorMode?: 'auto' | 'truecolor' | 'ansi256' | 'ansi16' | 'ascii';
  glyphMode?: GlyphMode;
  /** Which level to resume on. */
  lastPack?: string;
  lastLevel?: string;
}

export interface Progress {
  schemaVersion: number;
  settings: Settings;
  packs: Record<string, PackRecord>;
  /** Anything a future version wrote that we don't understand: preserved. */
  [extra: string]: unknown;
}

export function emptyProgress(): Progress {
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    settings: {},
    packs: {},
  };
}

/**
 * Coerce arbitrary parsed JSON into a valid Progress.
 *
 * Deliberately forgiving: a kid losing their progress is sad, but a kid
 * staring at a stack trace is worse. Anything unrecognisable is replaced with
 * a sane default rather than throwing, and unknown top-level keys are kept so
 * a newer version's data survives a downgrade.
 */
export function normalise(raw: unknown): Progress {
  if (typeof raw !== 'object' || raw === null) return emptyProgress();

  const obj = raw as Record<string, unknown>;
  const result = emptyProgress();

  // Preserve unknown top-level keys verbatim.
  for (const [k, v] of Object.entries(obj)) {
    if (k !== 'schemaVersion' && k !== 'settings' && k !== 'packs') {
      result[k] = v;
    }
  }

  if (typeof obj.settings === 'object' && obj.settings !== null) {
    result.settings = { ...(obj.settings as Settings) };
  }

  if (typeof obj.packs === 'object' && obj.packs !== null) {
    for (const [packId, packRaw] of Object.entries(
      obj.packs as Record<string, unknown>,
    )) {
      if (typeof packRaw !== 'object' || packRaw === null) continue;
      const levelsRaw = (packRaw as Record<string, unknown>).levels;
      if (typeof levelsRaw !== 'object' || levelsRaw === null) continue;

      const levels: Record<string, LevelRecord> = {};
      for (const [levelId, recRaw] of Object.entries(
        levelsRaw as Record<string, unknown>,
      )) {
        if (typeof recRaw !== 'object' || recRaw === null) continue;
        const rec = recRaw as Record<string, unknown>;
        levels[levelId] = {
          solved: rec.solved === true,
          ...(typeof rec.bestMoves === 'number'
            ? { bestMoves: rec.bestMoves }
            : {}),
          ...(typeof rec.bestPushes === 'number'
            ? { bestPushes: rec.bestPushes }
            : {}),
          ...(rec.skipped === true ? { skipped: true } : {}),
        };
      }
      result.packs[packId] = { levels };
    }
  }

  return result;
}

export function getRecord(
  progress: Progress,
  packId: string,
  levelId: string,
): LevelRecord | undefined {
  return progress.packs[packId]?.levels[levelId];
}

export function isSolved(
  progress: Progress,
  packId: string,
  levelId: string,
): boolean {
  return getRecord(progress, packId, levelId)?.solved === true;
}

/**
 * Record a win, keeping the best (lowest) move and push counts seen so far.
 * Returns true if this attempt set a new personal best.
 */
export function recordWin(
  progress: Progress,
  packId: string,
  levelId: string,
  moves: number,
  pushes: number,
): boolean {
  const pack = (progress.packs[packId] ??= { levels: {} });
  const prev = pack.levels[levelId];

  const isBest = prev?.bestMoves === undefined || moves < prev.bestMoves;

  pack.levels[levelId] = {
    ...prev,
    solved: true,
    bestMoves: isBest ? moves : prev?.bestMoves,
    bestPushes: isBest ? pushes : prev?.bestPushes,
  };

  return isBest;
}

/** Mark a level skipped. Skipping is never a penalty; it stays replayable. */
export function recordSkip(
  progress: Progress,
  packId: string,
  levelId: string,
): void {
  const pack = (progress.packs[packId] ??= { levels: {} });
  pack.levels[levelId] = { ...pack.levels[levelId], solved: pack.levels[levelId]?.solved === true, skipped: true };
}

/** Remember where the player was, so we can resume next session. */
export function recordPosition(
  progress: Progress,
  packId: string,
  levelId: string,
): void {
  progress.settings.lastPack = packId;
  progress.settings.lastLevel = levelId;
}

/** How many levels in a pack are solved. */
export function solvedCount(progress: Progress, packId: string): number {
  const pack = progress.packs[packId];
  if (!pack) return 0;
  let n = 0;
  for (const rec of Object.values(pack.levels)) if (rec.solved) n++;
  return n;
}
