/**
 * Hard tune: the fast, robotic pitch correction of melodic rap and trap hooks, built on the vocal
 * tuner (vocalTune.ts: YIN pitch, TD-PSOLA resynthesis). It adds what the robotic sound needs:
 * - a Speed control from natural (0) to instant (100), mapped onto the tuner's glide time;
 * - note holding (hysteresis) at fast speeds: a voice hovering half-way between two notes would
 *   otherwise flip between them every 10 ms, a warble rather than the clean step the effect is
 *   known for, so the note it's on is kept until the voice is clearly nearer another;
 * - the scales such hooks are sung in (minor, harmonic minor, phrygian, minor pentatonic...).
 *
 * It runs as a processing step on the clip (a tuned copy of its sound, like bounce in place), not
 * live: the pitch is found by looking at the whole note, and the result is plain audio, so exports
 * play exactly what was heard, with no AudioWorklet in any render. Plain arrays, so Node tests it.
 */
import { corrections, detectPitch, hzToMidi, psola, type PitchFrame, type TuneSettings } from './vocalTune';

/** Scales offered by the tuner, as semitones up from the key's root. */
export const TUNE_SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
} as const satisfies Record<string, readonly number[]>;
export type TuneScale = keyof typeof TUNE_SCALES;
export const TUNE_SCALE_NAMES: Record<TuneScale, string> = {
  major: 'major',
  minor: 'minor',
  harmonicMinor: 'harmonic minor',
  phrygian: 'phrygian (dark)',
  minorPentatonic: 'minor pentatonic',
  majorPentatonic: 'major pentatonic',
  chromatic: 'chromatic (any note)',
};

/** The slowest glide onto a note, at Speed 0 (natural), ms. */
export const NATURAL_MS = 200;

/**
 * Milliseconds to reach the note at a Speed of 0 (natural: slides and vibrato kept) to 100
 * (instant: the hard robotic step). Squared, so the fast end, where the sound changes most, has
 * the most travel.
 */
export function speedToMs(speed: number): number {
  const s = Math.max(0, Math.min(100, speed)) / 100;
  return Math.round(NATURAL_MS * (1 - s) ** 2);
}

/** The Speed (0 to 100) nearest a glide time in ms (the inverse of speedToMs). */
export function msToSpeed(ms: number): number {
  return Math.round(100 * (1 - Math.sqrt(Math.max(0, Math.min(NATURAL_MS, ms)) / NATURAL_MS)));
}

/** How far past half-way to the next note (semitones) the voice must go before a fast tune moves to it. */
export const HOLD_SEMITONES = 0.2;

/**
 * How much note holding a glide time gets: full at instant, none by 60 ms (slow tuning follows
 * the voice and its slides anyway).
 */
export const holdFor = (ms: number): number => HOLD_SEMITONES * Math.max(0, 1 - ms / 60);

/**
 * The note of the scale the voice is on, keeping `held` (the note of the frame before) while the
 * voice is within half a semitone plus `hold` of it and it's still in the scale.
 */
export function heldNote(midi: number, held: number | null, root: number, steps: readonly number[], hold: number): number {
  const inScale = (n: number) => steps.includes((((n - root) % 12) + 12) % 12);
  let best = Math.round(midi);
  let distance = Infinity;
  const base = Math.floor(midi) - 12;
  for (let n = base; n <= base + 24; n++) {
    if (!inScale(n)) continue;
    const d = Math.abs(n - midi);
    if (d < distance) {
      distance = d;
      best = n;
    }
  }
  if (held === null || held === best || !inScale(held)) return best;
  // Stay on the held note unless the new one is nearer by more than the hold
  return Math.abs(held - midi) <= distance + 2 * hold ? held : best;
}

/** Hard tune settings: a key, how far (strength), and Speed 0 (natural) to 100 (instant). */
export interface HardTuneSettings {
  root: number;
  steps: readonly number[];
  /** 0 to 1 */
  strength: number;
  /** 0 (natural) to 100 (instant) */
  speed: number;
}

/**
 * The pitch change at each frame, in semitones: as vocalTune's corrections, with notes held at
 * fast speeds. At a slow speed (no hold) it is exactly vocalTune's.
 */
export function hardCorrections(frames: readonly PitchFrame[], s: HardTuneSettings): number[] {
  const ms = speedToMs(s.speed);
  const hold = holdFor(ms);
  const base: TuneSettings = { root: s.root, steps: s.steps, strength: s.strength, speed: ms };
  if (hold <= 0) return corrections(frames, base);
  const out: number[] = [];
  const k = ms <= 0 ? 1 : 1 - Math.exp(-10 / ms);
  let current = 0;
  let held: number | null = null;
  for (const f of frames) {
    if (f.hz <= 0) {
      out.push(0);
      held = null;
      continue;
    }
    const midi = hzToMidi(f.hz);
    const note = heldNote(midi, held, s.root, s.steps, hold);
    const wanted = (note - midi) * s.strength;
    current = held !== null ? current + (wanted - current) * k : wanted;
    held = note;
    out.push(current);
  }
  return out;
}

/** Tune a sound's channels (all moved by the pitch of their mix). Returns the new channels and the analysis, for drawing. */
export function hardTuneChannels(channels: readonly Float32Array[], sampleRate: number, s: HardTuneSettings): { channels: Float32Array[]; frames: PitchFrame[]; shift: number[] } {
  const mix = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < mix.length; i++) mix[i] += ch[i] / channels.length;
  const frames = detectPitch(mix, sampleRate);
  const shift = hardCorrections(frames, s);
  return { channels: channels.map((ch) => psola(ch, sampleRate, frames, shift)), frames, shift };
}

/**
 * How far from the scale's notes a voice sings, in cents: the mean over pitched frames of the
 * distance to the nearest note (for measuring a tune; a hard tune brings it near 0).
 */
export function centsOffScale(frames: readonly PitchFrame[], root: number, steps: readonly number[]): { mean: number; within10: number } {
  let sum = 0;
  let near = 0;
  let n = 0;
  for (const f of frames) {
    if (f.hz <= 0) continue;
    const m = hzToMidi(f.hz);
    const note = heldNote(m, null, root, steps, 0);
    const c = Math.abs(m - note) * 100;
    sum += c;
    if (c <= 10) near++;
    n++;
  }
  return { mean: n ? sum / n : 0, within10: n ? near / n : 0 };
}
