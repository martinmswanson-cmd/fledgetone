import * as Tone from 'tone';
import { createMixChain, getMasterVolume } from './engine';
import { createDrumKit } from './presets/drums';
import { createBassVoice } from './presets/bass';
import { createKeysVoice } from './presets/keys';
import { createBrassVoice } from './presets/brass';
import { scheduleClips } from './scheduler';
import type { InstrumentVoices } from './scheduler';
import { barToTicks } from './transport';
import type { Clip, Track } from '../store/timelineTypes';

/** Seconds rendered past the last bar so reverb and release tails ring out. */
const TAIL_SECONDS = 2;
const SAMPLE_RATE = 44100;

export interface RenderOptions {
  tracks: Track[];
  clips: Clip[];
  bpm: number;
  swing: number;
  /** 1-based bar range to render, [startBar, endBar). */
  startBar: number;
  endBar: number;
}

/** Seconds of audio rendered between scheduling passes. */
const RENDER_STEP = 1;
/** How far past the render position notes are scheduled, so none are ever late. */
const SCHEDULE_LEAD = 0.25;

/**
 * Render the arrangement faster than real time in an OfflineContext. Every instrument and
 * the master chain are rebuilt inside it from the same factories used live, so the export
 * sounds like playback (mute/solo/volume/pan included).
 *
 * Unlike Tone.Offline, which runs the whole Transport (creating a node for every note of the
 * song) before rendering a single sample, this schedules notes one step ahead of the render
 * using OfflineAudioContext.suspend(). Finished notes are released as it goes, so render
 * time grows linearly with song length instead of quadratically. `onProgress` gets 0..1.
 */
export async function renderArrangement(opts: RenderOptions, onProgress?: (fraction: number) => void): Promise<AudioBuffer> {
  const { tracks, clips, bpm, swing, startBar, endBar } = opts;
  const songSeconds = ((endBar - startBar) * 4 * 60) / bpm;
  const duration = songSeconds + TAIL_SECONDS;
  // Read live state before the global context is swapped
  const masterDb = getMasterVolume();

  const original = Tone.getContext();
  // A native OfflineAudioContext, not Tone's default standardized-audio-context wrapper: the
  // wrapper only builds the real audio graph when rendering starts, so notes created while
  // the render is suspended would never be heard. Native nodes join the live graph at once.
  const native = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const context = new Tone.OfflineContext(native);
  Tone.setContext(context);
  try {
    await buildGraph(context);
  } finally {
    Tone.setContext(original);
  }

  // Drive Tone's offline clock by hand (what OfflineContext.render does all at once)
  const clock = context as unknown as { _currentTime: number; emit(event: string): void };
  const quantum = 128 / SAMPLE_RATE;
  const advanceClock = (to: number) => {
    const end = Math.min(to, duration);
    while (clock._currentTime <= end) {
      clock.emit('tick');
      clock._currentTime += quantum;
    }
  };

  if (typeof native.suspend === 'function') {
    advanceClock(RENDER_STEP + SCHEDULE_LEAD);
    for (let t = RENDER_STEP; t < duration; t += RENDER_STEP) {
      const at = t;
      void native.suspend(at).then(() => {
        advanceClock(at + RENDER_STEP + SCHEDULE_LEAD);
        onProgress?.(at / duration);
        void native.resume();
      });
    }
  } else {
    // No offline suspend (older Safari): schedule everything up front, slower for long songs
    advanceClock(duration);
  }
  const audio = await native.startRendering();
  onProgress?.(1);
  preventClipping(audio);
  return audio;

  /** Instruments, mix and Transport, built inside the offline context. */
  async function buildGraph(context: Tone.OfflineContext) {
    context.destination.volume.value = masterDb;
    const mix = createMixChain(context.destination);

    const drums = createDrumKit(mix.channels.drums);
    const bass = createBassVoice(mix.channels.bass);
    const keys = createKeysVoice(mix.channels.keys);
    const brass = createBrassVoice(mix.channels.brass);
    await keys.ready;

    // Solo is resolved here rather than with Channel.solo, which is shared per context
    const anySolo = tracks.some((t) => t.isSoloed);
    for (const t of tracks) {
      const ch = mix.channels[t.instrumentKey];
      ch.volume.value = t.volume <= -60 ? -Infinity : t.volume;
      ch.pan.value = t.pan;
      ch.mute = t.isMuted || (anySolo && !t.isSoloed);
    }

    const voices: InstrumentVoices = {
      kick: drums.kick,
      snare: drums.snare,
      hat: drums.hat,
      cowbell: drums.cowbell,
      bass: bass.trigger,
      keys: keys.trigger,
      brass: brass.trigger,
    };

    const transport = context.transport;
    transport.bpm.value = bpm;
    transport.swing = swing;
    transport.swingSubdivision = '16n';
    transport.loop = false;
    scheduleClips(transport, tracks, clips, voices);
    transport.start(0, `${barToTicks(startBar)}i`);
  }
}

/**
 * Tone.Limiter has no lookahead, so transients can overshoot 0 dBFS. Scale the whole
 * render down (never up) so the WAV peaks just under full scale instead of clipping.
 */
function preventClipping(audio: AudioBuffer, ceiling = 0.98): void {
  const data = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  let peak = 0;
  for (const ch of data) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  if (peak <= ceiling) return;
  const gain = ceiling / peak;
  for (const ch of data) for (let i = 0; i < ch.length; i++) ch[i] *= gain;
}

/** Encode an AudioBuffer as a 16-bit PCM WAV file. */
export function encodeWav(audio: AudioBuffer): Blob {
  const channels = audio.numberOfChannels;
  const frames = audio.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const view = new DataView(new ArrayBuffer(44 + dataSize));

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const data = Array.from({ length: channels }, (_, c) => audio.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

/** Trigger a browser download for a Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
