/**
 * How far past the audio clock a live note has to be set to be sure to reach the sound in time,
 * shared by the fixes for Tone's synths (toneFixes.ts) and the synths and kits made of plain Web
 * Audio nodes (monotonic.ts's notLate, native.ts's strikeLive).
 *
 * The browser renders sound a render block (128 frames) at a time, a whole render callback's worth
 * of blocks in one go (10 ms or so, the context's baseLatency), and the page can be held up between
 * reading the clock and setting a note's envelope (a busy main thread). An envelope that reaches
 * the browser after the sound has passed its attack has its moments moved up to where the sound
 * is, at once, and then often never rises: silent, or 20 to 40 dB quiet. A callback's worth of room
 * past the clock covers a hold-up that long (less a block, for a note of plain nodes: its
 * connection can be first played a block after it's made, see native.ts's inTimeToConnect).
 *
 * A Tone synth's note whose oscillators were started ahead of it, waiting for it (toneStart.ts
 * attackAhead), is struck exactly (strikeExactly): where it comes is settled as it's struck, and
 * its pitch is set there with it, so they set out together; moved without them, they'd be out of
 * step with it.
 */

/** How many times a note is struck at most (again only when the page was held up while setting it). */
export const ATTACK_TRIES = 3;
/** The most room kept, whatever the context says of its callbacks. */
const MAX_LEAD = 0.1;

/** How far ahead of the clock the page reads the sound can be: a render callback, in whole blocks (at least one). */
export function soundLead(context: { sampleRate: number; rawContext?: unknown }): number {
  const base = (context.rawContext as { baseLatency?: number } | undefined)?.baseLatency;
  const blocks = Math.max(1, Math.ceil(((Number.isFinite(base) ? (base as number) : 0) * context.sampleRate) / 128 - 1e-6));
  return Math.min((blocks * 128) / context.sampleRate, MAX_LEAD);
}

/** The earliest a note's attack can be set for and still reach the sound in time: a callback past the clock. */
export function attackRoom(context: { currentTime: number; sampleRate: number; rawContext?: unknown }): number {
  return context.currentTime + soundLead(context) + 1 / context.sampleRate;
}

/**
 * Thrown by a strike made with strikeExactly when its attack can't come where it's asked (the
 * clock has moved on too near it): nothing of the note is set yet, and `at` is where it can come.
 */
export class AttackMoved extends Error {
  at: number;
  constructor(at: number) {
    super('The note has to start later');
    this.at = at;
  }
}

/** How the strike under way sets its envelopes: as they can ('no'), or exactly (see strikeExactly) before any is set ('first') or after ('rest'). */
let exact: 'no' | 'first' | 'rest' = 'no';
/** What the strike under way made exactly is told of where it comes, before anything of it is set. */
let settle: ((at: number) => void) | null = null;

/**
 * Strike a note (`strike` sets it) exactly: it comes where it's asked while the clock is still two
 * blocks short of it (see blockShort: one for the sound under way, one for the clock to move on
 * while its envelope is set), or else that far past the clock (see settledAt); either way
 * `settled` is told where, before anything of it is set (see toneFixes.ts). Should the clock come
 * nearer still before its first envelope is set, AttackMoved is thrown instead. For a note whose
 * oscillators were started ahead of it to wait for its attack (toneStart.ts attackAhead): its
 * pitch is set where it comes (`settled`), or its oscillators started again for where it can come.
 */
export function strikeExactly<T>(strike: () => T, settled?: (at: number) => void): T {
  exact = 'first';
  settle = settled ?? null;
  try {
    return strike();
  } finally {
    exact = 'no';
    settle = null;
  }
}

/**
 * For toneFixes.ts, as a synth's whole note is struck at `asked`: where a note struck exactly
 * comes, told to its strikeExactly (undefined for one not struck exactly).
 */
export function exactlyAt(context: { currentTime: number; sampleRate: number; rawContext?: unknown }, asked: number): number | undefined {
  if (exact !== 'first') return undefined;
  const at = settledAt(context, asked);
  const then = settle;
  settle = null;
  then?.(at);
  return at;
}

/**
 * Where a note struck exactly comes, asked for `asked` (see strikeExactly): there while the clock
 * is two blocks short of it, or where any note's attack would go (a callback past the clock); or
 * else two blocks past the clock, no further.
 */
export function settledAt(context: { currentTime: number; sampleRate: number; rawContext?: unknown }, asked: number): number {
  const block = 128 / context.sampleRate;
  const room = attackRoom(context);
  if (room <= asked || blockShort(context, asked - block)) return asked;
  return Math.min(room, context.currentTime + 2 * block + 1 / context.sampleRate);
}

/** For toneFixes.ts, as an envelope's attack is set: how (see `exact`). The first one set makes it 'rest'. */
export function envelopeExactness(): 'no' | 'first' | 'rest' {
  const was = exact;
  if (was === 'first') exact = 'rest';
  return was;
}

/**
 * Whether the clock, read just after a note's moments are set, is still a render block short of
 * `at`: they reached the sound in time. The clock counts the blocks done, and the next can already
 * be under way as it's read, but no more (see native.ts inTimeToConnect).
 */
export function blockShort(context: { currentTime: number; sampleRate: number }, at: number): boolean {
  return context.currentTime + 128 / context.sampleRate < at;
}
