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
 * started, and from bar 1 becomes the song's own. Unchanged parts are the same objects.
 */
export function rippleSongTime(s: SongTime, edit: RippleEdit, newId: NewPointId): SongTime {
  if (edit.kind === 'insert') {
    const shift = <P extends { bar: number }>(points: P[]): P[] => points.map((p) => (p.bar >= edit.at - EPS ? { ...p, bar: p.bar + edit.bars } : p));
    return {
      bpm: s.bpm,
      tempoPoints: s.tempoPoints.length ? sortedPoints(shift(s.tempoPoints)) : s.tempoPoints,
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
  if (s.tempoPoints.length) {
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
  const tempos: TempoPoint[] = was.tempoPoints.filter((p) => p.bar < from - EPS);
  at = from;
  for (const p of pieces) {
    tempos.push({ id: newId('tempo'), bar: at, bpm: tempoAt(p.src, oldTempo), ramp: false });
    for (const q of was.tempoPoints) if (within(q.bar, p.src, p.len)) tempos.push({ ...q, id: newId('tempo'), bar: q.bar - p.src + at });
    if (tempoFrom(p.src + p.len - 1e-3, oldTempo).glide) tempos.push({ id: newId('tempo'), bar: at + p.len - 1e-3, bpm: tempoAt(p.src + p.len - 1e-3, oldTempo), ramp: true });
    at += p.len;
  }
  const tempoAfter = was.tempoPoints.filter((p) => p.bar >= after - EPS).map((p) => ({ ...p, bar: p.bar + later }));
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
