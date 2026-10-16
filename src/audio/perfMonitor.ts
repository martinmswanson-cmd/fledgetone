import { PLAYBACK_MODE, storedPlaybackChoice, switchToStableByItself } from './playbackMode';
import { shouldSwitchToStable } from './playbackChoice';
import { showToast } from '../components/timeline/toastStore';
import { create } from 'zustand';
import { lateNotes } from './presets/monotonic';
import { useTimelineStore } from '../store/timelineStore';
import { releaseAllLiveVoices } from './liveTracks';
import { forgetSampleSets, forgetUnusedSamples, loadedSampleKeys } from './samplers/samplerManager';
import { forgetDecodedSounds } from './soundLibrary';
import { referencedSoundIds } from '../store/audioClips';
import type { InstrumentKey } from './instrumentCatalog';
import { liveContext, restoreLookAhead, widenLookAhead } from './liveContext';
import { capFrameRate } from '../components/frameTicker';

/**
 * Notices when playback can't keep up, and frees memory on request.
 *
 * Three signs are watched while the song plays: notes reaching the audio engine after their time
 * (counted in notLate), the page freezing for a moment (an animation frame arriving late, when
 * the main thread was busy), and the audio engine falling behind. The audio clock counts the sound
 * actually made, so when the audio thread can't finish each block in time (too many voices and
 * effects at once: the sound crackles) it advances slower than the wall clock; under 97% of real
 * time over a few seconds counts. A few of the first two in a few seconds, or the third, counts as
 * lagging; a while without any clears it.
 *
 * It also steps in: at the first late note or freeze of a playback, the Transport schedules further
 * ahead (liveContext.ts) so later freezes are absorbed instead of heard, until Stop; and while
 * lagging, the readouts that move with the sound (meters, the spectrum) draw less often, to leave
 * the page's time to the music.
 */

interface PerfState {
  /** Playback is struggling right now */
  lagging: boolean;
  /** In the last few seconds */
  lateNotes: number;
  /** Page freezes (frames over 100 ms apart) in the last few seconds */
  hitches: number;
  /** The longest freeze in the last few seconds, ms */
  worstFrame: number;
  /** How fast the audio clock ran over the last few seconds of playing, as a share of real time (null: not measured yet) */
  audioSpeed: number | null;
  /** The page's JavaScript memory in use, MB, where the browser says (Chrome) */
  memoryMB: number | null;
  /** Scheduling further ahead for this playback, after a late note or a freeze (until Stop) */
  smoothing: boolean;
  /** The warning was closed: don't show it again until playback stops and starts */
  dismissed: boolean;
  /** Lag came back after smoothing in this session, so the next start uses Stable playback (playbackMode.ts) */
  stableNext: boolean;
  dismiss: () => void;
}

export const usePerfStore = create<PerfState>((set) => ({
  lagging: false,
  lateNotes: 0,
  hitches: 0,
  worstFrame: 0,
  audioSpeed: null,
  memoryMB: null,
  smoothing: false,
  dismissed: false,
  stableNext: false,
  dismiss: () => set({ dismissed: true }),
}));

const WINDOW_MS = 4000;
const HITCH_MS = 100;
/** A frame this late while playing is enough to start scheduling further ahead (notes are handed over 0.1 s early). */
const SMOOTH_MS = 70;
/** The readouts' frame rate while lagging. */
const CALM_FPS = 10;
/** The audio clock is measured over this long (ms), and counts as behind under this share of real time. */
const AUDIO_WINDOW_MS = 3000;
const AUDIO_BEHIND = 0.97;

const memoryMB = (): number | null => {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
};

let started = false;
/** A playback on this page has needed the wider look-ahead: later ones start with it. */
let needsSmoothing = false;
/** Set by clearMemory: the monitor starts counting afresh. */
let restart = false;
/** How long an instrument's recordings stay loaded after no track uses it (ms) */
const UNUSED_MS = 3 * 60 * 1000;

/** Start watching (once, at startup). */
export function startPerfMonitor(): void {
  if (started) return;
  started = true;
  let episodes = 0;
  let lastFrame = performance.now();
  const hitchTimes: Array<{ at: number; ms: number }> = [];
  const lateTimes: number[] = [];
  let seenLate = lateNotes.count;
  let calmSince = performance.now();
  let wasPlaying = false;
  /** (wall clock ms, audio clock s) while playing, over the last AUDIO_WINDOW_MS */
  const clocks: Array<{ wall: number; audio: number }> = [];

  const frame = () => {
    const now = performance.now();
    const gap = now - lastFrame;
    lastFrame = now;
    const playing = useTimelineStore.getState().isPlaying;
    if (playing && !wasPlaying) {
      usePerfStore.setState({ dismissed: false });
      // A playback that needed it once starts with it next time (this page): a heavy song's first
      // seconds are its busiest
      if (needsSmoothing && widenLookAhead()) usePerfStore.setState({ smoothing: true });
    }
    // A hidden tab gets no frames at all: that's not lag
    if (playing && wasPlaying && gap > HITCH_MS && !document.hidden) hitchTimes.push({ at: now, ms: gap });
    if (!playing && wasPlaying) {
      restoreLookAhead();
      if (usePerfStore.getState().smoothing) usePerfStore.setState({ smoothing: false });
    }
    // The first sign of trouble in a playback: absorb the next ones
    if (playing && wasPlaying && ((gap > SMOOTH_MS && !document.hidden) || lateNotes.count > seenLate)) {
      needsSmoothing = true;
      if (widenLookAhead()) usePerfStore.setState({ smoothing: true });
    }
    wasPlaying = playing;
    if (restart) {
      restart = false;
      hitchTimes.length = 0;
      lateTimes.length = 0;
      seenLate = lateNotes.count;
      calmSince = 0;
      clocks.length = 0;
    }
    const late = lateNotes.count - seenLate;
    seenLate = lateNotes.count;
    for (let i = 0; i < late; i++) lateTimes.push(now);
    while (hitchTimes.length && now - hitchTimes[0].at > WINDOW_MS) hitchTimes.shift();
    while (lateTimes.length && now - lateTimes[0] > WINDOW_MS) lateTimes.shift();

    // The audio clock against the wall clock, while playing with the audio running
    if (playing && liveContext.state === 'running') {
      clocks.push({ wall: now, audio: liveContext.currentTime });
      while (clocks.length > 2 && now - clocks[0].wall > AUDIO_WINDOW_MS) clocks.shift();
    } else clocks.length = 0;
    const span = clocks.length > 1 ? clocks[clocks.length - 1].wall - clocks[0].wall : 0;
    // (To the percent: what the badge shows, and the store isn't set every frame)
    const measured = span > AUDIO_WINDOW_MS * 0.8 ? (clocks[clocks.length - 1].audio - clocks[0].audio) / (span / 1000) : null;
    const speed = measured === null ? null : Math.round(Math.min(1, measured) * 100) / 100;
    const behind = speed !== null && speed < AUDIO_BEHIND;

    const struggling = lateTimes.length >= 4 || hitchTimes.length >= 3 || behind;
    if (struggling) calmSince = now;
    const s = usePerfStore.getState();
    // Lagging as soon as it struggles; calm again after 8 quiet seconds
    const lagging = struggling || (s.lagging && now - calmSince < 8000);
    const worst = Math.round(Math.max(0, ...hitchTimes.map((h) => h.ms)));
    if (lagging !== s.lagging) capFrameRate(lagging ? CALM_FPS : null);
    // Lag again after the look-ahead was already widened: this computer needs the bigger buffer
    // too, which only a restart can give, so the next start uses Stable playback. Not when the
    // person picked a mode themselves (Responsive on purpose, for playing live): theirs is kept.
    if (lagging && !s.lagging) {
      episodes++;
      if (shouldSwitchToStable(episodes, PLAYBACK_MODE, storedPlaybackChoice())) {
        switchToStableByItself();
        usePerfStore.setState({ stableNext: true });
        // Said once: from now on the setting reads Stable, so this doesn't happen again
        showToast('Playback kept lagging, so Fledgetone will use Stable playback (a bigger audio buffer) from the next reload. You can change it in Inspector › Master › Playback.');
      }
    }
    if (lagging !== s.lagging || lateTimes.length !== s.lateNotes || hitchTimes.length !== s.hitches || worst !== s.worstFrame || speed !== s.audioSpeed) {
      usePerfStore.setState({ lagging, lateNotes: lateTimes.length, hitches: hitchTimes.length, worstFrame: worst, audioSpeed: speed });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // Recordings of instruments no track (stinger or costume) has played for a few minutes are let
  // go while the song is stopped, so a long session of trying instruments doesn't fill the memory
  const unusedSince = new Map<InstrumentKey, number>();
  setInterval(() => {
    const s = useTimelineStore.getState();
    if (s.isPlaying) return;
    const used = new Set<InstrumentKey>(s.tracks.map((t) => t.instrumentKey));
    for (const st of s.stingers ?? []) used.add(st.instrumentKey);
    for (const c of s.costumes ?? []) for (const t of Object.values(c.tracks)) if (t.instrument) used.add(t.instrument);
    const now = performance.now();
    const drop: InstrumentKey[] = [];
    for (const key of loadedSampleKeys()) {
      if (used.has(key)) {
        unusedSince.delete(key);
        continue;
      }
      const since = unusedSince.get(key) ?? now;
      unusedSince.set(key, since);
      if (now - since > UNUSED_MS) drop.push(key);
    }
    if (drop.length) {
      forgetSampleSets(drop);
      drop.forEach((k) => unusedSince.delete(k));
    }
  }, 30000);
  const memory = () => usePerfStore.setState({ memoryMB: memoryMB() });
  memory();
  setInterval(memory, 3000);
}

/**
 * Free what the app holds and doesn't need: recordings of instruments no track uses, decoded
 * sounds no clip or track plays, the instrument browser's preview players, any notes left
 * hanging, and (if asked) the undo history. The browser hands the memory back as it tidies up.
 * Returns about how many MB of sound were let go.
 */
export function clearMemory(opts: { history: boolean }): number {
  const s = useTimelineStore.getState();
  releaseAllLiveVoices();
  const keys = new Set<InstrumentKey>(s.tracks.map((t) => t.instrumentKey));
  let bytes = forgetUnusedSamples(keys);
  const sounds = new Set(referencedSoundIds({ clips: s.clips, tracks: s.tracks, masterFx: { room: s.masterReverbRoom ?? undefined } }));
  for (const t of s.tracks) if (t.frozen) sounds.add(t.frozen.soundId);
  bytes += forgetDecodedSounds(sounds);
  if (opts.history) useTimelineStore.setState({ past: [], future: [] });
  restart = true;
  capFrameRate(null);
  usePerfStore.setState({ lagging: false, lateNotes: 0, hitches: 0, worstFrame: 0 });
  return Math.round(bytes / 1048576);
}
