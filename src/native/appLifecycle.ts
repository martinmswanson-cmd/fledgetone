/**
 * The phone app going to the background and coming back, and the Back button (Capacitor's App
 * plugin; nothing of this runs in a browser).
 *
 * Going away: the song is written to the autosave at once (a phone may close a background app
 * without warning), a take being recorded is stopped and kept, and on Android the song pauses and
 * the audio is let go (Android stops a web view's sound a little later anyway; an iPhone keeps
 * playing in the background, as the app asks it to). Coming back: a context the phone suspended
 * or interrupted (a call) is started again, silent, so the next Play works; nothing plays by itself.
 *
 * Back (Android): closes what's open, or goes back a step (backButton.ts); with nothing left, the
 * app goes to the background as Home would, keeping its place, rather than closing.
 *
 * A project file opened in the app from another (Android: "Open with" or "Share") opens as the
 * song, checked as any opened file is.
 */
import { flushAutosave, useTimelineStore } from '../store/timelineStore';
import { finishTakes } from '../audio/micRecorder';
import { holdAudio, rawAudioState, wakeAudio } from '../audio/engine';
import { goBack } from './backButton';
import { isAndroidApp, isNativeApp, onOpenedFiles } from './nativeApp';
import { showToast } from '../components/timeline/toastStore';

/** Gone to the background: keep the work, the take, and (Android) stop the sound. */
async function wentAway(): Promise<void> {
  flushAutosave();
  // (Stopping a take pauses the song too; the take is kept in the song, then autosaved)
  await finishTakes();
  if (isAndroidApp()) {
    const st = useTimelineStore.getState();
    if (st.isPlaying) st.pause();
    holdAudio();
  }
  flushAutosave();
}

/** Back in front: a context left suspended or interrupted is ready again, without playing anything. */
function cameBack(): void {
  const st = useTimelineStore.getState();
  // The phone interrupted it (a call) while it played: stopped, so the next Play starts it cleanly
  if (st.isPlaying && rawAudioState() !== 'running') st.pause();
  void wakeAudio();
}

let started = false;

/** Listen for the app going away and coming back, and for Back (once, from main.tsx). */
export function startAppLifecycle(): void {
  if (started || !isNativeApp()) return;
  started = true;
  void import('@capacitor/app')
    .then(({ App }) => {
      void App.addListener('appStateChange', ({ isActive }) => void (isActive ? cameBack() : wentAway()));
      if (isAndroidApp()) {
        void App.addListener('backButton', () => {
          if (!goBack()) void App.minimizeApp();
        });
      }
    })
    .catch(() => {});
  onOpenedFiles(
    (file) =>
      void import('../components/timeline/projectFile').then(async ({ openProjectFromFile }) => {
        const problem = await openProjectFromFile(file);
        showToast(problem ?? `Opened ${file.name}`);
      }),
    (reason) => showToast(`Couldn't open the file: ${reason}`)
  );
}
