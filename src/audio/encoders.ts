import { createMp3Encoder, createOggEncoder } from 'wasm-media-encoders';
import type { WasmMediaEncoder } from 'wasm-media-encoders';
import { encodeChannels } from './exportWav';
import type { BitDepth } from './exportWav';
import type { WavCue } from './wavCues';

/**
 * Audio file formats for exports. WAV is the exact one (and the only one with markers and loop
 * points); MP3 and Ogg Vorbis are small, for sharing and for games (Godot and Unity both import
 * Ogg Vorbis, and play it with a seamless loop). The encoders are the reference LAME and libvorbis
 * compiled to WebAssembly (wasm-media-encoders), bundled into the app so they work offline.
 */
export const AUDIO_FORMATS = ['wav', 'mp3', 'ogg'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export const FORMAT_EXTENSION: Record<AudioFormat, string> = { wav: 'wav', mp3: 'mp3', ogg: 'ogg' };

export interface EncodeOptions {
  bitDepth: BitDepth;
  cues?: readonly WavCue[];
  loop?: { start: number; end: number };
  /** A 16-bit WAV's dither sequence: each stem its own (see wavFile.ts) */
  ditherSeed?: number;
}

/** Samples handed to an encoder at a time, so a long song never needs one huge copy. */
const CHUNK = 1 << 16;

async function compress(encoder: WasmMediaEncoder<'audio/mpeg'> | WasmMediaEncoder<'audio/ogg'>, channels: Float32Array[], type: string): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  // The encoder owns the bytes it returns: copy them out before the next call
  const keep = (bytes: Uint8Array) => {
    if (bytes.length) parts.push(new Uint8Array(bytes));
  };
  for (let at = 0; at < channels[0].length; at += CHUNK) {
    keep(encoder.encode(channels.map((ch) => ch.subarray(at, at + CHUNK))));
    // Let the page breathe between chunks (a long song takes a few seconds)
    if ((at / CHUNK) % 16 === 15) await new Promise((r) => setTimeout(r, 0));
  }
  keep(encoder.finalize());
  return new Blob(parts, { type });
}

/** Encode rendered channels (one or two) in `format`. MP3 at 320 kb/s, Ogg Vorbis at quality 8 (about 256 kb/s). */
export async function encodeAudio(channels: Float32Array[], sampleRate: number, format: AudioFormat, opts: EncodeOptions): Promise<Blob> {
  if (format === 'wav') return encodeChannels(channels, sampleRate, opts.bitDepth, opts.cues ?? [], opts.loop, opts.ditherSeed);
  if (format === 'mp3') {
    const encoder = await createMp3Encoder();
    encoder.configure({ sampleRate, channels: channels.length as 1 | 2, bitrate: 320 });
    return compress(encoder, channels, 'audio/mpeg');
  }
  const encoder = await createOggEncoder();
  encoder.configure({ sampleRate, channels: channels.length as 1 | 2, vbrQuality: 8 });
  return compress(encoder, channels, 'audio/ogg');
}
