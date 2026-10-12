import { create } from 'zustand';
import { useTimelineStore } from './timelineStore';
import { freezeFingerprint, trackForFreezing } from './freeze';
import { isAudioKind } from '../audio/instrumentCatalog';
import { encodeChannels, renderForFreeze, SAMPLE_RATES } from '../audio/exportWav';
import type { SampleRate } from '../audio/exportWav';
import { importSoundFile } from '../audio/soundLibrary';
import { BUS_GAIN, liveMix } from '../audio/engine';

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
const PLAYBACK_DB = 20 * Math.log10(Math.SQRT2) - 20 * Math.log10(BUS_GAIN);
/** Below this the freeze's tail is silence and is trimmed off. */
const SILENCE = 10 ** (-90 / 20);

export const canFreeze = (trackId: string): boolean => {
  const s = useTimelineStore.getState();
  const track = s.tracks.find((t) => t.id === trackId);
  return !!track && !isAudioKind(track.instrumentKey) && s.clips.some((c) => c.trackId === trackId);
};

/**
 * Render a track to a sound and mark it frozen (one undo step). Playback stops first: a render
 * swaps the global audio context while it sets up. Rejects with a message to show.
 */
export async function freezeTrack(trackId: string): Promise<void> {
  const store = useTimelineStore.getState();
  const track = store.tracks.find((t) => t.id === trackId);
  if (!track) return;
  if (isAudioKind(track.instrumentKey)) throw new Error('an Audio track already plays recordings');
  const own = store.clips.filter((c) => c.trackId === trackId);
  if (!own.length) throw new Error(`"${track.name}" has no clips to freeze`);
  if (useFreezing.getState()[trackId] !== undefined) return;
  store.pause();
  useFreezing.setState({ [trackId]: 0 });
  try {
    // Everything as it is now: an edit made while this renders leaves the freeze out of date
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
        masterFx: { reverbDecay: store.masterReverbDecay, delayTime: store.masterDelayTime, delayFeedback: store.masterDelayFeedback },
        ending: 'ringOut',
        sampleRate,
      },
      subject,
      (f) => useFreezing.setState({ [trackId]: f })
    );
    // Trim the silent tail, then store it normalized
    let end = 0;
    let peak = 0;
    for (const ch of channels) {
      for (let i = ch.length - 1; i > end; i--) if (Math.abs(ch[i]) > SILENCE) { end = i; break; }
      for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
    }
    if (peak <= SILENCE) throw new Error(`"${track.name}" is silent: nothing to freeze`);
    const length = Math.min(channels[0].length, end + Math.round(0.05 * sampleRate));
    // Normalized within ±20 dB, leaving room in the clip gain's ±24 dB for the playback correction
    const normalizeDb = Math.max(-20, Math.min(20, 20 * Math.log10(peak / STORED_PEAK)));
    const scale = 10 ** (-normalizeDb / 20);
    const gainDb = normalizeDb + PLAYBACK_DB;
    const stored = channels.map((ch) => {
      const out = ch.slice(0, length);
      for (let i = 0; i < out.length; i++) out[i] *= scale;
      return out;
    });
    const wav = encodeChannels(stored, sampleRate, 16, []);
    const meta = await importSoundFile(wav, `${track.name} (frozen)`, MAX_FROZEN_BYTES);
    const now = useTimelineStore.getState();
    if (!now.tracks.some((t) => t.id === trackId)) return; // deleted while it rendered
    now.checkpoint();
    useTimelineStore.setState((s) => ({
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, frozen: { soundId: meta.id, startBar, seconds: length / sampleRate, gainDb, fingerprint } } : t)),
    }));
  } finally {
    useFreezing.setState((s) => {
      const next = { ...s };
      delete next[trackId];
      return next;
    }, true);
  }
}

/** Play the track live again (one undo step). The frozen sound stays in the library until freed. */
export function unfreezeTrack(trackId: string): void {
  const s = useTimelineStore.getState();
  if (!s.tracks.find((t) => t.id === trackId)?.frozen) return;
  s.checkpoint();
  useTimelineStore.setState((st) => ({ tracks: st.tracks.map((t) => (t.id === trackId ? { ...t, frozen: undefined } : t)) }));
}
