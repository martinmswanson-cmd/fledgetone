/**
 * Measuring a rendered mix (or a reference song, or one track's stem) for the Mix check and the
 * reference A/B: its long-term average spectrum, middle and sides apart (where the low end sits in
 * the stereo field), smoothed into fractional-octave bands, and short-term level envelopes of a
 * frequency band (when the kick and the bass hit together). Plain maths on samples, no Web Audio,
 * so Node can test it.
 */

/** A long-term average spectrum in smoothed bands. */
export interface BandSpectrum {
  /** Each band's centre, Hz, low to high. */
  freqs: number[];
  /** Mean power per band of the middle ((L + R) / 2), dB (relative: full-scale sine about -3). */
  mid: number[];
  /** Mean power per band of the sides ((L - R) / 2), dB. */
  side: number[];
}

/** The FFT size the spectra are measured with. */
export const SPECTRUM_FFT = 4096;
/** Bands per octave of a BandSpectrum (sixth-octave: smooth enough to read, fine enough to place a problem). */
export const BANDS_PER_OCTAVE = 6;
const LOWEST_HZ = 20;
const HIGHEST_HZ = 20000;

/** The bands' centres: sixth-octave steps from 20 Hz to 20 kHz. */
export function bandCentres(perOctave = BANDS_PER_OCTAVE): number[] {
  const out: number[] = [];
  for (let f = LOWEST_HZ; f <= HIGHEST_HZ * 1.0001; f *= 2 ** (1 / perOctave)) out.push(f);
  return out;
}

/** In-place radix-2 FFT (re, im of a power-of-two length). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const toDb = (p: number) => (p > 1e-20 ? 10 * Math.log10(p) : -200);

/**
 * The long-term average power spectrum of `channels` (one or two), middle and sides, per FFT bin.
 * Windows are spread evenly over the sound, at most `maxFrames` of them (a long song needn't be
 * read in full to know its balance); silent windows are skipped, so gaps don't pull it down.
 */
export function averagePower(channels: readonly Float32Array[], maxFrames = 800): { mid: Float64Array; side: Float64Array; frames: number } {
  const n = SPECTRUM_FFT;
  const left = channels[0];
  const right = channels[1] ?? channels[0];
  const bins = n / 2 + 1;
  const mid = new Float64Array(bins);
  const side = new Float64Array(bins);
  const hops = Math.max(1, Math.floor((left.length - n) / (n / 2)) + 1);
  const step = Math.max(1, hops / maxFrames);
  const window = new Float64Array(n);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    wsum += window[i] * window[i];
  }
  const mr = new Float64Array(n);
  const mi = new Float64Array(n);
  const sr = new Float64Array(n);
  const si = new Float64Array(n);
  let frames = 0;
  for (let h = 0; h < hops; h += step) {
    const start = Math.floor(h) * (n / 2);
    if (start + n > left.length) break;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const l = left[start + i];
      const r = right[start + i];
      const m = (l + r) * 0.5;
      const s = (l - r) * 0.5;
      energy += m * m + s * s;
      mr[i] = m * window[i];
      sr[i] = s * window[i];
    }
    // Under about -80 dBFS: silence, not part of the balance
    if (energy / n < 1e-8) continue;
    mi.fill(0);
    si.fill(0);
    fft(mr, mi);
    fft(sr, si);
    for (let k = 0; k < bins; k++) {
      mid[k] += mr[k] * mr[k] + mi[k] * mi[k];
      side[k] += sr[k] * sr[k] + si[k] * si[k];
    }
    frames++;
  }
  // Scaled so a full-scale sine's bin power sums to about 0.5 (its mean square)
  const scale = frames ? 2 / (frames * n * wsum) : 0;
  for (let k = 0; k < bins; k++) {
    mid[k] *= scale;
    side[k] *= scale;
  }
  return { mid, side, frames };
}

/** Sum of the bins' power from `lo` to `hi` Hz (linear). */
export function powerBetween(power: Float64Array, sampleRate: number, lo: number, hi: number): number {
  const binHz = sampleRate / SPECTRUM_FFT;
  let sum = 0;
  const from = Math.max(1, Math.ceil(lo / binHz));
  const to = Math.min(power.length - 1, Math.floor(hi / binHz));
  for (let k = from; k <= to; k++) sum += power[k];
  return sum;
}

/**
 * Bins into fractional-octave bands (each band's power summed over its width, half a band either
 * side of its centre), in dB. A band narrower than a bin takes the bin under its centre, scaled to
 * its width, so the low end isn't jagged.
 */
export function toBands(power: Float64Array, sampleRate: number, perOctave = BANDS_PER_OCTAVE): number[] {
  const binHz = sampleRate / SPECTRUM_FFT;
  const half = 2 ** (1 / (2 * perOctave));
  return bandCentres(perOctave).map((f) => {
    const lo = f / half;
    const hi = f * half;
    const width = hi - lo;
    if (width < binHz * 2) {
      // Interpolated between the two nearest bins, per Hz, times the band's width
      const x = f / binHz;
      const k = Math.min(power.length - 2, Math.floor(x));
      const t = x - k;
      const perHz = (power[k] * (1 - t) + power[k + 1] * t) / binHz;
      return toDb(perHz * width);
    }
    return toDb(powerBetween(power, sampleRate, lo, hi));
  });
}

/** The smoothed band spectrum of some sound (see averagePower and toBands). */
export function bandSpectrum(channels: readonly Float32Array[], sampleRate: number): BandSpectrum & { frames: number } {
  const { mid, side, frames } = averagePower(channels);
  return { freqs: bandCentres(), mid: toBands(mid, sampleRate), side: toBands(side, sampleRate), frames };
}

/** Add power in dB: 10 log10(sum of 10^(x/10)). */
export function sumDb(levels: readonly number[]): number {
  let p = 0;
  for (const v of levels) p += 10 ** (v / 10);
  return toDb(p);
}

/** The total power of a band spectrum's bands from `lo` to `hi` Hz (by centre), dB. */
export function levelBetween(spectrum: Pick<BandSpectrum, 'freqs'>, levels: readonly number[], lo: number, hi: number): number {
  return sumDb(levels.filter((_, i) => spectrum.freqs[i] >= lo && spectrum.freqs[i] < hi));
}

/**
 * A band spectrum's shape with its overall tilt taken out: the straight line (dB against octaves)
 * that fits the bands between `lo` and `hi` best is subtracted, so what's left is where it bulges
 * or dips compared with its own slope. Bands outside lo..hi are left at NaN.
 */
export function detrended(spectrum: BandSpectrum, lo = 50, hi = 12000): number[] {
  const xs: number[] = [];
  const ys: number[] = [];
  spectrum.freqs.forEach((f, i) => {
    if (f >= lo && f <= hi) {
      xs.push(Math.log2(f));
      ys.push(spectrum.mid[i]);
    }
  });
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  return spectrum.freqs.map((f, i) => (f >= lo && f <= hi ? spectrum.mid[i] - (my + slope * (Math.log2(f) - mx)) : NaN));
}

/** RBJ biquad coefficients [b0, b1, b2, a1, a2] for a 2nd-order low- or high-pass. */
function biquadCoefs(type: 'lowpass' | 'highpass', hz: number, sampleRate: number): number[] {
  const w = (2 * Math.PI * hz) / sampleRate;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b = type === 'lowpass' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * cos) / a0, (1 - alpha) / a0];
}

function runBiquad(x: Float64Array, c: number[]): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = c[0] * v + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = y;
    x[i] = y;
  }
}

/**
 * The RMS level of the middle of `channels` between `lo` and `hi` Hz (two 2nd-order filters each
 * side), in frames of `frameSeconds`: a picture of when that band sounds and how loud (linear).
 */
export function bandEnvelope(channels: readonly Float32Array[], sampleRate: number, lo: number, hi: number, frameSeconds = 0.02): Float32Array {
  const left = channels[0];
  const right = channels[1] ?? channels[0];
  const x = new Float64Array(left.length);
  for (let i = 0; i < x.length; i++) x[i] = (left[i] + right[i]) * 0.5;
  if (lo > 0) {
    const hp = biquadCoefs('highpass', lo, sampleRate);
    runBiquad(x, hp);
    runBiquad(x, hp);
  }
  if (hi < sampleRate / 2) {
    const lp = biquadCoefs('lowpass', hi, sampleRate);
    runBiquad(x, lp);
    runBiquad(x, lp);
  }
  const frame = Math.max(1, Math.round(frameSeconds * sampleRate));
  const out = new Float32Array(Math.floor(x.length / frame));
  for (let f = 0; f < out.length; f++) {
    let sum = 0;
    for (let i = f * frame; i < (f + 1) * frame; i++) sum += x[i] * x[i];
    out[f] = Math.sqrt(sum / frame);
  }
  return out;
}

/** The whole sound's power per band (middle and sides together), dB. */
export const totalBands = (s: BandSpectrum): number[] => s.mid.map((m, i) => sumDb([m, s.side[i]]));

/** Named stretches of the spectrum, for saying where two mixes differ. */
export const REGIONS: ReadonlyArray<{ name: string; lo: number; hi: number }> = [
  { name: 'sub bass (under 60 Hz)', lo: 20, hi: 60 },
  { name: 'bass (60-200 Hz)', lo: 60, hi: 200 },
  { name: 'low mids (200-500 Hz)', lo: 200, hi: 500 },
  { name: 'mids (500 Hz-2 kHz)', lo: 500, hi: 2000 },
  { name: 'upper mids (2-5 kHz)', lo: 2000, hi: 5000 },
  { name: 'presence (5-10 kHz)', lo: 5000, hi: 10000 },
  { name: 'air (over 10 kHz)', lo: 10000, hi: 20000 },
];

/**
 * How a mix's tonal balance differs from a reference's, band by band (dB, mix minus reference),
 * after `offsetDb` (the level match) and with the overall difference over 100 Hz-10 kHz taken out,
 * so only the shape counts; smoothed over a third of an octave. Also the regions that differ by
 * more than `atLeast` dB, biggest first.
 */
export function compareSpectra(mix: BandSpectrum, reference: BandSpectrum, offsetDb = 0, atLeast = 2.5): { diff: number[]; regions: Array<{ name: string; db: number }> } {
  const m = totalBands(mix);
  const r = totalBands(reference).map((v) => v + offsetDb);
  const raw = m.map((v, i) => (v > -150 && r[i] > -150 ? v - r[i] : NaN));
  const mid = raw.filter((v, i) => Number.isFinite(v) && mix.freqs[i] >= 100 && mix.freqs[i] <= 10000);
  const mean = mid.length ? mid.reduce((a, b) => a + b, 0) / mid.length : 0;
  const centred = raw.map((v) => v - mean);
  // A third of an octave either side is a band each way at sixth-octave bands
  const diff = centred.map((_, i) => {
    const xs = [centred[i - 1], centred[i], centred[i + 1]].filter(Number.isFinite) as number[];
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  });
  const regions = REGIONS.map((g) => {
    const xs = diff.filter((v, i) => Number.isFinite(v) && mix.freqs[i] >= g.lo && mix.freqs[i] < g.hi);
    return { name: g.name, db: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0 };
  })
    .filter((g) => Math.abs(g.db) >= atLeast)
    .sort((a, b) => Math.abs(b.db) - Math.abs(a.db));
  return { diff, regions };
}
