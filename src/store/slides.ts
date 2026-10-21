import type { ExprPoint, InstrumentKey, NoteEvent, Track } from './timelineTypes';
import { durationToBars } from './timelineTypes';
import { tidyNoteLane } from './noteExpression';
import { isFledgeUrl } from '../audio/plugins/fledgeMacros';

/**
 * Pitch slides and dives on single notes, kept in the note's own bend curve (`expr.bend`, in
 * semitones, see noteExpression.ts), so they need nothing new to save, link, copy or play: the
 * scheduler plays a note's bend on a voice of its own where the instrument has them, else by
 * bending the instrument as a whole (the mono basses, Analog Lead and Fledge Synth bend that way;
 * Fledge Synth's bend range opens to 24 semitones for a wide one, see wamPlugin.ts).
 *
 * A slide: the note holds its pitch, then glides to `semis` away by its end, starting `from` of
 * the way through it (0: over its whole length). A dive: it starts `semis` up (an octave) and
 * falls to its pitch over its first `bars` (a 16th). Pure, so Node can test it.
 */

/** The widest slide or dive (a note's bend lane's range). */
export const MAX_SLIDE = 24;
/** A dive's usual shape: an octave down to the note over a 16th. */
export const DIVE_SEMIS = 12;
export const DIVE_BARS = 1 / 16;

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** The note with its bend set to `points` (none: no bend), keeping its pressure. */
function withBend(note: NoteEvent, points: ExprPoint[]): NoteEvent {
  const length = durationToBars(note.duration);
  const tidy = points.length ? tidyNoteLane(points, 'bend', length) : [];
  const expr = { ...note.expr };
  if (tidy.length && tidy.some((p) => p.value !== 0)) expr.bend = tidy;
  else delete expr.bend;
  const { expr: _old, ...rest } = note;
  return Object.keys(expr).length ? { ...rest, expr } : rest;
}

/** The note sliding `semis` (whole semitones, + up) by its end, from `from` (0 to 0.95) of the way through it. 0 semitones: no slide. */
export function withSlide(note: NoteEvent, semis: number, from = 0): NoteEvent {
  const length = durationToBars(note.duration);
  const target = Math.max(-MAX_SLIDE, Math.min(MAX_SLIDE, Math.round(semis)));
  if (!target) return withBend(note, []);
  const start = round(length * Math.max(0, Math.min(0.95, from)));
  return withBend(note, [
    { at: start, value: 0 },
    { at: length, value: target },
  ]);
}

/** A dive into the note: `semis` up (or down, negative) at its start, falling to its pitch over `bars` (at most its length). */
export function withDive(note: NoteEvent, semis = DIVE_SEMIS, bars = DIVE_BARS): NoteEvent {
  const length = durationToBars(note.duration);
  const end = round(Math.min(length, bars));
  return withBend(note, [
    { at: 0, value: Math.max(-MAX_SLIDE, Math.min(MAX_SLIDE, semis)) },
    { at: end, value: 0 },
  ]);
}

/** What a note's bend is, read back: a slide (its target and where it starts), a dive, other bends, or none. */
export function slideOf(note: NoteEvent): { kind: 'slide'; semis: number; from: number } | { kind: 'dive'; semis: number; bars: number } | { kind: 'bend' } | null {
  const b = note.expr?.bend;
  if (!b?.length || !b.some((p) => p.value !== 0)) return null;
  const length = durationToBars(note.duration);
  if (b.length === 2 && b[0].value === 0 && Math.abs(b[1].at - length) < 1e-6 && b[1].value !== 0) return { kind: 'slide', semis: b[1].value, from: length > 0 ? b[0].at / length : 0 };
  if (b.length === 2 && b[0].at === 0 && b[0].value !== 0 && b[1].value === 0) return { kind: 'dive', semis: b[0].value, bars: b[1].at };
  return { kind: 'bend' };
}

/** The selected notes dived (Dive tool): one change for all of them. */
export const diveNotes = (notes: readonly NoteEvent[], semis = DIVE_SEMIS, bars = DIVE_BARS): NoteEvent[] => notes.map((n) => withDive(n, semis, bars));

/**
 * Instruments that play a note's own bend (slides and dives), whole-instrument or per voice. The
 * others (drum kits, the FX and chip sounds, Supersaw, Pluck...) play the note at its own pitch.
 */
const BENDING: ReadonlySet<InstrumentKey> = new Set<InstrumentKey>([
  'bass', 'subBass', 'bass808', 'lead', 'wobbleBass', 'growlBass', 'reeseBass', 'synthDesigner', 'keys', 'brass', 'wavetable',
] as InstrumentKey[]);

/**
 * Whether `track`'s instrument plays slides: 'yes', 'maybe' (a plugin other than Fledge Synth:
 * it gets MIDI pitch bend, which it may or may not follow, over 2 semitones), or 'no'. Recorded
 * instruments bend too ('yes').
 */
export function bendSupport(track: Pick<Track, 'instrumentKey' | 'plugin'>, kind: string | undefined): 'yes' | 'maybe' | 'no' {
  if (kind === 'plugin') return isFledgeUrl(track.plugin?.url) ? 'yes' : 'maybe';
  if (kind === 'sampled' || kind === 'custom' || kind === 'multi') return 'yes';
  return BENDING.has(track.instrumentKey) ? 'yes' : 'no';
}
