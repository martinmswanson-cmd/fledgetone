/**
 * The phase vocoder: time-stretching for tonal sound (chords, pads, voices, keys), where WSOLA's
 * joins (timeStretch.ts) beat and buzz. The sound is cut into long overlapping windows, each
 * turned into its spectrum (fft.ts); each window is then put back further apart (or closer) with
 * the phase of every partial moved on by exactly what its frequency says it would have moved in
 * the new time, so every partial keeps its pitch and runs on unbroken from window to window.
 *
 * - Frequencies are measured, not guessed: each bin's own frequency comes from the spectrum of the
 *   window's derivative (reassignment), so a partial is advanced at its true frequency.
 * - Phase locking (identity phase locking): the bins around each spectral peak turn with it, so a
 *   partial stays one clean partial instead of a smear of bins that drift apart (the "phasey",
 *   reverberant sound of a plain phase vocoder).
 * - Transients: a partial a hit starts is placed exactly where the hit belongs; partials already
 *   sounding are eased, over the few windows before the hit, onto the phases that put it back as
 *   it was (only as far as the hit has a share in their bins, so a held note runs on undisturbed);
 *   and around each hit the speed is held at 1 where there's room (holdAtHits), so every window
 *   over it lays it down exactly as it was taken: as loud, as sharp, with no echo before it.
 * - Stereo: the phases are worked out once, on the channels' mix (none cancelling another:
 *   channelMix.ts), and every channel is turned by the same amount, so the stereo image stays put.
 * - Silence costs nothing (a window with no sound in any channel is skipped), and still counts in
 *   the windows' overlap, so the sound next to it is never turned up.
 *
 * The time map says where in the input each moment of the output comes from (anchors, linear
 * between them), so a constant stretch, a warp along markers and the pitch shifter's changing
 * speeds are all the same pass. Plain arrays, so Node can unit-test it.
 */
import { fftInPlace } from './fft';
import { analysisMix, soundingBlocks } from './channelMix';

/** A time map: output sample `out[i]` plays input sample `in[i]`, linear between (and beyond, at the end slopes). */
export interface TimeMap {
  out: readonly number[];
  in: readonly number[];
}

export interface VocoderOptions {
  /** FFT size (a power of two); default about 90 ms at the sample rate */
  size?: number;
  /** Windows per window length (the hop is size / overlap); default 4 */
  overlap?: number;
}

/** The FFT size for `sampleRate`: about 85 to 95 ms, long enough to tell a chord's partials apart. */
export function vocoderSize(sampleRate: number): number {
  return sampleRate > 64000 ? 8192 : sampleRate > 32000 ? 4096 : 2048;
}

/** Where in the input output sample `o` comes from. */
export function mapAt(map: TimeMap, o: number): number {
  const { out, in: inp } = map;
  const last = out.length - 1;
  if (o <= out[0]) {
    const slope = last > 0 ? (inp[1] - inp[0]) / Math.max(1e-9, out[1] - out[0]) : 1;
    return inp[0] + (o - out[0]) * slope;
  }
  if (o >= out[last]) {
    const slope = last > 0 ? (inp[last] - inp[last - 1]) / Math.max(1e-9, out[last] - out[last - 1]) : 1;
    return inp[last] + (o - out[last]) * slope;
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (out[mid] <= o) lo = mid;
    else hi = mid;
  }
  const span = out[hi] - out[lo];
  return span > 0 ? inp[lo] + ((o - out[lo]) / span) * (inp[hi] - inp[lo]) : inp[lo];
}

/**
 * `map` with the speed held at 1 for `reach` samples either side of each hit (where there's room:
 * the stretch between holds stays within 4 times the map's own speed there, and the map's own
 * anchors stay where they are). Every window over a held hit is then laid down exactly as it was
 * taken, so the hit comes back as it went in: as loud, as sharp, with nothing before it. The hits
 * still land where the map put them; the stretching is done in between.
 */
export function holdAtHits(map: TimeMap, hits: readonly number[], reach: number, inLength: number, outLength: number, strength?: readonly number[]): TimeMap {
  const inverse: TimeMap = { out: map.in, in: map.out };
  /** The map's own speed (output per input sample) at input sample x */
  const slope = (x: number) => Math.max(1e-6, (mapAt(inverse, x + 1) - mapAt(inverse, x - 1)) / 2);
  const fits = (gapIn: number, gapOut: number, at: number) => {
    if (gapIn <= 0 || gapOut <= 0) return gapIn === 0 && gapOut === 0;
    const r = gapOut / gapIn / slope(at);
    return r > 0.25 && r < 4;
  };
  /** Held stretches so far, in order: [in from, in to, out from, out to] */
  const holds: Array<[number, number, number, number]> = [];
  // The strongest hits first, so a weak one next to a strong one gives way to it
  const order = hits.map((_, i) => i).sort((p, q) => (strength ? strength[q] - strength[p] : 0) || hits[p] - hits[q]);
  for (const q of order) {
    const h = hits[q];
    const t = mapAt(inverse, h);
    for (const d of [reach, reach / 2, reach / 4]) {
      const left = Math.min(d, h, t);
      const right = Math.min(d, inLength - h, outLength - t);
      if (left < d / 4 && right < d / 4) continue;
      const a = h - left;
      const b = h + right;
      // The points either side it must fit between: the map's own anchors and the holds so far
      let prevIn = -Infinity;
      let prevOut = -Infinity;
      let nextIn = Infinity;
      let nextOut = Infinity;
      let clash = false;
      for (let i = 0; i < map.in.length; i++) {
        const ai = map.in[i];
        const ao = map.out[i];
        if (ai > a && ai < b) {
          // (One on the hit itself is on the held line)
          if (!(Math.abs(ai - h) < 1 && Math.abs(ao - t) < 1)) clash = true;
        } else if (ai <= a && ai > prevIn) {
          prevIn = ai;
          prevOut = ao;
        } else if (ai >= b && ai < nextIn) {
          nextIn = ai;
          nextOut = ao;
        }
      }
      for (const [ha, hb, oa, ob] of holds) {
        if (hb > a && ha < b) clash = true;
        else if (hb <= a && hb > prevIn) {
          prevIn = hb;
          prevOut = ob;
        } else if (ha >= b && ha < nextIn) {
          nextIn = ha;
          nextOut = oa;
        }
      }
      if (clash) continue;
      if (Number.isFinite(prevIn) && !fits(a - prevIn, t - left - prevOut, (a + prevIn) / 2)) continue;
      if (Number.isFinite(nextIn) && !fits(nextIn - b, nextOut - (t + right), (b + nextIn) / 2)) continue;
      holds.push([a, b, t - left, t + right]);
      holds.sort((x, y) => x[0] - y[0]);
      break;
    }
  }
  if (!holds.length) return map;
  // The map's anchors outside the holds, and the holds' ends
  const points: Array<[number, number]> = [];
  for (let i = 0; i < map.in.length; i++) if (!holds.some(([a, b]) => map.in[i] > a && map.in[i] < b)) points.push([map.out[i], map.in[i]]);
  for (const [a, b, oa, ob] of holds) points.push([oa, a], [ob, b]);
  points.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const out: number[] = [];
  const inp: number[] = [];
  for (const [o, i] of points) {
    if (out.length && o === out[out.length - 1] && i === inp[inp.length - 1]) continue;
    out.push(o);
    inp.push(i);
  }
  return { out, in: inp };
}

/** Windows over which held partials are eased onto a coming hit's phases. */
const EASE_WINDOWS = 4;

/** How much louder (power) a partial must be than before a hit to count as the hit's own. */
const ONSET_RISE = 4;

export interface StretchOptions extends VocoderOptions {
  /** Hits in the input (samples, ascending): partials they start are placed exactly where the map puts the hit */
  onsets?: readonly number[];
  /** Add the result into these (one per channel, `outLength` long) instead of new arrays */
  into?: Float32Array[];
}

/**
 * `input` (one array per channel) laid along `map` into `outLength` samples: output sample o
 * sounds like input sample mapAt(map, o), at the input's pitch.
 */
export function vocode(input: readonly Float32Array[], outLength: number, map: TimeMap, sampleRate: number, options: StretchOptions = {}): Float32Array[] {
  const channels = input.length;
  const length = input[0]?.length ?? 0;
  const n = options.size ?? vocoderSize(sampleRate);
  const hop = Math.round(n / (options.overlap ?? 4));
  const half = n / 2;
  const bins = half + 1;
  const output = options.into ?? input.map(() => new Float32Array(outLength));
  if (!length || outLength <= 0) return output;
  const inverse: TimeMap = { out: map.in, in: map.out };
  const onsets = options.onsets ?? [];

  // Hann window, and its derivative (per sample) for the bins' true frequencies
  const win = new Float64Array(n);
  const dwin = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / n);
    dwin[j] = (Math.PI / n) * Math.sin((2 * Math.PI * j) / n);
  }
  // The mix the phases are worked out on
  // The signal the phases are worked out on (the channels' mix, none cancelling another), and
  // where any channel has sound, so silent windows cost nothing
  const mono = analysisMix(input);
  const sounding = soundingBlocks(input, 256);
  const silent = (from: number, to: number) => !sounding.any(from, to);

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const re2 = new Float64Array(n);
  const im2 = new Float64Array(n);
  // This window's mix spectrum and its bins' frequencies (radians per sample), and the last window's
  const xr = new Float64Array(bins);
  const xi = new Float64Array(bins);
  const mag = new Float64Array(bins);
  const freq = new Float64Array(bins);
  const prevXr = new Float64Array(bins);
  const prevXi = new Float64Array(bins);
  const prevFreq = new Float64Array(bins);
  /** The level of each bin in the last window, and in the last window before the hit now in the window */
  const prevMag = new Float64Array(bins);
  const before = new Float64Array(bins);
  /** Each bin's turn (synthesis phase less analysis phase), last window's and this one's */
  const prevTurn = new Float64Array(bins);
  const turn = new Float64Array(bins);
  const turnCos = new Float64Array(bins);
  const turnSin = new Float64Array(bins);
  const peaks = new Int32Array(bins);
  // The windows are added up in a ring (two windows long) and each sample is finished (divided by
  // its windows' overlap) and written out once no later window can reach it, so a long sound
  // needs no second copy of itself
  const ringSize = 2 * n;
  const mask = ringSize - 1;
  const rings = input.map(() => new Float64Array(ringSize));
  const norm = new Float64Array(ringSize);
  let flushed = 0;
  const flush = (upTo: number) => {
    const end = Math.min(outLength, upTo);
    for (; flushed < end; flushed++) {
      const r = flushed & mask;
      const w = norm[r];
      for (let c = 0; c < channels; c++) {
        output[c][flushed] += w > 1e-6 ? rings[c][r] / w : 0;
        rings[c][r] = 0;
      }
      norm[r] = 0;
    }
  };

  /** Window centred on input sample `c` (zero outside the sound), turned so its centre is index 0. */
  const load = (src: Float32Array, c: number, dst: Float64Array) => {
    for (let j = 0; j < n; j++) {
      const s = c - half + j;
      dst[(j + half) & (n - 1)] = s >= 0 && s < length ? src[s] * win[j] : 0;
    }
  };

  /**
   * A hit is laid at the same moment of the output by every window that holds it, each weighted
   * by where the hit sits in its analysis window and in its synthesis window; the overlap sum only
   * allows for the second. Where the map runs at speed 1 around the hit the two are the same; where
   * it can't, this is what the hit's partials are turned up or down by so the hit keeps its level.
   */
  const gains = new Map<number, number>();
  const placedGain = (h: number): number => {
    let g = gains.get(h);
    if (g !== undefined) return g;
    const at = mapAt(inverse, h);
    let both = 0;
    let synth = 0;
    for (let f = Math.ceil((at - half) / hop); f * hop < at + half; f++) {
      const ws = 0.5 + 0.5 * Math.cos((2 * Math.PI * (at - f * hop)) / n);
      const tau = h - Math.round(mapAt(map, f * hop));
      const wa = Math.abs(tau) < half ? 0.5 + 0.5 * Math.cos((2 * Math.PI * tau) / n) : 0;
      both += wa * ws;
      synth += ws * ws;
    }
    g = both > 0 ? Math.max(0.5, Math.min(2, synth / both)) : 1;
    gains.set(h, g);
    return g;
  };

  const firstFrame = -Math.ceil(half / hop);
  const lastFrame = Math.ceil((outLength + half) / hop);
  let started = false;
  let prevC = 0;
  let nextOnset = 0;
  let lastHit = -1;
  /** Where each hit lands in the output, and the next one not yet past */
  const hitOut = onsets.map((h) => mapAt(inverse, h));
  let upcoming = 0;
  /**
   * How much of each bin a hit brings (0: none, the bin's sound was there before; 1: all of it):
   * the window just after the hit against the one just before. Only what the hit brings is eased
   * onto its phases; a held note in its own bins is left to run on undisturbed.
   */
  const shares = new Map<number, Float32Array>();
  const spectrumAt = (centre: number, dst: Float64Array) => {
    for (let j = 0; j < n; j++) {
      const s = centre - half + j;
      re[j] = s >= 0 && s < length ? mono[s] * win[j] : 0;
      im[j] = 0;
    }
    fftInPlace(re, im);
    for (let k = 0; k < bins; k++) dst[k] = re[k] * re[k] + im[k] * im[k];
  };
  const after = new Float64Array(bins);
  const ahead = new Float64Array(bins);
  const hitShare = (q: number): Float32Array => {
    let got = shares.get(q);
    if (got) return got;
    for (const key of shares.keys()) if (key < q - 1) shares.delete(key);
    spectrumAt(Math.round(onsets[q] + half / 2), after);
    spectrumAt(Math.round(onsets[q] - half / 2), ahead);
    got = new Float32Array(bins);
    for (let k = 0; k < bins; k++) got[k] = after[k] > 0 ? Math.max(0, Math.min(1, (after[k] - ahead[k]) / after[k])) : 0;
    shares.set(q, got);
    return got;
  };
  for (let f = firstFrame; f <= lastFrame; f++) {
    const o = f * hop;
    const c = Math.round(mapAt(map, o));
    const inHop = c - prevC;
    prevC = c;
    flush(o - half);
    if (c + half <= 0 || c - half >= length || silent(c - half, c + half)) {
      // Silent: nothing to add, and the next window starts afresh. Its window still counts in the
      // overlap sum, or the sound either side would be divided by too little near the silence
      for (let j = 0; j < n; j++) {
        const at = o - half + j;
        if (at >= 0 && at < outLength) norm[at & mask] += win[j] * win[j];
      }
      started = false;
      prevMag.fill(0);
      continue;
    }
    // The mix's spectrum (window) and its derivative-window spectrum, in one complex FFT
    for (let j = 0; j < n; j++) {
      const s = c - half + j;
      const v = s >= 0 && s < length ? mono[s] : 0;
      const k = (j + half) & (n - 1);
      re[k] = v * win[j];
      im[k] = v * dwin[j];
    }
    fftInPlace(re, im);
    let peak = 0;
    for (let k = 0; k < bins; k++) {
      const m = (n - k) & (n - 1);
      // X = (Z[k] + conj Z[N-k]) / 2, D = (Z[k] - conj Z[N-k]) / 2i
      const ar = 0.5 * (re[k] + re[m]);
      const ai = 0.5 * (im[k] - im[m]);
      const dr = 0.5 * (im[k] + im[m]);
      const di = -0.5 * (re[k] - re[m]);
      xr[k] = ar;
      xi[k] = ai;
      const p = ar * ar + ai * ai;
      mag[k] = p;
      if (p > peak) peak = p;
      // The bin's true frequency: its centre less Im(D conj X) / |X|^2
      const omega = (2 * Math.PI * k) / n;
      freq[k] = p > 1e-30 ? omega - (di * ar - dr * ai) / p : omega;
    }
    // The hit in this window, if any (the one nearest its centre), and where the map puts it
    while (nextOnset < onsets.length && onsets[nextOnset] < c - half) nextOnset++;
    let hit = -1;
    for (let q = nextOnset; q < onsets.length && onsets[q] < c + half; q++) if (hit < 0 || Math.abs(onsets[q] - c) < Math.abs(hit - c)) hit = onsets[q];
    /** For a partial the hit starts: its phase is turned by its frequency times this, which puts the hit exactly where the map says */
    const place = hit >= 0 ? o - c - (mapAt(inverse, hit) - hit) : 0;
    const hitGain = hit >= 0 ? placedGain(hit) : 1;
    // The hit coming up (or in the window): held partials are eased, over the few windows before
    // it, onto the phases that would lay it exactly in place (a fraction of a hertz off for those
    // windows), so when it comes every partial, held or new, adds up to the hit as it was
    while (upcoming < onsets.length && hitOut[upcoming] < o - half) upcoming++;
    let ease = 0;
    let target = 0;
    let share: Float32Array | null = null;
    if (upcoming < onsets.length) {
      const ahead = (hitOut[upcoming] - half - o) / hop;
      if (ahead <= EASE_WINDOWS) {
        ease = ahead <= 0 ? 1 : 1 / (ahead + 1);
        target = o - c - (hitOut[upcoming] - onsets[upcoming]);
        share = hitShare(upcoming);
      }
    }
    if (hit >= 0 && hit !== lastHit) before.set(prevMag);
    lastHit = hit;
    // Peaks (a bin louder than the two either side), each ruling the bins down to the valleys either side
    const floor = peak * 1e-12;
    let count = 0;
    for (let k = 0; k < bins; k++) {
      const p = mag[k];
      if (p <= floor) continue;
      if (k > 0 && p <= mag[k - 1]) continue;
      if (k > 1 && p <= mag[k - 2]) continue;
      if (k + 1 < bins && p < mag[k + 1]) continue;
      if (k + 2 < bins && p < mag[k + 2]) continue;
      peaks[count++] = k;
    }
    let lo = 0;
    for (let q = 0; q < count || lo < bins; q++) {
      // The region the peak rules: to the lowest bin between it and the next peak (or all of it, with none)
      const p = q < count ? peaks[q] : -1;
      let hi = bins;
      if (q + 1 < count) {
        const next = peaks[q + 1];
        let low = p;
        for (let k = p + 1; k < next; k++) if (mag[k] < mag[low]) low = k;
        hi = low === p ? p + 1 : low + 1;
      }
      let t = 0;
      if (p >= 0) {
        if (hit >= 0 && mag[p] > ONSET_RISE * before[p]) {
          // A partial the hit starts: delay it so the hit lands where it belongs (each bin by its
          // own frequency, a pure delay, so the hit's shape is kept)
          for (let k = lo; k < hi; k++) {
            const tk = ((2 * Math.PI * k) / n) * place;
            turn[k] = tk;
            turnCos[k] = Math.cos(tk) * hitGain;
            turnSin[k] = Math.sin(tk) * hitGain;
          }
          lo = hi;
          if (q >= count) break;
          continue;
        } else if (started) {
          // The partial's phase moved on over the output hop at its frequency: the mean of the two
          // windows' measures when they agree (which follows a glide), refined by how far its phase
          // really moved over the input hop (so at a speed of 1 the input comes back exactly)
          const f0 = freq[p];
          const f1 = prevFreq[p];
          const guess = Math.abs(f0 - f1) < (4 * Math.PI) / n ? 0.5 * (f0 + f1) : f0;
          let w = guess;
          if (inHop > 0) {
            let err = Math.atan2(xi[p], xr[p]) - Math.atan2(prevXi[p], prevXr[p]) - guess * inHop;
            err -= 2 * Math.PI * Math.round(err / (2 * Math.PI));
            w = guess + err / inHop;
          }
          t = prevTurn[p] + w * (hop - inHop);
          if (share && share[p] > 0) {
            let off = t - freq[p] * target;
            off -= 2 * Math.PI * Math.round(off / (2 * Math.PI));
            t -= ease * share[p] * off;
          }
          t -= 2 * Math.PI * Math.round(t / (2 * Math.PI));
        }
      }
      const cs = Math.cos(t);
      const sn = Math.sin(t);
      for (let k = lo; k < hi; k++) {
        turn[k] = t;
        turnCos[k] = cs;
        turnSin[k] = sn;
      }
      lo = hi;
      if (q >= count) break;
    }
    // Each channel's spectrum turned by the mix's turns, back to sound, overlap-added
    for (let ch = 0; ch < channels; ch += 2) {
      const two = ch + 1 < channels;
      if (channels === 1) {
        // The mix is the channel: its spectrum is xr, xi
        for (let k = 0; k < bins; k++) {
          re2[k] = xr[k] * turnCos[k] - xi[k] * turnSin[k];
          im2[k] = xr[k] * turnSin[k] + xi[k] * turnCos[k];
        }
        for (let k = 1; k < half; k++) {
          re2[n - k] = re2[k];
          im2[n - k] = -im2[k];
        }
        im2[0] = 0;
        im2[half] = 0;
      } else {
        // Two channels in one FFT: re = left, im = right
        load(input[ch], c, re);
        if (two) load(input[ch + 1], c, im);
        else im.fill(0);
        fftInPlace(re, im);
        // Separate, turn each, and pack again: Y = A' + i B'
        for (let k = 0; k < bins; k++) {
          const m = (n - k) & (n - 1);
          const ar = 0.5 * (re[k] + re[m]);
          const ai = 0.5 * (im[k] - im[m]);
          const br = 0.5 * (im[k] + im[m]);
          const bi = -0.5 * (re[k] - re[m]);
          const cs = turnCos[k];
          const sn = turnSin[k];
          const tar = ar * cs - ai * sn;
          const tai = ar * sn + ai * cs;
          const tbr = br * cs - bi * sn;
          const tbi = br * sn + bi * cs;
          // A' (Hermitian) + i B' (Hermitian), at k and N-k
          if (k === 0 || k === half) {
            re2[k] = tar - tbi;
            im2[k] = tai + tbr;
          } else {
            re2[k] = tar - tbi;
            im2[k] = tai + tbr;
            re2[m] = tar + tbi;
            im2[m] = -tai + tbr;
          }
        }
      }
      fftInPlace(re2, im2, true);
      const a = rings[ch];
      const b = two ? rings[ch + 1] : null;
      for (let j = 0; j < n; j++) {
        const at = o - half + j;
        if (at < 0 || at >= outLength) continue;
        const k = (j + half) & (n - 1);
        a[at & mask] += re2[k] * win[j];
        if (b) b[at & mask] += im2[k] * win[j];
      }
    }
    for (let j = 0; j < n; j++) {
      const at = o - half + j;
      if (at >= 0 && at < outLength) norm[at & mask] += win[j] * win[j];
    }
    prevXr.set(xr);
    prevXi.set(xi);
    prevFreq.set(freq);
    prevTurn.set(turn);
    prevMag.set(mag);
    started = true;
  }
  flush(outLength);
  return output;
}

/**
 * How fast the sound's partials glide, in cents per second (the louder partials count more): about
 * 0 for held notes and chords, hundreds for a voice's vibrato and slides. A gliding partial blurs
 * in a long window, a held chord's close partials only come apart in one, so this picks the
 * window (see vocoderSizeFor).
 */
export function glideRate(mono: Float32Array, sampleRate: number): number {
  const n = vocoderSize(sampleRate);
  const hop = n / 4;
  const half = n / 2;
  const bins = half + 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const win = new Float64Array(n);
  const dwin = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    win[j] = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / n);
    dwin[j] = (Math.PI / n) * Math.sin((2 * Math.PI * j) / n);
  }
  const mag = new Float64Array(bins);
  let prev: Array<[number, number]> = [];
  let sum = 0;
  let weight = 0;
  const lowBin = Math.ceil((60 * n) / sampleRate);
  const highBin = Math.floor((5000 * n) / sampleRate);
  for (let c = half; c + half <= mono.length; c += hop) {
    for (let j = 0; j < n; j++) {
      const v = mono[c - half + j];
      re[j] = v * win[j];
      im[j] = v * dwin[j];
    }
    fftInPlace(re, im);
    let peak = 0;
    const hz = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      const m = (n - k) & (n - 1);
      const ar = 0.5 * (re[k] + re[m]);
      const ai = 0.5 * (im[k] - im[m]);
      const dr = 0.5 * (im[k] + im[m]);
      const di = -0.5 * (re[k] - re[m]);
      const p = ar * ar + ai * ai;
      mag[k] = p;
      if (p > peak) peak = p;
      hz[k] = ((p > 1e-30 ? (2 * Math.PI * k) / n - (di * ar - dr * ai) / p : (2 * Math.PI * k) / n) * sampleRate) / (2 * Math.PI);
    }
    const now: Array<[number, number]> = [];
    for (let k = Math.max(2, lowBin); k < Math.min(bins - 2, highBin); k++) {
      const p = mag[k];
      if (p > peak * 1e-4 && p > mag[k - 1] && p > mag[k - 2] && p >= mag[k + 1] && p >= mag[k + 2] && hz[k] > 0) now.push([hz[k], p]);
    }
    // Each peak against the nearest one in the last window (within a semitone)
    let j = 0;
    for (const [f, p] of now) {
      while (j + 1 < prev.length && Math.abs(prev[j + 1][0] - f) < Math.abs(prev[j][0] - f)) j++;
      const q = prev[j];
      if (!q) continue;
      const cents = 1200 * Math.abs(Math.log2(f / q[0]));
      if (cents > 100) continue;
      const w = Math.min(p, q[1]);
      sum += w * cents;
      weight += w;
    }
    prev = now;
  }
  return weight > 0 ? (sum / weight) * (sampleRate / hop) : 0;
}
