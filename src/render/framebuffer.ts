/**
 * Half-block pixel framebuffer.
 *
 * The trick: a terminal cell is about twice as tall as it is wide. By printing
 * the upper-half-block character U+2580 with a foreground colour for the top
 * half and a background colour for the bottom half, one cell renders TWO
 * square pixels stacked vertically. An N-pixel-wide sprite therefore occupies
 * N columns and N/2 rows, and looks like real pixel art rather than ASCII.
 *
 * Emission coalesces SGR sequences: we only write a colour escape when the
 * (fg,bg) pair actually changes. Naive per-cell emission is roughly 17x larger,
 * which matters a great deal on PowerShell, whose console write path is slow.
 *
 * There is a second scheme here too: QUADRANT blocks (U+2596-U+259F) put a 2x2
 * pixel grid in one cell, so a tile of N pixels costs N/2 columns and N/2 rows
 * instead of N and N/2. Raising N alongside it keeps tiles square while halving
 * the board's width - which is the only way to get a smaller board AND more
 * pixels, since rows are what bind the tile size.
 *
 * The cost of quadrants is that a cell still carries only two colours while a
 * 2x2 block may hold four, so each cell is reduced to two clusters (see
 * `quadCell`). On this art - a small, flat, hand-authored palette - that is
 * near-lossless.
 */

import type { ColorMode } from './caps.js';
import { bg, fg, RESET, type RGB } from './color.js';

const UPPER_HALF = '▀';

/**
 * Quadrant glyphs indexed by a 4-bit mask of which sub-pixels take the
 * FOREGROUND colour: bit 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
 *
 * Index 0 (nothing in fg) and 15 (everything in fg) both render as a solid
 * cell; we emit a space on 0 so the background colour alone fills it.
 */
const QUADRANTS: readonly string[] = [
  ' ', // 0000
  '▘', // 0001 TL
  '▝', // 0010 TR
  '▀', // 0011 TL+TR
  '▖', // 0100 BL
  '▌', // 0101 TL+BL
  '▞', // 0110 TR+BL
  '▛', // 0111 TL+TR+BL
  '▗', // 1000 BR
  '▚', // 1001 TL+BR
  '▐', // 1010 TR+BR
  '▜', // 1011 TL+TR+BR
  '▄', // 1100 BL+BR
  '▙', // 1101 TL+BL+BR
  '▟', // 1110 TR+BL+BR
  '█', // 1111 all
];

/** Squared RGB distance. Cheap, and good enough for a flat palette. */
function dist2(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function sameRGB(a: RGB, b: RGB): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Reduce four pixels to (fg, bg, glyph).
 *
 * Picks the two most frequent distinct colours as the cluster centres, then
 * assigns every pixel to the nearer of the two. With <= 2 distinct colours this
 * is exact; with 3 or 4 it is the closest two-colour approximation available,
 * which is all a terminal cell can represent.
 */
export function quadCell(
  tl: RGB,
  tr: RGB,
  bl: RGB,
  br: RGB,
): { fg: RGB; bg: RGB; glyph: string } {
  const px: RGB[] = [tl, tr, bl, br];

  // Tally distinct colours, most frequent first.
  const groups: Array<{ rgb: RGB; n: number }> = [];
  for (const p of px) {
    const hit = groups.find((g) => sameRGB(g.rgb, p));
    if (hit) hit.n++;
    else groups.push({ rgb: p, n: 1 });
  }

  if (groups.length === 1) {
    // Flat cell - the common case on floors and wall interiors.
    return { fg: groups[0].rgb, bg: groups[0].rgb, glyph: ' ' };
  }

  groups.sort((a, b) => b.n - a.n);
  const fg = groups[0].rgb;
  const bg = groups[1].rgb;

  let mask = 0;
  for (let i = 0; i < 4; i++) {
    // Nearer to fg than bg wins the bit. Ties go to fg, which keeps flat
    // two-colour cells exact.
    if (dist2(px[i], fg) <= dist2(px[i], bg)) mask |= 1 << i;
  }

  return { fg, bg, glyph: QUADRANTS[mask] };
}

/**
 * A grid of RGB pixels. Height is always even so it maps cleanly onto whole
 * character rows.
 */
export class Framebuffer {
  readonly width: number;
  readonly height: number;
  /** Flat RGB triples: pixel i occupies data[i*3 .. i*3+2]. */
  private readonly data: Uint8Array;

  constructor(width: number, height: number, clear: RGB = [0, 0, 0]) {
    this.width = width;
    // Round up to an even number of pixel rows: half a character row cannot
    // be drawn.
    this.height = height % 2 === 0 ? height : height + 1;
    this.data = new Uint8Array(this.width * this.height * 3);
    this.fill(clear);
  }

  fill(rgb: RGB): void {
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = rgb[0];
      this.data[i + 1] = rgb[1];
      this.data[i + 2] = rgb[2];
    }
  }

  set(x: number, y: number, rgb: RGB): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.data[i] = rgb[0];
    this.data[i + 1] = rgb[1];
    this.data[i + 2] = rgb[2];
  }

  get(x: number, y: number): RGB {
    const i = (y * this.width + x) * 3;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  /** Fill an axis-aligned rectangle. */
  rect(x0: number, y0: number, w: number, h: number, rgb: RGB): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) this.set(x, y, rgb);
    }
  }

  /** Number of character rows this framebuffer occupies. */
  get charRows(): number {
    return this.height / 2;
  }

  /**
   * Convert one character row to a string of coloured half-blocks.
   *
   * Row `r` uses pixel row 2r as the foreground (top half) and 2r+1 as the
   * background (bottom half).
   */
  renderRow(r: number, mode: ColorMode): string {
    if (mode === 'ascii') return '';

    const topY = r * 2;
    const botY = topY + 1;
    let outStr = '';
    let lastFg = '';
    let lastBg = '';

    for (let x = 0; x < this.width; x++) {
      const top = this.get(x, topY);
      const bot = this.get(x, botY);
      const fgSeq = fg(top, mode);
      const bgSeq = bg(bot, mode);

      // Coalesce: skip the escape when the colour is unchanged from the
      // previous cell. This is where the ~94% output saving comes from.
      if (fgSeq !== lastFg) {
        outStr += fgSeq;
        lastFg = fgSeq;
      }
      if (bgSeq !== lastBg) {
        outStr += bgSeq;
        lastBg = bgSeq;
      }
      outStr += UPPER_HALF;
    }

    return outStr + RESET;
  }

  /** Render every character row. */
  renderRows(mode: ColorMode): string[] {
    const rows: string[] = [];
    for (let r = 0; r < this.charRows; r++) rows.push(this.renderRow(r, mode));
    return rows;
  }

  /** Character columns this framebuffer occupies under quadrant rendering. */
  get quadCols(): number {
    return Math.ceil(this.width / 2);
  }

  /**
   * Convert one character row to quadrant blocks.
   *
   * Row `r` covers pixel rows 2r and 2r+1; cell `x` covers pixel columns 2x and
   * 2x+1. An odd width duplicates the last column rather than reading out of
   * bounds, so the edge pixel stays its own colour instead of going black.
   */
  renderQuadRow(r: number, mode: ColorMode): string {
    if (mode === 'ascii') return '';

    const topY = r * 2;
    const botY = topY + 1;
    let outStr = '';
    let lastFg = '';
    let lastBg = '';

    for (let x = 0; x < this.quadCols; x++) {
      const xa = x * 2;
      const xb = Math.min(xa + 1, this.width - 1);

      const { fg: f, bg: b, glyph } = quadCell(
        this.get(xa, topY),
        this.get(xb, topY),
        this.get(xa, botY),
        this.get(xb, botY),
      );

      const fgSeq = fg(f, mode);
      const bgSeq = bg(b, mode);

      if (fgSeq !== lastFg) {
        outStr += fgSeq;
        lastFg = fgSeq;
      }
      if (bgSeq !== lastBg) {
        outStr += bgSeq;
        lastBg = bgSeq;
      }
      outStr += glyph;
    }

    return outStr + RESET;
  }

  /** Render every character row as quadrant blocks. */
  renderQuadRows(mode: ColorMode): string[] {
    const rows: string[] = [];
    for (let r = 0; r < this.charRows; r++) {
      rows.push(this.renderQuadRow(r, mode));
    }
    return rows;
  }
}
