/**
 * The agent's suggestions and messages in the studio, the connection's state, and what the
 * timeline highlights: a small store of its own, never saved (a suggestion lives as long as the
 * page, and only the musician's Accept puts it in the song). Also the plain logic behind it:
 *
 * - making a suggestion from ops: applyOps with an id base of its own, the bars its
 *   before-and-after plays (hearingPlan: every region where a change is heard, one after another,
 *   with the agent's focus if that fits), the name of the agent that made it, the fingerprints and names
 *   of what it touches, and the song it's for (its generation: New, Open, a link or Restore start
 *   another), the song's parts as undo sees them and what else a render hears (swing, intensity);
 * - checking it when the song changes, cheaply (fingerprints only): another song (it can't go
 *   in), out of date (something it changes was edited; it waits again if that's put back), or
 *   changed (it still fits, but the song moved on: it's applied again when it's heard or
 *   accepted, never before);
 * - what Accept should do: a changed suggestion goes in only as heard (over every bar it changes),
 *   or after a second press that says it wasn't; and, once accepted, whether an undo took it back out (and a redo in).
 */
import { create } from 'zustand';
import type { ProjectSnapshot } from '../store/project';
import { barToSeconds } from '../audio/tempoMap';
import { applyOps, OPS_VERSION, type ApplyResult, type Op, type OpError } from './ops';
import { classifySuggestion, touchedHashes, touchedNames } from './suggestion';
import { DEFAULT_PERMISSIONS, fromAgent, LIMITS, type Permissions } from './protocol';
import { partsChanged, type Parts } from './revision';
import { joinRanges, rangesWords, type BarRange } from './songDiff';
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
  /** The bars the agent asked to hear it over: `audition` plays them too, if they fit (hearingPlan). */
  focus?: BarRange;
  /** The song `song` was made from. */
  epoch: number;
  parts: Parts;
  ext: string;
  /** Goes up each time `song` is made again; `heard` is the one last heard, every bar it changes. */
  version: number;
  heard: number | null;
  /** The version last heard only in part (its Suggested side played, but not over every bar it changes: see `unheard`). */
  partHeard?: number | null;
  /**
   * Accept pressed once for a version not heard: when, and for which version. A second, separate
   * press (CONFIRM_AFTER_MS to ARMED_MS later, same version) accepts it without listening.
   */
  armed: { version: number; at: number } | null;
  /** The song moved on since `song` was made (it still fits): made again before it's heard or accepted. */
  stale: boolean;
  touchedHashes: Record<string, string>;
  touchedNames: Record<string, string>;
  status: SuggestionStatus;
  /** The song as it would be, and what changes, in plain words (each name in plain quotes: names.ts). */
  song: ProjectSnapshot;
  changes: string[];
  warnings: string[];
  notes: string[];
  /** The same with each name marked, for the card to show the names apart (names.ts nameParts). */
  marked?: { changes: string[]; warnings: string[]; notes: string[] };
  touchedTracks: string[];
  bars: BarRange | null;
  /**
   * Where its changes are heard: what its before-and-after must play for it to count as heard. The
   * rules' (SongDiff.regions, `ruleRegions`), and, once found by sound (`found` 'sound', see
   * whereHeard.ts), every bar where the song before and after renders differently as well.
   */
  regions: BarRange[];
  /** Where its changes are heard by the rules alone (SongDiff.regions): never fewer bars than the truth. */
  ruleRegions: BarRange[];
  /** What its before-and-after plays when there's nothing to hear (SongDiff.audition). */
  fallback: BarRange;
  /**
   * How `regions` was found, for this version: by the rules alone ('rules': not yet by sound, or
   * it can't be, `foundWhy`), or by the rules and by sound ('sound': `soundRegions` are the bars
   * where the two renders differ).
   */
  found: 'rules' | 'sound';
  /** Why it isn't found by sound: the song is too long to render whole ('too_long'), or the render failed ('failed'). */
  foundWhy?: 'too_long' | 'failed';
  /** The bars where the song before and after render differently (found 'sound'). */
  soundRegions?: BarRange[];
  /** The stretches its before-and-after plays, one after another (hearingPlan): every region, and the agent's focus if that fits. */
  audition: BarRange[];
  /** The bars of `regions` that `audition` can't reach (too long to hear at once), or null. */
  unheard: BarRange[] | null;
  /** The limit that left `unheard` out: LIMITS.listenMaxBars bars or LIMITS.listenMaxSeconds seconds. */
  limit?: HearingLimit | null;
  /** The agent's focus was left out of `audition` (it didn't fit with the changes). */
  focusLeftOut?: boolean;
  /** Out of date: what changed under it. */
  outOfDate?: string[];
  /** Out of date: the song's parts when it went so (until they change, it's not checked again). */
  outOfDateAt?: Parts;
  /** Accepted: the name of its undo step (tagLastStep), to tell an undo (and a redo). */
  step?: string;
  createdAt: number;
  /** The connection the agent made it in (conversation.ts): only that agent reads, withdraws or listens to it. */
  connection?: number;
  /** The name the agent paired with when it made it (its card says it came from that one, whoever is paired later). */
  agent?: string;
}

/** A message from the agent (say), shown as plain text, attributed to it; `replyTo`: the musician's message it answers (conversation.ts). */
export interface AgentMessage {
  id: string;
  text: string;
  about?: string;
  replyTo?: string;
  /** The connection it came in (conversation.ts), and the agent's name then. */
  connection?: number;
  agent?: string;
  at: number;
}

/** What the agent pointed at (point_at), shown on the timeline (or by the control) for a few seconds. */
export interface Highlight {
  target: { track?: string; clip?: string; bars?: BarRange; marker?: string; control?: string };
  /** A control pointed at: the element rung (the note goes next to it). */
  element?: HTMLElement;
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
  /** The time of the last message the musician has had on screen (later ones are new). */
  messagesSeenAt: number;
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
  messagesSeenAt: 0,
}));

/** A suggestion's own id: random, so its new things' ids never meet another's. */
export function newSuggestionId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return `sg-${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)}`;
}

/** Still up to the musician (waiting, or changed and waiting again). */
export const isOpen = (s: Pick<Suggestion, 'status'>): boolean => s.status === 'waiting' || s.status === 'changed';

/** How many of the agent's messages the musician hasn't had on screen yet. */
export const unreadCount = (st: Pick<SuggestionsState, 'messages' | 'messagesSeenAt'>): number => st.messages.filter((m) => m.at > st.messagesSeenAt).length;

/**
 * `list` kept to at most `max`: the oldest answered ones go first (never one still waiting, so
 * the agent's suggestions are never lost before the musician answers them).
 */
export function keepSuggestions(list: readonly Suggestion[], max = 50): Suggestion[] {
  let over = list.length - max;
  if (over <= 0) return [...list];
  const out: Suggestion[] = [];
  for (const s of list) {
    if (over > 0 && !isOpen(s)) over--;
    else out.push(s);
  }
  return out;
}

/** How many suggestions wait for the musician. */
export const waitingCount = (list: readonly Suggestion[]): number => list.filter(isOpen).length;

/** Whether `s` was made from the song as it is in `ctx`. */
export const sameSong = (s: Pick<Suggestion, 'epoch' | 'parts' | 'ext'>, ctx: SongContext): boolean => s.epoch === ctx.epoch && s.ext === ctx.ext && !partsChanged(s.parts, ctx.parts);

/** The seconds bars [from, to) take, in the slowest of `songs` (a tempo change plays them at another length in each). */
export function rangeSeconds(r: BarRange, songs: ReadonlyArray<Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>>): number {
  return Math.max(0, ...songs.map((s) => {
    const tempo = { bpm: s.bpm, points: s.tempoPoints ?? [] };
    return barToSeconds(r.toBar, tempo) - barToSeconds(r.fromBar, tempo);
  }));
}

/** A range of bars cut to at most the seconds a listen may take (LIMITS.listenMaxSeconds). */
export function capSeconds(range: BarRange, song: Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>): BarRange {
  let to = range.toBar;
  while (to - range.fromBar > 1 && rangeSeconds({ fromBar: range.fromBar, toBar: to }, [song]) > LIMITS.listenMaxSeconds) to--;
  return { fromBar: range.fromBar, toBar: to };
}

/** The whole bars a range of song bars sits in. */
const wholeBars = (r: BarRange): BarRange => {
  const fromBar = Math.max(1, Math.floor(r.fromBar + 1e-9));
  return { fromBar, toBar: Math.max(fromBar + 1, Math.ceil(r.toBar - 1e-9)) };
};

/** Whether `outer` holds every bar of `inner`. */
export const covers = (outer: BarRange, inner: BarRange): boolean => outer.fromBar <= inner.fromBar + 1e-9 && outer.toBar >= inner.toBar - 1e-9;

/** Whether the stretches `played` hold every bar of `inner` (each bar in one of them). */
export const coveredBy = (played: readonly BarRange[], inner: BarRange): boolean => {
  for (let bar = Math.floor(inner.fromBar + 1e-9); bar < Math.ceil(inner.toBar - 1e-9); bar++) if (!played.some((p) => p.fromBar <= bar + 1e-9 && p.toBar >= bar + 1 - 1e-9)) return false;
  return true;
};

/** Whether stretches of song bars played (parts of bars too) hold every bar of `r` whole (a hair's breadth short of a bar's end counts: frames rounded off). */
export function playedThrough(played: ReadonlyArray<{ fromBar: number; toBar: number }>, r: { fromBar: number; toBar: number }): boolean {
  const eps = 1e-3;
  let at = Math.floor(r.fromBar + 1e-9);
  const end = Math.ceil(r.toBar - 1e-9);
  for (const p of [...played].sort((x, y) => x.fromBar - y.fromBar)) {
    if (p.fromBar > at + eps) break;
    if (p.toBar > at) at = p.toBar;
    if (at >= end - eps) return true;
  }
  return at >= end - eps;
}

/** A range kept to what a listen may take: LIMITS.listenMaxBars bars and LIMITS.listenMaxSeconds seconds. */
const listenable = (r: BarRange, song: Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>): BarRange => capSeconds({ fromBar: r.fromBar, toBar: Math.min(r.toBar, r.fromBar + LIMITS.listenMaxBars) }, song);

/** Which limit kept a before-and-after from playing everything: LIMITS.listenMaxBars bars, or LIMITS.listenMaxSeconds seconds. */
export type HearingLimit = 'bars' | 'seconds';

/** What a suggestion's before-and-after plays, and what of the bars it changes that leaves out (hearingPlan). */
export interface HearingPlan {
  /** The stretches it plays, one after another, in the order of the song (looped as one). */
  plays: BarRange[];
  /** The bars it changes that aren't played (in order), or null: everything is heard. */
  unheard: BarRange[] | null;
  /** The limit that left them out, when some are. */
  limit: HearingLimit | null;
  /** The agent's focus couldn't be played along with the changes (it didn't fit). */
  focusLeftOut: boolean;
}

/** Stretches in order, overlapping and touching ones joined. */
const joinPlays = (list: readonly BarRange[]): BarRange[] => {
  const out: BarRange[] = [];
  for (const r of [...list].sort((x, y) => x.fromBar - y.fromBar)) {
    const last = out.at(-1);
    if (last && r.fromBar <= last.toBar + 1e-9) last.toBar = Math.max(last.toBar, r.toBar);
    else out.push({ ...r });
  }
  return out;
};

/** `r` without the bars of `played`: the pieces left, in order. */
const without = (r: BarRange, played: readonly BarRange[]): BarRange[] => {
  const out: BarRange[] = [];
  for (let bar = r.fromBar; bar < r.toBar; bar++) {
    if (played.some((p) => p.fromBar <= bar && p.toBar >= bar + 1)) continue;
    const last = out.at(-1);
    if (last && last.toBar === bar) last.toBar = bar + 1;
    else out.push({ fromBar: bar, toBar: bar + 1 });
  }
  return out;
};

/**
 * What a suggestion's before-and-after plays, so that what's marked heard is what changes: each
 * region where a change is heard (`regions`, see SongDiff.regions), one after another, in order,
 * each with the bar before it to hear it coming in when that fits too (a region that fits only
 * without it is played without it, never cut), all of it at most LIMITS.listenMaxBars bars and
 * LIMITS.listenMaxSeconds seconds (in the slower of `songs`: the song now and as suggested). A
 * region that doesn't fit is played as far as it does, and what's left of it and every region
 * after it is `unheard` (they can't count as heard: Accept asks for its second press), with the
 * limit that left them out. The agent's `focus` is played with them if it fits in what's left
 * (never instead of a change: else it's left out). With nothing to hear (only names, markers or
 * links change), `fallback` is played (or the focus).
 */
export function hearingPlan(regions: readonly BarRange[], fallback: BarRange, focus: BarRange | undefined, songs: ReadonlyArray<Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>>): HearingPlan {
  if (!regions.length) return { plays: [listenable(focus ?? fallback, songs[songs.length - 1])], unheard: null, limit: null, focusLeftOut: false };
  const plays: BarRange[] = [];
  let bars = 0;
  let seconds = 0;
  const cost = (r: BarRange) => ({ bars: r.toBar - r.fromBar, seconds: rangeSeconds(r, songs) });
  const over = (r: BarRange): HearingLimit | null => {
    const c = cost(r);
    if (bars + c.bars > LIMITS.listenMaxBars) return 'bars';
    if (seconds + c.seconds > LIMITS.listenMaxSeconds + 1e-9) return 'seconds';
    return null;
  };
  const take = (r: BarRange) => {
    const c = cost(r);
    bars += c.bars;
    seconds += c.seconds;
    plays.push(r);
  };
  const list = joinPlays(regions.map(wholeBars));
  const unheard: BarRange[] = [];
  let limit: HearingLimit | null = null;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (limit) {
      unheard.push(r);
      continue;
    }
    // (the bar before it, unless that's played already: the last stretch ends there)
    const prevEnd = plays.at(-1)?.toBar ?? 0;
    const lead: BarRange = { fromBar: Math.max(1, r.fromBar - 1, prevEnd), toBar: r.toBar };
    if (!over(lead)) take(lead);
    else if (!over(r)) take(r);
    else {
      // As far as it fits, from its start: the rest isn't heard
      let to = r.toBar - 1;
      while (to > r.fromBar && over({ fromBar: r.fromBar, toBar: to })) to--;
      const fits = to > r.fromBar;
      // (the limit the next bar would break)
      limit = over({ fromBar: r.fromBar, toBar: fits ? to + 1 : r.fromBar + 1 }) ?? 'seconds';
      if (fits) {
        take({ fromBar: r.fromBar, toBar: to });
        unheard.push({ fromBar: to, toBar: r.toBar });
      } else unheard.push(r);
    }
  }
  let focusLeftOut = false;
  if (focus) {
    const pieces = without(wholeBars(focus), plays);
    const all = pieces.reduce((t, p) => ({ bars: t.bars + cost(p).bars, seconds: t.seconds + cost(p).seconds }), { bars: 0, seconds: 0 });
    if (bars + all.bars <= LIMITS.listenMaxBars && seconds + all.seconds <= LIMITS.listenMaxSeconds + 1e-9) pieces.forEach(take);
    else focusLeftOut = true;
  }
  return { plays: joinPlays(plays), unheard: unheard.length ? unheard : null, limit, focusLeftOut };
}

/** The stretches as one range, first bar to last (for what only needs to know where they lie). */
export const spanOf = (list: readonly BarRange[]): BarRange => ({ fromBar: Math.min(...list.map((r) => r.fromBar)), toBar: Math.max(...list.map((r) => r.toBar)) });

const fromResult = (r: ApplyResult, focus: BarRange | undefined, before: ProjectSnapshot) => {
  const plan = hearingPlan(r.diff.regions, r.diff.audition, focus, [before, r.song]);
  return {
    song: r.song,
    changes: r.diff.changes.map((c) => c.text),
    marked: { changes: r.diff.changes.map((c) => c.marked ?? c.text), warnings: r.marked.warnings, notes: r.marked.notes },
    warnings: r.warnings,
    notes: r.notes,
    touchedTracks: r.diff.touchedTracks,
    bars: r.diff.bars,
    regions: r.diff.regions,
    ruleRegions: r.diff.regions,
    fallback: r.diff.audition,
    found: 'rules' as const,
    foundWhy: undefined,
    soundRegions: undefined,
    audition: plan.plays,
    unheard: plan.unheard,
    limit: plan.limit,
    focusLeftOut: plan.focusLeftOut,
  };
};

/**
 * A suggestion from an agent's request, on `base` (the song in `ctx`): its texts made plain and
 * cut to their limits, its ops applied with an id base of its own. The ops' errors if they can't.
 */
export function makeSuggestion(
  base: ProjectSnapshot,
  ctx: SongContext,
  req: { title: unknown; explanation: unknown; ops: unknown; focus?: unknown },
  id = newSuggestionId(),
  now = Date.now(),
  connection?: number,
  agent?: string
): { ok: true; suggestion: Suggestion } | { ok: false; errors: OpError[]; message: string } {
  const title = fromAgent(req.title, LIMITS.titleMaxChars);
  if (!title) return { ok: false, errors: [], message: 'A suggestion needs a title.' };
  const explanation = fromAgent(req.explanation, LIMITS.explanationMaxChars);
  const out = applyOps(base, { opsVersion: OPS_VERSION, ops: req.ops }, { idBase: id });
  if (!out.ok) return { ok: false, errors: out.errors, message: `The ops can't be applied: ${out.errors.map((e) => `${e.path || 'ops'}: ${e.message}`).join('; ')}` };
  const ops = req.ops as Op[];
  const f = req.focus as Partial<BarRange> | undefined;
  const focus =
    f && typeof f.fromBar === 'number' && typeof f.toBar === 'number' && Number.isFinite(f.fromBar) && Number.isFinite(f.toBar) && f.toBar > f.fromBar
      ? listenable(wholeBars({ fromBar: Math.max(1, f.fromBar), toBar: Math.max(f.toBar, Math.max(1, f.fromBar) + 1) }), out.song)
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
      partHeard: null,
      armed: null,
      stale: false,
      touchedHashes: touchedHashes(base, ops),
      touchedNames: touchedNames(base, ops),
      status: 'waiting',
      ...fromResult(out, focus, base),
      createdAt: now,
      ...(connection !== undefined ? { connection } : {}),
      ...(agent ? { agent } : {}),
    },
  };
}

/**
 * A waiting suggestion checked against the song now, cheaply (fingerprints, no applying): for
 * another song, out of date, changed (still fits, `stale` until it's made again), or as it was.
 * One out of date is checked again whenever the song changes, and waits again once what it
 * changes is as it was (an undo, or the same edit made back): changed, or waiting as it was made
 * if the whole song is as it was then.
 */
export function checkSuggestion(s: Suggestion, now: ProjectSnapshot, ctx: SongContext): Suggestion {
  if (s.status === 'out_of_date') return recheck(s, now, ctx);
  if (!isOpen(s)) return s;
  if (s.epoch !== ctx.epoch) return { ...s, status: 'other_song' };
  if (sameSong(s, ctx)) return s;
  const fit = classifySuggestion({ revision: 0, touchedHashes: s.touchedHashes, touchedNames: s.touchedNames }, { revision: 1, song: now });
  if (fit.status === 'out_of_date') return { ...s, status: 'out_of_date', outOfDate: fit.changed, outOfDateAt: ctx.parts, armed: null };
  return s.status === 'changed' && s.stale && !s.armed ? s : { ...s, status: 'changed', stale: true, armed: null };
}

/** An out-of-date suggestion checked again (see checkSuggestion). */
function recheck(s: Suggestion, now: ProjectSnapshot, ctx: SongContext): Suggestion {
  if (s.epoch !== ctx.epoch) return { ...s, status: 'other_song' };
  if (s.outOfDateAt && !partsChanged(s.outOfDateAt, ctx.parts)) return s;
  const fit = classifySuggestion({ revision: 0, touchedHashes: s.touchedHashes, touchedNames: s.touchedNames }, { revision: 1, song: now });
  if (fit.status === 'out_of_date') return { ...s, outOfDate: fit.changed, outOfDateAt: ctx.parts };
  const { outOfDate: _o, outOfDateAt: _a, ...rest } = s;
  return sameSong(s, ctx) ? { ...rest, status: s.version > 1 ? 'changed' : 'waiting', stale: false, armed: null } : { ...rest, status: 'changed', stale: true, armed: null };
}

/** Why a suggestion whose ops no longer apply is out of date, on its card (and to its agent). */
export const NO_LONGER_FITS = 'its changes no longer fit the song as it is now';

/** A suggestion made again on the song now, if the song moved on since it was made (else as it is). */
export function freshen(s: Suggestion, now: ProjectSnapshot, ctx: SongContext): Suggestion {
  const checked = checkSuggestion(s, now, ctx);
  if (!isOpen(checked) || (!checked.stale && sameSong(checked, ctx))) return checked;
  const again = applyOps(now, { opsVersion: OPS_VERSION, ops: s.ops }, { idBase: s.idBase });
  // (the ops' errors quote what the agent wrote: the card says it in the app's own words instead)
  if (!again.ok) return { ...checked, status: 'out_of_date', outOfDate: [NO_LONGER_FITS], outOfDateAt: ctx.parts, armed: null };
  return { ...checked, status: 'changed', stale: false, armed: null, epoch: ctx.epoch, parts: ctx.parts, ext: ctx.ext, version: checked.version + 1, idBase: again.idBase, ...fromResult(again, checked.focus, now) };
}

export { barWords, rangesWords } from './songDiff';

/**
 * `s` with where its changes are heard found by sound: its rules' regions and the bars where the
 * song before (`before`, the song it was made on) and after render differently (`sound`), joined,
 * and what its before-and-after plays made again for them (hearingPlan). Never fewer bars than the
 * rules'. Heard before (only by the rules' regions), it's heard again only over all of them.
 */
export function withSoundRegions(s: Suggestion, sound: readonly BarRange[], before: Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>): Suggestion {
  const regions = joinRanges([...s.ruleRegions, ...sound]);
  const plan = hearingPlan(regions, s.fallback, s.focus, [before, s.song]);
  const grew = regions.length !== s.regions.length || regions.some((r, i) => r.fromBar !== s.regions[i].fromBar || r.toBar !== s.regions[i].toBar);
  return {
    ...s,
    regions,
    found: 'sound',
    foundWhy: undefined,
    soundRegions: sound.map((r) => ({ ...r })),
    audition: plan.plays,
    unheard: plan.unheard,
    limit: plan.limit,
    focusLeftOut: plan.focusLeftOut,
    ...(grew && s.heard === s.version ? { heard: null, partHeard: s.version } : {}),
  };
}

/** The regions of `s` (or the parts of them) its before-and-after plays: all of them, but what `unheard` leaves out. */
export function heardRegions(s: Pick<Suggestion, 'regions' | 'unheard'>): BarRange[] {
  if (!s.unheard) return s.regions.map((r) => ({ ...r }));
  return s.regions.flatMap((r) => without(r, s.unheard!));
}

/** How many bars ranges hold. */
const barCount = (list: readonly BarRange[]): number => list.reduce((n, r) => n + Math.max(1, Math.ceil(r.toBar) - Math.floor(r.fromBar)), 0);

/** The limit a before-and-after keeps to, in words: "it plays at most 90 seconds". */
export const limitWords = (limit: HearingLimit | null | undefined): string =>
  limit === 'bars' ? `a before-and-after plays at most ${LIMITS.listenMaxBars} bars` : `a before-and-after plays at most ${LIMITS.listenMaxSeconds} seconds`;

/** "bars 72-80 weren’t heard (a before-and-after plays at most 90 seconds)." */
export const unheardWords = (unheard: readonly BarRange[], limit: HearingLimit | null | undefined): string =>
  `${rangesWords(unheard)} ${barCount(unheard) > 1 ? 'weren’t' : 'wasn’t'} heard (${limitWords(limit)}).`;

/** A second press of Accept counts only this long after the first at the earliest, ms (a double-click doesn't confirm). */
export const CONFIRM_AFTER_MS = 700;
/** ...and at the latest, ms: after that the button is Accept again. */
export const ARMED_MS = 5000;

/** Whether Accept is waiting for its second press ("Accept without listening") at `at`. */
export const isArmed = (s: Pick<Suggestion, 'armed' | 'version'>, at = Date.now()): boolean => !!s.armed && s.armed.version === s.version && at - s.armed.at <= ARMED_MS;

/**
 * What Accept should do at time `at`: apply this song, or nothing (and why). Only what was heard
 * goes in with one press: the version the musician heard last, as the song is now. Otherwise the
 * first press says so and turns the button into "Accept without listening", and a second,
 * separate press (CONFIRM_AFTER_MS to ARMED_MS later, nothing changed meanwhile) accepts it
 * unheard. A press sooner than that is ignored (`ignored`).
 */
export function acceptDecision(
  s: Suggestion,
  now: ProjectSnapshot,
  ctx: SongContext,
  at = Date.now()
): { apply: ProjectSnapshot; suggestion: Suggestion } | { apply: null; suggestion: Suggestion; message: string; ignored?: boolean } {
  if (!isOpen(s)) return { apply: null, suggestion: s, message: 'This suggestion is no longer waiting.' };
  const fresh = freshen(s, now, ctx);
  if (fresh.status === 'other_song') return { apply: null, suggestion: fresh, message: 'This suggestion was made for another song: it can’t go in this one.' };
  if (fresh.status === 'out_of_date') return { apply: null, suggestion: fresh, message: `Out of date: ${fresh.outOfDate?.join('; ') ?? 'the song changed'}.` };
  if (fresh.heard === fresh.version) return { apply: fresh.song, suggestion: { ...fresh, armed: null } };
  if (isArmed(fresh, at)) {
    if (at - fresh.armed!.at >= CONFIRM_AFTER_MS) return { apply: fresh.song, suggestion: { ...fresh, armed: null } };
    return { apply: null, suggestion: fresh, message: '', ignored: true };
  }
  const message =
    fresh.partHeard === fresh.version && fresh.unheard
      ? `You heard only part of this: ${unheardWords(fresh.unheard, fresh.limit)} Press Accept without listening to take it all the same.`
      : fresh.partHeard === fresh.version
        ? `You heard only part of this: Suggested has to play through ${rangesWords(fresh.regions)}. Hear it to the end, or press Accept without listening.`
        : fresh.status === 'changed' && fresh.heard !== null
      ? 'The song changed since you heard this, so what would go in hasn’t been heard. Hear it again, or press Accept without listening.'
      : fresh.status === 'changed'
        ? 'You haven’t heard this, and the song changed since it was suggested. Hear it first, or press Accept without listening.'
        : 'You haven’t heard this yet. Hear it first, or press Accept without listening.';
  return { apply: null, suggestion: { ...fresh, armed: { version: fresh.version, at } }, message };
}

/**
 * An accepted suggestion that Undo took out (its undo step, named `step` at Accept, is now in the
 * redo history: `place` 'undone'), or that Redo put back ('done'). Only in the song it went into
 * (`epoch`); a step gone from the history says nothing. Decided by the step, not by what the song
 * holds, so putting the old values back by hand (or by another suggestion) isn't an undo.
 */
export function undoCheck(s: Suggestion, place: 'done' | 'undone' | null, epoch: number): Suggestion {
  if (!s.step || (s.status !== 'accepted' && s.status !== 'undone') || s.epoch !== epoch || !place) return s;
  if (s.status === 'accepted' && place === 'undone') return { ...s, status: 'undone' };
  if (s.status === 'undone' && place === 'done') return { ...s, status: 'accepted' };
  return s;
}

/** Change one suggestion in the store. */
export function updateSuggestion(id: string, patch: Partial<Suggestion> | ((s: Suggestion) => Suggestion)): void {
  useSuggestions.setState((st) => ({ suggestions: st.suggestions.map((s) => (s.id === id ? (typeof patch === 'function' ? patch(s) : { ...s, ...patch }) : s)) }));
}

/** At most one announcement for screen readers this often, ms (what comes meanwhile is said together after). */
export const ANNOUNCE_EVERY_MS = 4000;
/** An agent's words are said only this far, characters. */
export const ANNOUNCE_MAX_CHARS = 80;

/** `text` cut to `max` characters on a word, with an ellipsis if cut. */
export function shortText(text: string, max = ANNOUNCE_MAX_CHARS): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max / 2 ? cut.lastIndexOf(' ') : max).trimEnd()}…`;
}

/** What waits to be said together: in order, each once. */
export function mergeAnnouncements(texts: readonly string[]): string {
  const once = [...new Set(texts)];
  if (once.length <= 2) return once.join(' ');
  return `${once.slice(0, 2).join(' ')} And ${once.length - 2} more update${once.length === 3 ? '' : 's'} from your agent.`;
}

let lastSaid = -Infinity;
let waiting: string[] = [];
let sayTimer: ReturnType<typeof setTimeout> | null = null;

function flushAnnouncements() {
  sayTimer = null;
  if (!waiting.length) return;
  const wait = lastSaid + ANNOUNCE_EVERY_MS - Date.now();
  if (wait > 0) {
    sayTimer = setTimeout(flushAnnouncements, wait);
    return;
  }
  const text = mergeAnnouncements(waiting);
  waiting = [];
  lastSaid = Date.now();
  useSuggestions.setState({ announcement: text });
}

/** What waits to be said, and when the last announcement was (Date.now()): for the browser checks, to wait for the throttle deterministically. */
export const announcePending = (): { waiting: number; lastSaid: number } => ({ waiting: waiting.length, lastSaid });

/**
 * Say `text` in the live region: at most one announcement every ANNOUNCE_EVERY_MS, what comes
 * meanwhile merged into the next. `now`: the answer to the musician's own press, said at once.
 */
export function announce(text: string, now = false): void {
  if (now) {
    lastSaid = Date.now();
    useSuggestions.setState({ announcement: text });
    return;
  }
  waiting.push(text);
  if (!sayTimer) flushAnnouncements();
}
