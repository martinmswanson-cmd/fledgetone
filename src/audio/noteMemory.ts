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
 * - cuts: a new note can end another one still sounding, for the rest of that one's length: a
 *   bowed string's legato change crossfades out the note held before it; a recorded instrument
 *   fades out the oldest of SAME_PITCH repeats of a pitch, or one of MAX_NOTES ringing at once
 *   (samplers/samplerManager.ts makeRoom; the drum rack, multi-sample, slicer and own-sample
 *   players too); the voice pools (keys, wavetable pad, brass: presets/poly.ts) retrigger their
 *   quietest voice when every voice is busy; the designed synth in mono lets the note before give
 *   way (presets/designer.ts). One short note added under a note held for eight bars ends it there,
 *   and taking that short note away lets it ring on again, so a change carries along every note
 *   sounding over it, to where each stops, and every note joined to those (a cut note frees a voice
 *   or a repeat for later notes): the same run as 'legato'.
 *
 * Checked and held (each note's sound depends on nothing played before it, or only on the notes
 * cut above): the Human insert, a note's small level and timing differences, a section's spread
 * and the strum's small differences (hashed from the note and its place: human.ts noteSeed,
 * noteJitter); breath (from the note's own start); the designed synth's other voices and the
 * native synths (supersaw, pluck, chip: a voice each note, no limit); hats choking each other (a
 * hit cut short by another, within its own ring); drum noise (seeded by the hit's time); the
 * drummer styles, the chord and bass tools (they write notes, nothing at play time). A clip's swing
 * is decided over the whole clip, the song's swing in a clip with none of its own too (see
 * swingReadsClip).
 */
import type { Clip, Track } from '../store/timelineTypes';
import { INSTRUMENTS, type InstrumentKey } from './instrumentCatalog';
import { STRUMMED } from './guitarStrum';
import { clipHasConditions } from '../store/noteChance';

/** What a track remembers from note to note (see the top of the file). */
export type MemoryKind = 'takes' | 'strum' | 'passes' | 'plugin' | 'legato' | 'cuts';

/**
 * How far a change of a note carries: 'onward', to the end of everything the track plays after
 * it; 'joined', along the notes sounding over it and joined to it (each starting before the one
 * before has rung out).
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

/** The synths that play from a pool of voices with a limit (presets/poly.ts createVoicePool): when every voice is busy, a new note takes one still sounding. */
export const VOICE_POOL_INSTRUMENTS: ReadonlySet<InstrumentKey> = new Set<InstrumentKey>(['keys', 'wavetable', 'brass']);

/** The kinds of instrument that play recordings through the sampler (samplerManager.ts), each able to fade out a note still sounding for a newer one. */
const SAMPLER_KINDS: ReadonlySet<string> = new Set(['sampled', 'custom', 'multi', 'rack', 'slicer']);

/**
 * Whether a new note on `track` can end another one still sounding (the 'cuts' kind, see the top
 * of the file): every recorded instrument, the voice pools, the designed synth in mono. (The
 * monophonic synths do too, and their 'legato' already carries a change the same way.)
 */
export function cutsNotes(track: Pick<Track, 'instrumentKey' | 'synth'>): boolean {
  const def = INSTRUMENTS[track.instrumentKey];
  if (!def) return false;
  return !!def.samples || SAMPLER_KINDS.has(def.kind) || VOICE_POOL_INSTRUMENTS.has(track.instrumentKey) || (track.instrumentKey === 'synthDesigner' && !!track.synth?.mono);
}

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
export function carriesState(track: Pick<Track, 'instrumentKey' | 'plugin' | 'subLayer' | 'synth'>, clips: readonly Pick<Clip, 'notes' | 'audio'>[] = []): NoteMemory | null {
  const def = INSTRUMENTS[track.instrumentKey];
  const kinds: MemoryKind[] = [];
  if (playsTakesInTurn(track.instrumentKey)) kinds.push('takes');
  if (STRUMMED.has(track.instrumentKey)) kinds.push('strum');
  if (clips.some((c) => !c.audio && clipHasConditions(c))) kinds.push('passes');
  const plugin = def?.kind === 'plugin' || !!track.plugin;
  if (plugin) kinds.push('plugin');
  if (LEGATO_INSTRUMENTS.has(track.instrumentKey) || (!!track.subLayer && track.subLayer.level > 0)) kinds.push('legato');
  if (cutsNotes(track)) kinds.push('cuts');
  if (!kinds.length) return null;
  return { reach: kinds.some((k) => k !== 'legato' && k !== 'cuts') ? 'onward' : 'joined', sure: !plugin, kinds };
}

/**
 * Whether a change of one of `clip`'s notes can move its other notes: with swing on (the clip's, or
 * a row's own), whether a note swings is decided over the whole clip (which 16th grid most of its
 * notes sit on, and an 8th with notes between its 16ths plays straight: transport.ts swungNotes,
 * scheduler.ts groupClipNotes). A clip with no swing of its own plays the song's (`songSwing`) the
 * same way; there the grid is the song's own unless the clip starts off it (only then can one note
 * more or less move the grid, and every note's swing with it: else what a note changes stays in its
 * own 8th).
 */
export function swingReadsClip(clip: Pick<Clip, 'groove'> & Partial<Pick<Clip, 'startBar'>>, songSwing = 0): boolean {
  const g = clip.groove;
  if (!g) return songSwing > 0 && offSongGrid(clip.startBar ?? 1);
  return g.swing > 0 || Object.values(g.rows ?? {}).some((r) => (r?.swing ?? 0) > 0);
}

/** Whether a clip starting at `startBar` starts off the song's 16th grid, by the ticks the scheduler places it at (192 a quarter note: transport.ts barToTicks). */
const offSongGrid = (startBar: number): boolean => Math.max(0, Math.round((startBar - 1) * 4 * 192)) % 48 !== 0;
