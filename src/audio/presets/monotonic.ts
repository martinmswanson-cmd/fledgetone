import * as Tone from 'tone';

/**
 * Monophonic Tone synths throw if triggered twice at the same instant ("Start time must be
 * strictly greater than previous start time"), which happens when overlapping clips land
 * hits on one tick. Each voice gets one of these to nudge a repeat hit 1 ms later instead
 * of crashing the scheduler callback.
 *
 * Late hits are the other trap: if the main thread was busy, a hit can arrive with a time
 * already in the past, and Tone clamps it up to context.currentTime inside start(). The audio
 * clock can advance between two such calls, so two late hits could still collapse onto one
 * instant. Moving any late (or nearly late) hit a few ms into the future means Tone never
 * has to clamp it. On-time hits are scheduled ~100 ms ahead and are unaffected.
 */
const LATE_MARGIN = 0.005;

export function monotonicTime(context: Tone.BaseContext): (time?: Tone.Unit.Time) => number {
  let last = -Infinity;
  return (time) => {
    const requested = time === undefined ? context.now() : Tone.Time(time).toSeconds();
    const t = Math.max(requested, context.currentTime + LATE_MARGIN);
    last = t > last ? t : last + 0.001;
    return last;
  };
}
