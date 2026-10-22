/**
 * Drum Designer sounds that follow the song: a layered kick's or snare's pitch set to follow the
 * key (DrumLayer.keyTrack) sits on the song's key root (detectKey), in the octave nearest its range
 * (KEY_PITCH_RANGE: 45-66 Hz for a kick's tail, 120-170 Hz for a snare's body), and a gated room
 * (DrumLayer.gate) holds for an 8th at the song's tempo. The store writes the followed values into
 * the track's design whenever the notes or the tempo change (see the subscription at the end of
 * timelineStore.ts), so the sound is plain data: live playback and an export play the same buffer.
 * No audio or store here, so Node can test it.
 */
import { detectKey } from './songKey';
import type { Clip, Track } from './timelineTypes';
import { KEY_PITCH_RANGE, LAYER_RANGES } from './drumDesign';
import type { DrumDesign, DrumLayer } from './drumDesign';

/** The frequency of pitch class `root` (0 = C) in the octave nearest [lo, hi] Hz (on a log scale). */
export function keyPitchHz(root: number, [lo, hi]: [number, number]): number {
  const centre = Math.sqrt(lo * hi);
  // C0 is MIDI 12; A4 (MIDI 69) is 440 Hz
  let best = 0;
  for (let midi = 12 + (((root % 12) + 12) % 12); midi < 120; midi += 12) {
    const hz = 440 * 2 ** ((midi - 69) / 12);
    const inside = hz >= lo && hz <= hi;
    const bestInside = best >= lo && best <= hi;
    if (!best || (inside && !bestInside) || (inside === bestInside && Math.abs(Math.log(hz / centre)) < Math.abs(Math.log(best / centre)))) best = hz;
  }
  return Math.round(best * 100) / 100;
}

/** An 8th note at `bpm`, seconds (a gated room's hold), in its range. */
export function gateHoldFor(bpm: number): number {
  const [lo, hi] = LAYER_RANGES.gateHold;
  return Math.round(Math.max(lo, Math.min(hi, 30 / Math.max(1, bpm))) * 10000) / 10000;
}

const follows = (l: DrumLayer) => (l.keyTrack >= 0.5 && !!KEY_PITCH_RANGE[l.voice]) || (l.gate >= 0.5 && l.voice === 'layerSnare');

/** Whether anything in `design` follows the song. */
export function designFollows(design: DrumDesign | undefined): boolean {
  return !!design && Object.values(design).some((s) => s?.layers.some(follows));
}

/**
 * `design` with its following layers on `root` (null: no key found, the pitch stays) and `bpm`;
 * the same object when nothing changes. The sound keeps its preset (following is part of it).
 */
export function followDesign(design: DrumDesign, root: number | null, bpm: number): DrumDesign {
  let changed = false;
  const out: DrumDesign = {};
  for (const [row, sound] of Object.entries(design) as Array<[keyof DrumDesign, NonNullable<DrumDesign[keyof DrumDesign]>]>) {
    let soundChanged = false;
    const layers = sound.layers.map((l) => {
      let next = l;
      const range = KEY_PITCH_RANGE[l.voice];
      if (l.keyTrack >= 0.5 && range && root !== null) {
        const hz = keyPitchHz(root, range);
        if (Math.abs(hz - l.pitch) > 0.005) next = { ...next, pitch: hz };
      }
      if (l.gate >= 0.5 && l.voice === 'layerSnare') {
        const hold = gateHoldFor(bpm);
        if (Math.abs(hold - l.gateHold) > 1e-6) next = { ...next, gateHold: hold };
      }
      if (next !== l) soundChanged = true;
      return next;
    });
    out[row] = soundChanged ? { ...sound, layers } : sound;
    changed ||= soundChanged;
  }
  return changed ? out : design;
}

/** The last key found, by the clips and the tracks' instruments it was found from (a fader drag needn't look again) */
let lastRoot: { clips: readonly Clip[]; keys: string; root: number | null } | null = null;

/** The song's key root (0 = C), or null when it has no pitched notes. */
export function songRoot(clips: readonly Clip[], tracks: readonly Track[]): number | null {
  const keys = tracks.map((t) => `${t.id}:${t.instrumentKey}`).join(',');
  if (lastRoot && lastRoot.clips === clips && lastRoot.keys === keys) return lastRoot.root;
  const root = detectKey(clips, tracks)?.root ?? null;
  lastRoot = { clips, keys, root };
  return root;
}

/** `tracks` with every following drum design brought up to the song (null: nothing to change). */
export function followTracks(tracks: readonly Track[], clips: readonly Clip[], bpm: number): Track[] | null {
  if (!tracks.some((t) => designFollows(t.drumDesign))) return null;
  const root = songRoot(clips, tracks);
  let changed = false;
  const out = tracks.map((t) => {
    if (!t.drumDesign || !designFollows(t.drumDesign)) return t;
    const d = followDesign(t.drumDesign, root, bpm);
    if (d === t.drumDesign) return t;
    changed = true;
    return { ...t, drumDesign: d };
  });
  return changed ? out : null;
}
