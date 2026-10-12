import type { InstrumentKey } from '../audio/instrumentCatalog';
import { FX_NOTES, isDrumKind } from '../audio/instrumentCatalog';
import type { NoteEvent, Track, TransitionKind, TransitionRule } from './timelineTypes';
import { uid } from './timelineTypes';

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
];

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

const QUANTIZE = new Set(['bar', 'beat', 'now']);

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
