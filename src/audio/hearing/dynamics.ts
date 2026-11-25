/**
 * How loud a sound is and how much that changes, for the hearing report: integrated and loudest
 * short-term loudness, true peak, crest factor, the 3-second loudness read once a second, and the
 * loudness range from it. Measured as `measureAudio` in the command line tool does. Plain maths on
 * samples, no Web Audio, so Node can test it.
 */
import { createLoudnessAnalyser, shortTermWindowFull } from '../loudness';
import type { Dynamics } from './types';

const round1 = (x: number) => Math.round(x * 10) / 10;
/** A reading rounded to 0.1, or null when it is not a number (silence reads as minus infinity). */
const reading = (x: number): number | null => (Number.isFinite(x) ? round1(x) : null);

/** The value below which `fraction` of the sorted `values` lie, interpolated. */
function percentile(sorted: readonly number[], fraction: number): number {
  const at = fraction * (sorted.length - 1);
  const i = Math.floor(at);
  const next = Math.min(sorted.length - 1, i + 1);
  return sorted[i] + (sorted[next] - sorted[i]) * (at - i);
}

/** Loudness range, LU: short-term values over -70 LUFS and within 20 LU of their power mean, 95th minus 10th percentile; null under 5 values. */
function rangeOf(shortTerm: ReadonlyArray<number | null>): number | null {
  const loud = shortTerm.filter((v): v is number => v !== null && v > -70);
  if (loud.length === 0) return null;
  const mean = 10 * Math.log10(loud.reduce((s, v) => s + 10 ** (v / 10), 0) / loud.length);
  const kept = loud.filter((v) => v >= mean - 20).sort((a, b) => a - b);
  if (kept.length < 5) return null;
  return round1(Math.max(0, percentile(kept, 0.95) - percentile(kept, 0.1)));
}

/** The loudness of `channels`; anything that can't be had (silence, too short) is null, never NaN. */
export function dynamicsOf(
  channels: readonly Float32Array[],
  sampleRate: number
): Dynamics & { shortTerm: Array<number | null> } {
  const left = channels[0] ?? new Float32Array(0);
  // A mono signal is fed with the right channel as zeros, as measureAudio does
  const right = channels[1] ?? new Float32Array(left.length);
  const analyser = createLoudnessAnalyser(sampleRate);
  // Fed in tenths of a second so short-term loudness can be read on the way
  const hop = Math.max(1, Math.round(sampleRate / 10));
  const shortTerm: Array<number | null> = [];
  let shortTermMax: number | null = null;
  let reads = 0;
  for (let i = 0; i < left.length; i += hop) {
    const n = Math.min(hop, left.length - i);
    analyser.feed(left.subarray(i, i + n), right.subarray(i, i + n), n);
    if (!shortTermWindowFull(i + n, sampleRate)) continue;
    const now = analyser.read().shortTerm;
    if (Number.isFinite(now) && (shortTermMax === null || now > shortTermMax)) shortTermMax = now;
    // Once a second, the first at 3 s
    if (reads++ % 10 === 0) shortTerm.push(reading(now));
  }
  const read = analyser.read();
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (const ch of channels.slice(0, 2)) {
    for (const v of ch) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    count += ch.length;
  }
  const crest = peak > 0 ? 20 * Math.log10(peak) - 10 * Math.log10(sum / count) : NaN;
  return {
    lufs: reading(read.integrated),
    shortTermMaxLufs: shortTermMax === null ? null : round1(shortTermMax),
    truePeakDbtp: reading(read.truePeakMax),
    crestDb: reading(crest),
    rangeLu: rangeOf(shortTerm),
    shortTerm,
  };
}
