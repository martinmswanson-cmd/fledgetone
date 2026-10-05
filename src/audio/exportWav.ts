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

/**
 * Render the arrangement faster than real time with Tone.Offline. Every instrument and the
 * master chain are rebuilt inside the offline context from the same factories used live,
 * so the export sounds like playback (mute/solo/volume/pan included).
 */
export async function renderArrangement(opts: RenderOptions): Promise<AudioBuffer> {
  const { tracks, clips, bpm, swing, startBar, endBar } = opts;
  const songSeconds = ((endBar - startBar) * 4 * 60) / bpm;
  // Read live state before Tone.Offline swaps the global context
  const masterDb = getMasterVolume();

  const buffer = await Tone.Offline(
    async (context) => {
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
    },
    songSeconds + TAIL_SECONDS,
    2,
    SAMPLE_RATE
  );

  const audio = buffer.get();
  if (!audio) throw new Error('Render produced no audio');
  preventClipping(audio);
  return audio;
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
