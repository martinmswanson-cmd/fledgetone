/**
 * Loudness targets for exports: where the file is going (streaming, a club, a game, broadcast)
 * sets how loud it should be. A file is turned up or down to its target; when getting there would
 * push the peaks over the ceiling, the master limiter's kernel (effects/limiter.ts) holds them
 * down instead, as a mastering engineer's limiter would, up to MAX_LIMITING_DB of gain reduction.
 */
import { createLimiterKernel, LIMITER_CEILING_DBTP } from './effects/limiter';
import { measureLoudness, normalizeGainDb } from './loudness';
import type { LoudnessReading } from './loudness';

export interface LoudnessTarget {
  id: string;
  name: string;
  lufs: number;
  about: string;
}

export const LOUDNESS_TARGETS: readonly LoudnessTarget[] = [
  { id: 'streaming', name: 'Streaming (-14 LUFS)', lufs: -14, about: 'Spotify, YouTube, Apple Music and SoundCloud play at about this loudness, so the file won’t be turned down or sound quiet next to other tracks.' },
  { id: 'loud', name: 'Loud: club and EDM (-9 LUFS)', lufs: -9, about: 'As loud as club and festival music is mastered. Streaming services turn it down to -14, so it only pays off for DJs and downloads.' },
  { id: 'game', name: 'Games (-16 LUFS)', lufs: -16, about: 'A common level for game music, leaving room for sound effects and voices on top.' },
  { id: 'podcast', name: 'Podcast and video voice-over (-16 LUFS)', lufs: -16, about: 'Under a voice, or in a podcast, which most apps play at this loudness.' },
  { id: 'broadcast', name: 'TV and broadcast (-23 LUFS)', lufs: -23, about: 'The European broadcast standard (EBU R128); US broadcast is -24.' },
];

export const DEFAULT_TARGET = 'streaming';

export const targetById = (id: string | undefined): LoudnessTarget => LOUDNESS_TARGETS.find((t) => t.id === id) ?? LOUDNESS_TARGETS[0];

/** The most the limiter turns peaks down to reach a target (more squashes the music). */
export const MAX_LIMITING_DB = 8;

/**
 * Bring `channels` (changed in place) to `target`. Returns the new reading, how many dB the
 * limiter took off the peaks (0: it wasn't needed), and how far under the target the file stayed
 * (0: on target) when reaching it would have needed more than MAX_LIMITING_DB.
 */
export async function reachTarget(
  channels: Float32Array[],
  sampleRate: number,
  reading: LoudnessReading,
  target: LoudnessTarget,
  signal?: AbortSignal
): Promise<{ reading: LoudnessReading; limitedDb: number; shortDb: number }> {
  const { gainDb, limited } = normalizeGainDb(reading, target.lufs, LIMITER_CEILING_DBTP);
  if (!limited) {
    const g = Math.pow(10, gainDb / 20);
    if (gainDb !== 0) for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
    return { reading: { ...reading, integrated: reading.integrated + gainDb, truePeakMax: reading.truePeakMax + gainDb }, limitedDb: 0, shortDb: 0 };
  }
  // Turn it up to the target (or as far as the limiter may go), then limit. Limiting takes a
  // little loudness off, so the gain is nudged once more after measuring.
  const wanted = target.lufs - reading.integrated;
  const most = gainDb + MAX_LIMITING_DB;
  const original = channels.map((ch) => ch.slice());
  let push = Math.min(wanted, most);
  let result = reading;
  for (let pass = 0; pass < 2; pass++) {
    limitInto(original, channels, sampleRate, push);
    result = await measureLoudness(channels, sampleRate, signal);
    const missing = target.lufs - result.integrated;
    if (Math.abs(missing) < 0.3 || push >= most) break;
    push = Math.min(most, push + missing);
  }
  return { reading: result, limitedDb: Math.max(0, push - gainDb), shortDb: Math.max(0, target.lufs - result.integrated) };
}

/** `out` = `source` turned up by `gainDb` through the look-ahead limiter, lined up in time. */
function limitInto(source: Float32Array[], out: Float32Array[], sampleRate: number, gainDb: number) {
  const kernel = createLimiterKernel(sampleRate);
  const g = Math.pow(10, gainDb / 20);
  const ceiling = Math.pow(10, LIMITER_CEILING_DBTP / 20);
  const n = source[0].length;
  const l = source[0];
  const r = source[1] ?? source[0];
  const block = 4096;
  const inL = new Float32Array(block);
  const inR = new Float32Array(block);
  const oL = new Float32Array(block);
  const oR = new Float32Array(block);
  const lat = kernel.latency;
  // The input runs `lat` samples past the end (silence), so the last of the sound comes out too
  for (let start = 0; start < n + lat; start += block) {
    const frames = Math.min(block, n + lat - start);
    for (let i = 0; i < frames; i++) {
      const at = start + i;
      inL[i] = at < n ? l[at] * g : 0;
      inR[i] = at < n ? r[at] * g : 0;
    }
    kernel.process(inL, inR, oL, oR, frames, ceiling, 0.08);
    for (let i = 0; i < frames; i++) {
      const at = start + i - lat;
      if (at < 0 || at >= n) continue;
      out[0][at] = oL[i];
      if (out[1]) out[1][at] = oR[i];
    }
  }
}
