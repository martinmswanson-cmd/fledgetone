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
 *    a render callback past the clock if that's sooner (attackRoom), so even a callback rendered
 *    the moment the clock was read can't reach it before it's set.
 * 2. Every part of it is set for that one time, silent until the end: its pitch, oscillators,
 *    noise and every envelope but the one that makes it heard (a Tone synth's loudness envelope),
 *    or, for a note of plain nodes, everything but its connection to where it sounds. (Parts that
 *    wait silently for any time can be readied just before the time is decided: a hat's, a kick's
 *    or an FM note's oscillators started at 0 Hz wait at the start of their waves however long,
 *    and only their pitch is set for the note; struck again, they're set up afresh, see
 *    toneStart.ts strikeTogether.)
 * 3. The clock is read again. If it's still two render blocks short of the note, nothing of it has
 *    been rendered, and the last step is taken: the loudness envelope set, or the connection made.
 *    The clock is read once more after it: still two blocks short, every moment of the note reached
 *    the sound in time, and it's heard whole, once.
 * 4. Otherwise (the page was held up while it was set) none of it can have been heard: what was
 *    set is undone (oscillators stopped, pitch and envelope moments taken away, a glide or filter
 *    sweep under way held where it was, nodes let go) and the whole note is struck again from
 *    step 1, three blocks past the clock as it is then (the callback that moved it has just been
 *    rendered; see retryRoom). Oscillators waiting at 0 Hz for a note struck again are readied for
 *    it before its new time is decided. The last of STRIKE_TRIES takes a callback more and is
 *    heard however it went, so a note is never lost.
 * 5. Once its last step is taken (or a part of it made audible while it was built, see attackNow)
 *    a note is never undone, even should the page have been held up inside that step: some of it
 *    may already be sounding, and cutting it to strike it again is heard as a hit, a gap and the
 *    hit again. It plays on, late; an envelope whose moments the sound had passed by then is taken
 *    from where it is, over two blocks, to where it should be (toneFixes.ts catchUp), and should the
 *    clock, read after the whole strike, show its moments may have reached the sound late, what's
 *    sounding is looked at once the clock reaches its decay: well under where it should be, its
 *    loudness is taken from what's sounding up to its proper level over one block, a callback past
 *    the clock (ifLate, toneFixes.ts reshapeLate); sounding as it should, it's left alone.
 *
 * No part of a note moves without the rest, and a note is struck again only while nothing of it
 * has been heard, so it's never out of step, never doubled, and never lost; it's at worst a
 * callback or two later than asked. A hit of several synths (a snare's noise and snap, a bell's two
 * tones) is struck in one strike, every part's loudness set together in its last step (every
 * part's attack first, then their decays, see afterHeard), so its parts stay together. A song's note moved later keeps what's picked for it by its place in
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

/**
 * Where a note struck again (or one whose slow part was readied while the clock moved on) can go:
 * three blocks past the clock. The callback that moved the clock has just been rendered, so the next
 * is most of a callback away, and what's left to set is quick; should it not be in time after all,
 * its strike says so (see reachedInTime) and it's struck again.
 */
export function retryRoom(context: Clock): number {
  return context.currentTime + (3 * 128 + 1) / context.sampleRate;
}

/** A strike under way: what's left to do once it's found in time, what undoes it if not, and its earliest moment. */
interface Strike {
  asked: number;
  /** The clock read just after the last of its time-critical moments was set, when every part says where that is (see settledAt). */
  settled?: number;
  /** A part that can't say (any of its moments may be time-critical): the clock after the whole build counts. */
  unsettled?: boolean;
  /** The clock read just after a part of it was made audible while it was built (see attackNow), if one was. */
  audible?: number;
  /** Its last try: heard however it goes. */
  last: boolean;
  heard: (() => void)[];
  /** Run once every step in `heard` has (see afterHeard). */
  after: (() => void)[];
  /** Run should it be found late once heard (see ifLate). */
  late: (() => void)[];
  undo: ((gone: number) => void)[];
  earliest: number;
}
let striking: Strike | null = null;
/** While a strike's last step is taken: the latest clock read just after a part of it was made audible (see soundReached). */
let committing: { reached: number } | null = null;

/**
 * While a strike's last step is taken, or a part of it made audible in its build: the clock, read
 * just after a part of the note was made audible (its loudness envelope's attack set, its
 * connection made). Found late, the strike is counted late (strikeCounts); it's never undone.
 */
export function soundReached(clock: number): void {
  if (committing) committing.reached = Math.max(committing.reached, clock);
  else if (striking) {
    striking.audible = Math.max(striking.audible ?? -Infinity, clock);
    settledAt(clock);
  }
}

/** Thrown inside a strike's build by attackNow: the clock is too near the note for its attack; nothing of it was made audible. */
class StrikeLate extends Error {}

/**
 * Inside a strike whose time-critical moments are all set (see strikeSettled): about to make a
 * part audible now, during the build rather than as its last step (a hat's attack, before Tone sets
 * the slow rest of it, which can come late with no harm). The clock must still be a block
 * short of `at`; else the strike is struck again, cleanly (nothing of it audible yet).
 */
export function attackNow(context: Clock, at: number): void {
  if (striking && !striking.last && !reachedInTime(context, at)) throw new StrikeLate();
}

/** Whether the strike under way has all its time-critical moments set (see settledAt), so a part's attack can be set now (attackNow). */
export function strikeSettled(): boolean {
  return !!striking && striking.settled !== undefined && !striking.unsettled;
}

/** Live strikes made again (the page held up while one was set), and ones heard with the clock already near them (the last try, or held up within the final step). */
export const strikeCounts = { again: 0, late: 0 };

/**
 * Whether a note's moments from `earliest` on, all set, reached the sound in time: the clock, read
 * after the last of them was set, is still two render blocks short of them. The clock counts the
 * blocks done, and the next can already be under way as it's read, and one after it straight on
 * within the same callback: two blocks to spare keep every moment set before the read ahead of the
 * block that plays it. (One block was found not to: a hand-played hat's oscillators now and then
 * set out a little apart.)
 */
function reachedInTime(context: Clock, earliest: number): boolean {
  return context.currentTime + (2 * 128) / context.sampleRate < earliest;
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
  // (A time decided before something slow was readied, and the clock moved on meanwhile)
  if (!reachedInTime(context, at)) at = Math.max(at, retryRoom(context));
  for (let tries = 1; ; tries++) {
    const last = tries >= STRIKE_TRIES;
    const strike: Strike = { asked, heard: [], after: [], late: [], undo: [], earliest: at, last };
    striking = strike;
    let result: R | undefined;
    let failed: { error: unknown } | null = null;
    try {
      const when = at;
      result = struckLater(when - asked, () => build(when));
    } catch (error) {
      // (Tone refusing a start at or before one it already has, or an attack found late before it was
      // set, attackNow: tried again just later)
      failed = error instanceof StrikeLate ? { error: null } : { error };
    } finally {
      striking = null;
    }
    // (Step 5: a part made audible in the build is never undone; the rest of it is made heard too)
    const heard = strike.audible !== undefined;
    // (Step 3: not taken when the clock is too near already; the last try is heard however it went.
    // Judged by the clock after its last time-critical moment when its parts say where that is)
    const built = strike.settled !== undefined && !strike.unsettled ? { currentTime: strike.settled, sampleRate: context.sampleRate } : context;
    if (heard || (!failed && (last || reachedInTime(built, strike.earliest)))) {
      committing = { reached: -Infinity };
      try {
        try {
          for (const then of strike.heard) then();
        } finally {
          for (const then of strike.after) then();
        }
      } finally {
        const reached = Math.max(committing.reached, strike.audible ?? -Infinity);
        committing = null;
        // (Held up while it was made heard: counted, and played on, late; see step 5)
        const by = Number.isFinite(reached) ? { currentTime: reached, sampleRate: context.sampleRate } : context;
        if (!reachedInTime(by, strike.earliest) || context.currentTime + 128 / context.sampleRate >= strike.earliest) strikeCounts.late++;
        // (The clock past where the note's moments could all have reached the sound in time, read
        // after the whole strike: its loudness is set again from where it should be by then)
        if (!reachedInTime(by, strike.earliest) || !reachedInTime(context, strike.earliest)) for (const then of strike.late) then();
      }
      if (failed?.error) throw failed.error;
      return result as R;
    }
    // Undone, last thing first, at once: nothing of it has been heard
    for (const undo of strike.undo.reverse()) undo(context.currentTime);
    if (failed && last) throw failed.error;
    strikeCounts.again++;
    // (The last try a callback later still: a page held up that long once more still lets it sound)
    const soonest = () => (tries + 1 >= STRIKE_TRIES ? attackRoom(context) + soundLead(context) : retryRoom(context));
    const from = Math.max(soonest(), at + 1 / context.sampleRate);
    at = prepare ? Math.max(from, prepare(from)) : from;
    if (!reachedInTime(context, at)) at = Math.max(at, soonest());
  }
}

/** Inside a strike: run `then` as its last step, once it's found in time (now outside one). */
export function whenHeard(then: () => void): void {
  if (striking) striking.heard.push(then);
  else then();
}

/**
 * Inside a strike: run `then` in its last step, once every step given to whenHeard has (what can
 * come late with no harm: an envelope's decay, set once every part's attack is); now outside one.
 */
export function afterHeard(then: () => void): void {
  if (striking) striking.after.push(then);
  else then();
}

/**
 * Inside a strike: run `then` should it be found late once heard (the page held up inside its last
 * step, or after it, before the clock was read): its moments may have reached the sound after the
 * sound had passed them, so a loudness envelope is set again from where it should be (toneFixes.ts
 * reshapeLate). Never run for a strike undone, nor outside one.
 */
export function ifLate(then: () => void): void {
  striking?.late.push(then);
}

/**
 * Inside a strike: run `undo` should it be undone, last first (the page held up while it was set,
 * before any of it was heard): what it set is taken away, from `gone`, the clock.
 */
export function ifUndone(undo: (gone: number) => void): void {
  striking?.undo.push(undo);
}

/**
 * Inside a strike: a part of it says its time-critical moments are all set, the clock then reading
 * `clock`; what it sets after can be set late with no harm (a hat's oscillators, waiting at 0 Hz,
 * carried on at the note, and stopped well after it). Unless another part can't say so (unsettled),
 * the strike is judged by the latest such clock rather than the clock after its whole build.
 */
export function settledAt(clock: number): void {
  if (striking) striking.settled = Math.max(striking.settled ?? -Infinity, clock);
}

/** Inside a strike: a part of it can't say when its time-critical moments are all set (see settledAt). */
export function unsettled(): void {
  if (striking) striking.unsettled = true;
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
