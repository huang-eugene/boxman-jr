import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '../src/io/keys.js';

const names = (s: string): string[] => decode(s).keys.map((k) => k.name);

describe('decode', () => {
  test('reads CSI arrow keys', () => {
    assert.deepEqual(names('\x1b[A\x1b[B\x1b[C\x1b[D'), [
      'up',
      'down',
      'right',
      'left',
    ]);
  });

  test('reads SS3 arrow keys', () => {
    // Some terminals use ESC O A instead of ESC [ A.
    assert.deepEqual(names('\x1bOA\x1bOB'), ['up', 'down']);
  });

  test('reads WASD', () => {
    assert.deepEqual(names('wasd'), ['up', 'left', 'down', 'right']);
  });

  test('accepts both backspace encodings as undo', () => {
    // PowerShell sends \x08; most Unix terminals send \x7f. Both must work,
    // because backspace is bound to undo and undo is the safety net.
    assert.deepEqual(names('\x7f'), ['undo']);
    assert.deepEqual(names('\x08'), ['undo']);
    assert.deepEqual(names('u'), ['undo']);
  });

  test('reads control keys', () => {
    assert.deepEqual(names('r'), ['restart']);
    assert.deepEqual(names('q'), ['quit']);
    assert.deepEqual(names('\x03'), ['quit']);
    assert.deepEqual(names('\r'), ['enter']);
    assert.deepEqual(names(' '), ['space']);
  });

  test('holds back a trailing lone ESC as incomplete', () => {
    // It might be the Escape key, or the first byte of a split arrow sequence.
    const r = decode('\x1b');
    assert.deepEqual(r.keys, []);
    assert.equal(r.rest, '\x1b');
  });

  test('holds back a partial escape sequence', () => {
    const r = decode('\x1b[');
    assert.deepEqual(r.keys, []);
    assert.equal(r.rest, '\x1b[');
  });

  test('reassembles an arrow split across two reads', () => {
    const first = decode('w\x1b[');
    assert.deepEqual(first.keys.map((k) => k.name), ['up']);
    const second = decode(first.rest + 'A');
    assert.deepEqual(second.keys.map((k) => k.name), ['up']);
  });

  test('treats ESC followed by a normal key as the Escape key', () => {
    assert.deepEqual(names('\x1bw'), ['escape', 'up']);
  });

  test('is case-insensitive', () => {
    assert.deepEqual(names('WASDURQ'), [
      'up', 'left', 'down', 'right', 'undo', 'restart', 'quit',
    ]);
  });
});
