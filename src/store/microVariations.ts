import type { NoteEvent } from './timelineTypes';
import { durationToBars } from './timelineTypes';
import { rng } from '../audio/sfx/sfxSynth';

/**
 * Micro-variations: game sounds that play over and over (footsteps, weapon swings, UI clicks)
 * need each play to sound a little different, or the ear hears a machine. From one short clip,
 * make several takes, each with its own pitch, brightness, note length and loudness drawn at
 * random within the bounds you set, so the game can pick one at random each time. No audio or
 * store here, so Node can unit-test it.
 */

export interface VariationBounds {
  /** Pitch, ± percent (5 is about ± 0.85 semitone) */
  pitch: number;
  /** Filter cutoff (brightness), ± percent */
  cutoff: number;
  /** Note length (when the release starts), ± milliseconds */
  release: number;
  /** Loudness (note velocity), ± percent */
  velocity: number;
}

export const DEFAULT_BOUNDS: VariationBounds = { pitch: 5, cutoff: 12, release: 20, velocity: 10 };

export interface VariationTake {
  /** Playback rate for the pitch (1 = as written) */
  rate: number;
  /** Multiplies the filter cutoff */
  cutoff: number;
  /** Milliseconds added to every note's length */
  releaseMs: number;
  /** Multiplies every note's velocity */
  velocity: number;
}

/**
 * `count` takes within `bounds`, from `seed`. Spread evenly across the range rather than purely at
 * random (the first take is as written), so no two takes come out nearly the same.
 */
export function variationTakes(count: number, bounds: VariationBounds, seed: number): VariationTake[] {
  const r = rng(seed);
  // A shuffled, evenly spaced position in [-1, 1] per take for each setting, nudged a little
  const spread = () => {
    const xs = Array.from({ length: count - 1 }, (_, i) => (count <= 2 ? 0.7 : -1 + (2 * i) / (count - 2)));
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs.map((x) => Math.max(-1, Math.min(1, x + (r() - 0.5) * 0.25)));
  };
  const p = spread();
  const c = spread();
  const l = spread();
  const v = spread();
  const takes: VariationTake[] = [{ rate: 1, cutoff: 1, releaseMs: 0, velocity: 1 }];
  for (let i = 0; i < count - 1; i++) {
    takes.push({
      rate: 1 + (bounds.pitch / 100) * p[i],
      cutoff: 1 + (bounds.cutoff / 100) * c[i],
      releaseMs: bounds.release * l[i],
      velocity: 1 + (bounds.velocity / 100) * v[i],
    });
  }
  return takes;
}

/** A clip's notes for a take: lengths and velocities changed (pitch and brightness are applied when it renders). */
export function takeNotes(notes: readonly NoteEvent[], take: VariationTake, bpm: number): NoteEvent[] {
  const ticksPerSecond = (768 * bpm) / 240;
  return notes.map((n) => {
    const ticks = durationToBars(n.duration) * 768 + (take.releaseMs / 1000) * ticksPerSecond;
    return { ...n, duration: `${Math.max(1, Math.round(ticks))}i`, velocity: Math.max(0.02, Math.min(1, n.velocity * take.velocity)) };
  });
}

/** How many frames to keep: up to the last one above `threshold` (linear), plus a short tail. */
export function trimmedLength(channels: readonly Float32Array[], sampleRate: number, threshold = 0.0005): number {
  let last = 0;
  for (const ch of channels) for (let i = ch.length - 1; i > last; i--) if (Math.abs(ch[i]) > threshold) { last = i; break; }
  return Math.min(channels[0].length, last + Math.round(0.01 * sampleRate));
}
