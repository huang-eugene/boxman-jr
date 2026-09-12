/**
 * Raw stdin -> key events.
 *
 * We parse bytes by hand rather than using readline: readline's line
 * discipline fights raw-mode key handling, and we need single keypresses with
 * no Enter.
 */

export type KeyName =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'undo'
  | 'restart'
  | 'enter'
  | 'escape'
  | 'space'
  | 'quit'
  | 'help'
  | 'skip'
  | 'yes'
  | 'no'
  | 'char';

export interface Key {
  name: KeyName;
  /** The raw character, for 'char' and for menu shortcuts. */
  ch: string;
}

const ESC = '\x1b';

/**
 * Decode a chunk of stdin into key events.
 *
 * Returns the events plus any trailing bytes that look like the start of an
 * incomplete escape sequence, which the caller should prepend to the next
 * chunk. Terminals can split an arrow key across two reads.
 */
export function decode(input: string): { keys: Key[]; rest: string } {
  const keys: Key[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === ESC) {
      const remaining = input.length - i;

      // A lone ESC at the very end of a chunk is ambiguous: it might be the
      // Escape key, or the first byte of an arrow sequence split across reads.
      // Hold it back and let the caller decide after a short timeout.
      if (remaining === 1) return { keys, rest: ESC };

      const next = input[i + 1];

      // CSI (ESC [ A) and SS3 (ESC O A) both encode arrows; terminals differ,
      // and PowerShell has been known to emit either.
      if (next === '[' || next === 'O') {
        if (remaining === 2) return { keys, rest: input.slice(i) };
        const code = input[i + 2];
        const arrow = arrowFor(code);
        if (arrow !== null) {
          keys.push({ name: arrow, ch: '' });
          i += 3;
          continue;
        }
        // Some terminals send ESC [ 1 ~ style sequences. Consume up to the
        // final byte so we don't spray junk into the game.
        let j = i + 2;
        while (j < input.length && !/[A-Za-z~]/.test(input[j])) j++;
        if (j >= input.length) return { keys, rest: input.slice(i) };
        i = j + 1;
        continue;
      }

      keys.push({ name: 'escape', ch: ESC });
      i += 1;
      continue;
    }

    keys.push(simpleKey(ch));
    i += 1;
  }

  return { keys, rest: '' };
}

function arrowFor(code: string): KeyName | null {
  switch (code) {
    case 'A':
      return 'up';
    case 'B':
      return 'down';
    case 'C':
      return 'right';
    case 'D':
      return 'left';
    default:
      return null;
  }
}

function simpleKey(ch: string): Key {
  switch (ch) {
    case '\x03': // Ctrl+C
      return { name: 'quit', ch };
    case '\r':
    case '\n':
      return { name: 'enter', ch };
    case ' ':
      return { name: 'space', ch };
    // Backspace: PowerShell/conhost sends \x08, most Unix terminals \x7f.
    // Both are bound to undo, so both must be handled.
    case '\x7f':
    case '\x08':
      return { name: 'undo', ch };
    default:
      break;
  }

  switch (ch.toLowerCase()) {
    case 'w':
      return { name: 'up', ch };
    case 's':
      return { name: 'down', ch };
    case 'a':
      return { name: 'left', ch };
    case 'd':
      return { name: 'right', ch };
    case 'u':
      return { name: 'undo', ch };
    case 'r':
      return { name: 'restart', ch };
    case 'q':
      return { name: 'quit', ch };
    case 'h':
    case '?':
      return { name: 'help', ch };
    case 'n':
      return { name: 'no', ch };
    case 'y':
      return { name: 'yes', ch };
    default:
      return { name: 'char', ch };
  }
}

/**
 * Stream key events from stdin to a handler.
 *
 * Handles the split-escape-sequence case with a short timer: if a lone ESC
 * arrives and nothing follows within a tick, it really was the Escape key.
 */
export function readKeys(onKey: (key: Key) => void): () => void {
  let pending = '';
  let escTimer: NodeJS.Timeout | null = null;

  const clearEscTimer = (): void => {
    if (escTimer !== null) {
      clearTimeout(escTimer);
      escTimer = null;
    }
  };

  const onData = (chunk: Buffer | string): void => {
    clearEscTimer();
    const text = pending + chunk.toString('utf8');
    const { keys, rest } = decode(text);
    pending = rest;

    for (const k of keys) onKey(k);

    if (pending === '\x1b') {
      escTimer = setTimeout(() => {
        pending = '';
        onKey({ name: 'escape', ch: '\x1b' });
      }, 50);
    }
  };

  process.stdin.on('data', onData);
  return () => {
    clearEscTimer();
    process.stdin.off('data', onData);
  };
}
