import type { InstrumentKey, NoteEvent } from './timelineTypes';
import { barsToDuration } from './timelineTypes';
import { nameOf, SCALES } from './noteTools';
import { seeded } from './smartTools';
import type { SongKey } from './songKey';

/**
 * The dark melody generator: a short loop (1, 2 or 4 bars) for trap, drill, rage and phonk, in
 * minor, harmonic minor or phrygian. It writes a motif (half a bar for a 1-bar loop, a bar
 * otherwise), repeats it, and changes the end of the repeats: a middle ending that hangs on a
 * tension note and a last one that comes home, so the loop answers itself and wraps cleanly. The
 * half step above the root (the flat second) appears in every melody, as a neighbour of the root
 * or as the note that falls back onto it. Rhythms leave space: weighted 16th steps per style,
 * thinned by the density, with a breath before the motif repeats. Seeded, so the same choices and
 * seed give the same melody. Pure, so it's unit tested (scripts/darkMelody.test.mjs).
 */

export type DarkStyle = 'trap' | 'drill' | 'rage' | 'phonk';
export type DarkScale = 'minor' | 'harmonicMinor' | 'phrygian';
export type DarkRegister = 'low' | 'mid' | 'high';
export type DarkSound = 'bell' | 'pluck' | 'piano';

/** The styles: what each one's rhythm leans on, its usual scale and sound. */
export const DARK_STYLES: ReadonlyArray<{ id: DarkStyle; name: string; detail: string; scale: DarkScale; sound: DarkSound; density: number }> = [
  { id: 'trap', name: 'Sparse bells', detail: 'sparse bells, syncopated, lots of space (130-150 BPM)', scale: 'minor', sound: 'bell', density: 0.4 },
  { id: 'drill', name: 'Sliding piano', detail: 'sliding piano, the bounce, triplet runs (140-145 BPM)', scale: 'harmonicMinor', sound: 'piano', density: 0.45 },
  { id: 'rage', name: 'Fast riff', detail: 'busy 16th riffs, octave jumps (150-165 BPM)', scale: 'phrygian', sound: 'pluck', density: 0.7 },
  { id: 'phonk', name: 'Cowbell riff', detail: 'repeated 3+3+2 riff, low and stubborn (125-135 BPM)', scale: 'phrygian', sound: 'bell', density: 0.6 },
];

export const DARK_SCALES: ReadonlyArray<{ id: DarkScale; name: string }> = [
  { id: 'minor', name: 'Minor' },
  { id: 'harmonicMinor', name: 'Harmonic minor' },
  { id: 'phrygian', name: 'Phrygian' },
];

/** The sounds a new track can have, and the instrument each one is. */
export const DARK_SOUNDS: ReadonlyArray<{ id: DarkSound; name: string; instrument: InstrumentKey }> = [
  { id: 'bell', name: 'Bell', instrument: 'musicBox' },
  { id: 'pluck', name: 'Pluck', instrument: 'pluck' },
  { id: 'piano', name: 'Piano', instrument: 'piano' },
];

/** Where the melody sits: the root it's built around (MIDI) is the root's note nearest this. */
export const REGISTER_CENTER: Record<DarkRegister, number> = { low: 50, mid: 62, high: 74 };

export interface DarkMelodyOptions {
  style: DarkStyle;
  scale: DarkScale;
  /** The key's root, 0 = C */
  root: number;
  bars: 1 | 2 | 4;
  /** 0 sparse to 1 busy */
  density: number;
  register: DarkRegister;
  seed: number;
}

const EPS = 1e-6;
const STEPS = 16;

/**
 * How likely a note is on each 16th of a bar, per style (before the density). Trap leans on the
 * syncopated 3-3-2 places and leaves the backbeat to the drums; drill on the bounce (the 4th and
 * 7th 16ths, the "and" of 3); rage fills the bar; phonk repeats a 3+3+2 cowbell figure.
 */
const RHYTHM: Record<DarkStyle, readonly number[]> = {
  trap: [1, 0.05, 0.25, 0.55, 0.1, 0.05, 0.6, 0.15, 0.35, 0.05, 0.45, 0.4, 0.15, 0.05, 0.45, 0.1],
  drill: [1, 0.05, 0.15, 0.7, 0.05, 0.15, 0.7, 0.05, 0.3, 0.05, 0.65, 0.05, 0.3, 0.5, 0.05, 0.15],
  rage: [1, 0.45, 0.6, 0.45, 0.85, 0.45, 0.6, 0.45, 0.9, 0.45, 0.6, 0.45, 0.85, 0.45, 0.6, 0.45],
  phonk: [1, 0.15, 0.3, 0.95, 0.15, 0.3, 0.95, 0.15, 0.7, 0.15, 0.3, 0.85, 0.15, 0.3, 0.8, 0.35],
};

/** The longest a note holds, in bars (a bell rings on by itself; a rage pluck stays short). */
const MAX_LEN: Record<DarkStyle, number> = { trap: 3 / 16, drill: 4 / 16, rage: 1 / 16, phonk: 2 / 16 };

/** A pitch of the motif: an index on the scale ladder, or the flat second as an ornament. */
interface Hit {
  /** Position in bars from the motif's start */
  at: number;
  /** MIDI note */
  midi: number;
  velocity: number;
}

/** The scale's notes over two and a half octaves around `base` (the register's root). */
function ladderOf(base: number, steps: readonly number[]): number[] {
  const out: number[] = [];
  for (let o = -1; o <= 2; o++) for (const s of steps) out.push(base + o * 12 + s);
  return out.filter((m) => m >= base - 12 && m <= base + 19).sort((a, b) => a - b);
}

/** The root's MIDI note nearest the register's centre. */
export function registerRoot(root: number, register: DarkRegister): number {
  const center = REGISTER_CENTER[register];
  const pc = ((root % 12) + 12) % 12;
  let m = center - (((center - pc) % 12) + 12) % 12;
  if (center - m > 6) m += 12;
  return m;
}

/** Onsets (16th steps) for a span of `steps` 16ths at a density. */
function rhythm(style: DarkStyle, density: number, steps: number, rnd: () => number, breath: boolean): number[] {
  const w = RHYTHM[style];
  const scale = 0.2 + 1.05 * Math.max(0, Math.min(1, density));
  const on: number[] = [];
  for (let i = 0; i < steps; i++) {
    if (i === 0) {
      on.push(0);
      continue;
    }
    // A note right after another is less likely in the sparse styles (space between hits)
    const after = on.length && on[on.length - 1] === i - 1 && style !== 'rage' ? 0.45 : 1;
    if (rnd() < Math.min(0.97, w[i % STEPS] * scale * after)) on.push(i);
  }
  // A breath before the motif comes round again (not in the styles that never stop)
  if (breath && style !== 'rage' && density < 0.8) {
    const cut = steps >= 16 ? 3 : 2;
    while (on.length > 2 && on[on.length - 1] >= steps - cut) on.pop();
  }
  // At least a few notes: the strongest places of the style that aren't taken yet
  const want = Math.max(2, Math.round(steps / 8));
  if (on.length < want) {
    const free = Array.from({ length: steps }, (_, i) => i)
      .filter((i) => !on.includes(i) && !(breath && i >= steps - 2))
      .sort((a, b) => w[b % STEPS] - w[a % STEPS] || a - b);
    while (on.length < want && free.length) on.push(free.shift()!);
    on.sort((a, b) => a - b);
  }
  return on;
}

/** The next pitch of a walk on the ladder, from index `i`, in the style's way of moving. */
function stepFrom(i: number, ladder: readonly number[], style: DarkStyle, rnd: () => number, home: number): number {
  const r = rnd();
  let move: number;
  if (style === 'phonk') move = r < 0.5 ? 0 : r < 0.75 ? -1 : r < 0.9 ? 1 : 2;
  else if (style === 'rage') move = r < 0.2 ? 0 : r < 0.45 ? 1 : r < 0.65 ? -1 : r < 0.85 ? 7 * (rnd() < 0.5 ? 1 : -1) : 2;
  else move = r < 0.2 ? 0 : r < 0.5 ? -1 : r < 0.75 ? 1 : r < 0.88 ? -2 : 2;
  let j = i + move;
  // Stay near home: more than a 6th away pulls back toward it
  if (Math.abs(j - home) > 5) j = i - Math.sign(j - home);
  return Math.max(0, Math.min(ladder.length - 1, j));
}

/** Pitches for a list of onsets, walking from `start` (a ladder index). */
function pitches(count: number, ladder: readonly number[], style: DarkStyle, rnd: () => number, start: number, home: number): number[] {
  const out: number[] = [];
  let i = start;
  for (let k = 0; k < count; k++) {
    if (k > 0) i = stepFrom(i, ladder, style, rnd, home);
    out.push(i);
  }
  return out;
}

const velocityAt = (step: number, rnd: () => number, style: DarkStyle) => {
  const accent = step % 4 === 0 ? 0.1 : step % 2 ? -0.08 : 0;
  const base = style === 'rage' ? 0.78 : 0.82;
  return Math.max(0.35, Math.min(1, base + accent + (rnd() - 0.5) * 0.1));
};

/**
 * A drill triplet run: a quarter with notes in the motif becomes three 8th-note triplets falling
 * down the scale (bars 0, 1/12 and 2/12 from the beat).
 */
function drillTriplet(hits: Hit[], motifBars: number, ladder: readonly number[], rnd: () => number): Hit[] {
  const beats = Math.round(motifBars * 4);
  // Not the first beat (the motif's downbeat stays), and not the last (the breath)
  const choices = Array.from({ length: Math.max(0, beats - 2) }, (_, i) => i + 1);
  if (!choices.length || rnd() > 0.55) return hits;
  const beat = choices[Math.floor(rnd() * choices.length)];
  const from = beat / 4;
  const to = from + 0.25;
  const before = [...hits].reverse().find((h) => h.at < from - EPS) ?? hits[0];
  let i = Math.max(2, ladder.indexOf(before.midi));
  if (i < 0) i = 2;
  const run: Hit[] = [0, 1, 2].map((k) => ({ at: from + k / 12, midi: ladder[Math.max(0, Math.min(ladder.length - 1, i + 1 - k))], velocity: 0.8 - k * 0.06 }));
  return [...hits.filter((h) => h.at < from - EPS || h.at >= to - EPS), ...run].sort((a, b) => a.at - b.at);
}

/** One motif: rhythm and pitches over `motifBars`. */
function motif(o: DarkMelodyOptions, motifBars: number, ladder: readonly number[], home: number, rnd: () => number): Hit[] {
  const steps = Math.round(motifBars * STEPS);
  const on = rhythm(o.style, o.density, steps, rnd, true);
  // Start on the root, the 5th or (in rage) the octave
  const fifth = ladder.findIndex((m) => m === ladder[home] + 7);
  const starts = o.style === 'rage' ? [home, home, fifth >= 0 ? fifth : home, Math.min(ladder.length - 1, home + 7)] : [home, home, home, fifth >= 0 ? fifth : home];
  const first = starts[Math.floor(rnd() * starts.length)];
  const idx = pitches(on.length, ladder, o.style, rnd, first, home);
  let hits: Hit[] = on.map((s, k) => ({ at: s / STEPS, midi: ladder[idx[k]], velocity: velocityAt(s, rnd, o.style) }));
  if (o.style === 'drill') hits = drillTriplet(hits, motifBars, ladder, rnd);
  return hits;
}

/**
 * A motif with its end rewritten: the notes from `from` (bars into the motif) on are new, and the
 * last one lands on `target` (MIDI). `fall` puts the flat second just before a root target.
 */
function ending(o: DarkMelodyOptions, base: Hit[], motifBars: number, from: number, ladder: readonly number[], home: number, target: number, rnd: () => number, fall: boolean): Hit[] {
  const keep = base.filter((h) => h.at < from - EPS);
  const steps = Math.round((motifBars - from) * STEPS);
  const offset = Math.round(from * STEPS);
  let on = rhythm(o.style, Math.min(1, o.density + 0.1), steps, rnd, true).map((s) => s + offset);
  // The new end differs from the old one in rhythm when it can (the ear hears the change)
  const old = base.filter((h) => h.at >= from - EPS).map((h) => Math.round(h.at * STEPS)).join();
  if (on.join() === old && steps > 2) on = on.length > 2 ? on.filter((_, k) => k !== 1) : [...on, offset + Math.max(1, steps - 3)].sort((a, b) => a - b);
  const last = keep[keep.length - 1];
  const startIdx = last ? stepFrom(Math.max(0, ladder.indexOf(last.midi)), ladder, o.style, rnd, home) : home;
  const idx = pitches(on.length, ladder, o.style, rnd, startIdx, home);
  const tail: Hit[] = on.map((s, k) => ({ at: s / STEPS, midi: ladder[idx[k]], velocity: velocityAt(s, rnd, o.style) }));
  if (tail.length) tail[tail.length - 1].midi = target;
  if (fall && tail.length === 1 && tail[0].at - 1 / STEPS >= from - EPS) tail.unshift({ at: tail[0].at - 1 / STEPS, midi: target, velocity: tail[0].velocity - 0.08 });
  if (fall && tail.length >= 2) tail[tail.length - 2].midi = target + 1;
  return [...keep, ...tail];
}

const isFlatSecond = (midi: number, root: number) => (((midi - root) % 12) + 12) % 12 === 1;

/** The flat second put into a motif (in place): a note next to a root becomes it (never the downbeat). */
function flatSecondInto(hits: Hit[], rootMidi: number): void {
  if (hits.length < 2) return;
  const k = hits.findIndex((h, i) => i > 0 && h.midi !== rootMidi && (hits[i - 1].midi === rootMidi || hits[i + 1]?.midi === rootMidi));
  hits[k > 0 ? k : hits.length - 1].midi = rootMidi + 1;
}

/** Whether a melody's notes include the half step above the root. */
export const hasFlatSecond = (notes: readonly { note: string }[], root: number): boolean =>
  notes.some((n) => {
    const m = /^([A-G]#?)(-?\d+)$/.exec(n.note);
    if (!m) return false;
    const pc = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(m[1]);
    return pc === (root + 1) % 12;
  });

/**
 * The melody: `bars` long, positions in bars from the clip's start, every note ending by the loop's
 * end. Structure: a 1-bar loop is a half-bar motif and its answer; 2 bars, a bar and its answer;
 * 4 bars, A A' A A'' (the middle ending hangs on a tension note, the last comes home).
 */
export function darkMelody(o: DarkMelodyOptions, newId: () => string): NoteEvent[] {
  const styleIx = DARK_STYLES.findIndex((s) => s.id === o.style);
  const rnd = seeded((Math.imul(o.seed | 0, 2654435761) ^ (styleIx * 97 + o.bars * 13 + o.root * 7 + DARK_SCALES.findIndex((s) => s.id === o.scale))) >>> 0);
  const steps = SCALES[o.scale].steps;
  const rootMidi = registerRoot(o.root, o.register);
  const ladder = ladderOf(rootMidi, steps);
  const home = ladder.indexOf(rootMidi);
  const motifBars = o.bars === 1 ? 0.5 : 1;
  const a = motif(o, motifBars, ladder, home, rnd);
  // Tension for the middle ending: the 5th, the flat second, or (harmonic minor) the raised 7th
  const tensions = [rootMidi + 7, rootMidi + 1, ...(o.scale === 'harmonicMinor' ? [rootMidi - 1] : [rootMidi + 3])];
  const tension = tensions[Math.floor(rnd() * tensions.length)];
  // The last ending comes home: the root, often falling onto it from the flat second
  const homeNote = rootMidi;
  const endFrom = motifBars / 2;
  // The flat second, at least once: falling onto the root at the end, or (when the end doesn't
  // fall, or can't) a neighbour of the root in the motif itself, so every repeat keeps it
  const fall = rnd() < 0.7;
  const middle = o.bars === 4 ? ending(o, a, motifBars, endFrom, ladder, home, tension, rnd, false) : null;
  let final = ending(o, a, motifBars, endFrom, ladder, home, homeNote, rnd, fall);
  const flat = (hs: Hit[]) => hs.some((h) => isFlatSecond(h.midi, o.root));
  if (!flat(a) && !flat(final) && !(middle && flat(middle))) {
    flatSecondInto(a, rootMidi);
    // (The endings start with the motif's first half: keep them in step with it)
    const half = (hs: Hit[]) => hs.filter((h) => h.at >= endFrom - EPS);
    final = [...a.filter((h) => h.at < endFrom - EPS), ...half(final)];
    if (middle) middle.splice(0, middle.length, ...a.filter((h) => h.at < endFrom - EPS), ...half(middle));
  }
  const parts: Hit[][] = middle ? [a, middle, a, final] : [a, final];
  const hits: Hit[] = parts.flatMap((p, i) => p.map((h) => ({ ...h, at: h.at + i * motifBars })));
  const length = o.bars;
  return hits.map((h, i) => {
    const next = hits[i + 1]?.at ?? length;
    const gap = next - h.at;
    // Short styles play staccato; the others hold to the next note, up to the style's longest
    const len = Math.max(1 / 32, Math.min(MAX_LEN[o.style], o.style === 'rage' ? gap * 0.75 : gap, length - h.at));
    return {
      id: newId(),
      note: nameOf(h.midi),
      startOffset: Math.round(h.at * 192) / 192,
      duration: barsToDuration(len),
      velocity: Math.round(h.velocity * 100) / 100,
    };
  });
}

/**
 * The key a dark melody defaults to: the song's key when it's minor; a major key's relative minor
 * (the same notes, so it fits what's there). With no key yet, C minor.
 */
export function darkKeyFor(key: SongKey | null): { root: number; note: string } {
  if (!key) return { root: 0, note: 'no key found yet' };
  if (key.mode === 'minor') return { root: key.root, note: `the song's key, ${key.name}` };
  return { root: (key.root + 9) % 12, note: `the relative minor of the song's ${key.name}` };
}
