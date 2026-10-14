import { barsToDuration, durationToBars } from './timelineTypes';
import type { ExprPoint, NoteEvent } from './timelineTypes';
import { nameOf } from './noteTools';

/**
 * Math patterns: music a formula writes. Generators make a clip's notes from a key (the right-click
 * menu's Math patterns…), and tools reshape notes already there (the piano roll's TOOLS). Pure, so
 * they're unit tested (scripts/mathPatterns.test.mjs).
 *
 * - Pendulum wave: six pendulums at 6 to 11 swings per 16 beats, each playing its note as it
 *   crosses the middle; they drift apart and line up again every 16 beats.
 * - Fibonacci groove: F(n) mod 4 picks the chord tone; it repeats every 6 notes against 8 in a
 *   bar, so the groove lands differently each bar.
 * - Fifths walk: degree 4n mod 7 of the scale; four scale steps is a fifth, so it walks the
 *   circle of fifths through the key.
 * - Pascal's harp: row n of Pascal's triangle mod 2 (the Sierpinski triangle) is a chord on step n.
 * - Endless riser: copies an octave apart each climbing, faded in at the bottom and out at the
 *   top, so it rises forever and never gets higher (a Shepard tone).
 * - Stutter build, spring bounce, tritone slide and scoop: the tools.
 */

export interface PatternKey {
  /** 0 = C */
  root: number;
  /** The scale's semitones from the root (7 of them) */
  steps: readonly number[];
}

export type MathPatternId = 'pendulum' | 'fibonacci' | 'fifths' | 'pascal' | 'riser';

export const MATH_PATTERNS: ReadonlyArray<{ id: MathPatternId; name: string; detail: string }> = [
  { id: 'pendulum', name: 'Pendulum wave', detail: 'Six notes swinging at slightly different speeds drift apart, then line up again every 4 bars.' },
  { id: 'fibonacci', name: 'Fibonacci groove', detail: 'The Fibonacci numbers pick chord tones; the pattern repeats every 6 notes against 8, so each bar lands differently.' },
  { id: 'fifths', name: 'Fifths walk', detail: 'Every fourth scale note: a line that walks the circle of fifths through the key.' },
  { id: 'pascal', name: "Pascal's harp", detail: "Pascal's triangle, odd numbers only (a Sierpinski fractal), played as a harp: one row per step." },
  { id: 'riser', name: 'Endless riser', detail: 'Climbs forever but never gets higher (a Shepard tone): for builds and tension.' },
];

/** The MIDI note of scale degree `degree` (any whole number; 7 is the next octave's root) from `base` (the root's MIDI note). */
export function degreeMidi(key: PatternKey, base: number, degree: number): number {
  const octave = Math.floor(degree / 7);
  return base + octave * 12 + key.steps[((degree % 7) + 7) % 7];
}

const note = (id: string, midi: number, at: number, bars: number, velocity: number, expr?: NoteEvent['expr']): NoteEvent => ({
  id,
  note: nameOf(midi),
  startOffset: Math.round(at * 768) / 768,
  duration: barsToDuration(bars),
  velocity: Math.round(Math.max(0.05, Math.min(1, velocity)) * 100) / 100,
  ...(expr ? { expr } : {}),
});

/** The root an octave from middle C (C4..B4), `octave` octaves away. */
const rootMidi = (key: PatternKey, octave: number) => 60 + key.root + octave * 12;

/**
 * Six pendulums over `bars` (whole cycles of 4 bars): pendulum k swings 6 + k times per 16 beats,
 * cos(2π N t / 16), and plays its note each time it crosses the middle. Low notes for the slow ones.
 */
export function pendulumWave(key: PatternKey, bars: number, newId: () => string): NoteEvent[] {
  const out: NoteEvent[] = [];
  const degrees = [0, 2, 4, 7, 9, 11];
  const base = rootMidi(key, 0);
  for (let cycle = 0; cycle * 4 < bars - 1e-9; cycle++) {
    degrees.forEach((degree, k) => {
      const swings = 6 + k;
      // cos crosses zero at N t / 16 = 1/4 + j/2 (t in beats)
      for (let j = 0; j < swings * 2; j++) {
        const beat = (16 / swings) * (0.25 + j / 2);
        const at = cycle * 4 + beat / 4;
        if (at >= bars - 1e-9) break;
        out.push(note(newId(), degreeMidi(key, base, degree), at, 1 / 16, 0.62 + 0.04 * (k % 2)));
      }
    });
  }
  return out.sort((a, b) => a.startOffset - b.startOffset);
}

/** F(n) mod 4: 0, 1, 1, 2, 3, 1, then again (the Pisano period of 4 is 6). */
export function fibonacciMod4(count: number): number[] {
  const out: number[] = [];
  let a = 0;
  let b = 1;
  for (let i = 0; i < count; i++) {
    out.push(a);
    [a, b] = [b, (a + b) % 4];
  }
  return out;
}

/** 8ths for `bars`: F(n) mod 4 picks the tonic seventh chord's tone (root, third, fifth, seventh); every 6th note accented. */
export function fibonacciGroove(key: PatternKey, bars: number, newId: () => string): NoteEvent[] {
  const tones = [0, 2, 4, 6];
  const base = rootMidi(key, -1);
  return fibonacciMod4(Math.round(bars * 8)).map((r, i) => note(newId(), degreeMidi(key, base, tones[r] + (r === 0 && i % 12 >= 6 ? 7 : 0)), i / 8, 1 / 8, i % 6 === 0 ? 0.85 : 0.62));
}

/** Quarter notes for `bars`: scale degree 4n mod 7 (a fifth each step), the n-th note's octave following the walk. */
export function fifthsWalk(key: PatternKey, bars: number, newId: () => string): NoteEvent[] {
  const base = rootMidi(key, -1);
  return Array.from({ length: Math.round(bars * 4) }, (_, n) => {
    const degree = (4 * n) % 7;
    return note(newId(), degreeMidi(key, base, degree), n / 4, 1 / 4, n % 4 === 0 ? 0.8 : 0.66);
  });
}

/** Row `n` of Pascal's triangle mod 2: which k (0..n) are odd. C(n, k) is odd exactly when k's bits are inside n's. */
export const pascalRow = (n: number): number[] => Array.from({ length: n + 1 }, (_, k) => k).filter((k) => (k & n) === k);

/**
 * Pascal's harp: 16 rows to a cycle, one an 8th apart; row n's odd entries k play scale degree k
 * from the root an octave below middle C, strummed upward like a harp. Bigger chords play softer.
 */
export function pascalHarp(key: PatternKey, bars: number, newId: () => string): NoteEvent[] {
  const out: NoteEvent[] = [];
  const base = rootMidi(key, -1);
  for (let step = 0; step < Math.round(bars * 8); step++) {
    const ks = pascalRow(step % 16);
    const velocity = 0.8 / Math.sqrt(ks.length);
    ks.forEach((k, i) => out.push(note(newId(), degreeMidi(key, base, k), step / 8 + i / 384, 1 / 8, 0.35 + velocity * 0.5)));
  }
  return out;
}

/** The endless riser's copies, an octave apart, covering this many octaves */
const RISER_OCTAVES = 4;

/**
 * An endless riser over `bars`: four copies an octave apart each climb a semitone a beat (gliding
 * up within each note), wrapping back to the bottom; each one's loudness is a bell over the four
 * octaves, so it fades in at the bottom and out at the top and the ear only hears it rise.
 */
export function endlessRiser(key: PatternKey, bars: number, newId: () => string): NoteEvent[] {
  const out: NoteEvent[] = [];
  const span = RISER_OCTAVES * 12;
  const bottom = 36 + key.root;
  const glide: ExprPoint[] = [
    { at: 0, value: 0 },
    { at: 1 / 4, value: 1 },
  ];
  for (let beat = 0; beat < Math.round(bars * 4); beat++) {
    for (let copy = 0; copy < RISER_OCTAVES; copy++) {
      const pos = (beat + copy * 12) % span;
      // A bell over the span: silent-ish at both ends, full in the middle
      const bell = Math.exp(-(((pos + 0.5 - span / 2) / (span / 4)) ** 2));
      if (bell < 0.06) continue;
      out.push(note(newId(), bottom + pos, beat / 4, 1 / 4, 0.1 + 0.75 * bell, { bend: glide }));
    }
  }
  return out;
}

/** Make a pattern's notes. */
export function mathPattern(id: MathPatternId, key: PatternKey, bars: number, newId: () => string): NoteEvent[] {
  switch (id) {
    case 'pendulum': return pendulumWave(key, bars, newId);
    case 'fibonacci': return fibonacciGroove(key, bars, newId);
    case 'fifths': return fifthsWalk(key, bars, newId);
    case 'pascal': return pascalHarp(key, bars, newId);
    case 'riser': return endlessRiser(key, bars, newId);
  }
}

// ---------- Tools ----------

/**
 * The stutter build: in each bar, the notes in its last beat retrigger, twice as many times each
 * bar of four (2, 4, 8, then 16 times), every hit dying away quickly, so a loop tightens into the
 * next phrase.
 */
export function stutterBuild(notes: readonly NoteEvent[], newId: () => string): NoteEvent[] {
  const lastBeat = (n: NoteEvent) => n.startOffset - Math.floor(n.startOffset + 1e-9) >= 0.75 - 1e-9;
  return notes.flatMap((n) => {
    if (!lastBeat(n)) return [n];
    const bar = Math.floor(n.startOffset + 1e-9);
    const count = 2 ** ((bar % 4) + 1);
    const len = 0.25 / count;
    // Each hit fills the beat on its own row, up to that row's next hit in it (or the bar's end)
    const next = notes
      .filter((m) => m !== n && m.note === n.note && m.startOffset > n.startOffset + 1e-9 && m.startOffset < bar + 1 - 1e-9)
      .reduce((min, m) => Math.min(min, m.startOffset), bar + 1);
    const first = Math.round((n.startOffset - bar - 0.75) / len);
    const last = Math.max(first + 1, Math.min(count, Math.round((next - bar - 0.75) / len)));
    return Array.from({ length: last - first }, (_, i) => ({
      ...n,
      id: i === 0 ? n.id : newId(),
      startOffset: Math.round((bar + 0.75 + (first + i) * len) * 768) / 768,
      duration: barsToDuration(len),
      velocity: Math.round(Math.max(0.1, n.velocity * (0.55 + (0.45 * (i + 1)) / (last - first))) * 100) / 100,
    }));
  });
}

/** Points along a note of `length` bars, `curve(seconds)` in semitones, every 1/64 bar (at most 48). */
function bendCurve(length: number, secondsPerBar: number, curve: (seconds: number) => number): ExprPoint[] {
  const step = Math.max(1 / 64, length / 48);
  const out: ExprPoint[] = [];
  for (let at = 0; at < length - 1e-9; at += step) out.push({ at: Math.round(at * 10000) / 10000, value: Math.round(curve(at * secondsPerBar) * 1000) / 1000 });
  out.push({ at: Math.round(length * 10000) / 10000, value: Math.round(curve(length * secondsPerBar) * 1000) / 1000 });
  return out;
}

/** Give each note a bend curve (replacing its own). */
const withBend = (notes: readonly NoteEvent[], curveOf: (n: NoteEvent, length: number) => ExprPoint[]): NoteEvent[] =>
  notes.map((n) => {
    const length = durationToBars(n.duration);
    return { ...n, expr: { ...(n.expr ?? {}), bend: curveOf(n, length) } };
  });

/** Spring bounce: each note's pitch bounces like a weight on a spring and settles, 1.3 e^(-2.4t) cos(6πt) semitones (an 808's boing). */
export const springBounce = (notes: readonly NoteEvent[], secondsPerBar: number): NoteEvent[] =>
  withBend(notes, (_, length) => bendCurve(length, secondsPerBar, (t) => 1.3 * Math.exp(-2.4 * t) * Math.cos(6 * Math.PI * t)));

/** Tritone slide: each note holds, then slides up half an octave (the devil's interval) over its second half, easing in. */
export const tritoneSlide = (notes: readonly NoteEvent[], secondsPerBar: number): NoteEvent[] =>
  withBend(notes, (_, length) => {
    const half = (length * secondsPerBar) / 2;
    const tau = Math.max(0.02, half / 3);
    return bendCurve(length, secondsPerBar, (t) => (t < half ? 0 : 6 * (1 - Math.exp(-(t - half) / tau))));
  });

/** Scoop: each note starts three semitones flat and swoops up into its pitch in 80 ms (a rave hoover's scoop). */
export const scoop = (notes: readonly NoteEvent[], secondsPerBar: number): NoteEvent[] =>
  withBend(notes, (_, length) => {
    const reach = Math.min(length, 0.08 / secondsPerBar);
    return [
      { at: 0, value: -3 },
      { at: Math.round(reach * 0.5 * 10000) / 10000, value: -0.9 },
      { at: Math.round(reach * 10000) / 10000, value: 0 },
    ];
  });
