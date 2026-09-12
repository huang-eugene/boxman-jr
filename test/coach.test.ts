/**
 * Guards on the coach's manners.
 *
 * The failure modes here are social, not technical: a coach that repeats
 * itself, talks over itself, or nags during smooth play is worse than no coach
 * at all. These are the checks that catch that, and they need no terminal
 * because core/coach.ts is pure.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bubbleHeight, MAX_BUBBLE_LINES, speechBubble, wrap } from '../src/screens/hud.js';
import {
  coachLine,
  outranks,
  HOLD_MOVES,
  MANY_UNDOS,
  STALL_MOVES,
  type CoachEvent,
} from '../src/core/coach.js';

const obs = (event: CoachEvent, rotation = 0) => ({
  event,
  done: 1,
  goals: 3,
  rotation,
});

describe('coach lines', () => {
  const EVENTS: CoachEvent[] = [
    'levelStart',
    'stuck',
    'crateOffGoal',
    'crateOnGoal',
    'restart',
    'manyUndos',
    'stalled',
    'solved',
  ];

  test('every event has something to say', () => {
    for (const e of EVENTS) {
      const line = coachLine(obs(e));
      assert.ok(line.text.length > 0, `${e} produced no text`);
    }
  });

  test('rotation walks the pool instead of repeating', () => {
    // Any event with more than one line must differ between rotations.
    const a = coachLine(obs('crateOnGoal', 0)).text;
    const b = coachLine(obs('crateOnGoal', 1)).text;
    assert.notEqual(a, b, 'consecutive rotations must not repeat a line');
  });

  test('rotation is stable for the same input', () => {
    assert.equal(
      coachLine(obs('stalled', 3)).text,
      coachLine(obs('stalled', 3)).text,
    );
  });

  test('rotation wraps rather than running off the end of a pool', () => {
    for (const e of EVENTS) {
      assert.ok(
        coachLine(obs(e, 999)).text.length > 0,
        `${e} broke at a high rotation`,
      );
    }
  });

  test('never gives a directional hint', () => {
    // The whole design constraint: framing, not instructions. If a line ever
    // tells a child which way to push, this is the test that should fail.
    const banned = /\b(push|move) (it|that|the crate) (up|down|left|right)\b/i;
    for (const e of EVENTS) {
      for (let r = 0; r < 6; r++) {
        const { text } = coachLine(obs(e, r));
        assert.ok(!banned.test(text), `${e} gave a directional hint: ${text}`);
      }
    }
  });

  test('a stuck crate is told it can be undone', () => {
    const texts = [0, 1].map((r) => coachLine(obs('stuck', r)).text.toLowerCase());
    assert.ok(
      texts.every((t) => t.includes('undo')),
      'every stuck line must point at undo, the way out',
    );
  });

  test('moods match the moment', () => {
    assert.equal(coachLine(obs('stuck')).mood, 'concerned');
    assert.equal(coachLine(obs('crateOnGoal')).mood, 'happy');
    assert.equal(coachLine(obs('solved')).mood, 'happy');
  });
});

describe('coach urgency', () => {
  test('a stuck crate interrupts a gentler line', () => {
    assert.ok(outranks('stuck', 'crateOnGoal'));
    assert.ok(outranks('stuck', 'stalled'));
    assert.ok(outranks('stuck', 'manyUndos'));
  });

  test('landing a crate interrupts the opening orientation line', () => {
    // The hold must not swallow the celebration on a level whose first crate
    // goes home within a move or two.
    assert.ok(outranks('crateOnGoal', 'levelStart'));
  });

  test('a nudge never interrupts anything', () => {
    assert.ok(!outranks('stalled', 'stuck'));
    assert.ok(!outranks('manyUndos', 'crateOnGoal'));
    assert.ok(!outranks('stalled', 'levelStart'));
  });

  test('a reset always speaks, whatever is on screen', () => {
    // Otherwise a restart after a win leaves "You did it!" above a fresh board.
    for (const current of ['solved', 'stuck', 'crateOnGoal'] as CoachEvent[]) {
      assert.ok(outranks('restart', current), `restart must clear ${current}`);
      assert.ok(outranks('levelStart', current), `new level must clear ${current}`);
    }
  });

  test('an event never outranks itself', () => {
    // Resets are exempt: they always speak, including over themselves.
    for (const e of ['stuck', 'stalled', 'crateOnGoal'] as CoachEvent[]) {
      assert.ok(!outranks(e, e), `${e} should not interrupt itself`);
    }
  });
});

describe('coach pacing constants', () => {
  test('a line is held long enough to be read', () => {
    assert.ok(HOLD_MOVES >= 3, 'a young reader needs more than a move or two');
  });

  test('nudges are rare rather than chatty', () => {
    assert.ok(MANY_UNDOS >= 10, 'undoing a few times is normal, not a problem');
    assert.ok(STALL_MOVES >= 20, 'a stall must be a real stall');
  });
});

describe('the coach is legible', () => {
  const EVENTS: CoachEvent[] = [
    'levelStart',
    'stuck',
    'crateOffGoal',
    'crateOnGoal',
    'restart',
    'manyUndos',
    'stalled',
    'solved',
  ];

  /** Every distinct line the coach can say. */
  const allLines = (): string[] => {
    const seen = new Set<string>();
    for (const e of EVENTS) {
      for (let r = 0; r < 6; r++) seen.add(coachLine(obs(e, r)).text);
    }
    return [...seen];
  };

  test('every line fits a bubble without being cut off', () => {
    // The regression this exists for: the bubble was capped at two lines, so
    // 12 of 19 coach lines - including every stuck warning, the one that tells
    // a child how to recover - rendered as "...nee…" and could not be read.
    for (const text of allLines()) {
      assert.ok(
        bubbleHeight(text, 30) <= MAX_BUBBLE_LINES,
        `needs more than ${MAX_BUBBLE_LINES} lines at width 30: ${text}`,
      );
    }
  });

  test('a bubble renders its text verbatim, with no ellipsis', () => {
    for (const text of allLines()) {
      const rendered = speechBubble(text, 30, 'ascii').join(' ');
      assert.ok(!rendered.includes('…'), `truncated: ${text}`);

      // Every word must survive, not just the overall length.
      for (const word of text.split(/\s+/)) {
        assert.ok(rendered.includes(word), `lost the word "${word}" from: ${text}`);
      }
    }
  });

  test('wrap never splits a word', () => {
    for (const text of allLines()) {
      for (const line of wrap(text, 26)) {
        for (const word of line.split(' ')) {
          assert.ok(
            text.includes(word),
            `wrap invented or split a word: "${word}"`,
          );
        }
      }
    }
  });

  test('a genuinely over-long line is trimmed rather than overflowing', () => {
    const huge = 'word '.repeat(200).trim();
    const out = speechBubble(huge, 30, 'ascii');
    // border top + MAX lines + border bottom + tail
    assert.equal(out.length, MAX_BUBBLE_LINES + 3);
    assert.ok(out.join(' ').includes('…'), 'the trim must be visible');
  });
});
