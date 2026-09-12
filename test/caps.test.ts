import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectColor, detectCaps } from '../src/render/caps.js';

const base = { isTTY: true, platform: 'linux' as NodeJS.Platform, env: {} };

describe('detectColor', () => {
  test('--ascii wins over everything', () => {
    assert.equal(
      detectColor({ ...base, forceAscii: true, env: { COLORTERM: 'truecolor' } }),
      'ascii',
    );
  });

  test('an explicit --color outranks the TTY check', () => {
    // --selftest depends on this: it must render through a pipe.
    assert.equal(
      detectColor({ ...base, isTTY: false, forceColor: 'truecolor' }),
      'truecolor',
    );
  });

  test('NO_COLOR disables colour', () => {
    assert.equal(detectColor({ ...base, env: { NO_COLOR: '1' } }), 'ascii');
    // An EMPTY NO_COLOR is not set, per the convention, so colour survives -
    // but TERM must be present, or the dumb-terminal rule catches it instead.
    assert.equal(
      detectColor({ ...base, env: { NO_COLOR: '', TERM: 'xterm' } }),
      'ansi16',
    );
  });

  test('non-TTY output is never coloured', () => {
    assert.equal(detectColor({ ...base, isTTY: false }), 'ascii');
  });

  test('COLORTERM=truecolor is honoured', () => {
    assert.equal(
      detectColor({ ...base, env: { COLORTERM: 'truecolor' } }),
      'truecolor',
    );
  });

  test('TERM=dumb falls back to ascii', () => {
    assert.equal(detectColor({ ...base, env: { TERM: 'dumb' } }), 'ascii');
  });

  test('256-colour terminals are detected', () => {
    assert.equal(
      detectColor({ ...base, env: { TERM: 'xterm-256color' } }),
      'ansi256',
    );
  });

  describe('windows', () => {
    const win = { ...base, platform: 'win32' as NodeJS.Platform };

    test('Windows Terminal gets truecolor', () => {
      assert.equal(
        detectColor({ ...win, env: { WT_SESSION: 'abc' }, release: '10.0.19045' }),
        'truecolor',
      );
    });

    test('modern Windows 10 conhost gets truecolor', () => {
      assert.equal(detectColor({ ...win, release: '10.0.19045' }), 'truecolor');
    });

    test('old Windows falls back to 16 colours', () => {
      assert.equal(detectColor({ ...win, release: '6.1.7601' }), 'ansi16');
    });
  });
});

describe('detectCaps', () => {
  test('offers calibration on Windows, but only once', () => {
    const win = { isTTY: true, platform: 'win32' as NodeJS.Platform, env: {}, release: '10.0.19045' };

    // First run: we do not know whether U+2580 renders, so we ask.
    assert.equal(detectCaps(win).needsCalibration, true);

    // Once answered, we never ask again.
    const saved = detectCaps({ ...win, savedGlyphMode: 'ascii' });
    assert.equal(saved.needsCalibration, false);
    assert.equal(saved.glyphs, 'ascii');
  });

  test('never asks for calibration on macOS or Linux', () => {
    assert.equal(
      detectCaps({ isTTY: true, platform: 'darwin', env: { COLORTERM: 'truecolor' } })
        .needsCalibration,
      false,
    );
  });

  test('ascii colour mode forces ascii glyphs', () => {
    const caps = detectCaps({ ...base, forceAscii: true });
    assert.equal(caps.glyphs, 'ascii');
    assert.equal(caps.needsCalibration, false);
  });

  test('--blocks=off keeps colour but drops half-blocks', () => {
    const caps = detectCaps({
      ...base,
      forceNoBlocks: true,
      env: { COLORTERM: 'truecolor' },
    });
    assert.equal(caps.color, 'truecolor');
    assert.equal(caps.glyphs, 'ascii');
  });
});
