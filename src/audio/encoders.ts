import { createMp3Encoder, createOggEncoder } from 'wasm-media-encoders';
import type { WasmMediaEncoder } from 'wasm-media-encoders';
import { holdDecodedPeak, turned } from './decodedPeak';
import { LIMITER_CEILING_DBTP } from './effects/limiter';
import { withGaplessInfo } from './mp3Gapless';
import { encodeChannels } from './wavFile';
import type { WavCue } from './wavCues';

/**
 * Audio file formats for exports. WAV is the exact one (and the only one with markers and loop
 * points); MP3 and Ogg Vorbis are small, for sharing and for games (Godot and Unity both import
 * Ogg Vorbis, and play it with a seamless loop). The encoders are the reference LAME and libvorbis
 * compiled to WebAssembly (wasm-media-encoders), bundled into the app so they work offline. Both
 * decode to the exact sample: Vorbis on its own, MP3 with the Info frame mp3Gapless.ts adds. A
 * compressed file is decoded and measured once it's made, and turned down by any overshoot of
 * its ceiling (decodedPeak.ts), so it's limited as a WAV is and still never passes -1 dBTP.
 */
export const AUDIO_FORMATS = ['wav', 'mp3', 'ogg'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export const FORMAT_EXTENSION: Record<AudioFormat, string> = { wav: 'wav', mp3: 'mp3', ogg: 'ogg' };

export interface EncodeOptions {
  bitDepth: 16 | 24 | 32;
  cues?: readonly WavCue[];
  loop?: { start: number; end: number };
  /** A 16-bit WAV's dither sequence: each stem its own (see wavFile.ts) */
  ditherSeed?: number;
  /**
   * MP3 and Ogg: the true peak (dBTP) the decoded file is held under (see decodedPeak.ts). Default
   * -1, the limiter's; null: encoded as it comes (stems, whose levels must keep adding up to the mix).
   */
  ceilingDbtp?: number | null;
  /** Told how far a compressed file was turned down to stay under its ceiling (dB; 0: not at all). */
  onTrim?: (db: number) => void;
  /** How a compressed file is decoded to measure it (default: the browser's decodeAudioData; null: can't). */
  decode?: (bytes: ArrayBuffer, sampleRate: number, channels: number) => Promise<Float32Array[] | null>;
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
  if (type !== 'audio/mpeg') return new Blob(parts, { type });
  // The Info frame in front, so the file decodes without LAME's delay and padding (mp3Gapless.ts)
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  return new Blob([withGaplessInfo(bytes, channels[0].length) as Uint8Array<ArrayBuffer>], { type });
}

/** One encoding of `channels` in a compressed format: MP3 at 320 kb/s, Ogg Vorbis at quality 8 (about 256 kb/s). */
async function compressAs(channels: Float32Array[], sampleRate: number, format: 'mp3' | 'ogg'): Promise<Blob> {
  if (format === 'mp3') {
    const encoder = await createMp3Encoder();
    encoder.configure({ sampleRate, channels: channels.length as 1 | 2, bitrate: 320 });
    return compress(encoder, channels, 'audio/mpeg');
  }
  const encoder = await createOggEncoder();
  encoder.configure({ sampleRate, channels: channels.length as 1 | 2, vbrQuality: 8 });
  return compress(encoder, channels, 'audio/ogg');
}

/** The browser's decoder, at the file's own rate (a resampled decode would move its peaks). */
async function browserDecode(bytes: ArrayBuffer, sampleRate: number, channels: number): Promise<Float32Array[] | null> {
  if (typeof OfflineAudioContext === 'undefined') return null;
  try {
    const audio = await new OfflineAudioContext(channels, 1, sampleRate).decodeAudioData(bytes);
    return Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  } catch {
    return null;
  }
}

/**
 * Several sounds encoded in a compressed format with one gain, so they keep their levels to each
 * other (a game's intro and its loop, which play one into the other): turned down together by the
 * most any of them overshot the ceiling (see EncodeOptions.ceilingDbtp).
 */
export async function encodeTogether(sounds: Float32Array[][], sampleRate: number, format: 'mp3' | 'ogg', opts: Pick<EncodeOptions, 'ceilingDbtp' | 'onTrim' | 'decode'> = {}): Promise<Blob[]> {
  const ceiling = opts.ceilingDbtp === undefined ? LIMITER_CEILING_DBTP : opts.ceilingDbtp;
  const encodeAll = (gain: number) => Promise.all(sounds.map((s) => compressAs(turned(s, gain), sampleRate, format)));
  if (ceiling === null) return encodeAll(1);
  const decode = opts.decode ?? browserDecode;
  const { encoded, trimDb } = await holdDecodedPeak(encodeAll, async (blobs) => {
    const all: Float32Array[] = [];
    for (const [i, blob] of blobs.entries()) {
      const d = await decode(await blob.arrayBuffer(), sampleRate, sounds[i].length);
      if (!d) return null;
      all.push(...d);
    }
    return all;
  }, ceiling);
  opts.onTrim?.(trimDb);
  return encoded;
}

/** Encode rendered channels (one or two) in `format`. MP3 at 320 kb/s, Ogg Vorbis at quality 8 (about 256 kb/s). */
export async function encodeAudio(channels: Float32Array[], sampleRate: number, format: AudioFormat, opts: EncodeOptions): Promise<Blob> {
  if (format === 'wav') return encodeChannels(channels, sampleRate, opts.bitDepth, opts.cues ?? [], opts.loop, opts.ditherSeed);
  const [blob] = await encodeTogether([channels], sampleRate, format, opts);
  return blob;
}
