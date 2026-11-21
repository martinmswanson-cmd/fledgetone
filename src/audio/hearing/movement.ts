/**
 * How a sound changes over its length, for the hearing report: the average frame-to-frame change
 * in level across third-octave bands, and the steady wobbles (tremolo, gating, ducking) of the low,
 * mid and high bands with their rate, depth and musical note value. Plain maths on samples, no Web
 * Audio, so Node can test it.
 */
import { fftInPlace } from '../fft';
import { bandEnvelope } from '../mixAnalysis';
import { bandEdges, db, framesOf, midOf, toBands } from './frames';
import type { Modulation, Movement } from './types';

/** The three bands whose level is followed over time, Hz. */
export const MOVEMENT_BANDS = { low: [40, 250], mid: [250, 4000], high: [4000, 16000] } as const;

const round1 = (x: number) => Math.round(x * 10) / 10;
const finite = (x: number) => (Number.isFinite(x) ? x : 0);

/** Cycles per beat that name a note value, and the note. */
const NOTES: ReadonlyArray<[number, string]> = [
  [0.25, '1/1'], [0.5, '1/2'], [1, '1/4'], [2, '1/8'], [4, '1/16'], [8, '1/32'],
  [1.5, '1/4T'], [3, '1/8T'], [6, '1/16T'],
];

/** The note value a rate of `hz` cycles per second makes at `bpm`, when it is within 3% of one. */
export function noteOf(hz: number, bpm: number): string | undefined {
  if (!(hz > 0) || !(bpm > 0)) return undefined;
  const perBeat = hz / (bpm / 60);
  for (const [cycles, name] of NOTES) if (Math.abs(perBeat - cycles) <= cycles * 0.03) return name;
  return undefined;
}

/** How far under the loudest band level a band still counts in the frame-to-frame change, dB (so the reading does not depend on playback level). */
const CHANGE_RANGE_DB = 60;
/** How far under its own 95th-percentile level a band's envelope is floored, dB. */
const ENVELOPE_RANGE_DB = 48;
/** A band whose loudest envelope frame is more than this under the loudest band's loudest frame gives no modulation, dB. */
const BAND_RANGE_DB = 60;
/** An envelope whose loudest frame is under this, dB, is digital silence (a numeric floor only). */
const ENVELOPE_SILENT_DB = -110;
const BANDS = ['low', 'mid', 'high'] as const;

/** One band's envelope levels (20 log10 of the amplitude envelope), dB; null when the band lies above the Nyquist or the sound is too short. */
function levelsOf(channels: readonly Float32Array[], sampleRate: number, band: Modulation['band']): Float64Array | null {
  const [lo, hi] = MOVEMENT_BANDS[band];
  if (lo >= sampleRate / 2) return null;
  const envelope = bandEnvelope(channels, sampleRate, lo, hi);
  const n = envelope.length;
  if (n < 8) return null;
  const levels = new Float64Array(n);
  for (let i = 0; i < n; i++) levels[i] = finite(20 * Math.log10(Math.max(envelope[i], 1e-12)));
  return levels;
}

/** The mean absolute frame-to-frame change of the third-octave band levels, over bands within 60 dB of the loudest band level found. */
function changeOf(mid: Float32Array, sampleRate: number): number {
  const size = 4096;
  const hop = Math.max(1, Math.round(0.05 * sampleRate));
  if (mid.length < size + hop) return 0;
  const { power } = framesOf(mid, sampleRate, size, hop);
  const { edges } = bandEdges(3, sampleRate);
  const frames = power.map((frame) => Array.from(toBands(frame, sampleRate, size, edges), db));
  let loudest = -Infinity;
  for (const levels of frames) for (const v of levels) if (v > loudest) loudest = v;
  const gate = loudest - CHANGE_RANGE_DB;
  let sum = 0;
  let count = 0;
  for (let f = 1; f < frames.length; f++) {
    const levels = frames[f];
    const previous = frames[f - 1];
    for (let b = 0; b < levels.length; b++) {
      if (levels[b] > gate && previous[b] > gate) {
        sum += Math.abs(levels[b] - previous[b]);
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

/** The value below which `fraction` of the sorted `values` lie, interpolated. */
function percentile(sorted: Float64Array, fraction: number): number {
  const at = fraction * (sorted.length - 1);
  const i = Math.floor(at);
  const next = Math.min(sorted.length - 1, i + 1);
  return sorted[i] + (sorted[next] - sorted[i]) * (at - i);
}

/** The wobble of one band's level (its envelope `levels`), or null when it has no clear steady rate. */
function modulationOf(levels: Float64Array, loudestDb: number, sampleRate: number, band: Modulation['band'], tempoBpm: number | undefined): Modulation | null {
  const n = levels.length;
  const frame = Math.max(1, Math.round(0.02 * sampleRate));
  const rate = sampleRate / frame;
  const sorted = Float64Array.from(levels).sort();
  // Floored relative to the envelope's own level, so the reading is the same at any playback level
  if (sorted[n - 1] < ENVELOPE_SILENT_DB || sorted[n - 1] < loudestDb - BAND_RANGE_DB) return null;
  const floor = percentile(sorted, 0.95) - ENVELOPE_RANGE_DB;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    levels[i] = Math.max(floor, levels[i]);
    mean += levels[i];
  }
  mean /= n;
  sorted.set(levels);
  sorted.sort();
  const depth = percentile(sorted, 0.9) - percentile(sorted, 0.1);
  if (!(depth >= 2)) return null;

  let size = 1024;
  while (size < n * 8) size *= 2;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = (levels[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n));
  fftInPlace(re, im);
  const binHz = rate / size;
  const spectrum = new Float64Array(size / 2 + 1);
  for (let k = 0; k < spectrum.length; k++) spectrum[k] = re[k] * re[k] + im[k] * im[k];
  const first = Math.ceil(0.5 / binHz);
  const last = Math.min(spectrum.length - 2, Math.floor(20 / binHz));
  let total = 0;
  let peak = first;
  for (let k = first; k <= last; k++) {
    total += spectrum[k];
    if (spectrum[k] > spectrum[peak]) peak = k;
  }
  if (!(total > 0)) return null;
  // The peak's share is its Hann main lobe: two bins of the envelope's own resolution each side
  const reach = Math.ceil((2 * size) / n);
  let held = 0;
  for (let k = Math.max(first, peak - reach); k <= Math.min(last, peak + reach); k++) held += spectrum[k];
  if (held < 0.3 * total) return null;
  // Parabola through the peak and its neighbours for a rate finer than a bin
  const a = Math.log(spectrum[peak - 1] + 1e-30);
  const b = Math.log(spectrum[peak] + 1e-30);
  const c = Math.log(spectrum[peak + 1] + 1e-30);
  const denom = a - 2 * b + c;
  const shift = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const hz = round1((peak + shift) * binHz);
  const found: Modulation = { band, hz, depthDb: round1(depth) };
  const note = tempoBpm === undefined ? undefined : noteOf(hz, tempoBpm);
  if (note !== undefined) found.note = note;
  return found;
}

/** How `channels` change over their length; silent, empty and very short input give 0 and no modulations. */
export function movementOf(channels: readonly Float32Array[], sampleRate: number, tempoBpm?: number): Movement {
  if (channels.length === 0 || channels[0].length === 0) return { changeDb: 0, modulations: [] };
  const changeDb = round1(finite(changeOf(midOf(channels), sampleRate)));
  const modulations: Modulation[] = [];
  if (channels[0].length >= 2 * sampleRate) {
    const envelopes = BANDS.map((band) => levelsOf(channels, sampleRate, band));
    let loudestDb = -Infinity;
    for (const levels of envelopes) if (levels) for (const v of levels) if (v > loudestDb) loudestDb = v;
    BANDS.forEach((band, i) => {
      const levels = envelopes[i];
      const m = levels ? modulationOf(levels, loudestDb, sampleRate, band, tempoBpm) : null;
      if (m) modulations.push(m);
    });
  }
  return { changeDb, modulations };
}
