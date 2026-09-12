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
 */

import type { ColorMode } from './caps.js';
import { bg, fg, RESET, type RGB } from './color.js';

const UPPER_HALF = '▀';

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
}
