import type { Clip, Track } from './timelineTypes';
import { INSTRUMENTS, isAudioKind, isDrumKind, isDropKind, isFxKind, isSlicerKind } from '../audio/instrumentCatalog';
import type { InstrumentKey } from '../audio/instrumentCatalog';
import { midiOf, nameOf } from './noteTools';

/**
 * A key change: every pitched note from a bar onward moves by some semitones. Drum kits,
 * percussion, sound effects, the FX track, the Slicer and audio clips keep their notes (their rows
 * are sounds, not pitches). A clip that runs across the bar changes only from the bar on.
 */

/** True for an instrument whose notes are pitches a key change should move. */
export function isPitched(key: InstrumentKey): boolean {
  const def = INSTRUMENTS[key];
  return !(isDrumKind(key) || isFxKind(key) || isDropKind(key) || isSlicerKind(key) || isAudioKind(key) || def.category === 'Drums & Percussion' || def.category === 'Sound Effects');
}

/** Tolerance for "at or after the bar" (a note written on the bar itself counts). */
const EPS = 1e-6;

export interface KeyChangeResult {
  clips: Clip[];
  /** Notes moved */
  moved: number;
  /** Notes left where they were because the new pitch is outside their instrument's range */
  outOfRange: number;
}

export function keyChange(clips: Clip[], tracks: Track[], fromBar: number, semitones: number): KeyChangeResult {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  let moved = 0;
  let outOfRange = 0;
  const out = clips.map((c) => {
    const track = byId.get(c.trackId);
    if (!track || c.audio || !isPitched(track.instrumentKey) || c.startBar + c.lengthBars <= fromBar + EPS) return c;
    const [lo, hi] = INSTRUMENTS[track.instrumentKey].range;
    let changed = false;
    const notes = c.notes.map((n) => {
      if (c.startBar + n.startOffset < fromBar - EPS) return n;
      const m = midiOf(n.note) + semitones;
      if (!Number.isFinite(m)) return n;
      if (m < lo || m > hi) {
        outOfRange++;
        return n;
      }
      moved++;
      changed = true;
      return { ...n, note: nameOf(m) };
    });
    return changed ? { ...c, notes } : c;
  });
  return { clips: out, moved, outOfRange };
}
