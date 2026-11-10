/**
 * How every live note and hit is struck: one rule for Tone's synths and drums (toneFixes.ts,
 * toneStart.ts), the synths and kits of plain Web Audio nodes (native.ts strikeLive) and the EDM
 * basses (edmBass.ts), a chord on a Tone voice pool (poly.ts) and the Brass swell. Not (yet) the
 * recorded instruments (samplerManager.ts), the Slicer or the Sub enhancer (subLayer.ts): a
 * recording started late plays from its start, whole, so they start at the clock.
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
 *    a render callback and a block past the clock if that's sooner (attackRoom), so even a callback
 *    rendered the moment the clock was read, or while the note is set, can't reach it before it's set.
 * 2. Every part of it is set for that one time, silent until the end: its pitch, oscillators,
 *    noise and every envelope but the one that makes it heard (a Tone synth's loudness envelope),
 *    or, for a note of plain nodes, everything but its connection to where it sounds. (Parts that
 *    wait silently for any time can be readied just before the time is decided: a hat's, a kick's
 *    or an FM note's oscillators started at 0 Hz wait at the start of their waves however long,
 *    and only their pitch is set for the note; struck again, they're set up afresh, see
 *    toneStart.ts strikeTogether.)
 * 3. The clock is read again. If it's still a render block short of the note, nothing of it has
 *    been rendered, and the last step is taken: the loudness envelope set, or the connection made.
 *    The clock is read once more after it: still a block short, every moment of the note reached
 *    the sound in time, and it's heard whole, once.
 * 4. Otherwise (the page was held up while it was set) none of it can have been heard: what was
 *    set is undone (oscillators stopped, pitch and envelope moments taken away, a glide or filter
 *    sweep under way held where it was, nodes let go) and the whole note is struck again from
 *    step 1, a callback past the clock as it is then. Held up while the last step itself was
 *    taken, the note may have reached the sound late, part of it heard (an envelope set out after
 *    the sound had passed it: silent, or a burst): it's faded out over 3 ms and struck again the
 *    same way. Oscillators waiting at 0 Hz for a note struck again are readied for it before its
 *    new time is decided. The last of STRIKE_TRIES takes a callback more and is heard however it
 *    went, so a note is never lost.
 *
 * No part of a note moves without the rest, and a note is struck again only once nothing of it is
 * left to hear (undone before it was heard, or faded out when its last step came late), so it's
 * never out of step, and doubled or lost only if the page is held up, inside its last step, at
 * every try; it's at worst a callback or two later than asked. A hit of several synths (a snare's noise and snap) is struck in one strike, so
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

/**
 * The earliest a note can be set for and still reach the sound in time: a callback and a block past
 * the clock. (A callback rendered while the note is set moves the clock on by up to a callback; the
 * note must still be a block past it then, see reachedInTime.)
 */
export function attackRoom(context: Clock): number {
  return context.currentTime + soundLead(context) + (128 + 1) / context.sampleRate;
}

/** A strike under way: what's left to do once it's found in time, what undoes it if not, and its earliest moment. */
interface Strike {
  asked: number;
  heard: (() => void)[];
  undo: ((gone: number, heard: boolean) => void)[];
  earliest: number;
}
let striking: Strike | null = null;
/** While a strike's last step is taken: the latest clock read just after a part of it was made audible (see soundReached). */
let committing: { reached: number } | null = null;

/**
 * While a strike's last step is taken: the clock, read just after a part of the note was made
 * audible (its loudness envelope's attack set, its connection made). Should it be found late, the
 * note is struck again; a part made audible in time stays (see strikeWhole).
 */
export function soundReached(clock: number): void {
  if (committing) committing.reached = Math.max(committing.reached, clock);
}

/** Live strikes made again (the page held up while one was set), and ones heard with the clock already near them (the last try, or held up within the final step). */
export const strikeCounts = { again: 0, late: 0 };

/** How long a strike found late after it was heard fades out before it's struck again (see strikeWhole). */
export const UNDO_FADE = 0.003;

/**
 * Whether a note's moments from `earliest` on, all set, reached the sound in time: the clock, read
 * after the last of them was set, is still a render block short of them. The clock counts the
 * blocks done, and the next can already be under way as it's read, but no more: every moment set
 * before the read reaches the block that plays it.
 */
function reachedInTime(context: Clock, earliest: number): boolean {
  return context.currentTime + 128 / context.sampleRate < earliest;
}

/**
 * Strike a live note (or a hit of several parts) whole, by the rule above: `build` sets all of it
 * for the time it's given (by `asked`, or a callback past the clock), its last step left to
 * whenHeard and its undoing given to ifUndone, and is called again for a later time when the page
 * was held up while it ran. Returns what the last `build` returned. Offline, or inside another
 * strike (its part: the same time), `build` runs once at `asked`. `start` is where it's first put
 * when the caller has already decided (no sooner than asked): a callback past the clock instead
 * should that be too near by now. `prepare`, before a strike made again, readies what waits
 * silently for any time (a hat's oscillators at 0 Hz) for no sooner than the time it's given, and
 * says where the note can come then; it runs before that time is decided, so the slow part of a
 * note never holds its strike up.
 */
export function strikeWhole<R>(context: Clock & { isOffline: boolean }, asked: number, build: (at: number) => R, start?: number, prepare?: (from: number) => number): R {
  if (context.isOffline || striking) return build(asked);
  let at = start ?? Math.max(asked, attackRoom(context));
  if (!reachedInTime(context, at)) at = Math.max(at, attackRoom(context));
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
    const last = tries >= STRIKE_TRIES;
    let heard = false;
    // (Step 3: not taken when the clock is too near already; the last try is heard however it went)
    if (!failed && (last || reachedInTime(context, strike.earliest))) {
      committing = { reached: -Infinity };
      try {
        for (const then of strike.heard) then();
      } finally {
        heard = true;
      }
      const reached = committing.reached;
      committing = null;
      // (The clock read after the last step too: held up while it was taken, the note may have
      // reached the sound late, an envelope's attack set after the sound had passed it. Judged by
      // the clock just after its audible start was set, where the step says: held up only after
      // that, its attack reached the sound in time, and it stays)
      const by = Number.isFinite(reached) ? { currentTime: reached, sampleRate: context.sampleRate } : context;
      if (last || reachedInTime(by, strike.earliest)) {
        if (context.currentTime + 128 / context.sampleRate >= strike.earliest) strikeCounts.late++;
        return result as R;
      }
      strikeCounts.late++;
    }
    // Undone, last thing first: before it was heard, at once; after, faded out over UNDO_FADE
    const gone = context.currentTime + (heard ? UNDO_FADE : 0);
    for (const undo of strike.undo.reverse()) undo(gone, heard);
    if (failed && last) throw failed.error;
    strikeCounts.again++;
    // (The last try a callback later still: a page held up that long once more still lets it sound)
    const from = Math.max(attackRoom(context) + (tries + 1 >= STRIKE_TRIES ? soundLead(context) : 0), at + 1 / context.sampleRate);
    at = prepare ? Math.max(from, prepare(from)) : from;
    if (!reachedInTime(context, at)) at = Math.max(at, attackRoom(context) + (tries + 1 >= STRIKE_TRIES ? soundLead(context) : 0));
  }
}

/** Inside a strike: run `then` as its last step, once it's found in time (now outside one). */
export function whenHeard(then: () => void): void {
  if (striking) striking.heard.push(then);
  else then();
}

/**
 * Inside a strike: run `undo` should it be undone, last first: the page held up while it was set
 * (`heard` false: nothing of it reached the sound; what it set is taken away, from `gone`, now), or
 * while its last step was taken (`heard` true: it may be sounding; it fades out by `gone`, and what
 * it set is taken away from then on).
 */
export function ifUndone(undo: (gone: number, heard: boolean) => void): void {
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
