/**
 * The interpolation filter the true-peak meter (loudness.ts) and the master limiter
 * (effects/limiter.ts) find the peaks between samples with: 8x oversampling, a Kaiser-windowed
 * sinc of 32 taps a phase. BS.1770 asks for at least 4x; its own example filter (4 phases of 12
 * taps) has ripple of ±0.2-0.3 dB in the treble and its four points miss up to 0.3 dB of a peak
 * between them, so a limiter aiming by it left bright, loud, limited mixes 0.3 dB over the ceiling
 * (as ffmpeg's ebur128 reads them, whose resampler passes 97% of the band as this does). This
 * one reads sines within 0.07 dB of their true peak up to 20 kHz at 44.1 and 48 kHz, never over.
 *
 * Phase p (1 to 7) is the point p/8 of the way back from the sample TRUE_PEAK_TAPS / 2 - 1 back
 * to the one TRUE_PEAK_TAPS / 2 back; tap k multiplies the sample k back. The sample itself is
 * phase 0, read as it is. Plain maths, so the worklets embed the numbers as text.
 *
 * Running all seven phases on every sample cost five times the 4x filter; createPeakFinder runs
 * them only where a bound (exact maths, from the signal's second differences) says a point could
 * pass what the caller cares about (the limiter's ceiling, the meter's peak so far), half the
 * multiplications when it does (the phases folded in mirrored pairs).
 */

export const TRUE_PEAK_OVERSAMPLING = 8;
export const TRUE_PEAK_TAPS = 32;
const KAISER_BETA = 7;
/** The sinc's cutoff, a share of the Nyquist frequency (just under it: the window's transition sits above). */
const CUTOFF = 0.97;

function bessel0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 60; k++) {
    term *= (x / 2 / k) ** 2;
    sum += term;
  }
  return sum;
}

/** The filter's phases 1 to oversampling - 1, each `taps` taps, each summing to 1 (no gain at DC). */
export function designTruePeakPhases(oversampling = TRUE_PEAK_OVERSAMPLING, taps = TRUE_PEAK_TAPS, beta = KAISER_BETA, cutoff = CUTOFF): number[][] {
  const half = taps / 2;
  const phases: number[][] = [];
  for (let p = 1; p < oversampling; p++) {
    const frac = p / oversampling;
    const c: number[] = [];
    for (let k = 0; k < taps; k++) {
      const x = half - 1 - k + frac;
      const sinc = x === 0 ? cutoff : Math.sin(Math.PI * cutoff * x) / (Math.PI * x);
      const w = Math.abs(x) >= half ? 0 : bessel0(beta * Math.sqrt(1 - (x / half) ** 2)) / bessel0(beta);
      c.push(sinc * w);
    }
    const sum = c.reduce((a, b) => a + b, 0);
    phases.push(c.map((v) => v / sum));
  }
  return phases;
}

export const TRUE_PEAK_PHASES: readonly (readonly number[])[] = designTruePeakPhases();

/**
 * What a peak finder (createPeakFinder) needs, plain numbers so the worklets embed it as text:
 * the phases folded in half, and the two bounds it skips work with.
 */
export interface TruePeakPlan {
  taps: number;
  /**
   * The phases folded, `taps / 2` numbers each, in this order: phase 4 (symmetric: tap k and tap
   * taps - 1 - k share a number), then for each mirrored pair (2 and 6, 1 and 7, 3 and 5) the
   * numbers for their sum and for their difference (phase 8 - p is phase p backwards).
   */
  fold: number[];
  /** No point between the two samples is further from the louder of them than far * E + farStep * |step| (see createPeakFinder). */
  far: number;
  farStep: number;
  /** No odd phase is further from the mean of its two even neighbours than near * E + nearStep * |step|. */
  near: number;
  nearStep: number;
}

/**
 * The most |e . x| can be over a window x, as a multiple of the window's second differences'
 * energy and of the step between the two middle samples: e (taps long, summing to 0) is written
 * as the second difference of some q plus m * (the step between the middle samples), so
 * e . x = q . (x's second differences) + m * step, and Cauchy-Schwarz bounds the first part by
 * |q| * sqrt(sum of the squared second differences).
 */
function secondDifferenceBound(e: number[]): { q: number; m: number } {
  const taps = e.length;
  const half = taps / 2;
  const r = e.slice();
  let m = 0;
  for (let k = 0; k < taps; k++) m += k * r[k];
  // Take out the first moment with the step (sample half back minus sample half - 1 back)
  r[half] -= m;
  r[half - 1] += m;
  // r is now the second difference of q: r[k] = q[k] - 2 q[k-1] + q[k-2]
  const q: number[] = [];
  for (let k = 0; k < taps - 2; k++) q.push(r[k] + 2 * (q[k - 1] ?? 0) - (q[k - 2] ?? 0));
  let sq = 0;
  for (const v of q) sq += v * v;
  return { q: Math.sqrt(sq), m: Math.abs(m) };
}

/** The plan for `phases` (an 8x filter's seven phases, as designTruePeakPhases makes). */
export function designTruePeakPlan(phases: readonly (readonly number[])[] = TRUE_PEAK_PHASES): TruePeakPlan {
  if (phases.length !== 7) throw new Error('the peak finder is written for 8x oversampling');
  const taps = phases[0].length;
  const half = taps / 2;
  // Points 0 to 8 between the two middle samples: 0 is the sample half - 1 back, 8 the one half back
  const point = (p: number): number[] => {
    if (p > 0 && p < 8) return phases[p - 1].slice();
    const v = new Array<number>(taps).fill(0);
    v[p === 0 ? half - 1 : half] = 1;
    return v;
  };
  const fold: number[] = [];
  const h4 = point(4);
  for (let k = 0; k < half; k++) fold.push(h4[k]);
  for (const p of [2, 1, 3]) {
    const h = point(p);
    for (let k = 0; k < half; k++) fold.push(h[k] + h[taps - 1 - k]);
    for (let k = 0; k < half; k++) fold.push(h[k] - h[taps - 1 - k]);
  }
  // A little over what the maths gives, for rounding
  const pad = 1 + 1e-9;
  let far = 0;
  let farStep = 0;
  for (let p = 1; p < 8; p++) {
    // From the straight line between the two samples, which never passes the louder of them
    const h = point(p);
    h[half - 1] -= 1 - p / 8;
    h[half] -= p / 8;
    const b = secondDifferenceBound(h);
    far = Math.max(far, b.q * pad);
    farStep = Math.max(farStep, b.m * pad);
  }
  let near = 0;
  let nearStep = 0;
  for (const p of [1, 3, 5, 7]) {
    const h = point(p);
    const before = point(p - 1);
    const after = point(p + 1);
    const b = secondDifferenceBound(h.map((v, k) => v - (before[k] + after[k]) / 2));
    near = Math.max(near, b.q * pad);
    nearStep = Math.max(nearStep, b.m * pad);
  }
  return { taps, fold, far, farStep, near, nearStep };
}

export const TRUE_PEAK_PLAN: TruePeakPlan = designTruePeakPlan();

export interface PeakFinder {
  /** The next sample. */
  push: (x: number) => void;
  /**
   * The highest |value| among the two samples taps / 2 - 1 and taps / 2 back and the seven points
   * between them, exactly, if that is over `over`; otherwise some value no higher than `over`
   * (and no lower than those two samples). Most calls skip most of the work: see below.
   */
  peak: (over: number) => number;
  reset: () => void;
}

/**
 * The 8x interpolation filter run over a stream, working out only what could matter. Between two
 * samples the filter's points can't stray further from the straight line joining them than the
 * signal's bend allows: plan.far times E (the energy of the second differences under the filter,
 * a running sum, so free) plus a little of the step between them. Where that leaves no point
 * able to pass `over`, nothing is worked out (most samples of a song, under its peak or under a
 * limiter's ceiling); else the even points (2, 4, 6), then the odd ones only if the same bound,
 * seven times tighter between the even points, says one of them could pass. The bounds are exact
 * maths (truePeakFilter's designTruePeakPlan), not estimates, so the answer is what working out
 * every point gives. The phases are applied folded (each mirrored pair shares its products), half
 * the multiplications.
 *
 * Self-contained (nothing from module scope, the plan comes in) so the worklets embed it as text.
 */
export function createPeakFinder(plan: TruePeakPlan): PeakFinder {
  const taps = plan.taps;
  const half = taps / 2;
  const f = Float64Array.from(plan.fold);
  const far2 = plan.far * plan.far;
  const farStep = plan.farStep;
  const near = plan.near;
  const nearStep = plan.nearStep;
  // The last `taps` samples, written twice over so the newest `taps` lie in one run
  const hist = new Float64Array(2 * taps);
  let at = 0;
  // The squared second differences under the filter (taps - 2 of them) and their sum (sums[0]);
  // the sum is added up afresh now and then so it can't drift, and sums[1] (the most it held
  // since) pads it for the rounding in between. (In a typed array, not `let`s: a number kept in
  // a closure's variable is boxed afresh at every write, which took most of the time.)
  const span = taps - 2;
  const bends = new Float64Array(span);
  const sums = new Float64Array(2);
  let bendAt = 0;
  let since = 0;
  const u = new Float64Array(half);
  const v = new Float64Array(half);

  const push = (x: number) => {
    at = at + 1 === taps ? 0 : at + 1;
    hist[at] = x;
    hist[at + taps] = x;
    const n = at + taps;
    const d = x - 2 * hist[n - 1] + hist[n - 2];
    const d2 = d * d;
    const energy = sums[0] + d2 - bends[bendAt];
    sums[0] = energy;
    bends[bendAt] = d2;
    bendAt = bendAt + 1 === span ? 0 : bendAt + 1;
    if (energy > sums[1]) sums[1] = energy;
    if (++since === 256) {
      since = 0;
      let s = 0;
      for (let k = 0; k < span; k++) s += bends[k];
      sums[0] = s;
      sums[1] = s;
    }
  };

  // (The quick test in one small function the caller's loop takes in, the work in another)
  const peak = (over: number) => {
    const n = at + taps;
    const a = hist[n - half + 1];
    const b = hist[n - half];
    const aa = a < 0 ? -a : a;
    const ab = b < 0 ? -b : b;
    const most = aa > ab ? aa : ab;
    const step = b > a ? b - a : a - b;
    const energy = sums[0];
    const e2 = (energy > 0 ? energy : 0) + sums[1] * 1e-12;
    // most + far * sqrt(e2) + farStep * step <= over, without the square root
    const room = over - most * (1 + 1e-12) - farStep * step;
    if (room >= 0 && far2 * e2 <= room * room) return most;
    return work(over, n, a, b, most, step, Math.sqrt(e2));
  };

  const work = (over: number, n: number, a: number, b: number, most: number, step: number, e: number) => {
    // The even points: 4 (halfway), and 2 and 6 from their shared sum and difference
    for (let k = 0; k < half; k++) {
      const p = hist[n - k];
      const q = hist[n - taps + 1 + k];
      u[k] = p + q;
      v[k] = p - q;
    }
    let y4 = 0;
    let s = 0;
    let d = 0;
    for (let k = 0; k < half; k++) {
      y4 += f[k] * u[k];
      s += f[half + k] * u[k];
      d += f[2 * half + k] * v[k];
    }
    const y2 = (s + d) / 2;
    const y6 = (s - d) / 2;
    const m2 = y2 < 0 ? -y2 : y2;
    const m4 = y4 < 0 ? -y4 : y4;
    const m6 = y6 < 0 ? -y6 : y6;
    if (m2 > most) most = m2;
    if (m4 > most) most = m4;
    if (m6 > most) most = m6;
    // An odd point is near the mean of its two even neighbours
    let mean = a + y2;
    let around = mean < 0 ? -mean : mean;
    mean = y2 + y4;
    if ((mean < 0 ? -mean : mean) > around) around = mean < 0 ? -mean : mean;
    mean = y4 + y6;
    if ((mean < 0 ? -mean : mean) > around) around = mean < 0 ? -mean : mean;
    mean = y6 + b;
    if ((mean < 0 ? -mean : mean) > around) around = mean < 0 ? -mean : mean;
    if ((around / 2) * (1 + 1e-12) + near * e + nearStep * step <= over) return most;
    // The odd points: 1 and 7, 3 and 5
    let s17 = 0;
    let d17 = 0;
    let s35 = 0;
    let d35 = 0;
    for (let k = 0; k < half; k++) {
      s17 += f[3 * half + k] * u[k];
      d17 += f[4 * half + k] * v[k];
      s35 += f[5 * half + k] * u[k];
      d35 += f[6 * half + k] * v[k];
    }
    // max(|y1|, |y7|) = max(|s + d|, |s - d|) / 2 = (|s| + |d|) / 2 for the pair's sum s and difference d
    const as17 = s17 < 0 ? -s17 : s17;
    const ad17 = d17 < 0 ? -d17 : d17;
    const as35 = s35 < 0 ? -s35 : s35;
    const ad35 = d35 < 0 ? -d35 : d35;
    const p17 = (as17 + ad17) / 2;
    const p35 = (as35 + ad35) / 2;
    if (p17 > most) most = p17;
    if (p35 > most) most = p35;
    return most;
  };

  const reset = () => {
    hist.fill(0);
    bends.fill(0);
    sums.fill(0);
    at = 0;
    bendAt = 0;
    since = 0;
  };

  return { push, peak, reset };
}
