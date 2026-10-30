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
 * first, so what's heard is what Accept would put in, and the version heard is noted, once its
 * Suggested side (B) has played (noteHeard: hearing only Now hears nothing of the suggestion).
 */
import { currentProject, onProjectReplaced, songGeneration, songParts, stepPlace, useTimelineStore } from '../store/timelineStore';
import { forgetAudition, startAudition, stopAudition, useAudition, type AuditionState } from '../audio/auditionPlayer';
import { listenSnapshot } from './listenSnapshot';
import { checkSuggestion, coveredBy, extKey, freshen, isOpen, undoCheck, updateSuggestion, useSuggestions, type SongContext, type Suggestion } from './suggestionsStore';
import { partsChanged } from './revision';

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

/** What's rendered for a suggestion's version (the audition's renderKey). */
export const renderKeyOf = (s: Pick<Suggestion, 'id' | 'version'>): string => `${s.id}:${s.version}`;

/**
 * Whether the audition playing now is suggestion `s` as it is: its current version, made on the
 * song as it is now (not stale). Otherwise Now and Suggested render it again (hearSuggestion).
 */
export function auditionCurrent(s: Suggestion, a: Pick<AuditionState, 'key' | 'renderKey' | 'phase'> = useAudition.getState()): boolean {
  return a.key === s.id && a.phase === 'playing' && a.renderKey === renderKeyOf(s) && !s.stale && isOpen(s);
}

/**
 * Note a suggestion heard once its Suggested side (B) plays, of its current version on the song as
 * it is now, over every region where a change of it is heard (each played whole): only then does
 * one press of Accept take it. Played over only some of them (too long to hear at once), it's
 * heard in part (`partHeard`): the card says which bars weren't, and Accept still asks for its
 * second press. Run on every change of the audition.
 */
export function noteHeard(a: AuditionState = useAudition.getState()): void {
  if (a.key === null || a.phase !== 'playing' || a.hearing !== 'b') return;
  const s = useSuggestions.getState().suggestions.find((x) => x.id === a.key);
  if (!s || s.heard === s.version || !auditionCurrent(s, a)) return;
  // (every region where a change is heard, each played whole)
  const played = a.plays ?? [];
  const all = !s.unheard && s.regions.every((r) => coveredBy(played, r));
  if (!all) {
    if (s.partHeard !== s.version) updateSuggestion(s.id, { partHeard: s.version });
    return;
  }
  // (heard now: an "Accept without listening" waiting from before goes back to Accept)
  updateSuggestion(s.id, { heard: s.version, armed: null });
}
useAudition.subscribe((a) => noteHeard(a));

/**
 * Hear suggestion `id` against the song now (its audition: each region where a change is heard, one after another, with the agent's focus if that fits), made again on
 * the song as it is first. Once its Suggested side plays, that version counts as heard (noteHeard).
 */
export async function hearSuggestion(id: string, hearing: 'a' | 'b' = 'b'): Promise<void> {
  const found = useSuggestions.getState().suggestions.find((x) => x.id === id);
  if (!found || !isOpen(found)) return;
  const nowSong = currentProject();
  const s = freshen(found, nowSong, songContext());
  if (s !== found) updateSuggestion(id, s);
  if (!isOpen(s)) return;
  // The song's own playback pauses (two things at once would be a mess)
  if (useTimelineStore.getState().isPlaying) useTimelineStore.getState().pause();
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
}
