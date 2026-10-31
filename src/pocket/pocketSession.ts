/**
 * Pocket's care for the phone it runs on: the last song opens again by itself (a phone reloads a
 * page it put away more often than a computer does), the screen stays awake while the song plays,
 * a light buzz answers a pad where the phone can, and Play plays what Pocket shows.
 */
import { useEffect } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { isNativeApp, nativeKeepAwake, nativeTap } from '../native/nativeApp';

export { reopenLastSong, useOpenedMark } from '../store/reopenLastSong';

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

const EPS = 1e-6;

/** Where the song ends (bars), for playing it from the top when it's already there. */
function songEndBar(): number {
  return useTimelineStore.getState().clips.reduce((e, c) => Math.max(e, c.startBar + c.lengthBars), 1);
}

/**
 * Pocket's Play: pause if playing; else the loop (the selected section `sec`, from its start if
 * the playhead is outside it) or the song (from the top if it's at the end). Resolves once started.
 */
export function playPocket(sec: { from: number; to: number } | null | undefined): Promise<void> {
  const st = useTimelineStore.getState();
  if (st.isPlaying) {
    st.pause();
    return Promise.resolve();
  }
  if (st.loopRegion.enabled) {
    if (sec && (Math.abs(st.loopRegion.inBar - sec.from) > EPS || Math.abs(st.loopRegion.outBar - sec.to) > EPS)) st.setLoopRange(sec.from, sec.to);
    if (sec && (st.playheadPosition < sec.from - EPS || st.playheadPosition >= sec.to - EPS)) st.seek(sec.from);
  } else if (st.playheadPosition >= songEndBar() - EPS) st.seek(1);
  return st.play();
}
