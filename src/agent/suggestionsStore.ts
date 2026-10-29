/**
 * The agent's suggestions and messages in the studio, the connection's state, and what the
 * timeline highlights: a small store of its own, never saved (a suggestion lives as long as the
 * page, and only the musician's Accept puts it in the song). Also the plain logic behind it:
 * making a suggestion from ops (applyOps with an id base of its own, the fingerprints and names of
 * what it touches), checking the waiting ones again when the song changes (still fits, applied
 * again to the song as it is now, or out of date) and what Accept should do.
 */
import { create } from 'zustand';
import type { ProjectSnapshot } from '../store/project';
import { applyOps, OPS_VERSION, type ApplyResult, type Op, type OpError } from './ops';
import { classifySuggestion, touchedHashes, touchedNames } from './suggestion';
import { DEFAULT_PERMISSIONS, LIMITS, plainAgentText, type Permissions } from './protocol';
import type { BarRange } from './songDiff';
import type { BridgeInfo } from './bridgeProtocolClient';

/**
 * Where a suggestion is: waiting (for the musician); changed (the song changed elsewhere since: it
 * was applied again to the song as it is now, worth hearing again; Accept still works); out of
 * date (something it changes was edited or deleted: it can't be accepted); accepted; dismissed;
 * withdrawn (by the agent).
 */
export type SuggestionStatus = 'waiting' | 'changed' | 'out_of_date' | 'accepted' | 'dismissed' | 'withdrawn';

export interface Suggestion {
  id: string;
  /** The id base its new things get their ids from: its own, used again at Accept (what's heard is what's applied). */
  idBase: string;
  title: string;
  explanation: string;
  ops: Op[];
  /** The bars the agent asked to hear it over (else `audition`). */
  focus?: BarRange;
  /** The song's revision it fits (when made, or when last applied again). */
  revision: number;
  touchedHashes: Record<string, string>;
  touchedNames: Record<string, string>;
  status: SuggestionStatus;
  /** The song as it would be, and what changes, in plain words. */
  song: ProjectSnapshot;
  changes: string[];
  warnings: string[];
  notes: string[];
  touchedTracks: string[];
  bars: BarRange | null;
  audition: BarRange;
  /** Out of date: what changed under it. */
  outOfDate?: string[];
  createdAt: number;
}

/** A message from the agent (say), shown as plain text. */
export interface AgentMessage {
  id: string;
  text: string;
  about?: string;
  at: number;
}

/** What the agent pointed at (point_at), shown on the timeline for a few seconds. */
export interface Highlight {
  target: { track?: string; clip?: string; bars?: BarRange; marker?: string; control?: string };
  note?: string;
  until: number;
}

export interface SuggestionsState {
  suggestions: Suggestion[];
  messages: AgentMessage[];
  /** The connection as the bridge client last said, and what the musician allowed. */
  connection: BridgeInfo;
  permissions: Permissions;
  /** The song's revision now (see revision.ts). */
  revision: number;
  highlight: Highlight | null;
  /** The suggestion the musician is looking at (its tracks and bars are tinted on the timeline). */
  focusId: string | null;
}

export const useSuggestions = create<SuggestionsState>(() => ({
  suggestions: [],
  messages: [],
  connection: { state: 'closed' },
  permissions: { ...DEFAULT_PERMISSIONS },
  revision: 0,
  highlight: null,
  focusId: null,
}));

/** A suggestion's own id: random, so its new things' ids never meet another's. */
export function newSuggestionId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return `sg-${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)}`;
}

/** Still up to the musician (waiting, or changed and waiting again). */
export const isOpen = (s: Pick<Suggestion, 'status'>): boolean => s.status === 'waiting' || s.status === 'changed';

/** How many suggestions wait for the musician. */
export const waitingCount = (list: readonly Suggestion[]): number => list.filter(isOpen).length;

const fromResult = (r: ApplyResult) => ({
  song: r.song,
  changes: r.diff.changes.map((c) => c.text),
  warnings: r.warnings,
  notes: r.notes,
  touchedTracks: r.diff.touchedTracks,
  bars: r.diff.bars,
  audition: r.diff.audition,
});

/**
 * A suggestion from an agent's request, on `base` at `revision`: its texts made plain and cut to
 * their limits, its ops applied with an id base of its own. The ops' errors if they can't apply.
 */
export function makeSuggestion(
  base: ProjectSnapshot,
  revision: number,
  req: { title: unknown; explanation: unknown; ops: unknown; focus?: unknown },
  id = newSuggestionId(),
  now = Date.now()
): { ok: true; suggestion: Suggestion } | { ok: false; errors: OpError[]; message: string } {
  const title = plainAgentText(req.title, LIMITS.titleMaxChars).trim();
  if (!title) return { ok: false, errors: [], message: 'A suggestion needs a title.' };
  const explanation = plainAgentText(req.explanation, LIMITS.explanationMaxChars);
  const out = applyOps(base, { opsVersion: OPS_VERSION, ops: req.ops }, { idBase: id });
  if (!out.ok) return { ok: false, errors: out.errors, message: `The ops can't be applied: ${out.errors.map((e) => `${e.path || 'ops'}: ${e.message}`).join('; ')}` };
  const ops = req.ops as Op[];
  const f = req.focus as Partial<BarRange> | undefined;
  const focus = f && typeof f.fromBar === 'number' && typeof f.toBar === 'number' && f.toBar > f.fromBar ? { fromBar: Math.max(1, f.fromBar), toBar: Math.min(f.toBar, Math.max(1, f.fromBar) + LIMITS.listenMaxBars) } : undefined;
  return {
    ok: true,
    suggestion: {
      id,
      idBase: out.idBase,
      title,
      explanation,
      ops,
      ...(focus ? { focus } : {}),
      revision,
      touchedHashes: touchedHashes(base, ops),
      touchedNames: touchedNames(base, ops),
      status: 'waiting',
      ...fromResult(out),
      createdAt: now,
    },
  };
}

/**
 * A waiting suggestion checked against the song as it is now: the same (still fits as made), or
 * applied again to the song now (changed: worth hearing again), or out of date.
 */
export function refreshSuggestion(s: Suggestion, now: ProjectSnapshot, revision: number): Suggestion {
  if (!isOpen(s) || s.revision === revision) return s;
  const fit = classifySuggestion({ revision: s.revision, touchedHashes: s.touchedHashes, touchedNames: s.touchedNames }, { revision, song: now });
  if (fit.status === 'unchanged') return { ...s, revision };
  if (fit.status === 'out_of_date') return { ...s, status: 'out_of_date', outOfDate: fit.changed };
  const again = applyOps(now, { opsVersion: OPS_VERSION, ops: s.ops }, { idBase: s.idBase });
  if (!again.ok) return { ...s, status: 'out_of_date', outOfDate: again.errors.map((e) => e.message) };
  return { ...s, status: 'changed', revision, idBase: again.idBase, ...fromResult(again) };
}

/** What Accept should do: apply this song, or nothing (and why). */
export function acceptDecision(s: Suggestion, now: ProjectSnapshot, revision: number): { apply: ProjectSnapshot; suggestion: Suggestion } | { apply: null; suggestion: Suggestion; message: string } {
  if (!isOpen(s)) return { apply: null, suggestion: s, message: 'This suggestion is no longer waiting.' };
  const fresh = refreshSuggestion(s, now, revision);
  if (fresh.status === 'out_of_date') return { apply: null, suggestion: fresh, message: `Out of date: ${fresh.outOfDate?.join('; ') ?? 'the song changed'}.` };
  // Applied again just now: the musician hears it again before it goes in
  if (fresh !== s && fresh.status === 'changed' && s.status !== 'changed') return { apply: null, suggestion: fresh, message: 'The song changed since this was suggested: listen again, then accept.' };
  return { apply: fresh.song, suggestion: fresh };
}

/** Change one suggestion in the store. */
export function updateSuggestion(id: string, patch: Partial<Suggestion> | ((s: Suggestion) => Suggestion)): void {
  useSuggestions.setState((st) => ({ suggestions: st.suggestions.map((s) => (s.id === id ? (typeof patch === 'function' ? patch(s) : { ...s, ...patch }) : s)) }));
}
