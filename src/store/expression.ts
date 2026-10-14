import type { Clip, ClipExpression, ExprPoint } from './timelineTypes';
import { barsToDuration, durationToBars } from './timelineTypes';

/**
 * Expression: a note clip's controller lanes, as a MIDI keyboard's wheels and pedal would play them.
 * - Pitch bend (semitones): every note on the track bends together, gliding between points.
 * - Mod wheel (0 to 1): vibrato, as deep as the wheel is up.
 * - Sustain pedal (down or up): a note let go while the pedal is down rings on until it comes up.
 * Before a lane's first point it rests (no bend, wheel down, pedal up). Pure, so it's unit tested
 * (scripts/expression.test.mjs).
 */

export type ExprLane = keyof ClipExpression;
interface LaneSpec {
  lane: ExprLane;
  label: string;
  min: number;
  max: number;
  step: boolean;
}
export const EXPR_LANES: ReadonlyArray<LaneSpec> = [
  { lane: 'bend', label: 'Pitch bend', min: -12, max: 12, step: false },
  { lane: 'mod', label: 'Mod wheel (dynamics)', min: 0, max: 1, step: false },
  { lane: 'vibrato', label: 'Vibrato', min: 0, max: 1, step: false },
  { lane: 'sustain', label: 'Sustain pedal', min: 0, max: 1, step: true },
];

/** Common controllers' names (the General MIDI ones, and those synths and pad controllers often use). */
export const CC_NAMES: Readonly<Record<number, string>> = {
  2: 'Breath',
  4: 'Foot',
  5: 'Portamento time',
  7: 'Volume',
  8: 'Balance',
  10: 'Pan',
  11: 'Expression',
  71: 'Resonance',
  72: 'Release',
  73: 'Attack',
  74: 'Cutoff',
  91: 'Reverb',
  93: 'Chorus',
};
/** A controller lane's name, e.g. 'cc74'. */
export const ccLane = (cc: number): ExprLane => `cc${cc}` as ExprLane;
/** The controller number of a lane ('cc74' -> 74), or null for bend / mod / sustain. */
export const laneCc = (lane: string): number | null => {
  const m = /^cc(\d{1,3})$/.exec(lane);
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 0 && n < 120 ? n : null;
};
export const ccLabel = (cc: number) => `CC ${cc}${CC_NAMES[cc] ? ` ${CC_NAMES[cc]}` : ''}`;

/** A lane's range and name (a controller's: 0 to 1, gliding). */
export function exprSpec(lane: ExprLane): LaneSpec {
  const fixed = EXPR_LANES.find((l) => l.lane === lane);
  if (fixed) return fixed;
  const cc = laneCc(lane) ?? 0;
  return { lane, label: ccLabel(cc), min: 0, max: 1, step: false };
}

/** Every lane a clip has: the fixed ones, then its controllers by number. */
export const lanesOf = (expression: ClipExpression | undefined): ExprLane[] =>
  expression ? (Object.keys(expression) as ExprLane[]).filter((l) => EXPR_LANES.some((f) => f.lane === l) || laneCc(l) !== null) : [];

/** Vibrato at full mod wheel: this many cents either way, this fast. */
export const VIBRATO_CENTS = 50;
export const VIBRATO_HZ = 5.5;

const EPS = 1e-9;

/** The lane's value `at` bars into the clip: resting before its first point, gliding (or stepping) between points. */
export function exprValueAt(points: readonly ExprPoint[] | undefined, at: number, step = false): number {
  if (!points?.length || at < points[0].at - EPS) return 0;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.at <= at + EPS) {
      const next = points[i + 1];
      if (!next || step) return p.value;
      const u = (at - p.at) / Math.max(EPS, next.at - p.at);
      return p.value + (next.value - p.value) * u;
    }
  }
  return 0;
}

/** Points in order, clamped to the lane's range, one per position (the last written wins). */
export function tidyLane(points: readonly ExprPoint[], lane: ExprLane): ExprPoint[] {
  const { min, max, step } = exprSpec(lane);
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.at) && Number.isFinite(p.value))
    .map((p) => ({ at: Math.max(0, p.at), value: step ? (p.value >= 0.5 ? 1 : 0) : Math.max(min, Math.min(max, p.value)) }))
    .sort((a, b) => a.at - b.at);
  return sorted.filter((p, i) => i === sorted.length - 1 || sorted[i + 1].at - p.at > 1e-6);
}

/** True when the clip has any expression that changes how it plays. */
export function hasExpression(clip: Pick<Clip, 'expression'>): boolean {
  const e = clip.expression;
  return !!e && (['bend', 'mod', 'vibrato', 'sustain'] as const).some((k) => e[k]?.some((p) => p.value !== 0));
}

/**
 * Where a note let go at `end` (bars into the clip) stops sounding: there, or where the pedal
 * comes up if it's down then (the clip's end at the latest).
 */
export function sustainedEnd(sustain: readonly ExprPoint[] | undefined, end: number, clipLength: number): number {
  if (!sustain?.length || exprValueAt(sustain, end, true) < 0.5) return end;
  const up = sustain.find((p) => p.at > end + EPS && p.value < 0.5);
  return Math.min(up ? up.at : clipLength, clipLength);
}

/** The clip's notes with the sustain pedal applied: notes let go while it's down are held until it's up. */
export function sustainNotes<N extends { startOffset: number; duration: string }>(notes: readonly N[], sustain: readonly ExprPoint[] | undefined, clipLength: number): N[] {
  if (!sustain?.some((p) => p.value >= 0.5)) return notes as N[];
  return notes.map((n) => {
    const end = n.startOffset + durationToBars(n.duration);
    const held = sustainedEnd(sustain, end, clipLength);
    return held > end + 1e-6 ? { ...n, duration: barsToDuration(held - n.startOffset) } : n;
  });
}

/**
 * One expression event: from `at` bars into the clip, bend this many cents, vibrato this deep
 * (0 to 1), and the mod wheel's dynamics (0 soft to 1 loud) when the clip has a mod wheel lane.
 */
export interface PitchEvent {
  /** The clip's end: back to rest (it goes before a clip starting at the same moment) */
  end?: boolean;
  at: number;
  cents: number;
  vib: number;
  dyn?: number;
  /** The clip has a bend or vibrato lane (else these events only carry the dynamics) */
  pitch?: boolean;
}

/**
 * The events that play the clip's bend, vibrato and mod wheel (dynamics): every `step` bars where
 * one moves (or the vibrato is up, for it to be drawn), and a reset to rest at the clip's end.
 * None when all rest throughout.
 */
export function pitchEvents(clip: Pick<Clip, 'lengthBars' | 'expression'>, step = 1 / 128): PitchEvent[] {
  const bend = clip.expression?.bend;
  const vibrato = clip.expression?.vibrato;
  const mod = clip.expression?.mod;
  const wheel = !!mod?.some((p) => p.value !== 0);
  if (!bend?.some((p) => p.value !== 0) && !vibrato?.some((p) => p.value !== 0) && !wheel) return [];
  const out: PitchEvent[] = [];
  const pitch = !!bend?.some((p) => p.value !== 0) || !!vibrato?.some((p) => p.value !== 0);
  let last: PitchEvent | null = null;
  const len = clip.lengthBars;
  for (let k = 0; k * step < len - EPS; k++) {
    const at = k * step;
    const ev: PitchEvent = { at, cents: exprValueAt(bend, at) * 100, vib: exprValueAt(vibrato, at), ...(wheel ? { dyn: exprValueAt(mod, at) } : {}), ...(pitch ? { pitch } : {}) };
    // Steady and without vibrato: nothing new to say (but a held value, at rest included, is said
    // again every 16th, so playback started or looped back into it is put right at once)
    const steady = !last || ev.dyn === undefined || Math.abs(ev.dyn - (last.dyn ?? 0)) < 0.002;
    if (last && steady && ev.vib === 0 && last.vib === 0 && Math.abs(ev.cents - last.cents) < 0.01 && at - last.at < 1 / 16 - EPS) continue;
    out.push(ev);
    last = ev;
  }
  if (last && (last.cents !== 0 || last.vib !== 0 || last.dyn !== undefined)) out.push({ at: len, cents: 0, vib: 0, end: true, ...(pitch ? { pitch } : {}) });
  return out;
}

/** The bend in cents at audio time `time` for an event: its bend plus the vibrato's swing then. */
export const pitchCents = (ev: PitchEvent, time: number) => ev.cents + (ev.vib ? ev.vib * VIBRATO_CENTS * Math.sin(2 * Math.PI * VIBRATO_HZ * time) : 0);

/** Expression lanes from a project file (absent when there are none). */
export function normalizeExpression(raw: unknown): ClipExpression | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const out: ClipExpression = {};
  const lanes = [...EXPR_LANES.map((l) => l.lane), ...(Object.keys(raw).filter((k) => laneCc(k) !== null) as ExprLane[])];
  for (const lane of lanes) {
    const v = (raw as Record<string, unknown>)[lane];
    if (!Array.isArray(v)) continue;
    const points = tidyLane(
      v.filter((p): p is ExprPoint => typeof p === 'object' && p !== null && typeof p.at === 'number' && typeof p.value === 'number'),
      lane
    );
    if (points.length) out[lane] = points;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The clip's lanes moved `shift` bars later (negative: earlier, as when its start is trimmed later)
 * and cut to [0, length): each lane keeps its value at the new start with a point there.
 */
export function shiftExpression(expression: ClipExpression | undefined, shift: number, length: number): ClipExpression | undefined {
  if (!expression) return undefined;
  const out: ClipExpression = {};
  for (const lane of lanesOf(expression)) {
    const { step } = exprSpec(lane);
    const points = expression[lane];
    if (!points?.length) continue;
    const startValue = exprValueAt(points, -shift, step);
    const moved = points.map((p) => ({ at: p.at + shift, value: p.value })).filter((p) => p.at > EPS && p.at < length - EPS);
    const next = [...(startValue !== 0 || moved.length ? [{ at: 0, value: startValue }] : []), ...moved];
    if (next.some((p) => p.value !== 0)) out[lane] = next;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The lanes' points moved by `shift` bars, none dropped (a trim keeps what it hides, as it does notes). */
export function moveExpression(expression: ClipExpression | undefined, shift: number): ClipExpression | undefined {
  if (!expression) return undefined;
  const out: ClipExpression = {};
  for (const lane of lanesOf(expression)) {
    const points = expression[lane];
    if (points) out[lane] = points.map((p) => ({ at: p.at + shift, value: p.value }));
  }
  return out;
}
