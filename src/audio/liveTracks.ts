import * as Tone from 'tone';
import { liveMix } from './engine';
import type { InstrumentKey } from './engine';
import { createPumpClock, createTrackStrip } from './effects/trackStrip';
import type { PumpClock, TrackStrip } from './effects/trackStrip';
import { createAutomationSchedule } from './automationSchedule';
import type { AutomationSchedule } from './automationSchedule';
import { createInstrument, safely, trackInstrumentOptions } from './instruments';
import { pluginEpoch, readWamParams } from './wamHost';
import { pluginParamInfo } from './automation';
import { isDrumKind } from './instrumentCatalog';
import { barToTicks, getLiveTempo } from './transport';
import type { PlayableNote, TrackInstrument } from './instruments';
import type { NativeBus } from './presets/native';
import type { AutomationPoint, Track, WamPlugin } from '../store/timelineTypes';
import { trackIntensityLevel, type IntensityCurve } from '../store/intensity';
import type { LiveTrackView } from '../store/freeze';
import { loadSamples } from './samplers/samplerManager';
import { useAudioStore } from '../store/audioStore';
import { TOTAL_BARS } from '../store/timelineTypes';
import { audibleIds, busChain, busOf, liveSends, soloLit } from '../store/buses';

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
  /** It had sends to returns at the last sync (so removing the last one is heard) */
  hadSends?: boolean;
  /** False while muted, or while another track is soloed: its notes aren't played at all */
  audible: boolean;
  /** The instrument's sample download failed: it stays silent until rebuilt (see recoverFailedDownloads) */
  failed: boolean;
  /** The bus track whose strip it plays into (null: the master) */
  outputId: string | null;
}

/** The song's base tempo, which the strips' Delay inserts follow. */
let stripTempo = 120;
export function setLiveStripTempo(bpm: number): void {
  stripTempo = bpm;
  for (const lt of live.values()) lt.strip.setTempo(bpm);
}

const live = new Map<string, LiveTrack>();

/** Every beat / every 8th for the Pumps that follow those (on the live Transport, made on first sync). */
let pumpClock: PumpClock | null = null;
const liveStrips = () => [...live.values()].map((lt) => lt.strip);

/** The tracks' automation lanes on the live Transport (made on first use). */
let automation: AutomationSchedule | null = null;
const liveAutomation = () =>
  (automation ??= createAutomationSchedule(liveMix.bus.context.transport, (trackId) => live.get(trackId)?.strip, { tempo: getLiveTempo }));

/**
 * What the instrument is built from that a change of means building it again: the Sampler's
 * sound, and the plugins (which, not their settings: those change inside them), as allowed now.
 */
const pluginKey = (p: WamPlugin) => `${p.id}@${p.url}${p.bypass ? '~' : ''}`;
const sampleKey = (track: Track) => {
  const sample = track.sample ? `${track.sample.root}|${track.sample.soundId ?? track.sample.dataUrl}` : '';
  const plugins = [track.plugin, ...(track.pluginFx ?? [])].filter((p): p is WamPlugin => !!p);
  return sample || plugins.length ? `${sample}#${plugins.map(pluginKey).join(',')}#${plugins.length ? pluginEpoch() : ''}` : undefined;
};

/** Note when a track's current instrument fails to download its samples, so it can be rebuilt later. */
function watchDownload(lt: LiveTrack): void {
  const instrument = lt.instrument;
  lt.failed = false;
  // Lanes of its plugins' parameters go to its plugins
  lt.strip.setPluginParams(instrument.setPluginParam ?? null);
  instrument.ready.then(
    () => {
      // Its plugins' parameters, for the lane picker
      const plugins = [lt.applied?.plugin, ...(lt.applied?.pluginFx ?? [])].filter((p) => !!p);
      if (lt.instrument === instrument && plugins.length) void Promise.all(plugins.map((p) => readWamParams(p!.id, pluginParamInfo))).then(() => paramListeners.forEach((l) => l()));
    },
    () => {
      if (lt.instrument === instrument) lt.failed = true;
    }
  );
}

const paramListeners = new Set<() => void>();
/** Told when plugins' parameters have been read (see pluginParamInfo). */
export function onPluginParams(listener: () => void): () => void {
  paramListeners.add(listener);
  return () => paramListeners.delete(listener);
}

/** The gain curve the tracks duck along (see duck.ts), and the tracks it was last applied with. */
let liveDuck: AutomationPoint[] | null = null;
let lastTracks: Track[] = [];

/** Duck the live tracks along `points` (null: no ducking). The same points (by identity) cost nothing. */
export function setLiveDuck(points: AutomationPoint[] | null): void {
  if (points === liveDuck) return;
  liveDuck = points;
  liveAutomation().update(lastTracks, liveDuck);
}

/** Each live track's Intensity level as last set, so unchanged ones aren't touched. */
const intensityLevels = new Map<string, number>();

/**
 * Set every live track's Intensity level from its stem group's curve at `intensity` (see
 * intensity.ts), gliding over `ramp` seconds so scrubbing the slider crossfades smoothly.
 */
export function applyLiveIntensity(tracks: Track[], curves: Record<string, IntensityCurve>, intensity: number, ramp = 0.08): void {
  for (const track of tracks) {
    const lt = live.get(track.id);
    if (!lt) continue;
    const level = trackIntensityLevel(track, curves, intensity);
    if (intensityLevels.get(track.id) === level && intensityLevels.has(track.id)) continue;
    intensityLevels.set(track.id, level);
    lt.strip.setIntensityLevel(level, ramp);
  }
}

/**
 * The track as its strip should take it: soloed when a solo lets it through (a soloed bus lets its
 * tracks through, a soloed track its buses), since each strip's solo silences the strips not soloed.
 * The same object while that doesn't change, so its strip isn't re-applied.
 */
const soloViews = new WeakMap<Track, Map<string, Track>>();
function stripView(track: Track, lit: Set<string> | null, inMutedBus: boolean): Track {
  const soloed = lit ? lit.has(track.id) : false;
  // A track in a muted bus is muted at its own strip too, so its reverb and delay sends go quiet
  // with it (as in the export, which leaves it out)
  const muted = track.isMuted || inMutedBus;
  if (soloed === track.isSoloed && muted === track.isMuted) return track;
  const key = `${soloed}|${muted}`;
  let views = soloViews.get(track);
  if (!views) soloViews.set(track, (views = new Map()));
  let view = views.get(key);
  if (!view) views.set(key, (view = { ...track, isSoloed: soloed, isMuted: muted }));
  return view;
}

/** Tracks to bring in once the live context is the global one again (see syncLiveTracks). */
let pendingSync: Track[] | null = null;

export function syncLiveTracks(tracks: Track[]): void {
  // While an export builds its graph the global context is the export's: anything made now would
  // be made there. Wait for the live one to come back (a moment), then sync with the latest tracks.
  if (Tone.getContext() !== liveMix.bus.context) {
    const waiting = pendingSync !== null;
    pendingSync = tracks;
    if (!waiting) {
      void (async () => {
        while (Tone.getContext() !== liveMix.bus.context) await new Promise((resolve) => setTimeout(resolve, 50));
        const latest = pendingSync;
        pendingSync = null;
        if (latest) syncLiveTracks(latest);
      })();
    }
    return;
  }
  pendingSync = null;
  const keep = new Set(tracks.map((t) => t.id));
  // Tracks playing into a bus that's going go back to the master first
  for (const lt of live.values()) {
    if (lt.outputId && !keep.has(lt.outputId)) {
      lt.strip.setOutput(liveMix.bus);
      lt.outputId = null;
    }
  }
  for (const [id, lt] of live) {
    if (!keep.has(id)) {
      lt.instrument.dispose();
      lt.strip.dispose();
      live.delete(id);
      intensityLevels.delete(id);
    }
  }

  const lit = soloLit(tracks);
  const heard = audibleIds(tracks);
  for (const track of tracks) {
    let lt = live.get(track.id);
    if (!lt) {
      const strip = createTrackStrip(liveMix.bus, liveMix.busFx);
      strip.setTempo(stripTempo);
      lt = {
        instrumentKey: track.instrumentKey,
        sampleUrl: sampleKey(track),
        strip,
        instrument: createInstrument(track.instrumentKey, strip.input, trackInstrumentOptions(track)),
        applied: null,
        audible: true,
        failed: false,
        outputId: null,
      };
      watchDownload(lt);
      live.set(track.id, lt);
    } else if (lt.instrumentKey !== track.instrumentKey || lt.sampleUrl !== sampleKey(track)) {
      lt.instrument.releaseAll();
      lt.instrument.dispose();
      const hadBus = !!lt.instrument.clipBus;
      lt.instrument = createInstrument(track.instrumentKey, lt.strip.input, trackInstrumentOptions(track));
      lt.instrumentKey = track.instrumentKey;
      lt.sampleUrl = sampleKey(track);
      watchDownload(lt);
      if (hadBus && lt.instrument.clipBus) busRebuilt.forEach((l) => l(track.id));
    }
    // Only touch strips whose settings changed, so dragging one fader doesn't re-ramp every track
    const view = stripView(track, lit, busChain(track, tracks).some((b) => b.isMuted));
    if (lt.applied !== view) {
      lt.strip.apply(view);
      // The Slicer follows its slices and modes without a rebuild
      lt.instrument.setSlicer?.(track.slicer);
      lt.instrument.setSynth?.(track.synth);
      lt.instrument.setRack?.(track.rack);
      lt.instrument.setMulti?.(track.multi);
    }
    lt.applied = view;
    // A silent track's notes are skipped rather than played into a muted channel (or bus), saving CPU
    lt.audible = heard.has(track.id);
  }
  // Each track plays into its bus's strip, or the master
  for (const track of tracks) {
    const lt = live.get(track.id)!;
    const bus = busOf(track, tracks);
    const target = bus && !busChain(bus, tracks).some((b) => b.id === track.id) ? live.get(bus.id) : undefined;
    const outputId = target ? bus!.id : null;
    if (outputId === lt.outputId) continue;
    lt.strip.setOutput(target ? target.strip.input : liveMix.bus);
    lt.outputId = outputId;
  }
  // Each track's sends into its returns (into a return's plugin effects first, when it has some)
  for (const track of tracks) {
    const lt = live.get(track.id)!;
    const sends = liveSends(track, tracks).flatMap((send) => {
      const ret = live.get(send.to);
      return ret ? [{ id: send.to, target: ret.instrument.sendInput ?? ret.strip.input, level: send.level, pre: !!send.pre }] : [];
    });
    if (sends.length || lt.hadSends) lt.strip.setSends(sends, !!(lt.applied?.isMuted));
    lt.hadSends = sends.length > 0;
  }
  // The live mix's own Transport, even while a WAV export has made its offline context the global
  // one, over the whole timeline
  pumpClock ??= createPumpClock(liveMix.bus.context.transport, liveStrips, 0, barToTicks(TOTAL_BARS + 1));
  pumpClock.update();
  // After the strips, which decide what each lane drives
  lastTracks = tracks;
  liveAutomation().update(tracks, liveDuck);
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
/** Each live track's level after its fader (peak, 0..1), for the mixer's meters. */
export function liveTrackPeaks(): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, lt] of live) out.set(id, lt.strip.peak());
  return out;
}

/** A track's spectrum now (dB per bin) into `out`; the bin count, or 0 if the track isn't live. */
export function liveTrackSpectrum(trackId: string, out: Float32Array): number {
  return live.get(trackId)?.strip.spectrum(out) ?? 0;
}

/** A track's multiband compressor gain reduction per band (dB), or null. */
export function liveMbcReduction(trackId: string): [number, number, number] | null {
  return live.get(trackId)?.strip.mbcReduction() ?? null;
}

/** A note of `trackId` at `time`: every Pump that follows that track ducks. */
export function pumpOnTrack(trackId: string, time: number): void {
  for (const { strip } of live.values()) if (strip.pumpSource() === trackId) strip.pump(time, 'track', trackId);
}

export function getLiveInstrument(trackId: string): TrackInstrument | undefined {
  const lt = live.get(trackId);
  return lt?.audible ? lt.instrument : undefined;
}

/** Where an Audio track's clips play, muted or not (its strip silences it, and un-muting mid-clip is then heard at once). */
const busRebuilt = new Set<(trackId: string) => void>();
/** Called when a track's clip bus is replaced (its instrument rebuilt), so its audio clips move to the new one. */
export function onClipBusRebuilt(listener: (trackId: string) => void): void {
  busRebuilt.add(listener);
}

export function getLiveClipBus(trackId: string): NativeBus | undefined {
  return live.get(trackId)?.instrument.clipBus;
}

/** Release sustained voices so nothing hangs after Stop. */
export function releaseAllLiveVoices(): void {
  for (const lt of live.values()) {
    safely(() => lt.instrument.releaseAll());
    // A bend left by a clip's expression ends with playback
    if (lt.instrument.bend) safely(() => lt.instrument.bend!(0, Tone.now()));
  }
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
    lt.instrument = createInstrument(key, lt.strip.input, trackInstrumentOptions(lt.applied));
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
