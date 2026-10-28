/**
 * Holding a compressed file's decoded true peak under the ceiling. Encoding (MP3, Ogg Vorbis, a
 * video's AAC or Opus) moves the peaks a little, most on a dense, clipped master (up to about a
 * dB). Rather than limit every compressed export lower than its WAV (which took about a dB of
 * loudness and limiting from every MP3), the file is decoded and its true peak measured, and only
 * when it went over is the sound turned down by what it overshot and encoded again. Plain maths
 * around the encode and decode steps it's given, so Node tests it.
 */
import { limiterAimDbtp } from './effects/limiter';
import { truePeakOf } from './loudness';

/** How far a file is turned down when it can't be decoded to measure (dB): about the most encoding overshoots. */
export const BLIND_TRIM_DB = 1;
/** Encodes at most this many times. */
const PASSES = 3;

/**
 * `encode(gain)` the sound turned by `gain`, then `decode` what it made; while the decoded true peak
 * is over `ceilingDbtp`, turn down by the overshoot and encode again. Returns the last encoding and
 * how far it was turned down (dB, 0: not at all). Where `decode` gives nothing (the browser can't
 * decode it), the sound is turned down BLIND_TRIM_DB once instead.
 */
export async function holdDecodedPeak<T>(encode: (gain: number) => Promise<T>, decode: (encoded: T) => Promise<readonly Float32Array[] | null>, ceilingDbtp: number): Promise<{ encoded: T; trimDb: number }> {
  const ceiling = 10 ** (ceilingDbtp / 20);
  // Turned down to a hair under it, as the limiter aims (limiterAimDbtp)
  const aim = 10 ** (limiterAimDbtp(ceilingDbtp) / 20);
  let gain = 1;
  let encoded = await encode(gain);
  for (let pass = 1; pass < PASSES; pass++) {
    const decoded = await decode(encoded);
    if (!decoded) {
      if (pass === 1) {
        gain = 10 ** (-BLIND_TRIM_DB / 20);
        encoded = await encode(gain);
      }
      break;
    }
    const peak = truePeakOf(decoded);
    if (!(peak > ceiling)) break;
    gain *= aim / peak;
    encoded = await encode(gain);
  }
  return { encoded, trimDb: gain < 1 ? -20 * Math.log10(gain) : 0 };
}

/** `channels` turned by `gain` (copies; the same arrays at a gain of 1). */
export function turned(channels: readonly Float32Array[], gain: number): Float32Array[] {
  if (gain === 1) return [...channels];
  return channels.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) out[i] = ch[i] * gain;
    return out;
  });
}
