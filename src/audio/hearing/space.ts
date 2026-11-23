/**
 * The space of a sound, for the hearing report: how long its sounds ring on after they end (the time
 * a 20 dB fall takes from where a note or hit ends), how much of it is tail rather than direct sound,
 * a clear echo (its time, how many repeats stand out, its note value at a known tempo), and whether
 * the tails are wider than the direct sound. Read from a 10 ms level envelope of the channels (of
 * their sample-to-sample differences, so the sound counts 6 dB more each octave up: a tail is then the
 * sum of many partials, and a bass under the notes counts for little), the onsets of their mix, and
 * the energy of their middle and sides. A note ends where its level bends or steps down; a hit, which
 * only falls, where it is 10 dB under its peak, so its own ring counts as ringing on. Short sounds
 * over a tail that carries on under them (a hat over a snare's reverb) are passed over. The decay and
 * the tail's share are medians over the ends, each counted by the root of its note's energy. When in
 * doubt nothing is said: three ends at least must fall at the decay's rate, the ends that do not may
 * not hold most of what comes after ends, an echo's repeats must sound like what they repeat (and
 * then start no notes of their own, and no width is given beside them, nor a decay that says the
 * sounds stop at once); sounds that stop at once have no tail width. Every
 * level is relative to the sound itself (a note's own peak and end, the loudest frame), so the reading
 * doesn't depend on how loud it plays. Plain maths on samples, no Web Audio, so Node can test it.
 */
import { fftInPlace } from '../fft';
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
/** Where the typical onset is looked for: the peaks of the onset curve over this share of its loudest; and how far over the typical one the loudest is let count. */
const ONSET_SHARE = 0.12;
const TOWER = 2.5;
/** A segment (a note and what follows it, up to the next onset) starts this many frames before its onset, as the onset is placed a little late. */
const LEAD = 2;
/** An end has at least this many frames (80 ms) of its segment after it. */
const ROOM = 8;
/** A tail is watched for this many frames (300 ms), or as many as it has. */
const AFTER_END = 30;
/** Over those frames the level falls at least this far under the end, dB ... */
const MIN_FALL_DB = 5;
/** ... and does not come back up more than this over the end, dB; nor, as far as the tail is followed (until it is FALLEN_DB under the end), swell more than SWELL_DB over the lowest it has been (a tremolo's dips are not ends). */
const RISE_DB = 2;
const SWELL_DB = 3;
const FALLEN_DB = 30;
/** A short sound over a tail (a hat over a snare's reverb) is passed over: a frame BLIP_DB over the level before it, and the level under that again within BLIP frames (100 ms). */
const BLIP = 10;
const BLIP_DB = 1.5;
/** ... and it starts at once: that frame this far over the lower of the two before it, dB. */
const SHARP_DB = 5;
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
/** A hit's own fall is read from this far under its peak, dB, and counts with its tail when its second half falls at least this share as fast as its first. */
const HALF_DB = 5;
const NOT_SLOWING = 0.9;
/** The stretches of a tail between short sounds fall alike: a first stretch over this many times as fast as the rest is not yet the tail. */
const ONE_SLOPE = 1.3;
/** A note or hit has ended by the time its level is this far under its peak, dB ... */
const END_DB = 10;
/** ... and its end is where its level falls furthest under the line it was on before then, at least this far on average, dB, over this many frames either side. */
const BEND_DB = 0.6;
const BEND_FRAMES = 8;
/** A bend under STEP_DB, dB, where the level is within NEAR_DB of END_DB under the peak, dB, is taken as the fall of a hit. */
const STEP_DB = 2;
const NEAR_DB = 2;
/** A reverb has grown full under a note when the level rose less than this over the BEND_FRAMES before its peak, dB. */
const GROWN_DB = 5;
/** A segment's onset has risen within this many frames of the segment's start. */
const ATTACK = 4;
/** A sound that peaks as it starts and is over within this many frames of its peak (120 ms) is a hit: the rounded top of a hit through a reverb is no end. */
const HIT_FRAMES = 12;
/** An end with ROOM frames after it is taken when it falls at least this share as far as the furthest bend past them. */
const AS_FAR = 0.5;
/** While the end is looked for, levels are held to this far under that, dB (digital silence is -120 dB). */
const BODY_SPAN_DB = 20;
/** At most this many frames after an end are looked at (3 s). */
const MAX_TAIL = 300;
/** Fewer ends than this timed, or falling like the timed (LIKE_DB at least along a line, dB, at a rate within LIKE of theirs), and nothing is said of decays, tails and their width. */
const MIN_ENDS = 3;
const LIKE_DB = 5;
const LIKE = 0.35;
/** Falls under this, ms, are all alike: sounds that stop. */
const QUICK_MS = 30;
/** The notes not read as the decay says (no end found, or a tail unlike it) may be this share of the weight of all the notes, at most. */
const UNREAD = 0.5;
/** Under this decay, ms, sounds stop almost at once (the words call it "Dry"): such a sound has no tail whose width means anything, and beside an echo it is the repeats that ring on, so neither is given. */
export const DRY_MS = 150;
/** Levels are floored this far under the loudest frame, dB. */
const FLOOR_DB = -120;
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
/** A repeat sounds like what it repeats: their spectra (about SPECTRUM_SECONDS from where each starts, up to SPECTRUM_TOP_HZ) are alike by this at least (1 the same; two different noises come to about 0.8, two toms a fourth apart over their reverbs to 0.9, two different notes less), at the median over the sounds repeated. */
const ECHO_ALIKE = 0.95;
/** The spectra's window is the power of two of samples at or above this, seconds (2048 samples at 44.1 and 48 kHz, 1024 at 22.05, 4096 at 88.2 and 96): the same stretch of sound at any rate. */
const SPECTRUM_SECONDS = 2048 / 48000;
const SPECTRUM_TOP_HZ = 5000;
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

/** The median of the values of `pairs` (not empty), each `[value, weight]` counted by its weight. */
function weightedMedian(pairs: Array<[number, number]>): number {
  const sorted = pairs.slice().sort((a, b) => a[0] - b[0]);
  let whole = 0;
  for (const [, w] of sorted) whole += w;
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    sum += sorted[i][1];
    if (sum > whole / 2) return sorted[i][0];
    if (sum === whole / 2 && i + 1 < sorted.length) return (sorted[i][0] + sorted[i + 1][0]) / 2;
  }
  return sorted[sorted.length - 1][0];
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
  const { strength } = onsetStrength(x, rate);
  // onsetTimes takes the peaks over a share of the loudest. A first note from silence towers over the
  // notes that follow it over its own reverb (ten times, under a heavy one), so the loudest is held
  // to TOWER times the typical peak (the median of those over that share), in order
  let loudest = 0;
  for (const v of strength) loudest = Math.max(loudest, v);
  const heights: number[] = [];
  for (let i = 1; i + 1 < strength.length; i++) {
    if (strength[i] > ONSET_SHARE * loudest && strength[i] >= strength[i - 1] && strength[i] >= strength[i + 1]) heights.push(strength[i]);
  }
  const ceiling = heights.length ? TOWER * median(heights) : loudest;
  if (ceiling < loudest) for (let i = 0; i < strength.length; i++) if (strength[i] > ceiling) strength[i] = ceiling * (1 + 1e-9 * (strength[i] / ceiling - 1));
  for (const t of onsetTimes(strength, rate)) {
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

/** Where a note or hit ends, in frames: its segment's start, its peak, its last frame before the fall, and the frames of its tail in order (short sounds over it left out). */
interface End {
  start: number;
  peak: number;
  last: number;
  tail: number[];
  /** For an end found as a bend: every frame in time where the level falls under its line, and how far, dB. */
  bends: Array<[number, number]>;
}

/**
 * The last frame of a note's direct sound, or null when there is none with ROOM frames after it
 * (by `lastEnd`); and, for an end found as a bend, every frame in time where the level falls under
 * its line, with how far (`bends`: tailShare weighs the tail's share by them). Up to where the level is first END_DB under the peak: the frame after which the
 * level falls furthest under where it was heading. A line is fitted to the BEND_FRAMES levels up to
 * each frame, and the fall is how far the BEND_FRAMES levels after it lie under that line carried on,
 * on average. A note cut short drops under it (a step, over its reverb or into silence); a note held
 * over a heavy reverb, which makes no step, bends under it (the reverb holds or grows while the note
 * sounds and falls once it stops); a slope alone, a pluck's own fall or a reverb's, makes none. The
 * frame with the furthest fall, when it is at least BEND_DB; otherwise (a hit, which falls along one
 * line from its peak, or fast and then slower into a tail) the last frame before the level is END_DB
 * under the peak. Levels are held to BODY_SPAN_DB under that, so digital silence counts as a drop of
 * that size and no more.
 *
 * Where the bends are looked for: in a sound that peaks as it starts, from HIT_FRAMES after its peak
 * (a hit through a reverb has a rounded top, which is no end); in one that peaks later (a note under
 * a heavy reverb, whose level peaks where the note stops), from its peak, the line's frames all past
 * the onset's rise, when the level had all but stopped rising there (GROWN_DB): a level still
 * climbing into its peak is a slow attack, and its bends are looked for past the peak like any note's. A line that rises is carried on level. A slight bend (under STEP_DB) where the
 * level is already within NEAR_DB of END_DB under the peak is a hit's fall, not a note's end.
 */
function bodyEnd(levels: Float64Array, smooth: Float64Array, start: number, peak: number, lastEnd: number, stop: number): { last: number; bends: Array<[number, number]> } | null {
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
  const bends: Array<[number, number]> = [];
  let best = -1;
  let furthest = BEND_DB;
  let bestInTime = -1;
  let furthestInTime = BEND_DB;
  // (searched to where it is END_DB down, or the segment's end, so an end found past `lastEnd` says there is none)
  const until = Math.min(crossed < 0 ? stop - 1 : crossed - 1, levels.length - 1 - BEND_FRAMES);
  // (a level still climbing into its peak is a slow attack, not a reverb grown full: the bends are then looked for past the peak, as for any note)
  const grown = peak - BEND_FRAMES >= start && smooth[peak] - smooth[peak - BEND_FRAMES] < GROWN_DB;
  for (let b = peak - start <= ATTACK + 2 ? peak + HIT_FRAMES : grown ? Math.max(peak, start + ATTACK + BEND_FRAMES - 1) : peak + BEND_FRAMES - 1; b <= until; b++) {
    // The line through the BEND_FRAMES levels up to b, as level at b plus slope a frame
    let sy = 0;
    let sxy = 0;
    for (let i = 0; i < BEND_FRAMES; i++) {
      const y = at(b - BEND_FRAMES + 1 + i);
      sy += y;
      sxy += i * y;
    }
    // (a line that rises is carried on level: where a reverb is still building, the level flattens under it, and nothing has stopped)
    const slope = Math.min(0, (sxy - mx * sy) / vx);
    const there = sy / BEND_FRAMES + slope * (BEND_FRAMES - 1 - mx);
    let fall = 0;
    for (let j = 1; j <= BEND_FRAMES; j++) fall += (there + slope * j - at(b + j)) / BEND_FRAMES;
    if (b <= lastEnd && fall > 0) bends.push([b, fall]);
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
  // (a slight bend where the sound has all but fallen END_DB along its line is a hit's fall: a hat over a snare bends it as far)
  if (best >= 0 && furthest < STEP_DB && crossed >= 0 && crossed - 1 <= lastEnd && levels[best] < under + NEAR_DB) return { last: crossed - 1, bends: [] };
  if (best >= 0 && best <= lastEnd) return { last: best, bends };
  if (best >= 0) return bestInTime >= 0 && furthestInTime >= AS_FAR * furthest ? { last: bestInTime, bends } : null;
  return crossed >= 0 && crossed - 1 <= lastEnd ? { last: crossed - 1, bends: [] } : null;
}

/**
 * The short sounds that come over something still falling (a hat over a snare's reverb): a frame
 * BLIP_DB over the level just before it, with the level under that again within BLIP frames. What
 * was falling shows through after them, so they start no note and end no tail: `out` marks their
 * frames (only where the sound starts at once, SHARP_DB in a frame or two: the tail of one partial,
 * a tom's, swells as far over more frames, and is no short sound), and `clean` is the levels with a straight line drawn under them. A short sound in silence
 * is not one: the level comes back to where it was, not under it.
 */
function shortSounds(levels: Float64Array): { clean: Float64Array; out: Uint8Array } {
  const n = levels.length;
  const smooth = smoothed(levels);
  const clean = Float64Array.from(levels);
  const out = new Uint8Array(n);
  for (let g = 4; g < n; g++) {
    const base = Math.min(smooth[g - 4], smooth[g - 3], smooth[g - 2]);
    if (levels[g] <= base + BLIP_DB) continue;
    // (a short sound starts at once: the grain of a tail of one partial swells as far, over more frames)
    if (levels[g] - Math.min(levels[g - 1], levels[g - 2]) < SHARP_DB) continue;
    let back = -1;
    for (let h = g + 1; h <= g + BLIP && h < n && back < 0; h++) if (smooth[h] < base) back = h;
    if (back < 0) continue;
    // (the averaged level lags a frame: the frame before is the short sound's rise, the frame it is back by still its fall)
    const from = levels[g - 2];
    const to = levels[Math.min(n - 1, back + 1)];
    for (let f = g - 1; f <= back; f++) {
      out[f] = 1;
      clean[f] = from + ((to - from) * (f - g + 2)) / (back - g + 3);
    }
    g = back;
  }
  return { clean, out };
}

/** The levels averaged over three frames: a tail's own grain rises and falls a dB or two from frame to frame. */
function smoothed(levels: Float64Array): Float64Array {
  const n = levels.length;
  return Float64Array.from(levels, (_, f) => (levels[Math.max(0, f - 1)] + levels[f] + levels[Math.min(n - 1, f + 1)]) / 3);
}

/**
 * The frames of the tail after a note's last frame, up to `stop`, or null when what follows is no
 * tail. It is followed until it is FALLEN_DB under the end, the frames of short sounds over it
 * (`out`) left out. Where the level swells (SWELL_DB over the lowest it has been, or in the first
 * AFTER_END frames RISE_DB over the end) the tail stops, and in the first AFTER_END frames there was
 * no tail (a tremolo's dip). Over those frames (or all it has) it must fall MIN_FALL_DB.
 */
function tailOf(levels: Float64Array, smooth: Float64Array, out: Uint8Array, last: number, stop: number): number[] | null {
  const ref = levels[last];
  const to = Math.min(stop, last + 1 + MAX_TAIL);
  const tail: number[] = [];
  let lowest = ref;
  let fallen = false;
  for (let g = last + 1; g < to && !fallen; g++) {
    if (out[g]) continue;
    const early = g <= last + AFTER_END;
    if (smooth[g] > lowest + SWELL_DB || (early && smooth[g] > ref + RISE_DB)) {
      if (early) return null;
      break;
    }
    tail.push(g);
    lowest = Math.min(lowest, smooth[g]);
    fallen = levels[g] <= ref - FALLEN_DB;
  }
  if (fallen) return tail;
  let watched = 0;
  while (watched < tail.length && tail[watched] <= last + AFTER_END) watched++;
  if (watched < 3) return null;
  const over = Math.min(5, watched);
  let late = 0;
  for (let i = watched - over; i < watched; i++) late += smooth[tail[i]] / over;
  return late > ref - MIN_FALL_DB ? null : tail;
}

/**
 * The ends of the notes and hits, on the levels with the short sounds over tails taken out
 * (shortSounds). Each onset starts a segment that runs to the next (an onset of a short sound over a
 * tail starts none). In a segment the end is the last frame of the direct sound after the segment's
 * peak (bodyEnd), with ROOM frames still to come, and what follows it must be a tail (tailOf).
 */
function endsOf(levels: Float64Array, smooth: Float64Array, out: Uint8Array, found: readonly number[]): { ends: End[]; endless: Array<[number, number]> } {
  const n = levels.length;
  const ends: End[] = [];
  /** The notes no end is found for: their segments, start and stop. */
  const endless: Array<[number, number]> = [];
  const onsets = found.filter((o) => !out[o] && !out[Math.min(n - 1, o + 1)]);
  for (let o = 0; o < onsets.length; o++) {
    const start = Math.max(0, onsets[o] - LEAD);
    const stop = o + 1 < onsets.length ? Math.min(n, Math.max(start, onsets[o + 1] - LEAD)) : n;
    const lastEnd = Math.max(start, stop - 1 - ROOM);
    let peak = start;
    for (let f = start; f <= lastEnd; f++) if (smooth[f] > smooth[peak]) peak = f;
    if (levels[peak] < -NOTE_RANGE_DB) continue;
    const body = stop - 1 - ROOM < start ? null : bodyEnd(levels, smooth, start, peak, lastEnd, stop);
    const tail = body && tailOf(levels, smooth, out, body.last, stop);
    if (body && tail) ends.push({ start, peak, tail, ...body });
    else endless.push([start, stop]);
  }
  return { ends, endless };
}

/**
 * The slope of the line through the levels at `frames[a]` to `frames[b - 1]`, a frame, how far they
 * miss it (root mean square), dB, and how many frames the line runs over. Where frames are left out
 * (a short sound over the tail), each stretch has its own line, all of the one slope: the short
 * sound's own tail lifts what follows it, and one line through both stretches would lie too flat.
 */
function slopeOf(levels: Float64Array, frames: readonly number[], a: number, b: number): { slope: number; miss: number; span: number } {
  let vx = 0;
  let cxy = 0;
  let vy = 0;
  let span = 0;
  for (let from = a; from < b; ) {
    let to = from + 1;
    while (to < b && frames[to] === frames[to - 1] + 1) to++;
    const n = to - from;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (let i = from; i < to; i++) {
      const x = i - from;
      const y = levels[frames[i]];
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
      syy += y * y;
    }
    vx += sxx - (sx * sx) / n;
    cxy += sxy - (sx * sy) / n;
    vy += syy - (sy * sy) / n;
    span += n - 1;
    from = to;
  }
  const slope = vx > 0 ? cxy / vx : 0;
  return { slope, miss: Math.sqrt(Math.max(0, vy - slope * cxy) / Math.max(1, b - a)), span };
}

/**
 * The time a tail takes to fall FALL_DB, frames, or null when it is not timed. When the level is
 * FALL_DB under the end's within QUICK frames (a sound that stops), the time it takes to get there,
 * read between two frames. Otherwise FALL_DB over the slope of the line through the tail's levels from
 * its second frame (the first can still hold the end of the direct sound). It runs to where the level is FALL_DB under its start, when it gets there; when the tail stops first
 * (the next onset comes), to where it stops, and then only when the line falls at least TIMED_DB over
 * those frames, the levels miss it by at most FIT_DB (root mean square), and its second half falls at
 * least SETTLE as fast as its first. A reverb falls along a line; a held layer or noise under the
 * notes is flat, or falls and then lies flat, and is not timed.
 *
 * The tail up to the first short sound over it is tried first; then, for a hit, that with the hit's
 * own fall before it; then all of the tail: the stretches between
 * the short sounds each on a line of their own, all of one slope (slopeOf). A first stretch that falls
 * over ONE_SLOPE times as fast as the rest still holds the direct sound's own fall (a hit that falls
 * fast and then rings on in a quiet reverb), and is left out.
 */
function fallFrames(levels: Float64Array, { peak, last, tail, bends }: End, least = TIMED_DB): number | null {
  const quick = tail.findIndex((g) => levels[g] <= levels[last] - FALL_DB);
  /** The time the level crosses `target`, between frame `g` - 1 and `g`, from frame `from`. */
  const at = (g: number, target: number, from: number) => {
    const before = levels[g - 1];
    const frac = before > levels[g] ? (before - target) / (before - levels[g]) : 1;
    return Math.max(0, g - from - 1.5 + frac);
  };
  if (quick >= 0 && tail[quick] < last + 1 + QUICK) return at(tail[quick], levels[last] - FALL_DB, last);
  /** The fall along the line through `frames`, counted from the level at frame `from`. */
  const timed = (frames: number[], from: number): number | null => {
    if (frames.length < 3) return null;
    const crossed = frames.findIndex((g) => levels[g] <= levels[from] - FALL_DB);
    if (crossed >= 0) {
      // A fall seen whole: its rate, from its start to where it is FALL_DB down
      if (crossed + 1 < 3) return at(frames[crossed], levels[from] - FALL_DB, from);
      const seen = slopeOf(levels, frames, 0, crossed + 1).slope;
      return seen < 0 ? FALL_DB / -seen : at(frames[crossed], levels[from] - FALL_DB, from);
    }
    // A fall cut short: timed only when it falls straight and far enough
    const count = frames.length;
    if (count < 3) return null;
    const whole = slopeOf(levels, frames, 0, count);
    if (!(whole.slope < 0) || -whole.slope * whole.span < least || whole.miss > FIT_DB) return null;
    // (and its second half falls at least SETTLE as fast as its first: a fall onto a floor flattens; read on 4 frames a half at least)
    const half = count >> 1;
    if (count >= 8 && slopeOf(levels, frames, half, count).slope > SETTLE * slopeOf(levels, frames, 0, half).slope) return null;
    return FALL_DB / -whole.slope;
  };
  // The tail up to the first short sound over it
  const after = tail.filter((g) => g >= last + 2);
  let unbroken = 0;
  while (unbroken < after.length && after[unbroken] === last + 2 + unbroken) unbroken++;
  if (unbroken === after.length) return timed(after, last);
  const first = timed(after.slice(0, unbroken), last);
  if (first !== null) return first;
  // A hit falls along one line from its peak: that stretch with the hit's own fall before it, from HALF_DB under its peak (past its rounded top), when the line does not slow (it would be a quick direct sound giving way to its reverb)
  if (!bends.length) {
    let half = peak + 1;
    while (half < last && levels[half] > levels[peak] - HALF_DB) half++;
    const whole: number[] = [];
    for (let f = half + 1; f <= last + 1; f++) whole.push(f);
    whole.push(...after.slice(0, unbroken));
    const middle = whole.length >> 1;
    if (middle >= 4 && slopeOf(levels, whole, middle, whole.length).slope <= NOT_SLOWING * slopeOf(levels, whole, 0, middle).slope) {
      const own = timed(whole, half);
      if (own !== null) return own;
    }
  }
  // All of it, less a first stretch that falls much faster than the rest
  if (unbroken >= 4 && after.length - unbroken >= 4) {
    const rest = slopeOf(levels, after, unbroken, after.length).slope;
    if (rest < 0 && slopeOf(levels, after, 0, unbroken).slope < ONE_SLOPE * rest) return timed(after.slice(unbroken), after[unbroken] - 1);
  }
  return timed(after, last);
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

/** How alike two spectra are: the cosine between them, 0 to 1. */
function likenessOf(a: Float64Array, b: Float64Array): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let k = 0; k < a.length; k++) {
    ab += a[k] * b[k];
    aa += a[k] * a[k];
    bb += b[k] * b[k];
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** The samples in the spectra's window at `sampleRate`: the power of two at or above SPECTRUM_SECONDS of them. */
function spectrumSize(sampleRate: number): number {
  let size = 1;
  while (size < SPECTRUM_SECONDS * sampleRate - 1e-9) size *= 2;
  return size;
}

/** The raised-cosine window of `size` samples the spectra are read through. */
function spectrumWindow(size: number): Float64Array {
  return Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / size));
}

/**
 * The spectrum of the sound from a sample on: the channels' magnitudes added (so a repeat on the
 * other side still compares), as many samples as `window` has through it, up to SPECTRUM_TOP_HZ.
 * Two channels go through one transform, the first as its real part and the second as its imaginary,
 * and are taken apart after it (each a real signal, its spectrum is half of X[k] plus or minus the
 * conjugate of X[N - k]).
 */
function spectrumOf(channels: readonly Float32Array[], sampleRate: number, from: number, window: Float64Array): Float64Array {
  const size = window.length;
  const top = Math.min(size / 2, Math.round((SPECTRUM_TOP_HZ / sampleRate) * size));
  const out = new Float64Array(top);
  const [first, second] = channels;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = Math.max(0, -from); i < size && from + i < first.length; i++) {
    re[i] = first[from + i] * window[i];
    if (second) im[i] = second[from + i] * window[i];
  }
  fftInPlace(re, im);
  for (let k = 1; k < top; k++) {
    if (!second) {
      out[k] = Math.hypot(re[k], im[k]);
      continue;
    }
    const [r, i, rr, ii] = [re[k], im[k], re[size - k], im[size - k]];
    out[k] = Math.hypot(r + rr, i - ii) / 2 + Math.hypot(i + ii, r - rr) / 2;
  }
  return out;
}

/**
 * A clear echo, or null. The lags tried are the highest peaks, from 60 to 1500 ms, of the
 * autocorrelation of the level envelope's rises. A lag is an echo when repeats follow the onsets at multiples of it,
 * each a like step quieter than the one before: a repeated note's onsets line up with its lag too,
 * but as loud as the one before, so they are notes, not repeats. Of the lags that are echoes (and not
 * a multiple of a shorter one), the one most onsets are followed by; its repeats, the most that
 * follow any one onset. `spectrumAt` gives the spectrum from a frame, whole or not.
 */
function echoOf(levels: Float64Array, onsets: readonly number[], spectrumAt: (frame: number) => Float64Array, tempoBpm?: number): (NonNullable<Space['echo']> & { lag: number }) | null {
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
    // And the repeats sound like what they repeat: different notes a like step quieter each time are a phrase, not an echo
    const likeness = events.filter((at) => repeatsAfter(levels, at, lag).count > 0).map((at) => likenessOf(spectrumAt(at), spectrumAt(at + lag)));
    if (median(likeness) < ECHO_ALIKE) continue;
    echoes.push({ lag, share: alike.length / events.length, repeats });
  }
  // An echo repeats at twice its lag too: a lag that is a multiple of another echo's is that echo
  const own = echoes.filter((e) => !echoes.some((o) => o.lag < e.lag && Math.abs(e.lag / o.lag - Math.round(e.lag / o.lag)) <= MULTIPLE_TOLERANCE));
  let best: (typeof own)[number] | null = null;
  for (const e of own) if (!best || e.share > best.share) best = e;
  if (!best) return null;
  const ms = Math.round(best.lag * FRAME_SECONDS * 1000);
  const note = tempoBpm === undefined ? undefined : noteOf(1000 / ms, tempoBpm);
  return { ms, repeats: best.repeats, ...(note ? { note } : {}), lag: best.lag };
}

/** The highest level about an onset, dB. */
function peakNear(levels: Float64Array, onset: number): number {
  let peak = -Infinity;
  for (let f = Math.max(0, onset - LEAD); f <= Math.min(levels.length - 1, onset + 4); f++) peak = Math.max(peak, levels[f]);
  return peak;
}

/** The energy of a note up to its end. */
function noteEnergy(energy: Float64Array, { start, last }: End): number {
  let sum = 0;
  for (let f = start; f <= last; f++) sum += energy[f];
  return sum;
}

/**
 * The share of a note's energy (`whole`: the note and its tail) that comes after its end. For a hit,
 * after the end as found. For an end found as a bend, the mean of the shares after every frame where
 * the level falls under its line, each weighed by the square of how far: a note that stops with a
 * step has one such place, and the share is the one after it; under a heavy reverb the bend is slight
 * and the tail's own grain bends as far, so the place found can be any of several, tenths of a second
 * apart, and the share after one of them alone would jump about from one sound to the next like it.
 */
function tailShare(energy: Float64Array, end: End, whole: number): number {
  const { start, bends } = end;
  if (!bends.length) return 1 - noteEnergy(energy, end) / whole;
  let weights = 0;
  let sum = 0;
  let upTo = 0;
  let f = start;
  for (const [b, fall] of bends) {
    for (; f <= b; f++) upTo += energy[f];
    weights += fall * fall;
    sum += fall * fall * Math.max(0, 1 - upTo / whole);
  }
  return weights > 0 ? sum / weights : 1 - noteEnergy(energy, end) / whole;
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
  let loudest = 0;
  for (const e of bright) loudest = Math.max(loudest, e);
  if (!(loudest > 0) || !Number.isFinite(loudest)) return none;
  // The level envelope, of the first differences: a note's partials then weigh alike, so the level of a
  // tail is the sum of many of them, not the grain of its loudest alone (a low partial ringing in a
  // reverb swells and sags by several dB as it decays). The tail's share is read on the same energy: on
  // the plain energy a kick the envelope barely shows, coming after a snare's end, counted as the snare's tail
  const levels = Float64Array.from(bright, (e) => Math.max(FLOOR_DB, 10 * Math.log10(e / loudest)));

  const onsets = onsetsOf(cut, sampleRate, levels);
  // The spectrum from a frame on, which may fall between frames (a repeat is placed at its exact sample,
  // the lag's whole length after its sound's); each made once, as an event is compared with its
  // repeat at every lag tried
  const window = spectrumWindow(spectrumSize(sampleRate));
  const spectra = new Map<number, Float64Array>();
  const spectrumAt = (frame: number) => {
    const from = Math.round((frame - 1) * hop);
    let spectrum = spectra.get(from);
    if (!spectrum) spectra.set(from, (spectrum = spectrumOf(cut, sampleRate, from, window)));
    return spectrum;
  };
  const found = echoOf(levels, onsets, spectrumAt, tempoBpm);
  let echo: Space['echo'] = null;
  let notes = onsets;
  if (found) {
    const { lag, ...rest } = found;
    echo = rest;
    // An echo's repeats start no notes of their own: an onset at a multiple of the echo's time after a louder one is its repeat
    const kept: number[] = [];
    for (const o of onsets) {
      const repeat = kept.some((p) => {
        const times = (o - p) / lag;
        return Math.round(times) >= 1 && Math.round(times) <= rest.repeats && Math.abs(times - Math.round(times)) * lag <= LEAD && peakNear(levels, o) <= peakNear(levels, p) - STEP_MIN_DB;
      });
      if (!repeat) kept.push(o);
    }
    notes = kept;
  }

  const { clean, out } = shortSounds(levels);
  const { ends, endless } = endsOf(clean, smoothed(clean), out, notes);
  const falls: Array<[number, number]> = [];
  const shares: Array<[number, number]> = [];
  /** Every end: the time its tail takes to fall (timed, or else when it falls LIKE_DB at least along a line; else null), whether it is timed, its tail's energy and its weight. */
  const read: Array<{ fall: number | null; timed: boolean; tail: number; weight: number }> = [];
  const width = { tailSide: 0, tailMid: 0, directSide: 0, directMid: 0 };
  for (const end of ends) {
    // The note and its tail, on the energy the level is read from
    const note = noteEnergy(bright, end);
    let tail = 0;
    for (const f of end.tail) tail += bright[f];
    // (each end counts by the root of its note's energy: a quiet hat between the snares counts for little)
    const weight = Math.sqrt(note);
    const fall = fallFrames(clean, end);
    if (fall !== null) falls.push([fall * FRAME_SECONDS * 1000, weight]);
    const rate = fall ?? fallFrames(clean, end, LIKE_DB);
    read.push({ fall: rate === null ? null : rate * FRAME_SECONDS * 1000, timed: fall !== null, tail, weight });
    if (note + tail > 0) shares.push([tailShare(bright, end, note + tail), weight]);
    if (!side) continue;
    for (const f of end.tail) {
      width.tailSide += side[f];
      width.tailMid += mid[f];
    }
    // (the direct sound: the note from its start to its peak, before much of a reverb has built up)
    for (let f = end.start; f <= end.peak; f++) {
      width.directSide += side[f];
      width.directMid += mid[f];
    }
  }

  // All three need a tail that is timed, or the "tails" may be a held layer or noise; and when in
  // doubt nothing is said. An end speaks for the decay when its tail falls at that rate (within
  // LIKE of it, or both under QUICK_MS): timed, or cut short before it can be timed but falling
  // LIKE_DB along a line. MIN_ENDS ends at least must; the ends that do not may hold no more than
  // half of the energy after ends (dry notes beside notes drowned in a reverb read nothing, not
  // "dry"); and the notes no end is found for, with the ends that do not, no more than UNREAD of
  // the weight of all the notes (dry drums over plucks ringing in a reverb likewise)
  if (falls.length === 0 || shares.length === 0) return { ...none, echo };
  const decay = weightedMedian(falls);
  const like = (fall: number | null) => fall !== null && (Math.abs(fall / decay - 1) <= LIKE || (fall < QUICK_MS && decay < QUICK_MS));
  let count = 0;
  let tails = 0;
  let unlikeTails = 0;
  let weights = 0;
  let unlikeWeights = 0;
  for (const { fall, tail, weight } of read) {
    tails += tail;
    weights += weight;
    if (like(fall)) count++;
    else {
      unlikeTails += tail;
      unlikeWeights += weight;
    }
  }
  for (const [start, stop] of endless) {
    let energy = 0;
    for (let f = start; f < stop; f++) energy += bright[f];
    weights += Math.sqrt(energy);
    unlikeWeights += Math.sqrt(energy);
  }
  if (count < MIN_ENDS || unlikeTails > tails / 2 || unlikeWeights > UNREAD * weights) return { ...none, echo };
  const decayMs = Math.round(decay);
  // (beside an echo, a decay under DRY_MS is the notes' own stop, under repeats that ring on: neither it nor the share after it is given)
  if (echo && decayMs < DRY_MS) return { ...none, echo };
  return {
    decayMs,
    wetShare: round2(weightedMedian(shares)),
    echo,
    // (tails that are digital silence have no width to speak of; nor is a width given beside an echo, where what comes after the notes is repeats, often thrown from side to side, nor
    // when sounds stop almost at once, where the "tail" is a noise floor, dither or the sound's own unlike sides)
    tailWiderDb: side && !echo && decayMs >= DRY_MS && width.tailSide + width.tailMid > 0 ? round1(sideOverMidDb(width.tailSide, width.tailMid) - sideOverMidDb(width.directSide, width.directMid)) : null,
  };
}
