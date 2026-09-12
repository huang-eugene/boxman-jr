/**
 * Terminal capability detection and the graphics fallback ladder.
 *
 * There are two independent axes and conflating them is a classic bug:
 *
 *   colour  - how many colours can we emit?
 *   glyphs  - will the half-block character U+2580 actually render?
 *
 * A legacy conhost window with a raster font supports colour perfectly well
 * and still draws U+2580 as garbage. That case cannot be detected reliably, so
 * we ask the user once and remember the answer.
 */

import os from 'node:os';

export type ColorMode = 'truecolor' | 'ansi256' | 'ansi16' | 'ascii';
export type GlyphMode = 'blocks' | 'ascii';

export interface Caps {
  color: ColorMode;
  glyphs: GlyphMode;
  /** True when we should offer the one-time half-block calibration. */
  needsCalibration: boolean;
}

export interface CapsOptions {
  /** --ascii */
  forceAscii?: boolean;
  /** --color=<mode> */
  forceColor?: ColorMode;
  /** --blocks=off */
  forceNoBlocks?: boolean;
  /** Persisted answer from a previous run, if any. */
  savedGlyphMode?: GlyphMode;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  platform?: NodeJS.Platform;
  release?: string;
}

/** Detect the colour mode. First match wins. */
export function detectColor(opts: CapsOptions = {}): ColorMode {
  const env = opts.env ?? process.env;
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);
  const platform = opts.platform ?? process.platform;

  if (opts.forceAscii) return 'ascii';
  // An explicit --color= is the user telling us what they want; it outranks
  // every heuristic below, including the TTY check. --selftest relies on this
  // so its output can be inspected through a pipe.
  if (opts.forceColor) return opts.forceColor;
  // NO_COLOR is honoured for any value, per the no-color.org convention.
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 'ascii';
  // Piped or redirected output must never contain escape sequences.
  if (!isTTY) return 'ascii';

  const colorterm = (env.COLORTERM ?? '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor';

  if (platform === 'win32') {
    // Windows Terminal always supports truecolor and sets this.
    if (env.WT_SESSION) return 'truecolor';
    // Windows 10 build 14931+ conhost understands 24-bit SGR. Node/libuv
    // enables VT processing on its own stdout handle at startup, so this
    // generally holds even in a legacy console window.
    const build = windowsBuild(opts.release ?? os.release());
    if (build >= 14931) return 'truecolor';
    return 'ansi16';
  }

  const term = (env.TERM ?? '').toLowerCase();
  if (term === 'dumb' || term === '') return 'ascii';
  if (term.includes('256color')) return 'ansi256';
  if (term.includes('truecolor') || term.includes('direct')) return 'truecolor';

  return 'ansi16';
}

/** Parse the build number out of an `os.release()` string like "10.0.19045". */
function windowsBuild(release: string): number {
  const parts = release.split('.');
  const major = Number(parts[0] ?? 0);
  if (!Number.isFinite(major) || major < 10) return 0;
  const build = Number(parts[2] ?? 0);
  return Number.isFinite(build) ? build : 0;
}

/**
 * Resolve full capabilities, including whether to run the one-time
 * half-block calibration prompt.
 */
export function detectCaps(opts: CapsOptions = {}): Caps {
  const color = detectColor(opts);
  const platform = opts.platform ?? process.platform;

  if (color === 'ascii' || opts.forceNoBlocks) {
    return { color, glyphs: 'ascii', needsCalibration: false };
  }

  if (opts.savedGlyphMode) {
    return { color, glyphs: opts.savedGlyphMode, needsCalibration: false };
  }

  // Only Windows has the raster-font problem worth asking about. Everywhere
  // else, a colour-capable terminal renders U+2580 correctly in practice.
  if (platform === 'win32') {
    return { color, glyphs: 'blocks', needsCalibration: true };
  }

  return { color, glyphs: 'blocks', needsCalibration: false };
}
