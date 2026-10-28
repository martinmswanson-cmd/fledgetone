/**
 * Holding a compressed file's decoded true peak under the ceiling. Encoding (MP3, Ogg Vorbis, a
 * video's AAC or Opus) moves the peaks a little, most on a dense, clipped master (up to about two
 * dB). Rather than limit every compressed export lower than its WAV (which took about a dB of
 * loudness and limiting from every MP3), the file is decoded and its true peak measured, and only
 * when it went over is the sound turned down by what it overshot and encoded again. Every encoding
 * that's kept has been measured: an encoder doesn't scale its peaks with the gain it's given (LAME
 * turned down 0.2 dB can come out higher), so each pass aims a little lower than the last until
 * one decodes under the ceiling. Plain maths around the encode and measure steps it's given, so
 * Node tests it.
 */
import { limiterAimDbtp } from './effects/limiter';
import { createPeakFinder, TRUE_PEAK_PLAN } from './truePeakFilter';

/**
 * How far a file is turned down when it can't be decoded to measure (dB), by what's being made:
 * a little over the most each format was seen to overshoot (MP3 at 320 kb/s up to about 1.8 dB on
 * a dense, clipped mix; Ogg Vorbis about 0.7; a video's sound about 1.2).
 */
export const BLIND_TRIM_DB = { mp3: 2, ogg: 1, video: 2 } as const;
/**
 * How much lower than the limiter's aim each pass aims (dB): the first by nothing, then lower each
 * time an encoding still came out over. More passes than this keep the last step.
 */
const PASS_MARGINS_DB = [0, 0.1, 0.25, 0.5, 1, 2];
/** Encodes at most this many times (the last ones only on a pathological sound). */
const PASSES = 8;

export interface HoldOptions {
  /** Turned down this far, unmeasured, where the sound can't be decoded (dB: see BLIND_TRIM_DB). */
  blindTrimDb: number;
  signal?: AbortSignal;
}

/** What holding a compressed file under its ceiling did: how far it was turned down (dB, 0: not at all) and its decoded true peak (dBTP; null: it couldn't be decoded to measure). */
export interface HeldReport {
  trimDb: number;
  peakDbtp: number | null;
}

export interface Held<T> {
  encoded: T;
  /** How far it was turned down (dB, 0: not at all). */
  trimDb: number;
  /** Its decoded true peak, dBTP (null: it couldn't be decoded, and was turned down blind). */
  peakDbtp: number | null;
}

/**
 * `encode(gain)` the sound turned by `gain`, then `measure` the decoded true peak of what it made
 * (linear; null where it can't be decoded). While that's over `ceilingDbtp`, turn down by the
 * overshoot (and a margin growing with every pass) and encode again. Returns the first encoding
 * that measured under the ceiling. Where it can't be measured, the sound is turned down
 * `blindTrimDb` past the last measurement (or from where it started) instead.
 */
export async function holdDecodedPeak<T>(encode: (gain: number) => Promise<T>, measure: (encoded: T) => Promise<number | null>, ceilingDbtp: number, opts: HoldOptions): Promise<Held<T>> {
  const ceiling = 10 ** (ceilingDbtp / 20);
  // Turned down to a hair under it, as the limiter aims (limiterAimDbtp)
  const aimDb = limiterAimDbtp(ceilingDbtp);
  const result = (encoded: T, gain: number, peak: number | null): Held<T> => ({ encoded, trimDb: gain < 1 ? -20 * Math.log10(gain) : 0, peakDbtp: peak === null ? null : 20 * Math.log10(peak) });
  let gain = 1;
  for (let pass = 0; ; pass++) {
    opts.signal?.throwIfAborted();
    const encoded = await encode(gain);
    opts.signal?.throwIfAborted();
    const peak = await measure(encoded);
    opts.signal?.throwIfAborted();
    if (peak === null) {
      // Can't be measured: turned down blind, past where this one went over (if one was measured)
      gain *= 10 ** (-opts.blindTrimDb / 20);
      return result(await encode(gain), gain, null);
    }
    if (!(peak > ceiling)) return result(encoded, gain, peak);
    if (pass === PASSES - 1) {
      // Still over after every pass (never seen): down by twice the overshoot and the last margin, blind
      gain *= (ceiling / peak) ** 2 * 10 ** (-(PASS_MARGINS_DB[PASS_MARGINS_DB.length - 1] + opts.blindTrimDb) / 20);
      return result(await encode(gain), gain, null);
    }
    const margin = PASS_MARGINS_DB[Math.min(pass, PASS_MARGINS_DB.length - 1)];
    gain *= 10 ** ((aimDb - margin) / 20) / peak;
  }
}

/** Samples measured between breaths, so a long song's measuring never holds the page up for long. */
const MEASURE_CHUNK = 1 << 17;

/**
 * The true peak of `channels` (linear), as truePeakOf (loudness.ts) finds it, measured in pieces
 * with a breath between them: the page stays responsive (a Cancel is seen) while a long song's
 * decoded file is measured.
 */
export async function truePeakInPieces(channels: readonly Float32Array[], signal?: AbortSignal): Promise<number> {
  let peak = 0;
  for (const ch of channels) {
    const finder = createPeakFinder(TRUE_PEAK_PLAN);
    for (let from = 0; from < ch.length; from += MEASURE_CHUNK) {
      const to = Math.min(ch.length, from + MEASURE_CHUNK);
      for (let i = from; i < to; i++) {
        const x = ch[i];
        const a = x < 0 ? -x : x;
        if (a > peak) peak = a;
        finder.push(x);
        const v = finder.peak(peak);
        if (v > peak) peak = v;
      }
      if (to < ch.length) {
        await new Promise((r) => setTimeout(r, 0));
        signal?.throwIfAborted();
      }
    }
  }
  return peak;
}

/**
 * A true peak measured as the samples arrive (a decoder handing them over a piece at a time): no
 * copy of the whole decoded sound is kept. `push` each channel's next piece; `peak` is the highest so far.
 */
export function streamingTruePeak(): { push: (channel: number, samples: Float32Array) => void; peak: () => number } {
  const finders: ReturnType<typeof createPeakFinder>[] = [];
  let peak = 0;
  return {
    push(channel, samples) {
      const finder = (finders[channel] ??= createPeakFinder(TRUE_PEAK_PLAN));
      for (let i = 0; i < samples.length; i++) {
        const x = samples[i];
        const a = x < 0 ? -x : x;
        if (a > peak) peak = a;
        finder.push(x);
        const v = finder.peak(peak);
        if (v > peak) peak = v;
      }
    },
    peak: () => peak,
  };
}
