/**
 * The live audio context, its Transport and its output, shared by every module in place of Tone's
 * global Tone.context / Tone.Transport / Tone.Destination.
 */
// After the playback mode has picked the live context's buffering (it may replace Tone's default)
import { PLAYBACK_MODE } from './playbackMode';
import * as Tone from 'tone';

/**
 * The live audio context, its Transport and its output. Use these, not Tone.Transport,
 * Tone.Destination or Tone.context: Tone makes those when it's imported, from its default
 * context, so with Stable playback (playbackMode.ts) they would belong to a context nothing
 * plays through. Tone.getContext() and friends follow the global context, which a WAV export
 * swaps for its offline one while it sets up; these never do.
 */
export const liveContext = Tone.getContext();
export const liveTransport = liveContext.transport;
export const liveDestination = liveContext.destination;

/**
 * How far ahead of the sound the Transport schedules notes: the start-up look-ahead, and a wider
 * one while the timeline plays and the page is struggling. A note is handed to the audio engine
 * the look-ahead before it's due; a page busy for longer than that (drawing, a big edit, the
 * browser tidying memory) made notes late, heard as a stutter. Wider, a busy moment is absorbed;
 * the price is that changes made while playing (a seek, a fader, a mute) take that much longer to
 * be heard, so it's only while needed, and back at Stop. Live playing isn't affected: keys and
 * MIDI play on the audio clock as they come (liveInput.ts).
 */
const baseLookAhead = (): number => (PLAYBACK_MODE === 'stable' ? 0.25 : 0.1);
const WIDE_LOOKAHEAD = 0.4;

/**
 * Change the look-ahead without moving what's already been set to happen. Tone keeps its own
 * timers (a sound's stop, a chord note handed over later) in look-ahead terms: due when the audio
 * clock plus the look-ahead reaches them. Left as they are, widening the look-ahead would make
 * each fire that much early: a sound let go 0.3 s too soon, which a note played straight after
 * can't take back, and stays silent. Moving them by the same amount keeps each on its time.
 */
function setLookAhead(next: number): void {
  const context = liveContext;
  const shift = next - context.lookAhead;
  const timeouts = (context as unknown as { _timeouts?: { forEach(fn: (event: { time: number }) => void): void } })._timeouts;
  // Every timer moves by the same amount, so their order stays as it was
  timeouts?.forEach((event) => {
    event.time += shift;
  });
  context.lookAhead = next;
}

/** Schedule further ahead (while playing). False if it already is. */
export function widenLookAhead(): boolean {
  if (liveContext.lookAhead >= WIDE_LOOKAHEAD - 1e-6) return false;
  setLookAhead(WIDE_LOOKAHEAD);
  return true;
}

/** Back to the start-up look-ahead (at Stop). */
export function restoreLookAhead(): void {
  if (Math.abs(liveContext.lookAhead - baseLookAhead()) > 1e-6) setLookAhead(baseLookAhead());
}

/** Scheduling further ahead than at start-up right now. */
export const lookAheadWidened = (): boolean => liveContext.lookAhead > baseLookAhead() + 1e-6;

/**
 * Where a sound that's already mixed and mastered plays live (a song rendered as it exports, for
 * the game previews): into the output after the master section, so it isn't compressed and limited
 * a second time.
 */
export const afterMaster = (): AudioNode => (liveDestination.output as unknown as { input: AudioNode }).input;
