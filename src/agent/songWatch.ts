/**
 * Keeping the suggestions true to the song: the song now as a suggestion is checked against it
 * (songContext), the check itself over every suggestion (refreshSuggestions: for another song, out
 * of date, changed; accepted ones taken out by an undo or put back by a redo), and the watch that
 * runs it a moment after the song changes (at most every WATCH_MS, so dragging notes costs little:
 * nothing is applied again until it's heard or accepted) and at once when another song is opened.
 * The watch runs while the agent is connected or the Suggestions panel is open (watchSong is
 * counted: each caller gets its own stop).
 *
 * Hearing a suggestion lives here too (hearSuggestion): it's made again on the song as it is now
 * first, so what's heard is what Accept would put in; where its changes are heard is found by
 * sound if it isn't yet (whereHeard.ts: the song rendered whole before and after, bar against
 * bar); and the version heard is noted once its Suggested side (B) has really played through
 * every place its changes are heard (noteHeard: hearing only Now, or stopping early, isn't
 * hearing it).
 */
import { currentProject, onProjectReplaced, songGeneration, songParts, stepPlace, useTimelineStore } from '../store/timelineStore';
import { forgetAudition, startAudition, stopAudition, useAudition, type AuditionState } from '../audio/auditionPlayer';
import { listenSnapshot } from './listenSnapshot';
import { checkSuggestion, extKey, playedThrough, freshen, hearingByRules, isOpen, uncheckedTail, undoCheck, updateSuggestion, useSuggestions, type SongContext, type Suggestion } from './suggestionsStore';
import { partsChanged } from './revision';
import { findWhere, needsFinding, stopFinding, useFinding } from './whereHeard';

/** How often the watch looks at most, ms. */
export const WATCH_MS = 150;

/** The song now, as suggestions are checked against it. */
export function songContext(): SongContext {
  const s = useTimelineStore.getState();
  return { epoch: songGeneration(), parts: songParts(s) as unknown as Record<string, unknown>, ext: extKey(s.swing, s.intensity) };
}

/** Stop hearing a suggestion that can't be accepted any more. */
function stopIfClosed(list: readonly Suggestion[]) {
  const a = useAudition.getState();
  if (a.key === null) return;
  const s = list.find((x) => x.id === a.key);
  if (s && !isOpen(s)) stopAudition();
}

/** Check every suggestion against the song now (cheaply: nothing is applied again here). */
export function refreshSuggestions(ctx = songContext()): void {
  const list = useSuggestions.getState().suggestions;
  if (!list.length) return;
  const now = currentProject();
  const next = list.map((s) => undoCheck(checkSuggestion(s, now, ctx), s.step ? stepPlace(s.step) : null, ctx.epoch));
  if (next.some((x, i) => x !== list[i])) useSuggestions.setState({ suggestions: next });
  stopIfClosed(next);
}

let users = 0;
let stopWatch: (() => void) | null = null;
const listeners = new Set<(ctx: SongContext) => void>();

/**
 * Watch the song (see the file's comment) until the returned function is called. `onChange`, if
 * given, hears each change of the song after the suggestions were checked.
 */
export function watchSong(onChange?: (ctx: SongContext) => void): () => void {
  users++;
  if (onChange) listeners.add(onChange);
  if (!stopWatch) {
    let last = songContext();
    let timer = 0;
    const run = () => {
      timer = 0;
      const ctx = songContext();
      if (ctx.epoch === last.epoch && ctx.ext === last.ext && !partsChanged(last.parts, ctx.parts)) return;
      last = ctx;
      refreshSuggestions(ctx);
      listeners.forEach((l) => l(ctx));
    };
    const unsub = useTimelineStore.subscribe(() => {
      if (!timer) timer = window.setTimeout(run, WATCH_MS);
    });
    // Another song: what's being heard stops now, and the suggestions say they're for another song
    const unsubReplaced = onProjectReplaced(() => {
      stopAudition();
      queueMicrotask(run);
    });
    refreshSuggestions(last);
    stopWatch = () => {
      unsub();
      unsubReplaced();
      window.clearTimeout(timer);
    };
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (onChange) listeners.delete(onChange);
    if (--users === 0 && stopWatch) {
      stopWatch();
      stopWatch = null;
    }
  };
}

/**
 * What's rendered for a suggestion's version and what it plays (the audition's renderKey): found
 * by sound while it plays, and with more to play then, it's a new render (what played of the old
 * one doesn't count for it).
 */
export const renderKeyOf = (s: Pick<Suggestion, 'id' | 'version' | 'audition'>): string => `${s.id}:${s.version}:${s.audition.map((r) => `${r.fromBar}-${r.toBar}`).join(',')}`;

/**
 * Whether the audition playing now is suggestion `s` as it is: its current version, made on the
 * song as it is now (not stale). Otherwise Now and Suggested render it again (hearSuggestion).
 */
export function auditionCurrent(s: Suggestion, a: Pick<AuditionState, 'key' | 'renderKey' | 'phase'> = useAudition.getState()): boolean {
  return a.key === s.id && a.phase === 'playing' && a.renderKey === renderKeyOf(s) && !s.stale && isOpen(s);
}

/** Whether what B played (heardB) is of `s` as it is: its current version, on the song as it is now (whichever plan for it played). */
const playedVersion = (s: Suggestion, a: Pick<AuditionState, 'key' | 'renderKey'>): boolean => a.key === s.id && !s.stale && isOpen(s) && !!a.renderKey?.startsWith(`${s.id}:${s.version}:`);

/**
 * Note a suggestion heard once its Suggested side (B), of its current version on the song as it
 * is now, has played through every region where a change of it is heard: B's playhead went
 * through each of their bars, to its end, at least once while B was heard (heardB). Only then does
 * one press of Accept take it. Before that (B played, but not all of it yet: stopped early,
 * switched to Now, or too long to hear at once) it's heard in part (`partHeard`): the card says
 * so, and Accept still asks for its second press. So is one not checked by sound whose rules may
 * count fewer bars than the truth (uncheckedTail: a tail the studio doesn't know, and not found
 * by sound, or not yet), however much of it played. Run on every change of the audition and of
 * the suggestions: a check by sound that finishes after B stopped decides it by what B played.
 */
export function noteHeard(a: AuditionState = useAudition.getState()): void {
  if (a.key === null || !a.heardB.length) return;
  noteHeardByRules(a);
  const s = useSuggestions.getState().suggestions.find((x) => x.id === a.key);
  if (!s || s.heard === s.version) return;
  // (what B played of this version counts, playing or stopped since, whichever plan for it played:
  // a sound check that finishes later and finds nothing past it leaves it heard)
  if (!playedVersion(s, a)) return;
  // (every bar of every region where a change is heard, played through on B)
  // (not checked by sound, with a tail the studio doesn't know: never heard all through)
  const played = !s.unheard && s.regions.every((r) => playedThrough(a.heardB, r));
  const unchecked = uncheckedTail(s);
  if (!played || unchecked) {
    // (`partUnchecked`: every region played, but it isn't checked by sound: the card says that, not what's left to play)
    const partUnchecked = played && unchecked;
    if (s.partHeard !== s.version || !!s.partUnchecked !== partUnchecked) updateSuggestion(s.id, { partHeard: s.version, partUnchecked });
    return;
  }
  // (heard now: an "Accept without listening" waiting from before goes back to Accept)
  updateSuggestion(s.id, { heard: s.version, armed: null });
}

/**
 * Note a suggestion heard by its rules alone (`heardByRules`, what an agent not allowed to listen
 * reads as `heard`) once B, of its current version on the song as it is now, has played through
 * every region the rules found (all of them within what a before-and-after can play): whatever
 * the sound check found, and whichever plan for it is playing (one found by sound before it plays
 * the same version), so nothing of what the renders found shows in it.
 */
function noteHeardByRules(a: AuditionState): void {
  const s = useSuggestions.getState().suggestions.find((x) => x.id === a.key);
  if (!s || s.heardByRules === s.version || !playedVersion(s, a)) return;
  if (hearingByRules(s, currentProject()).unheard || !s.ruleRegions.every((r) => playedThrough(a.heardB, r))) return;
  updateSuggestion(s.id, { heardByRules: s.version });
}
useAudition.subscribe((a) => noteHeard(a));
// (found by sound while it plays, with nothing more to play: what played still counts)
useSuggestions.subscribe((st, prev) => st.suggestions !== prev.suggestions && noteHeard());

/**
 * Hear suggestion `id` against the song now (its audition: each region where a change is heard, one after another, with the agent's focus if that fits), made again on
 * the song as it is first. Once its Suggested side plays, that version counts as heard (noteHeard).
 */
export async function hearSuggestion(id: string, hearing: 'a' | 'b' = 'b'): Promise<void> {
  const found = useSuggestions.getState().suggestions.find((x) => x.id === id);
  if (!found || !isOpen(found)) return;
  const nowSong = currentProject();
  const fresh = freshen(found, nowSong, songContext());
  if (fresh !== found) updateSuggestion(id, fresh);
  if (!isOpen(fresh)) return;
  // The song's own playback pauses (two things at once would be a mess)
  if (useTimelineStore.getState().isPlaying) useTimelineStore.getState().pause();
  stopAudition();
  // Where its changes are heard by sound (both versions rendered whole) is found while it plays,
  // never waited for: it plays the rules' regions at once (never fewer bars than the truth), and
  // once found, anything more to hear makes it heard only in part until that's played too.
  // (another suggestion's search stops, so the before-and-after renders first)
  if (useFinding.getState().id !== id) stopFinding();
  const s = useSuggestions.getState().suggestions.find((x) => x.id === id);
  if (!s || !isOpen(s) || s.version !== fresh.version || s.stale) return;
  if (needsFinding(s) && useFinding.getState().id === id) void findWhere(id, nowSong);
  await startAudition({
    key: id,
    renderKey: renderKeyOf(s),
    now: listenSnapshot(nowSong),
    suggested: listenSnapshot(s.song),
    plays: s.audition,
    hearing,
  });
  noteHeard();
  const after = useSuggestions.getState().suggestions.find((x) => x.id === id);
  if (after && !isOpen(after)) forgetAudition(id);
  else if (after && needsFinding(after) && useAudition.getState().key === id && useAudition.getState().phase === 'playing') void findWhere(id, nowSong);
}
