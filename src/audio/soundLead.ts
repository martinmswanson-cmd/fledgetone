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
