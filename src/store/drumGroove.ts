/**
 * Swing per drum row: a clip's groove (ClipGroove) can give each row (each note name: the hats,
 * the ride) its own swing, a push or drag in time and a velocity, so the hats swing while the kick
 * and snare stay straight; and the groove templates (straight, light swing, heavy swing, lazy,
 * pushed) that set those per row in one pick, and putting a measured feel (grooveFeels.ts) on a
 * clip's groove (withFeel). The clip schedule (scheduler.ts) plays them; this is
 * the plain logic, so Node can test it.
 */
import type { ClipGroove, RowFeel } from './timelineTypes';
import type { ClipFeel } from './grooveFeels';
import { MAX_CLIP_SWING } from './timelineTypes';
import { normalizeClipFeel } from './grooveFeels';

/** The drum rows' notes the templates set (as DRUM_NOTES in instruments.ts). */
const SNARE = 'D1';
const CLAP = 'D#1';
const CLOSED_HAT = 'F#1';
const OPEN_HAT = 'A#1';
const RIDE = 'D#2';
const PERC = 'G#2';
const HATS = [CLOSED_HAT, OPEN_HAT, RIDE, PERC];

/** How far a row may play early or late, as a share of a 16th note */
export const MAX_ROW_SHIFT = 0.25;
/** A row's velocity scales, lowest and highest */
export const ROW_VEL_RANGE: [number, number] = [0.4, 1.25];

/** One template: its name, what it does, and the groove it sets. */
export interface GrooveTemplate {
  id: string;
  name: string;
  about: string;
  groove: ClipGroove;
}

const rows = (notes: string[], feel: RowFeel): Record<string, RowFeel> => Object.fromEntries(notes.map((n) => [n, { ...feel }]));

/**
 * The groove templates: each keeps the kick (and, but for Lazy, the snare) straight and on time
 * and moves the hats and percussion; off-beat hats a little softer, as a drummer plays them.
 */
export const GROOVE_TEMPLATES: readonly GrooveTemplate[] = [
  { id: 'straight', name: 'Straight', about: 'Every row on the grid, even velocities', groove: { swing: 0, grid: 16, template: 'straight' } },
  {
    id: 'lightSwing',
    name: 'Light swing (hats)',
    about: 'Hats and percussion swing a little; kick and snare straight',
    groove: { swing: 0, grid: 16, template: 'lightSwing', rows: rows(HATS, { swing: 0.22, offbeat: 0.85 }) },
  },
  {
    id: 'heavySwing',
    name: 'Heavy swing (hats)',
    about: 'Hats and percussion shuffle hard; kick and snare straight',
    groove: { swing: 0, grid: 16, template: 'heavySwing', rows: rows(HATS, { swing: 0.5, offbeat: 0.72 }) },
  },
  {
    id: 'lazy',
    name: 'Lazy (laid back)',
    about: 'Snare and clap a hair late, hats swung and late; kick on the grid',
    groove: { swing: 0, grid: 16, template: 'lazy', rows: { ...rows(HATS, { swing: 0.3, shift: 0.06, offbeat: 0.8 }), [SNARE]: { shift: 0.1 }, [CLAP]: { shift: 0.12 } } },
  },
  {
    id: 'pushed',
    name: 'Pushed (ahead)',
    about: 'Hats rush ahead of the beat with accented off-beats; kick and snare on the grid',
    groove: { swing: 0, grid: 16, template: 'pushed', rows: rows(HATS, { shift: -0.08, offbeat: 1.1, vel: 0.95 }) },
  },
];

/** A template's groove by id (a copy). */
export function grooveTemplate(id: string): ClipGroove | undefined {
  const t = GROOVE_TEMPLATES.find((g) => g.id === id);
  return t ? structuredClone(t.groove) : undefined;
}

/** The row's own feel in `groove`, if it has one. */
export const rowFeelOf = (groove: ClipGroove | undefined, note: string): RowFeel | undefined => groove?.rows?.[note];

/** Is a note at `tick` off the 8th-note grid (an off-beat 16th, a triplet, a roll)? */
export const offTheEighth = (tick: number, ppq = 192): boolean => tick % (ppq / 2) !== 0;

/** A note's velocity under its row's feel: the row's scale, and the off-beat scale off the 8ths (0.05 to 1). */
export function feelVelocity(feel: RowFeel | undefined, velocity: number, tick: number, ppq = 192): number {
  if (!feel) return velocity;
  const v = velocity * (feel.vel ?? 1) * (offTheEighth(tick, ppq) ? (feel.offbeat ?? 1) : 1);
  return Math.max(0.05, Math.min(1, v));
}

/** Seconds a row's shift moves its notes (negative: early) at `bpm`. */
export const feelShiftSeconds = (feel: RowFeel | undefined, bpm: number): number => (feel?.shift ? (feel.shift * 15) / bpm : 0);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);

/** A row's feel from a file (undefined if it has nothing in it). */
export function normalizeRowFeel(v: unknown): RowFeel | undefined {
  if (!isObj(v)) return undefined;
  const swing = num(v.swing, 0, MAX_CLIP_SWING);
  const shift = num(v.shift, -MAX_ROW_SHIFT, MAX_ROW_SHIFT);
  const vel = num(v.vel, ...ROW_VEL_RANGE);
  const offbeat = num(v.offbeat, ...ROW_VEL_RANGE);
  const out: RowFeel = {
    ...(swing !== undefined ? { swing } : {}),
    ...(v.grid === 8 || v.grid === 16 ? { grid: v.grid } : {}),
    ...(shift ? { shift } : {}),
    ...(vel !== undefined && vel !== 1 ? { vel } : {}),
    ...(offbeat !== undefined && offbeat !== 1 ? { offbeat } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** A clip's groove from a file, or undefined (the song's swing). */
export function normalizeClipGroove(v: unknown): ClipGroove | undefined {
  if (!isObj(v) || typeof v.swing !== 'number' || !Number.isFinite(v.swing) || (v.grid !== 8 && v.grid !== 16)) return undefined;
  const out: ClipGroove = { swing: Math.max(0, Math.min(MAX_CLIP_SWING, v.swing)), grid: v.grid };
  if (isObj(v.rows)) {
    const r: Record<string, RowFeel> = {};
    for (const [note, feel] of Object.entries(v.rows).slice(0, 64)) {
      const f = /^[A-G]#?-?\d$/.test(note) ? normalizeRowFeel(feel) : undefined;
      if (f) r[note] = f;
    }
    if (Object.keys(r).length) out.rows = r;
  }
  if (typeof v.template === 'string' && GROOVE_TEMPLATES.some((t) => t.id === v.template)) out.template = v.template;
  const feel = v.feel !== undefined ? normalizeClipFeel(v.feel) : undefined;
  if (feel) out.feel = feel;
  return out;
}

/** `groove` with `note`'s row feel changed (or removed, with nothing left in it); the template mark goes. */
export function withRowFeel(groove: ClipGroove, note: string, feel: RowFeel): ClipGroove {
  const { template: _t, rows: old, ...rest } = groove;
  const clean = normalizeRowFeel(feel);
  const next = { ...(old ?? {}) };
  if (clean) next[note] = clean;
  else delete next[note];
  return Object.keys(next).length ? { ...rest, rows: next } : rest;
}

/**
 * `groove` with a measured feel put on (or, with null, taken off). The feel takes the place of the
 * clip's swing (it carries its own); a drum row's own settings stay. Taken off with nothing else
 * left, the clip goes back to the song's swing (null).
 */
export function withFeel(groove: ClipGroove | undefined, feel: ClipFeel | null): ClipGroove | null {
  if (feel) {
    const { template: _t, ...rest } = groove ?? { swing: 0, grid: 16 as const };
    return { ...rest, swing: 0, feel };
  }
  if (!groove) return null;
  const { feel: _f, ...rest } = groove;
  return rest.swing === 0 && !rest.rows && !rest.template && groove.feel ? null : rest;
}
