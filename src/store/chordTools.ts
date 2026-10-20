import type { NoteEvent } from './timelineTypes';
import { barsToDuration, durationToBars } from './timelineTypes';
import { midiOf, nameOf } from './noteTools';
import type { SongKey } from './songKey';
import { chordName, degreeChord, seeded, voiceLead } from './smartTools';

/**
 * The piano roll's chord and riff tools: chords by scale degree (I, ii, V… of the key, one click
 * each, voiced near the last), a fuller arpeggiator (more patterns, over one to three octaves,
 * shorter or longer notes) and a riff generator (a phrase in the key that follows the chords under
 * it). Plain maths, so Node can unit-test it.
 */

const pc = (m: number) => ((m % 12) + 12) % 12;
const EPS = 1e-6;
const round = (bars: number) => Math.round(bars * 192) / 192;

// ---------- chords by degree ----------

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** The key's seven chords as roman numerals: upper case major, lower case minor, ° diminished (I ii iii IV V vi vii° in major). */
export function degreeLabels(key: SongKey): string[] {
  return ROMAN.map((r, d) => {
    const [root, third, fifth] = degreeChord(key, { degree: d });
    const minor = pc(third - root) === 3;
    const dim = minor && pc(fifth - root) === 6;
    return dim ? `${r.toLowerCase()}°` : minor ? r.toLowerCase() : r;
  });
}

/** A degree's chord name in the key ("Am", "G7"…). */
export const degreeChordName = (key: SongKey, degree: number, seventh = false): string => chordName(degreeChord(key, { degree }, seventh));

/**
 * The notes of the key's chord on `degree` (0 = I), `lengthBars` long from `at`, voiced close to
 * `prev` (the last chord stamped, so a progression moves smoothly) around `center`.
 */
export function stampDegree(key: SongKey, degree: number, opts: { seventh?: boolean; at: number; lengthBars: number; prev: readonly number[] | null; center?: number; velocity?: number }, newId: () => string): { notes: NoteEvent[]; voiced: number[] } {
  const voiced = voiceLead(degreeChord(key, { degree }, opts.seventh), opts.prev, opts.center ?? 62);
  const notes = voiced.map((m) => ({ id: newId(), note: nameOf(m), startOffset: round(opts.at), duration: barsToDuration(opts.lengthBars), velocity: opts.velocity ?? 0.75 }));
  return { notes, voiced };
}

// ---------- arpeggiator ----------

export type ArpStyle = 'up' | 'down' | 'upDown' | 'downUp' | 'converge' | 'pinky' | 'thumb' | 'random';
export const ARP_STYLES: ReadonlyArray<{ id: ArpStyle; name: string }> = [
  { id: 'up', name: 'Up' },
  { id: 'down', name: 'Down' },
  { id: 'upDown', name: 'Up and down' },
  { id: 'downUp', name: 'Down and up' },
  { id: 'converge', name: 'Converge (outside in)' },
  { id: 'pinky', name: 'Pinky (top note between)' },
  { id: 'thumb', name: 'Thumb (bottom note between)' },
  { id: 'random', name: 'Random' },
];

export interface ArpOptions {
  style: ArpStyle;
  /** How often a note plays, in bars (1/16 = 16ths) */
  rateBars: number;
  /** Over how many octaves the chord climbs (1 to 3) */
  octaves: number;
  /** Each note's length as a share of the rate (0.25 staccato to 1 legato) */
  gate: number;
  seed?: number;
}

/** The order an arpeggio plays a chord's notes in (low to high `pitches`), one cycle. */
export function arpCycle(pitches: readonly number[], style: ArpStyle, octaves: number): number[] {
  const span: number[] = [];
  for (let o = 0; o < Math.max(1, Math.min(3, Math.round(octaves))); o++) for (const p of pitches) span.push(p + 12 * o);
  const up = [...new Set(span)].sort((a, b) => a - b);
  const down = [...up].reverse();
  switch (style) {
    case 'down':
      return down;
    case 'upDown':
      return up.length > 2 ? [...up, ...down.slice(1, -1)] : up;
    case 'downUp':
      return down.length > 2 ? [...down, ...up.slice(1, -1)] : down;
    case 'converge': {
      const out: number[] = [];
      for (let i = 0, j = up.length - 1; i <= j; i++, j--) out.push(up[i], ...(i === j ? [] : [up[j]]));
      return out;
    }
    case 'pinky':
      return up.length > 1 ? up.slice(0, -1).flatMap((p) => [p, up[up.length - 1]]) : up;
    case 'thumb':
      return up.length > 1 ? up.slice(1).flatMap((p) => [up[0], p]) : up;
    default:
      return up;
  }
}

/** Notes starting together (within a hair), in time order. */
function groups(notes: readonly NoteEvent[]): NoteEvent[][] {
  const sorted = [...notes].sort((a, b) => a.startOffset - b.startOffset);
  const out: NoteEvent[][] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0].startOffset - n.startOffset) < 1 / 192) last.push(n);
    else out.push([n]);
  }
  return out;
}

/** Each chord (notes starting together) as an arpeggio for as long as it lasted; single notes stay as they are. */
export function arpeggiateChords(notes: readonly NoteEvent[], opts: ArpOptions, newId: () => string): NoteEvent[] {
  const random = seeded(opts.seed ?? 1);
  const rate = Math.max(1 / 64, opts.rateBars);
  const gate = Math.max(0.1, Math.min(1, opts.gate));
  return groups(notes).flatMap((group) => {
    if (group.length < 2) return group;
    const pitches = [...new Set(group.map((n) => midiOf(n.note)).filter(Number.isFinite))].sort((a, b) => a - b);
    if (pitches.length < 2) return group;
    const cycle = arpCycle(pitches, opts.style, opts.octaves);
    const span = Math.max(...group.map((n) => durationToBars(n.duration)));
    const count = Math.max(1, Math.round(span / rate - EPS));
    const start = group[0].startOffset;
    const velocity = Math.max(...group.map((n) => n.velocity));
    return Array.from({ length: count }, (_, i) => {
      const midi = opts.style === 'random' ? cycle[Math.floor(random() * cycle.length)] : cycle[i % cycle.length];
      return {
        id: newId(),
        note: nameOf(midi),
        startOffset: round(start + i * rate),
        duration: barsToDuration(rate * gate),
        // A little accent where each cycle starts
        velocity: Math.round(Math.min(1, velocity * (i % cycle.length === 0 ? 1 : 0.85)) * 100) / 100,
      };
    });
  });
}

// ---------- riff generator ----------

export type RiffStyle = 'pluck' | 'lead' | 'bass';
export const RIFF_STYLES: ReadonlyArray<{ id: RiffStyle; name: string; detail: string }> = [
  { id: 'pluck', name: 'Pluck riff', detail: 'Short, syncopated 16ths: house, rap and pop hooks' },
  { id: 'lead', name: 'Lead line', detail: 'Longer notes that sing: a topline or a synth lead' },
  { id: 'bass', name: 'Bass line', detail: 'Low, rhythmic, on the chord roots with passing notes' },
];

/** One bar's onsets on the 16th grid ('x' a note, '.' a rest), per style. */
const RHYTHMS: Record<RiffStyle, string[]> = {
  pluck: ['x..x..x...x..x..', 'x.x..x..x.x..x..', 'x..x..x..x..x.x.', '..x..x..x...x.x.', 'x..x.x..x..x.x..'],
  lead: ['x...x.x.x...x...', 'x.....x...x.x...', 'x...x...x.x.x.x.', 'x.......x...x.x.', '..x.x...x...x...'],
  bass: ['x..x..x.x..x....', 'x.......x..x..x.', 'x..x...x..x.x...', 'x.x...x.x.....x.', 'x...x..xx...x...'],
};
const CENTER: Record<RiffStyle, number> = { pluck: 72, lead: 74, bass: 40 };

export interface RiffOptions {
  style: RiffStyle;
  lengthBars: number;
  seed: number;
  /** The chords under the clip (from another track), bar-relative; none: the key's home chord */
  chords?: ReadonlyArray<{ at: number; end: number; pcs: readonly number[] }>;
  /** Where it sits (MIDI); the style's own if absent */
  center?: number;
  /** The lowest and highest notes the instrument plays */
  range?: readonly [number, number];
}

/** The key's notes (MIDI) from `lo` to `hi`. */
function scaleNotes(key: SongKey, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if ((key.steps as readonly number[]).includes(pc(m - key.root))) out.push(m);
  return out;
}

/**
 * A riff in the key, `lengthBars` long: a one-bar rhythm, played as call (bar 1) and answer (bar
 * 2, its end varied), the phrase repeating with a new ending each time it comes back. Strong beats
 * land on a tone of the chord sounding there (its root, for a bass line); the notes between step
 * through the scale. The same seed always gives the same riff; another seed, another riff.
 */
export function riff(key: SongKey, opts: RiffOptions, newId: () => string): NoteEvent[] {
  const random = seeded(Math.max(1, Math.floor(opts.seed)));
  const style = opts.style;
  const center = opts.center ?? CENTER[style];
  const [rlo, rhi] = opts.range ?? [0, 127];
  const lo = Math.max(rlo, center - (style === 'bass' ? 7 : 9));
  const hi = Math.min(rhi, center + (style === 'bass' ? 9 : 10));
  const pool = scaleNotes(key, lo, hi);
  if (!pool.length) return [];
  const home = degreeChord(key, { degree: 0 });
  const chordAt = (t: number) => opts.chords?.find((c) => t >= c.at - EPS && t < c.end - EPS)?.pcs ?? home;
  const bars = Math.max(1, Math.ceil(opts.lengthBars - EPS));
  const rhythmsOf = RHYTHMS[style];
  const motif = rhythmsOf[Math.floor(random() * rhythmsOf.length)];
  const answer = rhythmsOf[Math.floor(random() * rhythmsOf.length)];
  // The call's steps through the scale, kept so it comes back the same each phrase
  const moves = Array.from({ length: 16 }, () => {
    const r = random();
    return r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.85 ? 2 : -2;
  });
  const nearestIn = (target: number, allowed: readonly number[]) => {
    let best = pool[0];
    let cost = Infinity;
    for (const m of pool) {
      if (!allowed.includes(pc(m))) continue;
      const c = Math.abs(m - target);
      if (c < cost) {
        cost = c;
        best = m;
      }
    }
    return cost === Infinity ? pool.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)) : best;
  };

  const out: NoteEvent[] = [];
  for (let b = 0; b < bars; b++) {
    const phraseBar = b % 2;
    const rhythm = phraseBar === 0 ? motif : b === bars - 1 || b % 4 === 3 ? answer : motif;
    // The call starts on the chord's root (bass) or a chord tone near the middle
    let idx = pool.indexOf(nearestIn(center, chordAt(b).slice(0, style === 'bass' ? 1 : 3)));
    const onsets = [...rhythm].flatMap((ch, s) => (ch === 'x' ? [s] : []));
    onsets.forEach((s, k) => {
      const t = b + s / 16;
      if (t >= opts.lengthBars - EPS) return;
      const strong = s % 4 === 0;
      if (k > 0) {
        // The answer bar takes its own path after its first half
        const move = phraseBar === 1 && s >= 8 ? (random() < 0.5 ? 1 : -1) * (random() < 0.7 ? 1 : 2) : moves[s];
        idx = Math.max(0, Math.min(pool.length - 1, idx + move));
        // Bounce back off the ends of the range
        if (idx === 0 || idx === pool.length - 1) idx = Math.max(0, Math.min(pool.length - 1, idx - Math.sign(move) * 2));
      }
      let midi = pool[idx];
      if (strong) {
        const tones = chordAt(t);
        midi = nearestIn(midi, style === 'bass' && s === 0 ? tones.slice(0, 1) : tones);
        idx = pool.indexOf(midi);
      }
      // How long: a pluck is short; a lead or a bass holds to the next note (a lead's last a little longer)
      const next = onsets[k + 1] !== undefined ? onsets[k + 1] : 16;
      const gap = (next - s) / 16;
      const length = style === 'pluck' ? Math.min(gap, 1 / 16) : style === 'bass' ? Math.max(1 / 32, gap - 1 / 64) : gap;
      out.push({
        id: newId(),
        note: nameOf(midi),
        startOffset: round(t),
        duration: barsToDuration(Math.max(1 / 64, Math.min(length, opts.lengthBars - t))),
        velocity: strong ? 0.85 : s % 2 === 0 ? 0.72 : 0.64,
      });
    });
  }
  return out;
}
