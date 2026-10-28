/**
 * Showcase video: the notes the song plays, as the export draws them (audio/showcaseDraw.ts): each
 * note's start and end in seconds from the start of the export, its pitch, its track's colour, and
 * whether it's a drum hit (drums get a band of their own under the pitched parts). Only what's
 * heard: muted tracks (and tracks muted through their bus or by a solo elsewhere) are left out, and
 * a note hidden by a trimmed clip edge isn't shown. Plain data, so Node can unit-test it.
 */
import { isDropTrack } from './dropMoves';
import type { Clip, Track } from './timelineTypes';
import { durationToBars } from './timelineTypes';
import { midiOf } from './noteTools';
import { audibleIds } from './buses';
import { isDrumKind, isFxKind, isMixKind, isRackKind, isSlicerKind } from '../audio/instrumentCatalog';

export interface ShowcaseNote {
  /** Seconds from the start of the video */
  start: number;
  end: number;
  midi: number;
  color: string;
  /** Index into ShowcaseData.tracks */
  track: number;
  /** A drum hit (drum kits, the Drum Rack, the Slicer, sound effects): drawn in the drum band */
  drum: boolean;
}

export interface ShowcaseData {
  /** Sorted by start */
  notes: ShowcaseNote[];
  /** The tracks that have notes in the range, in timeline order */
  tracks: Array<{ name: string; color: string }>;
  /** Where each bar line falls (seconds), for the grid */
  bars: number[];
  /** The pitched notes' lowest and highest MIDI note; the drum band's rows (MIDI notes, low to high) */
  low: number;
  high: number;
  drumRows: number[];
}

/** A track whose notes are hits on pads or rows rather than pitches. */
const hitsTrack = (t: Track) => isDrumKind(t.instrumentKey) || isRackKind(t.instrumentKey) || isSlicerKind(t.instrumentKey) || isFxKind(t.instrumentKey);

/**
 * The notes of bars [startBar, endBar), `toSeconds(bar)` giving the time of a bar from bar 1 (the
 * song's tempo map). Times are from startBar.
 */
export function showcaseData(tracks: readonly Track[], clips: readonly Clip[], startBar: number, endBar: number, toSeconds: (bar: number) => number): ShowcaseData {
  const heard = audibleIds(tracks);
  const origin = toSeconds(startBar);
  // (Not the Drop pad: its notes are moves on the whole mix, not notes anyone hears)
  const shown = tracks.filter((t) => heard.has(t.id) && !isMixKind(t.instrumentKey) && !isDropTrack(t));
  const index = new Map<string, number>();
  const used: ShowcaseData['tracks'] = [];
  const notes: ShowcaseNote[] = [];
  for (const t of shown) {
    const drum = hitsTrack(t);
    for (const c of clips) {
      if (c.trackId !== t.id || c.audio || !c.notes.length) continue;
      const clipEnd = c.startBar + c.lengthBars;
      for (const n of c.notes) {
        if (n.startOffset < -1e-9 || n.startOffset >= c.lengthBars - 1e-9) continue;
        const from = c.startBar + n.startOffset;
        const to = Math.min(clipEnd, from + Math.max(1 / 64, durationToBars(n.duration)));
        if (to <= startBar + 1e-9 || from >= endBar - 1e-9) continue;
        const midi = midiOf(n.note);
        if (!Number.isFinite(midi)) continue;
        if (!index.has(t.id)) {
          index.set(t.id, used.length);
          used.push({ name: t.name, color: t.color });
        }
        notes.push({
          start: toSeconds(Math.max(from, startBar)) - origin,
          end: toSeconds(Math.min(to, endBar)) - origin,
          midi,
          color: t.color,
          track: index.get(t.id)!,
          drum,
        });
      }
    }
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const pitched = notes.filter((n) => !n.drum).map((n) => n.midi);
  const bars: number[] = [];
  for (let b = Math.ceil(startBar); b <= endBar + 1e-9; b++) bars.push(toSeconds(b) - origin);
  return {
    notes,
    tracks: used,
    bars,
    low: pitched.length ? Math.min(...pitched) : 60,
    high: pitched.length ? Math.max(...pitched) : 72,
    drumRows: [...new Set(notes.filter((n) => n.drum).map((n) => n.midi))].sort((a, b) => a - b),
  };
}

/** The first note (by index) that could still be on screen `before` seconds before `t`, by binary search on start. */
export function firstFrom(notes: readonly ShowcaseNote[], t: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The song played on the written beat, as the notes above read it (the rhythm game renders this, so
 * its notes land where they're heard): no clip's own swing or groove feel and no Human timing,
 * whose moves are only in the sound. (The song's swing is left out by the render's options.)
 */
export function onTheBeat<T extends Pick<Track, 'fx'>, C extends Pick<Clip, 'groove'>>(tracks: readonly T[], clips: readonly C[]): { tracks: T[]; clips: C[] } {
  return {
    tracks: tracks.map((t) => (t.fx.human.on && t.fx.human.timing > 0 ? { ...t, fx: { ...t.fx, human: { ...t.fx.human, timing: 0 } } } : t)),
    clips: clips.map((c) => {
      if (!c.groove) return c;
      const { groove: _groove, ...rest } = c;
      return rest as C;
    }),
  };
}
