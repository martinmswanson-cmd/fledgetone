/**
 * At startup, the studio and Pocket both open the last song again by itself (a reload, or coming
 * back the next day, carries on where you were), rather than an empty timeline with an offer to
 * restore it: an offer that's easy to miss, and that a newer session would replace.
 *
 * Except a song that stopped the app from showing (see StudioGuard.tsx): a song is noted as
 * opening until the app has shown it (useOpenedMark), so one that never showed is offered back
 * instead of opened again, and kept as a version; the recovery screen sets the open one aside.
 */
import { useEffect } from 'react';
import { clearPreviousSession, hasWork, markOpened, markOpening, sessionLeftOut, setAsideStoppedSong, type ProjectSnapshot } from './project';
import { showToast } from '../components/timeline/toastStore';
import { currentProject, onProjectReplaced, retryAutosave, useLastSession, useTimelineStore } from './timelineStore';
import { keepVersion, keptVersion } from './versions';

/**
 * When the song open is empty and the last session (found at startup, not one set aside by New or
 * a link) has work in it, open it again. Returns whether it did.
 */
export function reopenLastSong(): boolean {
  const session = useLastSession.getState().session;
  // (A song that stopped the app from showing is kept as a version too: the banner's offer goes when a newer session takes its place)
  if (session?.stoppedNow) keepVersion(session.project, 'stopped');
  if (!session || session.replaced || session.stopped || hasWork(currentProject())) return false;
  clearPreviousSession(false);
  retryAutosave();
  useLastSession.setState({ session: null });
  useTimelineStore.getState().loadProject(session.project);
  sayWhatWasLeftOut(session.project);
  return true;
}

/**
 * After the last session (found at startup) opened without some of it: say so, and where its
 * full copy is. Studio and Pocket, whether it opened by itself or from the offer to restore it.
 */
export function sayWhatWasLeftOut(project: ProjectSnapshot): void {
  if (!project.unread || !sessionLeftOut) return;
  const where = sessionLeftOut.keptApart
    ? "Its full copy is kept in this browser, apart, so nothing writes over it."
    : "Its full copy stays where it was in this browser, so nothing writes over it (there's no room to keep it apart).";
  showToast(`Your last session opened without ${sessionLeftOut.words}. ${where}`);
}

/** How long the app shows a song that has just opened before it counts as shown. */
const SHOWN_AFTER_MS = 1000;

/**
 * In the studio and in Pocket (inside StudioGuard): once a song that opened has been shown for a
 * moment, it's no longer noted as opening. Unmounted by a crash first, it stays noted; so does one
 * that took more than a few seconds to get there (it froze the app: markOpened, SLOW_OPEN_MS).
 */
export function useOpenedMark(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => markOpened(useTimelineStore.getState().songId), SHOWN_AFTER_MS);
    };
    later();
    const off = onProjectReplaced(later);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
}

/** The app stopped showing (StudioGuard caught it): the song open stays noted, so it doesn't open again by itself. */
export function noteStopped(): void {
  try {
    markOpening(currentProject().songId ?? '');
  } catch {
    markOpening('');
  }
}

/**
 * The recovery screen's "set it aside and start fresh": the song open is kept as a version and
 * where the Restore banner offers it (never opened again by itself), and the autosave cleared.
 * Resolves once it's stored; the screen then loads the app afresh.
 */
export async function setAsideAndStartFresh(): Promise<void> {
  let song;
  try {
    song = currentProject();
  } catch {
    return;
  }
  await keptVersion(song, 'stopped');
  setAsideStoppedSong(song);
}
