/**
 * The agent's suggestions and messages in the studio, the connection's state, and what the
 * timeline highlights: a small store of its own, never saved (a suggestion lives as long as the
 * page, and only the musician's Accept puts it in the song). Also the plain logic behind it:
 *
 * - making a suggestion from ops: applyOps with an id base of its own, the fingerprints and names
 *   of what it touches, and the song it's for (its generation: New, Open, a link or Restore start
 *   another), the song's parts as undo sees them and what else a render hears (swing, intensity);
 * - checking it when the song changes, cheaply (fingerprints only): another song (it can't go
 *   in), out of date (something it changes was edited), or changed (it still fits, but the song
 *   moved on: it's applied again when it's heard or accepted, never before);
 * - what Accept should do: a changed suggestion goes in only as heard, or after a second press
 *   that says it wasn't; and, once accepted, whether an undo took it back out (and a redo in).
 */
import { create } from 'zustand';
import type { ProjectSnapshot } from '../store/project';
import { barToSeconds } from '../audio/tempoMap';
import { applyOps, OPS_VERSION, type ApplyResult, type Op, type OpError } from './ops';
import { classifySuggestion, hashesOf, keysOfOps, touchedHashes, touchedNames } from './suggestion';
import { DEFAULT_PERMISSIONS, fromAgent, LIMITS, type Permissions } from './protocol';
import { partsChanged, type Parts } from './revision';
import type { BarRange } from './songDiff';
import type { BridgeInfo } from './bridgeProtocolClient';

/**
 * Where a suggestion is: waiting (for the musician); changed (the song changed elsewhere since:
 * hear it again); out of date (something it changes was edited or deleted); for another song
 * (another song was opened); accepted; undone (accepted, then Undo took it out); dismissed;
 * withdrawn (by the agent).
 */
export type SuggestionStatus = 'waiting' | 'changed' | 'out_of_date' | 'other_song' | 'accepted' | 'undone' | 'dismissed' | 'withdrawn';

/** The song now, as a suggestion is checked against it. */
export interface SongContext {
  /** Which song: goes up when another replaces it (songGeneration). */
  epoch: number;
  /** Its parts as undo sees them (songParts): the same objects until an edit. */
  parts: Parts;
  /** What else a render hears that undo doesn't keep: the swing and the intensity. */
  ext: string;
}

/** The `ext` of a song context. */
export const extKey = (swing: number, intensity: number): string => `${swing}|${intensity}`;

export interface Suggestion {
  id: string;
  /** The id base its new things get their ids from: its own, used again whenever it's applied again. */
  idBase: string;
  title: string;
  explanation: string;
  ops: Op[];
  /** The bars the agent asked to hear it over (else `audition`). */
  focus?: BarRange;
  /** The song `song` was made from. */
  epoch: number;
  parts: Parts;
  ext: string;
  /** Goes up each time `song` is made again; `heard` is the one last heard. */
  version: number;
  heard: number | null;
  /** The version Accept was pressed for unheard once: a second press accepts it. */
  confirmUnheard: number | null;
  /** The song moved on since `song` was made (it still fits): made again before it's heard or accepted. */
  stale: boolean;
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
  /** Accepted: what it touched, before and after, to tell an undo (and a redo). */
  applied?: { keys: string[]; before: Record<string, string | null>; after: Record<string, string | null> };
  createdAt: number;
}

/** A message from the agent (say), shown as plain text, attributed to it. */
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
  /** The song's revision as the agent is told it (see revision.ts). */
  revision: number;
  highlight: Highlight | null;
  /** The suggestion the musician is looking at (its tracks and bars are tinted on the timeline). */
  focusId: string | null;
  /** The last thing worth saying aloud (screen readers): one live region for the panel. */
  announcement: string;
}

export const useSuggestions = create<SuggestionsState>(() => ({
  suggestions: [],
  messages: [],
  connection: { state: 'closed' },
  permissions: { ...DEFAULT_PERMISSIONS },
  revision: 0,
  highlight: null,
  focusId: null,
  announcement: '',
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

/** Whether `s` was made from the song as it is in `ctx`. */
export const sameSong = (s: Pick<Suggestion, 'epoch' | 'parts' | 'ext'>, ctx: SongContext): boolean => s.epoch === ctx.epoch && s.ext === ctx.ext && !partsChanged(s.parts, ctx.parts);

/** A range of bars cut to at most the seconds a listen may take (LIMITS.listenMaxSeconds). */
export function capSeconds(range: BarRange, song: Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>): BarRange {
  const tempo = { bpm: song.bpm, points: song.tempoPoints ?? [] };
  let to = range.toBar;
  while (to - range.fromBar > 1 && barToSeconds(to, tempo) - barToSeconds(range.fromBar, tempo) > LIMITS.listenMaxSeconds) to--;
  return { fromBar: range.fromBar, toBar: to };
}

const fromResult = (r: ApplyResult) => ({
  song: r.song,
  changes: r.diff.changes.map((c) => c.text),
  warnings: r.warnings,
  notes: r.notes,
  touchedTracks: r.diff.touchedTracks,
  bars: r.diff.bars,
  audition: capSeconds(r.diff.audition, r.song),
});

/**
 * A suggestion from an agent's request, on `base` (the song in `ctx`): its texts made plain and
 * cut to their limits, its ops applied with an id base of its own. The ops' errors if they can't.
 */
export function makeSuggestion(
  base: ProjectSnapshot,
  ctx: SongContext,
  req: { title: unknown; explanation: unknown; ops: unknown; focus?: unknown },
  id = newSuggestionId(),
  now = Date.now()
): { ok: true; suggestion: Suggestion } | { ok: false; errors: OpError[]; message: string } {
  const title = fromAgent(req.title, LIMITS.titleMaxChars);
  if (!title) return { ok: false, errors: [], message: 'A suggestion needs a title.' };
  const explanation = fromAgent(req.explanation, LIMITS.explanationMaxChars);
  const out = applyOps(base, { opsVersion: OPS_VERSION, ops: req.ops }, { idBase: id });
  if (!out.ok) return { ok: false, errors: out.errors, message: `The ops can't be applied: ${out.errors.map((e) => `${e.path || 'ops'}: ${e.message}`).join('; ')}` };
  const ops = req.ops as Op[];
  const f = req.focus as Partial<BarRange> | undefined;
  const focus =
    f && typeof f.fromBar === 'number' && typeof f.toBar === 'number' && f.toBar > f.fromBar
      ? capSeconds({ fromBar: Math.max(1, f.fromBar), toBar: Math.min(f.toBar, Math.max(1, f.fromBar) + LIMITS.listenMaxBars) }, out.song)
      : undefined;
  return {
    ok: true,
    suggestion: {
      id,
      idBase: out.idBase,
      title,
      explanation,
      ops,
      ...(focus ? { focus } : {}),
      epoch: ctx.epoch,
      parts: ctx.parts,
      ext: ctx.ext,
      version: 1,
      heard: null,
      confirmUnheard: null,
      stale: false,
      touchedHashes: touchedHashes(base, ops),
      touchedNames: touchedNames(base, ops),
      status: 'waiting',
      ...fromResult(out),
      createdAt: now,
    },
  };
}

/**
 * A waiting suggestion checked against the song now, cheaply (fingerprints, no applying): for
 * another song, out of date, changed (still fits, `stale` until it's made again), or as it was.
 */
export function checkSuggestion(s: Suggestion, now: ProjectSnapshot, ctx: SongContext): Suggestion {
  if (!isOpen(s)) return s;
  if (s.epoch !== ctx.epoch) return { ...s, status: 'other_song' };
  if (sameSong(s, ctx)) return s;
  const fit = classifySuggestion({ revision: 0, touchedHashes: s.touchedHashes, touchedNames: s.touchedNames }, { revision: 1, song: now });
  if (fit.status === 'out_of_date') return { ...s, status: 'out_of_date', outOfDate: fit.changed };
  return s.status === 'changed' && s.stale ? s : { ...s, status: 'changed', stale: true };
}

/** A suggestion made again on the song now, if the song moved on since it was made (else as it is). */
export function freshen(s: Suggestion, now: ProjectSnapshot, ctx: SongContext): Suggestion {
  const checked = checkSuggestion(s, now, ctx);
  if (!isOpen(checked) || (!checked.stale && sameSong(checked, ctx))) return checked;
  const again = applyOps(now, { opsVersion: OPS_VERSION, ops: s.ops }, { idBase: s.idBase });
  if (!again.ok) return { ...checked, status: 'out_of_date', outOfDate: again.errors.map((e) => e.message) };
  return { ...checked, status: 'changed', stale: false, epoch: ctx.epoch, parts: ctx.parts, ext: ctx.ext, version: checked.version + 1, idBase: again.idBase, ...fromResult(again) };
}

/**
 * What Accept should do: apply this song, or nothing (and why). A suggestion the song moved on
 * under goes in only as last heard; if this version wasn't heard, the first press says so and a
 * second press accepts it unheard. One never heard at all, unchanged, goes in (it's what the card
 * describes; the card says it wasn't heard).
 */
export function acceptDecision(s: Suggestion, now: ProjectSnapshot, ctx: SongContext): { apply: ProjectSnapshot; suggestion: Suggestion } | { apply: null; suggestion: Suggestion; message: string } {
  if (!isOpen(s)) return { apply: null, suggestion: s, message: 'This suggestion is no longer waiting.' };
  const fresh = freshen(s, now, ctx);
  if (fresh.status === 'other_song') return { apply: null, suggestion: fresh, message: 'This suggestion was made for another song: it can’t go in this one.' };
  if (fresh.status === 'out_of_date') return { apply: null, suggestion: fresh, message: `Out of date: ${fresh.outOfDate?.join('; ') ?? 'the song changed'}.` };
  if (fresh.status === 'changed' && fresh.heard !== fresh.version && fresh.confirmUnheard !== fresh.version)
    return { apply: null, suggestion: { ...fresh, confirmUnheard: fresh.version }, message: 'The song changed since this was suggested, and this version hasn’t been heard. Hear it first, or press Accept again to accept it without hearing it.' };
  return { apply: fresh.song, suggestion: fresh };
}

/** What an accepted suggestion touched (the things its ops name and the new things it made), before and after. */
export function appliedRecord(s: Suggestion, before: ProjectSnapshot): NonNullable<Suggestion['applied']> {
  const had = new Set([...before.tracks.map((t) => `track:${t.id}`), ...before.clips.map((c) => `clip:${c.id}`), ...(before.markers ?? []).map((m) => `marker:${m.id}`)]);
  const made = [...s.song.tracks.map((t) => `track:${t.id}`), ...s.song.clips.map((c) => `clip:${c.id}`), ...(s.song.markers ?? []).map((m) => `marker:${m.id}`)].filter((k) => !had.has(k));
  const keys = [...new Set([...keysOfOps(s.ops), ...made])];
  return { keys, before: hashesOf(before, keys), after: hashesOf(s.song, keys) };
}

const same = (a: Record<string, string | null>, b: Record<string, string | null>) => Object.keys(a).every((k) => a[k] === b[k]);

/**
 * An accepted suggestion an undo took out (the song is back as before it), or a redo put back.
 * Only in the song it went into (`epoch`): another song says nothing about it.
 */
export function undoCheck(s: Suggestion, now: ProjectSnapshot, epoch: number): Suggestion {
  if (!s.applied || (s.status !== 'accepted' && s.status !== 'undone') || s.epoch !== epoch) return s;
  const h = hashesOf(now, s.applied.keys);
  if (s.status === 'accepted' && same(h, s.applied.before)) return { ...s, status: 'undone' };
  if (s.status === 'undone' && same(h, s.applied.after)) return { ...s, status: 'accepted' };
  return s;
}

/** Change one suggestion in the store. */
export function updateSuggestion(id: string, patch: Partial<Suggestion> | ((s: Suggestion) => Suggestion)): void {
  useSuggestions.setState((st) => ({ suggestions: st.suggestions.map((s) => (s.id === id ? (typeof patch === 'function' ? patch(s) : { ...s, ...patch }) : s)) }));
}
