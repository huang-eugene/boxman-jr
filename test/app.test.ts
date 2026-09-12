/**
 * Guards on what the running game writes to the save file.
 *
 * The regression these exist for: the app used to stamp its *detected* glyph
 * mode into settings on every single save. One `--ascii` run, one piped stdout,
 * one NO_COLOR shell - and plain-text mode became permanent, with no way back
 * short of --reset-progress, which also throws away every solved puzzle.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLevel } from '../src/core/sok.js';
import { emptyProgress, type Progress } from '../src/core/progress.js';
import { progressPath } from '../src/io/store.js';
import type { LevelRef, Pack } from '../src/io/packs.js';
import type { Caps } from '../src/render/caps.js';
import { App } from '../src/screens/app.js';

const BOARD = ['#######', '#     #', '# @$. #', '#     #', '#######'].join('\n');

function fixture(): { refs: LevelRef[]; packs: Pack[] } {
  const level = parseLevel(BOARD, { id: 't01', title: 'Hello!' });
  const pack: Pack = {
    manifest: {
      schemaVersion: 1,
      id: 'tutorial',
      name: 'First Steps',
      order: 1,
      levels: [{ id: 't01', file: 't01.sok', title: 'Hello!' }],
    },
    dir: '/nowhere',
    levels: [level],
  };
  return { packs: [pack], refs: [{ pack, level, index: 0 }] };
}

/** Build an App without letting it attach to stdin or paint anything. */
function appWith(progress: Progress, caps: Caps): App {
  const { refs, packs } = fixture();
  return new App({ refs, packs, progress, caps, startAt: 0 });
}

describe('what the app saves', () => {
  let tmp: string;
  let previousXdg: string | undefined;
  let previousHome: string | undefined;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boxman-jr-test-'));
    previousXdg = process.env.XDG_DATA_HOME;
    previousHome = process.env.HOME;
    process.env.XDG_DATA_HOME = tmp;
    process.env.HOME = tmp;
  });

  after(() => {
    if (previousXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousXdg;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('a temporary ascii fallback is never written to settings', () => {
    const progress = emptyProgress();
    const app = appWith(progress, {
      color: 'ascii',
      glyphs: 'ascii',
      needsCalibration: false,
    });

    // save() is what every win, level change and quit funnels through.
    (app as unknown as { save(): void }).save();

    assert.equal(
      progress.settings.glyphMode,
      undefined,
      'a detected glyph mode must not become a remembered preference',
    );

    const written = JSON.parse(fs.readFileSync(progressPath(), 'utf8'));
    assert.equal(written.settings.glyphMode, undefined);
    assert.equal(written.settings.lastLevel, 't01');
  });

  test('an answer the player actually gave is left alone', () => {
    // main.ts writes this after the Windows calibration prompt. Saving position
    // afterwards must neither clobber it nor silently re-derive it.
    const progress = emptyProgress();
    progress.settings.glyphMode = 'ascii';

    const app = appWith(progress, {
      color: 'truecolor',
      glyphs: 'blocks',
      needsCalibration: false,
    });
    (app as unknown as { save(): void }).save();

    assert.equal(progress.settings.glyphMode, 'ascii');
  });
});
