import { mathPattern, MATH_PATTERNS, type MathPatternId } from './mathPatterns';
import { create } from 'zustand';
import { useTimelineStore } from './timelineStore';
import type { Clip, InstrumentKey, NoteEvent } from './timelineTypes';
import { TOTAL_BARS, uid } from './timelineTypes';
import { detectKey, keyOf } from './songKey';
import type { SongKey } from './songKey';
import { accompany, ACCOMP_STYLES, bassFromChords, chordName, chordNotesFor, DRUM_STYLES, drummer, fillBar, harmonize, melodyOf, rollDrums } from './smartTools';
import { measureAt, meterAt } from '../audio/tempoMap';
import type { Meter } from '../audio/tempoMap';
import type { AccompStyle, BassStyle, ChordStyle, DrumStyle, FillKind } from './smartTools';
import { INSTRUMENTS, isDrumKind } from '../audio/instrumentCatalog';
import { midiOf, nameOf } from './noteTools';
import { melodyVariation, MELODY_VARIATIONS, surprisePair, type MelodyVariation, type VariationPlace } from './melodyVariations';

/** The store side of the writing helpers (smartTools.ts): each makes or changes one clip, as one undo step. */

const tl = () => useTimelineStore.getState();
const newId = () => uid('note');

/** Which smart dialog is open, for which track and bar. */
export const useSmartDialog = create<{ open: null | { mode: 'chords' | 'drummer' | 'accompany' | 'melody' | 'math'; trackId: string; bar: number; clipId?: string } }>(() => ({ open: null }));

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
 * Roll a drum clip's beat again (smartTools.ts rollDrums): new hats and percussion in the style it
 * sounds like, the kick and snare kept; `row` rolls that drum alone. One undo step.
 */
export function rollClipDrums(clipId: string, row?: string): boolean {
  const s = tl();
  const clip = s.clips.find((c) => c.id === clipId);
  const track = clip && s.tracks.find((t) => t.id === clip.trackId);
  if (!clip || clip.audio || !track || !isDrumKind(track.instrumentKey)) return false;
  const meter = meterAt(clip.startBar, { base: s.meter, points: s.meterPoints });
  s.checkpoint();
  s.setClipNotes(clipId, rollDrums(clip.notes, { lengthBars: clip.lengthBars, seed: (Math.random() * 2 ** 32) >>> 0, newId, meter, ...(row ? { row } : {}) }));
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

/** Notes moved by octaves into an instrument's range (the part as a whole first, then any stragglers). */
export function fitToInstrument(notes: NoteEvent[], instrument: InstrumentKey): NoteEvent[] {
  const def = INSTRUMENTS[instrument];
  if (!def?.range || def.kind === 'drums' || !notes.length) return notes;
  const [lo, hi] = def.range;
  const midis = notes.map((n) => midiOf(n.note));
  let best = 0;
  let bestFit = -1;
  for (const k of [0, 12, -12, 24, -24]) {
    const fit = midis.filter((m) => m + k >= lo && m + k <= hi).length;
    if (fit > bestFit) {
      best = k;
      bestFit = fit;
    }
  }
  return notes.map((n, i) => {
    let m = midis[i] + best;
    while (m > hi && m - 12 >= lo) m -= 12;
    while (m < lo && m + 12 <= hi) m += 12;
    return { ...n, note: nameOf(m) };
  });
}

/**
 * An accompaniment for a chord clip (see ACCOMP_STYLES) on a new track under it, over the same
 * bars, in the song's time signature there. Returns the new track's id, or null if the clip has
 * no chords.
 */
export function accompanyChords(clipId: string, style: AccompStyle, instrument?: InstrumentKey, seed = 1): string | null {
  const s = tl();
  const clip = s.clips.find((c) => c.id === clipId);
  if (!clip || clip.audio || !clip.notes.length) return null;
  const meter = meterAt(clip.startBar, { base: s.meter, points: s.meterPoints });
  const def = ACCOMP_STYLES.find((a) => a.id === style)!;
  const key = instrument ?? def.instrument;
  const notes = fitToInstrument(accompany(clip.notes, clip.lengthBars, style, newId, meter, seed), key);
  if (!notes.length) return null;
  return trackWithClip(clip.trackId, key, def.track, { name: def.track, startBar: clip.startBar, lengthBars: clip.lengthBars, notes });
}

/**
 * A variation of a melody clip (see melodyVariations.ts), in the song's key: after it on its track
 * (at the first free spot), in place of its notes, or on a new track under it with the same
 * instrument (a harmony to play along). One undo step. Returns what happened, or null if the clip
 * has no notes.
 */
export function varyMelody(clipId: string, kind: MelodyVariation, place: VariationPlace, seed = 1, inKey?: SongKey): string | null {
  const s = tl();
  const clip = s.clips.find((c) => c.id === clipId);
  const track = clip && s.tracks.find((t) => t.id === clip.trackId);
  if (!clip || !track || clip.audio || !clip.notes.length || isDrumKind(track.instrumentKey)) return null;
  const key = inKey ?? songKey();
  const meter = meterAt(clip.startBar, { base: s.meter, points: s.meterPoints });
  const visible = clip.notes.filter((n) => n.startOffset >= -1e-6 && n.startOffset < clip.lengthBars - 1e-6);
  const notes = fitToInstrument(melodyVariation(visible, kind, key, clip.lengthBars, meter.num / meter.den, meter.num, seed, newId), track.instrumentKey);
  if (!notes.length) return null;
  const what = kind === 'surprise' ? surprisePair(seed) : MELODY_VARIATIONS.find((v) => v.id === kind)!.name.toLowerCase();
  const name = `${clip.name} (${kind === 'surprise' ? 'variation' : MELODY_VARIATIONS.find((v) => v.id === kind)!.name.toLowerCase()})`;
  if (place === 'replace') {
    s.checkpoint();
    s.setClipNotes(clipId, notes);
    return `The clip is now ${what}`;
  }
  if (place === 'track') {
    trackWithClip(track.id, track.instrumentKey, `${track.name} ${kind === 'harmony' ? 'harmony' : 'variation'}`, { name, startBar: clip.startBar, lengthBars: clip.lengthBars, notes });
    return `${what[0].toUpperCase()}${what.slice(1)} on a new track under "${track.name}"`;
  }
  // After it: the first spot on its track where the variation fits
  const others = s.clips.filter((c) => c.trackId === track.id && c.id !== clip.id).sort((a, b) => a.startBar - b.startBar);
  let at = clip.startBar + clip.lengthBars;
  for (const c of others) if (c.startBar < at + clip.lengthBars - 1e-6 && c.startBar + c.lengthBars > at + 1e-6) at = c.startBar + c.lengthBars;
  if (at + clip.lengthBars > TOTAL_BARS + 1 + 1e-6) return 'No room after this clip on its track: try a new track';
  placeClip(track.id, at, clip.lengthBars, notes, name);
  return `${what[0].toUpperCase()}${what.slice(1)} at bar ${Math.round(at * 100) / 100}`;
}

/** A Math patterns clip (mathPatterns.ts) on a pitched track, in `key`, `bars` long. */
export function makeMathClip(trackId: string, atBar: number, pattern: MathPatternId, key: SongKey, bars: number): string | null {
  const notes = mathPattern(pattern, { root: key.root, steps: key.steps }, bars, newId);
  return placeClip(trackId, atBar, bars, notes, MATH_PATTERNS.find((m) => m.id === pattern)?.name ?? 'Math pattern');
}
