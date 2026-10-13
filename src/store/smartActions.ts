import { create } from 'zustand';
import { useTimelineStore } from './timelineStore';
import type { Clip, InstrumentKey, NoteEvent } from './timelineTypes';
import { TOTAL_BARS, uid } from './timelineTypes';
import { detectKey, keyOf } from './songKey';
import type { SongKey } from './songKey';
import { bassFromChords, chordName, chordNotesFor, DRUM_STYLES, drummer, fillBar, harmonize, melodyOf } from './smartTools';
import { measureAt, meterAt } from '../audio/tempoMap';
import type { Meter } from '../audio/tempoMap';
import type { BassStyle, ChordStyle, DrumStyle, FillKind } from './smartTools';
import { isDrumKind } from '../audio/instrumentCatalog';

/** The store side of the writing helpers (smartTools.ts): each makes or changes one clip, as one undo step. */

const tl = () => useTimelineStore.getState();
const newId = () => uid('note');

/** Which smart dialog is open, for which track and bar. */
export const useSmartDialog = create<{ open: null | { mode: 'chords' | 'drummer'; trackId: string; bar: number } }>(() => ({ open: null }));

/** The song's key, from its notes (C major for a song with none yet). */
export function songKey(): SongKey {
  const s = tl();
  return detectKey(s.clips, s.tracks) ?? keyOf(0, 'major');
}

/** A new note clip on a track, selected (one undo step). Returns its id. */
export function placeClip(trackId: string, atBar: number, lengthBars: number, notes: NoteEvent[], name: string): string | null {
  const s = tl();
  if (!s.tracks.some((t) => t.id === trackId)) return null;
  const clip: Clip = {
    id: uid('clip'),
    trackId,
    name,
    startBar: Math.max(1, Math.min(TOTAL_BARS + 1 - lengthBars, atBar)),
    lengthBars,
    notes,
    isSelected: true,
  };
  s.checkpoint();
  useTimelineStore.setState((st) => ({ clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), clip] }));
  return clip.id;
}

/** A new track right under `afterId`, holding `clip` (one undo step with it). Returns the track's id. */
function trackWithClip(afterId: string, instrument: InstrumentKey, name: string, clip: Omit<Clip, 'id' | 'trackId' | 'isSelected'>): string {
  const s = tl();
  s.checkpoint();
  const id = s.addTrack(instrument, name);
  useTimelineStore.setState((st) => {
    const made = st.tracks.find((t) => t.id === id)!;
    const others = st.tracks.filter((t) => t.id !== id);
    const at = others.findIndex((t) => t.id === afterId) + 1;
    return {
      tracks: at > 0 ? [...others.slice(0, at), made, ...others.slice(at)] : st.tracks,
      clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), { ...clip, id: uid('clip'), trackId: id, isSelected: true }],
      // (addTrack and this are one step)
      past: st.past.slice(0, -1),
    };
  });
  return id;
}

/** A chord progression clip on a track. */
export function makeChordClip(trackId: string, atBar: number, chords: number[][], chordBars: number, style: ChordStyle): string | null {
  const notes = chordNotesFor(chords, chordBars, style, newId);
  // Named after one pass of the progression
  const names = chords.map(chordName);
  const period = names.findIndex((_, p) => p > 0 && names.length % p === 0 && names.every((n, i) => n === names[i % p]));
  return placeClip(trackId, atBar, chords.length * chordBars, notes, names.slice(0, period > 0 ? period : names.length).join(' '));
}

/** A drum part clip on a drum track. */
/** The time signature a drum style is written in at a bar: its own (a waltz's 3/4), else the song's there. */
export function drumMeterAt(style: DrumStyle, atBar: number): Meter {
  const s = tl();
  return DRUM_STYLES.find((d) => d.id === style)?.meter ?? meterAt(atBar, { base: s.meter, points: s.meterPoints });
}

/**
 * A drum part clip on a drum track: `bars` measures of the style. With `setMeter`, a style in a
 * time signature the song isn't in there (a waltz in a 4/4 song) also sets the song's time
 * signature for the clip's span (and back after it), in the same undo step.
 */
export function makeDrumClip(trackId: string, atBar: number, style: DrumStyle, bars: number, intensity: number, fillEvery: number, seed: number, setMeter = false): string | null {
  const s = tl();
  const meter = drumMeterAt(style, atBar);
  const notes = drummer(style, bars, intensity, fillEvery, seed, newId, meter);
  const length = bars * (meter.num / meter.den);
  const songMeter = meterAt(atBar, { base: s.meter, points: s.meterPoints });
  const id = placeClip(trackId, atBar, length, notes, `Drummer ${bars} bars`);
  if (!id) return null;
  const groove = DRUM_STYLES.find((d) => d.id === style)?.groove;
  if (groove) useTimelineStore.setState((st) => ({ clips: st.clips.map((c) => (c.id === id ? { ...c, groove } : c)) }));
  if (setMeter && (songMeter.num !== meter.num || songMeter.den !== meter.den)) {
    // (placeClip made the undo step: the time signature changes join it)
    const past = tl().past;
    const after = meterAt(atBar + length, { base: s.meter, points: s.meterPoints });
    if (atBar <= 1 + 1e-6) tl().setMeter(meter);
    else tl().addMeterChange(atBar, meter);
    if (atBar + length <= TOTAL_BARS) tl().addMeterChange(atBar + length, atBar <= 1 + 1e-6 ? songMeter : after);
    useTimelineStore.setState({ past });
  }
  return id;
}

/** A fill at the end of the bar under `songBar` in a drum clip (one undo step). */
export function fillClipBar(clipId: string, songBar: number, kind: FillKind): boolean {
  const s = tl();
  const clip = s.clips.find((c) => c.id === clipId);
  const track = clip && s.tracks.find((t) => t.id === clip.trackId);
  if (!clip || clip.audio || !track || !isDrumKind(track.instrumentKey)) return false;
  // The measure under `songBar` (a 3/4 measure is shorter than a bar), from the clip's start
  const m = measureAt(songBar, { base: s.meter, points: s.meterPoints });
  const barStart = Math.max(0, m.start - clip.startBar);
  if (barStart >= clip.lengthBars - 1e-6) return false;
  s.checkpoint();
  s.setClipNotes(clipId, fillBar(clip.notes, barStart, kind, clip.lengthBars, newId, true, Math.min(m.length, clip.lengthBars - barStart)));
  return true;
}

/**
 * Chords for a melody clip, on a new keys track under it, over the same bars: a chord a bar (half
 * a bar for a clip of two bars or less). Returns the chord names, or null if the clip has no notes.
 */
export function chordsForMelody(clipId: string, instrument: InstrumentKey = 'keys'): string[] | null {
  const s = tl();
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip || clip.audio) return null;
  const melody = melodyOf(clip.notes, clip.lengthBars);
  if (!melody.length) return null;
  const chordBars = clip.lengthBars <= 2 ? 0.5 : 1;
  const { chords } = harmonize(melody, songKey(), clip.lengthBars, chordBars);
  const notes = chordNotesFor(chords, chordBars, 'sustain', newId).filter((n) => n.startOffset < clip.lengthBars - 1e-6);
  const names = chords.map(chordName);
  trackWithClip(clip.trackId, instrument, 'Chords', { name: names.join(' '), startBar: clip.startBar, lengthBars: clip.lengthBars, notes });
  return names;
}

/** A bass line under a chord clip, on a new bass track under it. Returns the new track's id, or null if the clip has no notes. */
export function bassForChords(clipId: string, style: BassStyle = 'eighths', instrument: InstrumentKey = 'bass'): string | null {
  const s = tl();
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip || clip.audio || !clip.notes.length) return null;
  const notes = bassFromChords(clip.notes, clip.lengthBars, style, newId);
  if (!notes.length) return null;
  return trackWithClip(clip.trackId, instrument, 'Bass line', { name: 'Bass line', startBar: clip.startBar, lengthBars: clip.lengthBars, notes });
}
