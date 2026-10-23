/**
 * The Loud master: the master path that makes a song hit at club loudness without falling apart.
 *   (mono below 120 Hz, however the Width is set) -> (a sub tilt: a low shelf at 90 Hz)
 *   -> Level + push -> clipper (soft knee, 4x oversampled: clipper.ts) -> true-peak limiter (-1 dBTP)
 * "Push" is the gain into the clipper and limiter that brings the song to its loudness target
 * (Streaming -14, Loud -9, Club -6 LUFS). An export finds it afresh by measuring and adjusting
 * (matchPush: a few passes of the clipper and limiter over the finished render, each measured to
 * BS.1770; a long song that needs more than two goes on with a quarter of it, checked on the whole); live playback plays the push the last match found, so it sounds as the export does.
 * The clipper shaves the drum peaks, the limiter holds what's left under the ceiling: the two
 * share the work. How hard they may work is capped by what they do to the waveform: past
 * MAX_DISTORTION_DB of distortion (what's left of the sound once its gain, block by block, is taken
 * out: the crunch, not the level riding) a mix stops short of its target, and the export says so.
 * The clipper's job in bass music is mostly the sub and the kick (a limiter alone can't get a
 * sub-heavy drop past about -10 LUFS: it follows every cycle of the bass); MAX_DISTORTION_DB lets it
 * shave them hard enough for Club loudness on a dense drop, not so hard that the mids crackle.
 * Crunch (LoudSettings.crunch) is the choice to go further on purpose: it lets a match use up to
 * CRUNCH_MAX_DISTORTION_DB of distortion and hardens the clipper's knee towards a flat top, so a
 * dense drop reaches Club loudness and the clipping is heard as crunch. The -1 dBTP limiter stays
 * last either way, and what you hear stays level-matched (monitor.ts).
 *
 * Plain maths, no Web Audio, so Node tests it; masterAfter.ts runs it in exports and masterChain.ts
 * builds the same path with nodes live.
 */
import type { ClipperSettings } from './clipper';
import { clipChannels } from './clipper';
import { createLimiterKernel, LIMITER_CEILING_DBTP, limitChannels } from './limiter';
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
/**
 * The most distortion a match allows at full Crunch, dB under the sound: about where a dense drop
 * reaches -6 LUFS with the clipper's flat tops heard as crunch on the kick, the bass and the snare
 * (the reference drops the Loud master was measured against sit near -9 dB of it at -7 LUFS).
 */
export const CRUNCH_MAX_DISTORTION_DB = -9;

/** How much lower the Loud master's clipper clips at full Crunch, dB (under the ceiling it clips at for the limiter's: see effectiveClipper). */
export const CRUNCH_CLIP_LOWER_DB = 0.5;
/**
 * How far under the limiter's ceiling (dBTP) a crunching clipper clips, dB, before Crunch lowers
 * it further. With Crunch the clipper is the band kind (clipper.ts), whose true peaks land 1 to 2
 * dB over where it clips on a dense drop: clipping this far under the ceiling leaves the limiter
 * idle nearly all the time (on the drop it was measured on, working in 3% of 10 ms blocks instead
 * of 92%), so it no longer pulls the whole mix down after every kick and snare.
 */
export const CRUNCH_CLIP_UNDER_DB = 0.5;

/** The Crunch Pocket's Crunch button sets (the studio's slider goes anywhere from 0 to 1). */
export const POCKET_CRUNCH = 0.7;

/** The Crunch of a Loud master, 0 to 1 (0: none, or not a Loud master). */
export const loudCrunch = (m: Pick<MasterSettings, 'loud'>): number => (m.loud?.on ? Math.max(0, Math.min(1, m.loud.crunch ?? 0)) : 0);

/** The most distortion a match of this master allows (see MAX_DISTORTION_DB and Crunch). */
export const loudMaxDistortionDb = (m: Pick<MasterSettings, 'loud'>): number => MAX_DISTORTION_DB + loudCrunch(m) * (CRUNCH_MAX_DISTORTION_DB - MAX_DISTORTION_DB);

/** Whether the lows are kept in the middle: the Mono below 120 Hz switch, or a Loud master. */
export const monoLowOn = (m: Pick<MasterSettings, 'monoLow' | 'loud'>): boolean => m.monoLow === true || m.loud?.on === true;

/** The Stereo width as it plays: the Width's own, with mono lows forced on; mono lows alone are a width of 100% with the bass in the middle; null: nothing to do. */
export function effectiveWidth(m: Pick<MasterSettings, 'width' | 'monoLow' | 'loud'>): MasterSettings['width'] | null {
  if (m.width.on) return monoLowOn(m) && !m.width.monoBass ? { ...m.width, monoBass: true } : m.width;
  return monoLowOn(m) ? { on: true, amount: 1, monoBass: true } : null;
}

/**
 * The clipper as it plays: a Loud master's (the Clipper insert's settings when that's on), else the
 * insert's. With Crunch the Loud master's knee hardens towards a flat top, it's the band kind (the
 * whole sound oversampled and clipped twice, so its peaks between samples stay near where it
 * clips: ClipperSettings.band) and it clips a little under the limiter's ceiling (`ceilingDbtp`:
 * live and WAV -1, MP3 lower, see exportCeilingDbtp), so the clipper does all the work and the
 * limiter after it next to none: the mix doesn't pump with the drums. (Before, the plain clipper's
 * output overshot the limiter by up to 6 dB on a dense drop, and the limiter pulled the whole mix
 * down 2 to 5 dB after every kick and snare.)
 */
export function effectiveClipper(m: Pick<MasterSettings, 'clipper' | 'loud'>, ceilingDbtp = LIMITER_CEILING_DBTP): ClipperSettings | undefined {
  if (m.clipper?.on) return m.clipper;
  if (!m.loud?.on) return undefined;
  const crunch = loudCrunch(m);
  // (No Crunch: the Loud master's own, exactly)
  if (!(crunch > 0)) return LOUD_CLIPPER;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { ...LOUD_CLIPPER, softness: round(LOUD_CLIPPER.softness * (1 - crunch)), ceiling: round(ceilingDbtp - CRUNCH_CLIP_UNDER_DB - crunch * CRUNCH_CLIP_LOWER_DB), band: true };
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
  /** How many times the clipper and limiter ran (over the song, or a long song's sample). */
  passes: number;
}

/**
 * The push an export should store for live playback, or null to leave the Loud master's push as it
 * is. Only an export of the whole song (not a loop, game loop or underscore / no-drums version) at
 * the Loud master's own target, limited at the live ceiling (-1 dBTP, a WAV's), says what the live push
 * should be: anything else found a push for other music, another loudness, or a lower ceiling (an
 * MP3's, lower still with Crunch, would play live about a dB hotter than the export).
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
  /** The export's true-peak ceiling, dBTP (exportCeilingDbtp). */
  ceilingDbtp: number;
}): number | null {
  const { found } = o;
  if (!o.wholeSong || !o.fullMix || !found || !Number.isFinite(found.lufs) || !Number.isFinite(found.push)) return null;
  if (Math.abs(o.exportTargetLufs - o.loudTargetLufs) > 1e-6) return null;
  if (Math.abs(o.ceilingDbtp - LIMITER_CEILING_DBTP) > 1e-6) return null;
  return Math.abs(found.push - o.currentPush) > 0.05 ? found.push : null;
}

/**
 * Whether a Loud master is still the one a match rendered: switched on, at the same target, with the
 * same Crunch. An undo, a redo or the Crunch button pressed while a match ran changes what the push
 * it found is for, so it isn't kept.
 */
export function sameLoudMatch(rendered: MasterSettings['loud'] | undefined, now: MasterSettings['loud'] | undefined): boolean {
  if (!rendered?.on || !now?.on) return false;
  return rendered.target === now.target && loudCrunch({ loud: rendered }) === loudCrunch({ loud: now });
}

/** What one try of a push measured: its loudness (LUFS) and distortion (dB, see distortionDb). */
interface Tried {
  push: number;
  lufs: number;
  dist: number;
}

/** Where a search of the push ended (see searchPush). */
interface Searched {
  best: Tried | null;
  lo: number;
  hi: number;
  cleanHi: boolean;
  passes: number;
  /** The last try, and whether the search finished (rather than ran out of passes). */
  last: Tried | null;
  done: boolean;
}

/**
 * The search itself: from `start`, each try measured by `measure`; the next guess divides what's
 * missing by how much of the last change came through (clipping and limiting take some of it).
 * Past `maxDist` of distortion a push is too far, and the search halves back towards the last
 * clean one.
 */
function searchPush(measure: (push: number) => Tried, targetLufs: number, maxDist: number, start: number, most = MATCH_PASSES, known?: { lo: number; hi: number; cleanHi: boolean }): Searched {
  // The push is searched between `lo` and `hi`: under `hi` it's clean, at `hi` (once found) it isn't
  // (`known`: what an earlier search found)
  let lo = known ? known.lo : LOUD_PUSH_MIN;
  let hi = known ? known.hi : LOUD_PUSH_MAX;
  let cleanHi = known ? known.cleanHi : true;
  let push = Math.max(lo, Math.min(hi, start));
  let prev: { push: number; lufs: number } | null = null;
  let passes = 0;
  let best: Tried | null = null;
  let last: Tried | null = null;
  let done = false;
  const score = (b: { lufs: number }) => Math.abs(targetLufs - b.lufs);
  while (!done && passes < most) {
    const tried = measure(push);
    last = tried;
    const { lufs, dist } = tried;
    passes++;
    const clean = dist <= maxDist;
    if (!clean) {
      // Too far: the push stays under this from now on (halfway back towards the last clean one)
      hi = push;
      cleanHi = false;
      const below = best ? best.push : Math.max(lo, push - 6);
      if (hi - below < 0.2) {
        done = true;
        break;
      }
      prev = null;
      push = (below + hi) / 2;
      continue;
    }
    if (!best || score({ lufs }) < score(best) || (lufs < targetLufs && best.lufs < targetLufs && lufs > best.lufs)) best = tried;
    if (lufs < targetLufs) lo = push;
    else hi = Math.min(hi, push);
    const missing = targetLufs - lufs;
    if (Math.abs(missing) < MATCH_TOLERANCE || (missing > 0 && push >= hi - 1e-9) || (missing < 0 && push <= lo + 1e-9)) {
      done = true;
      break;
    }
    const through = prev && push !== prev.push ? (lufs - prev.lufs) / (push - prev.push) : 0.85;
    prev = { push, lufs };
    let next = push + missing / Math.max(0.2, Math.min(1, through));
    // Within what's known (and short of a push that distorted)
    next = Math.max(lo, Math.min(cleanHi ? hi : hi - 0.05, next));
    if (Math.abs(next - push) < 0.02) {
      done = true;
      break;
    }
    push = next;
  }
  // (Out of passes: done all the same)
  return { best, lo, hi, cleanHi, passes, last, done: done || passes >= MATCH_PASSES };
}

/** A song longer than this (seconds) is matched on a sample of it first (see matchPush). */
export const MATCH_SAMPLE_FROM = 90;
/** The sample: a piece this long (seconds) out of every MATCH_SAMPLE_EVERY, each with a lead-in the clipper and limiter settle in. */
const MATCH_SAMPLE_PIECE = 6;
const MATCH_SAMPLE_EVERY = 24;
const MATCH_SAMPLE_LEAD = 0.5;
/** About how many passes over the whole song a match takes (for its progress: see matchPush). */
const MATCH_WORK_GUESS = 6;
/** The most times a sampled match checks the whole song before it searches the whole song instead. */
const MATCH_SAMPLE_CHECKS = 3;
/** How far under MAX_DISTORTION_DB the sample is kept (dB), so the song's check passes on a sample that reads a hair clean. */
const MATCH_SAMPLE_DIST_MARGIN = 0.1;

/**
 * A quarter of a long song, as evenly spread pieces, and how to try a push on it: the pieces (each
 * with its lead-in, and the limiter's latency after it) go through the clipper and limiter in one
 * run, and what each piece's own span became is measured, as the whole song is.
 */
function matchSample(left: Float32Array, right: Float32Array, sampleRate: number, delay: number): { dry: number; measure: (gainDb: number, clipper: ClipperSettings | undefined, ceilingDbtp: number) => { lufs: number; dist: number } } | null {
  if (left.length < MATCH_SAMPLE_FROM * sampleRate) return null;
  const piece = Math.round(MATCH_SAMPLE_PIECE * sampleRate);
  const every = Math.round(MATCH_SAMPLE_EVERY * sampleRate);
  const lead = Math.round(MATCH_SAMPLE_LEAD * sampleRate);
  const starts: number[] = [];
  for (let at = Math.floor((every - piece) / 2); at + piece <= left.length; at += every) starts.push(at);
  const span = lead + piece + delay;
  const inL = new Float32Array(starts.length * span);
  const inR = new Float32Array(starts.length * span);
  const dryL = new Float32Array(starts.length * piece);
  const dryR = new Float32Array(starts.length * piece);
  starts.forEach((at, k) => {
    // (The first piece's lead-in may start before the song: silence there)
    const from = at - lead;
    for (let i = 0; i < span; i++) {
      const j = from + i;
      if (j >= 0 && j < left.length) {
        inL[k * span + i] = left[j];
        inR[k * span + i] = right[j];
      }
    }
    dryL.set(left.subarray(at, at + piece), k * piece);
    dryR.set(right.subarray(at, at + piece), k * piece);
  });
  const outL = new Float32Array(dryL.length);
  const outR = new Float32Array(dryR.length);
  const measure = (gainDb: number, clipper: ClipperSettings | undefined, ceilingDbtp: number) => {
    const [l, r] = clipAndLimit(inL, inR, sampleRate, gainDb, clipper, ceilingDbtp);
    for (let k = 0; k < starts.length; k++) {
      outL.set(l.subarray(k * span + lead + delay, k * span + lead + delay + piece), k * piece);
      outR.set(r.subarray(k * span + lead + delay, k * span + lead + delay + piece), k * piece);
    }
    return { lufs: integratedLufs(outL, outR, sampleRate), dist: distortionDb(dryL, dryR, outL, outR, sampleRate, 0) };
  };
  return { dry: integratedLufs(dryL, dryR, sampleRate), measure };
}

/**
 * The push (dB, on top of `levelDb`) that brings `left` / `right` (the master section's sound up to
 * the Level) to `targetLufs` through the clipper and the limiter. Each pass runs them and measures
 * (searchPush). `start` is where to begin (the push found last time). A long song is searched on a
 * quarter of it (matchSample) and the push found checked on the whole song: the sample's
 * loudness and distortion are a little off the song's, by about the same at nearby pushes, so a
 * check that misses learns the difference and the sample is searched again (usually one check
 * does: a third of the work of searching the whole song). The answer is always measured on the
 * whole song. `maxDist` is the most distortion it may use (loudMaxDistortionDb: more with Crunch).
 * `onProgress` hears about how far it has got (0 to 0.95: the passes it will take
 * aren't known ahead).
 */
export function matchPush(left: Float32Array, right: Float32Array, sampleRate: number, levelDb: number, targetLufs: number, clipper: ClipperSettings | undefined, ceilingDbtp: number, start?: number, onProgress?: (fraction: number) => void, maxDist = MAX_DISTORTION_DB): LoudMatch {
  const dry = integratedLufs(left, right, sampleRate);
  if (!Number.isFinite(dry)) return { push: 0, lufs: dry, targetLufs, shortDb: 0, capped: false, distortionDb: -Infinity, passes: 0 };
  const delay = createLimiterKernel(sampleRate).latency;
  // The work done, in passes over the whole song (a sample's pass is a quarter of one), for the
  // progress bar: a match takes about MATCH_WORK_GUESS of them
  let work = 0;
  const did = (passes: number) => {
    work += passes;
    onProgress?.(Math.min(0.95, work / MATCH_WORK_GUESS));
  };
  const whole = (push: number): Tried => {
    const [l, r] = clipAndLimit(left, right, sampleRate, levelDb + push, clipper, ceilingDbtp);
    const tried = { push, lufs: integratedLufs(l, r, sampleRate), dist: distortionDb(left, right, l, r, sampleRate, delay) };
    did(1);
    return tried;
  };
  const better = (a: Tried, b: Tried | null) => !b || Math.abs(targetLufs - a.lufs) < Math.abs(targetLufs - b.lufs) || (a.lufs < targetLufs && b.lufs < targetLufs && a.lufs > b.lufs);
  let push = Math.max(LOUD_PUSH_MIN, Math.min(LOUD_PUSH_MAX, start ?? targetLufs - dry - levelDb));
  let passes = 0;
  let found: Tried | null = null;
  let cleanHi = true;
  const sample = matchSample(left, right, sampleRate, delay);
  // On the whole song first: most matches take a pass or two (from the push found last time, then
  // one step). A long song that needs more goes on with its sample
  const first = searchPush(whole, targetLufs, maxDist, push, sample ? 2 : MATCH_PASSES);
  passes += first.passes;
  cleanHi = first.cleanHi;
  if (first.done || !sample || !first.last) found = first.best;
  else {
    let check = first.last;
    push = check.push;
    const tryPart = (p: number): Tried => {
      passes++;
      const tried = { push: p, ...sample.measure(levelDb + p, clipper, ceilingDbtp) };
      did(MATCH_SAMPLE_PIECE / MATCH_SAMPLE_EVERY);
      return tried;
    };
    const known = tryPart(push);
    const part = (p: number): Tried => (p === known.push ? known : tryPart(p));
    // Where the whole song's search got to (the sample reads about as the song does: a start)
    let bounds = { lo: first.lo, hi: first.hi, cleanHi: first.cleanHi };
    // What the sample reads over the song, loudness (LU) and distortion (dB), at the last check
    let at: Tried = known;
    let best = first.best;
    for (let round = 0; round < MATCH_SAMPLE_CHECKS; round++) {
      const off = at.lufs - check.lufs;
      const distOff = (Number.isFinite(at.dist) && Number.isFinite(check.dist) ? at.dist - check.dist : 0) - MATCH_SAMPLE_DIST_MARGIN;
      const s = searchPush(part, targetLufs + off, maxDist + distOff, push, MATCH_PASSES, bounds);
      const next = s.best ?? part(s.lo);
      // The same push again (stopped by distortion short of the target, or at the least push): the best so far is the answer
      if (Math.abs(next.push - push) < 0.02) {
        found = best;
        if (best === check) cleanHi = s.cleanHi;
        break;
      }
      const got = whole(next.push);
      passes++;
      const clean = got.dist <= maxDist;
      if (clean && better(got, best)) {
        best = got;
        cleanHi = s.cleanHi;
      }
      const missing = targetLufs - got.lufs;
      // On target, or short of it at the most push or where the sample started to distort
      if (clean && (Math.abs(missing) < MATCH_TOLERANCE || (missing > 0 && (next.push >= LOUD_PUSH_MAX - 1e-9 || !s.cleanHi)))) {
        found = got;
        break;
      }
      check = got;
      at = next;
      push = next.push;
      bounds = { lo: Math.min(s.lo, push), hi: Math.max(s.hi, push), cleanHi: s.cleanHi };
    }
    if (!found) {
      // (Not settled on the sample: the whole song, as a short one is searched)
      const s = searchPush(whole, targetLufs, maxDist, push);
      passes += s.passes;
      if (s.best && better(s.best, best)) {
        best = s.best;
        cleanHi = s.cleanHi;
      }
      found = best;
    }
  }
  // Nothing clean at all (it distorts at any push it tried): the least push tried
  if (!found) {
    found = whole(first.lo);
    passes++;
  }
  const shortDb = Math.max(0, targetLufs - found.lufs);
  const short = shortDb >= MATCH_TOLERANCE;
  return { push: Math.round(found.push * 100) / 100, lufs: found.lufs, targetLufs, shortDb: short ? shortDb : 0, capped: short && (found.push >= LOUD_PUSH_MAX - 1e-9 || !cleanHi), distortionDb: found.dist, passes };
}
