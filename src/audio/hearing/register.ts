/**
 * Where the pitched parts of a sound sit, for the hearing report: its register. The harmonic part of
 * the channels' mix (at 12 kHz, which keeps every overtone it looks at) is cut into frames; in each, the clear spectral peaks are gathered, and the parts
 * that sound are picked one at a time by harmonic sum (the note on a 1/12-octave grid whose peak and
 * overtones hold the most energy), each pick's overtones then taken out so an overtone doesn't read
 * as a part of its own. From the parts picked: the low, centre and high of the pitched energy, the
 * top line, and the share of it in each octave. Every level is relative to the sound itself, so
 * the reading doesn't depend on how loud it plays. Plain maths on samples, no Web Audio, so Node can
 * test it.
 */
import { analysisMix } from '../channelMix';
import { fftInPlace } from '../fft';
import { harmonicPercussive } from '../harmonicPercussive';
import { resampleOnce } from '../loopResample';
import type { Register } from './types';

/** The rate the register is measured at, Hz (a sound at a lower rate is measured at its own): enough for overtones to 5 kHz, and a quarter of the work of 48 kHz. */
const MEASURE_RATE = 12000;
/** The resampling's sinc reaches this many zero crossings each side: flat to 4.9 kHz at 12 kHz, 0.3 dB down at 5.1 kHz. */
const RESAMPLE_HALF = 12;
/** The range of a part's pitch, Hz (B0 to C8 on the grid). */
const LOWEST_HZ = 30;
const HIGHEST_HZ = 4200;
/** Overtones are looked for up to this frequency, Hz, and this many of them (the fundamental counted). */
const OVERTONES_UP_TO_HZ = 5000;
const MAX_HARMONICS = 20;
/** An overtone is the peak within this share of its expected frequency. */
const HARMONIC_TOLERANCE = 0.03;
/**
 * A peak stands this far over the floor of the spectrum about a quarter of an octave around it (at
 * least 6 bins either side), dB; the floor is the lower tenth of the bins there, what lies between
 * the peaks.
 */
const PEAK_DB = 25;
const LOW_QUANTILE = 0.1;
/** Peaks under this frequency are left out (what's under the lowest pitch is rumble), Hz. */
const PEAKS_FROM_HZ = 25;
/** The parts kept in a frame: within this of its strongest, dB; and at most this many. */
const KEEP_DB = 15;
const MAX_PARTS = 8;
/** The top line of a frame: its highest part within this of its strongest, dB. */
const TOP_DB = 10;
/** A part counts only within this of the loudest frame of the whole sound, dB. */
const FLOOR_DB = 40;
/** A part's fundamental holds at least this share of the power at its harmonics (a part is not read from a stray peak under another's). */
const ROOT_SHARE = 0.03;
/** A peak starts a part of its own only while this share of its power is not yet some lower part's overtone. */
const FRESH_SHARE = 0.25;
/**
 * A part on a lower part's series (its root that part's 2nd overtone or higher) stands only when it
 * lifts the overtones it sits on: over the first SERIES_HARMONICS of its harmonics that can be judged,
 * the median of the power at each over the power the parts there put there by their own series (see
 * liftsSeries). A real part lifts every overtone it sits on; a room's colouring, a formant or an echo's
 * comb lifts some and drops others. The median must clear SERIES_DB, a doubling (the part holds as much
 * there as the overtone it sits on), and SERIES_Z standard errors (a one-sided 5% chance) of a median of
 * that many lifts that a diffuse reverb's colouring alone gives: its response at one frequency has an
 * exponentially distributed power, which spreads SERIES_SPREAD_DB (10/ln 10 times pi/sqrt 6) in dB, and
 * a median of K has a standard error sqrt(pi/2) times that over sqrt K. With fewer than SERIES_LEAST
 * harmonics to judge by (a root over a third of 5 kHz), a lift can't be told from a colouring, and the
 * peak stays the lower part's overtone.
 */
const SERIES_DB = 3;
const SERIES_SPREAD_DB = 5.57;
const SERIES_Z = 1.645;
const SERIES_HARMONICS = 8;
const SERIES_LEAST = 3;
/**
 * A dry note's overtones lie on a smooth line (log power against log harmonic number); a room's colouring
 * scatters them by about SERIES_SPREAD_DB. Where the lower parts' overtones off a candidate's series
 * stray from that line by at most SMOOTH_DB (RMS, over at least SMOOTH_LEAST of them), no room has
 * coloured them, and the candidate also stands when its root alone lifts the overtone it sits on by
 * SERIES_DB and by SMOOTH_Z times that deviation: a part whose own overtones miss half of the ones it
 * sits on (a triangle's or a square's, with no even harmonics) lifts too few of them for the median.
 * (Over made held notes, melodies and chords, a frame's first part strays a median 0.2 dB dry, and
 * three quarters of dry frames 1.5 dB or less; through rooms at wet 0.5 and 0.8, 0.7% and 0.3% do.)
 */
const SMOOTH_DB = 1.5;
const SMOOTH_Z = 3;
const SMOOTH_LEAST = 4;
/** Under this share of its frames holding a part, a sound has no register. */
const MIN_PITCHED_SHARE = 0.05;
/** A frame holds parts only when they hold this share of its energy (noise has its peaks, but they hold little). */
const FRAME_SHARE = 0.25;
/** Notes up to this far apart, semitones, are read between (a whole tone, and a little for tuning). */
const WHOLE_TONE = 2.5;
/** C1, Hz: where the first of the eight octaves starts. */
const C1_HZ = 440 * 2 ** (-45 / 12);

/** Whole Hz from 100 Hz up, tenths under it. */
const roundHz = (hz: number) => (hz >= 100 ? Math.round(hz) : Math.round(hz * 10) / 10);

/** The frame size for `sampleRate`: 4096 at 48 kHz, the nearest power of two to the same length elsewhere. */
const frameSize = (sampleRate: number) => 2 ** Math.max(8, Math.round(Math.log2((4096 * sampleRate) / 48000)));

/** A part heard in a frame: its pitch, Hz, and the energy of its peak and overtones. */
interface Part {
  hz: number;
  energy: number;
}

/**
 * The energy-weighted percentile `p` (0 to 1) of the pitches of `notes` (sorted by pitch): each note
 * stands at the middle of its share of the energy. Between two notes up to a whole tone apart the
 * pitch is read on the line from one to the other (in octaves), so a percentile moves smoothly as
 * the energy shifts between neighbouring notes; across a wider gap it is the note whose share it
 * falls in, so a little energy far off does not pull it across the gap.
 */
function percentile(notes: readonly Part[], total: number, p: number): number {
  const target = p * total;
  let before = 0;
  for (let i = 0; i < notes.length; i++) {
    const at = before + notes[i].energy / 2;
    if (target <= at || i === notes.length - 1) return notes[i].hz;
    const next = notes[i + 1];
    const nextAt = before + notes[i].energy + next.energy / 2;
    if (target < nextAt) {
      const apart = 12 * Math.log2(next.hz / notes[i].hz);
      if (apart > WHOLE_TONE) return target < before + notes[i].energy ? notes[i].hz : next.hz;
      return notes[i].hz * (next.hz / notes[i].hz) ** ((target - at) / (nextAt - at));
    }
    before += notes[i].energy;
  }
  return notes[notes.length - 1].hz;
}

/** The `k`-th smallest (from 0) of the first `n` of `values`, which it reorders (Hoare's selection). */
function kthOf(values: Float64Array, n: number, k: number): number {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = values[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const t = values[i];
        values[i] = values[j];
        values[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return values[k];
}

/** The median of `values` (not empty). */
function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Shares (each 0 to 1) rounded to 2 places so that they still add to 1: each rounded down, then the
 * hundredths left over given to the largest remainders.
 */
function sharesOf(weights: readonly number[], total: number): number[] {
  const raw = weights.map((w) => (w / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rest: r - floors[i] })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]++;
    left--;
  }
  return floors.map((f) => f / 100);
}

/**
 * The parts heard in one frame's power spectrum (`power`, `size / 2 + 1` bins), in the order picked. Peaks
 * are local maxima standing PEAK_DB over the spectrum around them (noise seldom does), placed by a
 * parabola through the log power. Then, while a part could still be kept within KEEP_DB of the first:
 * for each semitone of the grid, its strongest peak as a fundamental, with the peaks at its overtones;
 * the one with the most power still unexplained is the next part. Its fundamental is taken out whole,
 * each overtone by as much as the overtones either side of it hold (the smooth series a note's overtones
 * make), so a louder note sitting on one of them keeps the rest. A candidate rooted on a picked part's
 * overtone waits while one off the picked parts' series would be kept, and then is a part only if it
 * lifts the series it sits on (liftsSeries), not just the one overtone. Once the parts are known, the
 * shares of the peaks they share are read again from their own series.
 */
function partsOfFrame(power: Float64Array, sampleRate: number, size: number, energy: number): Part[] {
  const half = size / 2;
  const binHz = sampleRate / size;
  // The log power, floored 120 dB under the frame's energy
  const tiny = energy * 1e-12;
  const logs = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) logs[k] = Math.log(power[k] + tiny);
  const from = Math.max(2, Math.ceil(PEAKS_FROM_HZ / binHz));
  const to = Math.min(half - 1, Math.floor((OVERTONES_UP_TO_HZ * (1 + HARMONIC_TOLERANCE)) / binHz));
  const over = (PEAK_DB / 10) * Math.LN10;
  const freqs: number[] = [];
  const powers: number[] = [];
  const scratch = new Float64Array(half + 1);
  // The floor about bin k, read at every third of its reach and kept (it changes slowly along the bins)
  const floors = new Float64Array(half + 1).fill(NaN);
  const floorAt = (k: number): number => {
    const reach = Math.max(6, Math.round(k * 0.19));
    const at = k - (k % Math.max(1, Math.round(reach / 3)));
    if (Number.isNaN(floors[at])) {
      const lo = Math.max(1, at - reach);
      const hi = Math.min(half, at + reach);
      const n = hi - lo + 1;
      for (let i = 0; i < n; i++) scratch[i] = logs[lo + i];
      floors[at] = kthOf(scratch, n, Math.floor(LOW_QUANTILE * (n - 1)));
    }
    return floors[at];
  };
  for (let k = from; k <= to; k++) {
    if (!(logs[k] > logs[k - 1] && logs[k] >= logs[k + 1])) continue;
    if (logs[k] - floorAt(k) < over) continue;
    const a = logs[k - 1];
    const b = logs[k];
    const c = logs[k + 1];
    const bend = a - 2 * b + c;
    const offset = bend < 0 ? (0.5 * (a - c)) / bend : 0;
    freqs.push((k + offset) * binHz);
    powers.push(Math.exp(b - 0.25 * (a - c) * offset));
  }
  if (freqs.length === 0) return [];

  /** The index of the peak nearest `hz` within the tolerance, or -1. */
  const nearest = (hz: number): number => {
    let lo = 0;
    let hi = freqs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (freqs[mid] < hz) lo = mid + 1;
      else hi = mid;
    }
    let best = -1;
    let gap = hz * HARMONIC_TOLERANCE;
    for (const i of [lo - 1, lo]) {
      if (i < 0 || i >= freqs.length) continue;
      const d = Math.abs(freqs[i] - hz);
      if (d <= gap) {
        gap = d;
        best = i;
      }
    }
    return best;
  };

  // The candidates: per semitone of the grid, its strongest peak, and the peaks at its overtones
  const firstNote = Math.ceil(69 + 12 * Math.log2(LOWEST_HZ / 440));
  const lastNote = Math.floor(69 + 12 * Math.log2(HIGHEST_HZ / 440));
  const candidates: Array<{ harmonics: number[] }> = [];
  let p = 0;
  for (let note = firstNote; note <= lastNote; note++) {
    const bandLo = 440 * 2 ** ((note - 69.5) / 12);
    const bandHi = 440 * 2 ** ((note - 68.5) / 12);
    while (p < freqs.length && freqs[p] < bandLo) p++;
    let root = -1;
    for (let i = p; i < freqs.length && freqs[i] < bandHi; i++) if (root < 0 || powers[i] > powers[root]) root = i;
    if (root < 0) continue;
    // Each overtone looked for where the pitch read so far puts it (energy-weighted, from the peaks found)
    const harmonics = [root];
    let pitchSum = freqs[root] * powers[root];
    let weight = powers[root];
    for (let h = 2; h <= MAX_HARMONICS; h++) {
      const expected = (h * pitchSum) / weight;
      if (expected > OVERTONES_UP_TO_HZ) break;
      const i = nearest(expected);
      harmonics.push(i);
      if (i >= 0) {
        pitchSum += (freqs[i] / h) * powers[i];
        weight += powers[i];
      }
    }
    candidates.push({ harmonics });
  }

  /** The index of the peak nearest `hz` within `gap` Hz, or -1. */
  const nearestWithin = (hz: number, gap: number): number => {
    const i = nearest(hz);
    return i >= 0 && Math.abs(freqs[i] - hz) <= gap ? i : -1;
  };

  /** A part picked: its pitch, and its peaks by harmonic (n - 1; -1 none, -2 not looked up yet). */
  interface Picked {
    hz: number;
    peakAt: Int32Array;
  }
  const picked: Picked[] = [];
  /** A part's harmonic at a peak: which part (its place in `parts`), which harmonic (1 the root), and what it took of the peak. */
  interface Share {
    p: number;
    n: number;
    take: number;
  }
  /** For each peak, the parts picked with a harmonic there. */
  const sharesAt: Array<Share[] | undefined> = new Array(freqs.length);
  /** The top harmonic looked for: an overtone up to OVERTONES_UP_TO_HZ, at most MAX_HARMONICS. */
  const topOf = (hz: number) => Math.min(MAX_HARMONICS, Math.floor(OVERTONES_UP_TO_HZ / hz));
  /** The peak at part p's n-th harmonic, within min(its pitch / 2, 3%), or -1 (also past its top: the overtones either side of a candidate's). */
  const peakOf = (p: number, n: number): number => {
    const P = picked[p];
    if (n > P.peakAt.length) {
      const hz = n * P.hz;
      return nearestWithin(hz, Math.min(P.hz / 2, hz * HARMONIC_TOLERANCE));
    }
    let i = P.peakAt[n - 1];
    if (i === -2) {
      const hz = n * P.hz;
      i = nearestWithin(hz, Math.min(P.hz / 2, hz * HARMONIC_TOLERANCE));
      P.peakAt[n - 1] = i;
    }
    return i;
  };
  /** Whether a part other than p has a harmonic at peak i. */
  const shared = (i: number, p: number): boolean => {
    const list = sharesAt[i];
    if (list) for (const s of list) if (s.p !== p) return true;
    return false;
  };
  /** The peaks of the candidate being judged (marked with its turn). */
  const marks = new Int32Array(freqs.length);
  let turn = 0;
  /** Part p's power at its h-th harmonic: -1 where it has no peak, -2 where the peak is shared (with another part, or, `marked`, the candidate being judged). */
  const ownPower = (p: number, h: number, marked: boolean): number => {
    const i = peakOf(p, h);
    if (i < 0) return -1;
    return (marked && marks[i] === turn) || shared(i, p) ? -2 : powers[i];
  };
  /**
   * The power part p's own series puts at its n-th harmonic (n >= 2): the mean amplitude of its harmonics
   * n - 1 and n + 1, squared (the smooth series a note's overtones make). Where one of those is shared
   * (with another part, or, `marked`, with the candidate being judged), what it holds is not p's alone,
   * so the power is read instead on the line (log power against log harmonic number) through p's nearest
   * unshared harmonics either side, passing over the multiples of `skip` (the candidate's series, when
   * it sits on p's). NaN when it can't be read.
   */
  const ownAt = (p: number, n: number, marked: boolean, skip: number): number => {
    const a = ownPower(p, n - 1, marked);
    const b = ownPower(p, n + 1, marked);
    if (a !== -2 && b !== -2) {
      if (a < 0 && b < 0) return NaN;
      const side = a < 0 ? Math.sqrt(b) : b < 0 ? Math.sqrt(a) : (Math.sqrt(a) + Math.sqrt(b)) / 2;
      return side * side;
    }
    const top = Math.floor(OVERTONES_UP_TO_HZ / picked[p].hz);
    let lo = n - 1;
    let below = -1;
    for (; lo >= 1; lo--) if ((skip < 2 || lo % skip !== 0) && (below = ownPower(p, lo, marked)) > 0) break;
    let hi = n + 1;
    let above = -1;
    for (; hi <= top; hi++) if ((skip < 2 || hi % skip !== 0) && (above = ownPower(p, hi, marked)) > 0) break;
    if (lo < 1 || hi > top) return NaN;
    return below * (above / below) ** (Math.log(n / lo) / Math.log(hi / lo));
  };
  const levels = new Float64Array(MAX_HARMONICS + 1);
  /**
   * How far part p's series strays from smooth, dB: the RMS, over its harmonics off the multiples of m
   * and shared with no other part nor the candidate being judged, of each one's level from the line
   * (log power against log harmonic number) through its neighbours among them; NaN under SMOOTH_LEAST.
   */
  const roughness = (p: number, m: number): number => {
    const top = topOf(picked[p].hz);
    for (let h = 1; h <= top; h++) {
      const v = h % m === 0 ? -1 : ownPower(p, h, true);
      levels[h] = v > 0 ? 10 * Math.log10(v) : NaN;
    }
    let sum = 0;
    let count = 0;
    let lo = -1;
    for (let h = 1; h <= top; h++) {
      if (Number.isNaN(levels[h])) continue;
      if (lo >= 1) {
        let hi = h + 1;
        while (hi <= top && Number.isNaN(levels[hi])) hi++;
        if (hi <= top) {
          const line = levels[lo] + ((levels[hi] - levels[lo]) * Math.log(h / lo)) / Math.log(hi / lo);
          sum += (levels[h] - line) ** 2;
          count++;
        }
      }
      lo = h;
    }
    return count >= SMOOTH_LEAST ? Math.sqrt(sum / count) : NaN;
  };
  const lifts: number[] = [];
  const peaks: number[] = [];
  const there: Array<{ p: number; n: number }> = [];
  /**
   * Whether `upper`, whose root is the m-th harmonic (m >= 2) of each part p in `on` (the strongest
   * first), lifts their series, not just the one overtone it sits on. At each of its first
   * SERIES_HARMONICS harmonics k that can be judged: the power heard there (its peak, and theirs at m·k if
   * apart) over the power that the parts with a harmonic there put there by their own series (ownAt), in
   * dB. A harmonic is passed over where a part's root is (it took that peak whole) or a part's own power
   * can't be read; where there is no peak at all, the lift is -Infinity. It stands if the median lift
   * clears the margin for that many; or, where the lower parts' series are too smooth for a room to have
   * coloured them (roughness up to SMOOTH_DB), if its root's own lift clears SERIES_DB and SMOOTH_Z times
   * that roughness.
   */
  const liftsSeries = (upper: number[], on: ReadonlyArray<{ p: number; m: number }>): boolean => {
    turn++;
    for (const i of upper) if (i >= 0) marks[i] = turn;
    lifts.length = 0;
    let rootLift = -Infinity;
    for (let k = 1; k <= upper.length && lifts.length < SERIES_HARMONICS; k++) {
      peaks.length = 0;
      there.length = 0;
      if (upper[k - 1] >= 0) peaks.push(upper[k - 1]);
      for (const { p, m } of on) {
        there.push({ p, n: m * k });
        const i = peakOf(p, m * k);
        if (i >= 0 && !peaks.includes(i)) peaks.push(i);
      }
      let whole = false;
      for (const i of peaks)
        for (const s of sharesAt[i] ?? []) {
          if (s.n === 1) whole = true;
          else if (!there.some((t) => t.p === s.p)) there.push(s);
        }
      if (whole) continue;
      let expected = 0;
      for (const { p, n } of there) expected += ownAt(p, n, true, p === on[0].p ? on[0].m : 0);
      if (!(expected > 0)) continue;
      let seen = 0;
      for (const i of peaks) seen += powers[i];
      const lift = peaks.length ? 10 * Math.log10(seen / expected) : -Infinity;
      if (k === 1) rootLift = lift;
      lifts.push(lift);
    }
    if (lifts.length >= SERIES_LEAST) {
      const margin = Math.max(SERIES_DB, (SERIES_Z * Math.sqrt(Math.PI / 2) * SERIES_SPREAD_DB) / Math.sqrt(lifts.length));
      if (median(lifts) >= margin) return true;
    }
    if (!(rootLift >= SERIES_DB)) return false;
    let rough = 0;
    for (const { p, m } of on) {
      const r = roughness(p, m);
      if (!(r <= SMOOTH_DB)) return false;
      rough = Math.max(rough, r);
    }
    return rootLift >= SMOOTH_Z * rough;
  };

  const left = Float64Array.from(powers);
  const blocked = new Uint8Array(candidates.length);
  /** The peaks that rooted a candidate a part blocked, with that part's place in `parts`. */
  const overtonesOf: Array<{ part: number; peak: number }> = [];
  const parts: Part[] = [];
  let held = 0;
  let strongest = 0;
  const keep = 10 ** (-KEEP_DB / 10);
  /** What the parts whose overtone peak `i` is took of it. */
  const takenAsOvertone = (i: number): number => {
    let t = 0;
    for (const s of sharesAt[i] ?? []) if (s.n >= 2) t += s.take;
    return t;
  };
  /** Each candidate's power still unexplained (its root's counted with what parts it is an overtone of took), or -1 if it can't be the next part; worked out again whenever `left` changes. */
  const sums = new Float64Array(candidates.length);
  /** For each peak, the candidates it is an overtone (2nd or higher) of. */
  const overtoneOf: Array<number[] | undefined> = new Array(freqs.length);
  candidates.forEach(({ harmonics }, c) => {
    for (let h = 1; h < harmonics.length; h++) if (harmonics[h] >= 0) (overtoneOf[harmonics[h]] ??= []).push(c);
  });
  let stale = true;
  while (parts.length < MAX_PARTS) {
    if (stale) {
      for (let c = 0; c < candidates.length; c++) {
        sums[c] = -1;
        if (blocked[c]) continue;
        const { harmonics } = candidates[c];
        const root = harmonics[0];
        const back = takenAsOvertone(root);
        const rootLeft = left[root] + back;
        if (!(rootLeft > FRESH_SHARE * powers[root])) continue;
        let sum = back;
        for (const i of harmonics) if (i >= 0) sum += left[i];
        if (rootLeft >= ROOT_SHARE * sum && sum > 0) sums[c] = sum;
      }
      stale = false;
    }
    // The one with the most, while one could still be kept. But one rooted on a picked part's overtone
    // waits while one rooted off their series would be kept (and is not itself an overtone of a stronger
    // candidate), so the parts that share its peaks are known when it is judged.
    let best = -1;
    for (let c = 0; c < candidates.length; c++) if (!blocked[c] && sums[c] >= 0 && (best < 0 || sums[c] > sums[best])) best = c;
    if (best < 0 || (parts.length > 0 && sums[best] < strongest * keep)) break;
    if (parts.length > 0 && sharesAt[candidates[best].harmonics[0]]) {
      let free = -1;
      for (let f = 0; f < candidates.length; f++) {
        if (blocked[f] || !(sums[f] >= strongest * keep) || sharesAt[candidates[f].harmonics[0]] || (free >= 0 && !(sums[f] > sums[free]))) continue;
        let under = false;
        for (const d of overtoneOf[candidates[f].harmonics[0]] ?? []) if (d !== f && !blocked[d] && sums[d] > sums[f]) under = true;
        if (!under) free = f;
      }
      if (free >= 0) best = free;
    }
    const { harmonics } = candidates[best];
    const on: Array<{ p: number; m: number }> = [];
    for (const s of sharesAt[harmonics[0]] ?? []) if (s.n >= 2) on.push({ p: s.p, m: s.n });
    if (on.length > 0 && !liftsSeries(harmonics, on)) {
      // No part: what of its root no part picked later takes is the strongest part's under it
      blocked[best] = 1;
      overtonesOf.push({ part: on[0].p, peak: harmonics[0] });
      continue;
    }
    // What it explains: its fundamental whole, and of each overtone the power the overtones either side
    // of it hold (the mean of their amplitudes, squared), as far as the overtone has it
    const explained = new Float64Array(harmonics.length);
    let partEnergy = 0;
    for (let h = 0; h < harmonics.length; h++) {
      const i = harmonics[h];
      if (i < 0) continue;
      let take = left[i];
      if (h > 0) {
        let below = h - 1;
        while (harmonics[below] < 0) below--;
        let above = h + 1;
        while (above < harmonics.length && harmonics[above] < 0) above++;
        const a = Math.sqrt(left[harmonics[below]]);
        const expected = above < harmonics.length ? (a + Math.sqrt(left[harmonics[above]])) / 2 : a;
        take = Math.min(take, expected * expected);
      }
      explained[h] = take;
      partEnergy += take;
    }
    if (parts.length === 0) strongest = partEnergy;
    else if (partEnergy < strongest * keep) {
      // Too little of its own: passed over (one on a part's series is that part's overtone)
      blocked[best] = 1;
      if (on.length > 0) overtonesOf.push({ part: on[0].p, peak: harmonics[0] });
      continue;
    }
    // Its pitch, from its peaks as they were heard
    let pitchSum = 0;
    let weight = 0;
    harmonics.forEach((i, h) => {
      if (i < 0) return;
      pitchSum += (freqs[i] / (h + 1)) * powers[i];
      weight += powers[i];
    });
    const hz = pitchSum / weight;
    const p = picked.length;
    picked.push({ hz, peakAt: new Int32Array(topOf(hz)).fill(-2) });
    harmonics.forEach((i, h) => {
      if (i < 0) return;
      left[i] -= explained[h];
      const list = (sharesAt[i] ??= []);
      const mine = list.find((s) => s.p === p);
      if (mine) mine.take += explained[h];
      else list.push({ p, n: h + 1, take: explained[h] });
    });
    parts.push({ hz, energy: partEnergy });
    held += partEnergy;
    stale = true;
  }

  // Once the frame's parts are known, the shares of each peak that several parts share (or whose part
  // shares a neighbour of it with another) are read again, since a part picked before another knew
  // nothing of it: each part picked before the last one there has its share as its own series puts it
  // (ownAt; together scaled to the peak, and kept as it was where it can't be read), and the last one
  // has what they leave. A part alone there has its share as its series puts it, up to the peak.
  if (parts.length > 1) {
    for (let i = 0; i < freqs.length; i++) {
      const list = sharesAt[i];
      if (!list || list.some((s) => s.n === 1)) continue;
      if (list.length === 1 && ownPower(list[0].p, list[0].n - 1, false) !== -2 && ownPower(list[0].p, list[0].n + 1, false) !== -2) continue;
      let last = list[0];
      for (const s of list) if (s.p > last.p) last = s;
      const own = list.map((s) => (list.length > 1 && s === last ? NaN : ownAt(s.p, s.n, false, 0)));
      let before = 0;
      for (const e of own) if (Number.isFinite(e)) before += e;
      const scale = before > powers[i] ? powers[i] / before : 1;
      let others = 0;
      list.forEach((s, j) => {
        let now = s.take;
        if (list.length > 1 && s === last) return;
        if (Number.isFinite(own[j])) now = own[j] * scale;
        parts[s.p].energy += now - s.take;
        held += now - s.take;
        left[i] += s.take - now;
        s.take = now;
        others += now;
      });
      if (list.length > 1) {
        const now = Math.max(0, powers[i] - others);
        parts[last.p].energy += now - last.take;
        held += now - last.take;
        left[i] += last.take - now;
        last.take = now;
      }
    }
  }
  for (const { part, peak } of overtonesOf) {
    if (part >= parts.length || !(left[peak] > 0)) continue;
    parts[part].energy += left[peak];
    held += left[peak];
    left[peak] = 0;
  }
  return held >= FRAME_SHARE * energy ? parts : [];
}

/**
 * Where the pitched parts of `channels` sit; null when they hold no pitched content (fewer than one
 * frame in twenty has a part: drums, noise, silence).
 */
export function registerOf(channels: readonly Float32Array[], sampleRate: number): Register | null {
  if ((channels[0]?.length ?? 0) === 0) return null;
  const mix = analysisMix(channels);
  const rate = Math.min(sampleRate, MEASURE_RATE);
  const x = rate === sampleRate ? mix : resampleOnce(mix, sampleRate, rate, undefined, RESAMPLE_HALF);
  // (the split may work in a fresh array, not in the caller's own channel)
  const harmonic = harmonicPercussive([x], rate).parts([x], x !== channels[0]).harmonic[0];
  const length = harmonic.length;

  const size = frameSize(rate);
  const hop = size / 4;
  const half = size / 2;
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const power = new Float64Array(half + 1);
  const count = length <= size ? 1 : Math.floor((length - size) / hop) + 1;
  const frames: Part[][] = [];
  let loudest = 0;
  for (let f = 0; f < count; f++) {
    const start = f * hop;
    for (let i = 0; i < size; i++) {
      re[i] = start + i < length ? harmonic[start + i] * window[i] : 0;
      im[i] = 0;
    }
    fftInPlace(re, im);
    let energy = 0;
    for (let k = 0; k <= half; k++) {
      power[k] = re[k] * re[k] + im[k] * im[k];
      energy += power[k];
    }
    loudest = Math.max(loudest, energy);
    frames.push(energy > 0 && Number.isFinite(energy) ? partsOfFrame(power, rate, size, energy) : []);
  }

  // Only parts within FLOOR_DB of the loudest frame count
  const floor = loudest * 10 ** (-FLOOR_DB / 10);
  const heard = frames.map((parts) => parts.filter((part) => part.energy >= floor && Number.isFinite(part.hz)));
  const pitched = heard.filter((parts) => parts.length > 0);
  if (pitched.length < MIN_PITCHED_SHARE * count) return null;

  // The energy of each note heard, at the mean pitch it was heard at, low to high
  const notes = new Map<number, { hzSum: number; energy: number }>();
  let total = 0;
  for (const part of pitched.flat()) {
    const note = Math.round(12 * Math.log2(part.hz / 440));
    const sum = notes.get(note) ?? { hzSum: 0, energy: 0 };
    sum.hzSum += part.hz * part.energy;
    sum.energy += part.energy;
    notes.set(note, sum);
    total += part.energy;
  }
  if (!(total > 0)) return null;
  const all = [...notes.values()].map(({ hzSum, energy }) => ({ hz: hzSum / energy, energy })).sort((a, b) => a.hz - b.hz);
  const tops = pitched.flatMap((parts) => {
    let strongest = 0;
    for (const part of parts) strongest = Math.max(strongest, part.energy);
    let top = 0;
    for (const part of parts) if (part.energy >= strongest * 10 ** (-TOP_DB / 10)) top = Math.max(top, part.hz);
    return top > 0 ? [top] : [];
  });
  const octaves = new Array<number>(8).fill(0);
  for (const part of all) {
    const note = Math.round(12 * Math.log2(part.hz / C1_HZ));
    octaves[Math.min(7, Math.max(0, Math.floor(note / 12)))] += part.energy;
  }
  return {
    lowHz: roundHz(percentile(all, total, 0.1)),
    highHz: roundHz(percentile(all, total, 0.9)),
    centreHz: roundHz(percentile(all, total, 0.5)),
    topHz: tops.length ? roundHz(median(tops)) : null,
    octaves: sharesOf(octaves, total),
  };
}
