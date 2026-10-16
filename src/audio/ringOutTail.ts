/**
 * Where a ring-out export ends: once its tails have died away. The render runs long enough for the
 * longest tail there can be (exportWav.ts: ringOutSeconds), then the file is cut where the mix
 * last stood above RING_OUT_FLOOR_DB, plus the end fade. A fixed length cut drum and cymbal tails
 * off at about -55 dB, while a short reverb left seconds of silence. Pure (samples in, a length
 * out), so a render's file length is a function of its sound, and Node can test it.
 */

/** The level (dBFS, RMS over RING_OUT_WINDOW across the channels) under which the tail is over. */
export const RING_OUT_FLOOR_DB = -70;
/** The windows the level is read over, in seconds. */
export const RING_OUT_WINDOW = 0.05;
/** The fade at the very end of a ring-out file, in seconds (it starts under the floor). */
export const RING_OUT_FADE_SECONDS = 0.3;
/** A ring-out file runs at least this long past its range, however quiet (seconds). */
export const RING_OUT_SHORTEST = 1;

/**
 * How many frames of `channels` a ring-out file keeps: through the last window above
 * `floorDb` (scaled by `gain`, the level the file will have), then RING_OUT_FADE_SECONDS for its
 * fade, and never less than `rangeFrames` (the range itself) plus RING_OUT_SHORTEST, nor more
 * than the render holds.
 */
export function ringOutLength(channels: readonly Float32Array[], sampleRate: number, rangeFrames: number, gain = 1, floorDb = RING_OUT_FLOOR_DB): number {
  const length = channels[0]?.length ?? 0;
  const window = Math.max(1, Math.round(RING_OUT_WINDOW * sampleRate));
  // Mean square (over the channels) a window must pass, at the file's level
  const floor = (10 ** (floorDb / 10) * channels.length) / (gain * gain);
  let loud = 0;
  for (let end = length; end > rangeFrames; end -= window) {
    const start = Math.max(0, end - window);
    let sum = 0;
    for (const ch of channels) for (let i = start; i < end; i++) sum += ch[i] * ch[i];
    if (sum / (end - start) > floor) {
      loud = end;
      break;
    }
  }
  const shortest = rangeFrames + Math.round(RING_OUT_SHORTEST * sampleRate);
  return Math.min(length, Math.max(shortest, loud + Math.round(RING_OUT_FADE_SECONDS * sampleRate)));
}
