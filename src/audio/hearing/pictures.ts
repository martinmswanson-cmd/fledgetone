/**
 * The hearing report's pictures, for an agent that cannot hear to look at a sound: a spectrogram
 * (and the same of the stereo side signal), the level over time with its loudness, the spectrum,
 * the pitch classes over time, a close-up of a moment and the difference between two sounds. Each
 * is a Raster of one size with a title, labelled axes and a legend, and a sentence saying what it
 * shows. Levels are dB against a full-scale sine. Pure code on samples, no DOM, no Web Audio.
 */
import { fftInPlace } from '../fft';
import type { BandSpectrum } from '../mixAnalysis';
import { momentText } from './words';
import { DIVERGING, fillRect, GRID, HEAT, INK, line, PAPER, pixel, ramp, raster, setPixel, text, textWidth, type Raster, type Rgb } from './raster';

export type PictureKind = 'spectrogram' | 'stereo' | 'level' | 'spectrum' | 'chroma' | 'closeup' | 'difference';
export interface PictureInfo {
  name: string;
  kind: PictureKind;
  shows: string;
  fromSeconds: number;
  toSeconds: number;
  width: number;
  height: number;
}
export interface Picture extends PictureInfo {
  raster: Raster;
}
/** One bar of a song: its number, its start and end in seconds from the start of the audio, and its beats. */
export interface BarSpan {
  bar: number;
  start: number;
  end: number;
  beats: number;
}
/**
 * A time axis: its range (seconds from the start of the audio drawn), its labelled ticks, and (for a
 * bar axis) the first and last bar it covers. `offsetSeconds`: where the audio drawn starts in its
 * file, when it is a stretch of one; every time a person reads (a label, a title, `shows`, a
 * picture's own range) has it added, so they are times in the file.
 */
export interface TimeAxis {
  fromSeconds: number;
  toSeconds: number;
  ticks: Array<{ seconds: number; label: string }>;
  unit: 'bars' | 'seconds';
  fromBar?: number;
  toBar?: number;
  offsetSeconds?: number;
}

/** The size of every picture, and the plot's box inside it. */
export const PICTURE = { width: 1500, height: 700, left: 70, right: 1400, top: 34, bottom: 650 } as const;
/** The dB range of the spectrogram colours. */
export const LEVEL_DB = { floor: -90, top: 0 } as const;
/** The difference picture's colours run from this many dB less to this many more. */
export const DIFFERENCE_DB = 12;

const LOW_HZ = 20;
const DECADES = 3;
const COLUMNS = PICTURE.right - PICTURE.left;
const PLOT_H = PICTURE.bottom - PICTURE.top;
/** Text scale 2: 12 by 14 pixel cells. */
const BIG = 2;
const CELL_H = 14;
const TITLE_Y = 8;
const TICK_Y = PICTURE.bottom + 10;
const NAME_Y = PICTURE.bottom + 32;
const LEGEND_X = 1410;
const LEGEND_LABEL_X = 1426;
const SPECTROGRAM_SIZE = 8192;
/**
 * The spectrogram's window: at most half its frame (zero-padded to the frame), so a wobble of a 16th
 * note at 140 bpm still shows in time; shorter for a short range (an eighth of it, at least 512), so a
 * hit's start shows where it is.
 */
function spectrogramWindow(axis: Pick<TimeAxis, 'fromSeconds' | 'toSeconds'>, sampleRate: number): number {
  let length = 4096;
  while (length > 512 && length > (spanOf(axis) * sampleRate) / 8) length /= 2;
  return length;
}
const CLOSE_UP_SIZE = 512;
const CLOSE_UP_SECONDS = 0.15;
/** The shortest range an axis covers (one sample at 48000), so a range of nothing still has a scale. */
const MIN_SPAN = 1 / 48000;
const QUIET_DB = -80;

const WAVE: Rgb = [110, 170, 235];
const LOUDNESS: Rgb = [250, 170, 60];
const PEAK: Rgb = [255, 80, 80];
const MID_LINE: Rgb = [250, 205, 90];
const SIDE_LINE: Rgb = [150, 125, 70];
const OTHER_LINE: Rgb = [90, 200, 250];
const FAINT: Rgb = [150, 156, 168];

const FREQ_TICKS: Array<[number, string]> = [
  [20, '20'], [50, '50'], [100, '100'], [200, '200'], [500, '500'],
  [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k'], [20000, '20k'],
];
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ---------------------------------------------------------------- scales

/** The y of `hz` on a log scale from 20 Hz at `bottom` to 20 kHz at `top`. */
function yOfHzIn(hz: number, top: number, bottom: number): number {
  return bottom - (Math.log10(hz / LOW_HZ) / DECADES) * (bottom - top);
}
function hzOfYIn(y: number, top: number, bottom: number): number {
  return LOW_HZ * 10 ** (((bottom - y) / (bottom - top)) * DECADES);
}
/** The y of `hz` in the plot: a log scale, 20 Hz at the bottom to 20 kHz at the top. */
export function yOfHz(hz: number): number {
  return yOfHzIn(hz, PICTURE.top, PICTURE.bottom);
}
/** The frequency at `y` in the plot (the inverse of yOfHz). */
export function hzOfY(y: number): number {
  return hzOfYIn(y, PICTURE.top, PICTURE.bottom);
}
const spanOf = (axis: Pick<TimeAxis, 'fromSeconds' | 'toSeconds'>) => Math.max(MIN_SPAN, axis.toSeconds - axis.fromSeconds);
/** Where the axis's audio starts in its file (0 unless it is a stretch of one). */
const offsetOf = (axis: Pick<TimeAxis, 'offsetSeconds'>) => axis.offsetSeconds ?? 0;
/** The x of a time on the axis, left edge of the plot to its right. */
export function xOfSeconds(seconds: number, axis: Pick<TimeAxis, 'fromSeconds' | 'toSeconds'>): number {
  return PICTURE.left + ((seconds - axis.fromSeconds) / spanOf(axis)) * COLUMNS;
}

// ---------------------------------------------------------------- words for times

const pad2 = (n: number) => String(n).padStart(2, '0');
/** m:ss, with `decimals` places of seconds. */
function clock(seconds: number, decimals = 0): string {
  const s = Math.max(0, seconds);
  const scale = 10 ** decimals;
  const whole = Math.round(s * scale) / scale;
  const m = Math.floor(whole / 60);
  const rest = whole - m * 60;
  const sec = Math.floor(rest + 1e-9);
  const frac = decimals > 0 ? '.' + String(Math.round((rest - sec) * scale)).padStart(decimals, '0') : '';
  return `${m}:${pad2(sec)}${frac}`;
}
/** A range in words: `bars 9 to 16 (0:16.0 to 0:32.0)`, or `0:16.0 to 0:32.0` (times in the file, for a stretch of one). */
export function rangeText(axis: TimeAxis): string {
  const decimals = spanOf(axis) < 1 ? 3 : 1;
  const off = offsetOf(axis);
  const times = `${clock(axis.fromSeconds + off, decimals)} to ${clock(axis.toSeconds + off, decimals)}`;
  if (axis.fromBar === undefined || axis.toBar === undefined) return times;
  const bars = axis.fromBar === axis.toBar ? `bar ${axis.fromBar}` : `bars ${axis.fromBar} to ${axis.toBar}`;
  return `${bars} (${times})`;
}

// ---------------------------------------------------------------- axes

const TIME_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/**
 * The axis for a range: ticks at each bar start (thinned for long stretches) when bars are given, else
 * round times about ten across. With `offsetSeconds` (the audio is a stretch of a file starting there),
 * the ticks fall on round times of the file and are labelled with them.
 */
export function axisFor(fromSeconds: number, toSeconds: number, bars?: readonly BarSpan[], offsetSeconds = 0): TimeAxis {
  const from = Number.isFinite(fromSeconds) ? fromSeconds : 0;
  const to = Number.isFinite(toSeconds) && toSeconds > from ? toSeconds : from + MIN_SPAN;
  const eps = 1e-6;
  const off = Number.isFinite(offsetSeconds) && offsetSeconds > 0 ? offsetSeconds : 0;
  const offset = off > 0 ? { offsetSeconds: off } : {};
  if (bars && bars.length > 0) {
    const inside = bars.filter((b) => b.start < to - eps && b.end > from + eps);
    if (inside.length > 0) {
      const every = inside.length > 64 ? 8 : inside.length > 32 ? 4 : inside.length > 16 ? 2 : 1;
      const ticks = inside.filter((b) => b.start >= from - eps && (b.bar - 1) % every === 0).map((b) => ({ seconds: b.start, label: String(b.bar) }));
      return { fromSeconds: from, toSeconds: to, ticks, unit: 'bars', fromBar: inside[0].bar, toBar: inside[inside.length - 1].bar, ...offset };
    }
  }
  const span = to - from;
  const step = TIME_STEPS.find((s) => span / s <= 12) ?? 3600;
  const ticks: TimeAxis['ticks'] = [];
  for (let k = Math.ceil((from + off - eps) / step); k * step <= to + off + eps; k++) {
    const inFile = Math.round(k * step * 1e6) / 1e6;
    // (ms from the start of the audio; of a stretch of a file, the time in the file to the ms)
    const label = step < 0.1 ? (off > 0 ? clock(inFile, 3) : `${Math.round(inFile * 1000)} ms`) : clock(inFile, step < 1 ? 1 : 0);
    ticks.push({ seconds: Math.round((inFile - off) * 1e6) / 1e6, label: label === '0 ms' ? '0' : label });
  }
  return { fromSeconds: from, toSeconds: to, ticks, unit: 'seconds', ...offset };
}

/** A new picture: dark ground and its title. */
function blank(kind: PictureKind, name: string, title: string, shows: string, fromSeconds: number, toSeconds: number): Picture {
  const r = raster(PICTURE.width, PICTURE.height, PAPER);
  // a title too long for the line at scale 2 drops to scale 1 rather than run off the picture
  const scale = textWidth(title, BIG) <= LEGEND_X - PICTURE.left - 10 ? BIG : 1;
  text(r, title, PICTURE.left, TITLE_Y, INK, scale);
  return { name, kind, shows, fromSeconds, toSeconds, width: PICTURE.width, height: PICTURE.height, raster: r };
}

/** The plot's frame. */
function box(r: Raster, top: number = PICTURE.top, bottom: number = PICTURE.bottom): void {
  line(r, PICTURE.left - 1, top - 1, PICTURE.right, top - 1, GRID);
  line(r, PICTURE.left - 1, bottom, PICTURE.right, bottom, GRID);
  line(r, PICTURE.left - 1, top - 1, PICTURE.left - 1, bottom, GRID);
  line(r, PICTURE.right, top - 1, PICTURE.right, bottom, GRID);
}

/** A label right-aligned to the left of the plot, centred on `y`, kept inside the picture. */
function leftLabel(r: Raster, s: string, y: number, c: Rgb = INK): void {
  const w = textWidth(s, BIG) - BIG;
  text(r, s, Math.max(0, PICTURE.left - 8 - w), Math.round(y - CELL_H / 2), c, BIG);
}

// ---------------------------------------------------------------- stepped colour scales

/** Steps of the heat scale: 90 dB in 127 steps, about 0.7 dB each, so a picture keeps to 256 colours or fewer. */
export const HEAT_STEPS = 128;
/** Steps of the difference scale: an odd count, so no difference is the scale's own middle colour. */
export const DIVERGING_STEPS = 95;
const steps = (stops: readonly Rgb[], n: number): Rgb[] => Array.from({ length: n }, (_, i) => ramp(stops, i / (n - 1)));
const HEAT_TABLE = steps(HEAT, HEAT_STEPS);
const DIVERGING_TABLE = steps(DIVERGING, DIVERGING_STEPS);
/** The step of `table` nearest `t` (0 to 1, clamped; NaN gives the first). */
const stepOf = (table: readonly Rgb[], t: number): Rgb => table[t > 0 ? Math.min(table.length - 1, Math.round(t * (table.length - 1))) : 0];
/** The heat scale's colour at `t`, stepped. */
export const heatStep = (t: number): Rgb => stepOf(HEAT_TABLE, t);
/** The difference scale's colour at `t`, stepped (0.5 is its middle exactly). */
export const divergingStep = (t: number): Rgb => stepOf(DIVERGING_TABLE, t);
const sameColour = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** A dotted line (dots every 4 pixels), for a marker over the data. */
function dotted(r: Raster, x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
  if (y0 === y1) for (let x = Math.ceil(x0); x <= x1; x += 4) setPixel(r, x, Math.round(y0), c);
  else for (let y = Math.ceil(y0); y <= y1; y += 4) setPixel(r, Math.round(x0), y, c);
}
/**
 * A dotted grid line that stays under the data: a dot is drawn only where the pixel is the ground or
 * the bottom of the heat scale (nothing there), so it never stands in for a level.
 */
function gridDots(r: Raster, x0: number, y0: number, x1: number, y1: number): void {
  const dot = (x: number, y: number) => {
    const c = pixel(r, x, y);
    if (sameColour(c, PAPER) || sameColour(c, HEAT_TABLE[0])) setPixel(r, x, y, GRID);
  };
  if (y0 === y1) for (let x = Math.ceil(x0); x <= x1; x += 4) dot(x, Math.round(y0));
  else for (let y = Math.ceil(y0); y <= y1; y += 4) dot(Math.round(x0), y);
}

/** The frequency axis on the left from `top` to `bottom`: labels in Hz (k for kHz) with faint grid lines across the plot. */
function frequencyAxis(r: Raster, top: number, bottom: number, solid: boolean): void {
  for (const [hz, label] of FREQ_TICKS) {
    const y = Math.round(yOfHzIn(hz, top, bottom));
    const at = Math.min(bottom - 1, Math.max(top, y));
    if (solid) line(r, PICTURE.left, at, PICTURE.right - 1, at, GRID);
    else gridDots(r, PICTURE.left, at, PICTURE.right - 1, at);
    line(r, PICTURE.left - 6, at, PICTURE.left - 2, at, GRID);
    leftLabel(r, label, y);
  }
}

/** Ticks and labels under the plot, thinned (every 2nd, 4th...) until no two labels touch; faint grid lines up through the plot. */
function timeTicks(r: Raster, ticks: ReadonlyArray<{ x: number; label: string }>, top: number, grid: boolean, solid = false): void {
  const placed = (k: number) => ticks.filter((_, i) => i % k === 0).map((t) => {
    const w = textWidth(t.label, BIG) - BIG;
    const x = Math.max(0, Math.min(PICTURE.width - w, Math.round(t.x - w / 2)));
    return { ...t, w, lx: x };
  });
  let k = 1;
  let shown = placed(k);
  while (shown.length > 1 && shown.some((t, i) => i > 0 && shown[i - 1].lx + shown[i - 1].w + 10 > t.lx)) shown = placed((k *= 2));
  for (const t of ticks) {
    if (t.x < PICTURE.left - 0.5 || t.x > PICTURE.right + 0.5) continue;
    const x = Math.round(t.x);
    if (grid) {
      if (solid) line(r, x, top, x, PICTURE.bottom - 1, GRID);
      else gridDots(r, x, top, x, PICTURE.bottom - 1);
    }
  }
  for (const t of shown) {
    if (t.x < PICTURE.left - 0.5 || t.x > PICTURE.right + 0.5) continue;
    line(r, Math.round(t.x), PICTURE.bottom + 1, Math.round(t.x), PICTURE.bottom + 5, GRID);
    text(r, t.label, t.lx, TICK_Y, INK, BIG);
  }
}

/** The axis's ticks under the plot, and the axis's name under them. */
function timeAxis(r: Raster, axis: TimeAxis, top: number = PICTURE.top, solid = false): void {
  timeTicks(r, axis.ticks.map((t) => ({ x: xOfSeconds(t.seconds, axis), label: t.label })), top, true, solid);
  axisName(r, axis.unit === 'bars' ? 'bar' : axis.ticks.some((t) => t.label.endsWith('ms')) ? 'time (ms)' : 'time (minutes:seconds)');
}
function axisName(r: Raster, s: string): void {
  text(r, s, PICTURE.left, NAME_Y, FAINT, BIG);
}
/** A unit word in the top left corner, over the left-hand labels. */
function unitWord(r: Raster, s: string): void {
  text(r, s, 8, TITLE_Y, FAINT, BIG);
}

/** Keys at the bottom right: a short line of each colour and its name, right-aligned to the plot's edge. */
function keys(r: Raster, items: ReadonlyArray<{ colour: Rgb; label: string; dim?: boolean }>): void {
  let x = PICTURE.right;
  for (const item of [...items].reverse()) {
    const w = textWidth(item.label, BIG) - BIG;
    x -= w;
    text(r, item.label, x, NAME_Y, item.colour, BIG);
    x -= 34;
    fillRect(r, x, NAME_Y + 5, 26, 3, item.colour);
    x -= 24;
  }
}

/** A colour bar at the right from `top` to `bottom` (`colourAt(0)` at the bottom), with labels at the given fractions. */
function legend(r: Raster, top: number, bottom: number, colourAt: (t: number) => Rgb, labels: ReadonlyArray<[number, string]>): void {
  const h = bottom - top;
  for (let y = top; y < bottom; y++) fillRect(r, LEGEND_X, y, 10, 1, colourAt((bottom - 1 - y) / Math.max(1, h - 1)));
  line(r, LEGEND_X - 1, top - 1, LEGEND_X + 10, top - 1, GRID);
  line(r, LEGEND_X - 1, bottom, LEGEND_X + 10, bottom, GRID);
  for (const [t, label] of labels) {
    const y = Math.round(bottom - t * h);
    text(r, label, LEGEND_LABEL_X, Math.max(top - 7, Math.min(bottom - 7, y - CELL_H / 2)), INK, BIG);
  }
}
const dbLegend = (r: Raster, top: number = PICTURE.top, bottom: number = PICTURE.bottom) =>
  legend(r, top, bottom, heatStep, [[1, '0 dB'], [0.5, '-45'], [0, '-90 dB']]);

// ---------------------------------------------------------------- the spectrogram's maths

const windows = new Map<string, { w: Float64Array; norm: number }>();
/**
 * A periodic Hann window `length` long in the middle of a frame of `size` (zero beyond it), and the
 * factor that turns |X|^2 into power against a full-scale sine (4 / sum(w)^2).
 */
function hann(size: number, length: number): { w: Float64Array; norm: number } {
  const key = `${size}/${length}`;
  let got = windows.get(key);
  if (!got) {
    const w = new Float64Array(size);
    const offset = (size - length) / 2;
    let sum = 0;
    for (let i = 0; i < length; i++) sum += w[offset + i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
    got = { w, norm: 4 / (sum * sum) };
    windows.set(key, got);
  }
  return got;
}

/**
 * How each pixel row from `top` to `bottom` reads a spectrum of `size` bins: where a row spans two
 * or more bins, the loudest of them (so a narrow peak never falls between rows); where it spans less,
 * the power at the row's frequency by interpolation between the two bins round it. `lo` -1: the row
 * is above half the sample rate.
 */
function rowReading(size: number, sampleRate: number, top: number, bottom: number): { lo: Int32Array; hi: Int32Array; frac: Float64Array } {
  const rows = bottom - top;
  const lo = new Int32Array(rows), hi = new Int32Array(rows), frac = new Float64Array(rows);
  const perBin = size / sampleRate;
  const last = size / 2;
  for (let i = 0; i < rows; i++) {
    const y = top + i;
    const centre = hzOfYIn(y + 0.5, top, bottom);
    if (centre > sampleRate / 2) { lo[i] = -1; continue; }
    const a = Math.ceil(hzOfYIn(y + 1, top, bottom) * perBin);
    const b = Math.min(last, Math.floor(hzOfYIn(y, top, bottom) * perBin));
    if (b - a >= 1) { lo[i] = a; hi[i] = b; frac[i] = -1; continue; }
    const k = Math.min(last, centre * perBin);
    lo[i] = Math.min(last - 1, Math.floor(k)); hi[i] = lo[i] + 1; frac[i] = k - lo[i];
  }
  return { lo, hi, frac };
}
/** Row i's power from a spectrum, by rowReading's rule; -1 above half the sample rate. */
function rowPower(p: Float64Array, reading: ReturnType<typeof rowReading>, i: number): number {
  const lo = reading.lo[i];
  if (lo < 0) return -1;
  const f = reading.frac[i];
  if (f >= 0) return p[lo] + (p[reading.hi[i]] - p[lo]) * f;
  let best = 0;
  for (let k = lo; k <= reading.hi[i]; k++) if (p[k] > best) best = p[k];
  return best;
}

/**
 * The power spectrum (against a full-scale sine) of each pixel column of `axis`, for one signal or two
 * at once (two real signals ride one complex transform, as its real and imaginary parts). A column
 * is one frame centred on its time, or, when it spans more samples than half a window, the mean of
 * frames hopped by half a window across its span, so every sample reaches the picture. The window is
 * `length` long in a frame of `size` (zero-padded: finer bins than the window alone). Outside the
 * signal counts as silence. `each` gets the column and its spectra (reused between calls).
 */
function eachColumn(
  a: Float32Array,
  b: Float32Array | null,
  sampleRate: number,
  axis: Pick<TimeAxis, 'fromSeconds' | 'toSeconds'>,
  size: number,
  length: number,
  each: (column: number, pa: Float64Array, pb: Float64Array | null) => void,
): void {
  const { w, norm } = hann(size, length);
  const first = (size - length) / 2, end = first + length;
  const re = new Float64Array(size), im = new Float64Array(size);
  const bins = size / 2 + 1;
  const from = axis.fromSeconds * sampleRate;
  const span = (spanOf(axis) * sampleRate) / COLUMNS;
  const frames = span > length / 2 ? Math.ceil(span / (length / 2)) : 1;
  const k0 = norm / frames;
  /** The windowed frame of `x` starting at `start` into `into`; false when it is all zero. */
  const load = (into: Float64Array, x: Float32Array | null, start: number): boolean => {
    into.fill(0);
    if (!x) return false;
    let any = false;
    const lo = Math.max(first, -start), hi = Math.min(end, x.length - start);
    for (let i = lo; i < hi; i++) {
      const v = x[start + i];
      into[i] = v * w[i];
      if (v !== 0) any = true;
    }
    return any;
  };
  /** The two real frames riding in re and im, apart: each one's power added to its spectrum. */
  const split = (pa: Float64Array, pb: Float64Array) => {
    for (let k = 0; k < bins; k++) {
      const n = (size - k) % size;
      const ar = (re[k] + re[n]) / 2, ai = (im[k] - im[n]) / 2;
      const br = (im[k] + im[n]) / 2, bi = (re[n] - re[k]) / 2;
      pa[k] += (ar * ar + ai * ai) * k0;
      pb[k] += (br * br + bi * bi) * k0;
    }
  };
  const startOf = (c: number, j: number) => Math.round(from + (c + (j + 0.5) / frames) * span) - size / 2;

  if (b) {
    // two signals: each frame of both in one transform
    const pa = new Float64Array(bins), pb = new Float64Array(bins);
    for (let c = 0; c < COLUMNS; c++) {
      pa.fill(0);
      pb.fill(0);
      for (let j = 0; j < frames; j++) {
        const start = startOf(c, j);
        const anyA = load(re, a, start), anyB = load(im, b, start);
        if (!anyA && !anyB) continue;
        fftInPlace(re, im);
        split(pa, pb);
      }
      each(c, pa, pb);
    }
    return;
  }
  // one signal: its frames two at a time in one transform (a column's next frame, or the next column's)
  const spectra = [new Float64Array(bins), new Float64Array(bins)];
  const jobs = COLUMNS * frames;
  for (let q = 0; q < jobs; q += 2) {
    const c1 = Math.floor(q / frames), j1 = q % frames;
    const second = q + 1 < jobs;
    const c2 = Math.floor((q + 1) / frames), j2 = (q + 1) % frames;
    const any1 = load(re, a, startOf(c1, j1));
    const any2 = second && load(im, a, startOf(c2, j2));
    if (!second) im.fill(0);
    if (any1 || any2) {
      fftInPlace(re, im);
      if (c1 === c2) split(spectra[c1 & 1], spectra[c1 & 1]);
      else split(spectra[c1 & 1], spectra[c2 & 1]);
    }
    if (j1 === frames - 1) { each(c1, spectra[c1 & 1], null); spectra[c1 & 1].fill(0); }
    if (second && j2 === frames - 1) { each(c2, spectra[c2 & 1], null); spectra[c2 & 1].fill(0); }
  }
}

const toDb = (p: number) => 10 * Math.log10(p > 1e-30 ? p : 1e-30);
const heatOf = (db: number) => heatStep((db - LEVEL_DB.floor) / (LEVEL_DB.top - LEVEL_DB.floor));

/** Paint one column's spectrum into rows `top` to `bottom` of the plot, coloured by level; above half the sample rate, ground. */
function paintColumn(r: Raster, x: number, p: Float64Array, reading: ReturnType<typeof rowReading>, top: number): void {
  for (let i = 0; i < reading.lo.length; i++) {
    const power = rowPower(p, reading, i);
    setPixel(r, x, top + i, power < 0 ? PAPER : heatOf(toDb(power)));
  }
}

function frequencyFrame(p: Picture, axis: TimeAxis): void {
  frequencyAxis(p.raster, PICTURE.top, PICTURE.bottom, false);
  timeAxis(p.raster, axis);
  unitWord(p.raster, 'Hz');
  box(p.raster);
}

const nyquistWords = (sampleRate: number) => (sampleRate / 2 < 20000 ? ` Above ${hzWords(sampleRate / 2)} (half the sample rate) it is blank.` : '');
const hzWords = (hz: number) => (hz >= 1000 ? `${Math.round(hz / 100) / 10} kHz` : `${Math.round(hz)} Hz`);

function spectrogramShows(axis: TimeAxis, sampleRate: number, of: string): string {
  const ms = Math.round((spectrogramWindow(axis, sampleRate) / sampleRate) * 1000);
  return `Frequency (log scale, 20 Hz at the bottom to 20 kHz at the top) against time over ${rangeText(axis)} ${of}, from windows of ${ms} ms; colour is level in dB against a full-scale sine, from dark at -90 dB through blue, purple, red and orange to pale yellow at 0 dB.${nyquistWords(sampleRate)}`;
}

/** A spectrogram of `x` over `axis`: one column a pixel (frames of 8192), rows on the log frequency scale, coloured by dB. */
export function spectrogramPicture(x: Float32Array, sampleRate: number, axis: TimeAxis, opts: { name: string; title: string; kind?: 'spectrogram' | 'stereo' }): Picture {
  return spectrogramPictures(x, null, sampleRate, axis, opts, null)[0];
}

/**
 * The spectrograms of one signal, or of two (the middle and the side signal of the same range) from
 * one transform a frame. `bOpts` names the second picture.
 */
export function spectrogramPictures(
  a: Float32Array,
  b: Float32Array | null,
  sampleRate: number,
  axis: TimeAxis,
  aOpts: { name: string; title: string; kind?: 'spectrogram' | 'stereo' },
  bOpts: { name: string; title: string; kind?: 'spectrogram' | 'stereo' } | null,
): Picture[] {
  const make = (o: { name: string; title: string; kind?: 'spectrogram' | 'stereo' }) => {
    const stereo = o.kind === 'stereo';
    const title = stereo && !/side/i.test(o.title) ? `Stereo side signal: ${o.title}` : o.title;
    const of = stereo ? 'of the side signal (left minus right, halved: what differs between the channels, so sound panned or wide shows and sound in the centre does not)' : 'of the sound';
    return blank(stereo ? 'stereo' : 'spectrogram', o.name, title, spectrogramShows(axis, sampleRate, of), axis.fromSeconds + offsetOf(axis), axis.toSeconds + offsetOf(axis));
  };
  const pa = make(aOpts);
  const pb = b && bOpts ? make(bOpts) : null;
  const reading = rowReading(SPECTROGRAM_SIZE, sampleRate, PICTURE.top, PICTURE.bottom);
  eachColumn(a, pb ? b : null, sampleRate, axis, SPECTROGRAM_SIZE, spectrogramWindow(axis, sampleRate), (c, sa, sb) => {
    paintColumn(pa.raster, PICTURE.left + c, sa, reading, PICTURE.top);
    if (pb && sb) paintColumn(pb.raster, PICTURE.left + c, sb, reading, PICTURE.top);
  });
  for (const p of pb ? [pa, pb] : [pa]) {
    frequencyFrame(p, axis);
    dbLegend(p.raster);
  }
  return pb ? [pa, pb] : [pa];
}

// ---------------------------------------------------------------- level

/** The sample span [start, end) of column c (at least one sample). */
function columnSamples(axis: Pick<TimeAxis, 'fromSeconds' | 'toSeconds'>, sampleRate: number, c: number): [number, number] {
  const from = axis.fromSeconds * sampleRate;
  const span = (spanOf(axis) * sampleRate) / COLUMNS;
  const start = Math.floor(from + c * span);
  return [start, Math.max(start + 1, Math.floor(from + (c + 1) * span))];
}

/**
 * A waveform of `x` in a lane centred on `centre`, `half` pixels for full scale: per column the lowest
 * and highest sample (joined to the column before, so a slow wave stays one line).
 */
function waveform(r: Raster, x: Float32Array, sampleRate: number, axis: Pick<TimeAxis, 'fromSeconds' | 'toSeconds'>, centre: number, half: number): void {
  const yOf = (v: number) => centre - Math.max(-1, Math.min(1, v)) * half;
  let last: number | null = null;
  for (let c = 0; c < COLUMNS; c++) {
    const [s0, s1] = columnSamples(axis, sampleRate, c);
    const a = Math.max(0, s0), b = Math.min(x.length, s1);
    if (a >= b) { last = null; continue; }
    let lo = x[a], hi = x[a];
    for (let i = a + 1; i < b; i++) { const v = x[i]; if (v < lo) lo = v; else if (v > hi) hi = v; }
    if (last !== null) { if (last < lo) lo = last; if (last > hi) hi = last; }
    last = x[b - 1];
    line(r, PICTURE.left + c, yOf(hi), PICTURE.left + c, yOf(lo), WAVE);
  }
}

/** The lanes for one or two channels between `top` and `bottom`: centre and full-scale half height. */
function lanes(count: number, top: number, bottom: number): Array<{ centre: number; half: number }> {
  const n = Math.max(1, Math.min(2, count));
  const h = (bottom - top) / n;
  return Array.from({ length: n }, (_, i) => ({ centre: top + h * (i + 0.5), half: h / 2 - 16 }));
}
function laneLabels(r: Raster, lane: { centre: number; half: number }, name: string | null): void {
  line(r, PICTURE.left, Math.round(lane.centre), PICTURE.right - 1, Math.round(lane.centre), GRID);
  leftLabel(r, '+1', lane.centre - lane.half);
  leftLabel(r, name ?? '0', lane.centre, name ? WAVE : INK);
  leftLabel(r, '-1', lane.centre + lane.half);
}

/** Where the highest sample lies (the true peak sits beside it), and the true peak there, from 4x oversampling of the samples round it. */
function peakOf(channels: readonly Float32Array[], from: number, to: number): { at: number; db: number } | null {
  let best = 0, at = -1, ch = 0;
  channels.forEach((x, k) => {
    for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) {
      const v = Math.abs(x[i]);
      if (v > best) { best = v; at = i; ch = k; }
    }
  });
  if (at < 0) return null;
  // a 4x band-limited reading of the 32 samples each side (a windowed sinc): what a converter would reach between them
  const x = channels[ch];
  let peak = best;
  for (let i = at - 2; i <= at + 1; i++) {
    for (let q = 1; q < 4; q++) {
      const t = i + q / 4;
      let sum = 0;
      for (let n = Math.floor(t) - 31; n <= Math.floor(t) + 32; n++) {
        if (n < 0 || n >= x.length) continue;
        const d = t - n;
        const sinc = Math.sin(Math.PI * d) / (Math.PI * d);
        const win = 0.5 + 0.5 * Math.cos((Math.PI * d) / 33);
        sum += x[n] * sinc * win;
      }
      peak = Math.max(peak, Math.abs(sum));
    }
  }
  return { at, db: 20 * Math.log10(peak) };
}

/**
 * The level over time: per column the lowest and highest sample of the first channel (above) and of
 * the second (below), or of one channel centred; each second's loudness as a line on a right-hand
 * scale from -40 to 0 LUFS; and a mark where the true peak lies.
 */
export function levelPicture(channels: readonly Float32Array[], sampleRate: number, axis: TimeAxis, loudness: ReadonlyArray<number | null>, name: string): Picture {
  const stereo = channels.length >= 2;
  const from = Math.floor(axis.fromSeconds * sampleRate), to = Math.ceil(axis.toSeconds * sampleRate);
  const peak = peakOf(channels.slice(0, 2), from, to);
  const peakWords = peak ? `; true peak ${peak.db.toFixed(1)} dBTP at ${momentText(peak.at / sampleRate + offsetOf(axis))}` : '';
  const title = `Level${stereo ? ', left above and right below' : ''}: ${rangeText(axis)}`;
  const shows = `The waveform${stereo ? 's of the left channel (upper half) and the right (lower half)' : ''}, from -1 to +1 full scale, against time over ${rangeText(axis)}; the orange line is each second's loudness on the right-hand scale (-40 to 0 LUFS) and the red mark is where the true peak lies${peakWords}.`;
  const p = blank('level', name, title, shows, axis.fromSeconds + offsetOf(axis), axis.toSeconds + offsetOf(axis));
  const r = p.raster;
  const ls = lanes(stereo ? 2 : 1, PICTURE.top, PICTURE.bottom);
  ls.forEach((lane, i) => laneLabels(r, lane, stereo ? (i === 0 ? 'L' : 'R') : null));
  timeAxis(r, axis, PICTURE.top, true);
  ls.forEach((lane, i) => { if (channels[i]) waveform(r, channels[i], sampleRate, axis, lane.centre, lane.half); });

  // the loudness scale at the right, and each second's loudness through the second's middle
  const yOfLufs = (l: number) => PICTURE.bottom - 1 - (Math.max(-40, Math.min(0, l)) + 40) / 40 * (PLOT_H - 1);
  for (const l of [0, -10, -20, -30, -40]) {
    const y = Math.round(yOfLufs(l));
    line(r, PICTURE.right + 1, y, PICTURE.right + 5, y, LOUDNESS);
    text(r, String(l), PICTURE.right + 10, Math.max(PICTURE.top - 7, Math.min(PICTURE.bottom - 7, y - CELL_H / 2)), LOUDNESS, BIG);
  }
  text(r, 'LUFS', PICTURE.right + 10, TITLE_Y, LOUDNESS, BIG);
  let prev: [number, number] | null = null;
  let drawn = false;
  loudness.forEach((l, i) => {
    if (l === null || !Number.isFinite(l)) { prev = null; return; }
    const pt: [number, number] = [xOfSeconds(i + 0.5, axis), yOfLufs(l)];
    drawn = true;
    if (prev) { line(r, prev[0], prev[1], pt[0], pt[1], LOUDNESS); line(r, prev[0], prev[1] - 1, pt[0], pt[1] - 1, LOUDNESS); }
    else if (pt[0] >= PICTURE.left && pt[0] < PICTURE.right) fillRect(r, pt[0] - 1, pt[1] - 1, 3, 3, LOUDNESS);
    prev = pt;
  });
  if (peak) {
    const x = Math.round(xOfSeconds(peak.at / sampleRate, axis));
    dotted(r, x, PICTURE.top, x, PICTURE.bottom - 1, PEAK);
    for (let k = 0; k < 6; k++) line(r, x - k, PICTURE.top - 2 - k, x + k, PICTURE.top - 2 - k, PEAK);
  }
  keys(r, [...(drawn ? [{ colour: LOUDNESS, label: 'loudness (LUFS)' }] : []), ...(peak ? [{ colour: PEAK, label: `true peak ${peak.db.toFixed(1)} dBTP` }] : [])]);
  box(r);
  return p;
}

// ---------------------------------------------------------------- spectrum

const SPECTRUM_TICKS: Array<[number, string]> = [
  [20, '20 Hz'], [50, '50 Hz'], [100, '100 Hz'], [200, '200 Hz'], [500, '500 Hz'],
  [1000, '1 kHz'], [2000, '2 kHz'], [5000, '5 kHz'], [10000, '10 kHz'], [20000, '20 kHz'],
];

/** Level against frequency: `a`'s middle as a solid line and its sides dimmer, and `other`'s total in another colour, both named in a key. */
export function spectrumPicture(a: BandSpectrum, aLabel: string, other: { spectrum: BandSpectrum; label: string } | null, name: string, range?: { fromSeconds: number; toSeconds: number }): Picture {
  const from = range?.fromSeconds ?? 0, to = range?.toSeconds ?? 0;
  const span = range ? ` over ${rangeText(axisFor(from, to))}` : '';
  const title = `Spectrum of ${aLabel}${other ? ` against ${other.label}` : ''}${range ? `: ${rangeText(axisFor(from, to))}` : ''}`;
  const hasSide = a.side.some((v) => v > -150);
  const shows = `Level (dB per sixth of an octave; a full-scale sine reads about -3 dB) against frequency (log scale, 20 Hz to 20 kHz) of ${aLabel}${span}: the gold line is the middle (left plus right)${hasSide ? ', the dim line the sides (left minus right)' : ''}${other ? `, and the blue line is ${other.label}, middle and sides together` : ''}.`;
  const p = blank('spectrum', name, title, shows, from, to);
  const r = p.raster;
  const xOfHz = (hz: number) => PICTURE.left + (Math.log10(hz / LOW_HZ) / DECADES) * COLUMNS;
  const yOfDb = (db: number) => PICTURE.top + ((LEVEL_DB.top - db) / (LEVEL_DB.top - LEVEL_DB.floor)) * (PLOT_H - 1);
  for (let db = LEVEL_DB.top; db >= LEVEL_DB.floor; db -= 10) {
    const y = Math.round(yOfDb(db));
    line(r, PICTURE.left, y, PICTURE.right - 1, y, GRID);
    leftLabel(r, String(db), y);
  }
  unitWord(r, 'dB');
  timeTicks(r, SPECTRUM_TICKS.map(([hz, label]) => ({ x: xOfHz(hz), label })), PICTURE.top, true, true);
  axisName(r, 'frequency');
  const curve = (s: BandSpectrum, levels: readonly number[], c: Rgb, thick: boolean) => {
    let prev: [number, number] | null = null;
    s.freqs.forEach((hz, i) => {
      const v = levels[i];
      if (!(Number.isFinite(v) && v > -150 && hz >= LOW_HZ * 0.999 && hz <= 20000 * 1.001)) { prev = null; return; }
      const pt: [number, number] = [xOfHz(hz), Math.min(PICTURE.bottom - 1, Math.max(PICTURE.top, yOfDb(v)))];
      if (prev) { line(r, prev[0], prev[1], pt[0], pt[1], c); if (thick) line(r, prev[0], prev[1] + 1, pt[0], pt[1] + 1, c); }
      prev = pt;
    });
  };
  const total = (s: BandSpectrum) => s.mid.map((m, i) => { const sd = s.side[i]; return 10 * Math.log10(10 ** (m / 10) + (Number.isFinite(sd) ? 10 ** (sd / 10) : 0)); });
  if (hasSide) curve(a, a.side, SIDE_LINE, false);
  if (other) curve(other.spectrum, total(other.spectrum), OTHER_LINE, true);
  curve(a, a.mid, MID_LINE, true);
  keys(r, [
    { colour: MID_LINE, label: `${aLabel}, middle` },
    ...(hasSide ? [{ colour: SIDE_LINE, label: `${aLabel}, sides` }] : []),
    ...(other ? [{ colour: OTHER_LINE, label: `${other.label}, total` }] : []),
  ]);
  box(r);
  return p;
}

// ---------------------------------------------------------------- chroma

/** The pitch classes over time: twelve rows, C at the bottom, each step's strength of each as brightness. */
export function chromaPicture(chroma: readonly number[][], stepSeconds: number, axis: TimeAxis, name: string): Picture {
  const title = `Notes (pitch classes): ${rangeText(axis)}`;
  const shows = `The twelve pitch classes (C at the bottom to B at the top, any octave) against time over ${rangeText(axis)}, one column every ${stepSeconds} s; brightness is each note's strength in that step against the strongest note of the step (pale yellow 1, dark 0).`;
  const p = blank('chroma', name, title, shows, axis.fromSeconds + offsetOf(axis), axis.toSeconds + offsetOf(axis));
  const r = p.raster;
  const rowH = PLOT_H / 12;
  chroma.forEach((step, i) => {
    const x0 = Math.max(PICTURE.left, Math.round(xOfSeconds(i * stepSeconds, axis)));
    const x1 = Math.min(PICTURE.right, Math.round(xOfSeconds((i + 1) * stepSeconds, axis)));
    if (x1 <= x0) return;
    for (let n = 0; n < 12; n++) {
      const y0 = Math.round(PICTURE.bottom - (n + 1) * rowH), y1 = Math.round(PICTURE.bottom - n * rowH);
      fillRect(r, x0, y0, x1 - x0, y1 - y0, heatStep(step[n] ?? 0));
    }
  });
  for (let n = 0; n < 12; n++) {
    leftLabel(r, NOTE_NAMES[n], PICTURE.bottom - (n + 0.5) * rowH);
    if (n > 0) gridDots(r, PICTURE.left, Math.round(PICTURE.bottom - n * rowH), PICTURE.right - 1, Math.round(PICTURE.bottom - n * rowH));
  }
  timeAxis(r, axis);
  legend(r, PICTURE.top, PICTURE.bottom, heatStep, [[1, '1'], [0.5, '0.5'], [0, '0']]);
  box(r);
  return p;
}

// ---------------------------------------------------------------- close-up

/**
 * The 150 ms round `atSeconds` (from the start of the audio, clamped to it): the waveform in the top
 * third, a fine spectrogram (frames of 512) below, ms from the moment. `offsetSeconds`: where the audio
 * starts in its file, added to the times in the title, `shows` and the picture's range.
 */
export function closeUpPicture(channels: readonly Float32Array[], sampleRate: number, atSeconds: number, where: string, name: string, offsetSeconds = 0): Picture {
  const length = channels[0]?.length ?? 0;
  const seconds = length / sampleRate;
  const span = Math.max(MIN_SPAN, Math.min(CLOSE_UP_SECONDS, seconds));
  const at = Math.max(0, Math.min(seconds, Number.isFinite(atSeconds) ? atSeconds : 0));
  const from = Math.max(0, Math.min(seconds - span, at - span / 2));
  const range = { fromSeconds: from, toSeconds: from + span };
  const stereo = channels.length >= 2;
  const off = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  const title = `Close-up of ${where}: ${clock(range.fromSeconds + off, 3)} to ${clock(range.toSeconds + off, 3)}`;
  const shows = `The ${Math.round(span * 1000)} ms round ${momentText(at + off)} (${where}), time in ms from that moment (the faint line): the waveform${stereo ? 's (left, then right)' : ''} from -1 to +1 at the top, and below it frequency (log scale, 20 Hz to 20 kHz) coloured by level in dB, dark -90 to pale yellow 0, from frames of ${CLOSE_UP_SIZE} samples (fine in time, coarse in pitch).${nyquistWords(sampleRate)}`;
  const p = blank('closeup', name, title, shows, range.fromSeconds + off, range.toSeconds + off);
  const r = p.raster;
  const waveBottom = PICTURE.top + Math.round(PLOT_H / 3);
  const specTop = waveBottom + 30;
  // the waveform lanes
  const ls = lanes(stereo ? 2 : 1, PICTURE.top, waveBottom);
  ls.forEach((lane, i) => laneLabels(r, lane, stereo ? (i === 0 ? 'L' : 'R') : null));
  ls.forEach((lane, i) => { if (channels[i]) waveform(r, channels[i], sampleRate, range, lane.centre, lane.half); });
  // the spectrogram of the middle
  const mid = channels.length >= 2 ? middleOf(channels[0], channels[1]) : (channels[0] ?? new Float32Array(0));
  const reading = rowReading(CLOSE_UP_SIZE, sampleRate, specTop, PICTURE.bottom);
  eachColumn(mid, null, sampleRate, range, CLOSE_UP_SIZE, CLOSE_UP_SIZE, (c, pa) => paintColumn(r, PICTURE.left + c, pa, reading, specTop));
  frequencyAxis(r, specTop, PICTURE.bottom, false);
  // ticks every 25 ms (or finer for a shorter stretch) from the moment
  const relFrom = range.fromSeconds - at, relTo = range.toSeconds - at;
  const step = TIME_STEPS.find((s) => (relTo - relFrom) / s <= 8) ?? 0.025;
  const ticks: Array<{ x: number; label: string }> = [];
  for (let k = Math.ceil(relFrom / step - 1e-9); k * step <= relTo + 1e-9; k++) {
    const ms = Math.round(k * step * 1000);
    ticks.push({ x: xOfSeconds(at + k * step, range), label: ms === 0 ? '0' : `${ms > 0 ? '+' : ''}${ms} ms` });
  }
  timeTicks(r, ticks, PICTURE.top, true);
  axisName(r, 'ms from the moment');
  const x = Math.round(xOfSeconds(at, range));
  dotted(r, x, PICTURE.top, x, PICTURE.bottom - 1, INK);
  text(r, 'Hz', 8, waveBottom + 4, FAINT, BIG);
  dbLegend(r, specTop, PICTURE.bottom);
  box(r, PICTURE.top, waveBottom);
  box(r, specTop, PICTURE.bottom);
  return p;
}

// ---------------------------------------------------------------- difference

/**
 * The difference between two sounds over `axis`: both spectrograms as above, the second minus the
 * first in dB coloured from blue (less) through near-black to red (more), up to DIFFERENCE_DB each
 * way; where both are under -80 dB, ground. Sounds of different lengths are compared over the shorter.
 */
export function differencePicture(before: Float32Array, after: Float32Array, sampleRate: number, axis: TimeAxis, name: string): Picture {
  const n = Math.min(before.length, after.length);
  const a = before.subarray(0, n), b = after.subarray(0, n);
  const title = `Difference, second sound minus first: ${rangeText(axis)}`;
  const shows = `Frequency (log scale, 20 Hz to 20 kHz) against time over ${rangeText(axis)}; colour is the second sound's level minus the first's in dB, from -${DIFFERENCE_DB} to +${DIFFERENCE_DB}. Red is where the second is louder than the first, blue where it is quieter, near-black where they match, and blank where both are under ${QUIET_DB} dB.${nyquistWords(sampleRate)}`;
  const p = blank('difference', name, title, shows, axis.fromSeconds + offsetOf(axis), axis.toSeconds + offsetOf(axis));
  const r = p.raster;
  const reading = rowReading(SPECTROGRAM_SIZE, sampleRate, PICTURE.top, PICTURE.bottom);
  eachColumn(a, b, sampleRate, axis, SPECTROGRAM_SIZE, spectrogramWindow(axis, sampleRate), (c, pa, pb) => {
    if (!pb) return;
    for (let i = 0; i < reading.lo.length; i++) {
      const p0 = rowPower(pa, reading, i), p1 = rowPower(pb, reading, i);
      const y = PICTURE.top + i;
      if (p0 < 0) { setPixel(r, PICTURE.left + c, y, PAPER); continue; }
      const d0 = toDb(p0), d1 = toDb(p1);
      setPixel(r, PICTURE.left + c, y, d0 < QUIET_DB && d1 < QUIET_DB ? PAPER : divergingStep(0.5 + (d1 - d0) / (2 * DIFFERENCE_DB)));
    }
  });
  frequencyFrame(p, axis);
  legend(r, PICTURE.top, PICTURE.bottom, divergingStep, [[1, `+${DIFFERENCE_DB} dB`], [0.5, '0'], [0, `-${DIFFERENCE_DB} dB`]]);
  text(r, 'more', LEGEND_LABEL_X, PICTURE.top + 12, INK, BIG);
  text(r, 'less', LEGEND_LABEL_X, PICTURE.bottom - 7 - CELL_H - 6, INK, BIG);
  return p;
}

/** (left + right) / 2. */
export function middleOf(l: Float32Array, r: Float32Array): Float32Array {
  const n = Math.min(l.length, r.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (l[i] + r[i]) / 2;
  return out;
}
/** (left - right) / 2. */
export function sideOf(l: Float32Array, r: Float32Array): Float32Array {
  const n = Math.min(l.length, r.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (l[i] - r[i]) / 2;
  return out;
}
