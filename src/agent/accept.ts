/**
 * Accept and Dismiss, the musician's answers to a suggestion. Accept puts the song as it was heard
 * into the store as one undo step (a checkpoint, then one change of the tracks, clips, markers,
 * tempo and master), after checking it still fits (see acceptDecision: for another song, out of
 * date, or applied again to the song as it is now and to be heard again first). Then what the store's own actions
 * would have done on the side: the live mix's master and tempo-synced effects, and the recordings
 * of instruments the suggestion chose. Only a real click or key press accepts: a click made by a
 * script (an event that isn't trusted) does nothing.
 */
import { currentProject, masterFxOf, useTimelineStore } from '../store/timelineStore';
import type { ProjectSnapshot } from '../store/project';
import { liveMix } from '../audio/engine';
import { setLiveStripTempo } from '../audio/liveTracks';
import { hasRecordings, loadQuick } from '../audio/samplers/samplerManager';
import { forgetAudition, stopAudition, useAudition } from '../audio/auditionPlayer';
import { acceptDecision, appliedRecord, isOpen, updateSuggestion, useSuggestions, type Suggestion } from './suggestionsStore';
import { songContext } from './songWatch';

/** Put `song`'s edited parts into the store as one undo step. */
export function applyAsOneStep(song: ProjectSnapshot): void {
  const tl = useTimelineStore.getState();
  const before = tl.tracks;
  tl.checkpoint();
  useTimelineStore.setState({
    tracks: song.tracks,
    clips: song.clips,
    markers: song.markers ?? [],
    bpm: song.bpm,
    tempoPoints: song.tempoPoints ?? [],
    ...(song.master ? { master: song.master } : {}),
    selectedTrackId: song.tracks.some((t) => t.id === tl.selectedTrackId) ? tl.selectedTrackId : (song.tracks[0]?.id ?? null),
  });
  // What the store's setters do besides: the master section and the tempo-synced effects in the live mix
  const s = useTimelineStore.getState();
  liveMix.inserts.apply(s.master);
  liveMix.busFx.apply(masterFxOf(s), s.bpm);
  setLiveStripTempo(s.bpm);
  // Instruments the suggestion chose that play recordings: their sounds start loading now
  const had = new Map(before.map((t) => [t.id, t.instrumentKey]));
  for (const t of song.tracks) if (had.get(t.id) !== t.instrumentKey && hasRecordings(t.instrumentKey)) void loadQuick(t.instrumentKey).catch(() => {});
}

const find = (id: string): Suggestion | undefined => useSuggestions.getState().suggestions.find((s) => s.id === id);

/**
 * Accept suggestion `id`. `event` is the click or key press that asked: one a script made isn't
 * an answer. Returns null when accepted, '' when the press is ignored, else what to tell the musician. The suggestion is marked
 * accepted before the song changes, so nothing (and no agent) ever sees it out of date on the way.
 */
export function acceptSuggestion(id: string, event: { isTrusted: boolean } | null): string | null {
  if (!event?.isTrusted) return 'Accept with a click or a key press.';
  const s = find(id);
  if (!s) return 'That suggestion is gone.';
  const before = currentProject();
  const decision = acceptDecision(s, before, songContext(), Date.now());
  if (!decision.apply) {
    // (a second press too soon after the first: not a separate, deliberate press)
    if (decision.ignored) return '';
    updateSuggestion(id, decision.suggestion);
    if (!isOpen(decision.suggestion)) forgetAudition(id);
    return decision.message;
  }
  if (useAudition.getState().key === id) stopAudition();
  updateSuggestion(id, { ...decision.suggestion, status: 'accepted', applied: appliedRecord(decision.suggestion, before) });
  applyAsOneStep(decision.apply);
  forgetAudition(id);
  return null;
}

/** Dismiss suggestion `id` (from a real click or key press only). */
export function dismissSuggestion(id: string, event: { isTrusted: boolean } | null): void {
  if (!event?.isTrusted) return;
  const s = find(id);
  if (!s || (!isOpen(s) && s.status !== 'out_of_date' && s.status !== 'other_song')) return;
  updateSuggestion(id, { status: 'dismissed' });
  forgetAudition(id);
}
