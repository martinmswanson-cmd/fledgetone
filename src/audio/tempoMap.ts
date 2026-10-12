/**
 * The song's tempo map and meter map: tempo changes (a jump, or a glide from the tempo before)
 * and time-signature changes along the timeline.
 *
 * Positions everywhere in the app are "bars" of four quarter notes, 1-based (bar 1 is the start),
 * whatever the meter: a clip at 5.75 sits 19 quarter notes in. The meter decides only how that
 * is counted and drawn (where measure lines fall, what "beat 1" is, what the metronome accents),
 * so changing a time signature never moves a note. The tempo decides how long each quarter note
 * lasts, so it turns positions into seconds and back.
 *
 * A glide changes the tempo linearly in time from the previous point's tempo to its own, which is
 * exactly how the Transport ramps its tempo, so the seconds worked out here are what plays.
 *
 * Pure (no audio imports), so it's unit tested (scripts/tempoMap.test.mjs).
 */

export interface TempoPoint {
  id: string;
  /** Where the new tempo is reached (a jump happens here; a glide ends here). Always after bar 1. */
  bar: number;
  bpm: number;
  /** Glide to this tempo from the previous point (or the song's tempo), instead of jumping. */
  ramp: boolean;
}

export interface TempoMap {
  /** The tempo at bar 1. */
  bpm: number;
  points: readonly TempoPoint[];
}

/** A tempo: one for the whole song, or a map. */
export type Tempo = number | TempoMap;

export interface Meter {
  /** Beats per measure */
  num: number;
  /** The beat's note value: 4 is a quarter note, 8 an eighth */
  den: number;
}

export interface MeterPoint extends Meter {
  id: string;
  /** Where the new meter starts: always the start of a measure. */
  bar: number;
}

export interface MeterMap {
  /** The meter from bar 1. */
  base: Meter;
  points: readonly MeterPoint[];
}

export const FOUR_FOUR: Meter = { num: 4, den: 4 };
export const MIN_BPM = 40;
export const MAX_BPM = 240;
const EPS = 1e-9;

export const clampBpm = (bpm: number) => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm * 100) / 100));

// ---------- tempo ----------

/** A stretch of the timeline at one tempo, or gliding between two. */
interface Segment {
  bar: number;
  /** Seconds from bar 1 to the segment's start */
  seconds: number;
  /** Tempo at the start and at the end (equal unless it glides) */
  from: number;
  to: number;
  /** Where it ends (Infinity for the last) */
  end: number;
  /** Its length in seconds (Infinity for the last) */
  span: number;
}

const compiled = new WeakMap<TempoMap, Segment[]>();

/** Seconds that `beats` quarter notes take, gliding linearly in time from `from` to `to` BPM over `total` beats. */
function rampSeconds(beats: number, from: number, to: number, total: number): number {
  if (Math.abs(to - from) < EPS) return (60 * beats) / from;
  const T = (120 * total) / (from + to);
  const a = (to - from) / (2 * T);
  // beats(τ) = (from·τ + a·τ²) / 60
  return (-from + Math.sqrt(from * from + 4 * a * 60 * beats)) / (2 * a);
}

/** Quarter notes played in the first `tau` seconds of a glide (see rampSeconds). */
function rampBeats(tau: number, from: number, to: number, span: number): number {
  return (from * tau + ((to - from) * tau * tau) / (2 * span)) / 60;
}

/** The points in order, after bar 1, one per position (the last one written wins). */
export function sortedPoints<P extends { bar: number }>(points: readonly P[]): P[] {
  const sorted = [...points].filter((p) => p.bar > 1 + EPS).sort((a, b) => a.bar - b.bar);
  return sorted.filter((p, i) => i === sorted.length - 1 || sorted[i + 1].bar - p.bar > EPS);
}

function segments(map: TempoMap): Segment[] {
  const hit = compiled.get(map);
  if (hit) return hit;
  const points = sortedPoints(map.points);
  const out: Segment[] = [];
  let bar = 1;
  let seconds = 0;
  let tempo = map.bpm;
  for (let i = 0; i <= points.length; i++) {
    const next = points[i];
    if (!next) {
      out.push({ bar, seconds, from: tempo, to: tempo, end: Infinity, span: Infinity });
      break;
    }
    const to = next.ramp ? next.bpm : tempo;
    const beats = (next.bar - bar) * 4;
    const span = next.ramp ? (120 * beats) / (tempo + to) : (60 * beats) / tempo;
    out.push({ bar, seconds, from: tempo, to, end: next.bar, span });
    seconds += span;
    bar = next.bar;
    tempo = next.bpm;
  }
  compiled.set(map, out);
  return out;
}

const isMap = (t: Tempo): t is TempoMap => typeof t !== 'number';

/** True when the tempo never changes. */
export const isSteady = (t: Tempo) => !isMap(t) || t.points.every((p) => Math.abs(p.bpm - t.bpm) < EPS);

/** The tempo at bar 1. */
export const baseBpm = (t: Tempo) => (isMap(t) ? t.bpm : t);

function segmentAtBar(segs: Segment[], bar: number): Segment {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].bar <= bar + EPS) lo = mid;
    else hi = mid - 1;
  }
  return segs[lo];
}

function segmentAtSeconds(segs: Segment[], seconds: number): Segment {
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].seconds <= seconds + EPS) lo = mid;
    else hi = mid - 1;
  }
  return segs[lo];
}

/** Seconds from the start of bar 1 to `bar`. Before bar 1 counts back at the starting tempo. */
export function barToSeconds(bar: number, tempo: Tempo): number {
  if (!isMap(tempo)) return ((bar - 1) * 240) / tempo;
  if (bar <= 1) return ((bar - 1) * 240) / tempo.bpm;
  const seg = segmentAtBar(segments(tempo), bar);
  const beats = (bar - seg.bar) * 4;
  if (seg.from === seg.to) return seg.seconds + (60 * beats) / seg.from;
  return seg.seconds + rampSeconds(beats, seg.from, seg.to, (seg.end - seg.bar) * 4);
}

/** The bar playing `seconds` after the start of bar 1. */
export function secondsToBar(seconds: number, tempo: Tempo): number {
  if (!isMap(tempo)) return (seconds * tempo) / 240 + 1;
  if (seconds <= 0) return (seconds * tempo.bpm) / 240 + 1;
  const seg = segmentAtSeconds(segments(tempo), seconds);
  const tau = seconds - seg.seconds;
  if (seg.from === seg.to) return seg.bar + (tau * seg.from) / 240;
  return seg.bar + rampBeats(Math.min(tau, seg.span), seg.from, seg.to, seg.span) / 4;
}

/** The tempo at `bar` (part way through a glide, the tempo at that moment). */
export function tempoAt(bar: number, tempo: Tempo): number {
  if (!isMap(tempo)) return tempo;
  const seg = segmentAtBar(segments(tempo), Math.max(1, bar));
  if (seg.from === seg.to) return seg.from;
  const tau = barToSeconds(bar, tempo) - seg.seconds;
  return seg.from + ((seg.to - seg.from) * tau) / seg.span;
}

/** Seconds between two positions. */
export const secondsBetween = (from: number, to: number, tempo: Tempo) => barToSeconds(to, tempo) - barToSeconds(from, tempo);

/**
 * How the tempo moves from `bar` on, for the Transport: the tempo there, and if it's gliding, the
 * tempo it reaches and how many seconds later (null when it holds steady until the next point).
 */
export function tempoFrom(bar: number, tempo: Tempo): { bpm: number; glide: { to: number; seconds: number } | null } {
  if (!isMap(tempo)) return { bpm: tempo, glide: null };
  const seg = segmentAtBar(segments(tempo), Math.max(1, bar));
  const bpm = tempoAt(bar, tempo);
  if (seg.from === seg.to || !Number.isFinite(seg.end)) return { bpm, glide: null };
  return { bpm, glide: { to: seg.to, seconds: barToSeconds(seg.end, tempo) - barToSeconds(Math.max(1, bar), tempo) } };
}

/** Where the tempo changes (each point's bar), for the Transport to act on. */
export const tempoChangeBars = (tempo: Tempo): number[] => (isMap(tempo) ? sortedPoints(tempo.points).map((p) => p.bar) : []);

/**
 * The same map with every point after `at` moved by `bars` (inserting time there; negative
 * removes it). Points inside a removed stretch go.
 */
export function shiftTempoPoints<P extends { bar: number }>(points: readonly P[], at: number, bars: number): P[] {
  return points
    .filter((p) => !(bars < 0 && p.bar > at + EPS && p.bar < at - bars - EPS))
    .map((p) => (p.bar > at + EPS ? { ...p, bar: p.bar + bars } : p));
}

// ---------- meter ----------

/** A measure's length in bars (whole notes): 3/4 is 0.75, 6/8 is 0.75, 7/8 is 0.875. */
export const measureBars = (m: Meter) => m.num / m.den;

export const formatMeter = (m: Meter) => `${m.num}/${m.den}`;

export function parseMeter(text: string): Meter | null {
  const m = text.trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (num < 1 || num > 32 || ![1, 2, 4, 8, 16, 32].includes(den)) return null;
  return { num, den };
}

/** A stretch of measures in one meter. */
interface MeterSection {
  bar: number;
  /** The measure number the section starts on (1-based) */
  measure: number;
  meter: Meter;
}

const meterCompiled = new WeakMap<MeterMap, MeterSection[]>();

function meterSections(map: MeterMap): MeterSection[] {
  const hit = meterCompiled.get(map);
  if (hit) return hit;
  const out: MeterSection[] = [{ bar: 1, measure: 1, meter: map.base }];
  for (const p of sortedPoints(map.points)) {
    const last = out[out.length - 1];
    const len = measureBars(last.meter);
    // A change lands on a measure start of the meter before it
    const measures = Math.max(1, Math.round((p.bar - last.bar) / len));
    const bar = last.bar + measures * len;
    if (bar <= last.bar + EPS) continue;
    out.push({ bar, measure: last.measure + measures, meter: { num: p.num, den: p.den } });
  }
  meterCompiled.set(map, out);
  return out;
}

const isFourFour = (map: MeterMap) => map.base.num === 4 && map.base.den === 4 && map.points.every((p) => p.num === 4 && p.den === 4);

function sectionAt(sections: MeterSection[], bar: number): MeterSection {
  let s = sections[0];
  for (const sec of sections) {
    if (sec.bar <= bar + EPS) s = sec;
    else break;
  }
  return s;
}

/** The meter at `bar`. */
export const meterAt = (bar: number, map: MeterMap): Meter => sectionAt(meterSections(map), bar).meter;

/** The start of the measure that `bar` is in, and that measure's number and meter. */
export function measureAt(bar: number, map: MeterMap): { start: number; measure: number; meter: Meter; length: number } {
  const sec = sectionAt(meterSections(map), bar);
  const len = measureBars(sec.meter);
  const k = Math.floor((bar - sec.bar) / len + EPS);
  return { start: sec.bar + k * len, measure: sec.measure + k, meter: sec.meter, length: len };
}

/** The position where measure `n` (1-based) starts. */
export function measureStart(n: number, map: MeterMap): number {
  const sections = meterSections(map);
  let sec = sections[0];
  for (const s of sections) {
    if (s.measure <= n) sec = s;
    else break;
  }
  return sec.bar + (n - sec.measure) * measureBars(sec.meter);
}

/** Every measure that starts in [from, to): its position, number and meter. */
export function measuresBetween(from: number, to: number, map: MeterMap): Array<{ bar: number; measure: number; meter: Meter }> {
  const out: Array<{ bar: number; measure: number; meter: Meter }> = [];
  let m = measureAt(Math.max(1, from), map);
  if (m.start < from - EPS) m = measureAt(m.start + m.length, map);
  while (m.start < to - EPS && out.length < 100000) {
    out.push({ bar: m.start, measure: m.measure, meter: m.meter });
    m = measureAt(m.start + m.length + EPS, map);
  }
  return out;
}

/** The nearest measure start to `bar`, where a time signature can change. */
export function nearestMeasureStart(bar: number, map: MeterMap): number {
  const m = measureAt(bar, map);
  return bar - m.start > m.length / 2 ? m.start + m.length : m.start;
}

/**
 * A position as measure, beat and hundredths of a beat, counted in the meter there: in 6/8 the
 * beats are eighths. In plain 4/4 this is the same as before meters existed.
 */
export function toMeasureBeat(bar: number, map: MeterMap): { measure: number; beat: number; hundredths: number } {
  if (isFourFour(map) || bar < 1) {
    const total = Math.floor(Math.max(0, (bar - 1) * 400) + 1e-6);
    return { measure: Math.floor(total / 400) + 1, beat: Math.floor((total % 400) / 100) + 1, hundredths: total % 100 };
  }
  const m = measureAt(bar, map);
  const beatLen = 1 / m.meter.den;
  const total = Math.floor(((bar - m.start) / beatLen) * 100 + 1e-6);
  return { measure: m.measure, beat: Math.floor(total / 100) + 1, hundredths: total % 100 };
}

/** The position of measure, beat and hundredths in the meter there, or null if the beat doesn't exist. */
export function fromMeasureBeat(measure: number, beat: number, hundredths: number, map: MeterMap): number | null {
  const start = measureStart(measure, map);
  const meter = measureAt(start + EPS, map).meter;
  if (beat < 1 || beat > meter.num || hundredths < 0 || hundredths > 99) return null;
  return start + ((beat - 1) + hundredths / 100) / meter.den;
}

/** True when the meter map is plain 4/4 throughout. */
export const isPlainMeter = (map: MeterMap) => isFourFour(map);

/** The beats (in bars) of every measure in [from, to), for drawing grids: the measure starts flagged. */
export function beatsBetween(from: number, to: number, map: MeterMap): Array<{ bar: number; downbeat: boolean }> {
  const out: Array<{ bar: number; downbeat: boolean }> = [];
  for (const m of measuresBetween(measureAt(Math.max(1, from), map).start, to, map)) {
    for (let b = 0; b < m.meter.num; b++) {
      const bar = m.bar + b / m.meter.den;
      if (bar >= from - EPS && bar < to - EPS) out.push({ bar, downbeat: b === 0 });
    }
  }
  return out;
}
