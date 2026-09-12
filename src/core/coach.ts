/**
 * The coach: what to say, and when to stay quiet.
 *
 * This module is PURE - no I/O, no ANSI, no randomness - so the interesting
 * behaviour (does it nag? does it repeat itself?) is unit-testable without a
 * terminal, in the same spirit as deadlock.ts.
 *
 * The design rule, inherited from deadlock.ts: never say anything we cannot
 * stand behind. The coach does NOT give hints - it never knows or says which
 * crate to push. It teaches how to FRAME the problem: look at the goals, work
 * on one crate, undo freely, notice when something is stuck. A child who is
 * told what to do learns nothing and stops trusting the game the first time the
 * advice is wrong.
 *
 * The second rule is silence. A coach that speaks on every keystroke becomes
 * wallpaper, and wallpaper cannot encourage anyone. `coachLine` returns null
 * for ordinary fluent play, which is most of it.
 */

export type CoachMood = 'idle' | 'happy' | 'thinking' | 'concerned';

export interface CoachLine {
  readonly text: string;
  readonly mood: CoachMood;
}

/**
 * Why the coach is being asked to speak. Ordered loosely by urgency; `pick`
 * resolves ties by this order, so a stuck crate always outranks a nudge.
 */
export type CoachEvent =
  | 'levelStart'
  | 'stuck'
  | 'crateOffGoal'
  | 'crateOnGoal'
  | 'restart'
  | 'manyUndos'
  | 'stalled'
  | 'solved';

/** Everything the coach is allowed to know. Deliberately small. */
export interface CoachObservation {
  readonly event: CoachEvent;
  /** Crates currently home, and how many there are in total. */
  readonly done: number;
  readonly goals: number;
  /** Rotates the line within a pool. Caller-supplied, so this stays pure. */
  readonly rotation: number;
}

/**
 * The lines, grouped by event.
 *
 * Tone: warm, short, curious, never disappointed. Second person, present
 * tense. Questions are preferred over instructions - a question prompts a
 * child to think, an instruction just gets followed.
 */
const LINES: Record<CoachEvent, readonly string[]> = {
  levelStart: [
    'Look at the goals first. Where does each crate need to end up?',
    'Take a look around before you move. What do you notice?',
    'No rush! Have a good look at the shape of this room.',
  ],
  stuck: [
    "That crate can't come back from there. Press U to undo - undo is free!",
    'Ah, that one is stuck in a corner. Undo as far back as you like.',
  ],
  crateOffGoal: [
    'Sometimes a crate has to move aside to let another one past.',
    "Moving one out of the way? That's good thinking.",
  ],
  crateOnGoal: [
    'One home! Does that change where you can walk?',
    'Nice. Which crate looks easiest now?',
    'That one is done. What does the room look like now?',
  ],
  restart: [
    'Fresh start! Before you move, try picturing the last crate going in.',
    'Starting again is a great idea. What will you try differently?',
  ],
  manyUndos: [
    "Lots of undos means you're experimenting. That's what solving looks like!",
    'Trying things out is exactly right. Undo as much as you need.',
  ],
  stalled: [
    'Stuck for ideas? Try just one crate. Which has a clear path?',
    'Try working backwards: which crate should go in LAST?',
    'If a crate is in the way, where could it wait instead?',
  ],
  solved: [
    'You did it! What was the idea that cracked it?',
    'Solved! That was good thinking.',
  ],
};

/** A line that is always safe to show, used when a pool is somehow empty. */
const FALLBACK: CoachLine = {
  text: 'You can never lose here. Undo as much as you need.',
  mood: 'idle',
};

const MOODS: Record<CoachEvent, CoachMood> = {
  levelStart: 'idle',
  stuck: 'concerned',
  crateOffGoal: 'thinking',
  crateOnGoal: 'happy',
  restart: 'thinking',
  manyUndos: 'thinking',
  stalled: 'thinking',
  solved: 'happy',
};

/**
 * Pick a line for an observation.
 *
 * Returns null only if the pool is empty, which cannot happen with the table
 * above - the caller decides when NOT to ask (see shouldSpeak).
 */
export function coachLine(obs: CoachObservation): CoachLine {
  const pool = LINES[obs.event];
  if (pool === undefined || pool.length === 0) return FALLBACK;

  // Rotation rather than randomness keeps this pure and testable, and also
  // guarantees a child does not see the same line twice in a row.
  const text = pool[Math.abs(obs.rotation) % pool.length];
  return { text, mood: MOODS[obs.event] };
}

/** How many moves a line stays up before anything may replace it. */
export const HOLD_MOVES = 4;

/** Undo count past which we reframe undoing as experimenting, not failing. */
export const MANY_UNDOS = 12;

/** Moves without a crate landing home before we offer a way to decompose. */
export const STALL_MOVES = 40;

/**
 * Should a new line replace the one on screen?
 *
 * Urgency ordering matters: a stuck crate is actionable and time-sensitive, so
 * it interrupts. Everything else waits its turn, so a line stays readable for a
 * slow reader rather than being replaced mid-sentence.
 */
export function outranks(next: CoachEvent, current: CoachEvent): boolean {
  // A reset always speaks. The board the old line referred to is gone, so
  // holding it leaves a stale remark - "You did it!" over a puzzle the player
  // has just restarted - which is worse than any amount of interruption.
  if (next === 'levelStart' || next === 'restart') return true;

  const rank: Record<CoachEvent, number> = {
    stuck: 5,
    solved: 5,
    // A crate landing home is the best moment in the game and the one the
    // player just caused. It outranks the opening orientation line, which has
    // by then done its job - otherwise the hold swallows the celebration on any
    // level whose first crate goes in within a few moves.
    crateOnGoal: 4,
    restart: 3,
    levelStart: 3,
    crateOffGoal: 2,
    manyUndos: 1,
    stalled: 1,
  };
  return rank[next] > rank[current];
}
