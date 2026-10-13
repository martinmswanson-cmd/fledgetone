import type { InstrumentKey, NoteEvent } from './timelineTypes';
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
  /**
   * A chord from outside the key (a borrowed or chromatic one): its root `semis` semitones above
   * the key's tonic, of `quality`, in place of the degree's own chord.
   */
  semis?: number;
  quality?: ChordQuality;
}

/** Chord qualities by intervals over the root (the 7th ones always have their 7th). */
export const CHORD_QUALITIES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  dom7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  min6: [0, 3, 7, 9],
  mMaj7: [0, 3, 7, 11],
  dim7: [0, 3, 6, 9],
} as const;
export type ChordQuality = keyof typeof CHORD_QUALITIES;

/** The pitch classes of a degree's chord, root first (a triad, or with `seventh` a 7th chord). */
export function degreeChord(key: SongKey, d: Degree, seventh = false): number[] {
  if (d.semis !== undefined && d.quality) {
    const root = pc(key.root + d.semis);
    const out = CHORD_QUALITIES[d.quality].map((i) => pc(root + i));
    if (seventh && out.length === 3) {
      // A borrowed major chord on a step or a 4th below home leans like a dominant (♭VII7, II7)
      if (d.quality === 'maj') out.push(pc(root + (d.semis === 10 || d.semis === 2 || d.semis === 7 ? 10 : 11)));
      else if (d.quality === 'min') out.push(pc(root + 10));
      else if (d.quality === 'dim') out.push(pc(root + 10));
    }
    return out;
  }
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
    if (minor) return `${root}${sev === 11 ? 'm(maj7)' : sev === 9 ? 'm6' : 'm7'}`;
    return `${root}${sev === 11 ? 'maj7' : '7'}`;
  }
  return `${root}${dim ? 'dim' : minor ? 'm' : iv.includes(8) && iv.includes(4) ? '+' : ''}`;
}

export interface Progression {
  id: string;
  name: string;
  mode: 'major' | 'minor';
  chords: Degree[];
}

const D = (degree: number, major?: boolean): Degree => (major ? { degree, major } : { degree });
/** A chord from outside the key: `semis` above the tonic, of `quality`. */
const X = (semis: number, quality: ChordQuality): Degree => ({ degree: 0, semis, quality });

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
  // Borrowed and chromatic chords: the colours game and film music lean on
  { id: 'levelClear', name: '♭VI – ♭VII – I – I (level clear, victory)', mode: 'major', chords: [X(8, 'maj'), X(10, 'maj'), D(0), D(0)] },
  { id: 'openField', name: 'I – ♭VII – IV – I (open field, folk)', mode: 'major', chords: [D(0), X(10, 'maj'), D(3), D(0)] },
  { id: 'wonder', name: 'I – ♭VI – I – ♭VI (wonder, reveal)', mode: 'major', chords: [D(0), X(8, 'maj'), D(0), X(8, 'maj')] },
  { id: 'journey', name: "I – III – IV – I (hero's journey)", mode: 'major', chords: [D(0), X(4, 'maj'), D(3), D(0)] },
  { id: 'lydian', name: 'I – II – I – II (magic, floating)', mode: 'major', chords: [D(0), X(2, 'maj'), D(0), X(2, 'maj')] },
  { id: 'ache', name: 'I – IV – iv – I (wistful ache)', mode: 'major', chords: [D(0), D(3), X(5, 'min'), D(0)] },
  { id: 'calmVamp', name: 'Imaj7 – IVmaj7 (calm vamp, menus)', mode: 'major', chords: [X(0, 'maj7'), X(5, 'maj7'), X(0, 'maj7'), X(5, 'maj7')] },
  { id: 'march', name: 'I – IV – ♭VII – I (rousing march)', mode: 'major', chords: [D(0), D(3), X(10, 'maj'), D(0)] },
  { id: 'ancient', name: 'i – IV – i – IV (ancient, folk)', mode: 'minor', chords: [D(0), X(5, 'maj'), D(0), X(5, 'maj')] },
  { id: 'menace', name: 'i – ♭II – i – ♭II (menace)', mode: 'minor', chords: [D(0), X(1, 'maj'), D(0), X(1, 'maj')] },
  { id: 'castle', name: 'i – V – VI – V (castle, gothic)', mode: 'minor', chords: [D(0), D(4, true), D(5), D(4, true)] },
  { id: 'tragic', name: 'i – ♭vi – i – ♭vi (tragic grandeur)', mode: 'minor', chords: [D(0), X(8, 'min'), D(0), X(8, 'min')] },
  { id: 'shock', name: 'i – ♯iii – i – ♯iii (sudden shock)', mode: 'minor', chords: [D(0), X(4, 'min'), D(0), X(4, 'min')] },
  { id: 'cliche', name: 'i – i(maj7) – i7 – i6 (noir, melancholy)', mode: 'minor', chords: [X(0, 'min'), X(0, 'mMaj7'), X(0, 'min7'), X(0, 'min6')] },
  { id: 'triumph', name: 'i – ♭VI – ♭VII – I (triumph after struggle)', mode: 'minor', chords: [D(0), D(5), D(6), D(0, true)] },
  { id: 'picardy', name: 'i – iv – V – I (dark to light)', mode: 'minor', chords: [D(0), D(3), D(4, true), D(0, true)] },
  { id: 'dread', name: 'vii°7 – V7 – vii°7 – V7 (dread, horror)', mode: 'minor', chords: [X(11, 'dim7'), X(7, 'dom7'), X(11, 'dim7'), X(7, 'dom7')] },
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

// ---------- Accompaniment under chords ----------

/** A chord of a chord part and how long it lasts: its pitch classes, root first. */
export interface ChordChange {
  at: number;
  end: number;
  root: number;
  pcs: number[];
}

/** The chords of a chord part (where notes start together), one per change of root. */
export function chordChanges(chordNotes: readonly NoteEvent[], lengthBars: number): ChordChange[] {
  const groups = new Map<number, number[]>();
  for (const n of chordNotes) {
    if (n.startOffset < -EPS || n.startOffset >= lengthBars - EPS) continue;
    const m = midiOf(n.note);
    if (!Number.isFinite(m)) continue;
    const at = Math.round(n.startOffset * 192) / 192;
    groups.set(at, [...(groups.get(at) ?? []), m]);
  }
  const out: ChordChange[] = [];
  for (const at of [...groups.keys()].sort((a, b) => a - b)) {
    const midis = groups.get(at)!;
    const root = chordRoot(midis);
    if (out.length && out[out.length - 1].root === root) continue;
    const pcs = [...new Set(midis.map(pc))].sort((a, b) => pc(a - root) - pc(b - root));
    out.push({ at, end: lengthBars, root, pcs });
  }
  out.forEach((c, i) => (c.end = out[i + 1]?.at ?? lengthBars));
  return out;
}

/** The chord's pitch classes stacked upward in close position from the first at or above `low`. */
function stack(pcs: readonly number[], low: number): number[] {
  const out: number[] = [];
  let m = low + pc(pcs[0] - low);
  for (const p of pcs) {
    while (pc(m) !== p) m++;
    out.push(m);
    m++;
  }
  return out;
}

export type AccompStyle = 'walking' | 'waltz' | 'alberti' | 'strum' | 'gliss' | 'ostinato' | 'sparkle' | 'fanfare' | 'drone';
/** The accompaniments, each with the instrument it suits (the new track's, unless another is picked). */
export const ACCOMP_STYLES: ReadonlyArray<{ id: AccompStyle; name: string; detail: string; instrument: InstrumentKey; track: string }> = [
  { id: 'walking', name: 'Walking bass', detail: 'Quarter notes up the chord, a half step into the next one: jazz, shops, cities', instrument: 'realUprightBass', track: 'Walking bass' },
  { id: 'waltz', name: 'Oom-pah-pah', detail: 'The root low on the beat, the chord on the others (3/4 waltz, 4/4 oom-pah, 6/8 lilt)', instrument: 'realGrandPiano', track: 'Oom-pah' },
  { id: 'alberti', name: 'Alberti bass', detail: 'Low, high, middle, high in 8ths: classical, music boxes, calm towns', instrument: 'realGrandPiano', track: 'Alberti bass' },
  { id: 'strum', name: 'Strummed guitar', detail: 'Down, down-up, up, down-up: campfires, villages, travel', instrument: 'guitar', track: 'Strums' },
  { id: 'gliss', name: 'Harp glissando', detail: 'A sweep up the chord on each change: wonder, magic, reveals', instrument: 'realHarp', track: 'Harp sweeps' },
  { id: 'ostinato', name: 'String ostinato (3+3+2)', detail: 'Driving 16ths on root and fifth, accented 3+3+2: battles, chases', instrument: 'realViolinsShort', track: 'Ostinato' },
  { id: 'sparkle', name: 'Sparkle', detail: 'A few high chord notes here and there: stars, ice, fairy lights', instrument: 'celesta', track: 'Sparkle' },
  { id: 'fanfare', name: 'Horn fanfare', detail: 'A triplet pickup, then up the chord to the octave: heroes, titles, victories', instrument: 'realHorn', track: 'Fanfare' },
  { id: 'drone', name: 'Drone', detail: 'The first chord\'s root and fifth held under everything: folk, deserts, ancient places', instrument: 'slowStrings', track: 'Drone' },
];

/**
 * An accompaniment for a chord part (see ACCOMP_STYLES): notes from the clip's start, written in
 * `meter` (a waltz measure is 3/4 of a bar). `seed` varies the ones with a little chance in them.
 */
export function accompany(chordNotes: readonly NoteEvent[], lengthBars: number, style: AccompStyle, newId: () => string, meter: { num: number; den: number } = { num: 4, den: 4 }, seed = 1): NoteEvent[] {
  const changes = chordChanges(chordNotes, lengthBars);
  if (!changes.length) return [];
  const rnd = seeded(seed);
  const measure = meter.num / meter.den;
  const posIn = (t: number) => ((t % measure) + measure) % measure;
  const out: NoteEvent[] = [];
  const add = (m: number, at: number, bars: number, vel: number) => {
    if (at < -EPS || at >= lengthBars - EPS) return;
    out.push(note(newId, m, at, Math.max(1 / 64, Math.min(bars, lengthBars - at)), Math.max(0.1, Math.min(1, vel))));
  };
  const grid = (c: ChordChange, step: number, fn: (t: number, k: number) => void) => {
    for (let t = c.at, k = 0; t < c.end - EPS; t += step, k++) fn(t, k);
  };
  changes.forEach((c, i) => {
    const next = changes[i + 1];
    const span = c.end - c.at;
    switch (style) {
      case 'walking': {
        const tones = [...stack(c.pcs.slice(0, 3), 36), 36 + pc(c.root - 36) + 12];
        grid(c, 0.25, (t, k) => {
          const last = t + 0.25 >= c.end - EPS && next;
          // The last beat leads a half step into the next root
          const m = last ? 36 + pc(next.root - 36) - 1 : tones[k % tones.length];
          add(m, t, 0.23, k % 2 ? 0.66 : 0.78);
        });
        break;
      }
      case 'waltz': {
        // Strong beats: the measure's start (and its middle in 4/4, each dotted quarter in 6/8)
        const strongEvery = meter.den === 8 ? 3 / 8 : meter.num % 3 === 0 ? measure : 0.5;
        const unit = meter.den === 8 ? 1 / 8 : 1 / 4;
        const bass = 40 + pc(c.root - 40);
        const chord = stack(c.pcs.slice(0, 3), 55);
        grid(c, unit, (t) => {
          const strong = Math.abs(posIn(t) % strongEvery) < EPS || Math.abs((posIn(t) % strongEvery) - strongEvery) < EPS;
          if (strong) add(bass, t, unit * 0.95, 0.72);
          else for (const m of chord) add(m, t, unit * 0.6, 0.5);
        });
        break;
      }
      case 'alberti': {
        const [lo, mid, hi] = stack(c.pcs.slice(0, 3), 48);
        grid(c, 1 / 8, (t, k) => add([lo, hi, mid, hi][k % 4], t, 1 / 8, k % 4 === 0 ? 0.62 : 0.48));
        break;
      }
      case 'strum': {
        const strings = [...stack(c.pcs.slice(0, 3), 52), 52 + pc(c.root - 52) + 12].sort((a, b) => a - b);
        const PATTERN = ['D', '', 'D', 'U', '', 'U', 'D', 'U'];
        grid(c, 1 / 8, (t) => {
          const kind = PATTERN[Math.round(posIn(t) * 8) % 8];
          if (!kind) return;
          const order = kind === 'D' ? strings : [...strings].reverse().slice(0, 3);
          order.forEach((m, j) => add(m, t + j / 192, 1 / 8, kind === 'D' ? 0.62 - j * 0.03 : 0.42));
        });
        break;
      }
      case 'gliss': {
        const run: number[] = [];
        for (let m = 43; run.length < 12; m++) if (c.pcs.includes(pc(m))) run.push(m);
        run.forEach((m, j) => add(m, c.at + j / 32, j === run.length - 1 ? Math.max(1 / 8, span - j / 32) : 1 / 4, 0.35 + (0.35 * j) / run.length));
        break;
      }
      case 'ostinato': {
        const r = 48 + pc(c.root - 48);
        const fifth = c.pcs.find((p) => pc(p - c.root) === 7) ?? pc(c.root + 7);
        const tones = [r, r + pc(fifth - c.root), r + 12];
        grid(c, 1 / 16, (t) => {
          const g = Math.round(posIn(t) * 16) % 8;
          add(tones[[0, 1, 2, 0, 1, 2, 0, 1][g]], t, 1 / 16, [0, 3, 6].includes(g) ? 0.78 : 0.5);
        });
        break;
      }
      case 'sparkle': {
        const tones = [...stack(c.pcs.slice(0, 3), 79), ...stack(c.pcs.slice(0, 3), 91)];
        grid(c, 1 / 8, (t) => {
          if (rnd() < 0.3) add(tones[Math.floor(rnd() * tones.length)], t, 1 / 16, 0.35 + rnd() * 0.15);
        });
        break;
      }
      case 'fanfare': {
        const [r, third, fifth] = stack(c.pcs.slice(0, 3), 53);
        // The next chord's pickup takes the last beat
        const until = next && span >= 0.75 ? c.end - 0.25 : c.end;
        add(r, c.at, 0.25, 0.8);
        if (until - c.at >= 0.5) {
          add(third, c.at + 0.25, 1 / 8, 0.7);
          add(fifth, c.at + 0.375, 1 / 8, 0.72);
          add(r + 12, c.at + 0.5, until - c.at - 0.5, 0.82);
        }
        if (next && span >= 0.75) {
          const nr = 53 + pc(next.root - 53);
          for (let j = 0; j < 3; j++) add(nr, until + j / 12, 1 / 12, 0.6 + j * 0.05);
        }
        break;
      }
      case 'drone':
        break;
    }
  });
  if (style === 'drone') {
    const r = 36 + pc(changes[0].root - 36);
    for (let t = 0; t < lengthBars - EPS; t += 2) {
      add(r, t, 2, 0.5);
      add(r + 7, t, 2, 0.42);
    }
  }
  return out.sort((a, b) => a.startOffset - b.startOffset);
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
const COWBELL = 'G#2';

export type DrumStyle =
  | 'house' | 'rock' | 'hiphop' | 'trap' | 'dnb' | 'funk' | 'dembow' | 'halftime'
  | 'waltz' | 'jig' | 'march' | 'shuffle' | 'swing' | 'bossa' | 'calypso' | 'maqsum' | 'battle' | 'tribal' | 'blast' | 'heartbeat';
/**
 * The drummer's styles. A style with a `meter` is written in it (a waltz in 3/4, a jig in 6/8);
 * the others follow the song's time signature. A style with a `groove` gives its clip that swing.
 */
export const DRUM_STYLES: ReadonlyArray<{ id: DrumStyle; name: string; bpm: string; meter?: { num: number; den: number }; groove?: { swing: number; grid: 8 | 16 } }> = [
  { id: 'house', name: 'Four on the floor (house, disco, techno)', bpm: '118–130' },
  { id: 'rock', name: 'Backbeat (rock, pop)', bpm: '90–140' },
  { id: 'hiphop', name: 'Boom bap (hip-hop)', bpm: '85–98' },
  { id: 'trap', name: 'Trap (half time, hat rolls)', bpm: '130–150' },
  { id: 'dnb', name: 'Two-step (drum & bass)', bpm: '170–176' },
  { id: 'funk', name: 'Funk (ghost notes)', bpm: '95–115' },
  { id: 'dembow', name: 'Dembow (reggaeton)', bpm: '88–100' },
  { id: 'halftime', name: 'Half time (ballad, cinematic)', bpm: '60–90' },
  { id: 'waltz', name: 'Waltz in 3/4 (underwater, town, love theme)', bpm: '80–180', meter: { num: 3, den: 4 } },
  { id: 'jig', name: 'Jig in 6/8 (folk, island, tavern, pirate)', bpm: '100–127', meter: { num: 6, den: 8 } },
  { id: 'march', name: 'March (snare cadence: heroic, title, military)', bpm: '100–130' },
  { id: 'shuffle', name: 'Shuffle (swung 8ths: kart, cozy, shop)', bpm: '90–150', groove: { swing: 0.5, grid: 8 } },
  { id: 'swing', name: 'Big-band swing (ride, city, menus)', bpm: '120–220', groove: { swing: 0.5, grid: 8 } },
  { id: 'bossa', name: 'Bossa nova (shop, lounge, menu)', bpm: '120–140' },
  { id: 'calypso', name: 'Calypso (sunny platformer, beach)', bpm: '90–100 (per half note)' },
  { id: 'maqsum', name: 'Maqsum (desert hand drums)', bpm: '100–130' },
  { id: 'battle', name: 'Battle ostinato (taiko 8ths, 3+3+2 accents)', bpm: '130–170' },
  { id: 'tribal', name: 'Tribal build (toms, sparse to dense)', bpm: '90–130' },
  { id: 'blast', name: 'Blast beat (metal, top combat)', bpm: '180–240' },
  { id: 'heartbeat', name: 'Heartbeat (horror, no kit)', bpm: '60–80' },
];

/**
 * One measure of a style at an intensity (0 sparse to 1 busy), as [step of 16th, drum, velocity],
 * for a measure `steps` 16ths long (16 in 4/4, 12 in 3/4 or 6/8). `progress` is how far through the
 * part this measure is (0 to 1), for the styles that grow.
 */
function styleBar(style: DrumStyle, intensity: number, bar: number, rnd: () => number, steps = 16, progress = 0): Array<[number, string, number]> {
  const hits: Array<[number, string, number]> = [];
  const add = (at: number[], drum: string, vel: number) => at.forEach((s) => s < steps && hits.push([s, drum, vel]));
  const busy = intensity > 0.66;
  const mid = intensity > 0.33;
  const every = (n: number, from = 0) => Array.from({ length: Math.ceil((steps - from) / n) }, (_, i) => from + i * n).filter((x) => x < steps);
  const eighths = every(2);
  const sixteenths = every(1);
  const beats = every(4);
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
    case 'waltz':
      // Boom on one, light taps on two and three (oom-pah-pah)
      add([0], KICK, 0.85);
      add(beats.slice(1), SNARE, mid ? 0.42 : 0.3);
      add(mid ? eighths : beats, busy ? HAT : RIDE, busy ? 0.4 : 0.32);
      if (busy) add([steps - 2], KICK, 0.55);
      break;
    case 'jig': {
      // Groups of three 8ths: a hand drum on each, accented on the beat (a dotted quarter)
      const group = 6;
      for (const s of eighths) hits.push([s, TOM_LO, s % group === 0 ? 0.82 : 0.48]);
      add(every(group), KICK, mid ? 0.7 : 0.55);
      if (mid) add(every(group, 4), TOM_MID, 0.45);
      if (busy) add(eighths.filter((s) => s % group === 2), HAT, 0.4);
      break;
    }
    case 'march':
      add(every(8), KICK, 0.88);
      // The snare cadence: accents on two and four, a flam-like double before them, rolls when busy
      add(every(8, 4), SNARE, 0.9);
      add(every(8, 3), SNARE, 0.35);
      add(eighths.filter((s) => s % 4 === 2), SNARE, mid ? 0.48 : 0.38);
      if (mid) add(every(8, 7), SNARE, 0.4);
      if (busy) add(sixteenths.filter((s) => s >= steps - 4), SNARE, 0.55);
      if (bar % 4 === 0) add([0], CRASH, 0.6);
      break;
    case 'shuffle':
      // Written straight; the clip's 8th swing makes the lilt
      add([0, 8], KICK, 0.92);
      if (mid) add([10], KICK, 0.7);
      add(every(8, 4), SNARE, 0.88);
      add(eighths, HAT, 0.5);
      if (busy) add([14], OPEN, 0.5);
      break;
    case 'swing':
      // Ride "ding, ding-a ding", the hat foot on two and four, a feathered kick on every beat
      add(beats, RIDE, 0.62);
      add(every(8, 6), RIDE, 0.45);
      add(every(8, 4), HAT, 0.5);
      add(beats, KICK, 0.28);
      if (mid && rnd() < 0.6) add([6 + 8 * Math.floor(rnd() * 2)], SNARE, 0.3);
      if (busy) add([14], SNARE, 0.42);
      break;
    case 'bossa':
      // Rim on the 3-2 clave, the kick's dotted bounce, shaker 16ths
      add(bar % 2 ? [4, 8] : [0, 6, 12], SNARE, 0.32);
      add([0, 6, 8, 14], KICK, 0.7);
      add(mid ? sixteenths : eighths, HAT, mid ? 0.3 : 0.38);
      break;
    case 'calypso':
      // Kick on one with anticipations, cowbell 8ths, a light backbeat
      add([0, 6, 8, 14], KICK, 0.85);
      add(eighths, COWBELL, mid ? 0.42 : 0.32);
      add([4, 12], SNARE, 0.6);
      if (busy) add(sixteenths.filter((s) => s % 2), HAT, 0.3);
      break;
    case 'maqsum':
      // Dum tek - tek dum - tek -: low (dum) and high (tek) hand drums
      add([0, 8], TOM_LO, 0.9);
      add([2, 6, 12], TOM_HI, 0.7);
      if (mid) add([0, 8], KICK, 0.6);
      if (mid) add([5, 13, 15], TOM_HI, 0.35);
      if (busy) add([10, 14], TOM_HI, 0.45);
      break;
    case 'battle':
      // Taiko 8ths with 3+3+2 accents (16ths), the low drum on the downbeats
      for (const s of eighths) hits.push([s, TOM_LO, [0, 6, 12].includes(s % 16) ? 0.95 : 0.5]);
      add(every(8), KICK, 0.9);
      if (mid) add([6, 12], TOM_MID, 0.7);
      if (busy) add(sixteenths.filter((s) => s % 2), TOM_HI, 0.38);
      if (busy && bar % 2 === 1) add([0], CRASH, 0.55);
      break;
    case 'tribal': {
      // Low toms that fill in as the part goes on (and with energy)
      const fill = Math.min(1, 0.2 + progress * 0.7 + intensity * 0.3);
      add(beats, TOM_LO, 0.85);
      if (fill > 0.4) add(eighths.filter((s) => s % 4), TOM_LO, 0.55);
      if (fill > 0.6) add(eighths.filter((s) => s % 4), TOM_MID, 0.5);
      if (fill > 0.8) add(sixteenths.filter((s) => s % 2), TOM_HI, 0.42);
      if (fill > 0.5) add([0], KICK, 0.8);
      break;
    }
    case 'blast':
      if (busy) {
        add(sixteenths.filter((s) => s % 2 === 0), KICK, 0.9);
        add(sixteenths.filter((s) => s % 2 === 1), SNARE, 0.82);
      } else {
        add(eighths, KICK, 0.9);
        add(mid ? eighths.map((s) => s + 1) : every(4, 2), SNARE, 0.85);
      }
      add(beats, CRASH, 0.5);
      break;
    case 'heartbeat': {
      // Lub-dub, faster with energy: once a measure, then every half, then every beat
      const gap = busy ? 4 : mid ? 8 : 16;
      for (const s of every(gap)) {
        hits.push([s, KICK, 0.88]);
        if (s + 1 < steps) hits.push([s + 1, KICK, 0.55]);
      }
      break;
    }
  }
  return hits;
}

const QUIET_STYLES = new Set<DrumStyle>(['heartbeat', 'bossa', 'swing', 'waltz']);

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
export function fillBar(notes: readonly NoteEvent[], barStart: number, kind: FillKind, clipBars: number, newId: () => string, crash = true, measure = 1): NoteEvent[] {
  const beats = FILLS.find((f) => f.id === kind)!.beats;
  const from = barStart + measure - Math.min(beats / 4, measure);
  const to = barStart + measure;
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
export function drummer(style: DrumStyle, bars: number, intensity: number, fillEvery: number, seed: number, newId: () => string, meter: { num: number; den: number } = { num: 4, den: 4 }): NoteEvent[] {
  const rnd = seeded(seed);
  // `bars` measures of the meter (a 3/4 measure is 3/4 of a 4/4 bar long)
  const measure = meter.num / meter.den;
  const steps = Math.max(1, Math.round(measure * 16));
  let out: NoteEvent[] = [];
  for (let b = 0; b < bars; b++) {
    for (const [step, drum, vel] of styleBar(style, intensity, b, rnd, steps, bars > 1 ? b / (bars - 1) : 1)) {
      // Hats lean on the beat, and every hit varies a little
      const accent = drum === HAT && step % 4 === 0 ? 0.12 : 0;
      out.push(note(newId, midiOf(drum), b * measure + step / 16, drum === OPEN ? 1 / 8 : 1 / 16, Math.max(0.15, Math.min(1, vel + accent + (rnd() - 0.5) * 0.12))));
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
  // The quiet styles open without a crash and play through without fills
  const quiet = QUIET_STYLES.has(style);
  if (bars > 0 && !quiet) out.push(note(newId, midiOf(CRASH), 0, 0.5, 0.8));
  if (fillEvery > 0 && !quiet) {
    const kinds: FillKind[] = intensity > 0.6 ? ['toms', 'snare', 'build'] : ['snare', 'toms', 'kick'];
    for (let b = fillEvery - 1, k = 0; b < bars; b += fillEvery, k++) {
      const kind = b === bars - 1 && bars >= 8 && intensity > 0.6 ? 'build' : kinds[k % kinds.length];
      out = fillBar(out, b * measure, kind, bars * measure, newId, true, measure);
    }
  }
  return out.sort((a, b) => a.startOffset - b.startOffset);
}
