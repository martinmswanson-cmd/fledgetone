import * as Tone from 'tone';
import { attackRoom, inStrike } from '../soundLead';

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
  // (A part of a live strike under way keeps the strike's time: see soundLead.ts strikeWhole)
  if (time !== undefined && inStrike()) return requested;
  return Math.max(requested, soonest, attackRoom({ currentTime: raw.currentTime, sampleRate: raw.sampleRate, rawContext: raw }));
}

/** A voice's times, strictly increasing (see above); `struck(at)` tells it where a note went when its strike moved it later (soundLead.ts strikeWhole). */
export function monotonicTime(context: Tone.BaseContext): ((time?: Tone.Unit.Time) => number) & { struck: (at: number) => void } {
  let last = -Infinity;
  const next = (time?: Tone.Unit.Time) => {
    const t = notLate(context, time);
    last = t > last ? t : last + 0.001;
    return last;
  };
  return Object.assign(next, {
    struck: (at: number) => {
      if (at > last) last = at;
    },
  });
}
