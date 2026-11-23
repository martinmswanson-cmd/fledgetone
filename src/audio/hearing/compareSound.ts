/**
 * Comparing two sound reports of the hearing work, level-matched (the whole spectrum's level is taken
 * out of each before tone is compared), as a list of differences, largest first; and making a report
 * of part of a saved one, from its "along" grid alone. Pure maths on reports, no Web Audio, so Node can test it.
 */
import { levelBetween, REGIONS, sumDb, totalBands } from '../mixAnalysis';
import type { BandSpectrum } from '../mixAnalysis';
import { freqText, noteName, one, placeText, soundWords, two } from './words';
import type { Dynamics, Fault, FaultKind, HearingGroup, Modulation, Register, SoundReport, Space, Stereo, Tone } from './types';

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
  /** One plain line for each kind of fault the two do not have the same number of. */
  faults: string[];
  spectrum: { freqs: number[]; changeDb: number[] };
  skipped: HearingGroup[];
  notes: string[];
}

const GROUPS: HearingGroup[] = ['tone', 'texture', 'movement', 'space', 'dynamics', 'attack', 'stereo', 'register'];
const FLOOR_DB = -200;
const SILENT_DB = -150;
const WIDTH_FLOOR_DB = -60;
const ONSETS_FLOOR = 0.1;
/**
 * A side level this far under its report's whole, dB, is at the floor (a lossy file's rounding, a
 * reverb's last trace): a width is compared only where one of the two stands above it.
 */
const SIDE_FLOOR_DB = -50;
/** A change this large in one band of the spectrum, dB (a region's step), is said when no measure differs. */
const BAND_STEP_DB = 1.5;
/** A band's movement that only one of the two has counts for at most this many steps, so it does not lead the list by itself. */
const ONE_SIDED_STEPS = 3;
/** Band and region levels are floored this far under their report's whole, dB: under it is rounding noise, and not a tone. */
const LEVEL_FLOOR_DB = -70;
/** Decays are floored at this, ms, before they are compared: they are read on 10 ms frames, and under that they are all alike (sounds that stop). */
const DECAY_FLOOR_MS = 10;

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
  /** For a measure compared as a ratio: how b is said against a ("4 times as long", "25% as many"). */
  ratio?: 'as long' | 'as many';
  /** A ratio's floor: readings under it are taken as it in the change and the ratio, and said as under it ("under 10 ms"). */
  floor?: number;
}

/** A time in whole ms; a pitch as its note name. */
const MS: Style = { places: 0, changePlaces: 2, text: (v) => `${Math.round(v)} ms` };
const NOTE: Style = { places: 1, changePlaces: 2, text: noteName };

/** b against a as a plain ratio: "4 times as long", "2.5 times as many", "25% as long"; "from none" and "to none" where one is nothing. */
function ratioWords(a: number, b: number, unit: string): string {
  if (!(a > 0)) return 'from none';
  if (!(b > 0)) return 'to none';
  const r = b / a;
  if (r < 1) return `${Math.round(r * 100)}% ${unit}`;
  const shown = r >= 10 ? String(Math.round(r)) : String(Math.round(r * 10) / 10);
  return `${shown} times ${unit}`;
}

/**
 * b against a as a ratio when either is under `floor` (and taken as it): "more than 70 times as long" when a is under
 * it, "less than 2% as long" when b is; rounded so that what is said holds whatever the reading under the floor was.
 */
function flooredRatioWords(a: number, b: number, floor: number, unit: string): string {
  const fa = Math.max(a, floor);
  const fb = Math.max(b, floor);
  if (a >= floor && b >= floor) return ratioWords(fa, fb, unit);
  const r = fb / fa;
  if (a < floor) return r >= 10 ? `more than ${Math.floor(r)} times ${unit}` : `more than ${Math.floor(r * 10) / 10} times ${unit}`;
  return `less than ${Math.ceil(r * 100)}% ${unit}`;
}

function differenceOf(row: Row): SoundDifference | null {
  const change = row.change ?? row.b - row.a;
  if (!Number.isFinite(change) || !(Math.abs(change) / row.step >= 1)) return null;
  const size = Math.abs(change) / row.step;
  const a = round(row.a, row.style.places);
  const b = round(row.b, row.style.places);
  const rounded = round(change, row.style.changePlaces);
  const signedChange = `${rounded >= 0 ? '+' : '-'}${(row.style.changePlaces === 1 ? one : two)(Math.abs(rounded))}${row.changeUnit ? ` ${row.changeUnit}` : ''}`;
  const floor = row.floor;
  const said = row.ratio ? (floor ? flooredRatioWords(row.a, row.b, floor, row.ratio) : ratioWords(a, b, row.ratio)) : signedChange;
  /** A reading as text, said as under the floor when it is (as the sound's own words say it). */
  const text = (x: number, raw: number) => (floor && raw < floor ? `under ${reading(floor, row.style, row.kind)}` : reading(x, row.style, row.kind));
  const words = `${capital(row.measure)}: ${text(b, row.b)} against ${text(a, row.a)} (${said}).`;
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

/**
 * A measure compared as a ratio (its change is in doublings, its words say the ratio plainly), each reading taken as at
 * least `floor`; with `sayUnder`, a reading under the floor is said as under it and the words' ratio is the floored one.
 */
function ratio(group: HearingGroup, measure: string, a: unknown, b: unknown, step: number, style: Style, kind: Row['kind'], said: Row['ratio'], floor = 0, sayUnder = false): Row[] {
  if (!finiteNumber(a) || !finiteNumber(b)) return [];
  const fa = Math.max(a, floor);
  const fb = Math.max(b, floor);
  if (!(fa > 0) || !(fb > 0)) return [];
  return [{ group, measure, a, b, change: Math.log2(fb / fa), step, style, kind, changeUnit: 'octaves', ratio: said, ...(sayUnder && floor > 0 ? { floor } : {}) }];
}

/** The side and the middle level of `lo` to `hi` Hz, each against the report's whole, dB; null when the report has no spectrum of both. */
function sideAndMid(r: SoundReport, lo: number, hi: number): { side: number; mid: number } | null {
  const s = r.tone?.spectrum;
  if (!s || s.side.length !== s.freqs.length || s.mid.length !== s.freqs.length) return null;
  const whole = sumDb(totalBands(s));
  if (!Number.isFinite(whole)) return null;
  return { side: levelBetween(s, s.side, lo, hi) - whole, mid: levelBetween(s, s.mid, lo, hi) - whole };
}

/**
 * A width (sides over middle, `lo` to `hi` Hz) compared. Only where the side level stands above
 * SIDE_FLOOR_DB under its report's whole in at least one of the two, and where each has sound there
 * at all; a side (or middle) under that floor is read as at the floor in both before the two are differenced.
 */
function widthRows(measure: string, a: SoundReport, b: SoundReport, wa: unknown, wb: unknown, lo: number, hi: number): Row[] {
  const la = sideAndMid(a, lo, hi);
  const lb = sideAndMid(b, lo, hi);
  if (!la || !lb) return plain('stereo', measure, wa, wb, 2, DB, 'dB', 'dB');
  if (la.side < SIDE_FLOOR_DB && lb.side < SIDE_FLOOR_DB) return [];
  const empty = (l: { side: number; mid: number }) => l.side < SIDE_FLOOR_DB && l.mid < SIDE_FLOOR_DB;
  if (empty(la) || empty(lb)) return [];
  /** The report's own width where neither level is at the floor, else the width of the floored levels. */
  const floored = (l: { side: number; mid: number }, own: unknown) =>
    l.side >= SIDE_FLOOR_DB && l.mid >= SIDE_FLOOR_DB ? own : Math.max(WIDTH_FLOOR_DB, Math.max(l.side, SIDE_FLOOR_DB) - Math.max(l.mid, SIDE_FLOOR_DB));
  return plain('stereo', measure, floored(la, wa), floored(lb, wb), 2, DB, 'dB', 'dB');
}

/** "in bright.wav", "in the second"; of a before-and-after, plainly "before" and "after". */
const inside = (label: string) => (label === 'before' || label === 'after' ? label : `in ${label}`);

/** A band's movement that only one of the two has: one difference that says so, with its rate and depth. */
function oneSided(m: Modulation, inB: boolean, labels: { a: string; b: string }): SoundDifference & { _raw: number } {
  const depth = round(m.depthDb, 1);
  const steps = Math.min(ONE_SIDED_STEPS, Math.abs(m.depthDb) / 2);
  return {
    group: 'movement',
    measure: `${m.band} band movement`,
    a: inB ? null : depth,
    b: inB ? depth : null,
    change: inB ? depth : round(-depth, 1),
    size: round(steps, 1),
    words: `${capital(m.band)} band movement: only ${inside(inB ? labels.b : labels.a)} (${one(m.hz)} Hz, ${one(m.depthDb)} dB deep).`,
    _raw: steps,
  };
}

/** An echo that only one of the two has: one difference that says so, with its time and note value; each repeat that stands out counts a step, up to ONE_SIDED_STEPS. */
function oneSidedEcho(echo: NonNullable<Space['echo']>, inB: boolean, labels: { a: string; b: string }): SoundDifference & { _raw: number } {
  const ms = Math.round(echo.ms);
  const steps = Math.min(ONE_SIDED_STEPS, Math.max(1, echo.repeats));
  return {
    group: 'space',
    measure: 'echo',
    a: inB ? null : ms,
    b: inB ? ms : null,
    change: inB ? ms : -ms,
    size: round(steps, 1),
    words: `Echo: only ${inside(inB ? labels.b : labels.a)} (${ms} ms${echo.note ? `, ${echo.note} notes` : ''}).`,
    _raw: steps,
  };
}

/** The space rows: each measure only where both have a number (a null is not none, and not compared); an echo in one only is said once. */
function spaceRows(x: Space, y: Space, labels: { a: string; b: string }): { rows: Row[]; more: Array<SoundDifference & { _raw: number }> } {
  const rows = [
    // (a decay under the floor is said as the sound's own words say it, "under 10 ms", and the ratio is the change's)
    ...ratio('space', 'decay', x.decayMs, y.decayMs, 0.4, MS, 'ms', 'as long', DECAY_FLOOR_MS, true),
    ...plain('space', 'wet share', x.wetShare, y.wetShare, 0.1, PLAIN2, 'plain', ''),
    ...ratio('space', 'echo', x.echo?.ms, y.echo?.ms, 0.1, MS, 'ms', 'as long'),
    ...plain('space', 'tail width', x.tailWiderDb, y.tailWiderDb, 2, DB, 'dB', 'dB'),
  ];
  const more: Array<SoundDifference & { _raw: number }> = [];
  if (!x.echo !== !y.echo) more.push(oneSidedEcho((x.echo ?? y.echo)!, !!y.echo, labels));
  return { rows, more };
}

/** A pitch compared in octaves and written as its note. */
const pitchRows = (measure: string, a: unknown, b: unknown): Row[] =>
  finiteNumber(a) && finiteNumber(b) && a > 0 && b > 0 ? [{ group: 'register', measure, a, b, change: Math.log2(b / a), step: 0.25, style: NOTE, kind: 'Hz', changeUnit: 'octaves' }] : [];

function groupRows(group: HearingGroup, a: SoundReport, b: SoundReport, labels: { a: string; b: string }): { rows: Row[]; spectrum?: SoundComparison['spectrum']; more?: Array<SoundDifference & { _raw: number }> } {
  switch (group) {
    case 'space':
      return spaceRows(a.space!, b.space!, labels);
    case 'register': {
      const x: Register = a.register!, y: Register = b.register!;
      return {
        rows: [...pitchRows('register centre', x.centreHz, y.centreHz), ...pitchRows('register low', x.lowHz, y.lowHz), ...pitchRows('register high', x.highHz, y.highHz), ...pitchRows('top line', x.topHz, y.topHz)],
      };
    }
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
      const rows = plain('movement', 'spectral movement', x.changeDb, y.changeDb, 0.3, DB, 'dB', 'dB');
      const more: Array<SoundDifference & { _raw: number }> = [];
      // A band's depth is compared only when both have that band's movement: what one lacks is not a number
      for (const band of ['low', 'mid', 'high'] as const) {
        const ma = x.modulations.find((q) => q.band === band);
        const mb = y.modulations.find((q) => q.band === band);
        if (ma && mb) rows.push(...plain('movement', `${band} band depth`, ma.depthDb, mb.depthDb, 2, DB, 'dB', 'dB'));
        else if (ma || mb) more.push(oneSided((ma ?? mb)!, !!mb, labels));
      }
      return { rows, more };
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
          ...ratio('attack', 'onsets a second', x.onsetsPerSecond, y.onsetsPerSecond, 0.25, { places: 1, changePlaces: 2 }, 'plain', 'as many', ONSETS_FLOOR),
          ...ratio('attack', 'rise', x.riseMs, y.riseMs, 0.4, { places: 1, changePlaces: 2 }, 'ms', 'as long'),
        ],
      };
    }
    default: {
      const x = a.stereo as Partial<Stereo>, y = b.stereo as Partial<Stereo>;
      const rows = [
        ...plain('stereo', 'correlation', x.correlation, y.correlation, 0.1, PLAIN2, 'plain', ''),
        ...plain('stereo', 'mono loss', x.monoLossDb, y.monoLossDb, 1, DB, 'dB', 'dB'),
        ...widthRows('low end width', a, b, x.lowSideDb, y.lowSideDb, 20, 120),
      ];
      for (const w of x.width ?? []) {
        const other = y.width?.find((q) => q.name === w.name);
        const region = REGIONS.find((q) => q.name === w.name);
        if (other) rows.push(...(region ? widthRows(`width: ${w.name}`, a, b, w.db, other.db, region.lo, region.hi) : plain('stereo', `width: ${w.name}`, w.db, other.db, 2, DB, 'dB', 'dB')));
      }
      return { rows };
    }
  }
}

/** How many of a kind a report's faults hold (a count of the rest included), and the kind's first fault with a place. */
function faultsOfKind(r: SoundReport, kind: FaultKind): { count: number; list: Fault[]; first: Fault | undefined } {
  const list = (r.faults ?? []).filter((f) => f.kind === kind);
  // (clipping is one fault that counts its places; clicks and silences are one each, then a count of the rest)
  const count = list.reduce((n, f) => n + (kind === 'clipping' ? (f.count ?? 1) : f.seconds === null && f.count !== undefined ? f.count : 1), 0);
  return { count, list, first: list.find((f) => f.at !== undefined) };
}

/** How each kind of fault is counted in words: its name, and one or several of it. */
const FAULT_COUNTS: Array<{ kind: FaultKind; name: string; one: string; many: string }> = [
  { kind: 'click', name: 'Clicks', one: '', many: '' },
  { kind: 'clipping', name: 'Clipping', one: ' place', many: ' places' },
  { kind: 'silence', name: 'Digital silence', one: ' stretch', many: ' stretches' },
];

/**
 * One line for each kind of fault the two do not have the same number of, b first, with where it is
 * (or first is) in b when it has a place there. A report made from a saved hearing's grids has no
 * faults to compare, so then there are no lines.
 */
function faultLines(a: SoundReport, b: SoundReport, labels: { a: string; b: string }): string[] {
  if (a.settings.stretch?.fromSaved || b.settings.stretch?.fromSaved) return [];
  const lines: string[] = [];
  for (const { kind, name, one: single, many } of FAULT_COUNTS) {
    const x = faultsOfKind(a, kind), y = faultsOfKind(b, kind);
    if (x.count === y.count) continue;
    const counted = (n: number) => (n === 0 ? 'none' : `${n}${n === 1 ? single : many}`);
    const where = y.first?.at ? ` (${y.count > 1 ? 'first ' : ''}at ${placeText(y.first.at)})` : '';
    lines.push(`${name}: ${counted(y.count)} ${inside(labels.b)}${where}, ${counted(x.count)} ${inside(labels.a)}.`);
  }
  const has = (r: SoundReport, kind: FaultKind) => faultsOfKind(r, kind).list;
  // Hum, by its frequencies
  const hums = (r: SoundReport) => has(r, 'hum').map((f) => f.value).filter(finiteNumber).sort((p, q) => p - q);
  const ha = hums(a), hb = hums(b);
  if (ha.join() !== hb.join()) {
    const said = (list: number[]) => (list.length ? `at ${list.map((hz) => `${hz} Hz`).join(' and ')}` : 'none');
    lines.push(`Hum: ${said(hb)} ${inside(labels.b)}, ${said(ha)} ${inside(labels.a)}.`);
  }
  // A DC offset and a quiet or silent channel: there or not
  for (const [kind, name] of [['dc', 'A DC offset'], ['channel', 'A quiet or silent channel']] as const) {
    const inA = has(a, kind).length > 0, inB = has(b, kind).length > 0;
    if (inA !== inB) lines.push(`${name}: ${inside(inB ? labels.b : labels.a)}, not ${inside(inB ? labels.a : labels.b)}.`);
  }
  return lines;
}

const listed = (names: readonly string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * The differences between two sound reports, b against a, level-matched, largest first; the kinds of
 * fault they do not share; and notes on how to read it, which end by saying so when nothing differs
 * (or, when no measure does but one band of the spectrum does, by saying that).
 */
export function compareSound(a: SoundReport, b: SoundReport, labels: { a: string; b: string } = { a: 'the first', b: 'the second' }): SoundComparison {
  const notes = [`Read as ${labels.b} against ${labels.a}.`];
  const out: SoundComparison = { levelDb: null, differences: [], faults: [], spectrum: { freqs: [], changeDb: [] }, skipped: [], notes };
  if (a.silent || b.silent) {
    notes.push('One of these is silent.');
    return out;
  }
  const longer = Math.max(a.seconds, b.seconds);
  const shorter = Math.min(a.seconds, b.seconds);
  if (shorter > 0 && longer > shorter * 1.5) {
    // (the lengths in the order of the names above: b, then a)
    notes.push(`These are different lengths (${minutes(b.seconds)} against ${minutes(a.seconds)}): a short loud stretch reads brighter, louder and more squashed than a whole track. Compare like with like.`);
  }
  if (finiteNumber(a.dynamics?.lufs) && finiteNumber(b.dynamics?.lufs)) out.levelDb = round(b.dynamics!.lufs! - a.dynamics!.lufs!, 1);

  const fromSaved = !!(a.settings.stretch?.fromSaved || b.settings.stretch?.fromSaved);
  const lacking: HearingGroup[] = [];
  const found: Array<SoundDifference & { _raw: number }> = [];
  for (const group of GROUPS) {
    const has = [a[group], b[group]].filter((x) => x !== undefined && x !== null).length;
    if (has === 0) continue;
    if (has === 1) {
      out.skipped.push(group);
      // (a stretch of a saved hearing lacks most groups: they are said in one note, below)
      if (fromSaved) lacking.push(group);
      else notes.push(`${group} can't be compared: only one of these has it.`);
      continue;
    }
    if (a.versions?.[group] !== b.versions?.[group] || a.versions?.[group] === undefined) {
      out.skipped.push(group);
      notes.push(`${group} can't be compared: one of these was measured by an older version and must be measured again from its audio.`);
      continue;
    }
    const { rows, spectrum, more } = groupRows(group, a, b, labels);
    if (spectrum) out.spectrum = spectrum;
    for (const row of rows) {
      const d = differenceOf(row);
      if (d) found.push({ ...d, _raw: Math.abs(row.change ?? row.b - row.a) / row.step });
    }
    if (more) found.push(...more);
  }
  found.sort((x, y) => y._raw - x._raw);
  out.differences = found.map(({ _raw, ...d }) => d);
  out.faults = faultLines(a, b, labels);
  if (fromSaved) notes.push(`Compared from saved measurements of a stretch: tone, width and loudness only${lacking.length ? ` (${listed(lacking)} can't be compared)` : ''}.`);
  if (out.differences.length === 0 && out.faults.length === 0) {
    // Nothing in the list: said, so an empty comparison is not read as one that failed. A change in one
    // narrow band can still stand in the spectrum under every measure's step (a boost of a third of an
    // octave moves its region little): then that is said, as "nothing differs" would not be true
    let top = -1;
    out.spectrum.changeDb.forEach((v, i) => {
      if (Math.abs(v) >= BAND_STEP_DB && (top < 0 || Math.abs(v) > Math.abs(out.spectrum.changeDb[top]))) top = i;
    });
    if (top < 0) notes.push('Nothing differs by more than a step.');
    else {
      const change = out.spectrum.changeDb[top];
      notes.push(`No measure differs by more than a step; the largest change in one sixth of an octave is ${change >= 0 ? '+' : '-'}${one(Math.abs(change))} dB, at ${freqText(out.spectrum.freqs[top])}.`);
    }
  }
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

/**
 * A report of the part of a saved one from `fromSeconds` up to `toSeconds`, from its "along" rows
 * alone. The times are as the saved report counts them: times in the file when it is of a stretch of
 * one (its rows then count from that stretch's start), else from the start of what was heard.
 */
export function stretchOf(r: SoundReport, fromSeconds: number, toSeconds: number): SoundReport {
  // (a reply's report has no grids: only a saved hearing can give a stretch)
  const along = r.along;
  if (!along || !Number.isFinite(fromSeconds) || Number.isNaN(toSeconds)) throw new RangeError('that stretch holds nothing');
  const step = along.stepSeconds;
  /** Where row 0 starts. */
  const start = r.settings.stretch?.fromSeconds ?? 0;
  const from = Math.max(start, fromSeconds);
  const to = Math.min(toSeconds, start + r.seconds);
  const rows: number[] = [];
  for (let i = 0; i < along.mid.length; i++) {
    const at = start + i * step;
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

  const first = start + rows[0] * step;
  const head = { versions: { ...r.versions }, engine: r.engine, settings: { ...r.settings, stretch }, channels: r.channels };
  const last = Math.min(to, start + (rows[rows.length - 1] + 1) * step);
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
