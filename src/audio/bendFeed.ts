/**
 * Bends given to the audio as they come due while playing: an instrument that bends as a whole
 * (createBendFeed), a voice following its instrument's bends (feedFollower). An export gets them
 * all at once, as it always did.
 */
import { createBendTimeline, type BendTimeline } from './bendTimeline';

/**
 * Live, the bends (and a voice's pressure) sent for later are given to the audio at most
 * FEED_AHEAD seconds ahead, and the rest as the clock gets to them (every FEED_EVERY): each event
 * given to a Tone signal is checked against every one it already has (standardized-audio-context
 * keeps them in a list), so a long note's thousands of bend steps at once froze the page for
 * seconds. A stall shorter than FEED_AHEAD - FEED_EVERY isn't heard. An export gives them all at
 * once (its clock doesn't run while the song is set up). The voice pool (poly.ts) bends all its
 * voices with one signal fed this way, and the EDM basses give their filter sweeps the same way
 * (edmBass.ts).
 */
export const FEED_AHEAD = 2;
export const FEED_EVERY = 0.25;

/** The clock and timers of the context the bends are for (a Tone context). */
export interface FeedClock {
  readonly currentTime: number;
  readonly isOffline: boolean;
  setInterval: (fn: () => void, seconds: number) => number;
  clearInterval: (id: number) => void;
}

/** A signal a whole instrument bends with (cents): a Tone synth's detune. */
export interface BendTarget {
  setTargetAtTime: (value: number, time: number, constant: number) => unknown;
  cancelScheduledValues: (time: number) => unknown;
}

/**
 * The bends of an instrument that bends as a whole (one detune for every note), by time, given to
 * `target` as they come due (see FEED_AHEAD): live, the ones for further ahead wait in a bend
 * timeline; in an export each goes to the signal as it's sent.
 */
export function createBendFeed(clock: FeedClock, target: BendTarget, constant = 0.005) {
  const offline = clock.isOffline;
  const bends = createBendTimeline(() => clock.currentTime);
  /** The bends up to here are on the signal */
  let fedTo = -Infinity;
  const feed = () => {
    const to = clock.currentTime + FEED_AHEAD;
    if (!(to > fedTo)) return;
    for (const [t, cents] of bends.after(fedTo, to, true)) target.setTargetAtTime(cents, t, constant);
    fedTo = to;
  };
  const timer = offline ? -1 : clock.setInterval(feed, FEED_EVERY);
  return {
    /** Bend to `cents` from `time`. `cut`: the bends set for `time` and after go first. */
    bend: (cents: number, time: number, cut?: boolean) => {
      if (offline) {
        if (cut) target.cancelScheduledValues(time);
        target.setTargetAtTime(cents, time, constant);
        return;
      }
      // (The ones come due meanwhile first, so the signal has them in time order up to fedTo)
      feed();
      if (cut) target.cancelScheduledValues(time);
      bends.set(cents, time, cut);
      if (time <= fedTo) target.setTargetAtTime(cents, time, constant);
    },
    dispose: () => {
      if (timer !== -1) clock.clearInterval(timer);
    },
  };
}

/** A voice following its instrument's bend timeline while it sounds: given the bends up to `fedTo` so far. */
export interface Follower {
  fedTo: number;
}

/**
 * Give `f` the bends of `bends` sent for after the ones it has, while it sounds (before `until`)
 * and, live, up to FEED_AHEAD from now (an export: all of them). A bend sent later reaches it
 * at once only for up to `f.fedTo` (see followsNow); the rest it's given here, from a timer.
 */
export function feedFollower(f: Follower, until: number, bends: BendTimeline, clock: Pick<FeedClock, 'currentTime' | 'isOffline'>, give: (cents: number, time: number) => void): void {
  const to = Math.min(until, clock.isOffline ? Infinity : clock.currentTime + FEED_AHEAD);
  if (!(to > f.fedTo)) return;
  for (const [t, cents] of bends.after(f.fedTo, to, to < until)) give(cents, t);
  f.fedTo = to;
}

/** Whether a bend sent for `time` goes to `f` now (sounding then, and given the bends up to then). */
export const followsNow = (f: Follower, until: number, time: number): boolean => time < until && time <= f.fedTo;
