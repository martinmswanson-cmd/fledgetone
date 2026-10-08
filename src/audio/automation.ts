import type { AutomationLane, AutomationParam, AutomationPoint, Track } from '../store/timelineTypes';
import {
  defaultTrackFx,
  FILTER_CUTOFF_MAX,
  FILTER_CUTOFF_MIN,
  FILTER_RESONANCE_MAX,
  FILTER_RESONANCE_MIN,
  isAutomationParam,
  TOTAL_BARS,
} from '../store/timelineTypes';

/**
 * Track automation maths, shared by the lane editor, the inspector and the audio scheduler (no
 * audio here, so Node can unit-test it).
 *
 * A lane stores each point's height as a "lane value" from 0 (bottom) to 1 (top). The table
 * below turns that into the setting's own units: decibels on a fader-like scale, pan, a cutoff in
 * Hz on a log scale... Between two points the lane value moves in a straight line, so a cutoff
 * sweep is even on the log scale and a volume fade even on the fader.
 */

/** The last song position a point can sit at: the end of the timeline. */
export const LAST_BAR = TOTAL_BARS + 1;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Fader law: gain rises with the 4th power of the lane value, which puts 0 dB about 84% up, -12 dB in the middle and -60 dB 15% up, like a mixing-desk fader. */
const VOLUME_TOP_DB = 6;
/** The fader's bottom: at or below this the track is silent. */
export const VOLUME_FLOOR_DB = -60;
const volumeToReal = (n: number) => (n <= 0 ? -Infinity : VOLUME_TOP_DB + 80 * Math.log10(n));
const volumeToNorm = (db: number) => (db <= VOLUME_FLOOR_DB ? 0 : clamp01(10 ** ((db - VOLUME_TOP_DB) / 80)));

/** A log scale from lo to hi (each step up the lane is the same ratio). */
const logScale = (lo: number, hi: number) => ({
  toReal: (n: number) => lo * (hi / lo) ** clamp01(n),
  toNorm: (v: number) => clamp01(Math.log(v / lo) / Math.log(hi / lo)),
});
const cutoffScale = logScale(FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX);
const resonanceScale = logScale(FILTER_RESONANCE_MIN, FILTER_RESONANCE_MAX);

/** EQ bands run from -24 dB to +12 dB, as on the inspector's sliders. */
const EQ_MIN_DB = -24;
const EQ_MAX_DB = 12;
const eqToReal = (n: number) => EQ_MIN_DB + (EQ_MAX_DB - EQ_MIN_DB) * clamp01(n);
const eqToNorm = (db: number) => clamp01((db - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB));

const signed = (v: number, digits: number) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
export const formatDb = (db: number) => (db <= VOLUME_FLOOR_DB ? '-inf' : `${signed(db, 1)} dB`);
export const formatPan = (pan: number) => (Math.abs(pan) < 0.005 ? 'C' : `${pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(pan) * 100)}`);
/** "350 Hz", "1.25 kHz", "12.5 kHz" */
export const formatHz = (hz: number) => (hz < 999.5 ? `${Math.round(hz)} Hz` : `${(hz / 1000).toFixed(hz < 9995 ? 2 : 1)} kHz`);
const formatPercent = (v: number) => `${Math.round(v * 100)}%`;

export interface AutomationSpec {
  label: string;
  /** Lane value (0..1) to the setting's own units */
  toReal: (n: number) => number;
  /** The setting's own units to a lane value (0..1) */
  toNorm: (real: number) => number;
  /** The readout ("-6.0 dB", "L40", "1.25 kHz") */
  format: (real: number) => string;
  /** The track's own setting: what the lane replaces, and where a new lane starts */
  trackValue: (track: Track) => number;
  /** Values marked on the lane's scale, with their labels */
  scale: ReadonlyArray<{ value: number; label: string }>;
  /** Ramp up / Ramp down run between these (own units) */
  rampRange: (track: Track) => [low: number, high: number];
  /** It acts on the Filter insert, so it only sounds while that is on */
  filter?: boolean;
}

export const AUTOMATION: Record<AutomationParam, AutomationSpec> = {
  volume: {
    label: 'Volume',
    toReal: volumeToReal,
    toNorm: volumeToNorm,
    format: formatDb,
    trackValue: (t) => t.volume,
    scale: [
      { value: 0, label: '0 dB' },
      { value: -12, label: '-12' },
      { value: -24, label: '-24' },
      { value: -48, label: '-48' },
    ],
    // Silence up to the track's fader level (or 0 dB if its fader is all the way down)
    rampRange: (t) => [VOLUME_FLOOR_DB, t.volume > VOLUME_FLOOR_DB ? t.volume : 0],
  },
  pan: {
    label: 'Pan',
    toReal: (n) => 2 * clamp01(n) - 1,
    toNorm: (p) => clamp01((p + 1) / 2),
    format: formatPan,
    trackValue: (t) => t.pan,
    scale: [
      { value: 1, label: 'R' },
      { value: 0, label: 'C' },
      { value: -1, label: 'L' },
    ],
    rampRange: () => [-1, 1],
  },
  filterCutoff: {
    label: 'Filter Cutoff',
    ...cutoffScale,
    format: formatHz,
    // (Tracks built by hand may not have the Filter's settings yet)
    trackValue: (t) => (t.fx.filter ?? defaultTrackFx().filter).cutoff,
    scale: [
      { value: 10000, label: '10k' },
      { value: 1000, label: '1k' },
      { value: 100, label: '100' },
    ],
    // The classic build-up sweep: from a muffled 200 Hz to fully open
    rampRange: () => [200, FILTER_CUTOFF_MAX],
    filter: true,
  },
  filterResonance: {
    label: 'Filter Resonance',
    ...resonanceScale,
    format: (q) => `Q ${q.toFixed(2)}`,
    trackValue: (t) => (t.fx.filter ?? defaultTrackFx().filter).resonance,
    scale: [
      { value: 10, label: 'Q 10' },
      { value: 3, label: 'Q 3' },
      { value: 1, label: 'Q 1' },
    ],
    rampRange: () => [Math.SQRT1_2, FILTER_RESONANCE_MAX],
    filter: true,
  },
  reverbSend: {
    label: 'Reverb Send',
    toReal: clamp01,
    toNorm: clamp01,
    format: formatPercent,
    trackValue: (t) => t.reverbSend,
    scale: [
      { value: 1, label: '100%' },
      { value: 0.5, label: '50%' },
      { value: 0, label: '0%' },
    ],
    rampRange: () => [0, 1],
  },
  delaySend: {
    label: 'Delay Send',
    toReal: clamp01,
    toNorm: clamp01,
    format: formatPercent,
    trackValue: (t) => t.delaySend,
    scale: [
      { value: 1, label: '100%' },
      { value: 0.5, label: '50%' },
      { value: 0, label: '0%' },
    ],
    rampRange: () => [0, 1],
  },
  eqLow: eqSpec('EQ Low', 'low'),
  eqMid: eqSpec('EQ Mid', 'mid'),
  eqHigh: eqSpec('EQ High', 'high'),
};

function eqSpec(label: string, band: 'low' | 'mid' | 'high'): AutomationSpec {
  return {
    label,
    toReal: eqToReal,
    toNorm: eqToNorm,
    format: (db) => `${signed(db, 1)} dB`,
    trackValue: (t) => t.eq[band],
    scale: [
      { value: 12, label: '+12' },
      { value: 0, label: '0 dB' },
      { value: -12, label: '-12' },
    ],
    // A band killed, then back to flat (the DJ-style bass swap before a drop)
    rampRange: () => [EQ_MIN_DB, 0],
  };
}

// ---------- Reading a lane ----------

const EPS = 1e-6;

/** Index of the first point at or after `bar`. */
function firstAtOrAfter(points: readonly AutomationPoint[], bar: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].bar < bar) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first point after `bar`. */
function firstAfter(points: readonly AutomationPoint[], bar: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].bar <= bar) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const lerp = (a: AutomationPoint, b: AutomationPoint, bar: number) =>
  b.bar - a.bar < 1e-12 ? b.value : a.value + ((b.value - a.value) * (bar - a.bar)) / (b.bar - a.bar);

/**
 * The lane value at a song position, or null for a lane without points. Where two points share a
 * bar (an instant jump), it's the later one's: the value from that bar on.
 */
export function laneValueAt(points: readonly AutomationPoint[], bar: number): number | null {
  if (points.length === 0) return null;
  const i = firstAfter(points, bar);
  if (i === 0) return points[0].value;
  if (i === points.length) return points[i - 1].value;
  return lerp(points[i - 1], points[i], bar);
}

/** The value the lane arrives at `bar` with: at a jump, the earlier point's (null without points). */
export function laneValueBefore(points: readonly AutomationPoint[], bar: number): number | null {
  if (points.length === 0) return null;
  const i = firstAtOrAfter(points, bar);
  if (i === 0) return points[0].value;
  if (i === points.length) return points[i - 1].value;
  return lerp(points[i - 1], points[i], bar);
}

/** The bar of the first point after `bar` (Infinity if none). */
export function nextPointBar(points: readonly AutomationPoint[], bar: number): number {
  const i = firstAfter(points, bar);
  return i < points.length ? points[i].bar : Infinity;
}

/** The straight stretch of a lane from `bar`: up to the next point or `limitBar`, whichever is first. */
export interface LanePiece {
  endBar: number;
  /** Lane values at the start and at the end (arriving, so before any jump there) */
  from: number;
  to: number;
}

export function lanePieceFrom(points: readonly AutomationPoint[], bar: number, limitBar: number): LanePiece {
  const endBar = Math.min(nextPointBar(points, bar), limitBar);
  return { endBar, from: laneValueAt(points, bar) ?? 0, to: laneValueBefore(points, endBar) ?? 0 };
}

/** The lanes with points: the settings automation owns on this track. */
export function activeLanes(track: Pick<Track, 'automation'>): AutomationLane[] {
  return track.automation?.filter((l) => l.points.length > 0) ?? [];
}

export function laneOf(track: Pick<Track, 'automation'>, param: AutomationParam): AutomationLane | undefined {
  return track.automation?.find((l) => l.param === param);
}

// ---------- Turning a stretch into audio-param values ----------

/** How often, at most, a curve is sampled where the setting doesn't move in a straight line (seconds). */
export const CURVE_STEP = 0.01;
/**
 * How far straight lines between a curve's samples may stray from the setting's own curve, relative
 * to the value: 0.5%, under 0.05 dB of a gain or a tenth of a semitone of a cutoff.
 */
const CURVE_TOLERANCE = 0.005;

/**
 * True if `map` (lane value to a native param value) is a straight line, so a stretch of the lane
 * needs only its two ends rather than a sampled curve.
 */
export function isLinearMap(map: (n: number) => number): boolean {
  const a = map(0);
  const b = map(1);
  const span = Math.max(Math.abs(a), Math.abs(b), Math.abs(b - a), 1e-9);
  return [0.25, 0.5, 0.75].every((x) => Math.abs(map(x) - (a + (b - a) * x)) <= span * 1e-6);
}

/**
 * The native param values for a straight stretch of the lane from `from` to `to` lasting
 * `seconds`, spread evenly over it: two if `linear`, else as few as keep the straight lines between
 * them within CURVE_TOLERANCE of the setting's own curve (a slow sweep needs only its ends), but
 * never more than one every CURVE_STEP. Each one is a native call, live, on every stretch.
 */
export function sampleStretch(from: number, to: number, seconds: number, map: (n: number) => number, linear: boolean): Float32Array {
  const most = linear ? 2 : Math.max(2, Math.ceil(seconds / CURVE_STEP - 1e-9) + 1);
  const at = (count: number, k: number) => map(from + ((to - from) * k) / (count - 1));
  // Close enough if the curve's middle of every gap is near the straight line's
  const fits = (count: number) => {
    for (let k = 0; k < count - 1; k++) {
      const a = at(count, k);
      const b = at(count, k + 1);
      const mid = at(count, k + 0.5);
      if (Math.abs(mid - (a + b) / 2) > CURVE_TOLERANCE * Math.max(Math.abs(mid), Math.abs(a), Math.abs(b))) return false;
    }
    return true;
  };
  let count = 2;
  while (count < most && !fits(count)) count = Math.min(most, count * 2 - 1);
  const values = new Float32Array(count);
  for (let k = 0; k < count; k++) values[k] = at(count, k);
  return values;
}

// ---------- Editing ----------

/** Points on the timeline, values 0..1, in bar order (points sharing a bar keep their order). */
export function normalizePoints(points: readonly AutomationPoint[]): AutomationPoint[] {
  return points
    .map((p, i) => ({ p, i, bar: Math.max(1, Math.min(LAST_BAR, p.bar)) }))
    .sort((a, b) => a.bar - b.bar || a.i - b.i)
    .map(({ p, bar }) => (bar === p.bar && p.value >= 0 && p.value <= 1 ? p : { bar, value: clamp01(p.value) }));
}

/** Add a point, after any already at its bar. Returns the new list and where the point went. */
export function insertPoint(points: readonly AutomationPoint[], point: AutomationPoint): { points: AutomationPoint[]; index: number } {
  const index = firstAfter(points, point.bar);
  return { points: [...points.slice(0, index), point, ...points.slice(index)], index };
}

/**
 * How far (in bars) the points at `selected` can move together: never past a point that stays
 * put (they may land on its bar, making a jump), nor off the timeline.
 */
export function shiftRange(points: readonly AutomationPoint[], selected: ReadonlySet<number>): [min: number, max: number] {
  let min = -Infinity;
  let max = Infinity;
  let left = 1;
  for (let i = 0; i < points.length; i++) {
    if (!selected.has(i)) {
      left = points[i].bar;
      continue;
    }
    min = Math.max(min, left - points[i].bar);
  }
  let right = LAST_BAR;
  for (let i = points.length - 1; i >= 0; i--) {
    if (!selected.has(i)) {
      right = points[i].bar;
      continue;
    }
    max = Math.min(max, right - points[i].bar);
  }
  return [Math.min(0, min), Math.max(0, max)];
}

/**
 * Move the points at `selected` by `bars` and `value` together (a drag), or with `copy` (Alt) leave
 * copies where they were. Keep `bars` within shiftRange() and `value` within what keeps them 0..1.
 * Points that land on another's bar keep their side of it. Returns the moved points too (the new
 * selection).
 */
export function movePoints(
  points: readonly AutomationPoint[],
  selected: ReadonlySet<number>,
  bars: number,
  value: number,
  copy: boolean
): { points: AutomationPoint[]; moved: Set<AutomationPoint> } {
  const moved = new Set<AutomationPoint>();
  // Sorted by bar, then by where each came from: a moved point between its old neighbours, a copy
  // on the side it was left behind on
  const entries = points.map((p, i) => {
    if (!selected.has(i)) return { p, key: 3 * i + 1 };
    const next = { bar: Math.max(1, Math.min(LAST_BAR, p.bar + bars)), value: clamp01(p.value + value) };
    moved.add(next);
    return { p: next, key: 3 * i + 1 };
  });
  if (copy) for (const i of selected) entries.push({ p: points[i], key: 3 * i + (bars >= 0 ? 0 : 2) });
  entries.sort((a, b) => a.p.bar - b.p.bar || a.key - b.key);
  return { points: entries.map((e) => e.p), moved };
}

/**
 * The lane after inserting `bars` empty bars at `at` (Insert bars on the ruler): later points move
 * right with the music, and the value arriving at `at` holds across the new bars. Points pushed
 * past the end of the timeline are dropped, with one left at the end holding the value there.
 * The same array if nothing moves.
 */
export function insertLaneBars(points: AutomationPoint[], at: number, bars: number): AutomationPoint[] {
  if (bars <= 0 || !points.some((p) => p.bar >= at - EPS)) return points;
  const held = laneValueBefore(points, at)!;
  const leaving = laneValueAt(points, at)!;
  const move = (p: AutomationPoint) => ({ bar: p.bar + bars, value: p.value });
  const shifted: AutomationPoint[] = points.some((p) => p.bar < at - EPS)
    ? [
        ...points.filter((p) => p.bar < at - EPS),
        { bar: at, value: held },
        { bar: at + bars, value: held },
        ...(leaving !== held ? [{ bar: at + bars, value: leaving }] : []),
        ...points.filter((p) => p.bar > at + EPS).map(move),
      ]
    : // Nothing before the insert point: the lane holds its first value up to there anyway
      points.map(move);
  if (shifted[shifted.length - 1].bar <= LAST_BAR + EPS) return shifted;
  const end = laneValueBefore(shifted, LAST_BAR)!;
  return [...shifted.filter((p) => p.bar < LAST_BAR - EPS), { bar: LAST_BAR, value: end }];
}

/**
 * The lane after removing the bars from `from` to `to` (Delete bars In → Out): points inside go,
 * later points move left. At the cut the lane jumps from the value arriving at `from` to the one
 * leaving `to`, as the music does. The same array if nothing moves.
 */
export function removeLaneBars(points: AutomationPoint[], from: number, to: number): AutomationPoint[] {
  const length = to - from;
  if (length <= EPS || !points.some((p) => p.bar >= from - EPS)) return points;
  const arriving = laneValueBefore(points, from)!;
  const leaving = laneValueAt(points, to)!;
  return [
    ...points.filter((p) => p.bar < from - EPS),
    { bar: from, value: arriving },
    ...(leaving !== arriving ? [{ bar: from, value: leaving }] : []),
    ...points.filter((p) => p.bar > to + EPS).map((p) => ({ bar: p.bar - length, value: p.value })),
  ];
}

/** Replace the points from `from` to `to` with a straight ramp between two lane values (Ramp up / down In → Out). */
export function rampPoints(points: readonly AutomationPoint[], from: number, to: number, start: number, end: number): AutomationPoint[] {
  return [
    ...points.filter((p) => p.bar < from - EPS),
    { bar: from, value: clamp01(start) },
    { bar: to, value: clamp01(end) },
    ...points.filter((p) => p.bar > to + EPS),
  ];
}

/**
 * Lanes from a project file: known settings only (the first lane for each), points with finite
 * numbers, put on the timeline and in order. Undefined if there are none.
 */
export function parseAutomation(raw: unknown): AutomationLane[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const lanes: AutomationLane[] = [];
  for (const lane of raw) {
    if (typeof lane !== 'object' || lane === null) continue;
    const { param, points } = lane as Record<string, unknown>;
    if (!isAutomationParam(param) || lanes.some((l) => l.param === param) || !Array.isArray(points)) continue;
    const valid = points.filter(
      (p): p is AutomationPoint =>
        typeof p === 'object' && p !== null && Number.isFinite((p as AutomationPoint).bar) && Number.isFinite((p as AutomationPoint).value)
    );
    lanes.push({ param, points: normalizePoints(valid.map(({ bar, value }) => ({ bar, value }))) });
  }
  return lanes.length ? lanes : undefined;
}
