import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Framebuffer, quadCell } from '../src/render/framebuffer.js';
import type { RGB } from '../src/render/color.js';

/** Decode a rendered row back into its (fg,bg) pairs. */
function decode(row: string): Array<{ fg: RGB | null; bg: RGB | null }> {
  const cells: Array<{ fg: RGB | null; bg: RGB | null }> = [];
  let fg: RGB | null = null;
  let bg: RGB | null = null;

  const re = /\x1b\[(3|4)8;2;(\d+);(\d+);(\d+)m|\x1b\[0m|▀/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(row)) !== null) {
    if (m[0] === '▀') {
      cells.push({ fg, bg });
    } else if (m[1] === '3') {
      fg = [Number(m[2]), Number(m[3]), Number(m[4])];
    } else if (m[1] === '4') {
      bg = [Number(m[2]), Number(m[3]), Number(m[4])];
    }
  }
  return cells;
}

describe('Framebuffer', () => {
  test('rounds an odd pixel height up to whole character rows', () => {
    const fb = new Framebuffer(4, 5);
    assert.equal(fb.height, 6);
    assert.equal(fb.charRows, 3);
  });

  test('round-trips pixels through the rendered ANSI', () => {
    const fb = new Framebuffer(4, 2, [0, 0, 0]);
    const red: RGB = [255, 0, 0];
    const blue: RGB = [0, 0, 255];
    fb.set(0, 0, red); // top half of cell 0
    fb.set(0, 1, blue); // bottom half of cell 0

    const cells = decode(fb.renderRow(0, 'truecolor'));
    assert.equal(cells.length, 4);
    assert.deepEqual(cells[0].fg, [...red]);
    assert.deepEqual(cells[0].bg, [...blue]);
  });

  test('coalesces repeated colours into a single escape', () => {
    const fb = new Framebuffer(20, 2, [10, 20, 30]);
    const row = fb.renderRow(0, 'truecolor');

    // Twenty identical cells must emit one fg and one bg escape, not twenty.
    const escapes = row.match(/\x1b\[[34]8;2;[\d;]+m/g) ?? [];
    assert.equal(escapes.length, 2, `expected 2 escapes, got ${escapes.length}`);
    assert.equal((row.match(/▀/g) ?? []).length, 20);
  });

  test('emits nothing in ascii mode', () => {
    const fb = new Framebuffer(4, 2);
    assert.equal(fb.renderRow(0, 'ascii'), '');
  });

  test('ignores out-of-bounds writes instead of throwing', () => {
    const fb = new Framebuffer(4, 2);
    assert.doesNotThrow(() => {
      fb.set(-1, 0, [1, 2, 3]);
      fb.set(99, 99, [1, 2, 3]);
    });
  });
});

/** Decode a quadrant row into its (glyph, fg, bg) triples. */
function decodeQuad(
  row: string,
): Array<{ glyph: string; fg: RGB | null; bg: RGB | null }> {
  const cells: Array<{ glyph: string; fg: RGB | null; bg: RGB | null }> = [];
  let fg: RGB | null = null;
  let bg: RGB | null = null;

  const re = /\x1b\[(3|4)8;2;(\d+);(\d+);(\d+)m|\x1b\[0m|([ ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(row)) !== null) {
    if (m[5] !== undefined) {
      cells.push({ glyph: m[5], fg, bg });
    } else if (m[1] === '3') {
      fg = [Number(m[2]), Number(m[3]), Number(m[4])];
    } else if (m[1] === '4') {
      bg = [Number(m[2]), Number(m[3]), Number(m[4])];
    }
  }
  return cells;
}

describe('quadCell', () => {
  const R: RGB = [255, 0, 0];
  const B: RGB = [0, 0, 255];
  const G: RGB = [0, 255, 0];

  test('a flat block renders as one solid cell', () => {
    const { glyph, fg, bg } = quadCell(R, R, R, R);
    assert.equal(glyph, ' ');
    // Both halves the same colour means the cell is that colour either way.
    assert.deepEqual(fg, [...R]);
    assert.deepEqual(bg, [...R]);
  });

  test('a split block picks the glyph matching the pixel layout', () => {
    // Top half red, bottom half blue -> upper half block.
    assert.equal(quadCell(R, R, B, B).glyph, '▀');
    // Left half red, right half blue -> left half block.
    assert.equal(quadCell(R, B, R, B).glyph, '▌');
    // Diagonal.
    assert.equal(quadCell(R, B, B, R).glyph, '▚');
  });

  test('two colours round-trip exactly', () => {
    const { fg, bg } = quadCell(R, R, B, B);
    const pair = [fg, bg].map((c) => c.join(','));
    assert.ok(pair.includes(R.join(',')), 'red survives');
    assert.ok(pair.includes(B.join(',')), 'blue survives');
  });

  test('three colours reduce to the two most frequent', () => {
    // Red appears twice, blue and green once each: red must be one of the two.
    const { fg, bg } = quadCell(R, R, B, G);
    const pair = [fg, bg].map((c) => c.join(','));
    assert.ok(pair.includes(R.join(',')), 'the majority colour is kept');
    assert.equal(new Set(pair).size, 2, 'exactly two colours are emitted');
  });
});

describe('Framebuffer quadrant rendering', () => {
  test('halves the column count versus half-blocks', () => {
    const fb = new Framebuffer(16, 4);
    assert.equal(fb.width, 16, 'half-block cost is one cell per pixel column');
    assert.equal(fb.quadCols, 8, 'quadrant cost is half that');
    // Rows are unchanged: both schemes stack two pixels per cell vertically.
    assert.equal(fb.charRows, 2);
  });

  test('renders one cell per two pixel columns', () => {
    const fb = new Framebuffer(4, 2, [0, 0, 0]);
    const cells = decodeQuad(fb.renderQuadRow(0, 'truecolor'));
    assert.equal(cells.length, 2);
  });

  test('round-trips a two-colour block through the rendered ANSI', () => {
    const red: RGB = [255, 0, 0];
    const blue: RGB = [0, 0, 255];
    const fb = new Framebuffer(2, 2, blue);
    fb.set(0, 0, red);
    fb.set(1, 0, red); // top row red, bottom row blue

    const cells = decodeQuad(fb.renderQuadRow(0, 'truecolor'));
    assert.equal(cells.length, 1);
    assert.equal(cells[0].glyph, '▀');
    assert.deepEqual(cells[0].fg, [...red]);
    assert.deepEqual(cells[0].bg, [...blue]);
  });

  test('coalesces repeated colours into a single escape', () => {
    const fb = new Framebuffer(40, 2, [10, 20, 30]);
    const row = fb.renderQuadRow(0, 'truecolor');

    const escapes = row.match(/\x1b\[[34]8;2;[\d;]+m/g) ?? [];
    assert.equal(escapes.length, 2, `expected 2 escapes, got ${escapes.length}`);
    assert.equal((row.match(/ /g) ?? []).length, 20, '40 pixels -> 20 cells');
  });

  test('an odd pixel width duplicates the last column rather than reading black', () => {
    const red: RGB = [255, 0, 0];
    const fb = new Framebuffer(3, 2, red);
    const cells = decodeQuad(fb.renderQuadRow(0, 'truecolor'));
    assert.equal(cells.length, 2, '3 pixels round up to 2 cells');
    // The final cell is entirely red, not half red and half uninitialised.
    assert.equal(cells[1].glyph, ' ');
    assert.deepEqual(cells[1].bg, [...red]);
  });

  test('emits nothing in ascii mode', () => {
    const fb = new Framebuffer(4, 2);
    assert.equal(fb.renderQuadRow(0, 'ascii'), '');
  });
});
