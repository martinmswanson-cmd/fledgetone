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

/** `time` in seconds, moved just ahead of the audio clock if it's already (nearly) past. */
/**
 * Notes that reached the live audio engine after their time had passed (played a moment late):
 * the sign that the computer isn't keeping up. Read by the performance monitor (perfMonitor.ts).
 */
export const lateNotes = { count: 0 };

export function notLate(context: Tone.BaseContext, time?: Tone.Unit.Time): number {
  const requested = time === undefined ? context.now() : Tone.Time(time).toSeconds();
  // Only live playback counts (an export renders at its own pace); a note with no time is "now" by design
  if (time !== undefined && requested < context.rawContext.currentTime && !(context.rawContext instanceof OfflineAudioContext)) lateNotes.count++;
  // The raw context's clock is where audio is actually being rendered. (An OfflineContext's
  // own currentTime is its scheduling clock, which sits right on each note's time and would
  // make every offline hit look late.)
  return Math.max(requested, context.rawContext.currentTime + LATE_MARGIN);
}

export function monotonicTime(context: Tone.BaseContext): (time?: Tone.Unit.Time) => number {
  let last = -Infinity;
  return (time) => {
    const t = notLate(context, time);
    last = t > last ? t : last + 0.001;
    return last;
  };
}
