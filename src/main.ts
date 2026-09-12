#!/usr/bin/env node
/**
 * boxman-jr - a friendly crate-pushing puzzle game for kids.
 *
 * Entry point: parse arguments, work out what the terminal can do, load the
 * level packs, and hand off to the app.
 */

import { flatten, loadPacks, type Pack } from './io/packs.js';
import { loadProgress, saveProgress, progressPath } from './io/store.js';
import { reconcile, resumeIndex } from './core/progress.js';
import { enterGameMode, out, restore, terminalSize, ansi } from './io/term.js';
import {
  detectCaps,
  isPixelMode,
  type ColorMode,
  type GlyphMode,
} from './render/caps.js';
import { paint } from './render/color.js';
import { theme } from './render/theme.js';
import { Framebuffer } from './render/framebuffer.js';
import { App } from './screens/app.js';
import { fitsAtMinimumTile } from './render/board.js';

interface Args {
  ascii: boolean;
  noBlocks: boolean;
  blocks: boolean;
  halfBlocks: boolean;
  noCoach: boolean;
  color?: ColorMode;
  levels?: string;
  selftest: boolean;
  help: boolean;
  version: boolean;
  reset: boolean;
  resetGraphics: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    ascii: false,
    noBlocks: false,
    blocks: false,
    halfBlocks: false,
    noCoach: false,
    selftest: false,
    help: false,
    version: false,
    reset: false,
    resetGraphics: false,
  };

  for (const arg of argv) {
    if (arg === '--ascii') args.ascii = true;
    else if (arg === '--blocks=off') args.noBlocks = true;
    else if (arg === '--blocks=on' || arg === '--pixel-art') args.blocks = true;
    else if (arg === '--half-blocks') args.halfBlocks = true;
    else if (arg === '--no-coach') args.noCoach = true;
    else if (arg.startsWith('--color=')) {
      args.color = arg.slice(8) as ColorMode;
    } else if (arg.startsWith('--levels=')) args.levels = arg.slice(9);
    else if (arg === '--selftest') args.selftest = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--version' || arg === '-v') args.version = true;
    else if (arg === '--reset-progress') args.reset = true;
    else if (arg === '--reset-graphics') args.resetGraphics = true;
  }

  return args;
}

const HELP = `
boxman-jr - a friendly crate-pushing puzzle game for kids

  npx boxman-jr              play
  npx boxman-jr --ascii      plain text mode (no pixel graphics)
  npx boxman-jr --selftest   check how graphics look in this terminal

Options
  --ascii              use plain ASCII instead of pixel art
  --pixel-art          force pixel art back on (same as --blocks=on)
  --blocks=off         keep colour, but no block graphics
  --half-blocks        use the wider half-block renderer instead of quadrants
  --no-coach           hide the coach and their hints
  --color=MODE         truecolor | ansi256 | ansi16 | ascii
  --levels=DIR         load level packs from your own directory
  --reset-graphics     forget the saved graphics choice, keeping puzzle progress
  --reset-progress     start again from the very first puzzle
  --version            print the version
  --help               show this

In game
  Arrow keys / WASD    move
  U or Backspace       undo - as much as you like
  R                    restart the puzzle
  Esc                  choose a puzzle
  Q or Ctrl+C          quit
`;

/**
 * A one-time check that this terminal can actually draw half-blocks.
 *
 * Legacy Windows consoles with a raster font render U+2580 as garbage no
 * matter what the colour detection says, and there is no reliable way to
 * detect that from inside the process. So we ask once and remember.
 */
async function calibrate(mode: ColorMode): Promise<GlyphMode> {
  const fb = new Framebuffer(12, 6, theme.crateMid);
  fb.rect(2, 1, 8, 4, theme.crateLight);
  fb.rect(4, 2, 4, 2, theme.crateDark);

  out(ansi.clear + ansi.cursorHome);
  out('\n  Quick check - how do the graphics look in this window?\n\n');
  for (const row of fb.renderRows(mode)) out('    ' + row + '\n');
  out('\n  Do you see a solid coloured box above? (y/n) ');

  return new Promise<GlyphMode>((resolve) => {
    const onData = (chunk: Buffer): void => {
      const ch = chunk.toString('utf8').toLowerCase();
      if (ch.includes('y')) {
        process.stdin.off('data', onData);
        resolve('blocks');
      } else if (ch.includes('n')) {
        process.stdin.off('data', onData);
        resolve('ascii');
      } else if (ch.includes('\x03')) {
        restore();
        process.exit(130);
      }
    };
    process.stdin.on('data', onData);
  });
}

function selftest(mode: ColorMode): void {
  console.log(`\ncolour mode: ${mode}`);
  console.log(`terminal:    ${terminalSize().cols} x ${terminalSize().rows}\n`);
  const fb = new Framebuffer(24, 8, theme.floor);
  fb.rect(1, 1, 10, 6, theme.crateMid);
  fb.rect(2, 2, 8, 4, theme.crateLight);
  fb.rect(13, 1, 10, 6, theme.crateDoneMid);
  fb.rect(14, 2, 8, 4, theme.crateDoneLight);
  for (const row of fb.renderRows(mode)) console.log('  ' + row);
  console.log('\nIf you see two solid coloured blocks, pixel graphics work here.');
  console.log('If you see rows of odd characters instead, run with --ascii.\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.version) {
    console.log('boxman-jr 0.1.0');
    return;
  }

  const loaded = loadProgress();
  const progress = loaded.progress;

  if (args.reset) {
    progress.packs = {};
    progress.settings.lastPack = undefined;
    progress.settings.lastLevel = undefined;
    saveProgress(progress);
    console.log(`Progress reset. (${progressPath()})`);
    return;
  }

  if (args.resetGraphics) {
    progress.settings.glyphMode = undefined;
    saveProgress(progress);
    console.log(
      `Graphics choice forgotten; puzzle progress kept. (${progressPath()})`,
    );
    return;
  }

  let packs: Pack[];
  try {
    packs = loadPacks(args.levels);
  } catch (err) {
    console.error(`\nCould not load levels: ${(err as Error).message}\n`);
    process.exit(1);
  }

  if (packs.length === 0) {
    console.error('\nNo level packs found. Is the levels/ directory missing?\n');
    process.exit(1);
  }

  const refs = flatten(packs);
  if (refs.length === 0) {
    console.error('\nNo levels found in any pack.\n');
    process.exit(1);
  }

  const cursors = refs.map((r) => ({
    packId: r.pack.manifest.id,
    levelId: r.level.id,
  }));

  // Adding puzzles re-cuts the difficulty tiers, so a level the player has
  // already solved can move to another pack. Follow its record across before
  // anything reads progress, or their stars quietly disappear.
  if (reconcile(progress, cursors)) saveProgress(progress);

  const caps = detectCaps({
    forceAscii: args.ascii,
    forceColor: args.color,
    forceNoBlocks: args.noBlocks,
    forceBlocks: args.blocks,
    forceHalfBlocks: args.halfBlocks,
    savedGlyphMode: progress.settings.glyphMode,
  });

  if (args.selftest) {
    selftest(caps.color);
    return;
  }

  // --pixel-art exists to undo a wrong answer we remembered, so remember the
  // correction too rather than making the player pass the flag forever.
  if (args.blocks && progress.settings.glyphMode !== caps.glyphs) {
    progress.settings.glyphMode = caps.glyphs;
    saveProgress(progress);
  }

  // Warn (but keep going) if a level is too big for this window - the kid can
  // resize, and every bundled level is checked to fit at the minimum tile size.
  const { cols, rows } = terminalSize();
  const oversized = refs.filter((r) => !fitsAtMinimumTile(r.level, cols, rows));
  if (oversized.length > 0 && isPixelMode(caps.glyphs)) {
    // Not fatal: the board renderer falls back to the smallest tile, and the
    // app shows a "make the window bigger" screen when it truly cannot fit.
  }

  enterGameMode();

  if (caps.needsCalibration) {
    const glyphs = await calibrate(caps.color);
    caps.glyphs = glyphs;
    progress.settings.glyphMode = glyphs;
    saveProgress(progress);
  }

  if (loaded.recoveredFrom) {
    out(ansi.clear + ansi.cursorHome);
    out(
      '\n  ' +
        paint(
          'Your saved progress could not be read, so we have started fresh.',
          theme.textDim,
          caps.color,
        ) +
        '\n\n  Press any key to continue.\n',
    );
    await new Promise<void>((resolve) => {
      process.stdin.once('data', () => resolve());
    });
  }

  const startAt = resumeIndex(cursors, progress);

  const app = new App({
    refs,
    packs,
    progress,
    caps,
    startAt,
    recoveredFrom: loaded.recoveredFrom,
    // --no-coach is a one-off; a remembered "off" is the standing preference.
    coach: args.noCoach ? false : progress.settings.coach !== false,
  });

  app.run();
}

main().catch((err) => {
  restore();
  console.error(err);
  process.exit(1);
});
