/**
 * Note repeat, for finger drumming: while a pad (or a key of the computer keyboard) is held, its
 * drum plays again at a chosen rate, locked to the song's grid while it plays (to the tempo while
 * stopped), and its velocity follows how hard the pad is pressed. The rates, the grid maths and the
 * pressure curve, as plain functions; liveInput.ts and audio/noteRepeat.ts play them.
 */

/** The rates, slowest first: "T" is a triplet (three in the time of two). */
export const NOTE_REPEAT_RATES = ['1/8', '1/8T', '1/16', '1/16T', '1/32', '1/32T'] as const;
export type NoteRepeatRate = (typeof NOTE_REPEAT_RATES)[number];
export type NoteRepeatSetting = NoteRepeatRate | 'off';

/** A rate's length in quarter notes. */
const QUARTERS: Record<NoteRepeatRate, number> = { '1/8': 1 / 2, '1/8T': 1 / 3, '1/16': 1 / 4, '1/16T': 1 / 6, '1/32': 1 / 8, '1/32T': 1 / 12 };

export const isNoteRepeat = (v: unknown): v is NoteRepeatSetting => v === 'off' || (NOTE_REPEAT_RATES as readonly unknown[]).includes(v);

/** Ticks between repeats at `ppq` ticks a quarter note (a whole number at Tone's 192: 96, 64, 48, 32, 24, 16). */
export const repeatTicks = (rate: NoteRepeatRate, ppq = 192): number => Math.round(QUARTERS[rate] * ppq);

/** Seconds between repeats at `bpm`. */
export const repeatSeconds = (rate: NoteRepeatRate, bpm: number): number => (QUARTERS[rate] * 60) / bpm;

/**
 * The repeats' ticks after `after` (exclusive) up to `until` (inclusive): every multiple of `step`
 * from the song's start, so they land on the same grid as notes drawn at that rate.
 */
export function gridTicks(after: number, until: number, step: number): number[] {
  const out: number[] = [];
  for (let t = (Math.floor(after / step) + 1) * step; t <= until + 1e-9; t += step) out.push(t);
  return out;
}

/**
 * Where a held pad's first repeat may come: half a step past the tick it was struck on, so a pad
 * struck just before a grid line doesn't flam with a repeat right after it.
 */
export const firstRepeatAfter = (struckTick: number, step: number): number => struckTick + step / 2;

/**
 * A repeat's velocity: the pad's pressure (0 to 1, from aftertouch) when it sends any, on a curve
 * that keeps a light touch audible; else the velocity it was struck with.
 */
export function repeatVelocity(struck: number, pressure: number | undefined): number {
  if (pressure === undefined) return struck;
  return Math.max(0.08, Math.min(1, 0.12 + 0.88 * pressure));
}
