import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Framebuffer } from '../src/render/framebuffer.js';
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
