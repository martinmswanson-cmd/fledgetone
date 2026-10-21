import type { AutomationPoint, InstrumentKey, NoteEvent, Track } from './timelineTypes';
import { barsToDuration, durationToBars } from './timelineTypes';
import { INSTRUMENTS, isAudioKind, isDrumKind, isDropKind, isFxKind, isMixKind } from '../audio/instrumentCatalog';
import { laneValueAt, normalizePoints } from '../audio/automation';

/**
 * Beat switch and drop tools, on plain note lists: what each track is for in a beat (drums, bass,
 * melody, FX), cutting a gap out of a part (a drop-out before a drop, or a stop: everything silent
 * for the last beat or half beat of a bar), and the switch itself: a section's drums and bass in
 * half time, double time, or a bass that follows a new drum pattern's kicks while the melody stays.
 * Positions are bars from the start of the part (or section). No store or audio here, so Node can
 * unit-test it (scripts/arrangeTools.test.mjs); arrangeActions.ts applies it.
 */

const EPS = 1e-6;
/** The drum rows (as in DRUM_NOTES) a beat is built from. */
export const KICK = 'C1';
export const SNARE = 'D1';
export const CLAP = 'D#1';
export const HAT = 'F#1';
export const OPEN_HAT = 'A#1';
export const CRASH = 'C#2';

/** What a track does in a beat. */
export type TrackRole = 'drums' | 'bass' | 'melody' | 'fx' | 'audio' | 'mix';

export const ROLE_NAMES: Record<TrackRole, string> = {
  drums: 'Drums',
  bass: 'Bass',
  melody: 'Melody & chords',
  fx: 'FX',
  audio: 'Audio (vocals, samples)',
  mix: 'Buses & returns',
};

/** A track's role, from its instrument (and, for an Audio track, nothing more: it could be anything). */
export function trackRole(track: Pick<Track, 'instrumentKey'>): TrackRole {
  const key = track.instrumentKey as InstrumentKey;
  if (isMixKind(key)) return 'mix';
  if (isDrumKind(key)) return 'drums';
  if (isFxKind(key) || isDropKind(key)) return 'fx';
  if (isAudioKind(key)) return 'audio';
  return INSTRUMENTS[key]?.category === 'Bass' ? 'bass' : 'melody';
}

const endOf = (n: NoteEvent) => n.startOffset + durationToBars(n.duration);

/**
 * A gap cut out of a part: notes starting from `from` to `to` are gone, and notes ringing into it
 * end where it starts (so a long 808 or a riser stops dead there). Positions in bars from the
 * part's start.
 */
export function cutGap(notes: readonly NoteEvent[], from: number, to: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const n of notes) {
    if (n.startOffset >= from - EPS && n.startOffset < to - EPS) continue;
    if (n.startOffset < from - EPS && endOf(n) > from + EPS) {
      const len = from - n.startOffset;
      // Shorter than a 64th is a click, not a note
      if (len >= 1 / 64 - EPS) out.push({ ...n, duration: barsToDuration(len) });
      continue;
    }
    out.push(n);
  }
  return out;
}

/** How long a silence dip takes to close and to open again, bars (a 192nd: about 9 ms at 140 BPM). */
export const DIP_EDGE = 1 / 192;

/**
 * A Volume lane with a silence cut into it from `from` to `to` (song bars): it closes just before
 * `from`, stays at the bottom, and is back where it was exactly at `to`, so the next downbeat hits
 * at full level. Cutting notes alone leaves releases (a bell's ring, an 808's tail) sounding in
 * the gap; the lane silences the whole track. `base` is the lane value where the lane has no
 * points (the track's fader).
 */
export function silenceDip(points: readonly AutomationPoint[], from: number, to: number, base: number): AutomationPoint[] {
  const at = (bar: number) => laneValueAt(points, bar) ?? base;
  const close = from - DIP_EDGE;
  const kept = points.filter((p) => p.bar < close - EPS || p.bar > to + EPS);
  return normalizePoints([...kept, { bar: close, value: at(close) }, { bar: from, value: 0 }, { bar: to - DIP_EDGE, value: 0 }, { bar: to, value: at(to) }]);
}

/** Where a stop goes: the last `beats` (1 or 0.5) of the bar `bar` (1-based song bar), as [from, to). */
export function stopSpan(bar: number, beats: number): [number, number] {
  const to = Math.round(bar) + 1;
  return [to - beats / 4, to];
}

/** A note list's notes within [0, length), each ending by `length`. */
function fit(notes: NoteEvent[], length: number): NoteEvent[] {
  return notes
    .filter((n) => n.startOffset >= -EPS && n.startOffset < length - EPS)
    .map((n) => (endOf(n) > length + EPS ? { ...n, duration: barsToDuration(Math.max(1 / 64, length - n.startOffset)) } : n));
}

/**
 * Half time: the section's first half played at half speed over the whole section (every position
 * and length doubled). Drum hits keep their own length (a hit is a hit).
 */
export function halfTime(notes: readonly NoteEvent[], length: number, newId: () => string, keepLengths = false): NoteEvent[] {
  return fit(
    notes
      .filter((n) => n.startOffset < length / 2 - EPS)
      .map((n) => ({ ...n, id: newId(), startOffset: n.startOffset * 2, duration: keepLengths ? n.duration : barsToDuration(durationToBars(n.duration) * 2) })),
    length
  );
}

/** Double time: the whole section at twice the speed, twice over (positions and lengths halved). */
export function doubleTime(notes: readonly NoteEvent[], length: number, newId: () => string, keepLengths = false): NoteEvent[] {
  const once = notes
    .filter((n) => n.startOffset >= -EPS && n.startOffset < length - EPS)
    .map((n) => ({ ...n, startOffset: n.startOffset / 2, duration: keepLengths ? n.duration : barsToDuration(Math.max(1 / 64, durationToBars(n.duration) / 2)) }));
  return fit(
    [0, length / 2].flatMap((shift) => once.map((n) => ({ ...n, id: newId(), startOffset: Math.round((n.startOffset + shift) * 1920) / 1920 }))),
    length
  );
}

/** The kick hits of a drum part, in order (positions in bars). */
export const kicksOf = (drums: readonly NoteEvent[]): number[] =>
  [...new Set(drums.filter((n) => n.note === KICK).map((n) => Math.round(n.startOffset * 192) / 192))].sort((a, b) => a - b);

/**
 * A bass line re-cut to follow a drum part's kicks, the way an 808 plays with the kick: a note on
 * every kick, at the pitch the old line had there (or its last note before), held to the next kick
 * (at most a bar). With no kicks or no bass notes, nothing.
 */
export function bassOnKicks(bass: readonly NoteEvent[], kicks: readonly number[], length: number, newId: () => string): NoteEvent[] {
  const sorted = [...bass].filter((n) => n.startOffset < length - EPS).sort((a, b) => a.startOffset - b.startOffset);
  if (!sorted.length) return [];
  const out: NoteEvent[] = [];
  kicks.forEach((at, i) => {
    if (at >= length - EPS) return;
    const sounding = [...sorted].reverse().find((n) => n.startOffset <= at + EPS) ?? sorted[0];
    const next = kicks[i + 1] ?? length;
    const len = Math.max(1 / 16, Math.min(1, next - at, length - at));
    out.push({ ...sounding, id: newId(), startOffset: at, duration: barsToDuration(len), velocity: sounding.velocity });
  });
  return out;
}

/** How a beat switch changes the drums and bass. */
export type SwitchMode = 'half' | 'double' | 'pattern';
export const SWITCH_MODES: ReadonlyArray<{ id: SwitchMode; name: string; detail: string }> = [
  { id: 'half', name: 'Half time', detail: 'the beat at half speed: heavier, slower bounce' },
  { id: 'double', name: 'Double time', detail: 'the beat at twice the speed: urgent' },
  { id: 'pattern', name: 'New drum pattern', detail: 'a new beat from the drummer, the bass following its kicks' },
];

/**
 * One track's notes in the switched section: drums and bass changed by the mode (the new pattern's
 * drums come from the drummer, passed as `newDrums`), everything else as it was.
 */
export function switchedNotes(role: TrackRole, notes: readonly NoteEvent[], length: number, mode: SwitchMode, newId: () => string, newDrums?: readonly NoteEvent[]): NoteEvent[] {
  const copy = () => notes.map((n) => ({ ...n, id: newId() }));
  if (role === 'drums') {
    if (mode === 'half') return halfTime(notes, length, newId, true);
    if (mode === 'double') return doubleTime(notes, length, newId, true);
    return newDrums ? newDrums.map((n) => ({ ...n, id: newId() })) : copy();
  }
  if (role === 'bass') {
    if (mode === 'half') return halfTime(notes, length, newId);
    if (mode === 'double') return doubleTime(notes, length, newId);
    return newDrums ? bassOnKicks(notes, kicksOf(newDrums), length, newId) : copy();
  }
  return copy();
}
