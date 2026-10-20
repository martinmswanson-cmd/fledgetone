/**
 * At startup, the studio and Pocket both open the last song again by itself (a reload, or coming
 * back the next day, carries on where you were), rather than an empty timeline with an offer to
 * restore it: an offer that's easy to miss, and that a newer session would replace.
 */
import { clearPreviousSession, hasWork } from './project';
import { currentProject, retryAutosave, useLastSession, useTimelineStore } from './timelineStore';

/**
 * When the song open is empty and the last session (found at startup, not one set aside by New or
 * a link) has work in it, open it again. Returns whether it did.
 */
export function reopenLastSong(): boolean {
  const session = useLastSession.getState().session;
  if (!session || session.replaced || hasWork(currentProject())) return false;
  clearPreviousSession(false);
  retryAutosave();
  useLastSession.setState({ session: null });
  useTimelineStore.getState().loadProject(session.project);
  return true;
}
