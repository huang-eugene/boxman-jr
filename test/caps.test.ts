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

  test('a missing TERM on a real TTY still gets colour', () => {
    // TERM=dumb is a terminal saying it cannot do this; an unset TERM is just a
    // thin environment. Dropping to plain text over a missing variable is the
    // loudest possible downgrade for the weakest possible reason.
    assert.equal(detectColor({ ...base, env: {} }), 'ansi16');
  });

  test('--pixel-art overrides a terminal we guessed too low', () => {
    assert.equal(detectColor({ ...base, forceBlocks: true, env: {} }), 'ansi256');
    assert.equal(
      detectColor({ ...base, forceBlocks: true, env: { COLORTERM: 'truecolor' } }),
      'truecolor',
    );
  });

  test('--pixel-art still respects NO_COLOR', () => {
    // NO_COLOR is a deliberate, standardised instruction, not a guess of ours.
    assert.equal(
      detectColor({ ...base, forceBlocks: true, env: { NO_COLOR: '1' } }),
      'ascii',
    );
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

  /**
   * The escape hatch. A remembered "ascii" used to be a one-way door: the game
   * wrote its own detected glyph mode back to settings on every save, so a
   * single --ascii run, a piped stdout or a NO_COLOR shell left the player in
   * plain text for good, with only --reset-progress - which also wipes every
   * solved puzzle - to get out.
   */
  test('--pixel-art overrules a remembered "ascii" answer', () => {
    const caps = detectCaps({
      ...base,
      forceBlocks: true,
      savedGlyphMode: 'ascii',
      env: { COLORTERM: 'truecolor' },
    });
    // Pixel art means the best pixel renderer we have, which is quadrant.
    assert.equal(caps.glyphs, 'quadrant');
    assert.equal(caps.needsCalibration, false);
  });

  test('a colour-capable terminal defaults to quadrant blocks', () => {
    const caps = detectCaps({
      isTTY: true,
      platform: 'darwin',
      env: { COLORTERM: 'truecolor' },
    });
    assert.equal(caps.glyphs, 'quadrant');
  });

  test('--half-blocks falls back to the U+2580 renderer', () => {
    const caps = detectCaps({
      ...base,
      forceHalfBlocks: true,
      env: { COLORTERM: 'truecolor' },
    });
    assert.equal(caps.glyphs, 'blocks');
    assert.equal(caps.needsCalibration, false);
  });

  test('a remembered "blocks" answer is honoured over the quadrant default', () => {
    const caps = detectCaps({
      ...base,
      savedGlyphMode: 'blocks',
      env: { COLORTERM: 'truecolor' },
    });
    assert.equal(caps.glyphs, 'blocks');
  });

  test('--ascii beats --pixel-art when both are given', () => {
    const caps = detectCaps({ ...base, forceAscii: true, forceBlocks: true });
    assert.equal(caps.glyphs, 'ascii');
  });
});
