import type { NoteEvent } from './timelineTypes';
import { barsToDuration, durationToBars } from './timelineTypes';
import { midiOf, nameOf } from './noteTools';
import type { SongKey } from './songKey';
import { NOTE_NAMES } from './songKey';

/**
 * Writing helpers that make parts from a few choices: chord progressions in the song's key (with
 * smooth voice leading), chords that fit a melody, a bass line under chords, a drummer, and drum
 * fills. All on plain note lists (positions in bars from the clip start), with no store or audio,
 * so Node can unit-test them. Anything random is seeded, so the same choices give the same part.
 */

const EPS = 1e-6;
const pc = (m: number) => ((m % 12) + 12) % 12;

/** A small seeded random number generator (mulberry32): the same seed, the same numbers. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Chords in a key ----------

/** A chord of the key: built on scale degree `degree` (0 = the tonic); `major` raises its third (the V of a minor key). */
export interface Degree {
  degree: number;
  major?: boolean;
}

/** The pitch classes of a degree's chord, root first (a triad, or with `seventh` a 7th chord). */
export function degreeChord(key: SongKey, d: Degree, seventh = false): number[] {
  const at = (i: number) => pc(key.root + key.steps[(d.degree + i) % 7]);
  const out = [at(0), at(2), at(4)];
  if (d.major && pc(out[1] - out[0]) === 3) out[1] = pc(out[1] + 1);
  if (seventh) out.push(d.major ? pc(at(0) + 10) : at(6));
  return out;
}

/** A chord's name from its pitch classes, root first: "C", "Am", "Bdim", "G7", "Fmaj7", "Dm7". */
export function chordName(pcs: readonly number[]): string {
  const [r, ...rest] = pcs;
  const iv = rest.map((p) => pc(p - r));
  const root = NOTE_NAMES[r];
  const minor = iv.includes(3);
  const dim = minor && iv.includes(6);
  if (iv.length >= 3) {
    const sev = iv[2];
    if (dim) return `${root}${sev === 9 ? 'dim7' : 'm7b5'}`;
    if (minor) return `${root}m7`;
    return `${root}${sev === 11 ? 'maj7' : '7'}`;
  }
  return `${root}${dim ? 'dim' : minor ? 'm' : ''}`;
}

export interface Progression {
  id: string;
  name: string;
  mode: 'major' | 'minor';
  chords: Degree[];
}

const D = (degree: number, major?: boolean): Degree => (major ? { degree, major } : { degree });

/** Well-worn progressions, four chords each, in Roman numerals (lower case: minor). */
export const PROGRESSIONS: readonly Progression[] = [
  { id: 'pop', name: 'I – V – vi – IV (pop)', mode: 'major', chords: [D(0), D(4), D(5), D(3)] },
  { id: 'ballad', name: 'vi – IV – I – V (ballad)', mode: 'major', chords: [D(5), D(3), D(0), D(4)] },
  { id: 'fifties', name: 'I – vi – IV – V (doo-wop)', mode: 'major', chords: [D(0), D(5), D(3), D(4)] },
  { id: 'rock', name: 'I – IV – V – IV (rock)', mode: 'major', chords: [D(0), D(3), D(4), D(3)] },
  { id: 'lift', name: 'IV – V – iii – vi (lift)', mode: 'major', chords: [D(3), D(4), D(2), D(5)] },
  { id: 'jazz', name: 'ii – V – I – I (jazz)', mode: 'major', chords: [D(1), D(4), D(0), D(0)] },
  { id: 'epic', name: 'i – VI – III – VII (epic)', mode: 'minor', chords: [D(0), D(5), D(2), D(6)] },
  { id: 'dark', name: 'i – VII – VI – VII (dark)', mode: 'minor', chords: [D(0), D(6), D(5), D(6)] },
  { id: 'andalusian', name: 'i – VII – VI – V (flamenco)', mode: 'minor', chords: [D(0), D(6), D(5), D(4, true)] },
  { id: 'sad', name: 'i – iv – VI – V (sad)', mode: 'minor', chords: [D(0), D(3), D(5), D(4, true)] },
  { id: 'drift', name: 'i – VI – iv – v (drift)', mode: 'minor', chords: [D(0), D(5), D(3), D(4)] },
  { id: 'anthem', name: 'VI – VII – i – i (anthem)', mode: 'minor', chords: [D(5), D(6), D(0), D(0)] },
];

/**
 * Notes for chord pitch classes near the last chord: of every inversion around the middle of the
 * keyboard, the one whose notes move least from `prev` (and that doesn't wander off), as a
 * keyboard player would voice it.
 */
export function voiceLead(pcs: readonly number[], prev: readonly number[] | null, center = 62): number[] {
  let best: number[] = [];
  let bestCost = Infinity;
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    for (let low = center - 12; low <= center + 4; low++) {
      if (pc(low) !== order[0]) continue;
      const notes = [low];
      for (const p of order.slice(1)) {
        let m = notes[notes.length - 1] + 1;
        while (pc(m) !== p) m++;
        notes.push(m);
      }
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      let cost = Math.abs(mean - center) * 0.35;
      if (prev?.length) {
        const sorted = [...prev].sort((a, b) => a - b);
        for (let i = 0; i < notes.length; i++) cost += Math.abs(notes[i] - (sorted[Math.min(i, sorted.length - 1)] ?? notes[i]));
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
  }
  return best;
}

export type ChordStyle = 'sustain' | 'pulse' | 'offbeat' | 'arp';
export const CHORD_STYLES: ReadonlyArray<{ id: ChordStyle; name: string }> = [
  { id: 'sustain', name: 'Held chords' },
  { id: 'pulse', name: 'Quarter-note pulse' },
  { id: 'offbeat', name: 'Off-beat stabs' },
  { id: 'arp', name: 'Arpeggio (16ths)' },
];

const note = (newId: () => string, midi: number, at: number, bars: number, velocity: number): NoteEvent => ({
  id: newId(),
  note: nameOf(midi),
  startOffset: Math.round(at * 192) / 192,
  duration: barsToDuration(bars),
  velocity: Math.round(velocity * 100) / 100,
});

/** A chord sequence (pitch classes, root first) as notes, `chordBars` each, voiced smoothly, in a style. */
export function chordNotesFor(chords: readonly number[][], chordBars: number, style: ChordStyle, newId: () => string): NoteEvent[] {
  const out: NoteEvent[] = [];
  let prev: number[] | null = null;
  chords.forEach((pcs, i) => {
    const voiced = voiceLead(pcs, prev);
    prev = voiced;
    const start = i * chordBars;
    if (style === 'sustain') {
      for (const m of voiced) out.push(note(newId, m, start, chordBars, 0.7));
    } else if (style === 'pulse') {
      for (let t = 0; t < chordBars - EPS; t += 0.25) for (const m of voiced) out.push(note(newId, m, start + t, 0.22, t % 1 === 0 ? 0.78 : 0.62));
    } else if (style === 'offbeat') {
      for (let t = 0.125; t < chordBars - EPS; t += 0.25) for (const m of voiced) out.push(note(newId, m, start + t, 0.1, 0.72));
    } else {
      const up = [...voiced, voiced[0] + 12];
      let k = 0;
      for (let t = 0; t < chordBars - EPS; t += 1 / 16, k++) out.push(note(newId, up[k % up.length], start + t, 1 / 16, k % 4 === 0 ? 0.75 : 0.6));
    }
  });
  return out;
}

/** A progression's chords in `key`, as pitch classes (root first). */
export const progressionChords = (key: SongKey, prog: Progression, sevenths = false): number[][] => prog.chords.map((d) => degreeChord(key, d, sevenths));

// ---------- Chords for a melody ----------

/** The chords to try under a melody: the key's seven, and in a minor key the major V too. */
function candidates(key: SongKey): Degree[] {
  const out = [0, 1, 2, 3, 4, 5, 6].map((d) => D(d));
  if (key.mode === 'minor') out.push(D(4, true));
  return out;
}

/** How well one chord follows another: the strong root moves (up a 4th, down a 3rd, down a 4th) score, staying put a little less. */
function moveScore(a: Degree, b: Degree, key: SongKey): number {
  const step = (b.degree - a.degree + 7) % 7;
  let s = step === 3 ? 0.6 : step === 5 ? 0.45 : step === 4 ? 0.35 : step === 1 ? 0.15 : step === 0 ? -0.25 : 0;
  // V to i/I, and the leading V in minor
  if (a.degree === 4 && b.degree === 0) s += 0.4;
  if (b.degree === 6 && key.mode === 'major') s -= 0.6; // the diminished vii, rarely wanted
  if (b.degree === 1 && key.mode === 'minor') s -= 0.6; // ii° in minor
  return s;
}

export interface MelodyNote {
  /** Bars from the start */
  at: number;
  bars: number;
  midi: number;
}

/**
 * Chords that fit a melody, one every `chordBars`: each stretch's notes vote for the chords they
 * belong to (long notes and notes on the beat count more, notes that clash count against), and the
 * chords are chained so they move the way songs usually do (best overall path, Viterbi).
 */
export function harmonize(melody: readonly MelodyNote[], key: SongKey, lengthBars: number, chordBars = 1): { chords: number[][]; degrees: Degree[] } {
  const cands = candidates(key);
  const sets = cands.map((d) => degreeChord(key, d));
  const steps = Math.max(1, Math.ceil(lengthBars / chordBars - EPS));
  const fit: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const from = i * chordBars;
    const to = from + chordBars;
    fit.push(
      sets.map((set) => {
        let s = 0;
        for (const n of melody) {
          const overlap = Math.min(to, n.at + n.bars) - Math.max(from, n.at);
          if (overlap <= EPS) continue;
          const beat = Math.abs((n.at - from) * 4 - Math.round((n.at - from) * 4)) < 1e-3;
          const strong = n.at >= from - EPS && (Math.abs(n.at - from) < EPS || Math.abs(n.at - from - chordBars / 2) < EPS);
          const w = Math.min(1, overlap * 4) * (strong ? 1.6 : beat ? 1.15 : 0.8);
          const p = pc(n.midi);
          s += set.includes(p) ? w * (p === set[0] ? 1.25 : 1) : -0.7 * w;
        }
        return s;
      })
    );
  }
  // Viterbi over the chords
  const score: number[][] = [];
  const back: number[][] = [];
  score[0] = cands.map((d, j) => fit[0][j] + (d.degree === 0 && !d.major ? 0.6 : 0));
  for (let i = 1; i < steps; i++) {
    score[i] = [];
    back[i] = [];
    cands.forEach((d, j) => {
      let best = -Infinity;
      let arg = 0;
      cands.forEach((p, k) => {
        const v = score[i - 1][k] + moveScore(p, d, key);
        if (v > best) {
          best = v;
          arg = k;
        }
      });
      // Ending on the tonic or the dominant sounds finished
      const end = i === steps - 1 && (d.degree === 0 || d.degree === 4) ? 0.3 : 0;
      score[i][j] = best + fit[i][j] + end;
      back[i][j] = arg;
    });
  }
  let j = score[steps - 1].indexOf(Math.max(...score[steps - 1]));
  const path: number[] = [j];
  for (let i = steps - 1; i > 0; i--) {
    j = back[i][j];
    path.unshift(j);
  }
  return { chords: path.map((k) => sets[k]), degrees: path.map((k) => cands[k]) };
}

/** A clip's notes as a melody (its highest note at each moment counts as the tune). */
export function melodyOf(notes: readonly NoteEvent[], lengthBars: number): MelodyNote[] {
  return notes
    .filter((n) => n.startOffset >= -EPS && n.startOffset < lengthBars - EPS && Number.isFinite(midiOf(n.note)))
    .map((n) => ({ at: n.startOffset, bars: durationToBars(n.duration), midi: midiOf(n.note) }));
}

// ---------- A bass line under chords ----------

const TRIADS: ReadonlyArray<readonly number[]> = [
  [0, 4, 7],
  [0, 3, 7],
  [0, 3, 6],
  [0, 4, 7, 10],
  [0, 3, 7, 10],
  [0, 4, 7, 11],
  [0, 2, 7],
  [0, 5, 7],
];

/** A chord's root from its notes: the pitch class that makes the notes the best-known chord shape (else the lowest note). */
export function chordRoot(midis: readonly number[]): number {
  const pcs = [...new Set(midis.map(pc))];
  let best = pc(Math.min(...midis));
  let bestScore = -1;
  for (const r of pcs) {
    const iv = new Set(pcs.map((p) => pc(p - r)));
    for (const shape of TRIADS) {
      const hit = shape.filter((x) => iv.has(x)).length;
      const score = hit === shape.length ? hit * 2 - (iv.size - hit) * 0.5 + (r === pc(Math.min(...midis)) ? 0.25 : 0) : -1;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
  }
  return best;
}

export type BassStyle = 'root' | 'eighths' | 'octaves' | 'syncopated';
export const BASS_STYLES: ReadonlyArray<{ id: BassStyle; name: string }> = [
  { id: 'root', name: 'Held roots' },
  { id: 'eighths', name: 'Driving 8ths' },
  { id: 'octaves', name: 'Octave bounce' },
  { id: 'syncopated', name: 'Syncopated' },
];

/**
 * A bass line under a chord part: each chord's root (the chords are where notes start together),
 * low down, in a style. `low` is the lowest note the bass goes to (MIDI).
 */
export function bassFromChords(chordNotes: readonly NoteEvent[], lengthBars: number, style: BassStyle, newId: () => string, low = 33): NoteEvent[] {
  const groups = new Map<number, number[]>();
  for (const n of chordNotes) {
    if (n.startOffset < -EPS || n.startOffset >= lengthBars - EPS) continue;
    const m = midiOf(n.note);
    if (!Number.isFinite(m)) continue;
    const at = Math.round(n.startOffset * 192) / 192;
    groups.set(at, [...(groups.get(at) ?? []), m]);
  }
  // Only the chord changes (a repeated stab of the same chord is one chord)
  const changes: Array<{ at: number; root: number }> = [];
  for (const at of [...groups.keys()].sort((a, b) => a - b)) {
    const root = chordRoot(groups.get(at)!);
    if (changes.length && changes[changes.length - 1].root === root) continue;
    changes.push({ at, root });
  }
  const out: NoteEvent[] = [];
  changes.forEach((c, i) => {
    const end = changes[i + 1]?.at ?? lengthBars;
    let m = low + pc(c.root - low);
    if (m < low) m += 12;
    const span = end - c.at;
    if (style === 'root') out.push(note(newId, m, c.at, span, 0.85));
    else if (style === 'eighths') for (let t = 0; t < span - EPS; t += 0.125) out.push(note(newId, m, c.at + t, 0.11, t % 0.25 === 0 ? 0.85 : 0.7));
    else if (style === 'octaves') for (let t = 0, k = 0; t < span - EPS; t += 0.125, k++) out.push(note(newId, k % 2 ? m + 12 : m, c.at + t, 0.11, k % 2 ? 0.7 : 0.85));
    else {
      // Dotted-8th push: on 1, the "a" of 2 and the "&" of 3, in each bar of the chord
      for (const t of [0, 0.375, 0.625]) for (let b = 0; b < span - EPS; b += 1) if (b + t < span - EPS) out.push(note(newId, t === 0.625 ? m + 7 : m, c.at + b + t, t === 0 ? 0.3 : 0.2, t === 0 ? 0.88 : 0.74));
    }
  });
  return out;
}

// ---------- A drummer ----------

const KICK = 'C1';
const SNARE = 'D1';
const CLAP = 'D#1';
const HAT = 'F#1';
const OPEN = 'A#1';
const TOM_HI = 'D2';
const TOM_MID = 'B1';
const TOM_LO = 'F1';
const CRASH = 'C#2';
const RIDE = 'D#2';

export type DrumStyle = 'house' | 'rock' | 'hiphop' | 'trap' | 'dnb' | 'funk' | 'dembow' | 'halftime';
export const DRUM_STYLES: ReadonlyArray<{ id: DrumStyle; name: string; bpm: string }> = [
  { id: 'house', name: 'Four on the floor (house, disco, techno)', bpm: '118–130' },
  { id: 'rock', name: 'Backbeat (rock, pop)', bpm: '90–140' },
  { id: 'hiphop', name: 'Boom bap (hip-hop)', bpm: '85–98' },
  { id: 'trap', name: 'Trap (half time, hat rolls)', bpm: '130–150' },
  { id: 'dnb', name: 'Two-step (drum & bass)', bpm: '170–176' },
  { id: 'funk', name: 'Funk (ghost notes)', bpm: '95–115' },
  { id: 'dembow', name: 'Dembow (reggaeton)', bpm: '88–100' },
  { id: 'halftime', name: 'Half time (ballad, cinematic)', bpm: '60–90' },
];

/** One bar of a style at an intensity (0 sparse to 1 busy), as [step of 16, drum, velocity]. */
function styleBar(style: DrumStyle, intensity: number, bar: number, rnd: () => number): Array<[number, string, number]> {
  const hits: Array<[number, string, number]> = [];
  const add = (steps: number[], drum: string, vel: number) => steps.forEach((s) => hits.push([s, drum, vel]));
  const busy = intensity > 0.66;
  const mid = intensity > 0.33;
  const eighths = [0, 2, 4, 6, 8, 10, 12, 14];
  const sixteenths = [...Array(16).keys()];
  switch (style) {
    case 'house':
      add([0, 4, 8, 12], KICK, 0.95);
      add([4, 12], CLAP, 0.85);
      if (busy) add(sixteenths.filter((s) => s % 4 !== 2), HAT, 0.45);
      add([2, 6, 10, 14], mid ? OPEN : HAT, 0.65);
      break;
    case 'rock':
      add([0, 8], KICK, 0.95);
      if (mid) add([10], KICK, 0.8);
      add([4, 12], SNARE, 0.9);
      add(busy ? sixteenths : eighths, HAT, 0.55);
      if (busy && rnd() < 0.5) add([7], KICK, 0.7);
      break;
    case 'hiphop':
      add([0, 10], KICK, 0.95);
      if (mid) add([7], KICK, 0.75);
      add([4, 12], SNARE, 0.92);
      add(eighths, HAT, 0.5);
      if (busy) add([15], SNARE, 0.35);
      break;
    case 'trap':
      add([0], KICK, 0.95);
      add([bar % 2 ? 11 : 10], KICK, 0.85);
      if (mid) add([3], KICK, 0.7);
      add([8], SNARE, 0.9);
      add([8], CLAP, 0.8);
      add(mid ? eighths.concat([3, 7, 11, 15].filter(() => busy)) : eighths, HAT, 0.5);
      break;
    case 'dnb':
      add([0, 10], KICK, 0.95);
      add([4, 12], SNARE, 0.92);
      add(busy ? sixteenths : eighths, HAT, 0.48);
      if (mid) add([14], OPEN, 0.55);
      break;
    case 'funk':
      add([0, 3, 10], KICK, 0.92);
      add([4, 12], SNARE, 0.9);
      add(mid ? [7, 9, 15] : [9], SNARE, 0.28);
      add(sixteenths, HAT, 0.42);
      if (busy) add([6], OPEN, 0.55);
      break;
    case 'dembow':
      add([0, 4, 8, 12], KICK, 0.92);
      add([3, 6, 11, 14], SNARE, 0.85);
      add(mid ? eighths : [0, 4, 8, 12], HAT, 0.45);
      break;
    case 'halftime':
      add([0], KICK, 0.92);
      if (mid) add([10], KICK, 0.75);
      add([8], SNARE, 0.9);
      add(busy ? eighths : [0, 4, 8, 12], mid ? HAT : RIDE, 0.5);
      break;
  }
  return hits;
}

export type FillKind = 'snare' | 'toms' | 'build' | 'kick';
export const FILLS: ReadonlyArray<{ id: FillKind; name: string; beats: number }> = [
  { id: 'snare', name: 'Snare roll (last beat)', beats: 1 },
  { id: 'toms', name: 'Tom run (last 2 beats)', beats: 2 },
  { id: 'build', name: 'Build-up (snare, whole bar)', beats: 4 },
  { id: 'kick', name: 'Kick pickup (last beat)', beats: 1 },
];

/**
 * A drum fill at the end of the bar starting `barStart` (bars from the clip start): the notes in
 * its last beats make way (a kick on the beat stays) for the fill, and with `crash` a crash and
 * kick land on the next downbeat (when it's inside the clip).
 */
export function fillBar(notes: readonly NoteEvent[], barStart: number, kind: FillKind, clipBars: number, newId: () => string, crash = true): NoteEvent[] {
  const beats = FILLS.find((f) => f.id === kind)!.beats;
  const from = barStart + 1 - beats / 4;
  const to = barStart + 1;
  const keep = notes.filter((n) => !(n.startOffset >= from - EPS && n.startOffset < to - EPS && !(n.note === KICK && Math.abs(n.startOffset * 4 - Math.round(n.startOffset * 4)) < 1e-3)));
  const fill: NoteEvent[] = [];
  const hit = (drum: string, at: number, vel: number, len = 1 / 16) => fill.push(note(newId, midiOf(drum), at, len, Math.min(1, vel)));
  if (kind === 'snare') for (let i = 0; i < 4; i++) hit(SNARE, from + i / 16, 0.5 + i * 0.13);
  if (kind === 'toms') {
    const order = [TOM_HI, TOM_HI, TOM_MID, TOM_MID, TOM_MID, TOM_LO, TOM_LO, TOM_LO];
    order.forEach((t, i) => hit(t, from + i / 16, 0.62 + i * 0.045));
  }
  if (kind === 'build') {
    // 8ths, then 16ths, then 32nds in the last beat, getting louder
    let i = 0;
    for (let t = from; t < to - 0.5 - EPS; t += 1 / 8, i++) hit(SNARE, t, 0.42 + i * 0.03);
    for (let t = to - 0.5; t < to - 0.25 - EPS; t += 1 / 16, i++) hit(SNARE, t, 0.55 + i * 0.03);
    for (let t = to - 0.25; t < to - EPS; t += 1 / 32, i++) hit(SNARE, t, 0.6 + i * 0.03, 1 / 32);
  }
  if (kind === 'kick') {
    hit(KICK, from + 2 / 16, 0.8);
    hit(KICK, from + 3 / 16, 0.9);
    hit(SNARE, from, 0.75);
  }
  if (crash && to < clipBars - EPS) {
    const rest = keep.filter((n) => !(Math.abs(n.startOffset - to) < EPS && (n.note === CRASH || n.note === KICK)));
    hit(CRASH, to, 0.85, 0.5);
    hit(KICK, to, 0.95);
    return [...rest, ...fill];
  }
  return [...keep, ...fill];
}

/**
 * A drum part: `bars` of a style at an intensity, a little different each bar (the hats breathe,
 * an extra kick now and then), with a fill closing every `fillEvery` bars (0: none) and a crash
 * opening the part.
 */
export function drummer(style: DrumStyle, bars: number, intensity: number, fillEvery: number, seed: number, newId: () => string): NoteEvent[] {
  const rnd = seeded(seed);
  let out: NoteEvent[] = [];
  for (let b = 0; b < bars; b++) {
    for (const [step, drum, vel] of styleBar(style, intensity, b, rnd)) {
      // Hats lean on the beat, and every hit varies a little
      const accent = drum === HAT && step % 4 === 0 ? 0.12 : 0;
      out.push(note(newId, midiOf(drum), b + step / 16, drum === OPEN ? 1 / 8 : 1 / 16, Math.max(0.15, Math.min(1, vel + accent + (rnd() - 0.5) * 0.12))));
    }
  }
  // The same drum on the same step once only (styles can stack the same hat)
  const seen = new Set<string>();
  out = out.filter((n) => {
    const k = `${n.note}@${n.startOffset}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (bars > 0) out.push(note(newId, midiOf(CRASH), 0, 0.5, 0.8));
  if (fillEvery > 0) {
    const kinds: FillKind[] = intensity > 0.6 ? ['toms', 'snare', 'build'] : ['snare', 'toms', 'kick'];
    for (let b = fillEvery - 1, k = 0; b < bars; b += fillEvery, k++) {
      const kind = b === bars - 1 && bars >= 8 && intensity > 0.6 ? 'build' : kinds[k % kinds.length];
      out = fillBar(out, b, kind, bars, newId, true);
    }
  }
  return out.sort((a, b) => a.startOffset - b.startOffset);
}
