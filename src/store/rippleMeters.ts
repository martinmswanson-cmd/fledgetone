/**
 * Time signature and tempo changes through the arranging edits: inserting and deleting bars (the
 * ruler's ripple edits, see ripple.ts) and laying a song's stretches out in a new order (Pocket's
 * Move and Play it twice, the Beat switch). The music after an edit keeps the meter and tempo it
 * had, a change in bars that are deleted included, and a stretch that moves takes its own with it.
 * Pure, so Node can unit-test it (scripts/rippleMeters.test.mjs).
 */
import { clampBpm, meterAt, nearestMeasureStart, shiftTempoPoints, sortedPoints, tempoAt, tempoFrom, type Meter, type MeterPoint, type TempoPoint } from '../audio/tempoMap';
import type { RippleEdit } from './ripple';

const EPS = 1e-6;
/** How far before an edit point a glide under way there is ended (see endGlide). */
const CUT = 1e-3;

/** Whether the tempo is gliding at `bar` (part way through a glide that changes it). */
const glidingAt = (bar: number, tempo: { bpm: number; points: TempoPoint[] }) => bar > 1 + EPS && tempoFrom(bar, tempo).glide !== null;

/**
 * A glide under way at `bar`, ended just before it at the tempo it had reached there, so the music
 * before `bar` keeps its timing whatever follows: a glide point `CUT` before `bar` (none when a
 * point is already that close).
 */
function endGlide(points: TempoPoint[], bar: number, tempo: { bpm: number; points: TempoPoint[] }, newId: NewPointId): TempoPoint[] {
  const at = bar - CUT;
  if (points.some((p) => p.bar > at - EPS) || at <= 1 + EPS) return points;
  return [...points, { id: newId('tempo'), bar: at, bpm: tempoAt(at, tempo), ramp: true }];
}

/** The song's tempo and time signatures. */
export interface SongTime {
  bpm: number;
  tempoPoints: TempoPoint[];
  meter: Meter;
  meterPoints: MeterPoint[];
}

/** Makes a new point's id ('tempo' or 'meter'). */
export type NewPointId = (kind: 'tempo' | 'meter') => string;

/**
 * Time signature changes in order, each on a measure start of the meter before it, dropping any
 * that change nothing.
 */
export function tidyMeters(points: MeterPoint[], base: Meter): MeterPoint[] {
  const out: MeterPoint[] = [];
  let current = base;
  for (const p of sortedPoints(points)) {
    const bar = nearestMeasureStart(p.bar, { base, points: out });
    if (bar <= 1 + 1e-6 || out.some((o) => Math.abs(o.bar - bar) < 1e-6)) continue;
    if (p.num === current.num && p.den === current.den) continue;
    out.push({ ...p, bar });
    current = p;
  }
  return out;
}

const sameMeter = (a: Meter, b: Meter) => a.num === b.num && a.den === b.den;

/**
 * The tempo and time signatures after an insert or delete of bars. Inserting: the changes at or
 * after the insert point move later with the music. Deleting: the changes after the deleted bars
 * move up, and when the deleted bars held a change, the music after them keeps the meter and the
 * tempo it had (a change put back where the bars were taken out; from bar 1, the song's own meter
 * and tempo become those). A change right at the end of the deleted bars moves to where they
 * started, and from bar 1 becomes the song's own. A tempo glide under way where bars go in or
 * out ends there (see insertTempo, deleteTempo), so nothing before them is re-timed. Unchanged
 * parts are the same objects.
 */
export function rippleSongTime(s: SongTime, edit: RippleEdit, newId: NewPointId): SongTime {
  if (edit.kind === 'insert') {
    const shift = <P extends { bar: number }>(points: P[]): P[] => points.map((p) => (p.bar >= edit.at - EPS ? { ...p, bar: p.bar + edit.bars } : p));
    return {
      bpm: s.bpm,
      tempoPoints: s.tempoPoints.length ? insertTempo(s, edit.at, edit.bars, newId) ?? sortedPoints(shift(s.tempoPoints)) : s.tempoPoints,
      meter: s.meter,
      meterPoints: s.meterPoints.length ? tidyMeters(shift(s.meterPoints), s.meter) : s.meterPoints,
    };
  }
  const { from, to } = edit;
  const fromStart = from <= 1 + EPS;
  const inside = (p: { bar: number }) => p.bar >= from - EPS && p.bar < to - EPS;
  // (a change at the very end of the deleted bars counts too when they start at bar 1: it lands there)
  const held = (p: { bar: number }) => p.bar >= from - EPS && (fromStart ? p.bar < to + EPS : p.bar < to - EPS);
  // Changes inside the deleted bars go with them; those after move up
  const shift = <P extends { bar: number }>(points: P[]): P[] => shiftTempoPoints(points.filter((p) => !inside(p)), from, -(to - from));

  let bpm = s.bpm;
  let tempoPoints = s.tempoPoints;
  const glided = s.tempoPoints.length ? deleteTempo(s, from, to, newId) : null;
  if (glided) ({ bpm, tempoPoints } = glided);
  else if (s.tempoPoints.length) {
    const was = { bpm: s.bpm, points: s.tempoPoints };
    const keep = tempoAt(to, was);
    tempoPoints = sortedPoints(shift(s.tempoPoints));
    if (s.tempoPoints.some(held)) {
      if (fromStart) {
        // From bar 1: the song starts at the tempo the music after the deleted bars had
        if (Math.abs(keep - s.bpm) > 1e-6) bpm = clampBpm(keep);
      } else if (Math.abs(tempoAt(from - 1e-6, { bpm, points: tempoPoints }) - keep) > 1e-6 && !tempoPoints.some((p) => Math.abs(p.bar - from) < 1e-6)) {
        tempoPoints = sortedPoints([...tempoPoints, { id: newId('tempo'), bar: from, bpm: keep, ramp: false }]);
      }
    }
  }

  let meter = s.meter;
  let meterPoints = s.meterPoints;
  if (s.meterPoints.length) {
    const keep = meterAt(to, { base: s.meter, points: s.meterPoints });
    let points = shift(s.meterPoints);
    if (s.meterPoints.some(held)) {
      if (fromStart) {
        // From bar 1: the song's own time signature is the one the music after the deleted bars had
        if (!sameMeter(keep, s.meter)) meter = { num: keep.num, den: keep.den };
      } else if (!points.some((p) => Math.abs(p.bar - from) < 1e-6)) {
        points = [...points, { id: newId('meter'), bar: from, num: keep.num, den: keep.den }];
      }
    }
    meterPoints = tidyMeters(points, meter);
  }
  return { bpm, tempoPoints, meter, meterPoints };
}

/**
 * The tempo after inserting `bars` bars at `at` when a glide is under way there (or ends right
 * there), else null: the glide ends just before `at` at the tempo it had reached (the music before
 * keeps its timing), the inserted bars hold that, and the music after them starts at the tempo it
 * had at `at` and goes on with the rest of the glide.
 */
function insertTempo(s: SongTime, at: number, bars: number, newId: NewPointId): TempoPoint[] | null {
  const was = { bpm: s.bpm, points: s.tempoPoints };
  if (at <= 1 + EPS) {
    // At bar 1: a glide from there starts again after the inserted bars, at the song's tempo
    if (!tempoFrom(1, was).glide) return null;
    return sortedPoints([{ id: newId('tempo'), bar: 1 + bars, bpm: s.bpm, ramp: false }, ...s.tempoPoints.map((p) => ({ ...p, bar: p.bar + bars }))]);
  }
  if (!glidingAt(at - CUT, was)) return null;
  const out = endGlide(s.tempoPoints.filter((p) => p.bar < at - EPS), at, was, newId);
  const later = s.tempoPoints.filter((p) => p.bar >= at - EPS).map((p) => ({ ...p, bar: p.bar + bars, ramp: Math.abs(p.bar - at) < EPS ? false : p.ramp }));
  if (!later.some((p) => Math.abs(p.bar - at - bars) < EPS)) later.push({ id: newId('tempo'), bar: at + bars, bpm: tempoAt(at, was), ramp: false });
  return sortedPoints([...out, ...later]);
}

/**
 * The tempo after deleting bars `from` to `to` when a glide runs across either end (or ends right
 * at one), else null: a glide under way at `from` ends just before it at the tempo it had reached
 * (the music before keeps its timing), and the music after the deleted bars starts at `from` at the
 * tempo it had at `to`, going on with the rest of any glide under way there.
 */
function deleteTempo(s: SongTime, from: number, to: number, newId: NewPointId): { bpm: number; tempoPoints: TempoPoint[] } | null {
  const was = { bpm: s.bpm, points: s.tempoPoints };
  const atTo = s.tempoPoints.find((p) => Math.abs(p.bar - to) < EPS);
  const intoFrom = glidingAt(from - CUT, was);
  const acrossTo = !atTo && glidingAt(to, was);
  if (!intoFrom && !acrossTo && !atTo?.ramp) return null;
  const keep = tempoAt(to, was);
  const len = to - from;
  let points = s.tempoPoints.filter((p) => p.bar < from - EPS);
  if (intoFrom) points = endGlide(points, from, was, newId);
  const later = s.tempoPoints.filter((p) => p.bar >= to - EPS).map((p) => (p === atTo ? { ...p, bar: from, ramp: false } : { ...p, bar: p.bar - len }));
  if (from <= 1 + EPS) {
    // From bar 1: the song starts at the tempo the music after the deleted bars had
    return { bpm: Math.abs(keep - s.bpm) > 1e-6 ? clampBpm(keep) : s.bpm, tempoPoints: sortedPoints(later) };
  }
  if (!atTo && (acrossTo || Math.abs(tempoAt(from - EPS, { bpm: s.bpm, points }) - keep) > 1e-6)) later.push({ id: newId('tempo'), bar: from, bpm: keep, ramp: false });
  return { bpm: s.bpm, tempoPoints: sortedPoints([...points, ...later]) };
}

/** A stretch of the song as it was, `len` bars from `src`, laid at the next place in a new order. */
export interface PlacedStretch {
  src: number;
  len: number;
}

/**
 * The tempo and time signatures of a song whose bars from `from` on were laid out anew: the
 * stretches `pieces` one after another from `from` (to `from` + their lengths, `to`), then the
 * song as it was from `after` on. Before `from` nothing changes. Each stretch keeps the meter and
 * tempo it had at its start and its changes inside it; the music after `to` keeps those it had at
 * `after`. Pocket's Move (the two sections swapped, `after` where they ended), Play it twice (a
 * section after itself, `after` where it ended) and the Beat switch use it once their bars are
 * in place. Null when the song has no tempo or time signature changes (there's nothing to move).
 */
export function placeSongTime(was: SongTime, from: number, pieces: readonly PlacedStretch[], after: number, newId: NewPointId): SongTime | null {
  if (!was.tempoPoints.length && !was.meterPoints.length) return null;
  const to = pieces.reduce((at, p) => at + p.len, from);
  const oldTempo = { bpm: was.bpm, points: was.tempoPoints };
  const oldMeter = { base: was.meter, points: was.meterPoints };
  const within = (bar: number, src: number, len: number) => bar > src + EPS && bar < src + len - EPS;
  const later = to - after;

  // Time signatures: those before `from`, each stretch's (its own at its start), those from `after` on
  const meters: MeterPoint[] = was.meterPoints.filter((p) => p.bar < from - EPS);
  let at = from;
  for (const p of pieces) {
    meters.push({ id: newId('meter'), bar: at, ...meterAt(p.src, oldMeter) });
    for (const q of was.meterPoints) if (within(q.bar, p.src, p.len)) meters.push({ ...q, id: newId('meter'), bar: q.bar - p.src + at });
    at += p.len;
  }
  const meterAfter = was.meterPoints.filter((p) => p.bar >= after - EPS).map((p) => ({ ...p, bar: p.bar + later }));
  if (!meterAfter.some((p) => Math.abs(p.bar - to) < EPS)) meters.push({ id: newId('meter'), bar: to, ...meterAt(after, oldMeter) });
  meters.push(...meterAfter);
  // (laid from bar 1: the first stretch's meter is the song's own)
  const firstMeter = from <= 1 + EPS && pieces.length ? meterAt(pieces[0].src, oldMeter) : was.meter;
  const meter = sameMeter(firstMeter, was.meter) ? was.meter : { num: firstMeter.num, den: firstMeter.den };
  const meterPoints = tidyMeters(meters, meter);

  // Tempos the same way, a glide still under way at a stretch's end going as far as it got there
  // (a glide under way at `from`, or ending there, ends just before it as far as it got)
  const before = was.tempoPoints.filter((p) => p.bar < from - EPS);
  const tempos: TempoPoint[] = glidingAt(from - CUT, oldTempo) ? endGlide(before, from, oldTempo, newId) : before;
  at = from;
  for (const p of pieces) {
    tempos.push({ id: newId('tempo'), bar: at, bpm: tempoAt(p.src, oldTempo), ramp: false });
    for (const q of was.tempoPoints) if (within(q.bar, p.src, p.len)) tempos.push({ ...q, id: newId('tempo'), bar: q.bar - p.src + at });
    if (tempoFrom(p.src + p.len - CUT, oldTempo).glide) tempos.push({ id: newId('tempo'), bar: at + p.len - CUT, bpm: tempoAt(p.src + p.len - CUT, oldTempo), ramp: true });
    at += p.len;
  }
  // (a glide that ended at `after` is over: the music from there starts at the tempo it reached)
  const tempoAfter = was.tempoPoints.filter((p) => p.bar >= after - EPS).map((p) => (p.ramp && Math.abs(p.bar - after) < EPS ? { ...p, bar: p.bar + later, ramp: false } : { ...p, bar: p.bar + later }));
  if (!tempoAfter.some((p) => Math.abs(p.bar - to) < EPS)) tempos.push({ id: newId('tempo'), bar: to, bpm: tempoAt(after, oldTempo), ramp: false });
  tempos.push(...tempoAfter);
  const bpm = from <= 1 + EPS && pieces.length ? clampBpm(tempoAt(pieces[0].src, oldTempo)) : was.bpm;
  // From `from` on, a jump that changes nothing goes (unless a glide starts from it)
  const sorted = sortedPoints(tempos);
  const tempoPoints: TempoPoint[] = [];
  let current = bpm;
  sorted.forEach((p, i) => {
    if (p.bar >= from - EPS && !p.ramp && Math.abs(p.bpm - current) < 1e-6 && !sorted[i + 1]?.ramp) return;
    tempoPoints.push(p);
    current = p.bpm;
  });
  return { bpm, tempoPoints, meter, meterPoints };
}
