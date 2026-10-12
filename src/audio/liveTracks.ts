import * as Tone from 'tone';
import { liveMix } from './engine';
import type { InstrumentKey } from './engine';
import { createPumpClock, createTrackStrip } from './effects/trackStrip';
import type { PumpClock, TrackStrip } from './effects/trackStrip';
import { createAutomationSchedule } from './automationSchedule';
import type { AutomationSchedule } from './automationSchedule';
import { createInstrument, safely } from './instruments';
import { isDrumKind } from './instrumentCatalog';
import { barToTicks } from './transport';
import type { PlayableNote, TrackInstrument } from './instruments';
import type { NativeBus } from './presets/native';
import type { Track } from '../store/timelineTypes';
import type { LiveTrackView } from '../store/freeze';
import { loadSamples } from './samplers/samplerManager';
import { useAudioStore } from '../store/audioStore';
import { TOTAL_BARS } from '../store/timelineStore';

/**
 * Live playback graph: one effects strip + one instrument per timeline track, kept in step
 * with the store by syncLiveTracks(). The scheduler looks instruments up by track id at the
 * moment a note plays, so swapping an instrument never needs a reschedule.
 */
interface LiveTrack {
  instrumentKey: InstrumentKey;
  /** The Sampler's sound + root note, so changing either rebuilds the instrument */
  sampleUrl: string | undefined;
  strip: TrackStrip;
  instrument: TrackInstrument;
  /** The settings last applied to the strip (the store replaces a track object when it changes) */
  applied: Track | null;
  /** False while muted, or while another track is soloed: its notes aren't played at all */
  audible: boolean;
  /** The instrument's sample download failed: it stays silent until rebuilt (see recoverFailedDownloads) */
  failed: boolean;
}

const live = new Map<string, LiveTrack>();

/** Every beat / every 8th for the Pumps that follow those (on the live Transport, made on first sync). */
let pumpClock: PumpClock | null = null;
const liveStrips = () => [...live.values()].map((lt) => lt.strip);

/** The tracks' automation lanes on the live Transport (made on first use). */
let automation: AutomationSchedule | null = null;
const liveAutomation = () =>
  (automation ??= createAutomationSchedule(liveMix.bus.context.transport, (trackId) => live.get(trackId)?.strip));

const sampleKey = (track: Track) => (track.sample ? `${track.sample.root}|${track.sample.soundId ?? track.sample.dataUrl}` : undefined);

/** Note when a track's current instrument fails to download its samples, so it can be rebuilt later. */
function watchDownload(lt: LiveTrack): void {
  const instrument = lt.instrument;
  lt.failed = false;
  instrument.ready.catch(() => {
    if (lt.instrument === instrument) lt.failed = true;
  });
}

export function syncLiveTracks(tracks: Track[]): void {
  const keep = new Set(tracks.map((t) => t.id));
  for (const [id, lt] of live) {
    if (!keep.has(id)) {
      lt.instrument.dispose();
      lt.strip.dispose();
      live.delete(id);
    }
  }

  const anySolo = tracks.some((t) => t.isSoloed);
  for (const track of tracks) {
    let lt = live.get(track.id);
    if (!lt) {
      const strip = createTrackStrip(liveMix.bus, liveMix.busFx);
      lt = {
        instrumentKey: track.instrumentKey,
        sampleUrl: sampleKey(track),
        strip,
        instrument: createInstrument(track.instrumentKey, strip.input, { sample: track.sample, slicer: track.slicer, synth: track.synth }),
        applied: null,
        audible: true,
        failed: false,
      };
      watchDownload(lt);
      live.set(track.id, lt);
    } else if (lt.instrumentKey !== track.instrumentKey || lt.sampleUrl !== sampleKey(track)) {
      lt.instrument.releaseAll();
      lt.instrument.dispose();
      lt.instrument = createInstrument(track.instrumentKey, lt.strip.input, { sample: track.sample, slicer: track.slicer, synth: track.synth });
      lt.instrumentKey = track.instrumentKey;
      lt.sampleUrl = sampleKey(track);
      watchDownload(lt);
    }
    // Only touch strips whose settings changed, so dragging one fader doesn't re-ramp every track
    if (lt.applied !== track) {
      lt.strip.apply(track);
      // The Slicer follows its slices and modes without a rebuild
      lt.instrument.setSlicer?.(track.slicer);
      lt.instrument.setSynth?.(track.synth);
    }
    lt.applied = track;
    // A silent track's notes are skipped rather than played into a muted channel, saving CPU
    lt.audible = !track.isMuted && (!anySolo || track.isSoloed);
  }
  // The live mix's own Transport, even while a WAV export has made its offline context the global
  // one, over the whole timeline
  pumpClock ??= createPumpClock(liveMix.bus.context.transport, liveStrips, 0, barToTicks(TOTAL_BARS + 1));
  pumpClock.update();
  // After the strips, which decide what each lane drives
  liveAutomation().update(tracks);
}

/** Stopped with the playhead at `bar`: automated settings sit at their lanes' values there. */
export function holdAutomationAt(bar: number): void {
  liveAutomation().hold(bar);
}

/** The tempo or loop changed: automation that's playing follows. */
export function retimeAutomation(): void {
  automation?.retime();
}

/**
 * A kick drum note at `time` on `trackId` (from the scheduler): every Pump that follows the kick
 * ducks, if that track is a drum kit that sounds (not muted, not silenced by another's solo).
 */
export function pumpOnKick(trackId: string, time: number): void {
  const lt = live.get(trackId);
  // A frozen drum track plays as audio, but its kicks still count
  const kind = (lt?.applied as LiveTrackView | null)?.frozenFrom ?? lt?.instrumentKey;
  if (!lt?.audible || !kind || !isDrumKind(kind)) return;
  for (const { strip } of live.values()) strip.pump(time, 'kick');
}

/** A track's instrument, or undefined while the track is muted / not the soloed one. */
export function getLiveInstrument(trackId: string): TrackInstrument | undefined {
  const lt = live.get(trackId);
  return lt?.audible ? lt.instrument : undefined;
}

/** Where an Audio track's clips play, muted or not (its strip silences it, and un-muting mid-clip is then heard at once). */
export function getLiveClipBus(trackId: string): NativeBus | undefined {
  return live.get(trackId)?.instrument.clipBus;
}

/** Release sustained voices so nothing hangs after Stop. */
export function releaseAllLiveVoices(): void {
  for (const lt of live.values()) safely(() => lt.instrument.releaseAll());
}

/** Play notes right now through a track's instrument and effects (piano-roll previews). */
export function previewTrackNotes(trackId: string, notes: PlayableNote[]): void {
  const instrument = live.get(trackId)?.instrument;
  if (instrument && notes.length) safely(() => instrument.play(notes, Tone.now()));
}

/**
 * Rebuild the live instruments playing `key` whose sample download failed, on the same strip.
 * Instruments built while the download was failing have no sounds attached, and never get any.
 */
export function reloadInstrument(key: InstrumentKey): void {
  for (const lt of live.values()) {
    if (lt.instrumentKey !== key || !lt.failed) continue;
    safely(() => lt.instrument.releaseAll());
    lt.instrument.dispose();
    lt.instrument = createInstrument(key, lt.strip.input, { sample: lt.applied?.sample, slicer: lt.applied?.slicer, synth: lt.applied?.synth });
    watchDownload(lt);
  }
}

/**
 * Try a recorded instrument's download again (the track header's "!", the inspector's and the
 * instrument browser's Retry). On success the status turns Ready and recoverFailedDownloads
 * rebuilds the tracks that failed. Rejects if it failed again (the status shows the error).
 */
export async function retryInstrumentDownload(key: InstrumentKey): Promise<void> {
  await loadSamples(key);
}

/**
 * Keep failed recorded instruments recoverable, for as long as the timeline is mounted:
 * - Whenever an instrument's samples finish downloading, rebuild the tracks whose download had
 *   failed, so they play. That covers every way a download can be retried: Retry, the "!", an
 *   instrument browser key or deck pad, another track with that instrument, a WAV export.
 * - When the browser comes back online, retry every failed download.
 * Returns an uninstall function.
 */
export function recoverFailedDownloads(): () => void {
  const unsubscribe = useAudioStore.subscribe((state, prev) => {
    if (state.instrumentStatus === prev.instrumentStatus) return;
    for (const [key, status] of Object.entries(state.instrumentStatus)) {
      if (status === 'ready' && prev.instrumentStatus[key] !== 'ready') void rebuildInLiveContext(key as InstrumentKey);
    }
  });
  const onOnline = () => {
    const status = useAudioStore.getState().instrumentStatus;
    for (const [key, s] of Object.entries(status)) {
      if (s === 'error') void retryInstrumentDownload(key as InstrumentKey).catch(() => {});
    }
  };
  window.addEventListener('online', onOnline);
  return () => {
    unsubscribe();
    window.removeEventListener('online', onOnline);
  };
}

/** reloadInstrument, once the live context is current: a WAV export makes its offline context the global one while it sets up. */
async function rebuildInLiveContext(key: InstrumentKey): Promise<void> {
  while (Tone.getContext() !== liveMix.bus.context) await new Promise((resolve) => setTimeout(resolve, 50));
  reloadInstrument(key);
}
