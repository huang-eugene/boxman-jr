/**
 * Terminal lifecycle: raw mode, alternate screen, cursor, and - above all -
 * getting the user's shell back exactly as we found it.
 *
 * The restore path is the most important code in this file. If the game
 * crashes and leaves the cursor hidden or raw mode on, the parent is left with
 * a broken shell, which is a far worse outcome than the crash itself.
 */

const ESC = '\x1b';

export const ansi = {
  altScreenOn: `${ESC}[?1049h`,
  altScreenOff: `${ESC}[?1049l`,
  cursorHide: `${ESC}[?25l`,
  cursorShow: `${ESC}[?25h`,
  cursorHome: `${ESC}[H`,
  reset: `${ESC}[0m`,
  clear: `${ESC}[2J`,
  /** Move the cursor to a 1-based row/col. */
  moveTo: (row: number, col: number): string => `${ESC}[${row};${col}H`,
  /** Erase from the cursor to the end of the line. */
  clearLine: `${ESC}[K`,
};

let active = false;
let restored = false;
let handlersInstalled = false;

/** Write straight to stdout, bypassing console. */
export function out(s: string): void {
  process.stdout.write(s);
}

export function terminalSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

/**
 * Put the terminal into game mode: alternate screen, raw input, hidden cursor.
 * Safe to call twice.
 */
export function enterGameMode(): void {
  if (active) return;
  active = true;
  restored = false;

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  out(ansi.altScreenOn + ansi.cursorHide + ansi.clear + ansi.cursorHome);

  installHandlers();
}

/**
 * Undo everything enterGameMode did. Idempotent, and safe to call from a
 * signal handler or an uncaught-exception handler.
 */
export function restore(): void {
  if (restored) return;
  restored = true;
  active = false;

  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    // If we can't reset raw mode there is nothing useful left to do; keep
    // going so the remaining escape sequences still get written.
  }
  out(ansi.reset + ansi.cursorShow + ansi.altScreenOff);
  process.stdin.pause();
}

/**
 * Register restore on every path out of the process.
 *
 * On a crash we restore FIRST and print the error afterwards, so the stack
 * trace lands in a usable terminal rather than on the alternate screen where
 * it vanishes the moment we exit.
 */
function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  process.on('exit', restore);

  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    restore();
    process.exit(143);
  });

  process.on('uncaughtException', (err) => {
    restore();
    console.error('\nboxman-jr hit an unexpected problem:\n');
    console.error(err);
    process.exit(1);
  });

  process.on('unhandledRejection', (err) => {
    restore();
    console.error('\nboxman-jr hit an unexpected problem:\n');
    console.error(err);
    process.exit(1);
  });
}

/** Subscribe to terminal resize. Returns an unsubscribe function. */
export function onResize(fn: () => void): () => void {
  process.stdout.on('resize', fn);
  return () => {
    process.stdout.off('resize', fn);
  };
}
