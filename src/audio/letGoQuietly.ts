/**
 * Letting go of live sound without cutting it dead. A track given another instrument (or another
 * sound, a kind, a freeze) or deleted while the song plays used to have its instrument disposed
 * the moment it was released: its notes stopped mid-wave, a click many times the music's largest
 * step, and the Synth Designer's 50 ms release never played. Now the instrument is released, rings
 * out through a feed of its own into the channel, which fades to silence, and is disposed once
 * the audio has got past that (see liveTracks.ts). A deleted track's whole channel fades out
 * first, then goes.
 *
 * Pure (numbers in, numbers out) so Node can test it.
 */

/** An instrument let go of: its feed holds this long for the voices' own release (30-150 ms)... */
export const RETIRE_HOLD = 0.15;
/** ...then fades to silence over this (a cymbal ringing on, a pad's long release)... */
export const RETIRE_FADE = 0.5;
/** ...and it's disposed this long after it was let go of. */
export const RETIRE_SECONDS = 1;
/** A deleted track's channel (its output and every send) fades out over this, then goes. */
export const DELETE_FADE = 0.02;

/** The let-go instrument's feed, from `at` (audio clock): full level until `hold`, silent at `silent`, disposed at `dispose`. */
export function retirePlan(at: number): { hold: number; silent: number; dispose: number } {
  return { hold: at + RETIRE_HOLD, silent: at + RETIRE_HOLD + RETIRE_FADE, dispose: at + RETIRE_SECONDS };
}

/**
 * Whether a change to a channel at `now` could be heard: only while the audio runs, and the song
 * plays or something played into the channel may still ring (`ringsUntil`, audio clock). When it
 * can't (a song opened before the first Play, the audio not started yet), delay compensation is
 * set straight to its new length rather than gliding there over a second or more: glided on a
 * clock that isn't running, the glide was heard on the first Play, the tracks early and bending.
 */
export function mayBeHeard(o: { running: boolean; playing: boolean; now: number; ringsUntil: number }): boolean {
  return o.running && (o.playing || o.now < o.ringsUntil);
}
