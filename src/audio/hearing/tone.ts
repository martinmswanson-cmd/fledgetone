/**
 * The balance of a sound's spectrum for the hearing report: the band spectrum, each region against
 * the whole, where the weight sits (centre, tilt, roll-off), sub bass against bass, and the narrow
 * peaks that stand out of their surroundings. Plain maths on samples, no Web Audio, so Node can test it.
 */
import { bandSpectrum, levelBetween, REGIONS, sumDb, totalBands } from '../mixAnalysis';
import { bandEdges, db, framesOf, midOf, sideOf, toBands } from './frames';
import type { Tone } from './types';

const round1 = (x: number) => Math.round(x * 10) / 10;

/** The mean power per bin of the middle plus the sides, over frames of `size`. */
function totalPower(channels: readonly Float32Array[], sampleRate: number, size: number, hop: number): Float64Array {
  const out = new Float64Array(size / 2 + 1);
  const parts = [midOf(channels), sideOf(channels)];
  for (const x of parts) {
    if (!x) continue;
    const { power } = framesOf(x, sampleRate, size, hop);
    for (const frame of power) for (let k = 0; k < out.length; k++) out[k] += frame[k] / power.length;
  }
  return out;
}

/** The balance of the spectrum of some sound. */
export function toneOf(channels: readonly Float32Array[], sampleRate: number): Tone {
  // The spectrum, without bands above half the sample rate
  const full = bandSpectrum(channels, sampleRate);
  const half = 2 ** (1 / 12);
  const keep = full.freqs.map((f) => f * half <= (sampleRate / 2) * 1.0001);
  const pick = (v: readonly number[]) => v.filter((_, i) => keep[i]);
  const raw = { freqs: pick(full.freqs), mid: pick(full.mid), side: pick(full.side) };
  const spectrum = { freqs: raw.freqs, mid: raw.mid.map(round1), side: raw.side.map(round1) };

  const bands = totalBands(raw);
  const total = sumDb(bands);
  const regions = REGIONS.map((x) => ({ name: x.name, db: Number.isFinite(total) ? round1(levelBetween(raw, bands, x.lo, x.hi) - total) : 0 }));

  // Where the weight sits, from the bins between 20 Hz and 20 kHz
  const size = 4096;
  const power = totalPower(channels, sampleRate, size, size / 2);
  const binHz = sampleRate / size;
  let sum = 0;
  let weighted = 0;
  for (let k = 0; k < power.length; k++) {
    const f = k * binHz;
    if (f < 20 || f > 20000) continue;
    sum += power[k];
    weighted += power[k] * f;
  }
  let centreHz = 0;
  let rolloffHz = 0;
  if (sum > 0) {
    centreHz = weighted / sum;
    let acc = 0;
    for (let k = 0; k < power.length; k++) {
      const f = k * binHz;
      if (f < 20 || f > 20000) continue;
      acc += power[k];
      if (acc >= sum * 0.95) {
        rolloffHz = f;
        break;
      }
    }
  }

  // Least-squares slope of the bands from 50 Hz to 12 kHz against octaves
  const xs: number[] = [];
  const ys: number[] = [];
  raw.freqs.forEach((f, i) => {
    if (f >= 50 && f <= 12000) {
      xs.push(Math.log2(f));
      ys.push(bands[i]);
    }
  });
  let tilt = 0;
  if (xs.length > 1) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    tilt = den > 0 ? num / den : 0;
  }

  const subVsBassDb = Number.isFinite(total) ? levelBetween(raw, bands, 20, 60) - levelBetween(raw, bands, 60, 200) : 0;

  return {
    spectrum,
    regions,
    centreHz: Math.round(centreHz),
    tiltDbPerOctave: round1(tilt),
    rolloffHz: Math.round(rolloffHz),
    subVsBassDb: round1(subVsBassDb),
    peaks: sum > 0 ? peaksOf(channels, sampleRate) : [],
  };
}

/** Narrow peaks on a 1/24-octave spectrum: local maxima 6 dB or more over their surroundings, at most 5, largest first. */
function peaksOf(channels: readonly Float32Array[], sampleRate: number): Tone['peaks'] {
  const size = 16384;
  const { centres, edges } = bandEdges(24, sampleRate);
  const levels = Array.from(toBands(totalPower(channels, sampleRate, size, size / 2), sampleRate, size, edges), db);
  const reach = 16; // two thirds of an octave, in bands
  const found: Array<{ i: number; overDb: number }> = [];
  for (let i = 1; i < levels.length - 1; i++) {
    if (!(levels[i] > levels[i - 1] && levels[i] >= levels[i + 1])) continue;
    const around = levels.slice(Math.max(0, i - reach), i + reach + 1).sort((a, b) => a - b);
    const mid = around.length >> 1;
    const median = around.length % 2 ? around[mid] : (around[mid - 1] + around[mid]) / 2;
    if (levels[i] - median >= 6) found.push({ i, overDb: levels[i] - median });
  }
  found.sort((a, b) => b.overDb - a.overDb);
  const kept: typeof found = [];
  for (const p of found) {
    if (kept.length < 5 && kept.every((k) => Math.abs(k.i - p.i) > 4)) kept.push(p); // within a sixth of an octave is one peak
  }
  return kept.map((p) => ({ hz: round1(centres[p.i]), overDb: round1(p.overDb) }));
}
