import type { Clip, NoteEvent, Track } from './timelineTypes';
import { barsToDuration } from './timelineTypes';
import { nameOf } from './noteTools';
import type { SongKey } from './songKey';
import { MAJOR_STEPS, MINOR_STEPS, keyHomeName, keyOf, liftedHome, spellFrom, spellNote } from './songKey';
import { chordNameIn, CHORD_QUALITIES, voiceLead, type ChordQuality } from './smartTools';
import { addMeasures, measureCount, type MeterMap } from '../audio/tempoMap';
import { maxOf, minOf } from '../support/minMax';

/**
 * Chord progressions for chills: the shiver some music gives at an emotional peak. Each leans on
 * one of the devices that do it reliably (a major chord a third away, the borrowed minor iv, a
 * cadence that goes somewhere else, suspensions that resolve late, a held pedal note, a key change
 * up, a bass that climbs, chords that open out), in the song's or the clip's key, major or minor,
 * voiced for synths and pads: one bass note low, the chord above it in the middle of the keyboard,
 * never a low cluster. Plain maths, so Node can unit-test it.
 */

const pc = (m: number) => ((m % 12) + 12) % 12;
const EPS = 1e-6;
const round = (bars: number) => Math.round(bars * 192) / 192;

/** One chord of a chills progression, by its root in semitones over the key's home note. */
export interface ChillsChord {
  semis: number;
  quality: ChordQuality;
  /** Starts with a 4th in place of its 3rd, which falls to the 3rd late in the chord */
  sus?: boolean;
  /** The bass on this note (semitones over home, 12 an octave up) in place of the chord's root */
  bass?: number;
  /** Moved up by this many semitones: the key change */
  up?: number;
  /** Its rich chord, where the rule (richQuality) wouldn't choose it */
  rich?: RichQuality;
}

/**
 * How the chords are voiced: 'plain' (the chords as written: triads, and the 7ths a progression
 * names) or 'rich' (with their 7ths and 9ths, a 13th or an altered 9th on a dominant, 4 or 5 notes
 * above the bass, each moving as little as it can from the chord before).
 */
export type ChillsVoicingStyle = 'plain' | 'rich';
export const CHILLS_VOICINGS: ReadonlyArray<{ id: ChillsVoicingStyle; name: string; detail: string }> = [
  { id: 'plain', name: 'Plain chords', detail: 'The chords as written: three notes each (four for a 7th), over the low note.' },
  { id: 'rich', name: 'Rich chords', detail: 'With their 7ths and 9ths (a 13th, or a 9th bent sharp or flat, on the chords that pull home), four or five notes over the low note, each moving a step or two from the chord before.' },
];

/** A rich chord: its notes over the root (an added tone, the 9th, 11th or 13th, is 12 or more) and its name after the root. */
const RICH = {
  maj9: { ivs: [0, 4, 7, 11, 14], name: 'maj9' },
  add9: { ivs: [0, 4, 7, 14], name: 'add9' },
  maj7: { ivs: [0, 4, 7, 11], name: 'maj7' },
  six: { ivs: [0, 4, 7, 9], name: '6' },
  dom9: { ivs: [0, 4, 7, 10, 14], name: '9' },
  dom13: { ivs: [0, 4, 10, 14, 21], name: '13' },
  dom7: { ivs: [0, 4, 7, 10], name: '7' },
  dom7b9: { ivs: [0, 4, 7, 10, 13], name: '7♭9' },
  dom7s9: { ivs: [0, 4, 10, 15], name: '7♯9' },
  min9: { ivs: [0, 3, 7, 10, 14], name: 'm9' },
  min11: { ivs: [0, 3, 7, 10, 14, 17], name: 'm11' },
  min7: { ivs: [0, 3, 7, 10], name: 'm7' },
  minAdd9: { ivs: [0, 3, 7, 14], name: 'm(add9)' },
  halfDim7: { ivs: [0, 3, 6, 10], name: 'm7♭5' },
} as const;
export type RichQuality = keyof typeof RICH;

export type ChillsId = 'mediant' | 'borrowedIv' | 'deceptive' | 'suspended' | 'pedal' | 'liftStep' | 'liftHalf' | 'risingBass' | 'widening' | 'soulTurn' | 'minorHome';

export interface ChillsProgression {
  id: ChillsId;
  name: string;
  /** What makes it work, in plain words */
  detail: string;
  /** In a major key and in a minor one */
  major: readonly ChillsChord[];
  minor: readonly ChillsChord[];
  /** The home note held low under every chord */
  pedal?: boolean;
  /** Each chord voiced wider than the one before */
  widen?: boolean;
  /** A key change: played once over its span (repeated, it would drop back down) */
  lift?: number;
  /** The bass climbs from the home note an octave below the usual bass, so the chords above climb with it */
  climb?: boolean;
  /** Played once over its span (its last chord is the arrival: played again, it would arrive mid-way) */
  once?: boolean;
  /** How it's voiced unless another is picked (plain when not said) */
  voicing?: ChillsVoicingStyle;
}

/** Whether a progression plays once over its span, however long (a key change, or an arrival at its end). */
export const playsOnce = (prog: ChillsProgression): boolean => !!prog.lift || !!prog.once;

/** The voicing a progression is written in: the one picked, else its own (plain unless it says). */
export const voicingOf = (prog: ChillsProgression, picked?: ChillsVoicingStyle | null): ChillsVoicingStyle => picked ?? prog.voicing ?? 'plain';

const C = (semis: number, quality: ChordQuality, more: Partial<ChillsChord> = {}): ChillsChord => ({ semis, quality, ...more });
const up = (chords: readonly ChillsChord[], semis: number): ChillsChord[] => chords.map((c) => ({ ...c, up: semis }));

const MAJOR_LOOP = [C(0, 'maj'), C(7, 'maj'), C(9, 'min'), C(5, 'maj')];
const MINOR_LOOP = [C(0, 'min'), C(8, 'maj'), C(3, 'maj'), C(10, 'maj')];

/** The chills progressions, each for a major and a minor key. */
export const CHILLS: readonly ChillsProgression[] = [
  {
    id: 'mediant',
    name: 'A major chord a third away',
    detail: 'Home, then a major chord a third away that keeps one of its notes: the ground shifts under a note that stays put. In a minor key, home comes back major at the end.',
    major: [C(0, 'maj'), C(8, 'maj'), C(0, 'maj'), C(4, 'maj')],
    minor: [C(0, 'min'), C(8, 'maj'), C(5, 'min'), C(0, 'maj')],
  },
  {
    id: 'borrowedIv',
    name: 'The minor iv',
    detail: 'The IV chord turns minor: one note slips down a half step, a bittersweet ache just before home. In a minor key, the bright major IV comes first.',
    major: [C(0, 'maj'), C(7, 'maj'), C(5, 'maj'), C(5, 'min')],
    minor: [C(0, 'min'), C(5, 'maj'), C(5, 'min'), C(0, 'min')],
  },
  {
    id: 'deceptive',
    name: 'Almost home, then somewhere else',
    detail: 'The V7 pulls hard toward home, and the music lands on another chord instead: the ear was sure of the next chord and gets a bigger one.',
    major: [C(0, 'maj'), C(5, 'maj'), C(7, 'dom7'), C(8, 'maj')],
    minor: [C(0, 'min'), C(5, 'min'), C(7, 'dom7'), C(8, 'maj')],
  },
  {
    id: 'suspended',
    name: 'Held, then let go',
    detail: 'The last two chords each hold a note that wants to fall, and it falls late in the chord: the release comes after you have waited for it.',
    major: [C(9, 'min'), C(5, 'maj'), C(7, 'maj', { sus: true }), C(0, 'maj', { sus: true })],
    minor: [C(0, 'min'), C(8, 'maj'), C(10, 'maj', { sus: true }), C(0, 'min', { sus: true })],
  },
  {
    id: 'pedal',
    name: 'One note held under moving chords',
    detail: 'The home note holds low under every chord. As the chords move away it rubs against them, and the tension grows until they come back to it.',
    major: [C(0, 'maj'), C(5, 'maj'), C(9, 'min'), C(7, 'maj')],
    minor: [C(0, 'min'), C(8, 'maj'), C(5, 'min'), C(7, 'maj')],
    pedal: true,
  },
  {
    id: 'liftStep',
    name: 'Up a whole step for the last time through',
    detail: 'The chords play once, then a chord from the new key leads them up a whole step: the same music, higher and brighter, as if it found more strength.',
    major: [...MAJOR_LOOP.slice(0, 3), C(9, 'dom7'), ...up(MAJOR_LOOP, 2)],
    minor: [...MINOR_LOOP.slice(0, 3), C(9, 'dom7'), ...up(MINOR_LOOP, 2)],
    lift: 2,
  },
  {
    id: 'liftHalf',
    name: 'Up a half step, straight in',
    detail: 'The chords play once, then all of them jump up a half step with no warning: a sudden lift that sounds like the last chorus.',
    major: [...MAJOR_LOOP, ...up(MAJOR_LOOP, 1)],
    minor: [...MINOR_LOOP, ...up(MINOR_LOOP, 1)],
    lift: 1,
  },
  {
    id: 'risingBass',
    name: 'A bass that climbs step by step',
    detail: 'The lowest note climbs the scale one step a chord, a whole octave, so each chord feels higher than the last and the top lands home.',
    major: [C(0, 'maj', { bass: 0 }), C(2, 'min', { bass: 2 }), C(0, 'maj', { bass: 4 }), C(5, 'maj', { bass: 5 }), C(7, 'maj', { bass: 7 }), C(9, 'min', { bass: 9 }), C(7, 'maj', { bass: 11 }), C(0, 'maj', { bass: 12 })],
    minor: [C(0, 'min', { bass: 0 }), C(10, 'maj', { bass: 2 }), C(3, 'maj', { bass: 3 }), C(5, 'min', { bass: 5 }), C(7, 'maj', { bass: 7 }), C(8, 'maj', { bass: 8 }), C(10, 'maj', { bass: 10 }), C(0, 'min', { bass: 12 })],
    climb: true,
  },
  {
    id: 'widening',
    name: 'Chords that open out',
    detail: 'Each chord is spread wider than the last, from a close chord in the middle to a low root and a high top, as if the room grows. Each note is played a little softer as more join, so it grows without jumping in level.',
    major: [C(9, 'min'), C(5, 'maj'), C(0, 'maj'), C(7, 'maj')],
    minor: [C(0, 'min'), C(8, 'maj'), C(3, 'maj'), C(10, 'maj')],
    widen: true,
  },
  {
    id: 'soulTurn',
    name: 'A soul turnaround with a turn away',
    detail: 'The chords go round ii, V and home, every voice moving a step or so (written with rich 9th and 13th chords). Halfway they turn away to a major chord borrowed from the minor key and the minor iv, then a tense chord whose sharp note slips down a half step pulls them back to the ii, the V and home. In a minor key, the same in minor.',
    major: [
      C(0, 'maj'), C(9, 'min'), C(2, 'min'), C(7, 'dom7', { rich: 'dom13' }),
      C(4, 'min', { rich: 'min7' }), C(9, 'min'), C(2, 'min'), C(7, 'dom7', { rich: 'dom13' }),
      C(8, 'maj', { rich: 'maj9' }), C(5, 'min', { rich: 'min9' }), C(4, 'min', { rich: 'min7' }), C(9, 'maj', { rich: 'dom7s9' }),
      C(9, 'dom7', { rich: 'dom7b9' }), C(2, 'min'), C(7, 'dom7', { rich: 'dom7b9' }), C(0, 'maj'),
    ],
    minor: [
      C(0, 'min'), C(5, 'min'), C(2, 'halfDim7'), C(7, 'dom7', { rich: 'dom7b9' }),
      C(3, 'maj'), C(0, 'min'), C(2, 'halfDim7'), C(7, 'dom7', { rich: 'dom7b9' }),
      C(8, 'maj'), C(5, 'min'), C(3, 'maj'), C(9, 'maj', { rich: 'dom7s9' }),
      C(9, 'dom7', { rich: 'dom7b9' }), C(2, 'halfDim7'), C(7, 'dom7', { rich: 'dom7b9' }), C(0, 'min'),
    ],
    voicing: 'rich',
  },
  {
    id: 'minorHome',
    name: 'Two minor chords, then a major home',
    detail: 'Two minor chords rock back and forth, the minor iv and home (written rich, a minor 9th and 11th), four times, and the last time home turns major: that bright last chord is the chill. In a major key it borrows the minor iv and a minor home, and ends on the song’s own major home.',
    major: [...Array.from({ length: 3 }, () => [C(5, 'min', { rich: 'min9' }), C(0, 'min', { rich: 'min11' })]).flat(), C(5, 'min', { rich: 'min9' }), C(0, 'maj', { rich: 'six' })],
    minor: [...Array.from({ length: 3 }, () => [C(5, 'min', { rich: 'min9' }), C(0, 'min', { rich: 'min11' })]).flat(), C(5, 'min', { rich: 'min9' }), C(0, 'maj', { rich: 'six' })],
    once: true,
    voicing: 'rich',
  },
];

export const chillsById = (id: string): ChillsProgression | undefined => CHILLS.find((p) => p.id === id);

/** A progression's chords for the key's mode (major, or minor by its third). */
export const chillsChords = (key: Pick<SongKey, 'mode'>, prog: ChillsProgression): readonly ChillsChord[] => (key.mode === 'minor' ? prog.minor : prog.major);

/** A chord's pitch classes in the key, root first (its resolved chord for a suspended one). */
export function chillsPcs(key: Pick<SongKey, 'root'>, c: ChillsChord): number[] {
  const root = pc(key.root + c.semis + (c.up ?? 0));
  return CHORD_QUALITIES[c.quality].map((i) => pc(root + i));
}

/** The bass note's pitch class for a chord: its root, or its own bass note. */
const bassPc = (key: Pick<SongKey, 'root'>, c: ChillsChord) => pc(key.root + (c.bass ?? c.semis) + (c.up ?? 0));

const has = (scale: readonly number[], semis: number) => scale.includes(pc(semis));
/** The key's harmonic minor: its natural minor with the raised 7th. */
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11] as const;

/**
 * A chord's rich chord: its own (`rich`), else by the rule, from the notes of the key (and of the
 * borrowed one: the minor for a major key, the harmonic minor for a minor one) the 7th and 9th fit:
 * a major chord maj9 where its major 7th belongs (I, IV, ♭VI, and home turned major), 9 where the
 * flat 7th does (V, ♭VII), a minor key's major V 7♭9, else add9; a minor chord m9 (ii, vi, iv, i), m7 where the 9th is outside (iii, v); a dominant 7th
 * 13 in a major key, 7♭9 in a minor one, the way it leans toward a minor chord. A suspended chord
 * with a major 7th keeps only the 9th (a major 7th against the held 4th grates).
 */
export function richQuality(key: Pick<SongKey, 'mode'>, c: ChillsChord): RichQuality {
  if (c.rich) return c.rich;
  const own = key.mode === 'minor' ? MINOR_STEPS : MAJOR_STEPS;
  const borrowed = key.mode === 'minor' ? HARMONIC_MINOR : MINOR_STEPS;
  const fits = (...ivs: number[]) => [own, borrowed].find((sc) => ivs.every((i) => has(sc, c.semis + i)));
  switch (c.quality) {
    case 'maj': {
      // Home turned major (in a minor key, the bright ending): maj9, the brightest
      if (pc(c.semis) === 0) return c.sus ? 'add9' : 'maj9';
      for (const sc of [own, borrowed]) {
        if (has(sc, c.semis + 11) && has(sc, c.semis + 2)) return c.sus ? 'add9' : 'maj9';
        if (has(sc, c.semis + 10) && has(sc, c.semis + 2)) return 'dom9';
      }
      // The major V of a minor key leans home as a 7♭9
      return key.mode === 'minor' && pc(c.semis) === 7 && !c.sus ? 'dom7b9' : 'add9';
    }
    case 'min':
      return fits(10, 2) ? 'min9' : fits(10) ? 'min7' : 'minAdd9';
    case 'dom7':
      return key.mode === 'minor' ? 'dom7b9' : 'dom13';
    case 'halfDim7':
    case 'dim':
      return 'halfDim7';
    case 'maj7':
      return 'maj9';
    case 'min7':
      return 'min9';
    default:
      return c.quality === 'dom9' ? 'dom9' : 'min9';
  }
}

/** A rich chord's notes over its root, in semitones (the added tones 12 or more). */
export const richIntervals = (q: RichQuality): readonly number[] => RICH[q].ivs;

/** A chord's pitch classes as voiced (`voicing`): plain, its chord as written; rich, its rich chord. Root first. */
export function chillsChordPcs(key: Pick<SongKey, 'root' | 'mode'>, c: ChillsChord, voicing: ChillsVoicingStyle = 'plain'): number[] {
  if (voicing === 'plain') return chillsPcs(key, c);
  const root = pc(key.root + c.semis + (c.up ?? 0));
  return RICH[richQuality(key, c)].ivs.map((i) => pc(root + i));
}

/** The home note's name as a key on `root` in `mode` is written (songKey.ts keyHomeName). */
export const homeName = keyHomeName;

/** A key's name as it's written: "B♭ major", "C♯ minor". */
export const chillsKeyName = (key: Pick<SongKey, 'root' | 'mode'>): string => `${keyHomeName(key.root, key.mode)} ${key.mode}`;

export { spellNote };

/** A chord's name after its root, as chordName (smartTools) writes it, with ♭ and ♯ for b and #. */
const plainSuffix = (pcs: readonly number[]) => chordNameIn(keyOf(pcs[0], 'major'), pcs).replace(/^[A-G][♭♯]?/, '');

/** A rich chord's name after its root, held on its 4th: "9sus4", "sus4(add9)". */
function susSuffix(q: RichQuality): string {
  const ivs = RICH[q].ivs as readonly number[];
  if (ivs.includes(10)) return ivs.includes(21) ? '13sus4' : ivs.includes(14) ? '9sus4' : '7sus4';
  return ivs.includes(14) ? 'sus4(add9)' : 'sus4';
}

/**
 * The chords' names in the key, as voiced: "C – F/C – Am/C" plain, "Gm9 – C13 – Fmaj9" rich, a
 * suspended one "Gsus4 G" ("G9sus4 G9"). Each root spelled by its step in the key (D♭ in F, not C♯).
 */
export function chillsNames(key: Pick<SongKey, 'root' | 'mode'>, prog: ChillsProgression, voicing?: ChillsVoicingStyle | null, range?: readonly [number, number]): string[] {
  const style = voicingOf(prog, voicing);
  // (on an instrument without room for a rich chord, the chord it plays: the plain one)
  const voiced = style === 'rich' && range ? chillsVoicings(key, prog, { range, voicing: style }) : null;
  return chillsChords(key, prog).map((c, i) => {
    const up = c.up ?? 0;
    const root = pc(key.root + up);
    // (after a key change, the new key written to agree with the chord that led to it)
    const home = up ? liftedHome(keyHomeName(key.root, key.mode), key.root, up) : keyHomeName(key.root, key.mode);
    const name = (semis: number) => spellFrom(home, root, semis);
    const rich = style === 'rich' && !voiced?.[i]?.plain ? richQuality(key, c) : null;
    const pcs = chillsPcs(key, c);
    const chord = `${name(c.semis)}${rich ? RICH[rich].name : plainSuffix(pcs)}`;
    const b = prog.pedal ? pc(key.root) : bassPc(key, c);
    const slash = b !== pcs[0] ? `${chord}/${prog.pedal ? spellNote(key.root, key.mode, 0) : name(c.bass ?? c.semis)}` : chord;
    if (!c.sus) return slash;
    const held = rich ? susSuffix(rich) : plainSuffix([pcs[0], pc(pcs[0] + 5), pc(pcs[0] + 7)]);
    return `${name(c.semis)}${held} ${slash}`;
  });
}

/**
 * Where the chords of a progression of `count` chords go to fill [from, to) (song positions, a
 * section or a clip), from `from`: each chord lasts the most of 4, 2, 1, a half or a quarter
 * measure (as the ruler counts them, three beats in 3/4) that lets the whole progression fit,
 * played as many times as fit (once for a key change), the last chord held to the end.
 */
export function chillsSpans(from: number, to: number, count: number, map: MeterMap, once = false): Array<{ start: number; length: number }> {
  const measures = measureCount(from, to, map);
  if (!(measures > EPS) || count < 1) return [];
  const per = [4, 2, 1, 0.5, 0.25].find((c) => count * c <= measures + EPS) ?? measures / count;
  const passes = once ? 1 : Math.max(1, Math.floor(measures / (count * per) + EPS));
  const at = (i: number) => addMeasures(from, i * per, map) - from;
  const end = to - from;
  const spans = Array.from({ length: passes * count }, (_, i) => ({ start: at(i), length: at(i + 1) - at(i) })).filter((s) => s.start < end - EPS);
  const last = spans[spans.length - 1];
  if (last) last.length = end - last.start;
  return spans;
}

/** Below this (MIDI, E3) notes sit in the low register, where close notes turn to mud. */
export const LOW_REGISTER = 52;
/** The lowest a bass note goes (MIDI, E2). */
export const BASS_FLOOR = 40;
/** The lowest a climbing bass starts (MIDI, C2): it ends an octave higher. */
export const CLIMB_FLOOR = 36;

/** The lowest a bass instrument's roots go (MIDI, E1). */
export const ROOTS_FLOOR = 28;

/**
 * How an instrument of `range` plays the progressions: 'roots' (a bass instrument: too low for a
 * chord above E3, it plays each chord's root, or the climbing bass, or the pedal, inside its
 * range), 'full' (a low note and the chord over it) or 'chord' (no room for a low note under it).
 * `low` is where its low notes start.
 */
export function registerOf(range: readonly [number, number] = [0, 127]): { kind: 'roots' | 'full' | 'chord'; low: number } {
  const [lo, hi] = range;
  if (hi < LOW_REGISTER + 12) return { kind: 'roots', low: Math.max(lo, ROOTS_FLOOR) };
  const low = Math.max(lo, BASS_FLOOR);
  // (a low note needs a chord's room over it, out of the low register: up to about A4)
  return { kind: low <= LOW_REGISTER && hi - low >= 24 && hi >= LOW_REGISTER + 17 ? 'full' : 'chord', low };
}

/** One chord's notes as voiced: the bass (if any) and the notes above it, low to high. */
export interface ChillsVoicing {
  bass: number[];
  upper: number[];
  /** Asked for rich, but the instrument had no room for it: the plain chord (and named so) */
  plain?: boolean;
}

export interface ChillsVoiceOptions {
  /** The lowest and highest notes the instrument plays */
  range?: readonly [number, number];
  /** Plain or rich chords (not given: the progression's own, voicingOf) */
  voicing?: ChillsVoicingStyle | null;
}

/** The highest a rich chord's top note goes (MIDI, A5): above it a pad's 9ths and 13ths turn shrill. */
export const RICH_TOP = 81;
/** How far past RICH_TOP the chords over a climbing bass may go (to D6), as they climb with it. */
export const RICH_CLIMB_ROOM = 5;
/** How far past RICH_TOP a chord may go (to E6) where the instrument's bass sits so high there's no room under A5. */
export const RICH_HIGH_ROOM = 7;
/** Whole steps between neighbouring notes of a rich chord only from here up (MIDI, A3): lower, they blur. */
export const RICH_STEP_FLOOR = 57;
/** The most a voice of a rich chord moves to the next chord, where it can (semitones: a 4th). */
export const RICH_MOST_MOVE = 5;

interface RichPlace {
  floor: number;
  top: number;
  center: number;
  /** Whether a low note plays the root under the chord (then the chord may leave its own root out) */
  bassUnder: boolean;
  /** The most from the chord's lowest note to its top (the close first chord of chords that open out) */
  maxSpan?: number;
  /** Chords that open out: gaps up to an octave between neighbours */
  open?: boolean;
}

/** The total movement from `prev` to `notes`: each note to the nearest of the other chord's, both ways (a common tone moves 0). */
export function richMove(prev: readonly number[], notes: readonly number[]): { total: number; most: number } {
  let total = 0;
  let most = 0;
  const near = (n: number, b: readonly number[]) => {
    let d = Infinity;
    for (const p of b) d = Math.min(d, Math.abs(p - n));
    return d;
  };
  for (const n of notes) {
    const d = near(n, prev);
    total += d;
    most = Math.max(most, d);
  }
  for (const n of prev) {
    const d = near(n, notes);
    total += d;
    most = Math.max(most, d);
  }
  return { total, most };
}

/** What moving from one rich chord to the next costs: the total movement, and much more for any voice past a 4th. */
const richStep = (prev: readonly number[], notes: readonly number[]) => {
  const move = richMove(prev, notes);
  return move.total + (move.most > RICH_MOST_MOVE ? 12 * (move.most - RICH_MOST_MOVE) : 0);
};

interface RichCandidate {
  notes: number[];
  /** Its own cost: how far from the middle, how high, a note left out, a wide gap */
  cost: number;
}

/**
 * Every way to place a rich chord's notes (`ivs` over the pitch class `root`) between `floor` and
 * `top`: no two a half step apart (nor a minor 9th, but a ♭9 over its root), whole steps only from
 * A3 up, a 9th, 11th or 13th never the lowest, no gap wider than a 6th between neighbours (an
 * octave for chords that open out), four or five notes: where all of them won't go, the 5th, or
 * the root the bass plays, is left out. Each with its own cost: near `center`, a gap over a 5th,
 * a note left out and a top above G5 cost more.
 */
function richCandidates(root: number, ivs: readonly number[], place: RichPlace): RichCandidate[] {
  const { floor, top } = place;
  const sets: number[][] = [];
  const without = (...drop: number[]) => ivs.filter((i) => !drop.includes(i));
  if (ivs.length <= 5) sets.push([...ivs]);
  if (place.bassUnder && ivs.length >= 6) sets.push(without(0));
  if (ivs.length >= 5 && ivs.includes(7)) sets.push(without(7));
  if (place.bassUnder && ivs.length === 5) sets.push(without(0));
  if (place.bassUnder && ivs.length >= 6) sets.push(without(0, 7));
  const widest = place.open ? 12 : 9;
  const out: RichCandidate[] = [];
  sets.forEach((set, k) => {
    if (set.length > 5 || set.length < 4) return;
    const ivOf = new Map(set.map((iv) => [pc(root + iv), iv] as const));
    const options = set.map((iv) => {
      const at: number[] = [];
      for (let m = floor + pc(root + iv - floor); m <= top; m += 12) at.push(m);
      return at;
    });
    const pick: number[] = [];
    const walk = (d: number) => {
      if (d < set.length) {
        for (const m of options[d]) {
          pick.push(m);
          walk(d + 1);
          pick.pop();
        }
        return;
      }
      const notes = [...pick].sort((x, y) => x - y);
      const span = notes[notes.length - 1] - notes[0];
      if (place.maxSpan !== undefined && span > place.maxSpan) return;
      if ((ivOf.get(pc(notes[0])) ?? 0) >= 12) return;
      let gapCost = 0;
      for (let i = 0; i < notes.length; i++)
        for (let j = i + 1; j < notes.length; j++) {
          const gap = notes[j] - notes[i];
          if (gap === 1) return;
          if (gap === 13 && !(ivOf.get(pc(notes[i])) === 0 && ivOf.get(pc(notes[j])) === 13)) return;
          if (j === i + 1) {
            if (gap <= 2 && notes[i] < RICH_STEP_FLOOR) return;
            if (gap > widest) return;
            if (gap > 7 && !place.open) gapCost += 2;
          }
        }
      const mean = notes.reduce((x, y) => x + y, 0) / notes.length;
      out.push({ notes, cost: 0.4 * Math.abs(mean - place.center) + Math.max(0, notes[notes.length - 1] - (RICH_TOP - 2)) + gapCost + 2 * k });
    };
    walk(0);
  });
  return out;
}

/**
 * The rich chords of a run of chords, each from its candidates, together moving least: the
 * total movement from one to the next (from `start`, the chord before the run, if any), plus each
 * one's own cost, the smallest over the whole run (so a chord leaves room for the one after it).
 * `wider`: each must spread wider than the one before (chords that open out), given each chord's
 * low notes. `round`: the run is played again, so the last chord leads back to the first too.
 * Ties go to the first found: always the same answer.
 */
function richRun(run: ReadonlyArray<{ cands: RichCandidate[]; bass: readonly number[] }>, start: readonly number[] | null, wider: boolean, round = false): number[][] {
  if (!run.length) return [];
  const total = (k: number, notes: readonly number[]) => notes[notes.length - 1] - minOf([notes[0], ...run[k].bass]);
  /** The best path with the first chord limited to `first` (all when null), and what it costs */
  const solve = (first: number | null): { cost: number; picks: number[] } | null => {
    let cost = run[0].cands.map((c, a) => (first !== null && a !== first ? Infinity : c.cost + (start ? richStep(start, c.notes) : 0)));
    const back: number[][] = [];
    for (let k = 1; k < run.length; k++) {
      const next: number[] = [];
      const from: number[] = [];
      for (const c of run[k].cands) {
        let best = Infinity;
        let at = -1;
        run[k - 1].cands.forEach((p, a) => {
          if (!Number.isFinite(cost[a])) return;
          if (wider && total(k, c.notes) <= total(k - 1, p.notes)) return;
          const v = cost[a] + richStep(p.notes, c.notes);
          if (v < best - EPS) {
            best = v;
            at = a;
          }
        });
        next.push(best + c.cost);
        from.push(at);
      }
      back.push(from);
      cost = next;
    }
    // (played again: back from the last chord to the first)
    if (first !== null && run.length > 1) cost = cost.map((v, a) => v + richStep(run[run.length - 1].cands[a].notes, run[0].cands[first].notes));
    let end = -1;
    cost.forEach((v, a) => {
      if (Number.isFinite(v) && (end < 0 || v < cost[end] - EPS)) end = a;
    });
    if (end < 0) return null;
    const sum = cost[end];
    const picks: number[] = [];
    for (let k = run.length - 1; k >= 0; k--) {
      picks.unshift(end);
      if (k > 0) end = back[k - 1][end];
    }
    return { cost: sum, picks };
  };
  let best = solve(null);
  // Played again: the last chord leads back to the first too. Tried with the first chord limited to
  // the few that sit closest to the last one found, the whole way round counted; the best kept
  if (round && !wider && best && run.length > 1 && !start) {
    const wrap = (p: { picks: number[] }) => richStep(run[run.length - 1].cands[p.picks[p.picks.length - 1]].notes, run[0].cands[p.picks[0]].notes);
    let around = best.cost + wrap(best);
    const last = run[run.length - 1].cands[best.picks[best.picks.length - 1]].notes;
    const firsts = run[0].cands.map((c, a) => ({ a, v: c.cost + richStep(last, c.notes) })).sort((x, y) => x.v - y.v || x.a - y.a).slice(0, 6);
    for (const { a } of firsts) {
      const got = solve(a);
      if (got && got.cost < around - EPS) {
        around = got.cost;
        best = got;
      }
    }
  }
  // (nothing spreads wider each time: as wide as they come, in order)
  if (!best) return wider ? richRun(run, start, false, round) : [];
  const chosen: { cost: number; picks: number[] } = best;
  return chosen.picks.map((a, k) => run[k].cands[a].notes);
}

/** The last rich voicings worked out, by key, progression and range (the dialogs and Pocket name every progression on each render). */
const richMemo = new Map<string, ChillsVoicing[]>();

/** The voicings of a progression's chords (one per chord, in order). */
export function chillsVoicings(key: Pick<SongKey, 'root' | 'mode'>, prog: ChillsProgression, opts: ChillsVoiceOptions = {}): ChillsVoicing[] {
  if (voicingOf(prog, opts.voicing) !== 'rich') return voicingsOf(key, prog, opts);
  const id = `${key.root} ${key.mode} ${prog.id} ${opts.range?.join(' ') ?? ''}`;
  let got = richMemo.get(id);
  if (!got || CHILLS.find((p) => p.id === prog.id) !== prog) {
    got = voicingsOf(key, prog, opts);
    if (richMemo.size > 200) richMemo.clear();
    if (CHILLS.includes(prog)) richMemo.set(id, got);
  }
  return got.map((v) => ({ ...v, bass: [...v.bass], upper: [...v.upper] }));
}

function voicingsOf(key: Pick<SongKey, 'root' | 'mode'>, prog: ChillsProgression, opts: ChillsVoiceOptions): ChillsVoicing[] {
  const chords = chillsChords(key, prog);
  const [lo, hi] = opts.range ?? [0, 127];
  const reg = registerOf([lo, hi]);
  const bassLo = reg.low;
  const lift = prog.lift ?? 0;
  if (reg.kind === 'roots') return rootsOnly(key, prog, [lo, hi]);
  const top = hi - 3 - lift;
  // Around E4, the middle of a pad's range, and room above it for the key change
  const center = Math.min(Math.max(64, Math.max(lo, LOW_REGISTER) + 6), top - 5);
  const climbLo = Math.max(lo, CLIMB_FLOOR);
  const home = prog.climb ? climbLo + pc(key.root - climbLo) : bassLo + pc(key.root - bassLo);
  // (a climb needs its octave and a chord over its top: where the instrument hasn't the room, chords alone)
  const hasBass = reg.kind === 'full' && (!prog.climb || home + 12 + 7 + 7 <= hi);
  const rich = voicingOf(prog, opts.voicing) === 'rich';
  // The same chord before the key change: a chord after it is that one moved up, the music lifting as a whole
  const copyOf = (c: ChillsChord, i: number) => (c.up ? chords.findIndex((d, k) => k < i && !d.up && d.semis === c.semis && d.quality === c.quality && !!d.sus === !!c.sus && d.bass === c.bass && d.rich === c.rich) : -1);
  // Under each chord: the bass (the home note under a pedal is held separately), the chord's own bass note, or its root; and how low the chord above may go
  const lowPart = (c: ChillsChord, i: number) => {
    const pcs = chillsPcs(key, c);
    const level = prog.widen ? Math.round((3 * i) / Math.max(1, chords.length - 1)) : 1;
    const bass: number[] = [];
    if (hasBass && !prog.pedal && level >= 1) {
      const b = c.bass !== undefined ? home + c.bass : bassLo + pc(bassPc(key, c) - bassLo);
      bass.push(b);
      // Wide open: the 5th over the bass too
      if (level >= 3 && pcs.includes(pc(b + 7))) bass.push(b + 7);
    }
    const lowest = prog.pedal && hasBass ? home : (bass[0] ?? -Infinity);
    // The chord above: at least a 5th over everything under it (a 4th over a doubled 5th), and out of the low register
    const floor = Math.max(lo, LOW_REGISTER, lowest + 7, bass.length > 1 ? bass[1] + (bass[1] < LOW_REGISTER ? 7 : 5) : -Infinity);
    return { pcs, level, bass, floor };
  };
  // Rich: every chord's 4 or 5 notes chosen together, a run at a time, to move least (richRun)
  const plan: Array<number[] | null> = chords.map(() => null);
  if (rich) {
    let run: Array<{ i: number; cands: RichCandidate[]; bass: number[] }> = [];
    let start: number[] | null = null;
    const flush = () => {
      // (a progression played again goes from its last chord back to its first: led smoothly too)
      const round = !playsOnce(prog) && run.length === chords.length;
      richRun(run, start, !!prog.widen, round).forEach((notes, k) => (plan[run[k].i] = notes));
      run = [];
    };
    const candidatesOf = (c: ChillsChord, i: number, high: boolean, first: readonly number[] | null) => {
      const { pcs, level, bass, floor } = lowPart(c, i);
      const place: RichPlace = {
        floor,
        // (chords that open out keep opening as in plain; over a climbing bass the chords climb a few notes past A5)
        // (a chord already up a key, and the first after the lifted ones, as high as those reach)
        top: Math.max((prog.widen ? hi : Math.min(hi, RICH_TOP + (high ? RICH_HIGH_ROOM : prog.climb ? RICH_CLIMB_ROOM : 0))) - (c.up ? 0 : lift), first ? Math.min(hi - (c.up ? 0 : lift), maxOf(first)) : -Infinity),
        center: Math.max(65, floor + 8),
        bassUnder: bass.length > 0 && pc(bass[0]) === pcs[0],
        ...(prog.widen ? { open: true, ...(level === 0 ? { maxSpan: 12 } : {}) } : {}),
      };
      const root = pc(key.root + c.semis + (c.up ?? 0));
      const ivs = RICH[richQuality(key, c)].ivs;
      let cands = richCandidates(root, ivs, place);
      if (!cands.length && !high && place.top < hi - lift) cands = richCandidates(root, ivs, { ...place, top: Math.min(hi, RICH_TOP + RICH_HIGH_ROOM) - (c.up ? 0 : lift) });
      return { cands, bass };
    };
    // Where the bass sits so high (an instrument starting at C3) that a chord needs room up to E6,
    // every chord gets that room, so they can all sit together there and not jump up and down
    const high = chords.some((c, i) => copyOf(c, i) < 0 && !richCandidates(pc(key.root + c.semis + (c.up ?? 0)), RICH[richQuality(key, c)].ivs, { floor: lowPart(c, i).floor, top: Math.min(hi, RICH_TOP + (prog.climb ? RICH_CLIMB_ROOM : 0)) - (c.up ? 0 : lift), center: 65, bassUnder: lowPart(c, i).bass.length > 0, ...(prog.widen ? { open: true } : {}) }).length);
    chords.forEach((c, i) => {
      const j = copyOf(c, i);
      if (j >= 0) {
        flush();
        start = plan[j] ? plan[j]!.map((m) => m + c.up!) : null;
        return;
      }
      const { cands, bass } = candidatesOf(c, i, high && !prog.widen, !run.length ? start : null);
      if (!cands.length) {
        flush();
        start = null;
        return;
      }
      run.push({ i, cands, bass });
    });
    flush();
  }
  const out: ChillsVoicing[] = [];
  let prev: number[] | null = null;
  chords.forEach((c, i) => {
    // The same chord before the key change, moved up: the music lifts as a whole
    const j = copyOf(c, i);
    if (j >= 0 && out[j]) {
      const was = out[j];
      // (a chord played plain for want of room stays plain, and named so, moved up)
      const moved: ChillsVoicing = { bass: was.bass.map((m) => m + c.up!), upper: was.upper.map((m) => m + c.up!), ...(was.plain ? { plain: true as const } : {}) };
      out.push(moved);
      prev = moved.upper;
      return;
    }
    const low = lowPart(c, i);
    const { pcs, level, floor } = low;
    let bass = low.bass;
    const planned = plan[i];
    if (planned) {
      prev = planned;
      out.push({ bass: bass.filter((m) => m >= lo && m <= hi - (c.up ? 0 : lift)), upper: planned });
      return;
    }
    // (rich chords that didn't fit are played, and named, plain)
    const fellBack = rich ? { plain: true as const } : {};
    let upper = voiceLead(pcs, prev, Math.max(center, floor + 4));
    while (minOf(upper) < floor) upper = upper.map((m) => m + 12);
    while (maxOf(upper) > hi - lift && minOf(upper) - 12 >= floor) upper = upper.map((m) => m - 12);
    while (upper.length > 1 && maxOf(upper) > hi - lift) upper = upper.slice(0, -1);
    prev = upper;
    if (level >= 2) {
      // Wider: the chord's next notes above its top
      const extra: number[] = [];
      let m = maxOf(upper) + 1;
      while (extra.length < level - 1 && m <= hi - lift) {
        if (pcs.includes(pc(m)) && m - maxOf([...upper, ...extra]) >= 3) extra.push(m);
        m++;
      }
      upper = [...upper, ...extra];
    }
    if (prog.widen && out.length) {
      // Wider than the one before, however the roots fall: more of the chord on top while there's room
      const before = out[out.length - 1];
      const span = (v: ChillsVoicing) => maxOf([...v.bass, ...v.upper]) - minOf([...v.bass, ...v.upper]);
      for (let m = maxOf(upper) + 3; m <= hi - lift && span({ bass, upper }) <= span(before); m++) if (pcs.includes(pc(m))) upper = [...upper, m];
    }
    // Never outside the instrument: notes it can't play go; a chord with none left is voiced in its range on its own
    const inRange = (m: number) => m >= lo && m <= hi - (c.up ? 0 : lift);
    bass = bass.filter(inRange);
    upper = upper.filter(inRange);
    if (!upper.length) {
      upper = voiceLead(pcs, null, Math.max(lo + 6, Math.min(hi - lift - 6, center)));
      while (maxOf(upper) > hi - lift && minOf(upper) - 12 >= lo) upper = upper.map((m) => m - 12);
      while (minOf(upper) < lo) upper = upper.map((m) => m + 12);
      upper = upper.filter(inRange);
      // (under a chord pushed this low, a low note would crowd it)
      if (bass.length && minOf(upper) - maxOf(bass) < 7) bass = [];
      prev = upper;
    }
    out.push({ bass, upper, ...fellBack });
  });
  return out;
}

/**
 * A bass instrument's part: each chord's root (the climbing bass's own note, nothing under a
 * pedal, which is held on its own), in its range: the lift moves up with the music.
 */
function rootsOnly(key: Pick<SongKey, 'root' | 'mode'>, prog: ChillsProgression, [lo, hi]: readonly [number, number]): ChillsVoicing[] {
  const chords = chillsChords(key, prog);
  const low = registerOf([lo, hi]).low;
  let home = low + pc(key.root - low);
  // (room for the climb's octave)
  if (prog.climb && home + 12 > hi && home - 12 >= lo) home -= 12;
  // (the pedal's home note, where the instrument reaches it: then it's all the part plays)
  let pedal = low + pc(key.root - low);
  while (pedal > hi && pedal - 12 >= lo) pedal -= 12;
  const held = !!prog.pedal && pedal >= lo && pedal <= hi;
  return chords.map((c) => {
    if (held) return { bass: [], upper: [] };
    let m = c.bass !== undefined ? home + c.bass : low + pc(key.root + c.semis - low);
    if (c.up && c.bass === undefined) m += c.up;
    while (m > hi && m - 12 >= lo) m -= 12;
    return { bass: m >= lo && m <= hi ? [m] : [], upper: [] };
  });
}

/**
 * A rich chord's velocities: the whole chord (its low note too) at the velocity times (plain
 * chord's notes / rich chord's notes) to this power, times RICH_TONE_VELOCITY; its added 9th, 11th
 * or 13th at RICH_ADDED_VELOCITY of that (measured on pads and keys: each chord within about 1 dB of the
 * plain one, scripts/ui-check/chills.cjs).
 */
export const RICH_COUNT_POWER = 0.7;
export const RICH_TONE_VELOCITY = 1;
export const RICH_ADDED_VELOCITY = 0.8;

export interface ChillsNoteOptions extends ChillsVoiceOptions {
  velocity?: number;
}

/**
 * The notes of a chills progression in `key`, chord i playing in spans[i] (bars from the clip's
 * start; more spans than chords play it again). Every note lasts its chord, a suspended chord's
 * 4th falling to its 3rd three quarters of the way through; a pedal's home note is held under
 * each time through. Velocities drop a little as a chord gets more notes, so a wider chord isn't
 * a louder one.
 */
export function chillsNotes(key: Pick<SongKey, 'root' | 'mode'>, prog: ChillsProgression, spans: ReadonlyArray<{ start: number; length: number }>, newId: () => string, opts: ChillsNoteOptions = {}): NoteEvent[] {
  const chords = chillsChords(key, prog);
  const voiced = chillsVoicings(key, prog, opts);
  const base = opts.velocity ?? 0.7;
  const out: NoteEvent[] = [];
  const add = (m: number, at: number, len: number, vel: number) =>
    out.push({ id: newId(), note: nameOf(m), startOffset: round(at), duration: barsToDuration(Math.max(1 / 64, len)), velocity: Math.round(Math.max(0.1, Math.min(1, vel)) * 100) / 100 });
  const rich = voicingOf(prog, opts.voicing) === 'rich';
  spans.forEach((span, k) => {
    const c = chords[k % chords.length];
    const v = voiced[k % chords.length];
    const count = v.bass.length + v.upper.length;
    const vel = prog.widen ? base * (3 / Math.max(3, count)) ** 0.4 : base;
    // Rich: the whole chord softer as it has more notes than the plain one (low note too: many
    // instruments play a chord at its loudest note's velocity), its added 9th, 11th or 13th softer
    // still, so it's no louder than the plain chord
    const richNow = rich && !v.plain;
    const shared = richNow ? RICH_TONE_VELOCITY * ((chillsPcs(key, c).length + v.bass.length) / Math.max(1, v.upper.length + v.bass.length)) ** RICH_COUNT_POWER : 1;
    for (const m of v.bass) add(m, span.start, span.length, vel * 0.9 * shared);
    const resolveAt = round(span.start + span.length * 0.75);
    const third = chillsPcs(key, c)[1];
    const root = chillsPcs(key, c)[0];
    const added = richNow ? new Set(RICH[richQuality(key, c)].ivs.filter((iv) => iv >= 12).map((iv) => pc(root + iv))) : null;
    for (const m of v.upper) {
      const sus = m + (5 - pc(third - root));
      const at = added ? vel * shared * (added.has(pc(m)) ? RICH_ADDED_VELOCITY : 1) : vel;
      // (a suspension the instrument can't reach is played as the chord)
      if (c.sus && pc(m) === third && span.length >= 1 / 8 && resolveAt > span.start + EPS && sus <= (opts.range ?? [0, 127])[1]) {
        add(sus, span.start, resolveAt - span.start, at);
        add(m, resolveAt, span.start + span.length - resolveAt, at);
      } else add(m, span.start, span.length, at);
    }
  });
  if (prog.pedal) {
    const reg = registerOf(opts.range);
    const [lo, hi] = opts.range ?? [0, 127];
    let home = reg.low + pc(key.root - reg.low);
    while (home > hi && home - 12 >= lo) home -= 12;
    // (held under the chords only with a 5th's room between: where the chords had to come down to fit, they play alone)
    const clear = voiced.every((v) => !v.upper.length || minOf(v.upper) - home >= 7);
    if (reg.kind !== 'chord' && home >= lo && home <= hi && clear) {
      for (let k = 0; k < spans.length; k += chords.length) {
        const pass = spans.slice(k, k + chords.length);
        const end = pass[pass.length - 1].start + pass[pass.length - 1].length;
        add(home, pass[0].start, end - pass[0].start, base * 0.85);
      }
    }
  }
  return out.sort((a, b) => a.startOffset - b.startOffset || a.note.localeCompare(b.note));
}

/** The progression filling [from, to) of the song (a clip or a section), as notes from `from`. */
export function chillsFill(key: Pick<SongKey, 'root' | 'mode'>, prog: ChillsProgression, from: number, to: number, map: MeterMap, newId: () => string, opts: ChillsNoteOptions = {}): NoteEvent[] {
  const spans = chillsSpans(from, to, chillsChords(key, prog).length, map, playsOnce(prog));
  return chillsNotes(key, prog, spans, newId, opts);
}

/**
 * A chord (pitch classes, root first) spread wide for a pad: its root low with the 5th over it,
 * the chord in the middle (moving as little as it can from `prev`, the last one's middle notes)
 * and one more of its notes on top. The same rules as the progressions: no low clusters.
 */
export function wideChord(pcs: readonly number[], prev: readonly number[] | null, range: readonly [number, number] = [0, 127]): ChillsVoicing {
  const [lo, hi] = range;
  const bassLo = Math.max(lo, BASS_FLOOR);
  const bass: number[] = [];
  if (bassLo <= LOW_REGISTER && hi - bassLo >= 24 && pcs.length) {
    const b = bassLo + pc(pcs[0] - bassLo);
    bass.push(b);
    if (pcs.includes(pc(b + 7))) bass.push(b + 7);
  }
  const floor = Math.max(lo, LOW_REGISTER, bass.length ? bass[0] + 7 : -Infinity, bass.length > 1 ? bass[1] + 5 : -Infinity);
  let upper = voiceLead(pcs, prev, Math.max(Math.min(64, hi - 8), floor + 4));
  while (minOf(upper) < floor) upper = upper.map((m) => m + 12);
  while (maxOf(upper) > hi && minOf(upper) - 12 >= floor) upper = upper.map((m) => m - 12);
  while (upper.length > 1 && maxOf(upper) > hi) upper = upper.slice(0, -1);
  for (let m = maxOf(upper) + 3; m <= hi; m++) {
    if (pcs.includes(pc(m))) {
      upper = [...upper, m];
      break;
    }
  }
  return { bass, upper };
}

/**
 * Whether a clip's name is one the app gave it, so a chills progression written over the clip may
 * name it after the progression (as the Chills progression dialog names the clip it makes). The
 * app keeps no mark of a name the person typed, so only names it surely made count: none at all,
 * the name a new empty clip gets on its track ("Pad 2"), a chills progression's name, or a name
 * made from a file's. Anything else (a name typed, or another tool's) is kept as it is.
 */
export function autoClipName(clip: Pick<Clip, 'name' | 'nameFromFile'>, trackName: string | undefined): boolean {
  const name = clip.name.trim();
  if (!name || clip.nameFromFile || CHILLS.some((p) => p.name === name)) return true;
  return trackName !== undefined && name.startsWith(`${trackName} `) && /^\d+$/.test(name.slice(trackName.length + 1));
}

/**
 * The clips with `clipId` named `name` (a chills progression written over it) where its name is
 * one the app gave it (autoClipName), and each clip linked to it likewise, as they all play it now.
 * The same array when no name changes.
 */
export function namedForChills(clips: readonly Clip[], tracks: ReadonlyArray<Pick<Track, 'id' | 'name'>>, clipId: string, name: string): readonly Clip[] {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return clips;
  let changed = false;
  const out = clips.map((c) => {
    if (c !== clip && !(clip.pattern && c.pattern === clip.pattern)) return c;
    if (c.name === name || !autoClipName(c, tracks.find((t) => t.id === c.trackId)?.name)) return c;
    changed = true;
    // (no longer the file's name: the mark goes with it)
    const { nameFromFile: _file, ...rest } = c;
    return { ...rest, name };
  });
  return changed ? out : clips;
}
