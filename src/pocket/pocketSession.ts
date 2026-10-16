/**
 * Pocket's care for the phone it runs on: the last song opens again by itself (a phone reloads a
 * page it put away more often than a computer does), the screen stays awake while the song plays,
 * and a light buzz answers a pad where the phone can.
 */
import { useEffect } from 'react';
import { clearPreviousSession, hasWork } from '../store/project';
import { currentProject, retryAutosave, useLastSession, useTimelineStore } from '../store/timelineStore';

/**
 * At startup: when the song open is empty and the last session (found at startup, not one set
 * aside by New or a link) has work in it, open it again. Returns whether it did.
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

type WakeLock = { release: () => Promise<void> };

/** Keep the screen on while the song plays (where the browser can), so it doesn't lock mid-song. */
export function useWakeWhilePlaying(): void {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  useEffect(() => {
    const wake = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLock> } }).wakeLock;
    if (!isPlaying || !wake) return;
    let lock: WakeLock | null = null;
    let gone = false;
    const take = () => {
      if (document.visibilityState !== 'visible') return;
      wake.request('screen').then(
        (l) => {
          if (gone) void l.release();
          else lock = l;
        },
        () => {}
      );
    };
    take();
    // The browser lets go when the page is hidden: take it again on coming back
    document.addEventListener('visibilitychange', take);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => {});
    };
  }, [isPlaying]);
}

/** A short buzz, on phones that have one (Android; iPhones ignore it). */
export function buzz(ms = 8): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Not allowed here: fine
  }
}
