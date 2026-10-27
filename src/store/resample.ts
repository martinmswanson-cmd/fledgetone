/**
 * Resample, the plain maths: what a resample takes in (the clips chosen, the loop range across
 * every track or only some, or the whole mix), the bars it spans, and the patterns a new Slicer
 * track starts with (the slices in order, a stutter that repeats and rolls them, or a seeded
 * shuffle). No audio or store in it, so Node can unit-test it; the actions are in
 * resampleActions.ts.
 */
import { AUDIO_GAIN_MAX, AUDIO_GAIN_MIN, type Clip, type NoteEvent } from './timelineTypes';
import { sliceKey } from '../audio/slicing';
import { seededRandom } from '../audio/mangle';

/** What to resample. */
export type ResampleSource =
  /** These clips, each through its own track (its instrument, effects, level and sends) */
  | { kind: 'clips'; clipIds: string[] }
  /** Bars [from, to) of these tracks (absent: every track, the whole mix before the master) */
  | { kind: 'range'; from: number; to: number; trackIds?: string[] };

/** Where the new sound goes. */
export type ResampleTarget = 'audio' | 'slicer' | 'wavetable';
/** How a new Slicer cuts it: at its hits, or into 8 or 16 equal slices. */
export type SliceChoice = 'transients' | 8 | 16;
/** The pattern a new Slicer's clip plays. */
export type SlicePattern = 'order' | 'stutter' | 'shuffle';
/** What a new wavetable synth plays as (its starting preset). */
export type WavetableRole = 'bass' | 'lead' | 'pad';

export const ROLE_PRESETS: Record<WavetableRole, string> = { bass: 'Bass/Wobble', lead: 'Lead/Sine', pad: 'Pad/Dark' };

const EPS = 1e-6;

/** The bars a resample spans and the clips in it (null when there's nothing there). */
export function resampleSpan(source: ResampleSource, clips: readonly Clip[]): { from: number; to: number; clips: Clip[] } | null {
  if (source.kind === 'clips') {
    const picked = clips.filter((c) => source.clipIds.includes(c.id));
    if (!picked.length) return null;
    return { from: Math.min(...picked.map((c) => c.startBar)), to: Math.max(...picked.map((c) => c.startBar + c.lengthBars)), clips: picked };
  }
  if (!(source.to - source.from > 1 / 64)) return null;
  const inRange = clips.filter((c) => c.startBar < source.to - EPS && c.startBar + c.lengthBars > source.from + EPS && (!source.trackIds || source.trackIds.includes(c.trackId)));
  return inRange.length ? { from: source.from, to: source.to, clips: inRange } : null;
}

/**
 * How a print stored at its own level plays back `playDb` from there, as loud as it was in the song:
 * the clip's gain, and what that can't reach (it stops at ±24 dB) on the new track's fader, so a
 * quiet part never comes back louder (a part too loud for both comes back quieter).
 */
export function printLevel(playDb: number): { gain: number; volume: number } {
  const gain = Math.max(AUDIO_GAIN_MIN, Math.min(AUDIO_GAIN_MAX, Math.round(playDb * 100) / 100));
  const rest = playDb - gain;
  return { gain, volume: Math.abs(rest) > 0.01 ? Math.max(-60, Math.min(6, Math.round(rest * 10) / 10)) : 0 };
}

/** The name a resample's sound goes by. */
export function resampleName(source: ResampleSource, clips: readonly Clip[], trackNames: ReadonlyMap<string, string>): string {
  const round = (b: number) => Math.round(b * 100) / 100;
  if (source.kind === 'clips') {
    const picked = clips.filter((c) => source.clipIds.includes(c.id));
    return picked.length === 1 ? `${picked[0].name} (resampled)` : `${picked.length} clips (resampled)`;
  }
  const only = source.trackIds?.length === 1 ? trackNames.get(source.trackIds[0]) : undefined;
  // (Named by the bars it covers, as the song sheets count them: bars 1–4 ends where bar 5 starts)
  const from = round(source.from);
  const to = round(source.to);
  const last = Number.isInteger(to) && Number.isInteger(from) ? to - 1 : to;
  return `${only ?? 'Mix'} ${last <= from ? `bar ${from}` : `bars ${from}–${last}`} (resampled)`;
}

type Note = Omit<NoteEvent, 'id'>;

/**
 * A Slicer pattern over `bars` bars on the 16th grid, for `count` slices cut from a sound
 * `loopBars` long: the slice under each 16th is the one that plays there in the sound.
 * 'stutter' repeats and rolls them, beat by beat (a 1/32 roll to end it); 'shuffle' plays a seeded
 * random slice on each 16th (the first stays first). The same seed gives the same pattern.
 */
export function slicePattern(kind: Exclude<SlicePattern, 'order'>, count: number, loopBars: number, bars: number, seed: number): Note[] {
  const rnd = seededRandom(seed);
  const loopSteps = Math.max(1, Math.round(loopBars * 16));
  const natural = (step: number) => Math.min(count - 1, Math.floor(((step % loopSteps) * count) / loopSteps));
  const notes: Note[] = [];
  const put = (at: number, slice: number, duration: string, velocity: number) => notes.push({ note: sliceKey(slice), startOffset: at / 16, duration, velocity: Math.round(velocity * 100) / 100 });
  const steps = Math.max(1, Math.round(bars * 16));
  if (kind === 'shuffle') {
    for (let k = 0; k < steps; k++) put(k, k === 0 ? 0 : Math.floor(rnd() * count), '16n', k % 4 === 0 ? 0.95 : 0.8);
    return notes;
  }
  const beats = Math.ceil(steps / 4);
  for (let b = 0; b < beats; b++) {
    const at = b * 4;
    const first = natural(at);
    const r = rnd();
    const last = b === beats - 1;
    if (last || r < 0.15) {
      // A roll: the beat's slice on every 32nd, growing
      for (let k = 0; k < 8; k++) put(at + k / 2, first, '32n', 0.6 + 0.04 * k);
    } else if (r < 0.37) {
      // The beat's slice four times
      for (let k = 0; k < 4; k++) put(at + k, first, '16n', k === 0 ? 0.95 : 0.78);
    } else if (r < 0.5) {
      // Two hits and air
      put(at, first, '16n', 0.95);
      put(at + 2, natural(at + 2), '16n', 0.8);
    } else {
      for (let k = 0; k < 4; k++) put(at + k, natural(at + k), '16n', k === 0 ? 0.95 : 0.8);
    }
  }
  return notes.filter((n) => n.startOffset < bars - EPS);
}
