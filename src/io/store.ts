/**
 * Progress file persistence.
 *
 * Two properties matter:
 *   - Atomic writes, so a crash or a closed laptop lid can never leave a
 *     half-written save file.
 *   - Never crash on a bad file. If the save is corrupt we set it aside and
 *     start fresh rather than showing a child a stack trace.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emptyProgress,
  normalise,
  PROGRESS_SCHEMA_VERSION,
  type Progress,
} from '../core/progress.js';

const APP_DIR = 'boxman-jr';

/** Platform-appropriate data directory. */
export function dataDir(): string {
  const env = process.env;

  if (process.platform === 'win32') {
    const base = env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, APP_DIR);
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_DIR);
  }

  const base = env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
  return path.join(base, APP_DIR);
}

export function progressPath(): string {
  return path.join(dataDir(), 'progress.json');
}

export interface LoadResult {
  progress: Progress;
  /** Set when we had to quarantine a corrupt file, for a gentle message. */
  recoveredFrom?: string;
}

/** Read progress from disk, recovering gracefully from anything unexpected. */
export function loadProgress(): LoadResult {
  const file = progressPath();

  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    // No file yet - a first run. Perfectly normal.
    return { progress: emptyProgress() };
  }

  try {
    const raw = JSON.parse(text);
    const progress = normalise(raw);

    // A file from a future version we don't understand gets quarantined too,
    // rather than being silently mangled.
    if (
      typeof raw?.schemaVersion === 'number' &&
      raw.schemaVersion > PROGRESS_SCHEMA_VERSION
    ) {
      return { progress: emptyProgress(), recoveredFrom: quarantine(file) };
    }

    return { progress };
  } catch {
    return { progress: emptyProgress(), recoveredFrom: quarantine(file) };
  }
}

/** Move a bad save file aside so we never overwrite data we didn't understand. */
function quarantine(file: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = file.replace(/\.json$/, `.corrupt-${stamp}.json`);
  try {
    fs.renameSync(file, target);
    return target;
  } catch {
    return file;
  }
}

/**
 * Write progress atomically: write a temp file in the same directory, flush it,
 * then rename over the target. Same-directory rename is atomic on both NTFS
 * and APFS, so readers never observe a partial file.
 */
export function saveProgress(progress: Progress): void {
  const dir = dataDir();
  const file = progressPath();
  const tmp = `${file}.tmp`;

  try {
    fs.mkdirSync(dir, { recursive: true });
    const text = JSON.stringify(progress, null, 2);

    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    fs.renameSync(tmp, file);
  } catch {
    // Saving is best-effort. A read-only home directory or a full disk must
    // not stop the game being playable.
  }
}
