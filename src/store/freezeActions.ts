/**
 * Freezing, bouncing and unfreezing tracks: renders a track's instrument and inserts to a sound
 * (see freeze.ts for how the live engine plays it), with progress.
 */
import { create } from 'zustand';
import { masterFxOf, useTimelineStore } from './timelineStore';
import { freezeFingerprint, isLiveParam, trackForFreezing } from './freeze';
import type { Track } from './timelineTypes';
import { barToSeconds, secondsToBar } from '../audio/tempoMap';
import { isAudioKind } from '../audio/instrumentCatalog';
import { encodeChannels, renderForFreeze, SAMPLE_RATES } from '../audio/exportWav';
import type { SampleRate } from '../audio/exportWav';
import { importSoundFile } from '../audio/soundLibrary';
import { BUS_GAIN, liveMix } from '../audio/engine';
import { captureWamStates } from '../audio/wamHost';

/** Tracks being frozen right now, with how far along (0 to 1). */
export const useFreezing = create<Record<string, number>>(() => ({}));

/** A frozen sound may be up to this big (16-bit stereo: about 19 minutes at 44.1 kHz). */
const MAX_FROZEN_BYTES = 200 * 1024 * 1024;
/** Frozen sounds are stored with their peak here, and played back at the gain that undoes it. */
const STORED_PEAK = 0.98;
/**
 * Played back, a frozen sound goes through its track's strip and the mix bus again, which the
 * render already went through: the strip's pan takes each side 3 dB down at the centre (equal
 * power, see trackStrip.ts) and the bus has its headroom gain. The frozen sound gets both back.
 */
export const PLAYBACK_DB = 20 * Math.log10(Math.SQRT2) - 20 * Math.log10(BUS_GAIN);
/** Below this the freeze's tail is silence and is trimmed off. */
const SILENCE = 10 ** (-90 / 20);

export const canFreeze = (trackId: string): boolean => {
  const s = useTimelineStore.getState();
  const track = s.tracks.find((t) => t.id === trackId);
  return !!track && !isAudioKind(track.instrumentKey) && s.clips.some((c) => c.trackId === trackId);
};

interface RenderedTrack {
  soundId: string;
  startBar: number;
  seconds: number;
  gainDb: number;
  fingerprint: string;
}

/** A track's sound as rendered: its samples (silent tail trimmed), where it starts, and what it was rendered from. */
export interface TrackRender {
  channels: Float32Array[];
  sampleRate: number;
  startBar: number;
  /** Peak sample */
  peak: number;
  fingerprint: string;
}

/**
 * Render a track's instrument, inserts and EQ (not its volume, pan or sends) from its first clip
 * to the end of its tail, as the song is now (an edit made while it renders leaves the result
 * out of date: see freeze.ts). Doesn't stop playback: live playback waits out the moment a render
 * holds the global audio context. Null when the track has no clips, plays recordings already, or
 * is silent.
 */
export async function renderTrackChannels(trackId: string, onProgress?: (fraction: number) => void, hold?: () => Promise<void> | void): Promise<TrackRender | null> {
  // The plugins' latest settings first (they reach the tracks every few seconds otherwise)
  await captureWamStates();
  const store = useTimelineStore.getState();
  const track = store.tracks.find((t) => t.id === trackId);
  if (!track || isAudioKind(track.instrumentKey)) return null;
  const own = store.clips.filter((c) => c.trackId === trackId);
  if (!own.length) return null;
  const snapshot = { tracks: store.tracks, clips: store.clips, bpm: store.bpm, swing: store.swing, tempoPoints: store.tempoPoints };
  const fingerprint = freezeFingerprint(track, snapshot);
  const startBar = Math.min(...own.map((c) => c.startBar));
  const endBar = Math.max(...own.map((c) => c.startBar + c.lengthBars));
  const rate = liveMix.bus.context.sampleRate;
  const sampleRate: SampleRate = (SAMPLE_RATES as readonly number[]).includes(rate) ? (rate as SampleRate) : 48000;
  const subject = trackForFreezing(track);
  // Every track goes in, as it is: a Pump follows the kicks of the drum tracks that sound
  const tracks = snapshot.tracks.map((t) => (t.id === trackId ? { ...subject, isMuted: t.isMuted, isSoloed: t.isSoloed } : t));
  const { channels } = await renderForFreeze(
    {
      tracks,
      clips: snapshot.clips,
      bpm: snapshot.bpm,
      tempoPoints: snapshot.tempoPoints,
      swing: snapshot.swing,
      startBar,
      endBar,
      masterFx: masterFxOf(store),
      ending: 'ringOut',
      sampleRate,
      hold,
    },
    subject,
    onProgress
  );
  // Trim the silent tail
  let end = 0;
  let peak = 0;
  for (const ch of channels) {
    for (let i = ch.length - 1; i > end; i--) if (Math.abs(ch[i]) > SILENCE) { end = i; break; }
    for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  }
  if (peak <= SILENCE) return null;
  const length = Math.min(channels[0].length, end + Math.round(0.05 * sampleRate));
  return { channels: channels.map((ch) => ch.subarray(0, length)), sampleRate, startBar, peak, fingerprint };
}

/**
 * Render a track to a sound in the library, as renderTrackChannels does. Playback stops first (a
 * freeze the person asked for shows its progress, and the timeline waits). Null when the track went
 * away while it rendered.
 */
async function renderTrackSound(trackId: string, label: string): Promise<RenderedTrack | null> {
  const store = useTimelineStore.getState();
  const track = store.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  if (isAudioKind(track.instrumentKey)) throw new Error('an Audio track already plays recordings');
  if (!store.clips.some((c) => c.trackId === trackId)) throw new Error(`"${track.name}" has no clips to render`);
  if (useFreezing.getState()[trackId] !== undefined) return null;
  store.pause();
  useFreezing.setState({ [trackId]: 0 });
  try {
    const r = await renderTrackChannels(trackId, (f) => useFreezing.setState({ [trackId]: f }));
    if (!r) throw new Error(`"${track.name}" is silent: nothing to render`);
    // Stored normalized within ±20 dB, leaving room in the clip gain's ±24 dB for the playback correction
    const normalizeDb = Math.max(-20, Math.min(20, 20 * Math.log10(r.peak / STORED_PEAK)));
    const scale = 10 ** (-normalizeDb / 20);
    const stored = r.channels.map((ch) => {
      const out = ch.slice();
      for (let i = 0; i < out.length; i++) out[i] *= scale;
      return out;
    });
    const wav = encodeChannels(stored, r.sampleRate, 16, []);
    const meta = await importSoundFile(wav, `${track.name} (${label})`, MAX_FROZEN_BYTES);
    if (!useTimelineStore.getState().tracks.some((t) => t.id === trackId)) return null; // deleted while it rendered
    return { soundId: meta.id, startBar: r.startBar, seconds: r.channels[0].length / r.sampleRate, gainDb: normalizeDb + PLAYBACK_DB, fingerprint: r.fingerprint };
  } finally {
    useFreezing.setState((s) => {
      const next = { ...s };
      delete next[trackId];
      return next;
    }, true);
  }
}

/**
 * Render a track to a sound and mark it frozen (one undo step). Playback stops first: a render
 * swaps the global audio context while it sets up. Rejects with a message to show.
 */
export async function freezeTrack(trackId: string): Promise<void> {
  const r = await renderTrackSound(trackId, 'frozen');
  if (!r) return;
  useTimelineStore.getState().checkpoint();
  useTimelineStore.setState((s) => ({
    tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, frozen: { soundId: r.soundId, startBar: r.startBar, seconds: r.seconds, gainDb: r.gainDb, fingerprint: r.fingerprint } } : t)),
  }));
}

/**
 * Bounce in place (one undo step): the track's sound, instrument, inserts and EQ included, as one
 * audio clip on a new Audio track just under it, which takes over its volume, pan, sends, output
 * distance and their automation. The original is muted and kept, to go back to. Returns the new
 * track's id.
 */
export async function bounceTrack(trackId: string): Promise<string | null> {
  const r = await renderTrackSound(trackId, 'bounce');
  if (!r) return null;
  const s = useTimelineStore.getState();
  const source = s.tracks.find((t) => t.id === trackId);
  if (!source) return null;
  s.checkpoint();
  const id = s.addTrack('audio', `${source.name} (bounce)`);
  const tempo = { bpm: s.bpm, points: s.tempoPoints ?? [] };
  const lengthBars = secondsToBar(barToSeconds(r.startBar, tempo) + r.seconds, tempo) - r.startBar;
  useTimelineStore.setState((st) => {
    const made = st.tracks.find((t) => t.id === id)!;
    const bounced: Track = {
      ...made,
      volume: source.volume,
      pan: source.pan,
      reverbSend: source.reverbSend,
      delaySend: source.delaySend,
      ...(source.distance ? { distance: source.distance } : {}),
      ...(source.sends ? { sends: source.sends } : {}),
      ...(source.output ? { output: source.output } : {}),
      ...(source.folder ? { folder: source.folder } : {}),
      automation: (source.automation ?? []).filter((l) => isLiveParam(l.param)),
    };
    const others = st.tracks.filter((t) => t.id !== id).map((t) => (t.id === trackId ? { ...t, isMuted: true } : t));
    const at = others.findIndex((t) => t.id === trackId) + 1;
    return {
      tracks: [...others.slice(0, at), bounced, ...others.slice(at)],
      clips: [
        ...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)),
        {
          id: `clip-bounce-${id}`,
          trackId: id,
          name: `${source.name} (bounce)`,
          startBar: r.startBar,
          lengthBars,
          notes: [],
          isSelected: true,
          audio: { soundId: r.soundId, offset: 0, gain: r.gainDb, fadeIn: 0, fadeOut: 0 },
        },
      ],
      // (addTrack and this are one step: drop the step addTrack pushed)
      past: st.past.slice(0, -1),
    };
  });
  return id;
}

/** Play the track live again (one undo step). The frozen sound stays in the library until freed. */
export function unfreezeTrack(trackId: string): void {
  const s = useTimelineStore.getState();
  if (!s.tracks.find((t) => t.id === trackId)?.frozen) return;
  s.checkpoint();
  useTimelineStore.setState((st) => ({ tracks: st.tracks.map((t) => (t.id === trackId ? { ...t, frozen: undefined } : t)) }));
}
