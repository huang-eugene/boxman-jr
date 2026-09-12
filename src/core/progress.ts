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
  /** False when the player has turned the coach off. */
  coach?: boolean;
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
    result.settings = normaliseSettings(obj.settings as Record<string, unknown>);
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

const COLOR_MODES: ReadonlySet<string> = new Set([
  'auto',
  'truecolor',
  'ansi256',
  'ansi16',
  'ascii',
]);

const GLYPH_MODES: ReadonlySet<string> = new Set(['quadrant', 'blocks', 'ascii']);

/** Longest saved pack/level id we will carry back in. */
const MAX_ID = 200;

/**
 * Coerce the settings block, field by field.
 *
 * Spreading the saved object wholesale trusted a file on disk to contain only
 * the values we wrote. It is a plain JSON file in the user's data directory, so
 * a hand-edited (or malformed) one could put anything in any field.
 *
 * Today nothing here is printed - `glyphMode` is only ever compared against
 * literals - so a junk value degrades rendering rather than injecting anything.
 * That is a property of the current consumers, not of the data, and it is not
 * one a future caller should have to re-derive before printing a setting. The
 * enums are closed and small; validating them here makes the type honest.
 */
function normaliseSettings(raw: Record<string, unknown>): Settings {
  const settings: Settings = {};

  if (typeof raw.colorMode === 'string' && COLOR_MODES.has(raw.colorMode)) {
    settings.colorMode = raw.colorMode as Settings['colorMode'];
  }
  if (typeof raw.glyphMode === 'string' && GLYPH_MODES.has(raw.glyphMode)) {
    settings.glyphMode = raw.glyphMode as GlyphMode;
  }
  // Only an explicit `false` turns the coach off; anything else means "on",
  // which is what an absent setting already means.
  if (typeof raw.coach === 'boolean') settings.coach = raw.coach;

  // Resume pointers are matched against ids we loaded from packs, so a bad one
  // simply fails to match - but it is also drawn into no screen, and a string
  // is all we ever want back.
  if (typeof raw.lastPack === 'string') {
    settings.lastPack = raw.lastPack.slice(0, MAX_ID);
  }
  if (typeof raw.lastLevel === 'string') {
    settings.lastLevel = raw.lastLevel.slice(0, MAX_ID);
  }

  return settings;
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

/** Just enough of a level to locate its progress record. */
export interface LevelCursor {
  packId: string;
  levelId: string;
}

/** Keep the better half of each field when one puzzle has two records. */
function mergeRecords(
  into: LevelRecord | undefined,
  from: LevelRecord,
): LevelRecord {
  if (into === undefined) return from;

  const best = (a?: number, b?: number): number | undefined =>
    a === undefined ? b : b === undefined ? a : Math.min(a, b);

  return {
    solved: into.solved || from.solved,
    ...(best(into.bestMoves, from.bestMoves) !== undefined
      ? { bestMoves: best(into.bestMoves, from.bestMoves) }
      : {}),
    ...(best(into.bestPushes, from.bestPushes) !== undefined
      ? { bestPushes: best(into.bestPushes, from.bestPushes) }
      : {}),
    ...(into.skipped || from.skipped ? { skipped: true } : {}),
  };
}

/**
 * Move saved records to the pack that now holds their level.
 *
 * Records are keyed by (packId, levelId), which is what lets a level be
 * inserted anywhere in a pack without scrambling anything. What it does NOT
 * survive on its own is a level moving BETWEEN packs - and that happens for a
 * good reason: the packs are difficulty tiers cut from one measured curve, so
 * adding new puzzles re-cuts the boundaries and a level can land a tier either
 * side of where it was. Without this, a child who had solved forty puzzles
 * would come back to find half of them unsolved again.
 *
 * Level ids are the durable identity, so they are what we follow. A level id
 * that appears in more than one loaded pack is not followed at all: that only
 * happens with a hand-made `--levels` pack that reuses a bundled id, and
 * guessing which puzzle the record belongs to would be worse than leaving it
 * where it is. Records whose level id is nowhere in the loaded packs are left
 * untouched too - the player may simply be running with `--levels` today, and
 * their bundled progress must still be there tomorrow.
 *
 * Returns true if anything moved, so the caller knows to save.
 */
export function reconcile(
  progress: Progress,
  cursors: readonly LevelCursor[],
): boolean {
  // Where each level id lives now; null means "in more than one pack".
  const home = new Map<string, string | null>();
  for (const c of cursors) {
    home.set(c.levelId, home.has(c.levelId) ? null : c.packId);
  }

  let changed = false;

  // Object.entries snapshots, so a pack created below is not re-scanned - which
  // is what stops a record being moved twice in one pass.
  for (const [packId, pack] of Object.entries(progress.packs)) {
    for (const [levelId, record] of Object.entries(pack.levels)) {
      const now = home.get(levelId);
      if (now === undefined || now === null || now === packId) continue;

      const target = (progress.packs[now] ??= { levels: {} });
      target.levels[levelId] = mergeRecords(target.levels[levelId], record);
      delete pack.levels[levelId];
      changed = true;
    }
  }

  // A pack emptied by the moves above is a pack that no longer exists.
  for (const [packId, pack] of Object.entries(progress.packs)) {
    if (Object.keys(pack.levels).length === 0) {
      delete progress.packs[packId];
      changed = true;
    }
  }

  // The resume pointer names a pack too, and a stale one would send the player
  // back to the title screen's "carry on" with nothing behind it.
  const { lastLevel, lastPack } = progress.settings;
  if (lastLevel !== undefined) {
    const now = home.get(lastLevel);
    if (now !== undefined && now !== null && now !== lastPack) {
      progress.settings.lastPack = now;
      changed = true;
    }
  }

  return changed;
}

/**
 * Decide which level to open the game on.
 *
 * The rule that matters: this must agree with what the title screen tells the
 * player. "You have solved 3 puzzles" followed by landing on puzzle 12 reads as
 * a bug, because it is one - the old behaviour resumed at the last level
 * *visited*, so one trip through the level menu (or one "try a different
 * puzzle") stranded the player miles ahead of their progress, permanently.
 *
 * So we resume at the next puzzle they have yet to beat, in pack order:
 *
 *   1. The first puzzle they have neither solved nor skipped.
 *   2. Otherwise the first they have not solved - a skipped one, offered again
 *      now they have more of the game behind them.
 *   3. Otherwise (everything solved) wherever they were, so replaying works.
 *
 * Note there is deliberately no "carry on exactly where you left off" rule.
 * In the ordinary run of play it makes no difference - the puzzle you are part
 * way through IS the first one you have not solved - and the only time it
 * differs is when the player jumped somewhere out of order, which is precisely
 * the case that used to strand them. A jump is a choice for the session they
 * made it in; the level menu is one keypress away when they want it again.
 */
export function resumeIndex(
  cursors: readonly LevelCursor[],
  progress: Progress,
): number {
  if (cursors.length === 0) return 0;

  const rec = (i: number): LevelRecord | undefined =>
    getRecord(progress, cursors[i].packId, cursors[i].levelId);

  // 1. The next genuinely new puzzle.
  const fresh = cursors.findIndex(
    (_, i) => rec(i)?.solved !== true && rec(i)?.skipped !== true,
  );
  if (fresh !== -1) return fresh;

  // 2. Nothing new left, but something was skipped - have another go at it.
  const unsolved = cursors.findIndex((_, i) => rec(i)?.solved !== true);
  if (unsolved !== -1) return unsolved;

  // 3. All done. Stay where they were so replaying a favourite works.
  const saved = cursors.findIndex(
    (c) =>
      c.packId === progress.settings.lastPack &&
      c.levelId === progress.settings.lastLevel,
  );
  return saved !== -1 ? saved : cursors.length - 1;
}
