/**
 * Which tracks play a note differently because of the notes played before it, and how far a
 * change of one note carries on (read by the hearing rules, songDiff.ts, so a change is never
 * counted as heard in fewer bars than it changes). Plain logic over the instrument list and the
 * song, no Web Audio, so Node's tests cover it.
 *
 * What the instruments remember from one note to the next (checked against each player):
 * - takes: a recorded instrument with more than one take of a note at some loudness plays them in
 *   turn, one count per loudness shared by every pitch (samplerManager.ts createSamplerVoice; a
 *   recorded drum kit counts per row and loudness, presets/sampledKit.ts), and its key-release
 *   sounds the same way. One note more or less moves every later note on the track onto the other
 *   take, to the end of the song.
 * - strum: a guitar's (banjo's, mandolin's) chord is strummed down or up after the strum before it
 *   (guitarStrum.ts), so one chord more or less can turn every later strum round.
 * - passes: a note that plays only on some passes (noteChance.ts) counts its clip's place in the
 *   run of copies on its track; a clip changed, added or taken away starts or ends a run, and
 *   moves the pass of every later copy.
 * - plugin: a plugin instrument's own voices, counters and running state aren't known here: a
 *   change may carry on anywhere after it (not sure).
 * - legato: a monophonic synth carries on from the note before while that one still sounds or
 *   rings (its oscillator runs on, its envelope starts from where it is, it slides), so a change
 *   carries along every note joined to it that way: the run of notes each starting before the one
 *   before has rung out (presets/synths.ts, bass.ts, edmBass.ts, bass808Designer.ts, and the Sub
 *   enhancer's sine, subLayer.ts).
 *
 * Checked and held (each note's sound depends on nothing played before it, or only on notes still
 * sounding, which the note's own tail already counts): the Human insert, a note's small level and
 * timing differences, a section's spread and the strum's small differences (hashed from the note
 * and its place: human.ts noteSeed, noteJitter); breath (from the note's own start); bowed legato
 * changes (only from a note still held); the designed synth in mono (a new voice each note, sliding
 * from one still sounding); voice stealing (SAME_PITCH, MAX_NOTES, the voice pools: notes still
 * ringing); hats choking each other; drum noise (seeded by the hit's time); the drummer styles, the
 * chord and bass tools (they write notes, nothing at play time). A clip's swing is decided over the
 * whole clip (see swingReadsClip).
 */
import type { Clip, Track } from '../store/timelineTypes';
import { INSTRUMENTS, type InstrumentKey } from './instrumentCatalog';
import { STRUMMED } from './guitarStrum';
import { clipHasConditions } from '../store/noteChance';

/** What a track remembers from note to note (see the top of the file). */
export type MemoryKind = 'takes' | 'strum' | 'passes' | 'plugin' | 'legato';

/**
 * How far a change of a note carries: 'onward', to the end of everything the track plays after
 * it; 'joined', along the notes joined to it (each starting before the one before has rung out).
 * `sure`: false when what's remembered isn't known here (a plugin's).
 */
export interface NoteMemory {
  reach: 'onward' | 'joined';
  sure: boolean;
  kinds: MemoryKind[];
}

/**
 * The instruments that carry on from the note before (the 'legato' kind): the monophonic synths
 * (instruments.ts mono() and the EDM basses' createMonoBass, the 808 either way).
 */
export const LEGATO_INSTRUMENTS: ReadonlySet<InstrumentKey> = new Set<InstrumentKey>(['bass', 'subBass', 'lead', 'bass808', 'wobbleBass', 'growlBass', 'reeseBass']);

/** A recording name's take ("C4|1|0" is loudness 1, take 0; a release sound's "C4|1" is take 1). */
const takeOf = (name: string, at: number) => Number(name.split('|')[at] ?? 0) || 0;

const takesMemo = new Map<InstrumentKey, boolean>();
/** Whether `key` plays takes in turn: more than one take of some note at some loudness, or of its key-release sounds. */
export function playsTakesInTurn(key: InstrumentKey): boolean {
  let known = takesMemo.get(key);
  if (known === undefined) {
    const samples = INSTRUMENTS[key]?.samples;
    known = !!samples && (Object.keys(samples.samples).some((n) => takeOf(n, 2) > 0) || Object.keys(samples.releases?.samples ?? {}).some((n) => takeOf(n, 1) > 0));
    takesMemo.set(key, known);
  }
  return known;
}

/**
 * What `track` remembers from note to note, with `clips` (its clips, in any version of the song:
 * passes count when any of them has notes playing only some of the time); null for nothing.
 */
export function carriesState(track: Pick<Track, 'instrumentKey' | 'plugin' | 'subLayer'>, clips: readonly Pick<Clip, 'notes' | 'audio'>[] = []): NoteMemory | null {
  const def = INSTRUMENTS[track.instrumentKey];
  const kinds: MemoryKind[] = [];
  if (playsTakesInTurn(track.instrumentKey)) kinds.push('takes');
  if (STRUMMED.has(track.instrumentKey)) kinds.push('strum');
  if (clips.some((c) => !c.audio && clipHasConditions(c))) kinds.push('passes');
  const plugin = def?.kind === 'plugin' || !!track.plugin;
  if (plugin) kinds.push('plugin');
  if (LEGATO_INSTRUMENTS.has(track.instrumentKey) || (!!track.subLayer && track.subLayer.level > 0)) kinds.push('legato');
  if (!kinds.length) return null;
  return { reach: kinds.some((k) => k !== 'legato') ? 'onward' : 'joined', sure: !plugin, kinds };
}

/**
 * Whether a change of one of `clip`'s notes can move its other notes: with swing on (the clip's, or
 * a row's own), whether a note swings is decided over the whole clip (which 16th grid most of its
 * notes sit on, and an 8th with notes between its 16ths plays straight: transport.ts swungNotes).
 */
export function swingReadsClip(clip: Pick<Clip, 'groove'>): boolean {
  const g = clip.groove;
  return !!g && (g.swing > 0 || Object.values(g.rows ?? {}).some((r) => (r?.swing ?? 0) > 0));
}
