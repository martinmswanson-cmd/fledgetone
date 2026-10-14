import type { InstrumentKey } from '../audio/instrumentCatalog';
import { FX_NOTES, isDrumKind } from '../audio/instrumentCatalog';
import type { NoteEvent, Track, TransitionKind, TransitionRule } from './timelineTypes';
import { barsToDuration, uid } from './timelineTypes';
import { nameOf } from './noteTools';

/**
 * Transitions into a game state: what plays as the music switches to it, the way adaptive game
 * music smooths a change. A drum fill over the beat before the switch, a riser over the bar
 * before it, or an impact on the new state's downbeat. Notes are given relative to the switch
 * point in bars (a fill starts a quarter of a bar before it). No audio or store here, so Node can
 * unit-test it.
 */

export const TRANSITIONS: ReadonlyArray<{ kind: TransitionKind; label: string; blurb: string }> = [
  { kind: 'cut', label: 'Cut', blurb: 'straight in' },
  { kind: 'fill', label: 'Fill', blurb: 'a snare fill over the last beat' },
  { kind: 'riser', label: 'Riser', blurb: 'a riser over the last bar' },
  { kind: 'impact', label: 'Impact', blurb: 'a hit on the downbeat' },
  { kind: 'crossfade', label: 'Crossfade', blurb: 'the old state fades out as the new one fades in' },
  { kind: 'stinger', label: 'Stinger', blurb: 'a stinger bridges the gap, then the new state starts' },
  { kind: 'bridge', label: 'Bridge', blurb: "a bar or two written to lead into the new state (its chord's dominant, the bass walking in, a fill), then the new state" },
];

/** When a switch happens: the next beat, bar, phrase (every few bars of the state), the end of its loop, or at once. */
export const QUANTIZES: ReadonlyArray<{ id: NonNullable<TransitionRule['quantize']>; label: string }> = [
  { id: 'bar', label: 'on the next bar' },
  { id: 'beat', label: 'on the next beat' },
  { id: 'phrase', label: 'on the next phrase' },
  { id: 'end', label: 'at the end of the loop' },
  { id: 'now', label: 'at once' },
];
export const PHRASE_BARS = [2, 4, 8] as const;

/** Any state: the "from" of a rule that applies whatever is playing. */
export const ANY_STATE = '*';

/** The matrix key of a rule from one state (a section marker id, or ANY_STATE) to another. */
export const transitionKey = (from: string, to: string) => `${from}>${to}`;

/** The rule for switching `from` to `to`: its own, else the one from any state, else a cut on the bar. */
export function ruleFor(rules: Record<string, TransitionRule>, from: string | null, to: string): TransitionRule {
  return (from !== null ? rules[transitionKey(from, to)] : undefined) ?? rules[transitionKey(ANY_STATE, to)] ?? { kind: 'cut' };
}

const KINDS = new Set<string>(TRANSITIONS.map((t) => t.kind));
export const isTransitionKind = (v: unknown): v is TransitionKind => typeof v === 'string' && KINDS.has(v);

export interface TransitionCue {
  /** The instrument it plays on */
  instrumentKey: InstrumentKey;
  /** Note offsets in bars from the switch point (negative: before it) */
  notes: NoteEvent[];
  /** Bars before the switch it starts */
  leadIn: number;
}

/** The cue for a transition, played on the song's own drum kit when it has one. */
export function transitionCue(kind: TransitionKind, tracks: readonly Pick<Track, 'instrumentKey'>[]): TransitionCue | null {
  const note = (n: string, at: number, duration: string, velocity: number): NoteEvent => ({ id: uid('note'), note: n, startOffset: at, duration, velocity });
  switch (kind) {
    case 'fill': {
      const kit = tracks.find((t) => isDrumKind(t.instrumentKey))?.instrumentKey ?? 'drums';
      return { instrumentKey: kit, leadIn: 0.25, notes: [0, 1, 2, 3].map((i) => note('D1', -0.25 + i / 16, '16n', 0.5 + i * 0.12)) };
    }
    case 'riser':
      return { instrumentKey: 'fx', leadIn: 1, notes: [note(FX_NOTES.riser, -1, '1m', 0.7)] };
    case 'impact':
      return { instrumentKey: 'fx', leadIn: 0, notes: [note(FX_NOTES.impact, 0, '2n', 0.8)] };
    default:
      return null;
  }
}

const QUANTIZE = new Set(['bar', 'beat', 'phrase', 'end', 'now']);

/** One rule from a file, or null if it's not one. */
function parseRule(v: unknown): TransitionRule | null {
  if (isTransitionKind(v)) return { kind: v };
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!isTransitionKind(r.kind)) return null;
  return {
    kind: r.kind,
    ...(typeof r.quantize === 'string' && QUANTIZE.has(r.quantize) ? { quantize: r.quantize as TransitionRule['quantize'] } : {}),
    ...(typeof r.beats === 'number' && r.beats > 0 && r.beats <= 32 ? { beats: r.beats } : {}),
    ...(typeof r.stingerId === 'string' ? { stingerId: r.stingerId } : {}),
    ...(typeof r.phraseBars === 'number' && (PHRASE_BARS as readonly number[]).includes(r.phraseBars) ? { phraseBars: r.phraseBars } : {}),
    ...(r.bridgeBars === 1 || r.bridgeBars === 2 ? { bridgeBars: r.bridgeBars } : {}),
  };
}

/**
 * Transitions from a project file: "from>to" (marker ids, or * for any state) to a rule. Files
 * from before the matrix keyed a kind by the state it goes into: those apply from any state.
 */
export function parseTransitions(raw: unknown): Record<string, TransitionRule> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, TransitionRule> = {};
  for (const [key, value] of Object.entries(raw)) {
    const rule = parseRule(value);
    if (!rule) continue;
    out[key.includes('>') ? key : transitionKey(ANY_STATE, key)] = rule;
  }
  return out;
}

// ---------- Bridges ----------

/** What a state starts on: its lowest note and the notes sounding with it (MIDI), from its first beat. */
export interface BridgeTarget {
  bass: number | null;
  chord: number[];
}

/** The state's opening, from notes (MIDI, offset in bars from its start, pitched only). */
export function bridgeTarget(notes: ReadonlyArray<{ midi: number; at: number }>, beat: number): BridgeTarget {
  const first = notes.filter((n) => n.at < beat - 1e-6 && Number.isFinite(n.midi));
  const pool = first.length ? first : notes.filter((n) => n.at < beat * 4 - 1e-6 && Number.isFinite(n.midi));
  if (!pool.length) return { bass: null, chord: [] };
  const midis = pool.map((n) => n.midi);
  return { bass: Math.min(...midis), chord: [...new Set(midis)].sort((a, b) => a - b) };
}

/** The drum kits' kick, snare and closed hat rows (C1, D1, F#1) as MIDI. */
const KICK = 24;
const SNARE = 26;
const HAT = 30;

export interface BridgeNotes {
  chords: NoteEvent[];
  bass: NoteEvent[];
  drums: NoteEvent[];
  /** Its length in bars (whole notes): `bars` measures */
  lengthBars: number;
}

/**
 * A bridge into a state: a measure (or two) that pulls into its opening chord. The last measure is
 * the dominant seventh of that chord's root (the strongest pull there is); a two-measure bridge
 * comes to it from the subdominant (ii before a major chord, iv before a minor one). The bass plays
 * each chord's root and steps up to the new root through its leading tone; the drums keep time and
 * fill the last beat. `measure` is a measure's length in bars, `beats` how many beats it has.
 */
export function bridgeNotes(target: BridgeTarget, bars: 1 | 2, measure: number, beats: number, newId: () => string = () => uid('note')): BridgeNotes {
  const note = (midi: number, at: number, length: number, velocity: number): NoteEvent => ({
    id: newId(),
    note: nameOf(midi),
    startOffset: Math.round(at * 192) / 192,
    duration: barsToDuration(length),
    velocity: Math.round(velocity * 100) / 100,
  });
  const lowest = target.bass ?? target.chord[0] ?? 48;
  const root = ((lowest % 12) + 12) % 12;
  const pcs = new Set(target.chord.map((m) => (((m - lowest) % 12) + 12) % 12));
  const minor = pcs.has(3) && !pcs.has(4);
  // The chords: [root offset from the target root, intervals]
  const dominant: [number, number[]] = [7, [0, 4, 7, 10]];
  const before: [number, number[]] = minor ? [5, [0, 3, 7]] : [2, [0, 3, 7]];
  const plan = bars === 2 ? [before, dominant] : [dominant];
  // Voiced around where the new chord sits (or middle C), each tone in the octave nearest it
  const center = target.chord.length ? target.chord.reduce((a, b) => a + b, 0) / target.chord.length : 60;
  const chordCenter = Math.max(52, Math.min(72, center));
  const voice = (pc: number) => {
    let m = Math.round(chordCenter - 6) + ((((pc - Math.round(chordCenter - 6)) % 12) + 12) % 12);
    if (m > chordCenter + 6) m -= 12;
    return m;
  };
  const bassHome = target.bass !== null ? Math.max(28, Math.min(52, target.bass)) : 40;
  const bassNote = (pc: number) => {
    let m = bassHome - 6 + ((((pc - (bassHome - 6)) % 12) + 12) % 12);
    if (m > bassHome + 5) m -= 12;
    return m;
  };
  const beat = measure / beats;
  const half = beats % 2 === 0 ? measure / 2 : measure;
  const chords: NoteEvent[] = [];
  const bass: NoteEvent[] = [];
  const drums: NoteEvent[] = [];
  plan.forEach(([offset, intervals], i) => {
    const start = i * measure;
    const chordRoot = (root + offset) % 12;
    const last = i === plan.length - 1;
    // The chord on each half of the measure (once in 3/4 or 6/8), a little louder into the switch
    for (let t = 0; t < measure - 1e-6; t += half) for (const iv of intervals) chords.push(note(voice(chordRoot + iv), start + t, half * 0.95, 0.62 + (last ? 0.08 : 0) + (t > 0 ? 0.04 : 0)));
    // The bass: the chord's root, then (last measure) the leading tone on the last beat
    bass.push(note(bassNote(chordRoot), start, last ? measure - beat : half, 0.8));
    if (!last && half < measure) bass.push(note(bassNote(chordRoot), start + half, half, 0.72));
    if (last) bass.push(note(bassNote(root) - 1, start + measure - beat, beat, 0.78));
    // Drums (the kits' rows: C1 kick, D1 snare, F#1 hat): kick on the downbeat (and the middle),
    // the backbeat, then a snare fill over the last beat
    drums.push(note(KICK, start, beat / 2, 0.85));
    if (half < measure) drums.push(note(KICK, start + half, beat / 2, 0.75));
    for (let b = 1; b < beats; b++) {
      const at = start + b * beat;
      if (last && b === beats - 1) break;
      if (b % 2 === 1) drums.push(note(SNARE, at, beat / 2, 0.7));
      drums.push(note(HAT, at, beat / 4, 0.4));
    }
    if (last) for (let k = 0; k < 4; k++) drums.push(note(SNARE, start + measure - beat + (k * beat) / 4, beat / 4, 0.5 + k * 0.12));
  });
  return { chords, bass, drums, lengthBars: plan.length * measure };
}
