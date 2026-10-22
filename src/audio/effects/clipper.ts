/**
 * The master clipper: the mix driven into a soft or hard clipper just before the limiter, the way
 * loud rap and electronic masters shave their tallest drum peaks off so the limiter has less to do
 * (it squashes the whole mix where a clipper only touches the peaks). It is oversampled four times,
 * so the corners clipping puts on a wave don't fold back down as harsh, out-of-tune aliasing.
 *
 * How: the driven sound is upsampled (a 97-tap windowed-sinc low-pass, in four phases), each
 * oversampled point is bent by the clip curve, and only the difference the curve made (the
 * "residual") is filtered back down and added to the driven sound, delayed to line up. Where
 * nothing reaches the knee the residual is zero, so the sound passes untouched, sample for sample,
 * and the filters aren't even run (most of a song): its cost is only where it clips. Even there,
 * an exact bound (from the signal's bend) skips the samples none of whose points can reach the
 * knee, and the filter back down runs only over the stretch of residual that isn't zeros, several
 * samples side by side: the same sums in the same order, so the sound is what working out every
 * point and tap gives, bit for bit, at well under half the cost.
 *
 * The kernel is plain JavaScript (no imports, no closures over module state) so the worklet
 * module can embed it with Function.prototype.toString, the export can run the very same code over
 * a render (masterAfter.ts), and the unit test can run it directly: live and export are the same
 * maths. It delays the sound by its kernel's `latency` samples; the export takes that delay back
 * off. With the Loud master's Crunch it's the band kind (createClipperKernel's `band`): the whole
 * sound through the oversampling, so its peaks between samples stay near the ceiling too.
 */

/** Settings of the master clipper (MasterSettings.clipper). */
export interface ClipperSettings {
  on: boolean;
  /** dB of gain into the clipper, 0 to CLIPPER_DRIVE_MAX: more drive, more of the peaks shaved */
  drive: number;
  /** 0 (hard: a flat top at the ceiling) to 1 (soft: bends from 6 dB under the ceiling) */
  softness: number;
  /** Where it clips, dBFS, CLIPPER_CEILING_MIN to 0 */
  ceiling: number;
  /**
   * The band kind (see createClipperKernel): the whole sound through the oversampled path, then
   * clipped flat again where that still pokes over, so its peaks between samples stay near the
   * ceiling however hard it's driven and the limiter after it has next to nothing left to do. What
   * the Loud master's Crunch uses; never stored (the Clipper insert is always the plain kind).
   */
  band?: boolean;
}

export const CLIPPER_DRIVE_MAX = 18;
export const CLIPPER_CEILING_MIN = -12;
/** How far under the ceiling a fully soft clipper starts to bend, dB. */
export const CLIPPER_KNEE_DB = 6;

/** A clipper as it's first switched on: a few dB of drive into a mostly hard clip just under full scale. */
export function defaultClipper(): ClipperSettings {
  return { on: false, drive: 3, softness: 0.3, ceiling: -1 };
}

/** Fill in any missing / out-of-range clipper settings (hand-edited files). */
export function normalizeClipper(raw: unknown): ClipperSettings {
  const d = defaultClipper();
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);
  return {
    on: r.on === true,
    drive: num(r.drive, d.drive, 0, CLIPPER_DRIVE_MAX),
    softness: num(r.softness, d.softness, 0, 1),
    ceiling: num(r.ceiling, d.ceiling, CLIPPER_CEILING_MIN, 0),
  };
}

/** The kernel's linear parameters from settings, rounded as k-rate AudioParams hold them (single precision). */
export function clipperParams(s: ClipperSettings): { drive: number; ceiling: number; softness: number } {
  return { drive: Math.fround(10 ** (s.drive / 20)), ceiling: Math.fround(10 ** (s.ceiling / 20)), softness: Math.fround(s.softness) };
}

/** What the clipper did over a stretch of sound. */
export interface ClipperReading {
  /** The most it took off any peak, dB (0: it never clipped). */
  peakDb: number;
  /** The share of samples it touched, 0 to 1. */
  share: number;
}

export interface ClipperKernel {
  /** Clip `frames` samples of each channel (in and out may be the same arrays). Params are linear. */
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, drive: number, ceiling: number, softness: number) => void;
  /** Samples of delay. */
  latency: number;
  /** What it did since the last read, and start counting again. */
  read: () => ClipperReading;
}

/**
 * The clipper's kernel; `band`: the band kind (ClipperSettings.band). Why the plain kind isn't
 * enough for Crunch: it adds only what the curve took off (filtered back down) to the driven sound,
 * so whatever the driven sound has above the filter's pass band (from about 16 kHz: hats, crunch
 * fizz) goes past the clip untouched, and a high sound clipped flat comes back down as its
 * fundamental, up to 4/pi (2 dB) over the ceiling. On a busy, crunchy drop pushed 10 to 13 dB
 * into it, its output went 6 to 9 dB over the ceiling between samples, the true-peak limiter
 * after it pulled the whole mix down 2 dB most of the time and 5 to 8 dB after every kick and snare,
 * and the bass pumped with the drums. The band kind runs the whole driven sound up and back down
 * (a longer filter, flat to 18 kHz at 44.1 kHz: the sound itself goes through it now), so nothing
 * passes unclipped, then two plain hard clips at the same ceiling take off what ringing is left
 * (each pass rings less): on that drop its true peak came out 1 to 2 dB over where it clips
 * instead of 6 to 9, so clipping a little under the limiter's ceiling (loudMaster.ts) leaves the
 * limiter idle. It costs the dry path's filter on every sample (81 taps) on top of the plain
 * kind's work, about three times the plain kind on a loud drop. `whole` (internal): the band
 * kind's first stage.
 */
export function createClipperKernel(_sampleRate: number, band = false, whole = false): ClipperKernel {
  if (band) {
    // The band clipper: this kernel's band kind, then two plain hard clips of what it left over
    // its ceiling (see ClipperSettings.band). (The kernel is the same at any sample rate)
    const first = createClipperKernel(0, false, true);
    const second = createClipperKernel(0);
    const third = createClipperKernel(0);
    return {
      process: (inL, inR, outL, outR, frames, drive, ceiling, softness) => {
        first.process(inL, inR, outL, outR, frames, drive, ceiling, softness);
        second.process(outL, outR, outL, outR, frames, 1, ceiling, 0);
        third.process(outL, outR, outL, outR, frames, 1, ceiling, 0);
      },
      latency: first.latency + second.latency + third.latency,
      read: () => {
        second.read();
        third.read();
        return first.read();
      },
    };
  }
  // (`whole`: the band kind's first stage, the driven sound through the up and down filters
  // instead of as it came, and a longer filter)
  const FACTOR = 4;
  const LENGTH = whole ? 161 : 97;
  // The low-pass at the oversampled rate: a Kaiser-windowed sinc (beta 8, about 80 dB down),
  // centred a little under the original Nyquist, so what clipping makes above it is gone before
  // the sound is taken back down (and folds, if at all, above about 19 kHz). The band kind's is
  // longer and a little higher (flat to 18 kHz: the whole sound goes through it twice)
  const cutoff = (whole ? 0.47 : 0.46) / FACTOR;
  const bessel0 = (x: number) => {
    let sum = 1;
    let term = 1;
    for (let k = 1; k < 40; k++) {
      term *= (x / (2 * k)) * (x / (2 * k));
      sum += term;
    }
    return sum;
  };
  const beta = 8;
  const h = new Float64Array(LENGTH);
  const mid = (LENGTH - 1) / 2;
  let dc = 0;
  for (let j = 0; j < LENGTH; j++) {
    const t = j - mid;
    const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    const w = bessel0(beta * Math.sqrt(1 - (t / mid) * (t / mid))) / bessel0(beta);
    h[j] = sinc * w;
    dc += h[j];
  }
  for (let j = 0; j < LENGTH; j++) h[j] /= dc;
  // Upsampling by zero-stuffing then filtering is four filters (phases) over the input: phase p
  // takes taps p, p + 4, p + 8... times 4 (the zeros' lost energy)
  const phaseTaps = Math.ceil(LENGTH / FACTOR);
  const phases = new Float64Array(FACTOR * phaseTaps);
  let reach = 0;
  for (let p = 0; p < FACTOR; p++) {
    let sum = 0;
    for (let k = 0; k < phaseTaps; k++) {
      const j = p + FACTOR * k;
      const v = j < LENGTH ? FACTOR * h[j] : 0;
      phases[p * phaseTaps + k] = v;
      sum += Math.abs(v);
    }
    if (sum > reach) reach = sum;
  }
  // Through both filters the sound is (LENGTH - 1) oversampled points late: a whole number of samples
  const latency = (LENGTH - 1) / FACTOR;
  // Each sample's four oversampled points are worked out before it's taken back down, so the
  // newest is the last phase's, (FACTOR - 1) points after the first; the residual is read that
  // much further back, so it lines up with the driven sound exactly (read at the newest point, it
  // was three quarters of a sample early: at 5 kHz it no longer cancelled the peaks it clipped,
  // which came out far over the ceiling)
  const ALIGN = FACTOR - 1;
  // The band kind's dry path: the driven sound up and back down without the clip, one filter at
  // the original rate (taps FACTOR (h * h)[FACTOR m], the up filter's gain and every FACTOR-th
  // point of the two filters one after the other), as long as the delay twice over
  const dryTaps = whole ? 2 * latency + 1 : 0;
  const dryFilter = new Float64Array(dryTaps);
  for (let m = 0; m < dryTaps; m++) {
    let c = 0;
    const at = FACTOR * m;
    for (let j = Math.max(0, at - LENGTH + 1); j <= Math.min(LENGTH - 1, at); j++) c += h[j] * h[at - j];
    dryFilter[m] = FACTOR * c;
  }
  // (Its input, a ring written twice over)
  const dryL = new Float64Array(2 * Math.max(1, dryTaps));
  const dryR = new Float64Array(2 * Math.max(1, dryTaps));
  const RES = LENGTH + ALIGN;

  // Which samples' points can reach the knee, without working them out. Phase p is the point
  // p / FACTOR of the way from the sample C back to the one C - 1 back (C: the up filter's delay,
  // in samples). It differs from the straight line between those two by e . x, e its taps less
  // the line's two; and e . x = q . (the window's second differences) + m * (the step between
  // the two samples) + s * (the sample C back), s what e adds up to. So no point is further from
  // the line (which never passes the louder of the two) than |q| * sqrt(E) (Cauchy-Schwarz, E the
  // second differences' energy: a running sum) + |m| * |step| + |s| * |that sample|, with the
  // largest q, m and s of the four phases. Where that leaves every point under the knee, the
  // curve would leave them all as they are: skipping them changes nothing, sample for sample.
  // Most of a loud song's samples are well under the knee between its peaks.
  const C = mid / FACTOR;
  const span = phaseTaps - 2;
  let worstQ = 0;
  let worstM = 0;
  let worstS = 0;
  for (let p = 0; p < FACTOR; p++) {
    const r = new Float64Array(phaseTaps);
    for (let k = 0; k < phaseTaps; k++) r[k] = phases[p * phaseTaps + k];
    r[C] -= 1 - p / FACTOR;
    r[C - 1] -= p / FACTOR;
    let s = 0;
    for (let k = 0; k < phaseTaps; k++) s += r[k];
    r[C] -= s;
    let m = 0;
    for (let k = 0; k < phaseTaps; k++) m += k * r[k];
    r[C] -= m;
    r[C - 1] += m;
    // r is now the second difference of q: r[k] = q[k] - 2 q[k-1] + q[k-2]
    const q = new Float64Array(span);
    let qq = 0;
    for (let k = 0; k < span; k++) {
      q[k] = r[k] + 2 * (k > 0 ? q[k - 1] : 0) - (k > 1 ? q[k - 2] : 0);
      qq += q[k] * q[k];
    }
    worstQ = Math.max(worstQ, Math.sqrt(qq));
    worstM = Math.max(worstM, Math.abs(m));
    worstS = Math.max(worstS, Math.abs(s));
  }
  // (A little over what the maths gives, for rounding)
  const boundQ2 = worstQ * worstQ * (1 + 1e-9);
  const boundM = worstM * (1 + 1e-9);
  const boundS = worstS * (1 + 1e-9);

  // Per channel: the last phaseTaps driven input samples (a ring written twice over, so the
  // newest always lie in one run), the driven input delayed by `latency`, and the squared second
  // differences under the up filter
  const histL = new Float64Array(2 * phaseTaps);
  const histR = new Float64Array(2 * phaseTaps);
  const delayL = new Float64Array(latency + 1);
  const delayR = new Float64Array(latency + 1);
  const bendL = new Float64Array(span);
  const bendR = new Float64Array(span);
  // The four phases' taps, and a sample's eight points (four a channel) once worked out
  const tap0 = phases.subarray(0, phaseTaps);
  const tap1 = phases.subarray(phaseTaps, 2 * phaseTaps);
  const tap2 = phases.subarray(2 * phaseTaps, 3 * phaseTaps);
  const tap3 = phases.subarray(3 * phaseTaps, 4 * phaseTaps);
  const points = new Float64Array(2 * FACTOR);
  // A block is worked in two runs: first every sample's points through the curve, the residual
  // kept for the whole block (the two channels side by side, left at even places, after the last
  // HELD points of the block before), with the driven sound `latency` samples back; then the
  // residual filtered back down, two samples at a time (the two sums run side by side, each
  // added up in the same order as on its own, so the processor isn't left waiting on one)
  const HELD = RES;
  let block = 128;
  let res = new Float64Array(2 * (HELD + FACTOR * (block + 3)));
  let dry = new Float64Array(2 * block);
  // (Per sample: the newest point with a residual, as of its own first point)
  let hits = new Int32Array(block);
  // The running numbers, kept here between blocks and in local variables while one runs (a
  // number kept in a closure's variable is boxed afresh at every write)
  const state = new Float64Array(16);
  const HIST_AT = 0;
  const DELAY_AT = 1;
  const N = 2;
  const LAST_LOUD = 3;
  const PEAK_REDUCTION = 4;
  const TOUCHED = 5;
  const COUNTED = 6;
  const BEND_AT = 7;
  const SINCE = 8;
  const E_L = 9;
  const E_R = 10;
  const MOST_L = 11;
  const MOST_R = 12;
  // The newest point with a residual the filter back down has reached, and the oldest it still
  // reaches (os points, counted from the first held one: NONE, none)
  const NEWEST = 13;
  const OLDEST = 14;
  const DRY_AT = 15;
  const NONE = -1e6;
  // When a sample last came near the knee (samples)
  state[LAST_LOUD] = -1e9;
  state[NEWEST] = NONE;
  state[OLDEST] = NONE;
  state[PEAK_REDUCTION] = 1;

  /** The clip curve at |v| (v >= 0): straight to the knee, then a tanh bend that never passes the ceiling. */
  const bend = (v: number, knee: number, ceiling: number) => {
    if (v <= knee) return v;
    const room = ceiling - knee;
    if (room <= 0) return ceiling;
    return knee + room * Math.tanh((v - knee) / room);
  };

  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, drive: number, ceiling: number, softness: number) => {
    if (frames > block) {
      // (A longer block than so far: room for it, the held points kept)
      const more = new Float64Array(2 * (HELD + FACTOR * (frames + 3)));
      more.set(res.subarray(0, 2 * HELD));
      res = more;
      dry = new Float64Array(2 * frames);
      hits = new Int32Array(frames);
      block = frames;
    }
    const knee = ceiling * Math.pow(10, (-6 * Math.max(0, Math.min(1, softness))) / 20);
    // Below this, no oversampled point can reach the knee
    const quiet = knee / reach;
    // What the bound must stay under to be sure (the sums' rounding is far smaller)
    const safe = knee * (1 - 1e-9);
    // (Everything the loops use under local names: through the closure each use costs more)
    const hL = histL;
    const hR = histR;
    const rs = res;
    const dr2 = dry;
    const hit = hits;
    const dLine = delayL;
    const dRine = delayR;
    const bL2 = bendL;
    const bR2 = bendR;
    const t0 = tap0;
    const t1 = tap1;
    const t2 = tap2;
    const t3 = tap3;
    const pt = points;
    const down = h;
    const T = phaseTaps;
    const W = span;
    const held = HELD;
    const len = LENGTH;
    const reachBack = LENGTH - 1;
    const c = C;
    const lat1 = latency + 1;
    const q2 = boundQ2;
    const qm = boundM;
    const qs = boundS;
    // (Places in the rings as whole numbers, so they index as such)
    let histAt = state[HIST_AT] | 0;
    let delayAt = state[DELAY_AT] | 0;
    let dryAt = state[DRY_AT] | 0;
    const GT = dryTaps;
    const gf = dryFilter;
    const dxL = dryL;
    const dxR = dryR;
    const n0 = state[N];
    let lastLoud = state[LAST_LOUD];
    let peakReduction = state[PEAK_REDUCTION];
    let touched = state[TOUCHED];
    let counted = state[COUNTED];
    let bendAt = state[BEND_AT] | 0;
    let since = state[SINCE] | 0;
    let eL = state[E_L];
    let eR = state[E_R];
    let mostL = state[MOST_L];
    let mostR = state[MOST_R];
    let newestHit = state[NEWEST] | 0;
    let oldestHit = state[OLDEST] | 0;
    for (let i = 0; i < frames; i++) {
      // (NaN or infinity counts as silence)
      const l = inL[i] - inL[i] === 0 ? inL[i] * drive : 0;
      const r = inR[i] - inR[i] === 0 ? inR[i] * drive : 0;
      histAt = histAt + 1 === T ? 0 : histAt + 1;
      hL[histAt] = hL[histAt + T] = l;
      hR[histAt] = hR[histAt + T] = r;
      const newest = histAt + T;
      // The second differences' energy, kept running (added up afresh now and then so it can't
      // drift; the most it held since pads it for the rounding in between)
      const dl2 = l - 2 * hL[newest - 1] + hL[newest - 2];
      const dr2b = r - 2 * hR[newest - 1] + hR[newest - 2];
      eL = eL + dl2 * dl2 - bL2[bendAt];
      eR = eR + dr2b * dr2b - bR2[bendAt];
      bL2[bendAt] = dl2 * dl2;
      bR2[bendAt] = dr2b * dr2b;
      bendAt = bendAt + 1 === W ? 0 : bendAt + 1;
      if (eL > mostL) mostL = eL;
      if (eR > mostR) mostR = eR;
      if (++since === 256) {
        since = 0;
        let sl = 0;
        let sr = 0;
        for (let k = 0; k < W; k++) {
          sl += bL2[k];
          sr += bR2[k];
        }
        eL = mostL = sl;
        eR = mostR = sr;
      }
      if (l > quiet || l < -quiet || r > quiet || r < -quiet) lastLoud = n0 + i;
      // Whether a channel's points could reach the knee this sample (see the bound above)
      let mayL = false;
      let mayR = false;
      if (n0 + i - lastLoud < T) {
        const aL = hL[newest - c];
        const bL = hL[newest - c + 1];
        const aR = hR[newest - c];
        const bR = hR[newest - c + 1];
        const absAL = aL < 0 ? -aL : aL;
        const absBL = bL < 0 ? -bL : bL;
        const absAR = aR < 0 ? -aR : aR;
        const absBR = bR < 0 ? -bR : bR;
        const roomL = safe - (absAL > absBL ? absAL : absBL) - qm * (bL > aL ? bL - aL : aL - bL) - qs * absAL;
        const roomR = safe - (absAR > absBR ? absAR : absBR) - qm * (bR > aR ? bR - aR : aR - bR) - qs * absAR;
        mayL = !(roomL >= 0 && q2 * ((eL > 0 ? eL : 0) + mostL * 1e-12) <= roomL * roomL);
        mayR = !(roomR >= 0 && q2 * ((eR > 0 ? eR : 0) + mostR * 1e-12) <= roomR * roomR);
      }
      // The four oversampled points of a channel that may need them, in one run over the taps
      // (each point's sum in the same order as on its own)
      if (mayL && mayR) {
        let l0 = 0;
        let l1 = 0;
        let l2 = 0;
        let l3 = 0;
        let r0 = 0;
        let r1 = 0;
        let r2 = 0;
        let r3 = 0;
        for (let k = 0; k < T; k++) {
          const x = hL[newest - k];
          const y = hR[newest - k];
          const c0 = t0[k];
          const c1 = t1[k];
          const c2 = t2[k];
          const c3 = t3[k];
          l0 += c0 * x;
          r0 += c0 * y;
          l1 += c1 * x;
          r1 += c1 * y;
          l2 += c2 * x;
          r2 += c2 * y;
          l3 += c3 * x;
          r3 += c3 * y;
        }
        pt[0] = l0;
        pt[1] = r0;
        pt[2] = l1;
        pt[3] = r1;
        pt[4] = l2;
        pt[5] = r2;
        pt[6] = l3;
        pt[7] = r3;
      } else if (mayL || mayR) {
        const hx = mayL ? hL : hR;
        let u0 = 0;
        let u1 = 0;
        let u2 = 0;
        let u3 = 0;
        for (let k = 0; k < T; k++) {
          const x = hx[newest - k];
          u0 += t0[k] * x;
          u1 += t1[k] * x;
          u2 += t2[k] * x;
          u3 += t3[k] * x;
        }
        const o = mayL ? 0 : 1;
        pt[o] = u0;
        pt[o + 2] = u1;
        pt[o + 4] = u2;
        pt[o + 6] = u3;
      }
      // Each point through the curve: the residual is what it took off
      let clippedHere = false;
      const at = 2 * (held + 4 * i);
      for (let p = 0; p < 4; p++) {
        let rl = 0;
        let rr = 0;
        if (mayL) {
          const u = pt[2 * p];
          const a = u < 0 ? -u : u;
          if (a > knee) {
            const b = bend(a, knee, ceiling);
            rl = (u < 0 ? -b : b) - u;
            if (b / a < peakReduction) peakReduction = b / a;
            clippedHere = true;
          }
        }
        if (mayR) {
          const u = pt[2 * p + 1];
          const a = u < 0 ? -u : u;
          if (a > knee) {
            const b = bend(a, knee, ceiling);
            rr = (u < 0 ? -b : b) - u;
            if (b / a < peakReduction) peakReduction = b / a;
            clippedHere = true;
          }
        }
        rs[at + 2 * p] = rl;
        rs[at + 2 * p + 1] = rr;
        if (rl !== 0 || rr !== 0) newestHit = held + 4 * i + p;
        if (p === 0) hit[i] = newestHit;
      }
      if (clippedHere) touched++;
      counted++;
      // The driven sound from `latency` samples ago
      const read = delayAt + 1 === lat1 ? 0 : delayAt + 1;
      dr2[2 * i] = dLine[read];
      dr2[2 * i + 1] = dRine[read];
      dLine[delayAt] = l;
      dRine[delayAt] = r;
      delayAt = read;
      if (GT > 0) {
        // (The band kind: the driven sound through both filters instead, as late)
        dryAt = dryAt + 1 === GT ? 0 : dryAt + 1;
        dxL[dryAt] = dxL[dryAt + GT] = l;
        dxR[dryAt] = dxR[dryAt + GT] = r;
        const e = dryAt + GT;
        let sl = 0;
        let sr = 0;
        for (let m = 0; m < GT; m++) {
          const g = gf[m];
          sl += g * dxL[e - m];
          sr += g * dxR[e - m];
        }
        dr2[2 * i] = sl;
        dr2[2 * i + 1] = sr;
      }
    }
    // The residual filtered back down at each sample's phase: over the stretch of the filter's
    // reach that has any (newest first, as over every tap: the zeros either side add nothing).
    // Sample i reads up to point `at` = HELD + 4 i (counted from the first held one: its own last ALIGN
    // points aren't in reach yet), back to at - (LENGTH - 1)
    for (let i = 0; i < frames; i += 4) {
      // Each sample's stretch, from the newest point with a residual in reach (noted as its
      // points went through the curve) to the oldest still in reach; the four samples' sums run
      // over all their stretches at once (where one's is zeros, its sum stays as it is)
      let from = len;
      let to = -1;
      for (let s = i; s < i + 4 && s < frames; s++) {
        const at = held + 4 * s;
        const newestHere = hit[s];
        if (newestHere < at - reachBack) continue;
        if (oldestHit < at - reachBack) {
          let q = oldestHit + 1 > at - reachBack ? oldestHit + 1 : at - reachBack;
          for (; q < newestHere; q++) {
            if (rs[2 * q] !== 0 || rs[2 * q + 1] !== 0) break;
          }
          oldestHit = q;
        }
        if (at - newestHere < from) from = at - newestHere;
        if (at - oldestHit > to) to = at - oldestHit;
      }
      let l0 = 0;
      let r0 = 0;
      let l1 = 0;
      let r1 = 0;
      let l2 = 0;
      let r2 = 0;
      let l3 = 0;
      let r3 = 0;
      let x = 2 * (held + 4 * i - from);
      for (let j = from; j <= to; j++) {
        const k = down[j];
        l0 += k * rs[x];
        r0 += k * rs[x + 1];
        l1 += k * rs[x + 8];
        r1 += k * rs[x + 9];
        l2 += k * rs[x + 16];
        r2 += k * rs[x + 17];
        l3 += k * rs[x + 24];
        r3 += k * rs[x + 25];
        x -= 2;
      }
      // The driven sound plus what the curve did to it
      outL[i] = dr2[2 * i] + l0;
      outR[i] = dr2[2 * i + 1] + r0;
      if (i + 1 < frames) {
        outL[i + 1] = dr2[2 * i + 2] + l1;
        outR[i + 1] = dr2[2 * i + 3] + r1;
      }
      if (i + 2 < frames) {
        outL[i + 2] = dr2[2 * i + 4] + l2;
        outR[i + 2] = dr2[2 * i + 5] + r2;
      }
      if (i + 3 < frames) {
        outL[i + 3] = dr2[2 * i + 6] + l3;
        outR[i + 3] = dr2[2 * i + 7] + r3;
      }
    }
    // The last points stay for the next block
    rs.copyWithin(0, 2 * 4 * frames, 2 * (4 * frames + held));
    state[HIST_AT] = histAt;
    state[DELAY_AT] = delayAt;
    state[DRY_AT] = dryAt;
    state[N] = n0 + frames;
    state[LAST_LOUD] = lastLoud;
    state[PEAK_REDUCTION] = peakReduction;
    state[TOUCHED] = touched;
    state[COUNTED] = counted;
    state[BEND_AT] = bendAt;
    state[SINCE] = since;
    state[E_L] = eL;
    state[E_R] = eR;
    state[MOST_L] = mostL;
    state[MOST_R] = mostR;
    // (Counted from the next block's first held point)
    state[NEWEST] = Math.max(NONE, newestHit - 4 * frames);
    state[OLDEST] = Math.max(NONE, oldestHit - 4 * frames);
  };

  // A few times over nothing (which changes nothing), so the engine has seen the writes after
  // the loops before it compiles a loop on its own: else the compiled loop is thrown away at the
  // end of every block, and the next one starts slow again (it keeps notes on code only after a
  // few calls)
  const none = new Float32Array(0);
  for (let k = 0; k < 16; k++) process(none, none, none, none, 0, 1, 1, 0);

  const read = (): ClipperReading => {
    const peakReduction = state[PEAK_REDUCTION];
    const touched = state[TOUCHED];
    const counted = state[COUNTED];
    const reading = { peakDb: peakReduction < 1 ? -20 * Math.log10(peakReduction) : 0, share: counted ? touched / counted : 0 };
    state[PEAK_REDUCTION] = 1;
    state[TOUCHED] = 0;
    state[COUNTED] = 0;
    return reading;
  };

  return { process, latency, read };
}

/**
 * The clipper over whole channels in place, lined up with the input (its delay taken back off:
 * the last `latency` samples come from running it on over silence). What an export's master
 * section does (masterAfter.ts); returns what it did.
 */
export function clipChannels(left: Float32Array, right: Float32Array, sampleRate: number, settings: ClipperSettings): ClipperReading {
  const kernel = createClipperKernel(sampleRate, settings.band === true);
  const { drive, ceiling, softness } = clipperParams(settings);
  const n = left.length;
  const lat = kernel.latency;
  const block = 4096;
  const outL = new Float32Array(block);
  const outR = new Float32Array(block);
  // Output sample i + lat is input sample i: write each block's output `lat` back
  const total = n + lat;
  const zeros = new Float32Array(block);
  for (let start = 0; start < total; start += block) {
    const end = Math.min(total, start + block);
    const frames = end - start;
    const inEnd = Math.min(n, end);
    const l = start < n ? left.subarray(start, inEnd) : zeros;
    const r = start < n ? right.subarray(start, inEnd) : zeros;
    let inL = l;
    let inR = r;
    if (l.length < frames) {
      inL = new Float32Array(frames);
      inL.set(l);
      inR = new Float32Array(frames);
      inR.set(r);
    }
    kernel.process(inL, inR, outL, outR, frames, drive, ceiling, softness);
    // (Input up to `end` has been read: writing back before index `end - lat` never overwrites unread input)
    for (let k = 0; k < frames; k++) {
      const at = start + k - lat;
      if (at >= 0 && at < n) {
        left[at] = outL[k];
        if (right !== left) right[at] = outR[k];
      }
    }
  }
  return kernel.read();
}

/** The worklet processor's name. */
export const CLIPPER_PROCESSOR = 'bbx-clipper';

/** How often the worklet tells the page what it's doing (for the meter), per second. */
const READINGS_PER_SECOND = 15;

/**
 * The AudioWorklet module: the kernel above with k-rate `drive`, `ceiling` (linear) and
 * `softness` params, the band kind with processorOptions `{ band: true }`. It posts a ClipperReading a few times a second; a 'dispose' message stops it.
 */
export const CLIPPER_WORKLET_SOURCE = `
const createClipperKernel = ${createClipperKernel.toString()};
class ClipperProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'drive', defaultValue: 1, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'ceiling', defaultValue: 1, minValue: 0.001, maxValue: 1, automationRate: 'k-rate' },
      { name: 'softness', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor(options) {
    super();
    // (processorOptions.band: the band kind, see ClipperSettings.band)
    this.kernel = createClipperKernel(sampleRate, !!(options && options.processorOptions && options.processorOptions.band));
    this.alive = true;
    this.silence = new Float32Array(128);
    this.frames = 0;
    this.every = Math.round(sampleRate / ${READINGS_PER_SECOND});
    this.port.onmessage = (e) => {
      if (e.data === 'dispose') this.alive = false;
    };
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const frames = outL.length;
    if (this.silence.length < frames) this.silence = new Float32Array(frames);
    const inL = input.length > 0 ? input[0] : this.silence;
    const inR = input.length > 1 ? input[1] : inL;
    this.kernel.process(inL, inR, outL, outR, frames, parameters.drive[0], parameters.ceiling[0], parameters.softness[0]);
    this.frames += frames;
    if (this.frames >= this.every) {
      this.frames = 0;
      this.port.postMessage(this.kernel.read());
    }
    return this.alive;
  }
}
registerProcessor('${CLIPPER_PROCESSOR}', ClipperProcessor);
`;
