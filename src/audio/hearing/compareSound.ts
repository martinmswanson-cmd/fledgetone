/**
 * Comparing two sound reports of the hearing work, level-matched (the whole spectrum's level is taken
 * out of each before tone is compared), as a list of differences, largest first; and making a report
 * of part of a saved one, from its "along" grid alone. Pure maths on reports, no Web Audio, so Node can test it.
 */
import { levelBetween, REGIONS, sumDb, totalBands } from '../mixAnalysis';
import type { BandSpectrum } from '../mixAnalysis';
import { freqText, one, soundWords, two } from './words';
import type { Dynamics, HearingGroup, SoundReport, Stereo, Tone } from './types';

export interface SoundDifference {
  group: HearingGroup;
  measure: string;
  a: number | null;
  b: number | null;
  change: number;
  size: number;
  words: string;
}

export interface SoundComparison {
  levelDb: number | null;
  differences: SoundDifference[];
  spectrum: { freqs: number[]; changeDb: number[] };
  skipped: HearingGroup[];
  notes: string[];
}

const GROUPS: HearingGroup[] = ['tone', 'texture', 'movement', 'dynamics', 'attack', 'stereo'];
const FLOOR_DB = -200;
const SILENT_DB = -150;
const WIDTH_FLOOR_DB = -60;
const ONSETS_FLOOR = 0.1;
/** Band and region levels are floored this far under their report's whole, dB: under it is rounding noise, and not a tone. */
const LEVEL_FLOOR_DB = -70;

/** `x` to `places` decimals, rounding away from zero on a tie so that a change and its negation round alike, and never -0. */
function round(x: number, places: number): number {
  const k = 10 ** places;
  const r = (Math.sign(x) * Math.round(Math.abs(x) * k)) / k;
  return r === 0 ? 0 : r;
}

/** How a measure's numbers are written: how its readings and its change are rounded, and its reading as text. */
interface Style {
  places: number;
  changePlaces: number;
  text?: (x: number) => string;
}
const DB: Style = { places: 1, changePlaces: 1 };
const LU: Style = { places: 1, changePlaces: 1 };
const PLAIN2: Style = { places: 2, changePlaces: 2 };

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const finiteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const minutes = (seconds: number) => {
  const whole = Math.round(Math.max(0, seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

function reading(x: number, s: Style, kind: 'dB' | 'LUFS' | 'plain' | 'Hz' | 'ms' | 'rate'): string {
  if (s.text) return s.text(x);
  const n = s.places === 1 ? one(x) : two(x);
  return kind === 'dB' || kind === 'LUFS' || kind === 'ms' ? `${n} ${kind}` : n;
}

interface Row {
  group: HearingGroup;
  measure: string;
  a: number;
  b: number;
  /** b against a, in the measure's own change; defaults to b - a. */
  change?: number;
  step: number;
  style: Style;
  kind: 'dB' | 'LUFS' | 'plain' | 'Hz' | 'ms' | 'rate';
  /** The unit written after the signed change. */
  changeUnit: string;
}

function differenceOf(row: Row): SoundDifference | null {
  const change = row.change ?? row.b - row.a;
  if (!Number.isFinite(change) || !(Math.abs(change) / row.step >= 1)) return null;
  const size = Math.abs(change) / row.step;
  const a = round(row.a, row.style.places);
  const b = round(row.b, row.style.places);
  const rounded = round(change, row.style.changePlaces);
  const signedChange = `${rounded >= 0 ? '+' : '-'}${(row.style.changePlaces === 1 ? one : two)(Math.abs(rounded))}${row.changeUnit ? ` ${row.changeUnit}` : ''}`;
  const words = `${capital(row.measure)}: ${reading(b, row.style, row.kind)} against ${reading(a, row.style, row.kind)} (${signedChange}).`;
  return { group: row.group, measure: row.measure, a, b, change: rounded, size: round(size, 1), words };
}

/** Each frequency both spectra have, with its index in each. */
function sharedFreqs(a: number[], b: number[]): Array<{ f: number; i: number; j: number }> {
  const at = new Map<number, number>();
  a.forEach((f, i) => at.set(Math.round(f * 1000), i));
  const out: Array<{ f: number; i: number; j: number }> = [];
  b.forEach((f, j) => {
    const i = at.get(Math.round(f * 1000));
    if (i !== undefined) out.push({ f, i, j });
  });
  return out;
}

/** A report's whole-spectrum-matched band levels, not yet floored (each band's total power minus the sum of all of them), at the shared bands. */
function matchedBands(spectrum: BandSpectrum, picks: number[]): number[] {
  const total = totalBands(spectrum);
  const mine = picks.map((i) => total[i]);
  const whole = sumDb(mine);
  return mine.map((v) => v - whole);
}

/** The tone rows and the spectrum, with level taken out. */
function toneRows(a: Tone, b: Tone): { rows: Row[]; spectrum: SoundComparison['spectrum'] } {
  const shared = sharedFreqs(a.spectrum.freqs, b.spectrum.freqs);
  const freqs = shared.map((s) => s.f);
  const rows: Row[] = [];
  let changeDb: number[] = [];
  if (shared.length > 0) {
    const ma = matchedBands(a.spectrum, shared.map((s) => s.i));
    const mb = matchedBands(b.spectrum, shared.map((s) => s.j));
    changeDb = mb.map((v, k) => round(Math.max(LEVEL_FLOOR_DB, v) - Math.max(LEVEL_FLOOR_DB, ma[k]), 1));
    const here = { freqs };
    for (const r of REGIONS) {
      if (!freqs.some((f) => f >= r.lo && f < r.hi)) continue;
      const la = levelBetween(here, ma, r.lo, r.hi);
      const lb = levelBetween(here, mb, r.lo, r.hi);
      if (la < LEVEL_FLOOR_DB && lb < LEVEL_FLOOR_DB) continue;
      rows.push({ group: 'tone', measure: r.name, a: Math.max(LEVEL_FLOOR_DB, la), b: Math.max(LEVEL_FLOOR_DB, lb), step: 1.5, style: DB, kind: 'dB', changeUnit: 'dB' });
    }
  }
  if (a.centreHz > 0 && b.centreHz > 0) {
    rows.push({ group: 'tone', measure: 'centre', a: a.centreHz, b: b.centreHz, change: Math.log2(b.centreHz / a.centreHz), step: 0.15, style: { places: 0, changePlaces: 2, text: freqText }, kind: 'Hz', changeUnit: 'octaves' });
  }
  rows.push({ group: 'tone', measure: 'tilt', a: a.tiltDbPerOctave, b: b.tiltDbPerOctave, step: 0.5, style: DB, kind: 'plain', changeUnit: 'dB an octave' });
  rows.push({ group: 'tone', measure: 'sub against bass', a: a.subVsBassDb, b: b.subVsBassDb, step: 2, style: DB, kind: 'dB', changeUnit: 'dB' });
  return { rows, spectrum: { freqs, changeDb } };
}

function plain(group: HearingGroup, measure: string, a: unknown, b: unknown, step: number, style: Style, kind: Row['kind'], changeUnit: string): Row[] {
  return finiteNumber(a) && finiteNumber(b) ? [{ group, measure, a, b, step, style, kind, changeUnit }] : [];
}

function ratio(group: HearingGroup, measure: string, a: unknown, b: unknown, step: number, style: Style, kind: Row['kind'], floor = 0): Row[] {
  if (!finiteNumber(a) || !finiteNumber(b)) return [];
  const fa = Math.max(a, floor);
  const fb = Math.max(b, floor);
  if (!(fa > 0) || !(fb > 0)) return [];
  return [{ group, measure, a, b, change: Math.log2(fb / fa), step, style, kind, changeUnit: 'octaves' }];
}

function groupRows(group: HearingGroup, a: SoundReport, b: SoundReport): { rows: Row[]; spectrum?: SoundComparison['spectrum'] } {
  switch (group) {
    case 'tone':
      return toneRows(a.tone!, b.tone!);
    case 'texture': {
      const x = a.texture!, y = b.texture!;
      return {
        rows: [
          ...plain('texture', 'flatness', x.flatness, y.flatness, 0.05, PLAIN2, 'plain', ''),
          ...plain('texture', 'roughness', x.roughness, y.roughness, 0.08, PLAIN2, 'plain', ''),
          ...plain('texture', 'percussive share', x.percussiveShare, y.percussiveShare, 0.1, PLAIN2, 'plain', ''),
        ],
      };
    }
    case 'movement': {
      const x = a.movement!, y = b.movement!;
      const depth = (m: typeof x, band: 'low' | 'mid' | 'high') => m.modulations.find((q) => q.band === band)?.depthDb ?? 0;
      return {
        rows: [
          ...plain('movement', 'change', x.changeDb, y.changeDb, 0.3, DB, 'dB', 'dB'),
          ...(['low', 'mid', 'high'] as const).flatMap((band) => plain('movement', `${band} band depth`, depth(x, band), depth(y, band), 2, DB, 'dB', 'dB')),
        ],
      };
    }
    case 'dynamics': {
      const x: Dynamics = a.dynamics!, y: Dynamics = b.dynamics!;
      return {
        rows: [
          ...plain('dynamics', 'loudness', x.lufs, y.lufs, 1, LU, 'LUFS', 'LU'),
          ...plain('dynamics', 'crest', x.crestDb, y.crestDb, 1, DB, 'dB', 'dB'),
          ...plain('dynamics', 'range', x.rangeLu, y.rangeLu, 1.5, { ...LU, text: (v) => `${one(v)} LU` }, 'plain', 'LU'),
        ],
      };
    }
    case 'attack': {
      const x = a.attack!, y = b.attack!;
      return {
        rows: [
          ...ratio('attack', 'onsets a second', x.onsetsPerSecond, y.onsetsPerSecond, 0.25, { places: 1, changePlaces: 2 }, 'plain', ONSETS_FLOOR),
          ...ratio('attack', 'rise', x.riseMs, y.riseMs, 0.4, { places: 1, changePlaces: 2 }, 'ms'),
        ],
      };
    }
    default: {
      const x = a.stereo as Partial<Stereo>, y = b.stereo as Partial<Stereo>;
      const rows = [
        ...plain('stereo', 'correlation', x.correlation, y.correlation, 0.1, PLAIN2, 'plain', ''),
        ...plain('stereo', 'mono loss', x.monoLossDb, y.monoLossDb, 1, DB, 'dB', 'dB'),
        ...plain('stereo', 'low end width', x.lowSideDb, y.lowSideDb, 2, DB, 'dB', 'dB'),
      ];
      for (const w of x.width ?? []) {
        const other = y.width?.find((q) => q.name === w.name);
        if (other) rows.push(...plain('stereo', `width: ${w.name}`, w.db, other.db, 2, DB, 'dB', 'dB'));
      }
      return { rows };
    }
  }
}

/** The differences between two sound reports, b against a, level-matched, largest first. */
export function compareSound(a: SoundReport, b: SoundReport, labels: { a: string; b: string } = { a: 'the first', b: 'the second' }): SoundComparison {
  const notes = [`Read as ${labels.b} against ${labels.a}.`];
  const out: SoundComparison = { levelDb: null, differences: [], spectrum: { freqs: [], changeDb: [] }, skipped: [], notes };
  if (a.silent || b.silent) {
    notes.push('One of these is silent.');
    return out;
  }
  const longer = Math.max(a.seconds, b.seconds);
  const shorter = Math.min(a.seconds, b.seconds);
  if (shorter > 0 && longer > shorter * 1.5) {
    notes.push(`These are different lengths (${minutes(a.seconds)} against ${minutes(b.seconds)}): a short loud stretch reads brighter, louder and more squashed than a whole track. Compare like with like.`);
  }
  if (finiteNumber(a.dynamics?.lufs) && finiteNumber(b.dynamics?.lufs)) out.levelDb = round(b.dynamics!.lufs! - a.dynamics!.lufs!, 1);

  const found: Array<SoundDifference & { _raw: number }> = [];
  for (const group of GROUPS) {
    const has = [a[group], b[group]].filter((x) => x !== undefined && x !== null).length;
    if (has === 0) continue;
    if (has === 1) {
      out.skipped.push(group);
      notes.push(`${group} can't be compared: only one of these has it.`);
      continue;
    }
    if (a.versions?.[group] !== b.versions?.[group] || a.versions?.[group] === undefined) {
      out.skipped.push(group);
      notes.push(`${group} can't be compared: one of these was measured by an older version and must be measured again from its audio.`);
      continue;
    }
    const { rows, spectrum } = groupRows(group, a, b);
    if (spectrum) out.spectrum = spectrum;
    for (const row of rows) {
      const d = differenceOf(row);
      if (d) found.push({ ...d, _raw: Math.abs(row.change ?? row.b - row.a) / row.step });
    }
  }
  found.sort((x, y) => y._raw - x._raw);
  out.differences = found.map(({ _raw, ...d }) => d);
  if (a.settings.stretch?.fromSaved || b.settings.stretch?.fromSaved) notes.push('Compared from saved measurements of a stretch: tone, width and loudness only.');
  return out;
}

/** The power mean of some dB values, dB; null when there are none. */
function powerMean(values: Array<number | null>): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    sum += 10 ** (v / 10);
    n++;
  }
  return n === 0 ? null : 10 * Math.log10(sum / n);
}

const round1 = (x: number) => {
  const r = Math.round(x * 10) / 10;
  return r === 0 ? 0 : r;
};

/** The sides' level over the middle's across `lo` to `hi` Hz, dB, floored (as the stereo group reads it). */
function sideOverMid(freqs: number[], mid: number[], side: number[], lo: number, hi: number): number {
  const m = levelBetween({ freqs }, mid, lo, hi);
  const s = levelBetween({ freqs }, side, lo, hi);
  if (!Number.isFinite(m) || !Number.isFinite(s) || (m < SILENT_DB && s < SILENT_DB)) return WIDTH_FLOOR_DB;
  return round1(Math.max(WIDTH_FLOOR_DB, s - m));
}

/** A report of the part of a saved one from `fromSeconds` up to `toSeconds`, from its "along" rows alone. */
export function stretchOf(r: SoundReport, fromSeconds: number, toSeconds: number): SoundReport {
  // (a reply's report has no grids: only a saved hearing can give a stretch)
  const along = r.along;
  if (!along || !Number.isFinite(fromSeconds) || Number.isNaN(toSeconds)) throw new RangeError('that stretch holds nothing');
  const step = along.stepSeconds;
  const from = Math.max(0, fromSeconds);
  const to = Math.min(toSeconds, r.seconds);
  const rows: number[] = [];
  for (let i = 0; i < along.mid.length; i++) {
    const at = i * step;
    if (at >= from && at < to) rows.push(i);
  }
  if (rows.length === 0) throw new RangeError('that stretch holds nothing');
  const stretch = { fromSeconds: from, toSeconds: to, fromSaved: true };

  const freqs = along.freqs;
  const stereo = r.channels === 2 && rows.every((i) => along.side[i]?.length === freqs.length);
  const average = (pick: (i: number) => number[] | undefined): number[] =>
    freqs.map((_, k) => {
      let p = 0;
      for (const i of rows) p += 10 ** ((pick(i)?.[k] ?? FLOOR_DB) / 10);
      p /= rows.length;
      return p > 1e-20 ? round1(10 * Math.log10(p)) : FLOOR_DB;
    });
  const mid = average((i) => along.mid[i]);
  const side = stereo ? average((i) => along.side[i]) : freqs.map(() => FLOOR_DB);
  const spectrum: BandSpectrum = { freqs, mid, side };

  const bands = totalBands(spectrum);
  const total = sumDb(bands);
  const live = Number.isFinite(total) && total > SILENT_DB;
  const regions = REGIONS.map((x) => ({ name: x.name, db: live ? round1(levelBetween(spectrum, bands, x.lo, x.hi) - total) : 0 }));

  let sum = 0;
  let weighted = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  freqs.forEach((f, i) => {
    const power = 10 ** (bands[i] / 10);
    if (f >= 20 && f <= 20000) {
      sum += power;
      weighted += power * f;
    }
    if (f >= 50 && f <= 12000) {
      xs.push(Math.log2(f));
      ys.push(bands[i]);
    }
  });
  const centreHz = sum > 0 && live ? weighted / sum : 0;
  let tilt = 0;
  if (live && xs.length > 1) {
    const mx = xs.reduce((p, q) => p + q, 0) / xs.length;
    const my = ys.reduce((p, q) => p + q, 0) / ys.length;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    tilt = den > 0 ? num / den : 0;
  }
  const subVsBassDb = live ? levelBetween(spectrum, bands, 20, 60) - levelBetween(spectrum, bands, 60, 200) : 0;

  // tone.ts owns the roll-off and does not export it, so a stretch leaves it out rather than compute a second version.
  const tone = {
    spectrum,
    regions,
    centreHz: Math.round(centreHz),
    tiltDbPerOctave: round1(tilt),
    subVsBassDb: round1(subVsBassDb),
    peaks: [],
  } as unknown as Tone;

  const lufs = powerMean(rows.map((i) => along.lufs[i] ?? null));
  const dynamics: Dynamics = { lufs: lufs === null ? null : round1(lufs), shortTermMaxLufs: null, truePeakDbtp: null, crestDb: null, rangeLu: null };

  const first = rows[0] * step;
  const head = { versions: { ...r.versions }, engine: r.engine, settings: { ...r.settings, stretch }, channels: r.channels };
  const last = Math.min(to, (rows[rows.length - 1] + 1) * step);
  const seconds = Math.round(Math.max(0, last - first) * 100) / 100;
  if (!live) return { ...head, seconds, silent: true, faults: [], along: { stepSeconds: step, freqs: [], mid: [], side: [], lufs: [], chroma: [] }, words: ['It is silent.'] };
  const report: Omit<SoundReport, 'words'> = {
    ...head,
    seconds,
    silent: false,
    tone,
    dynamics,
    faults: [],
    along: {
      stepSeconds: step,
      freqs,
      mid: rows.map((i) => along.mid[i]),
      side: rows.map((i) => along.side[i] ?? []),
      lufs: rows.map((i) => along.lufs[i] ?? null),
      chroma: rows.map((i) => along.chroma[i] ?? []),
    },
  };
  if (stereo) {
    // Only the width and the low-end side are known from the rows; the other stereo measures stay absent.
    report.stereo = {
      width: REGIONS.map((x) => ({ name: x.name, db: sideOverMid(freqs, mid, side, x.lo, x.hi) })),
      lowSideDb: sideOverMid(freqs, mid, side, 20, 120),
    } as Stereo;
  }
  return { ...report, words: soundWords(report) };
}
