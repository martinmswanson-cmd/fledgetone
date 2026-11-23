/**
 * The space of a sound, for the hearing report: how long its sounds ring on after they end (the time
 * a 20 dB fall takes from where a note or hit ends), how much of it is tail rather than direct sound,
 * a clear echo (its time, how many repeats stand out, its note value at a known tempo), and whether
 * the tails are wider than the direct sound. Read from a 10 ms level envelope of the channels, the
 * onsets of their mix, and the energy of their middle and sides. Every level is relative to the sound
 * itself (a note's own peak and end, the loudest frame), so the reading doesn't depend on how loud it
 * plays. Plain maths on samples, no Web Audio, so Node can test it.
 */
import { onsetStrength, onsetTimes } from '../sampleAnalysis';
import { minOf } from '../../support/minMax';
import { noteOf } from './movement';
import type { Space } from './types';

/** The level envelope's frame, seconds. */
const FRAME_SECONDS = 0.01;
/** The onsets are read on the mix taken down to about this rate, Hz (an average of whole samples): plenty for onsets, and a third of the work of 48 kHz. */
const ONSET_RATE = 16000;
/** Silence put before the onset mix, samples, so a sound that starts at once has an onset at its start. */
const PAD = 1024;
/** An onset starts a note or hit only where the level rises at least this far, dB. */
const ONSET_RISE_DB = 3;
/** A segment (a note and what follows it, up to the next onset) starts this many frames before its onset, as the onset is placed a little late. */
const LEAD = 2;
/** An end is followed by at least this many frames (300 ms) with no new onset. */
const AFTER_END = 30;
/** Over those frames the level falls at least this far under the end, dB ... */
const MIN_FALL_DB = 5;
/** ... and does not come back up more than this over the end, nor swell more than SWELL_DB over the lowest it has been (a tremolo's dips are not ends), dB, until it is FALLEN_DB under the end. */
const RISE_DB = 2;
const SWELL_DB = 3;
const FALLEN_DB = 30;
/** A note counts only when its peak is within this of the loudest frame of the sound, dB. */
const NOTE_RANGE_DB = 40;
/** The fall that is timed, dB. */
const FALL_DB = 20;
/** A level FALL_DB under the end within this many frames of it is a sound that stops: the fall is timed where it crosses. */
const QUICK = 3;
/** Otherwise a tail is timed when the line through its levels falls at least this far before the next onset, dB, and the levels miss the line by at most this (root mean square), dB. */
const TIMED_DB = 10;
const FIT_DB = 1.5;
/** ... and its second half falls at least this share as fast as its first. */
const SETTLE = 0.5;
/** A note or hit has ended by the time its level is this far under its peak, dB ... */
const END_DB = 10;
/** ... and its end is where its level falls furthest under the line it was on before then, at least this far on average, dB, over this many frames either side. */
const BEND_DB = 0.6;
const BEND_FRAMES = 8;
/** An end in time for AFTER_END frames is taken when it falls at least this share as far as the furthest past them. */
const AS_FAR = 0.5;
/** While the end is looked for, levels are held to this far under that, dB (digital silence is -120 dB). */
const BODY_SPAN_DB = 20;
/** At most this many frames after an end are looked at (3 s). */
const MAX_TAIL = 300;
/** Fewer ends than this, or none whose tail is timed, and nothing is said of decays, tails and their width. */
const MIN_ENDS = 3;
/** Levels are floored this far under the loudest frame, dB. */
const FLOOR_DB = -120;
/** The direct sound whose width the tails' is set against: a note from its start to this many frames past its peak (20 ms), before much of a reverb has built up. */
const DIRECT_FRAMES = 2;
/** Side-over-mid is read no further than this either side of 0 dB (a mono sound has no side at all). */
const WIDTH_RANGE_DB = 40;

/** Echo lags looked at, frames (60 to 1500 ms). */
const ECHO_FROM = 6;
const ECHO_TO = 150;
/** The highest peaks of the autocorrelation tried as echo lags. */
const ECHO_CANDIDATES = 8;
/** A sound that starts an echo (an onset) peaks within this of the loudest frame, dB. */
const EVENT_RANGE_DB = 30;
/** A repeat rises at least this far over the level just before it, dB. */
const BUMP_DB = 1.5;
/** Each repeat is this much quieter than the one before, dB (a riff's notes, as loud as the one before, are not repeats) ... */
const STEP_MIN_DB = 2;
const STEP_MAX_DB = 24;
/** ... the same step each time, within this, dB ... */
const STEP_SPREAD_DB = 3;
/** ... and within this of the sound it repeats, dB. */
const REPEAT_RANGE_DB = 40;
/** An echo's first repeat follows this share of the onsets at least (and two of them at least). */
const ECHO_SHARE = 0.4;
/** A lag within this of a whole multiple of a shorter echo's (in multiples) is that echo heard every so many repeats. */
const MULTIPLE_TOLERANCE = 0.05;

/** (+ 0: never -0) */
const round1 = (x: number) => Math.round(x * 10) / 10 + 0;
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The median of `values` (not empty). */
function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Side over mid, dB, held within WIDTH_RANGE_DB either side of 0. */
function sideOverMidDb(side: number, mid: number): number {
  const least = 10 ** (-WIDTH_RANGE_DB / 10);
  const ratio = (side + least * mid + 1e-300) / (mid + least * side + 1e-300);
  return 10 * Math.log10(ratio);
}

/**
 * In each whole frame of `hop` samples: the energy of the middle and of the sides (all of it in the
 * middle for one channel); and the energy of the channels' first differences (the sound 6 dB louder
 * each octave up, what the level envelope is read from) through a raised-cosine window three frames
 * long about the frame (a pitch period's sharp corner, which the differences make a spike of, then
 * counts alike wherever it falls, rather than once or twice in a frame).
 */
function frameEnergies(channels: readonly Float32Array[], hop: number, frames: number): { mid: Float64Array; side: Float64Array | null; bright: Float64Array } {
  const length = channels[0].length;
  const mid = new Float64Array(frames);
  const side = channels.length > 1 ? new Float64Array(frames) : null;
  const [left, right] = channels;
  for (let f = 0; f < frames; f++) {
    let m = 0;
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      if (right) {
        const a = (left[i] + right[i]) / 2;
        const b = (left[i] - right[i]) / 2;
        m += a * a;
        s += b * b;
      } else {
        m += left[i] * left[i];
      }
    }
    mid[f] = m;
    if (side) side[f] = s;
  }
  // The differences' energy at each sample, then windowed
  const span = 3 * hop;
  const window = Float64Array.from({ length: span }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / span));
  const bright = new Float64Array(frames);
  const at = (c: Float32Array, i: number) => (i > 0 ? c[i] - c[i - 1] : c[0]);
  for (let f = 0; f < frames; f++) {
    const from = (f - 1) * hop;
    let sum = 0;
    for (let j = Math.max(0, -from); j < span && from + j < length; j++) {
      const i = from + j;
      const dl = at(left, i);
      const d = right ? (dl * dl + at(right, i) ** 2) / 2 : dl * dl;
      sum += window[j] * d;
    }
    bright[f] = sum;
  }
  return { mid, side, bright };
}

/**
 * The channels added up (each turned the right way up to agree with the loudest, as analysisMix does,
 * so sides out of phase don't cancel) and taken down to about ONSET_RATE by averaging whole samples,
 * after PAD samples of silence, and scaled so its loudest sample is at full scale: built straight at
 * the lower rate, so a long sound never needs a full-rate copy.
 */
function onsetMix(channels: readonly Float32Array[], sampleRate: number): { x: Float32Array; rate: number } {
  const length = channels[0].length;
  const factor = Math.max(1, Math.floor(sampleRate / ONSET_RATE));
  const energy = channels.map((c) => {
    let e = 0;
    for (let i = 0; i < length; i++) e += c[i] * c[i];
    return e;
  });
  const loudest = channels[energy[1] > energy[0] ? 1 : 0];
  const signs = channels.map((c) => {
    if (c === loudest) return 1;
    let dot = 0;
    for (let i = 0; i < length; i++) dot += c[i] * loudest[i];
    return dot < 0 ? -1 : 1;
  });
  const x = new Float32Array(PAD + Math.floor(length / factor));
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    const g = signs[c] / factor;
    for (let j = 0; j + PAD < x.length; j++) {
      let sum = 0;
      for (let i = j * factor; i < (j + 1) * factor; i++) sum += ch[i];
      x[PAD + j] += g * sum;
    }
  }
  // Its loudest sample at full scale: the onset curve weighs a rise from silence against the rest by the
  // sound's level, and this way by nothing else (so which onsets are found doesn't depend on how loud it plays)
  let loudestSample = 0;
  for (const v of x) loudestSample = Math.max(loudestSample, Math.abs(v));
  if (loudestSample > 0) for (let j = 0; j < x.length; j++) x[j] /= loudestSample;
  return { x, rate: sampleRate / factor };
}

/**
 * The frames where notes and hits start: the onsets of the mix where the level rises at least
 * ONSET_RISE_DB (the onset curve also peaks where a note stops over its own reverb, whose spectrum
 * fills in between the note's partials, but the level falls there).
 */
function onsetsOf(channels: readonly Float32Array[], sampleRate: number, levels: Float64Array): number[] {
  const n = levels.length;
  const { x, rate } = onsetMix(channels, sampleRate);
  const frames = new Set<number>();
  for (const t of onsetTimes(onsetStrength(x, rate).strength, rate)) {
    // (an onset at the very start can be placed a little before it)
    const o = Math.max(0, Math.round((t - PAD / rate) / FRAME_SECONDS));
    if (o >= n) continue;
    let after = -Infinity;
    for (let f = Math.max(0, o - 1); f <= Math.min(n - 1, o + 3); f++) after = Math.max(after, levels[f]);
    // (before the start of the sound is silence)
    let before = o - 2 < 0 ? FLOOR_DB : Infinity;
    for (let f = Math.max(0, o - 6); f <= o - 2; f++) before = Math.min(before, levels[f]);
    if (after - before >= ONSET_RISE_DB) frames.add(o);
  }
  return [...frames].sort((a, b) => a - b);
}

/** Where a note or hit ends, in frames: its segment's start, its peak, its last frame before the fall, and the segment's end (exclusive). */
interface End {
  start: number;
  peak: number;
  last: number;
  stop: number;
}


/**
 * The last frame of a note's direct sound, or null when there is none with AFTER_END frames after it
 * (by `lastEnd`). Up to where the level is first END_DB under the peak: the frame after which the
 * level falls furthest under where it was heading. A line is fitted to the BEND_FRAMES levels up to
 * each frame, and the fall is how far the BEND_FRAMES levels after it lie under that line carried on,
 * on average. A note cut short drops under it (a step, over its reverb or into silence); a note held
 * over a heavy reverb, which makes no step, bends under it (the reverb holds or grows while the note
 * sounds and falls once it stops); a slope alone, a pluck's own fall or a reverb's, makes none. The
 * frame with the furthest fall, when it is at least BEND_DB; otherwise (a hit, which falls along one
 * line from its peak, or fast and then slower into a tail) the last frame before the level is END_DB
 * under the peak. Levels are held to BODY_SPAN_DB under that, so digital silence counts as a drop of
 * that size and no more.
 */
function bodyEnd(levels: Float64Array, smooth: Float64Array, peak: number, lastEnd: number, stop: number): number | null {
  const under = smooth[peak] - END_DB;
  let crossed = -1;
  for (let f = peak + 1; f < stop; f++) {
    if (levels[f] < under) {
      crossed = f;
      break;
    }
  }
  const floor = under - BODY_SPAN_DB;
  const at = (f: number) => Math.max(floor, levels[f]);
  const mx = (BEND_FRAMES - 1) / 2;
  const vx = (BEND_FRAMES * (BEND_FRAMES * BEND_FRAMES - 1)) / 12;
  let best = -1;
  let furthest = BEND_DB;
  let bestInTime = -1;
  let furthestInTime = BEND_DB;
  // (searched to where it is END_DB down, or the segment's end, so an end found past `lastEnd` says there is none)
  const until = Math.min(crossed < 0 ? stop - 1 : crossed - 1, levels.length - 1 - BEND_FRAMES);
  for (let b = peak + BEND_FRAMES - 1; b <= until; b++) {
    // The line through the BEND_FRAMES levels up to b, as level at b plus slope a frame
    let sy = 0;
    let sxy = 0;
    for (let i = 0; i < BEND_FRAMES; i++) {
      const y = at(b - BEND_FRAMES + 1 + i);
      sy += y;
      sxy += i * y;
    }
    const slope = (sxy - mx * sy) / vx;
    const there = sy / BEND_FRAMES + slope * (BEND_FRAMES - 1 - mx);
    let fall = 0;
    for (let j = 1; j <= BEND_FRAMES; j++) fall += (there + slope * j - at(b + j)) / BEND_FRAMES;
    if (fall > furthest) {
      furthest = fall;
      best = b;
    }
    if (b <= lastEnd && fall > furthestInTime) {
      furthestInTime = fall;
      bestInTime = b;
    }
  }
  // (past `lastEnd`, the next onset comes too soon after it; one in time that falls about as far will do)
  if (best >= 0 && best <= lastEnd) return best;
  if (best >= 0) return bestInTime >= 0 && furthestInTime >= AS_FAR * furthest ? bestInTime : null;
  return crossed >= 0 && crossed - 1 <= lastEnd ? crossed - 1 : null;
}

/**
 * The ends of the notes and hits. Each onset starts a segment that runs to the next. In it the end is
 * the last frame of the direct sound after the segment's peak (bodyEnd), with AFTER_END frames still
 * to come before the next onset. Over those the level must not come back up (RISE_DB over the end, or
 * SWELL_DB over the lowest it has been, until it is FALLEN_DB under the end) and must fall at least
 * MIN_FALL_DB.
 */
function endsOf(levels: Float64Array, onsets: readonly number[]): End[] {
  const n = levels.length;
  const ends: End[] = [];
  // (whether a tail keeps falling is read on the levels averaged over three frames: a tail's own grain rises and falls a dB or two from frame to frame)
  const smooth = Float64Array.from(levels, (_, f) => (levels[Math.max(0, f - 1)] + levels[f] + levels[Math.min(n - 1, f + 1)]) / 3);
  for (let o = 0; o < onsets.length; o++) {
    const start = Math.max(0, onsets[o] - LEAD);
    const stop = o + 1 < onsets.length ? Math.min(n, Math.max(start, onsets[o + 1] - LEAD)) : n;
    const lastEnd = stop - 1 - AFTER_END;
    if (lastEnd < start) continue;
    let peak = start;
    for (let f = start; f <= lastEnd; f++) if (smooth[f] > smooth[peak]) peak = f;
    if (levels[peak] < -NOTE_RANGE_DB) continue;
    const last = bodyEnd(levels, smooth, peak, lastEnd, stop);
    if (last === null) continue;
    // Over the next AFTER_END frames it does not come back up (until it has fallen FALLEN_DB), and it falls MIN_FALL_DB
    const ref = levels[last];
    let fallen = false;
    let back = false;
    let lowest = ref;
    for (let g = last + 1; g <= last + AFTER_END && !fallen && !back; g++) {
      fallen = smooth[g] <= ref - FALLEN_DB;
      lowest = Math.min(lowest, smooth[g]);
      back = smooth[g] > ref + RISE_DB || smooth[g] > lowest + SWELL_DB;
    }
    if (back) continue;
    if (!fallen) {
      let late = 0;
      for (let g = last + AFTER_END - 4; g <= last + AFTER_END; g++) late += smooth[g] / 5;
      if (late > ref - MIN_FALL_DB) continue;
    }
    ends.push({ start, peak, last, stop });
  }
  return ends;
}

/** The slope of the line through `levels` from `a` to `b` - 1, a frame, and how far they miss it (root mean square), dB. */
function slopeOf(levels: Float64Array, a: number, b: number): { slope: number; miss: number } {
  const n = b - a;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let g = a; g < b; g++) {
    const x = g - a;
    sx += x;
    sy += levels[g];
    sxx += x * x;
    sxy += x * levels[g];
    syy += levels[g] * levels[g];
  }
  const vx = sxx - (sx * sx) / n;
  const cxy = sxy - (sx * sy) / n;
  const slope = vx > 0 ? cxy / vx : 0;
  return { slope, miss: Math.sqrt(Math.max(0, syy - (sy * sy) / n - slope * cxy) / n) };
}

/**
 * The time a tail takes to fall FALL_DB, frames, or null when it is not timed. When the level is
 * FALL_DB under the end's within QUICK frames (a sound that stops), the time it takes to get there,
 * read between two frames. Otherwise FALL_DB over the slope of the line through the tail's levels from
 * its second frame (the first can still hold the end of the direct sound): to where it is FALL_DB
 * under the end, when it gets there before the next onset; when the next onset comes first, to the
 * next onset, and then only when the line falls at least TIMED_DB over those frames, the levels miss
 * it by at most FIT_DB (root mean square), and its second half falls at least SETTLE as fast as its
 * first. A reverb falls along a line; a held layer or noise under the notes is flat, or falls and then
 * lies flat, and is not timed.
 */
function fallFrames(levels: Float64Array, { last, stop }: End): number | null {
  const ref = levels[last];
  const target = ref - FALL_DB;
  const to = Math.min(stop, last + 1 + MAX_TAIL);
  let crossed = -1;
  for (let g = last + 1; g < to; g++) {
    if (levels[g] <= target) {
      crossed = g;
      break;
    }
  }
  /** The time the level crosses the target, between frame `g` - 1 and `g`. */
  const at = (g: number) => {
    const before = levels[g - 1];
    const frac = before > levels[g] ? (before - target) / (before - levels[g]) : 1;
    return Math.max(0, g - last - 1.5 + frac);
  };
  if (crossed >= 0 && crossed < last + 1 + QUICK) return at(crossed);
  const first = last + 2;
  if (crossed >= 0) {
    // A fall seen whole: its rate, from the tail's second frame to where it is FALL_DB down
    if (crossed - first + 1 < 3) return at(crossed);
    const seen = slopeOf(levels, first, crossed + 1).slope;
    return seen < 0 ? FALL_DB / -seen : at(crossed);
  }
  // A fall cut short by the next onset: timed only when it falls straight and far enough
  const count = to - first;
  if (count < 3) return null;
  const whole = slopeOf(levels, first, to);
  if (!(whole.slope < 0) || -whole.slope * (count - 1) < TIMED_DB || whole.miss > FIT_DB) return null;
  // (and its second half falls at least SETTLE as fast as its first: a fall onto a floor flattens; read on 4 frames a half at least)
  const half = first + (count >> 1);
  if (count >= 8 && slopeOf(levels, half, to).slope > SETTLE * slopeOf(levels, first, half).slope) return null;
  const slope = whole.slope;
  return FALL_DB / -slope;
}

/**
 * The repeats that follow the sound peaking at frame `at`, `lag` frames apart: each a bump in the level
 * a like step quieter than the one before. Their count, and the step of the first (0 when none).
 */
function repeatsAfter(levels: Float64Array, at: number, lag: number): { count: number; step: number } {
  const n = levels.length;
  const first = levels[at];
  let previous = first;
  let step = 0;
  let count = 0;
  for (let k = 1; ; k++) {
    const q = Math.round(at + k * lag);
    if (q + 2 >= n) break;
    // A bump that peaks here: up from before it, and not still rising after (a later start)
    const height = Math.max(levels[q - 1], levels[q], levels[q + 1]);
    const before = Math.min(levels[q - 4], levels[q - 3], levels[q - 2]);
    if (height - before < BUMP_DB || levels[q + 2] > height || height < first - REPEAT_RANGE_DB) break;
    const fall = height - previous;
    if (fall > -STEP_MIN_DB || fall < -STEP_MAX_DB) break;
    if (count > 0 && Math.abs(fall - step) > STEP_SPREAD_DB) break;
    if (count === 0) step = fall;
    previous = height;
    count++;
  }
  return { count, step };
}

/**
 * A clear echo, or null. The lags tried are the highest peaks, from 60 to 1500 ms, of the
 * autocorrelation of the level envelope's rises. A lag is an echo when repeats follow the onsets at multiples of it,
 * each a like step quieter than the one before: a repeated note's onsets line up with its lag too,
 * but as loud as the one before, so they are notes, not repeats. Of the lags that are echoes (and not
 * a multiple of a shorter one), the one most onsets are followed by; its repeats, the most that
 * follow any one onset.
 */
function echoOf(levels: Float64Array, onsets: readonly number[], tempoBpm?: number): Space['echo'] {
  const n = levels.length;
  // The sounds that could start an echo: each onset's peak
  const peaks = new Set<number>();
  for (const o of onsets) {
    let at = -1;
    for (let f = Math.max(0, o - LEAD); f <= Math.min(n - 1, o + 4); f++) if (at < 0 || levels[f] > levels[at]) at = f;
    if (at >= 0 && levels[at] >= -EVENT_RANGE_DB) peaks.add(at);
  }
  const events = [...peaks];
  if (events.length < 2 || n <= ECHO_FROM + 2) return null;

  // The autocorrelation of the rises of the level envelope (its amplitude, frame on frame, where it
  // grows), less their mean: sharp where something starts, a note or a repeat, so its peaks are the
  // times between starts (unbiased: fewer frames overlap at long lags)
  const amp = new Float64Array(n);
  for (let f = 1; f < n; f++) amp[f] = Math.max(0, 10 ** (levels[f] / 20) - 10 ** (levels[f - 1] / 20));
  let mean = 0;
  for (const a of amp) mean += a / n;
  let energy = 0;
  for (let f = 0; f < n; f++) {
    amp[f] -= mean;
    energy += amp[f] * amp[f];
  }
  if (!(energy > 0)) return null;
  const top = Math.min(ECHO_TO + 1, n - 1);
  const acf = new Float64Array(top + 1);
  for (let lag = ECHO_FROM - 1; lag <= top; lag++) {
    let s = 0;
    for (let f = 0; f + lag < n; f++) s += amp[f] * amp[f + lag];
    acf[lag] = s / ((energy * (n - lag)) / n);
  }
  const candidates: Array<{ lag: number; height: number }> = [];
  for (let lag = ECHO_FROM; lag < top && lag <= ECHO_TO; lag++) {
    const [a, b, c] = [acf[lag - 1], acf[lag], acf[lag + 1]];
    if (!(b > 0 && b >= a && b > c)) continue;
    const bend = a - 2 * b + c;
    candidates.push({ lag: bend < 0 ? lag + (0.5 * (a - c)) / bend : lag, height: b });
  }
  candidates.sort((x, y) => y.height - x.height);

  // The lags that are echoes: a first repeat after enough onsets, all a like step quieter, and after
  // one onset at least a second repeat, a like step under the first (later notes can fall where the
  // second would: a melody whose notes come two echoes apart hides every second repeat but its last)
  const echoes: Array<{ lag: number; share: number; repeats: number }> = [];
  for (const { lag } of candidates.slice(0, ECHO_CANDIDATES)) {
    const after = events.map((at) => repeatsAfter(levels, at, lag)).filter((r) => r.count > 0);
    if (after.length < 2) continue;
    const typical = median(after.map((r) => r.step));
    const alike = after.filter((r) => Math.abs(r.step - typical) <= STEP_SPREAD_DB);
    let repeats = 0;
    for (const r of alike) repeats = Math.max(repeats, r.count);
    if (alike.length < 2 || alike.length < ECHO_SHARE * events.length || repeats < 2) continue;
    echoes.push({ lag, share: alike.length / events.length, repeats });
  }
  // An echo repeats at twice its lag too: a lag that is a multiple of another echo's is that echo
  const own = echoes.filter((e) => !echoes.some((o) => o.lag < e.lag && Math.abs(e.lag / o.lag - Math.round(e.lag / o.lag)) <= MULTIPLE_TOLERANCE));
  let best: (typeof own)[number] | null = null;
  for (const e of own) if (!best || e.share > best.share) best = e;
  if (!best) return null;
  const ms = Math.round(best.lag * FRAME_SECONDS * 1000);
  const note = tempoBpm === undefined ? undefined : noteOf(1000 / ms, tempoBpm);
  return { ms, repeats: best.repeats, ...(note ? { note } : {}) };
}

/** The space of `channels` (one or two; more are ignored), with the echo's note value when `tempoBpm` is known. */
export function spaceOf(channels: readonly Float32Array[], sampleRate: number, tempoBpm?: number): Space {
  const none: Space = { decayMs: null, wetShare: null, echo: null, tailWiderDb: null };
  const heard = channels.slice(0, 2);
  const length = heard.length ? minOf(heard.map((c) => c.length)) : 0;
  const hop = Math.max(1, Math.round(FRAME_SECONDS * sampleRate));
  const frames = Math.floor(length / hop);
  if (frames < AFTER_END + 2) return none;
  const cut = heard.map((c) => c.subarray(0, length));
  const { mid, side, bright } = frameEnergies(cut, hop, frames);
  const total = side ? Float64Array.from(mid, (m, f) => m + side[f]) : mid;
  let loudest = 0;
  for (const e of bright) loudest = Math.max(loudest, e);
  if (!(loudest > 0) || !Number.isFinite(loudest)) return none;
  // The level envelope, of the first differences: a note's partials then weigh alike, so the level of a
  // tail is the sum of many of them, not the grain of its loudest alone (a low partial ringing in a
  // reverb swells and sags by several dB as it decays)
  const levels = Float64Array.from(bright, (e) => Math.max(FLOOR_DB, 10 * Math.log10(e / loudest)));

  const onsets = onsetsOf(cut, sampleRate, levels);
  const echo = echoOf(levels, onsets, tempoBpm);

  const ends = endsOf(levels, onsets);
  const falls: number[] = [];
  const shares: number[] = [];
  const width = { tailSide: 0, tailMid: 0, directSide: 0, directMid: 0 };
  for (const end of ends) {
    const fall = fallFrames(levels, end);
    if (fall !== null) falls.push(fall * FRAME_SECONDS * 1000);
    let tail = 0;
    let note = 0;
    for (let f = end.start; f < end.stop; f++) {
      note += total[f];
      if (f > end.last) tail += total[f];
      if (!side) continue;
      if (f > end.last) {
        width.tailSide += side[f];
        width.tailMid += mid[f];
      } else if (f <= end.peak + DIRECT_FRAMES) {
        width.directSide += side[f];
        width.directMid += mid[f];
      }
    }
    if (note > 0) shares.push(tail / note);
  }
  // (wet share and width need ends enough; all three need a tail that is timed, or the "tails" may be a held layer or noise)
  if (ends.length < MIN_ENDS || falls.length === 0 || shares.length === 0) return { ...none, echo };
  return {
    decayMs: Math.round(median(falls)),
    // (the median of the ends' shares: one end placed a little early or late moves it little)
    wetShare: round2(median(shares)),
    echo,
    tailWiderDb: side ? round1(sideOverMidDb(width.tailSide, width.tailMid) - sideOverMidDb(width.directSide, width.directMid)) : null,
  };
}
