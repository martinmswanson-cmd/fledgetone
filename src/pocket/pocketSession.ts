/**
 * Pocket's care for the phone it runs on: the last song opens again by itself (a phone reloads a
 * page it put away more often than a computer does), the screen stays awake while the song plays,
 * and a light buzz answers a pad where the phone can.
 */
import { useEffect } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { isNativeApp, nativeKeepAwake, nativeTap } from '../native/nativeApp';

export { reopenLastSong } from '../store/reopenLastSong';

type WakeLock = { release: () => Promise<void> };

/** Keep the screen on while the song plays (where the browser can), so it doesn't lock mid-song. */
export function useWakeWhilePlaying(): void {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  useEffect(() => {
    // (The app keeps the screen on itself)
    if (isNativeApp()) {
      nativeKeepAwake(isPlaying);
      return () => nativeKeepAwake(false);
    }
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

/** A short buzz, on phones that have one (Android; iPhones ignore it in a browser; the app taps). */
export function buzz(ms = 8): void {
  if (isNativeApp()) return nativeTap();
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Not allowed here: fine
  }
}
