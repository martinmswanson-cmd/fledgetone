/**
 * How every live note and hit is struck: one rule for Tone's synths and drums (toneFixes.ts,
 * toneStart.ts), the synths and kits of plain Web Audio nodes (native.ts strikeLive) and the EDM
 * basses (edmBass.ts).
 *
 * Why it's needed. The browser renders sound a render block (128 frames) at a time, a whole render
 * callback's worth of blocks in one go (10 ms or so, the context's baseLatency), and the audio
 * clock the page reads steps on a block at a time as it does. A note's moments (its envelopes'
 * attack and decay, its pitch, its oscillators' starts, its connection to where it sounds) set
 * after the sound has passed them are moved up to where the sound is, at once: an envelope then
 * often never rises (silent, or 20 to 40 dB quiet) or jumps straight to its peak (a burst and a
 * click), and parts set in time sound out of step with parts set late. The page can be held up at
 * any moment while it sets a note (a busy main thread, a slow computer), for longer than a callback.
 *
 * The rule (strikeWhole):
 * 1. Where the whole note goes is decided once, before anything of it is set: where it's asked, or
 *    a render callback past the clock if that's sooner (attackRoom), so even a callback rendered
 *    the moment the clock was read can't reach it before it's set.
 * 2. Every part of it is set for that one time, silent until the end: its pitch, oscillators,
 *    noise and every envelope but the one that makes it heard (a Tone synth's loudness envelope),
 *    or, for a note of plain nodes, everything but its connection to where it sounds. (Parts that
 *    wait silently for any time can be readied just before the time is decided: a hat's, a kick's
 *    or an FM note's oscillators started at 0 Hz wait at the start of their waves however long,
 *    and only their pitch is set for the note; struck again, they're set up afresh, see
 *    toneStart.ts strikeTogether.)
 * 3. The clock is read again. If it still leaves a callback's room before the note, nothing can
 *    have been rendered past it, nor can be before the last step is taken: the loudness envelope
 *    set, or the connection made (microseconds; nothing comes between). The note is heard whole,
 *    once. (A clock moved on by less than a callback isn't enough: the callbacks don't always
 *    come evenly, and one rendered just after another can reach the note.)
 * 4. Otherwise (the page was held up while it was set) none of it can have been heard: what was
 *    set is undone (oscillators stopped, pitch and envelope moments taken away, nodes let go) and
 *    the whole note is struck again from step 1, a callback past the clock as it is then. The last
 *    of STRIKE_TRIES takes a callback more and is heard however it went, so a note is never lost.
 *
 * Nothing is ever struck again once it can have been heard, and no part of a note moves without
 * the rest, so a note is never doubled, out of step, or a burst; it's at worst a callback or two
 * later than asked. A hit of several synths (a snare's noise and snap) is struck in one strike, so
 * its parts stay together. A song's note moved later keeps what's picked for it by its place in
 * the song (songPlace.ts struckLater), so it sounds as in the export. An export's clock waits for
 * its notes, so offline every note is set once, where it's asked, exactly as before.
 */
import { struckLater } from './songPlace';

/** Times a note is struck at most (again only when the page was held up while it was set). */
export const STRIKE_TRIES = 4;
/** The most room kept, whatever the context says of its callbacks. */
const MAX_LEAD = 0.1;

interface Clock {
  currentTime: number;
  sampleRate: number;
  rawContext?: unknown;
}

/** How far ahead of the clock the page reads the sound can be: a render callback, in whole blocks (at least one). */
export function soundLead(context: { sampleRate: number; rawContext?: unknown }): number {
  const base = (context.rawContext as { baseLatency?: number } | undefined)?.baseLatency;
  const blocks = Math.max(1, Math.ceil(((Number.isFinite(base) ? (base as number) : 0) * context.sampleRate) / 128 - 1e-6));
  return Math.min((blocks * 128) / context.sampleRate, MAX_LEAD);
}

/** The earliest a note can be set for and still reach the sound in time: a callback past the clock. */
export function attackRoom(context: Clock): number {
  return context.currentTime + soundLead(context) + 1 / context.sampleRate;
}

/** A strike under way: what's left to do once it's found in time, what undoes it if not, and its earliest moment. */
interface Strike {
  asked: number;
  heard: (() => void)[];
  undo: (() => void)[];
  earliest: number;
}
let striking: Strike | null = null;

/** Live strikes made again (the page held up while one was set), and ones heard with the clock already near them (the last try, or held up within the final step). */
export const strikeCounts = { again: 0, late: 0 };

/** Whether a note's moments from `earliest` on can be set now and still reach the sound in time (step 3): the clock still leaves a callback's room before them. */
function stillInTime(context: Clock, earliest: number): boolean {
  return attackRoom(context) <= earliest;
}

/**
 * Strike a live note (or a hit of several parts) whole, by the rule above: `build` sets all of it
 * for the time it's given (by `asked`, or a callback past the clock), its last step left to
 * whenHeard and its undoing given to ifUndone, and is called again for a later time when the page
 * was held up while it ran. Returns what the last `build` returned. Offline, or inside another
 * strike (its part: the same time), `build` runs once at `asked`. `start` is where it's first put
 * when the caller has already decided (no sooner than asked): a callback past the clock instead
 * should that be too near by now.
 */
export function strikeWhole<R>(context: Clock & { isOffline: boolean }, asked: number, build: (at: number) => R, start?: number): R {
  if (context.isOffline || striking) return build(asked);
  let at = start ?? Math.max(asked, attackRoom(context));
  if (!stillInTime(context, at)) at = Math.max(at, attackRoom(context));
  for (let tries = 1; ; tries++) {
    const strike: Strike = { asked, heard: [], undo: [], earliest: at };
    striking = strike;
    let result: R | undefined;
    let failed: { error: unknown } | null = null;
    try {
      const when = at;
      result = struckLater(when - asked, () => build(when));
    } catch (error) {
      // (Tone refusing a start at or before one it already has: tried again just later)
      failed = { error };
    } finally {
      striking = null;
    }
    // (The last try is heard however it went: a note is never lost; see strikeCounts.late)
    if (failed || (tries < STRIKE_TRIES && !stillInTime(context, strike.earliest))) {
      for (const undo of strike.undo.reverse()) undo();
      if (failed && tries >= STRIKE_TRIES) throw failed.error;
      strikeCounts.again++;
      // (The last try a callback later still: a page held up that long once more still lets it sound)
      at = Math.max(attackRoom(context) + (tries + 1 >= STRIKE_TRIES ? soundLead(context) : 0), at + 1 / context.sampleRate);
      continue;
    }
    for (const then of strike.heard) then();
    if (context.currentTime + 128 / context.sampleRate >= strike.earliest) strikeCounts.late++;
    return result as R;
  }
}

/** Inside a strike: run `then` as its last step, once it's found in time (now outside one). */
export function whenHeard(then: () => void): void {
  if (striking) striking.heard.push(then);
  else then();
}

/** Inside a strike: run `undo` should it be undone (the page held up while it was set). Undone last first. */
export function ifUndone(undo: () => void): void {
  striking?.undo.push(undo);
}

/** Inside a strike: a part of it begins at `at`, before its time (an envelope run ahead of the note): the clock must leave room before that. */
export function beginsAt(at: number): void {
  if (striking) striking.earliest = Math.min(striking.earliest, at);
}

/** Inside a strike: where its note was asked for (the outermost strike's), for a release that would cut it short; undefined outside one. */
export function strikeAsked(): number | undefined {
  return striking?.asked;
}

/** Whether a strike is under way (its parts are struck with it). */
export function inStrike(): boolean {
  return striking !== null;
}
