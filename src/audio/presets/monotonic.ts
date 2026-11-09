import * as Tone from 'tone';
import { attackRoom } from '../soundLead';
import { struckLater } from '../songPlace';

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
 *
 * Live, a few ms isn't enough: the page can be held up between reading the clock and setting a
 * note's envelope for longer than that, and an envelope set once the sound has passed its attack
 * often never rises (a Pluck, a Synth Designer note: silent). Live, a note comes no sooner than a
 * render callback past the clock (attackRoom, see soundLead.ts), as Tone's synths' do; an
 * export's clock waits for its notes, so it keeps the few ms.
 */
const LATE_MARGIN = 0.005;

/** `time` in seconds, moved just ahead of the audio clock if it's already (nearly) past. */
/**
 * Notes that reached the live audio engine after their time had passed (played a moment late):
 * the sign that the computer isn't keeping up. Read by the performance monitor (perfMonitor.ts).
 */
export const lateNotes = { count: 0 };

export function notLate(context: Tone.BaseContext, time?: Tone.Unit.Time): number {
  // No time is "now", played by hand (a deck pad, a preview): on the audio clock as it is, not
  // context.now(), which adds the look-ahead the Transport schedules with (0.1 s or more)
  const requested = time === undefined ? context.rawContext.currentTime : Tone.Time(time).toSeconds();
  // Only live playback counts (an export renders at its own pace); a note with no time is "now" by design
  if (time !== undefined && requested < context.rawContext.currentTime && !(context.rawContext instanceof OfflineAudioContext)) lateNotes.count++;
  // The raw context's clock is where audio is actually being rendered. (An OfflineContext's
  // own currentTime is its scheduling clock, which sits right on each note's time and would
  // make every offline hit look late.)
  const raw = context.rawContext;
  const soonest = raw.currentTime + LATE_MARGIN;
  if (context.isOffline) return Math.max(requested, soonest);
  return Math.max(requested, soonest, attackRoom({ currentTime: raw.currentTime, sampleRate: raw.sampleRate, rawContext: raw }));
}

export function monotonicTime(context: Tone.BaseContext): (time?: Tone.Unit.Time) => number {
  let last = -Infinity;
  return (time) => {
    const t = notLate(context, time);
    last = t > last ? t : last + 0.001;
    return last;
  };
}

/**
 * monotonicTime for a voice whose hit is built at once: `play` builds the hit asked for `time` at
 * the voice's next time. A song's hit moved later live because the page was held up (see notLate)
 * is picked as it would have been on time: what a hash picks for it (a snare's or hat's noise
 * burst) counted from where it was asked for, one past the voice's last hit as an export puts it,
 * not from where it lands (songPlace.ts struckLater). Played by hand, or exported, as before.
 */
export function monotonicHits(context: Tone.BaseContext): <T>(time: Tone.Unit.Time | undefined, play: (at: number) => T) => T {
  const next = monotonicTime(context);
  /** Where the voice's last hit was asked for, one past the one before (as an export, whose clock waits for its notes, puts it) */
  let asked = -Infinity;
  return (time, play) => {
    const at = next(time);
    if (time === undefined || context.isOffline) return play(at);
    const wanted = Tone.Time(time).toSeconds();
    asked = wanted > asked ? wanted : asked + 0.001;
    return struckLater(at - asked, () => play(at));
  };
}
