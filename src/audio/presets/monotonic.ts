import * as Tone from 'tone';

/**
 * Monophonic Tone synths throw if triggered twice at the same instant ("Start time must be
 * strictly greater than previous start time"), which happens when overlapping clips land
 * hits on one tick. Each voice gets one of these to nudge a repeat hit 1 ms later instead
 * of crashing the scheduler callback.
 *
 * Tone clamps past times up to context.currentTime, so two hits slightly in the past (e.g.
 * at t=0 when an offline render's first block is processed) would collapse onto the same
 * instant. Clamping here first keeps the nudge effective.
 */
export function monotonicTime(context: Tone.BaseContext): (time?: Tone.Unit.Time) => number {
  let last = -Infinity;
  return (time) => {
    const requested = time === undefined ? context.now() : Tone.Time(time).toSeconds();
    const t = Math.max(requested, context.currentTime);
    last = t > last ? t : last + 0.001;
    return last;
  };
}
