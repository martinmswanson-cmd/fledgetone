import type { NoteEvent } from './timelineTypes';
import { barsToDuration, durationToBars } from './timelineTypes';
import { maxOf, minOf } from '../support/minMax';

/**
 * The piano roll's composing helpers, on plain note lists: scales (which rows are in key, and
 * pulling notes into it), chord stamps, and edits over a selection: quantize, humanize, strum,
 * arpeggiate, legato, transpose. Positions are in bars from the clip start, as in NoteEvent.
 */

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };

/** MIDI number of a note name ("C4" = 60, "F#3", "Bb2"); NaN for anything else. */
export function midiOf(note: string): number {
  const m = /^([A-G](?:#|b)?)(-?\d+)$/.exec(note);
  if (!m) return NaN;
  const pitch = FLAT_TO_SHARP[m[1]] ?? m[1];
  const i = NAMES.indexOf(pitch);
  return i < 0 ? NaN : (Number(m[2]) + 1) * 12 + i;
}

export const nameOf = (midi: number): string => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

export const ROOT_NAMES = NAMES;

export const SCALES = {
  major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: { name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { name: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  majorPentatonic: { name: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  minorPentatonic: { name: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  blues: { name: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
  japanese: { name: 'Japanese (in)', steps: [0, 1, 5, 7, 8] },
  hirajoshi: { name: 'Hirajoshi (Japanese, plaintive)', steps: [0, 2, 3, 7, 8] },
  yo: { name: 'Yo (Japanese folk, bright)', steps: [0, 2, 5, 7, 9] },
  phrygianDominant: { name: 'Phrygian dominant (desert)', steps: [0, 1, 4, 5, 7, 8, 10] },
  doubleHarmonic: { name: 'Double harmonic (desert, exotic)', steps: [0, 1, 4, 5, 7, 8, 11] },
  hungarianMinor: { name: 'Hungarian minor (gothic)', steps: [0, 2, 3, 6, 7, 8, 11] },
  harmonicMajor: { name: 'Harmonic major (noble, mysterious)', steps: [0, 2, 4, 5, 7, 8, 11] },
  melodicMinor: { name: 'Melodic minor (jazz, cool)', steps: [0, 2, 3, 5, 7, 9, 11] },
  lydianDominant: { name: 'Lydian dominant (mischief)', steps: [0, 2, 4, 6, 7, 9, 10] },
  locrian: { name: 'Locrian (darkest, unstable)', steps: [0, 1, 3, 5, 6, 8, 10] },
  wholeTone: { name: 'Whole tone (dream, magic)', steps: [0, 2, 4, 6, 8, 10] },
  octatonicHW: { name: 'Diminished half-whole (menace)', steps: [0, 1, 3, 4, 6, 7, 9, 10] },
  octatonicWH: { name: 'Diminished whole-half (horror)', steps: [0, 2, 3, 5, 6, 8, 9, 11] },
  chromatic: { name: 'Chromatic (every note)', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
} as const;
export type ScaleId = keyof typeof SCALES;

export interface Scale {
  /** 0 = C ... 11 = B */
  root: number;
  id: ScaleId;
}

export const inScale = (midi: number, scale: Scale): boolean =>
  (SCALES[scale.id].steps as readonly number[]).includes((((midi - scale.root) % 12) + 12) % 12);

/** The nearest note in the scale (the higher one on a tie). */
export function snapToScale(midi: number, scale: Scale): number {
  for (let d = 0; d <= 6; d++) {
    if (inScale(midi + d, scale)) return midi + d;
    if (inScale(midi - d, scale)) return midi - d;
  }
  return midi;
}

export const CHORDS = {
  off: { name: 'Single notes', intervals: [0] },
  diatonic: { name: 'Triad in key', intervals: [] },
  diatonic7: { name: '7th chord in key', intervals: [] },
  major: { name: 'Major', intervals: [0, 4, 7] },
  minor: { name: 'Minor', intervals: [0, 3, 7] },
  sus2: { name: 'Sus2', intervals: [0, 2, 7] },
  sus4: { name: 'Sus4', intervals: [0, 5, 7] },
  dom7: { name: '7', intervals: [0, 4, 7, 10] },
  maj7: { name: 'Maj7', intervals: [0, 4, 7, 11] },
  min7: { name: 'Min7', intervals: [0, 3, 7, 10] },
  add9: { name: 'Add9', intervals: [0, 4, 7, 14] },
  min6: { name: 'Min6', intervals: [0, 3, 7, 9] },
  minMaj7: { name: 'Min(maj7)', intervals: [0, 3, 7, 11] },
  sixNine: { name: '6/9', intervals: [0, 4, 7, 9, 14] },
  dim: { name: 'Diminished', intervals: [0, 3, 6] },
  dim7: { name: 'Dim7', intervals: [0, 3, 6, 9] },
  aug: { name: 'Augmented', intervals: [0, 4, 8] },
  cluster: { name: 'Cluster (3 semitones)', intervals: [0, 1, 2] },
  power: { name: 'Power (5th)', intervals: [0, 7, 12] },
  octave: { name: 'Octave', intervals: [0, 12] },
} as const;
export type ChordId = keyof typeof CHORDS;

/**
 * The notes of a chord built up from `root`. "In key" chords stack every other scale note (a
 * triad or a 7th chord) from the root's place in the scale, so each is the right major, minor or
 * diminished chord for that degree; without a scale they're major.
 */
export function chordNotes(root: number, chord: ChordId, scale: Scale | null): number[] {
  if (chord === 'diatonic' || chord === 'diatonic7') {
    const size = chord === 'diatonic' ? 3 : 4;
    if (!scale) return chordNotes(root, chord === 'diatonic' ? 'major' : 'dom7', null);
    const base = snapToScale(root, scale);
    const out = [base];
    let m = base;
    while (out.length < size) {
      // Up two scale notes
      let hops = 0;
      while (hops < 2) {
        m++;
        if (inScale(m, scale)) hops++;
      }
      out.push(m);
    }
    return out;
  }
  return CHORDS[chord].intervals.map((i) => root + i);
}

// ---------- edits over a selection ----------

const EPS = 1e-6;
const lengthOf = (n: NoteEvent) => durationToBars(n.duration);

/** Notes starting together (within a hair), in time order. */
function groupsByStart(notes: NoteEvent[]): NoteEvent[][] {
  const sorted = [...notes].sort((a, b) => a.startOffset - b.startOffset);
  const groups: NoteEvent[][] = [];
  for (const n of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last[0].startOffset - n.startOffset) < 1 / 192) last.push(n);
    else groups.push([n]);
  }
  return groups;
}

const clampStart = (bars: number, clipBars: number) => Math.max(0, Math.min(clipBars - EPS, bars));

/** Move starts (and, with `ends`, lengths) to the grid; `strength` 1 = all the way. */
export function quantize(notes: NoteEvent[], gridBars: number, clipStartBars: number, strength = 1, ends = false): NoteEvent[] {
  // The grid is the song's, so measure from bar 1 (the clip may start mid-bar)
  const snap = (x: number) => Math.round((x + clipStartBars) / gridBars) * gridBars - clipStartBars;
  return notes.map((n) => {
    const start = n.startOffset + (snap(n.startOffset) - n.startOffset) * strength;
    const len = ends ? Math.max(gridBars, Math.round(lengthOf(n) / gridBars) * gridBars) : lengthOf(n);
    return { ...n, startOffset: Math.max(0, start), duration: ends ? barsToDuration(len) : n.duration };
  });
}

/** Small random changes in timing (up to `timingBars` either way) and velocity (up to `velocity`). */
export function humanize(notes: NoteEvent[], clipBars: number, timingBars = 1 / 192, velocity = 0.08, random = Math.random): NoteEvent[] {
  return notes.map((n) => ({
    ...n,
    startOffset: clampStart(n.startOffset + (random() * 2 - 1) * timingBars, clipBars),
    velocity: Math.max(0.05, Math.min(1, n.velocity + (random() * 2 - 1) * velocity)),
  }));
}

/** Spread each chord's notes out like a strum: `stepBars` apart, low to high (or high to low). */
export function strum(notes: NoteEvent[], clipBars: number, stepBars = 1 / 96, down = true): NoteEvent[] {
  return groupsByStart(notes).flatMap((group) => {
    const order = [...group].sort((a, b) => (down ? midiOf(a.note) - midiOf(b.note) : midiOf(b.note) - midiOf(a.note)));
    return order.map((n, i) => {
      const startOffset = clampStart(n.startOffset + i * stepBars, clipBars);
      // Each note still ends where the chord did
      const len = Math.max(stepBars, lengthOf(n) - (startOffset - n.startOffset));
      return { ...n, startOffset, duration: barsToDuration(len) };
    });
  });
}

export type ArpPattern = 'up' | 'down' | 'upDown' | 'random';

/** Turn each chord into a broken chord: its notes one at a time, every `rateBars`, for as long as the chord lasted. */
export function arpeggiate(notes: NoteEvent[], rateBars: number, pattern: ArpPattern, newId: () => string, random = Math.random): NoteEvent[] {
  return groupsByStart(notes).flatMap((group) => {
    if (group.length < 2) return group;
    const pitches = [...group].sort((a, b) => midiOf(a.note) - midiOf(b.note));
    const cycle =
      pattern === 'down' ? [...pitches].reverse() : pattern === 'upDown' ? [...pitches, ...pitches.slice(1, -1).reverse()] : pitches;
    const span = maxOf(group.map(lengthOf));
    const count = Math.max(1, Math.round(span / rateBars));
    const start = group[0].startOffset;
    return Array.from({ length: count }, (_, i) => {
      const src = pattern === 'random' ? pitches[Math.floor(random() * pitches.length)] : cycle[i % cycle.length];
      return { ...src, id: newId(), startOffset: start + i * rateBars, duration: barsToDuration(rateBars) };
    });
  });
}

/** A note length's smallest step, in bars (a tick: what a duration is written in). */
const TICK = 1 / 768;

/** How far (bars) the Legato tool runs each note into the next one: enough to overlap, so a mono synth glides. */
const LEGATO_OVERLAP = 1 / 64;

/**
 * Each note lasts until the next note (of any pitch) starts, and a little into it, so a mono synth
 * glides to it (or ties the same pitch) instead of striking it again; the last ones until the clip
 * ends. Lengths are whole ticks, rounded up.
 */
export function legato(notes: NoteEvent[], clipBars: number): NoteEvent[] {
  const starts = [...new Set(notes.map((n) => n.startOffset))].sort((a, b) => a - b);
  return notes.map((n) => {
    const next = starts.find((s) => s > n.startOffset + EPS);
    const end = next === undefined ? clipBars : Math.min(clipBars, next + LEGATO_OVERLAP);
    const ticks = Math.ceil((end - n.startOffset) / TICK - 1e-6);
    return { ...n, duration: barsToDuration(Math.max(1 / 96, ticks * TICK)) };
  });
}

/** Up or down by `semitones`, kept inside [lo, hi]: a note that would leave it stays where it is. */
export function transpose(notes: NoteEvent[], semitones: number, lo: number, hi: number): NoteEvent[] {
  return notes.map((n) => {
    const m = midiOf(n.note) + semitones;
    return Number.isFinite(m) && m >= lo && m <= hi ? { ...n, note: nameOf(m) } : n;
  });
}

/** Pull every note to the nearest note of the scale. */
export function fitToScale(notes: NoteEvent[], scale: Scale): NoteEvent[] {
  return notes.map((n) => {
    const m = midiOf(n.note);
    return Number.isFinite(m) ? { ...n, note: nameOf(snapToScale(m, scale)) } : n;
  });
}

/**
 * Split each note into `count` equal repeats across its length (a ratchet), getting louder towards
 * the last, which keeps the note's own velocity.
 */
export function ratchet(notes: NoteEvent[], count: number, newId: () => string, from = 0.55): NoteEvent[] {
  return notes.flatMap((n) => {
    const len = lengthOf(n) / count;
    return Array.from({ length: count }, (_, i) => ({
      ...n,
      id: i === 0 ? n.id : newId(),
      startOffset: n.startOffset + i * len,
      duration: barsToDuration(len),
      velocity: Math.max(0.05, n.velocity * (count === 1 ? 1 : from + ((1 - from) * i) / (count - 1))),
    }));
  });
}

/** The roll painter's rates: how far apart the hits are, in bars (1/16T: three in the time of two 16ths). */
export const ROLL_RATES = [
  { id: '1/16', label: '1/16', bars: 1 / 16 },
  { id: '1/16T', label: '1/16 triplet', bars: 1 / 24 },
  { id: '1/32', label: '1/32', bars: 1 / 32 },
  { id: '1/32T', label: '1/32 triplet', bars: 1 / 48 },
  { id: '1/64', label: '1/64', bars: 1 / 64 },
] as const;
export type RollRateId = (typeof ROLL_RATES)[number]['id'];

/** How a roll's velocity moves from its first hit to its last. */
export type RollVelocity = 'flat' | 'up' | 'down' | 'swell';

/** A roll's shape (see roll). */
export interface RollShape {
  /** Velocity across the roll: flat, rising (into a drop), falling, or up and back down */
  velocity: RollVelocity;
  /** Where the ramp starts (or, falling, ends), as a share of the note's velocity */
  from: number;
  /** A stutter: exactly this many hits across each note, whatever its length, instead of hits at the rate */
  count?: number;
  /** Pitch across the roll, semitones from the first hit to the last (rising drill hats: +5, +7, +12) */
  pitch: number;
  /**
   * How the pitch is written: `bend`, each hit's own starting bend (drum rows, whose note only says
   * which drum: the kits play it as the hit's pitch), or `notes`, each hit moved to the nearest
   * semitone (inside [lo, hi])
   */
  pitchBy: 'bend' | 'notes';
  lo?: number;
  hi?: number;
}

const ROLL_DEFAULT: RollShape = { velocity: 'up', from: 0.35, pitch: 0, pitchBy: 'bend' };

/** A roll's velocity at `x` (0 at its first hit, 1 at its last) as a share of the note's. */
export function rollLevel(shape: RollVelocity, from: number, x: number): number {
  switch (shape) {
    case 'flat':
      return 1;
    case 'up':
      return from + (1 - from) * x;
    case 'down':
      return 1 - (1 - from) * x;
    case 'swell':
      return from + (1 - from) * Math.sin(Math.PI * x);
  }
}

/**
 * A roll: each note repeated every `rateBars` for as long as it lasts (or, with a `count`, that
 * many times across it), its velocity following `velocity` and its pitch moving `pitch`
 * semitones over the roll (snare rolls into a drop, trap and drill hat rolls). The hits sit on
 * exact multiples of the rate from the note's start, so a roll drawn on the grid stays on it; a
 * note that isn't a whole number of hits long ends on a shorter one. With no shape, it rises from
 * a third of the note's velocity to its own at an even pitch, as the TOOLS menu's Roll always has.
 */
export function roll(notes: NoteEvent[], rateBars: number, newId: () => string, shape: Partial<RollShape> = {}): NoteEvent[] {
  const s = { ...ROLL_DEFAULT, ...shape };
  return notes.flatMap((n) => {
    const len = lengthOf(n);
    const count = s.count ? Math.max(1, Math.round(s.count)) : Math.max(1, Math.ceil(len / rateBars - 1e-9));
    const step = s.count ? len / count : rateBars;
    const midi = s.pitchBy === 'notes' ? midiOf(n.note) : NaN;
    return Array.from({ length: count }, (_, i) => {
      const x = count === 1 ? 1 : i / (count - 1);
      const start = n.startOffset + i * step;
      const rest = n.startOffset + len - start;
      const hit: NoteEvent = {
        ...n,
        id: i === 0 ? n.id : newId(),
        startOffset: start,
        duration: barsToDuration(Math.max(1 / 768, Math.min(step, rest))),
        velocity: Math.max(0.05, Math.min(1, n.velocity * rollLevel(s.velocity, s.from, x))),
      };
      const semis = s.pitch * x;
      if (!semis) return hit;
      if (s.pitchBy === 'bend') return { ...hit, expr: { ...hit.expr, bend: [{ at: 0, value: Math.round(semis * 100) / 100 }] } };
      const m = Math.round(midi + semis);
      return Number.isFinite(m) && m >= (s.lo ?? 0) && m <= (s.hi ?? 127) ? { ...hit, note: nameOf(m) } : hit;
    });
  });
}

/** An accelerating roll's rates, slowest first: 8ths, 16ths, 32nds, 64ths (bars between hits). */
export const ACCEL_RATES = [1 / 8, 1 / 16, 1 / 32, 1 / 64] as const;

/**
 * An accelerating roll: each note becomes hits that get closer together over its length, 8ths,
 * then 16ths, 32nds and 64ths (the snare build into a drop), each rate a quarter of the note (the
 * slow rates left out of a note too short to give each a hit), the edges on the grid. The
 * velocity follows `shape.velocity` by time (rising from `from` by default) and the pitch moves as
 * in roll().
 */
export function accelRoll(notes: NoteEvent[], newId: () => string, shape: Partial<RollShape> = {}): NoteEvent[] {
  const s = { ...ROLL_DEFAULT, ...shape };
  const EPS = 1e-9;
  return notes.flatMap((n) => {
    const len = lengthOf(n);
    let rates: readonly number[] = ACCEL_RATES;
    while (rates.length > 1 && len / rates.length < rates[0] - EPS) rates = rates.slice(1);
    // Each rate's span, its end on its own grid (so the next rate starts on a hit of this one)
    const starts: number[] = [];
    let at = 0;
    rates.forEach((rate, k) => {
      const end = k === rates.length - 1 ? len : Math.max(at + rate, Math.round(((len * (k + 1)) / rates.length - at) / rate) * rate + at);
      for (let t = at; t < Math.min(end, len) - EPS; t += rate) starts.push(t);
      at = Math.min(end, len);
    });
    const midi = s.pitchBy === 'notes' ? midiOf(n.note) : NaN;
    return starts.map((t, i) => {
      // (By time: 0 at the first hit, 1 at the last)
      const last = starts[starts.length - 1];
      const x = last > 0 ? t / last : 1;
      const next = i + 1 < starts.length ? starts[i + 1] : len;
      const hit: NoteEvent = {
        ...n,
        id: i === 0 ? n.id : newId(),
        startOffset: n.startOffset + t,
        duration: barsToDuration(Math.max(1 / 768, next - t)),
        velocity: Math.max(0.05, Math.min(1, n.velocity * rollLevel(s.velocity, s.from, x))),
      };
      const semis = s.pitch * x;
      if (!semis) return hit;
      if (s.pitchBy === 'bend') return { ...hit, expr: { ...hit.expr, bend: [{ at: 0, value: Math.round(semis * 100) / 100 }] } };
      const m = Math.round(midi + semis);
      return Number.isFinite(m) && m >= (s.lo ?? 0) && m <= (s.hi ?? 127) ? { ...hit, note: nameOf(m) } : hit;
    });
  });
}

/** Notes mirrored in time within `bars` (retrograde): the last note first, each keeping its length. */
export function retrograde(notes: readonly NoteEvent[], bars: number): NoteEvent[] {
  if (!notes.length) return [];
  const spans = notes.map((n) => ({ n, end: n.startOffset + durationToBars(n.duration) }));
  const first = minOf(notes.map((n) => n.startOffset));
  const last = Math.min(bars, maxOf(spans.map((x) => x.end)));
  return spans.map(({ n, end }) => ({ ...n, startOffset: Math.max(0, first + last - end) }));
}
