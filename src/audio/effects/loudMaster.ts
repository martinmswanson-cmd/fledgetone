/**
 * The Loud master: the master path that makes a song hit at club loudness without falling apart.
 *   (mono below 120 Hz, however the Width is set) -> (a sub tilt: a low shelf at 90 Hz)
 *   -> Level + push -> clipper (soft knee, 4x oversampled: clipper.ts) -> true-peak limiter (-1 dBTP)
 * "Push" is the gain into the clipper and limiter that brings the song to its loudness target
 * (Streaming -14, Loud -9, Club -6 LUFS). An export finds it afresh by measuring and adjusting
 * (matchPush: a few passes of the clipper and limiter over the finished render, each measured to
 * BS.1770); live playback plays the push the last match found, so it sounds as the export does.
 * The clipper shaves the drum peaks, the limiter holds what's left under the ceiling: the two
 * share the work. How hard they may work is capped by what they do to the waveform: past
 * MAX_DISTORTION_DB of distortion (what's left of the sound once its gain, block by block, is taken
 * out: the crunch, not the level riding) a mix stops short of its target, and the export says so.
 * The clipper's job in bass music is mostly the sub and the kick (a limiter alone can't get a
 * sub-heavy drop past about -10 LUFS: it follows every cycle of the bass); MAX_DISTORTION_DB lets it
 * shave them hard enough for Club loudness on a dense drop, not so hard that the mids crackle.
 *
 * Plain maths, no Web Audio, so Node tests it; masterAfter.ts runs it in exports and masterChain.ts
 * builds the same path with nodes live.
 */
import type { ClipperSettings } from './clipper';
import { clipChannels } from './clipper';
import { createLimiterKernel, limitChannels } from './limiter';
import { createLoudnessAnalyser } from '../loudness';
import type { HitStyleId } from '../hitTargets';
import { LOUD_PUSH_MAX, LOUD_PUSH_MIN, type LoudTargetId, type MasterSettings } from '../../store/timelineTypes';

export interface LoudTarget {
  id: LoudTargetId;
  name: string;
  lufs: number;
  about: string;
}

export const LOUD_TARGETS: Record<LoudTargetId, LoudTarget> = {
  streaming: { id: 'streaming', name: 'Streaming (-14 LUFS)', lufs: -14, about: 'Where streaming services play everything: keeps every bit of punch.' },
  loud: { id: 'loud', name: 'Loud (-9 LUFS)', lufs: -9, about: 'Loud electronic music: future bass, house, pop EDM.' },
  club: { id: 'club', name: 'Club (-6 LUFS)', lufs: -6, about: 'As loud as bass music and hardcore are mastered: dubstep, drumstep, riddim, hardstyle.' },
};

/** The target that suits a "Does it hit?" style: Club for bass music and hardcore, Loud for future bass. */
export const styleLoudTarget = (style: HitStyleId | undefined): LoudTargetId => (style === 'futurebass' ? 'loud' : 'club');

/** The clipper the Loud master uses (unless the Clipper insert is on: then that one, as set). */
export const LOUD_CLIPPER: ClipperSettings = { on: true, drive: 0, softness: 0.5, ceiling: -0.5 };
/** The sub tilt's low shelf, Hz. */
export const LOUD_SHELF_HZ = 90;
/** How close to the target a match aims, LU. */
export const MATCH_TOLERANCE = 0.15;
/** The most passes a match takes. */
const MATCH_PASSES = 8;
/**
 * The most distortion a match allows, dB under the sound (see distortionDb). Measured on the demo
 * drops: -24 dB is a dubstep drop at about -8 LUFS (the clipper shaving the kick and the sub),
 * -20 dB about -6.7 LUFS (the growl starting to fizz); past -18 dB the mids crackle.
 */
export const MAX_DISTORTION_DB = -21;

/** Whether the lows are kept in the middle: the Mono below 120 Hz switch, or a Loud master. */
export const monoLowOn = (m: Pick<MasterSettings, 'monoLow' | 'loud'>): boolean => m.monoLow === true || m.loud?.on === true;

/** The Stereo width as it plays: the Width's own, with mono lows forced on; mono lows alone are a width of 100% with the bass in the middle; null: nothing to do. */
export function effectiveWidth(m: Pick<MasterSettings, 'width' | 'monoLow' | 'loud'>): MasterSettings['width'] | null {
  if (m.width.on) return monoLowOn(m) && !m.width.monoBass ? { ...m.width, monoBass: true } : m.width;
  return monoLowOn(m) ? { on: true, amount: 1, monoBass: true } : null;
}

/** The clipper as it plays: a Loud master's (the Clipper insert's settings when that's on), else the insert's. */
export function effectiveClipper(m: Pick<MasterSettings, 'clipper' | 'loud'>): ClipperSettings | undefined {
  if (m.clipper?.on) return m.clipper;
  return m.loud?.on ? LOUD_CLIPPER : undefined;
}

/** The sub tilt in dB (0: none, or not a Loud master). */
export const subTiltDb = (m: Pick<MasterSettings, 'loud'>): number => (m.loud?.on ? m.loud.subTilt : 0);

/** The push live playback plays (0 unless a Loud master). */
export const pushDb = (m: Pick<MasterSettings, 'loud'>): number => (m.loud?.on ? m.loud.push : 0);
/**
 * The push live playback uses: the Loud master's, but never above 0 dB while the listening path's
 * safety limiter and level matching aren't in (monitor.ts), so nothing plays louder without them.
 */
export const livePushDb = (m: Pick<MasterSettings, 'loud'>, listeningSafe: boolean): number => (listeningSafe ? pushDb(m) : Math.min(0, pushDb(m)));

/**
 * A BiquadFilterNode's low-shelf coefficients [b0, b1, b2, a1, a2] (normalized), as the Web Audio
 * spec gives them (shelf slope 1) from the params' single-precision values.
 */
export function webAudioLowshelf(hz: number, gainDb: number, sampleRate: number): Float64Array {
  const f = Math.min(Math.fround(hz), sampleRate / 2);
  const A = Math.pow(10, Math.fround(gainDb) / 40);
  const w = (2 * Math.PI * f) / sampleRate;
  const cosw = Math.cos(w);
  const alpha = (Math.sin(w) / 2) * Math.SQRT2;
  const k = 2 * Math.sqrt(A) * alpha;
  const b0 = A * (A + 1 - (A - 1) * cosw + k);
  const b1 = 2 * A * (A - 1 - (A + 1) * cosw);
  const b2 = A * (A + 1 - (A - 1) * cosw - k);
  const a0 = A + 1 + (A - 1) * cosw + k;
  const a1 = -2 * (A - 1 + (A + 1) * cosw);
  const a2 = A + 1 + (A - 1) * cosw - k;
  return Float64Array.of(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

/** Integrated loudness of a stereo signal (LUFS), without the true peak. */
export function integratedLufs(left: Float32Array, right: Float32Array, sampleRate: number): number {
  const a = createLoudnessAnalyser(sampleRate, undefined, undefined, false);
  a.feed(left, right, left.length);
  return a.read().integrated;
}

/**
 * How far the waveform of `outL` / `outR` (the clipper and limiter's output, `delay` samples late)
 * is from `inL` / `inR` (what went in) once the gain is taken out 20 ms at a time, dB under the
 * sound: the distortion they added, not the level riding. -Infinity: untouched.
 */
export function distortionDb(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, sampleRate: number, delay: number): number {
  const block = Math.max(1, Math.round(sampleRate * 0.02));
  let res = 0;
  let sig = 0;
  for (let start = 0; start + delay < outL.length; start += block) {
    const end = Math.min(inL.length, start + block, outL.length - delay);
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let i = start; i < end; i++) {
      const x = inL[i] + inR[i];
      const y = outL[i + delay] + outR[i + delay];
      xy += x * y;
      xx += x * x;
      yy += y * y;
    }
    if (xx <= 1e-12) continue;
    // y = g x + e, least squares: what's left is e
    const g = xy / xx;
    res += Math.max(0, yy - g * xy);
    sig += g * xy;
  }
  return res > 0 && sig > 0 ? 10 * Math.log10(res / sig) : -Infinity;
}

/** The clipper then the limiter over a copy of `left` / `right` turned up by `gainDb`; the copy back. */
export function clipAndLimit(left: Float32Array, right: Float32Array, sampleRate: number, gainDb: number, clipper: ClipperSettings | undefined, ceilingDbtp: number): [Float32Array, Float32Array] {
  const g = Math.fround(10 ** (gainDb / 20));
  const l = new Float32Array(left.length);
  const r = new Float32Array(right.length);
  for (let i = 0; i < l.length; i++) {
    l[i] = left[i] * g;
    r[i] = right[i] * g;
  }
  if (clipper?.on) clipChannels(l, r, sampleRate, clipper);
  limitChannels(l, r, sampleRate, ceilingDbtp);
  return [l, r];
}

/** What a match found. */
export interface LoudMatch {
  /** The push that got there (dB into the clipper and limiter). */
  push: number;
  /** Where it got to, LUFS. */
  lufs: number;
  targetLufs: number;
  /** How far under the target it stopped (0: on target), and whether because the push was at its most or it would have distorted. */
  shortDb: number;
  capped: boolean;
  /** The distortion at the push found (see distortionDb). */
  distortionDb: number;
  passes: number;
}

/**
 * The push an export should store for live playback, or null to leave the Loud master's push as it
 * is. Only an export of the whole song (not a loop, game loop or underscore / no-drums version) at
 * the Loud master's own target says what the live push should be: anything else found a push for
 * other music or another loudness.
 */
export function pushToKeep(o: {
  /** The whole song, bar 1 to the end. */
  wholeSong: boolean;
  /** The full mix (not a version with tracks left out). */
  fullMix: boolean;
  /** The export's target and the Loud master's, LUFS. */
  exportTargetLufs: number;
  loudTargetLufs: number;
  found: LoudMatch | undefined;
  currentPush: number;
}): number | null {
  const { found } = o;
  if (!o.wholeSong || !o.fullMix || !found || !Number.isFinite(found.lufs) || !Number.isFinite(found.push)) return null;
  if (Math.abs(o.exportTargetLufs - o.loudTargetLufs) > 1e-6) return null;
  return Math.abs(found.push - o.currentPush) > 0.05 ? found.push : null;
}

/**
 * The push (dB, on top of `levelDb`) that brings `left` / `right` (the master section's sound up to
 * the Level) to `targetLufs` through the clipper and the limiter. Each pass runs them and measures;
 * the next guess divides what's missing by how much of the last change came through (clipping
 * and limiting take some of it). `start` is where to begin (the push found last time).
 */
export function matchPush(left: Float32Array, right: Float32Array, sampleRate: number, levelDb: number, targetLufs: number, clipper: ClipperSettings | undefined, ceilingDbtp: number, start?: number): LoudMatch {
  const dry = integratedLufs(left, right, sampleRate);
  if (!Number.isFinite(dry)) return { push: 0, lufs: dry, targetLufs, shortDb: 0, capped: false, distortionDb: -Infinity, passes: 0 };
  const delay = createLimiterKernel(sampleRate).latency;
  // The push is searched between `lo` and `hi`: under `hi` it's clean, at `hi` (once found) it isn't
  let lo = LOUD_PUSH_MIN;
  let hi = LOUD_PUSH_MAX;
  let cleanHi = true;
  const clamp = (v: number) => Math.max(lo, Math.min(hi, v));
  let push = clamp(start ?? targetLufs - dry - levelDb);
  let prev: { push: number; lufs: number } | null = null;
  let passes = 0;
  let best: { push: number; lufs: number; dist: number } | null = null;
  const score = (b: { lufs: number }) => Math.abs(targetLufs - b.lufs);
  while (passes < MATCH_PASSES) {
    const [l, r] = clipAndLimit(left, right, sampleRate, levelDb + push, clipper, ceilingDbtp);
    const lufs = integratedLufs(l, r, sampleRate);
    const dist = distortionDb(left, right, l, r, sampleRate, delay);
    passes++;
    const clean = dist <= MAX_DISTORTION_DB;
    if (!clean) {
      // Too far: the push stays under this from now on (halfway back towards the last clean one)
      hi = push;
      cleanHi = false;
      const below = best ? best.push : Math.max(lo, push - 6);
      if (hi - below < 0.2) break;
      prev = null;
      push = (below + hi) / 2;
      continue;
    }
    if (!best || score({ lufs }) < score(best) || (lufs < targetLufs && best.lufs < targetLufs && lufs > best.lufs)) best = { push, lufs, dist };
    if (lufs < targetLufs) lo = push;
    else hi = Math.min(hi, push);
    const missing = targetLufs - lufs;
    if (Math.abs(missing) < MATCH_TOLERANCE) break;
    if (missing > 0 && push >= hi - 1e-9) break;
    if (missing < 0 && push <= lo + 1e-9) break;
    const through = prev && push !== prev.push ? (lufs - prev.lufs) / (push - prev.push) : 0.85;
    prev = { push, lufs };
    let next = push + missing / Math.max(0.2, Math.min(1, through));
    // Within what's known (and short of a push that distorted)
    next = Math.max(lo, Math.min(cleanHi ? hi : hi - 0.05, next));
    if (Math.abs(next - push) < 0.02) break;
    push = next;
  }
  if (!best) {
    // Nothing clean at all (it distorts at any push it tried): the least push tried
    const [l, r] = clipAndLimit(left, right, sampleRate, levelDb + lo, clipper, ceilingDbtp);
    best = { push: lo, lufs: integratedLufs(l, r, sampleRate), dist: distortionDb(left, right, l, r, sampleRate, delay) };
  }
  const shortDb = Math.max(0, targetLufs - best.lufs);
  const short = shortDb >= MATCH_TOLERANCE;
  return { push: Math.round(best.push * 100) / 100, lufs: best.lufs, targetLufs, shortDb: short ? shortDb : 0, capped: short && (best.push >= LOUD_PUSH_MAX - 1e-9 || !cleanHi), distortionDb: best.dist, passes };
}
