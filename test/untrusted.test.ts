/**
 * Hostile-input regression tests.
 *
 * A level pack is data from outside the program. `--levels=DIR` is an
 * advertised feature, so packs routinely come from somewhere we did not write,
 * and the progress file is plain JSON a user can edit by hand. Both are drawn
 * to a terminal, which treats control bytes as INSTRUCTIONS rather than text.
 *
 * These tests pin the three boundaries that stand between a hostile pack and
 * the user's terminal. They are written against the behaviour that matters -
 * "no escape byte reaches the screen" - rather than against the particular
 * regex that currently implements it, so a future rewrite of the sanitiser is
 * free to change shape without rewriting the tests.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPacks } from '../src/io/packs.js';
import { normalise } from '../src/core/progress.js';

const ESC = '\x1b';
const BEL = '\x07';

/** A minimal valid level, so parsing never fails for unrelated reasons. */
const LEVEL = ['#####', '#@$.#', '#####'].join('\n');

/**
 * Build a throwaway pack directory. Returns its root; the caller is handed a
 * fresh temp dir each time so tests never interfere with one another.
 */
function makePack(manifest: unknown, files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boxman-test-'));
  const dir = path.join(root, 'pack');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'lvl.sok'), LEVEL);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), body);
  }
  return root;
}

describe('untrusted pack metadata', () => {
  test('strips terminal escapes from every displayed string', () => {
    const root = makePack({
      schemaVersion: 1,
      id: 'evil',
      name: `${ESC}]0;HIJACK${BEL}Name`,
      author: `${ESC}[31mAuthor`,
      attribution: `${ESC}]0;HIJACK${BEL}Credit`,
      order: 1,
      levels: [{ id: 'e1', file: 'lvl.sok', title: `${ESC}]0;PWNED${BEL}Title${ESC}[2J` }],
    });

    const [pack] = loadPacks(root);
    const displayed = [
      pack.manifest.name,
      pack.manifest.author ?? '',
      pack.manifest.attribution ?? '',
      pack.levels[0].title,
    ];

    for (const s of displayed) {
      // The property that matters: no control byte survives to the screen.
      assert.ok(
        !/[\u0000-\u001f\u007f-\u009f]/.test(s),
        `control character survived in ${JSON.stringify(s)}`,
      );
    }

    // The readable text is kept - we sanitise, we do not blank the pack out.
    assert.match(pack.levels[0].title, /Title/);
    assert.match(pack.manifest.attribution ?? '', /Credit/);
  });

  test('caps absurdly long display strings', () => {
    const root = makePack({
      schemaVersion: 1,
      id: 'long',
      name: 'n'.repeat(10_000),
      order: 1,
      levels: [{ id: 'l1', file: 'lvl.sok', title: 't'.repeat(10_000) }],
    });

    const [pack] = loadPacks(root);
    assert.ok(pack.manifest.name.length <= 200);
    assert.ok(pack.levels[0].title.length <= 200);
  });

  test('ids that collide only after stripping are still caught', () => {
    // Both ids clean to "dup". Checking the raw values would let this through
    // and silently point two levels at one progress record.
    const root = makePack({
      schemaVersion: 1,
      id: 'dup-pack',
      order: 1,
      levels: [
        { id: 'dup', file: 'lvl.sok', title: 'A' },
        { id: `dup${ESC}`, file: 'lvl.sok', title: 'B' },
      ],
    });

    assert.throws(() => loadPacks(root), /duplicate level id/);
  });

  test('a pack cannot read files outside its own directory', () => {
    const root = makePack(
      {
        schemaVersion: 1,
        id: 'trav',
        order: 1,
        levels: [{ id: 't1', file: '../secret.txt', title: 'T' }],
      },
      { 'secret.txt': 'CANARY' },
    );

    assert.throws(() => loadPacks(root), /outside its pack directory/);
  });

  test('an absolute path is refused too', () => {
    const root = makePack({
      schemaVersion: 1,
      id: 'abs',
      order: 1,
      levels: [{ id: 'a1', file: '/etc/hosts', title: 'A' }],
    });

    assert.throws(() => loadPacks(root), /outside its pack directory/);
  });

  test('ordinary packs still load unchanged', () => {
    const root = makePack({
      schemaVersion: 1,
      id: 'good',
      name: 'Good Pack',
      attribution: 'By someone, with credit.',
      order: 1,
      levels: [{ id: 'g1', file: 'lvl.sok', title: 'First Steps' }],
    });

    const [pack] = loadPacks(root);
    assert.equal(pack.manifest.name, 'Good Pack');
    assert.equal(pack.manifest.attribution, 'By someone, with credit.');
    assert.equal(pack.levels[0].title, 'First Steps');
  });
});

describe('untrusted progress file', () => {
  test('rejects settings values outside their known enums', () => {
    const p = normalise({
      settings: {
        glyphMode: `${ESC}]0;pwn`,
        colorMode: 'bogus',
        coach: 'not-a-boolean',
        unknownKey: { nested: true },
      },
    });

    assert.equal(p.settings.glyphMode, undefined);
    assert.equal(p.settings.colorMode, undefined);
    assert.equal(p.settings.coach, undefined);
    assert.ok(!('unknownKey' in p.settings));
  });

  test('keeps valid settings', () => {
    const p = normalise({
      settings: {
        glyphMode: 'quadrant',
        colorMode: 'ansi256',
        coach: false,
        lastPack: 'microban1',
        lastLevel: 'm001',
      },
    });

    assert.equal(p.settings.glyphMode, 'quadrant');
    assert.equal(p.settings.colorMode, 'ansi256');
    assert.equal(p.settings.coach, false);
    assert.equal(p.settings.lastPack, 'microban1');
  });

  test('bounds the resume pointers', () => {
    const p = normalise({ settings: { lastPack: 'x'.repeat(10_000) } });
    assert.ok((p.settings.lastPack ?? '').length <= 200);
  });

  test('__proto__ in a saved file never reaches Object.prototype', () => {
    // JSON.parse makes __proto__ an own property, and the normaliser's
    // assignments keep it own - but this is exactly the kind of property that
    // a refactor can quietly lose, so it is pinned.
    const probe = {} as Record<string, unknown>;

    normalise(JSON.parse('{"__proto__":{"polluted":1}}'));
    normalise(JSON.parse('{"settings":{"__proto__":{"polluted":1}}}'));
    normalise(JSON.parse('{"packs":{"__proto__":{"levels":{"a":{"solved":true}}}}}'));
    normalise(
      JSON.parse('{"packs":{"p":{"levels":{"__proto__":{"solved":true}}}}}'),
    );

    assert.equal(probe.polluted, undefined);
    assert.equal(({} as Record<string, unknown>).solved, undefined);
  });
});
