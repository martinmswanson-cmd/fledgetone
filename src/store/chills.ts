import type { Clip, NoteEvent, Track } from './timelineTypes';
import { barsToDuration } from './timelineTypes';
import { nameOf } from './noteTools';
import type { SongKey } from './songKey';
import { NOTE_NAMES } from './songKey';
import { chordName, CHORD_QUALITIES, voiceLead, type ChordQuality } from './smartTools';
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
}

export type ChillsId = 'mediant' | 'borrowedIv' | 'deceptive' | 'suspended' | 'pedal' | 'liftStep' | 'liftHalf' | 'risingBass' | 'widening';

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
}

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

/** The chords' names in the key: "C – F/C – Am/C", a suspended one "Gsus4 G". */
export function chillsNames(key: Pick<SongKey, 'root' | 'mode'>, prog: ChillsProgression): string[] {
  return chillsChords(key, prog).map((c) => {
    const pcs = chillsPcs(key, c);
    const name = chordName(pcs);
    const b = prog.pedal ? pc(key.root) : bassPc(key, c);
    const slash = b !== pcs[0] ? `${name}/${NOTE_NAMES[b]}` : name;
    return c.sus ? `${chordName([pcs[0], pc(pcs[0] + 5), pc(pcs[0] + 7)])} ${slash}` : slash;
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
}

export interface ChillsVoiceOptions {
  /** The lowest and highest notes the instrument plays */
  range?: readonly [number, number];
}

/** The voicings of a progression's chords (one per chord, in order). */
export function chillsVoicings(key: Pick<SongKey, 'root' | 'mode'>, prog: ChillsProgression, opts: ChillsVoiceOptions = {}): ChillsVoicing[] {
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
  const out: ChillsVoicing[] = [];
  let prev: number[] | null = null;
  chords.forEach((c, i) => {
    // The same chord before the key change, moved up: the music lifts as a whole
    const j = c.up ? chords.findIndex((d, k) => k < i && !d.up && d.semis === c.semis && d.quality === c.quality && !!d.sus === !!c.sus && d.bass === c.bass) : -1;
    if (j >= 0 && out[j]) {
      const was = out[j];
      const moved = { bass: was.bass.map((m) => m + c.up!), upper: was.upper.map((m) => m + c.up!) };
      out.push(moved);
      prev = moved.upper;
      return;
    }
    const pcs = chillsPcs(key, c);
    const level = prog.widen ? Math.round((3 * i) / Math.max(1, chords.length - 1)) : 1;
    // The bass: the home note (pedal: held separately), the chord's own bass note, or its root
    let bass: number[] = [];
    if (hasBass && !prog.pedal && level >= 1) {
      const b = c.bass !== undefined ? home + c.bass : bassLo + pc(bassPc(key, c) - bassLo);
      bass = [b];
      // Wide open: the 5th over the bass too
      if (level >= 3 && pcs.includes(pc(b + 7))) bass.push(b + 7);
    }
    const lowest = prog.pedal && hasBass ? home : (bass[0] ?? -Infinity);
    // The chord above: at least a 5th over everything under it (a 4th over a doubled 5th), and out of the low register
    const floor = Math.max(lo, LOW_REGISTER, lowest + 7, bass.length > 1 ? bass[1] + (bass[1] < LOW_REGISTER ? 7 : 5) : -Infinity);
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
    out.push({ bass, upper });
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
  spans.forEach((span, k) => {
    const c = chords[k % chords.length];
    const v = voiced[k % chords.length];
    const count = v.bass.length + v.upper.length;
    const vel = prog.widen ? base * (3 / Math.max(3, count)) ** 0.4 : base;
    for (const m of v.bass) add(m, span.start, span.length, vel * 0.9);
    const resolveAt = round(span.start + span.length * 0.75);
    const third = chillsPcs(key, c)[1];
    for (const m of v.upper) {
      const sus = m + (5 - pc(third - chillsPcs(key, c)[0]));
      // (a suspension the instrument can't reach is played as the chord)
      if (c.sus && pc(m) === third && span.length >= 1 / 8 && resolveAt > span.start + EPS && sus <= (opts.range ?? [0, 127])[1]) {
        add(sus, span.start, resolveAt - span.start, vel);
        add(m, resolveAt, span.start + span.length - resolveAt, vel);
      } else add(m, span.start, span.length, vel);
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
  const spans = chillsSpans(from, to, chillsChords(key, prog).length, map, !!prog.lift);
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
