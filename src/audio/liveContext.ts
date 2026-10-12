// After the playback mode has picked the live context's buffering (it may replace Tone's default)
import './playbackMode';
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
