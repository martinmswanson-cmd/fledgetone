import { barToSeconds, measureAt, meterAt, sortedPoints, tempoAt, MAX_BPM } from '../audio/tempoMap';
import type { MeterMap, Tempo, TempoMap, TempoPoint } from '../audio/tempoMap';
import type { NoteEvent } from './timelineTypes';
import { barsToDuration } from './timelineTypes';
import { roll } from './noteTools';

/**
 * Speed up into the drop: the tempo rises over the last part of a block of music (a share of it,
 * in whole beats) and, by default, snaps back to the old tempo on the drop. Written as ordinary
 * tempo points, so live playback, every export, the metronome, recording and the grid follow it,
 * and Undo puts the old map back. Also the drum roll that can go with it (the snare or clap
 * turning into 8ths, then 16ths, then 32nds) and where audio clips that follow the tempo are cut
 * so each piece starts on its beat (each plays at the tempo where it starts).
 *
 * A glide in the tempo map is linear in time (tempoMap.ts). "Steady" is one glide; "slow then
 * fast" is BUILD_STEPS glides along a squared curve, so the tempo creeps up and then rushes. The
 * stretch before the speed-up is kept to the sample: the speed-up starts with a point holding
 * the tempo there (a glide's end, if the map was gliding through it), and the snap back puts the
 * tempo the old map had at the drop, so whatever followed the drop plays as before.
 *
 * Positions are bars (four quarter notes, 1-based). Pure, so Node tests it (scripts/speedUp.test.mjs).
 */

/** How the tempo rises: evenly in time, or slowly at first and fast at the end (the classic build). */
export type SpeedCurve = 'steady' | 'build';

export interface SpeedUpOptions {
  /** The block of music, in bars: the speed-up ends at `to` (the drop) */
  from: number;
  to: number;
  /** How much of the block speeds up, its last share (0.1 to 1) */
  share: number;
  /** How much faster at the end (0.25: 25% faster; at most 1, double time) */
  amount: number;
  curve: SpeedCurve;
  /** Back to the old tempo on the drop (else it stays at the new speed) */
  snapBack: boolean;
}

export const SPEED_UP_DEFAULTS = { share: 0.25, amount: 0.25, curve: 'steady' as SpeedCurve, snapBack: true };
export const SPEED_CURVES: ReadonlyArray<{ id: SpeedCurve; name: string }> = [
  { id: 'steady', name: 'Steady' },
  { id: 'build', name: 'Slow, then fast' },
];
/** Glides that draw the "slow, then fast" curve. */
export const BUILD_STEPS = 4;
/** With a snap back, the top tempo is reached this long (a 32nd) before the drop and held to it. */
export const SNAP_LEAD = 1 / 32;

const EPS = 1e-6;

/** The curve's height at `x` (0 where the speed-up starts, 1 at its end): the share of the rise reached. */
export const curveAt = (curve: SpeedCurve, x: number): number => (curve === 'build' ? x * x : x);

/** A beat's length in bars in the meter at `bar` (a quarter in 4/4, an 8th in 6/8). */
export const beatBars = (bar: number, meter: MeterMap): number => 1 / meterAt(bar, meter).den;

/**
 * Where the speed-up starts: the last `share` of [from, to), in whole beats (at least one), so it
 * starts on a beat. `beats` is its length in beats.
 */
export function rampStart(from: number, to: number, share: number, meter: MeterMap): { start: number; beats: number } {
  const len = to - from;
  const beat = beatBars(to - EPS, meter);
  const most = Math.max(1, Math.floor(len / beat + EPS));
  if (share >= 1 - EPS || len <= beat + EPS) return { start: from, beats: Math.max(1, Math.round(len / beat)) };
  const beats = Math.min(most, Math.max(1, Math.round((len * share) / beat)));
  return { start: to - beats * beat, beats };
}

/** A length in beats as measures and beats, in the meter at `bar`: "1 bar 2 beats", "3 beats". */
export function describeBeats(beats: number, bar: number, meter: MeterMap): string {
  const per = meterAt(bar, meter).num;
  const bars = Math.floor(beats / per + EPS);
  const rest = Math.round(beats - bars * per);
  const parts = [];
  if (bars) parts.push(`${bars} bar${bars === 1 ? '' : 's'}`);
  if (rest || !bars) parts.push(`${rest} beat${rest === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** A position as "measure.beat" in the meter there ("8.3": measure 8, beat 3). */
export function barBeat(bar: number, meter: MeterMap): string {
  const m = measureAt(bar + EPS, meter);
  const beat = Math.floor((bar - m.start) * m.meter.den + EPS) + 1;
  return beat === 1 ? `${m.measure}` : `${m.measure}.${beat}`;
}

export interface SpeedUpPlan {
  points: TempoPoint[];
  /** Where the speed-up starts, where it reaches the top tempo, and the drop */
  start: number;
  top: number;
  drop: number;
  beats: number;
  /** The tempo where it starts and the tempo it reaches */
  fromBpm: number;
  toBpm: number;
  /** The tempo after the drop */
  afterBpm: number;
  /** The top tempo was held at the app's limit */
  capped: boolean;
  /** Tempo changes that were inside the speed-up and are replaced */
  replaced: number;
}

/**
 * The tempo points with the speed-up written in, or why it can't be. Tempo changes inside the
 * speed-up (after its start, up to the drop) are replaced; everything else stays.
 */
export function speedUpPoints(points: readonly TempoPoint[], tempo: Tempo, meter: MeterMap, opts: SpeedUpOptions, newId: () => string): SpeedUpPlan | string {
  const { from, to, curve, snapBack } = opts;
  if (!(to - from >= 1 / 16 - EPS)) return 'Pick a block at least a beat long: the end must come after the start.';
  if (from < 1 - EPS) return 'The block starts before bar 1.';
  const share = Math.max(0.1, Math.min(1, opts.share));
  const amount = Math.max(0, Math.min(1, opts.amount));
  if (amount < 0.005) return 'Pick how much faster it gets.';
  const { start, beats } = rampStart(from, to, share, meter);
  const top = snapBack ? to - Math.min(SNAP_LEAD, (to - start) / 4) : to;
  const map: TempoMap = typeof tempo === 'number' ? { bpm: tempo, points: [] } : tempo;
  const fromBpm = tempoAt(start, map);
  const afterBpm = tempoAt(to, map);
  const wanted = fromBpm * (1 + amount);
  const toBpm = Math.min(MAX_BPM, wanted);
  const capped = toBpm < wanted - 0.005;
  if (toBpm <= fromBpm + 0.005) return `The tempo there is already ${Math.round(fromBpm)} BPM, the fastest the app plays.`;

  // Is the old map gliding into the start? Then the held point is a glide too, so it stays the same curve
  const before = sortedPoints(map.points).filter((p) => p.bar < start - EPS);
  const next = sortedPoints(map.points).find((p) => p.bar > start - EPS);
  const glidingIn = !!next?.ramp && Math.abs(next.bpm - (before.length ? before[before.length - 1].bpm : map.bpm)) > EPS;
  const added: TempoPoint[] = [];
  if (start > 1 + EPS) added.push({ id: newId(), bar: start, bpm: fromBpm, ramp: glidingIn });
  const steps = curve === 'build' ? BUILD_STEPS : 1;
  for (let i = 1; i <= steps; i++) {
    const x = i / steps;
    const bpm = fromBpm + (toBpm - fromBpm) * curveAt(curve, x);
    added.push({ id: newId(), bar: start + (top - start) * x, bpm: Math.round(bpm * 100) / 100, ramp: true });
  }
  if (snapBack) added.push({ id: newId(), bar: to, bpm: afterBpm, ramp: false });

  const inside = (p: TempoPoint) => p.bar > start - EPS && p.bar < to + EPS;
  const kept = points.filter((p) => !inside(p));
  const replaced = points.filter((p) => inside(p) && !(Math.abs(p.bar - start) < EPS && Math.abs(p.bpm - fromBpm) < 0.005)).length;
  return { points: sortedPoints([...kept, ...added]), start, top, drop: to, beats, fromBpm, toBpm, afterBpm, capped, replaced };
}

// ---------- the drum roll ----------

/** The roll's rates, in bars between hits: 8ths, then 16ths, then 32nds. */
export const ROLL_STEPS = [1 / 8, 1 / 16, 1 / 32] as const;

/**
 * Where each rate of the roll plays over [start, end): the span in thirds, each edge on the 8th
 * grid from the start; under half a bar, in halves of 16ths and 32nds.
 */
export function rollSpans(start: number, end: number): Array<{ from: number; to: number; rate: number }> {
  const len = end - start;
  // Under half a bar there's no room for 8ths to mean anything: 16ths, then 32nds
  const rates = len < 0.5 - EPS ? ROLL_STEPS.slice(1) : ROLL_STEPS;
  const grid = rates[0];
  const edges = [start, ...rates.slice(1).map((_, k) => Math.min(end, start + Math.round((len * (k + 1)) / rates.length / grid) * grid)), end];
  const out: Array<{ from: number; to: number; rate: number }> = [];
  rates.forEach((rate, i) => {
    if (edges[i + 1] - edges[i] >= rate - EPS) out.push({ from: edges[i], to: edges[i + 1], rate });
  });
  return out;
}

/**
 * A roll on `note` over [start, end) (bars from wherever the caller counts), getting denser
 * (rollSpans) and louder, from 40% of `velocity` to all of it, written with the piano roll's
 * Roll tool (noteTools.roll).
 */
export function rollNotes(start: number, end: number, note: string, velocity: number, newId: () => string): NoteEvent[] {
  const len = end - start;
  if (len < 1 / 32 - EPS) return [];
  const hits = rollSpans(start, end).flatMap((s) => roll([{ id: newId(), note, startOffset: s.from, duration: barsToDuration(s.to - s.from), velocity }], s.rate, newId, { velocity: 'flat' }));
  return hits.map((h) => {
    const x = (h.startOffset - start) / len;
    return { ...h, startOffset: Math.round(h.startOffset * 1920) / 1920, velocity: Math.round(Math.min(1, velocity * (0.4 + 0.6 * x)) * 1000) / 1000 };
  });
}

// ---------- audio clips that follow the tempo ----------

/**
 * Audio pieces are cut this far (a 256th, about 8 ms at 120 BPM) before their beats: the cut's
 * 2 ms fade then falls just before a hit on the beat, not on its attack.
 */
export const CUT_LEAD = 1 / 256;

/** How far a cut audio piece may drift from the beat by its end, in seconds. */
export const MAX_PIECE_DRIFT = 0.003;

/**
 * Where audio clips that follow the tempo are cut over [start, end) so they keep time: each piece
 * plays at the tempo where it starts, so it's a beat long, or an 8th, 16th or 32nd where the tempo
 * moves so fast that a beat would drift more than MAX_PIECE_DRIFT from where the music is by its
 * end. As few cuts as that allows: each cut fades the sound out and in again over 2 ms (as any cut
 * clip does). Includes `start` and `end`.
 */
export function audioCuts(start: number, end: number, tempo: Tempo, beat: number): number[] {
  const drift = (a: number, b: number) => Math.abs(((b - a) * 240) / tempoAt(a + EPS, tempo) - (barToSeconds(b, tempo) - barToSeconds(a, tempo)));
  const cuts = [start];
  let at = start;
  while (at < end - EPS && cuts.length < 512) {
    let step = Math.min(beat, end - at);
    while (step > 1 / 32 + EPS && drift(at, at + step) > MAX_PIECE_DRIFT) step /= 2;
    at = Math.min(end, at + step);
    if (end - at < 1 / 64) at = end;
    cuts.push(at);
  }
  return cuts;
}
