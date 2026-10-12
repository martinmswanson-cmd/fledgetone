import type { InstrumentKey } from '../audio/instrumentCatalog';
import { FX_NOTES, isDrumKind } from '../audio/instrumentCatalog';
import type { NoteEvent, Track, TransitionKind } from './timelineTypes';
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
];

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

/** Transitions from a project file: marker id to kind, keeping only known kinds. */
export function parseTransitions(raw: unknown): Record<string, TransitionKind> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, TransitionKind> = {};
  for (const [id, kind] of Object.entries(raw)) if (isTransitionKind(kind) && kind !== 'cut') out[id] = kind;
  return out;
}
