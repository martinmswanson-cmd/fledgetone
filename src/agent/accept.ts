/**
 * Accept and Dismiss, the musician's answers to a suggestion. Accept puts the song as it was heard
 * into the store as one undo step (a checkpoint, then one change of the tracks, clips, markers,
 * tempo and master), after checking it still fits (see acceptDecision: for another song, out of
 * date, or applied again to the song as it is now and to be heard again first). Then what the store's own actions
 * would have done on the side: the live mix's master and tempo-synced effects, and the recordings
 * of instruments the suggestion chose. Only a real click or key press accepts: a click made by a
 * script (an event that isn't trusted) does nothing.
 */
import { currentProject, masterFxOf, tagLastStep, useTimelineStore } from '../store/timelineStore';
import type { ProjectSnapshot } from '../store/project';
import type { Track } from '../store/timelineTypes';
import { liveMix } from '../audio/engine';
import { setLiveStripTempo } from '../audio/liveTracks';
import { hasRecordings, loadQuick } from '../audio/samplers/samplerManager';
import { forgetAudition, stopAudition, useAudition } from '../audio/auditionPlayer';
import { acceptDecision, isOpen, updateSuggestion, useSuggestions, type Suggestion } from './suggestionsStore';
import { songContext } from './songWatch';

/** What of a track only the moment holds (see revision.ts): kept as the studio has it at Accept. */
const MOMENT = ['isArmed', 'frozen', 'freezing', 'midiMap'] as const;

/** Put `song`'s edited parts into the store as one undo step. */
export function applyAsOneStep(song: ProjectSnapshot): void {
  const tl = useTimelineStore.getState();
  const before = tl.tracks;
  // What only the screen or the moment holds stays as it is now (a suggestion's song kept the
  // selection, the folded folders, the armed track, the freezes and the MIDI knobs of when it was
  // made, and changing those isn't an edit, see revision.ts; a freeze the suggestion's changes
  // make out of date plays live, see freeze.ts)
  const selected = new Set(tl.clips.filter((c) => c.isSelected).map((c) => c.id));
  const folded = new Map(tl.tracks.flatMap((t) => (t.folder ? [[t.folder.id, t.folder.collapsed] as const] : [])));
  const current = new Map(tl.tracks.map((t) => [t.id, t]));
  const clips = song.clips.map((c) => (c.isSelected === selected.has(c.id) ? c : { ...c, isSelected: selected.has(c.id) }));
  const tracks = song.tracks.map((given) => {
    const was = current.get(given.id);
    let t = given;
    const differs = (k: (typeof MOMENT)[number]) => !!was && JSON.stringify(t[k]) !== JSON.stringify(was[k]);
    if (was && MOMENT.some(differs)) {
      const next: Record<string, unknown> = { ...t };
      for (const k of MOMENT) if (was[k] === undefined) delete next[k];
      else next[k] = was[k];
      t = next as unknown as Track;
    }
    if (!t.folder || !folded.has(t.folder.id) || !!t.folder.collapsed === !!folded.get(t.folder.id)) return t;
    const { collapsed: _c, ...open } = t.folder;
    return { ...t, folder: folded.get(t.folder.id) ? { ...open, collapsed: true } : open };
  });
  tl.checkpoint();
  useTimelineStore.setState({
    tracks,
    clips,
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
  for (const t of tracks) if (had.get(t.id) !== t.instrumentKey && hasRecordings(t.instrumentKey)) void loadQuick(t.instrumentKey).catch(() => {});
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
  // (its undo step is named, so an undo or redo of exactly that step is told apart from the old values coming back)
  const step = `${id}@${Date.now()}`;
  updateSuggestion(id, { ...decision.suggestion, status: 'accepted', step });
  applyAsOneStep(decision.apply);
  tagLastStep(step);
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
