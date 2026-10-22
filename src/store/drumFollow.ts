/**
 * Drum Designer sounds that follow the song: a layered kick's or snare's pitch set to follow the
 * key (DrumLayer.keyTrack) sits on the song's key root (detectKey), in the octave nearest its range
 * (KEY_PITCH_RANGE: 45-66 Hz for a kick's tail, 120-170 Hz for a snare's body), and a gated room
 * (DrumLayer.gate) holds for an 8th at the song's tempo. The store writes the followed values into
 * the track's design whenever the notes or the tempo change (see the subscription at the end of
 * timelineStore.ts), so the sound is plain data: live playback and an export play the same buffer.
 * Only a Designed Kit's design is followed (the one track kind that plays it; a design kept on a
 * track that's been switched to another instrument is left as it was).
 *
 * With tempo changes, a sound is one buffer for every hit, so a gated room takes one tempo: the
 * one most of its own hits play at (the median of the tempo at each of the row's notes on the
 * track; with none, at each of the track's notes; with no notes, the tempo at bar 1). A song that
 * spends most of its time at one tempo has its rooms an 8th long there.
 * No audio or store here, so Node can test it.
 */
import { detectKey } from './songKey';
import type { Clip, Track } from './timelineTypes';
import { DESIGN_ROWS, KEY_PITCH_RANGE, LAYER_RANGES } from './drumDesign';
import type { DesignRow, DrumDesign, DrumLayer } from './drumDesign';
import { isSteady, tempoAt, type TempoPoint } from '../audio/tempoMap';

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
 * `design` with its following layers on `root` (null: no key found, the pitch stays) and `bpm`
 * (or each row's tempo); the same object when nothing changes. The sound keeps its preset
 * (following is part of it).
 */
export function followDesign(design: DrumDesign, root: number | null, bpm: number | ((row: DesignRow) => number)): DrumDesign {
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
        const hold = gateHoldFor(typeof bpm === 'number' ? bpm : bpm(row));
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

const ROW_NOTE = new Map<DesignRow, string>(DESIGN_ROWS.map((r) => [r.row, r.note]));

/**
 * The tempo a track's `row` takes with tempo changes: the median of the tempo at each of the
 * row's hits on the track (else at each of the track's notes; else the tempo at bar 1).
 */
export function rowTempo(trackId: string, row: DesignRow, clips: readonly Clip[], bpm: number, tempoPoints: readonly TempoPoint[] | undefined): number {
  const tempo = { bpm, points: tempoPoints ?? [] };
  if (!tempoPoints?.length || isSteady(tempo)) return bpm;
  const at = (only?: string) =>
    clips
      .filter((c) => c.trackId === trackId)
      .flatMap((c) => c.notes.filter((n) => n.startOffset < c.lengthBars && (!only || n.note === only)).map((n) => tempoAt(c.startBar + n.startOffset, tempo)))
      .sort((a, b) => a - b);
  let tempos = at(ROW_NOTE.get(row));
  if (!tempos.length) tempos = at();
  if (!tempos.length) return bpm;
  return Math.round(tempos[(tempos.length - 1) >> 1] * 100) / 100;
}

/**
 * `tracks` with every following drum design brought up to the song (null: nothing to change):
 * only Designed Kits, the tracks that play their design.
 */
export function followTracks(tracks: readonly Track[], clips: readonly Clip[], bpm: number, tempoPoints?: readonly TempoPoint[]): Track[] | null {
  const plays = (t: Track) => t.instrumentKey === 'designedKit' && designFollows(t.drumDesign);
  if (!tracks.some(plays)) return null;
  const root = songRoot(clips, tracks);
  let changed = false;
  const out = tracks.map((t) => {
    if (!t.drumDesign || !plays(t)) return t;
    const d = followDesign(t.drumDesign, root, tempoPoints?.length ? (row) => rowTempo(t.id, row, clips, bpm, tempoPoints) : bpm);
    if (d === t.drumDesign) return t;
    changed = true;
    return { ...t, drumDesign: d };
  });
  return changed ? out : null;
}
