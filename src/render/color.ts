/**
 * Colour emission across the fallback ladder.
 *
 * Every renderer asks for an RGB triple; this module downgrades it to whatever
 * the terminal actually supports, so callers never branch on colour mode.
 */

import type { ColorMode } from './caps.js';

export type RGB = readonly [r: number, g: number, b: number];

const ESC = '\x1b';

/** The 16 basic ANSI colours as RGB, for nearest-match downgrading. */
const BASIC: ReadonlyArray<RGB> = [
  [0, 0, 0],
  [170, 0, 0],
  [0, 170, 0],
  [170, 85, 0],
  [0, 0, 170],
  [170, 0, 170],
  [0, 170, 170],
  [170, 170, 170],
  [85, 85, 85],
  [255, 85, 85],
  [85, 255, 85],
  [255, 255, 85],
  [85, 85, 255],
  [255, 85, 255],
  [85, 255, 255],
  [255, 255, 255],
];

function nearestBasic(rgb: RGB): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < BASIC.length; i++) {
    const c = BASIC[i];
    const d =
      (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Map an RGB triple into the xterm-256 cube. */
function to256(rgb: RGB): number {
  const [r, g, b] = rgb;
  // Greyscale ramp gives noticeably better results for near-grey colours.
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    const grey = Math.round((r + g + b) / 3);
    if (grey < 8) return 16;
    if (grey > 248) return 231;
    return 232 + Math.round(((grey - 8) / 247) * 23);
  }
  const q = (v: number): number => Math.round((v / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

/** Foreground SGR sequence for `rgb` under `mode`. */
export function fg(rgb: RGB, mode: ColorMode): string {
  switch (mode) {
    case 'truecolor':
      return `${ESC}[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
    case 'ansi256':
      return `${ESC}[38;5;${to256(rgb)}m`;
    case 'ansi16': {
      const i = nearestBasic(rgb);
      return i < 8 ? `${ESC}[${30 + i}m` : `${ESC}[${90 + i - 8}m`;
    }
    default:
      return '';
  }
}

/** Background SGR sequence for `rgb` under `mode`. */
export function bg(rgb: RGB, mode: ColorMode): string {
  switch (mode) {
    case 'truecolor':
      return `${ESC}[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
    case 'ansi256':
      return `${ESC}[48;5;${to256(rgb)}m`;
    case 'ansi16': {
      const i = nearestBasic(rgb);
      return i < 8 ? `${ESC}[${40 + i}m` : `${ESC}[${100 + i - 8}m`;
    }
    default:
      return '';
  }
}

export const RESET = `${ESC}[0m`;
export const BOLD = `${ESC}[1m`;
export const DIM = `${ESC}[2m`;

/** Wrap `text` in a foreground colour, resetting afterwards. */
export function paint(text: string, rgb: RGB, mode: ColorMode): string {
  if (mode === 'ascii') return text;
  return fg(rgb, mode) + text + RESET;
}
