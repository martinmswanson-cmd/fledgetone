import type { ClipGlide, InstrumentKey, NoteEvent, NoteExpression, Track } from './timelineTypes';
import { durationToBars } from './timelineTypes';
import { isExpressive } from './noteExpression';
import { isConditional } from './noteChance';
import { midiOf } from './noteTools';
import { barToSeconds, tempoAt, type Tempo } from '../audio/tempoMap';

/**
 * Glide between chords: a clip setting (Clip.glide) under which each note of a chord slides into
 * its note in the next chord, the bass on its own, as separate voices moving. Nothing is written
 * into the notes: the pairs are found when the clip plays (the scheduler, live and in every
 * export, the same), and the piano roll draws them from the same function. Pure, unit tested
 * (scripts/chordGlide.test.mjs).
 *
 * Pairs: where notes end and others start at the same place, the notes ending are paired with
 * those starting so the voices move the least in all (a voice moves to the nearest free note,
 * never crossing another), no further than GLIDE_MAX_SEMIS; the lowest note of each side, when
 * it sits a fifth or more below the next, is the bass and pairs only with the other side's bass.
 * A note with a bend or pressure of its own, or one that plays only some of the time, is never
 * paired; a note left over (the chords have different sizes) starts or ends as written; a note
 * held over the place (a pedal) is left alone. Pairs follow on: a voice can glide through a whole
 * progression, as one held note.
 */

export type { ClipGlide };

export const GLIDE_MS_MIN = 30;
export const GLIDE_MS_MAX = 400;
export const GLIDE_MS_DEFAULT = 120;
/** The furthest a voice glides (semitones): a bigger leap starts the note afresh. */
export const GLIDE_MAX_SEMIS = 7;
/** A bass sits at least this far (semitones) below the next note up. */
const BASS_GAP = 7;
/** Notes meet when one ends within this of the other's start (bars: half a tick). */
const JOIN_BINS = 1536;
/** Points per glide's eased curve */
const CURVE_POINTS = 12;
/** A change of level (a softer or louder chord) moves over the glide, and never quicker than this (seconds). */
const LEVEL_SETTLE = 0.02;
/** A glide takes at most this share of the note it glides into. */
const GLIDE_SHARE = 0.5;

const clampMs = (ms: number) => Math.round(Math.max(GLIDE_MS_MIN, Math.min(GLIDE_MS_MAX, ms)));

/** A clip's glide as a file or a link gives it (undefined: off, or not readable). */
export function normalizeClipGlide(raw: unknown): ClipGlide | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { ms, bassMs } = raw as { ms?: unknown; bassMs?: unknown };
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return undefined;
  const out: ClipGlide = { ms: clampMs(ms) };
  if (typeof bassMs === 'number' && Number.isFinite(bassMs) && clampMs(bassMs) !== out.ms) out.bassMs = clampMs(bassMs);
  return out;
}

/** The instruments whose voices glide on their own (the chord synths built on a pool of voices). */
const GLIDING: ReadonlySet<InstrumentKey> = new Set<InstrumentKey>(['wavetable', 'keys', 'brass'] as InstrumentKey[]);

/** Whether `track`'s instrument glides between chords (the others play the chords as written). */
export const chordGlideSupport = (track: Pick<Track, 'instrumentKey'>): boolean => GLIDING.has(track.instrumentKey);

/** One voice gliding from `from` into `to`, where `to` starts (`at`, bars into the clip). */
export interface GlidePair {
  from: NoteEvent;
  to: NoteEvent;
  /** The bass's (its own glide time) */
  bass: boolean;
  at: number;
}

/** A note that can glide: one plain note inside the clip (no bend or pressure of its own, always plays). */
function glides(n: NoteEvent, clipLength: number): boolean {
  if (!(n.startOffset >= -1e-6 && n.startOffset < clipLength - 1e-6)) return false;
  if (isConditional(n) || isExpressive(n.expr, durationToBars(n.duration))) return false;
  return Number.isFinite(midiOf(n.note));
}

interface Side {
  note: NoteEvent;
  midi: number;
}

/** The side's notes low to high, and its bass apart (the lowest, a fifth or more under the next). */
function splitBass(side: Side[]): { bass: Side | null; upper: Side[] } {
  const sorted = [...side].sort((a, b) => a.midi - b.midi);
  if (sorted.length >= 2 && sorted[1].midi - sorted[0].midi >= BASS_GAP) return { bass: sorted[0], upper: sorted.slice(1) };
  return { bass: null, upper: sorted };
}

/**
 * The pairs between two sides, both low to high: the most voices gliding, then the least movement
 * in all, no voice moving further than GLIDE_MAX_SEMIS. (On a line the least movement never
 * crosses two voices, so going through both in order finds it.)
 */
function matchSides(a: Side[], b: Side[]): Array<[Side, Side]> {
  const m = a.length;
  const n = b.length;
  // best[i][j]: the most pairs and least movement among a's first i and b's first j
  const count: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  const cost: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  const how: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  const better = (c1: number, k1: number, c2: number, k2: number) => c1 > c2 || (c1 === c2 && k1 < k2 - 1e-9);
  for (let i = 0; i <= m; i++)
    for (let j = 0; j <= n; j++) {
      if (!i && !j) continue;
      let c = -1;
      let k = Infinity;
      let h = 0;
      if (i && j) {
        const d = Math.abs(a[i - 1].midi - b[j - 1].midi);
        if (d <= GLIDE_MAX_SEMIS) {
          c = count[i - 1][j - 1] + 1;
          k = cost[i - 1][j - 1] + d;
          h = 1;
        }
      }
      if (i && better(count[i - 1][j], cost[i - 1][j], c, k)) {
        c = count[i - 1][j];
        k = cost[i - 1][j];
        h = 2;
      }
      if (j && better(count[i][j - 1], cost[i][j - 1], c, k)) {
        c = count[i][j - 1];
        k = cost[i][j - 1];
        h = 3;
      }
      count[i][j] = c;
      cost[i][j] = k;
      how[i][j] = h;
    }
  const out: Array<[Side, Side]> = [];
  for (let i = m, j = n; i > 0 || j > 0; ) {
    const h = how[i][j];
    if (h === 1) out.push([a[--i], b[--j]]);
    else if (h === 2) i--;
    else j--;
  }
  return out.reverse();
}

/** Every voice that glides in a clip's notes (see the top of this file), in order of place, then low to high. */
export function glidePairs(notes: readonly NoteEvent[], clipLength: number): GlidePair[] {
  const ends = new Map<number, Side[]>();
  const starts = new Map<number, Side[]>();
  for (const n of notes) {
    if (!glides(n, clipLength)) continue;
    const s = { note: n, midi: midiOf(n.note) };
    const end = Math.round((n.startOffset + durationToBars(n.duration)) * JOIN_BINS);
    const start = Math.round(n.startOffset * JOIN_BINS);
    (ends.get(end) ?? ends.set(end, []).get(end)!).push(s);
    (starts.get(start) ?? starts.set(start, []).get(start)!).push(s);
  }
  const out: GlidePair[] = [];
  for (const key of [...starts.keys()].sort((x, y) => x - y)) {
    const a = ends.get(key);
    const b = starts.get(key)!;
    if (!a) continue;
    const at = Math.min(...b.map((s) => s.note.startOffset));
    const sa = splitBass(a);
    const sb = splitBass(b);
    const pairs: GlidePair[] = [];
    if (sa.bass && sb.bass) {
      if (Math.abs(sa.bass.midi - sb.bass.midi) <= GLIDE_MAX_SEMIS) pairs.push({ from: sa.bass.note, to: sb.bass.note, bass: true, at });
      for (const [x, y] of matchSides(sa.upper, sb.upper)) pairs.push({ from: x.note, to: y.note, bass: false, at });
    } else {
      const all = (s: { bass: Side | null; upper: Side[] }) => (s.bass ? [s.bass, ...s.upper] : s.upper);
      for (const [x, y] of matchSides(all(sa), all(sb))) pairs.push({ from: x.note, to: y.note, bass: false, at });
    }
    out.push(...pairs.sort((p, q) => midiOf(p.to.note) - midiOf(q.to.note)));
  }
  return out;
}

/** One voice through two or more notes: `bass[i]` says whether the glide from notes[i] to notes[i + 1] is the bass's. */
export interface GlideChain {
  notes: NoteEvent[];
  bass: boolean[];
}

/** The pairs (glidePairs) joined into voices, each from its first note to its last, in order of place. */
export function glideChains(notes: readonly NoteEvent[], clipLength: number): GlideChain[] {
  const pairs = glidePairs(notes, clipLength);
  const next = new Map<NoteEvent, GlidePair>();
  const into = new Set<NoteEvent>();
  for (const p of pairs) {
    next.set(p.from, p);
    into.add(p.to);
  }
  const out: GlideChain[] = [];
  for (const p of pairs) {
    if (into.has(p.from)) continue;
    const chain: GlideChain = { notes: [p.from], bass: [] };
    for (let q: GlidePair | undefined = p; q; q = next.get(q.to)) {
      chain.notes.push(q.to);
      chain.bass.push(q.bass);
    }
    out.push(chain);
  }
  return out.sort((x, y) => x.notes[0].startOffset - y.notes[0].startOffset || midiOf(x.notes[0].note) - midiOf(y.notes[0].note));
}

/** A voice as it sounds (see chainSound): one held note, its glides as its own bend, a softer or louder chord as its pressure. */
export interface ChainSound {
  /** Where it starts in the clip (bars), its first note's place */
  startOffset: number;
  /** Its length, from its first note's start to its last one's end */
  duration: string;
  /** Its level (its loudest note's): its pressure follows each note's */
  velocity: number;
  expr?: NoteExpression;
  /**
   * Seconds per bar its length and its curves are counted in (the tempo where it starts): a
   * glide's time and each note's place in seconds along the song's tempo, whatever the tempo does
   */
  spb: number;
}

const TICKS_PER_BAR = 768;
const ease = (u: number) => u * u * (3 - 2 * u);

/**
 * The voice `chain` from its note `from` on (0: the whole of it; later, should playback begin
 * part way), in a clip starting at `clipStart` (song bar) of a song at `tempo`, each glide `glide`
 * long (the bass's its own) and eased, from where the next note starts. `velocity` (default: each
 * note's own) is how loud each note plays (the chord it was struck with, see the scheduler).
 */
export function chainSound(chain: GlideChain, from: number, glide: ClipGlide, clipStart: number, tempo: Tempo, velocity: (n: NoteEvent) => number = (n) => n.velocity): ChainSound {
  const notes = chain.notes.slice(from);
  const first = notes[0];
  const last = notes[notes.length - 1];
  const bar = (n: NoteEvent) => clipStart + n.startOffset;
  const t0 = barToSeconds(bar(first), tempo);
  const spb = 240 / tempoAt(bar(first), tempo);
  const lengthOf = (n: NoteEvent) => (durationToBars(n.duration) * 240) / tempoAt(bar(n), tempo);
  const seconds = barToSeconds(bar(last), tempo) + lengthOf(last) - t0;
  const ref = midiOf(first.note);
  const vels = notes.map(velocity);
  const loudest = Math.max(...vels);
  const bend: Array<{ at: number; value: number }> = [{ at: 0, value: 0 }];
  const level = vels.map((v) => (loudest > 0 ? v / loudest : 1));
  const pressure: Array<{ at: number; value: number }> = [{ at: 0, value: level[0] }];
  for (let i = 1; i < notes.length; i++) {
    const at = barToSeconds(bar(notes[i]), tempo) - t0;
    const ms = chain.bass[from + i - 1] ? (glide.bassMs ?? glide.ms) : glide.ms;
    const g = Math.min(ms / 1000, GLIDE_SHARE * lengthOf(notes[i]));
    const s0 = midiOf(notes[i - 1].note) - ref;
    const s1 = midiOf(notes[i].note) - ref;
    if (s0 !== s1) {
      bend.push({ at: at / spb, value: s0 });
      for (let k = 1; k <= CURVE_POINTS; k++) bend.push({ at: (at + (g * k) / CURVE_POINTS) / spb, value: s0 + (s1 - s0) * ease(k / CURVE_POINTS) });
    }
    if (level[i] !== level[i - 1]) {
      const p = Math.max(g, LEVEL_SETTLE);
      pressure.push({ at: at / spb, value: level[i - 1] });
      for (let k = 1; k <= CURVE_POINTS; k++) pressure.push({ at: (at + (p * k) / CURVE_POINTS) / spb, value: level[i - 1] + (level[i] - level[i - 1]) * ease(k / CURVE_POINTS) });
    }
  }
  const expr: NoteExpression = {};
  if (bend.some((p) => p.value !== 0)) expr.bend = tidy(bend);
  if (pressure.some((p) => p.value !== 1)) expr.pressure = tidy(pressure);
  return {
    startOffset: first.startOffset,
    duration: `${Math.max(1, Math.round((seconds / spb) * TICKS_PER_BAR))}i`,
    velocity: loudest,
    ...(expr.bend || expr.pressure ? { expr } : {}),
    spb,
  };
}

/** Points in order, one per place (the later kept). */
function tidy(points: Array<{ at: number; value: number }>): Array<{ at: number; value: number }> {
  const out: Array<{ at: number; value: number }> = [];
  for (const p of points) {
    if (out.length && p.at - out[out.length - 1].at <= 1e-9) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/**
 * A clip's notes as they sound with `glide` on (for checks and the command line): each voice one
 * held note from its first note (chainSound), the notes they take in left out; the rest as written.
 */
export function chainNotes(notes: readonly NoteEvent[], clipLength: number, glide: ClipGlide, clipStart: number, tempo: Tempo): Array<NoteEvent | (ChainSound & { id: string; note: string })> {
  const chains = glideChains(notes, clipLength);
  const taken = new Set<NoteEvent>(chains.flatMap((c) => c.notes));
  return [...notes.filter((n) => !taken.has(n)), ...chains.map((c) => ({ id: c.notes[0].id, note: c.notes[0].note, ...chainSound(c, 0, glide, clipStart, tempo) }))].sort((a, b) => a.startOffset - b.startOffset);
}
