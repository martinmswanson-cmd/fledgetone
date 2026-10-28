import { createMp3Encoder, createOggEncoder } from 'wasm-media-encoders';
import type { WasmMediaEncoder } from 'wasm-media-encoders';
import { BLIND_TRIM_DB, holdDecodedPeak, truePeakInPieces, type HeldReport } from './decodedPeak';
import { LIMITER_CEILING_DBTP } from './effects/limiter';
import { withGaplessInfo } from './mp3Gapless';
import { encodeChannels } from './wavFile';
import type { WavCue } from './wavCues';

/**
 * Audio file formats for exports. WAV is the exact one (and the only one with markers and loop
 * points); MP3 and Ogg Vorbis are small, for sharing and for games (Godot and Unity both import
 * Ogg Vorbis, and play it with a seamless loop). The encoders are the reference LAME and libvorbis
 * compiled to WebAssembly (wasm-media-encoders), bundled into the app so they work offline. An MP3
 * decodes to the exact sample with the Info frame mp3Gapless.ts adds (ffmpeg, Chromium); an Ogg
 * does in game engines and ffmpeg, though a browser's decodeAudioData (Chromium's) leaves about
 * 10 ms of the encoder's padding on its end. A compressed file is decoded and measured once it's
 * made, and turned down by any overshoot of its ceiling (decodedPeak.ts), so it's limited as a
 * WAV is and still never passes -1 dBTP.
 */
export const AUDIO_FORMATS = ['wav', 'mp3', 'ogg'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

export const FORMAT_EXTENSION: Record<AudioFormat, string> = { wav: 'wav', mp3: 'mp3', ogg: 'ogg' };

export type { HeldReport } from './decodedPeak';

export interface EncodeOptions {
  bitDepth: 16 | 24 | 32;
  cues?: readonly WavCue[];
  loop?: { start: number; end: number };
  /** A 16-bit WAV's dither sequence: each stem its own (see wavFile.ts) */
  ditherSeed?: number;
  /**
   * MP3 and Ogg: the true peak (dBTP) the decoded file is held under (see decodedPeak.ts). Default
   * -1, the limiter's; null: encoded as it comes.
   */
  ceilingDbtp?: number | null;
  /** Told what holding a compressed file under its ceiling did (see HeldReport). */
  onHeld?: (held: HeldReport) => void;
  /** How a compressed file is decoded to measure it (default: the browser's decodeAudioData; null: can't). */
  decode?: (bytes: ArrayBuffer, sampleRate: number, channels: number) => Promise<Float32Array[] | null>;
  /** Stops the encoding (and the passes measuring it) part way. */
  signal?: AbortSignal;
}

/** Samples handed to an encoder at a time, so a long song never needs one huge copy. */
const CHUNK = 1 << 16;

async function compress(encoder: WasmMediaEncoder<'audio/mpeg'> | WasmMediaEncoder<'audio/ogg'>, channels: readonly Float32Array[], gain: number, type: string, signal?: AbortSignal): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  // The encoder owns the bytes it returns: copy them out before the next call
  const keep = (bytes: Uint8Array) => {
    if (bytes.length) parts.push(new Uint8Array(bytes));
  };
  const scratch = gain === 1 ? null : channels.map(() => new Float32Array(CHUNK));
  for (let at = 0; at < channels[0].length; at += CHUNK) {
    // Turned by `gain` a chunk at a time (no turned copy of the whole song)
    const piece = channels.map((ch, c) => {
      const part = ch.subarray(at, at + CHUNK);
      if (!scratch) return part;
      const out = scratch[c].subarray(0, part.length);
      for (let i = 0; i < part.length; i++) out[i] = part[i] * gain;
      return out;
    });
    keep(encoder.encode(piece));
    // Let the page breathe between chunks (a long song takes a few seconds)
    if ((at / CHUNK) % 4 === 3) {
      await new Promise((r) => setTimeout(r, 0));
      signal?.throwIfAborted();
    }
  }
  keep(encoder.finalize());
  if (type !== 'audio/mpeg') return new Blob(parts, { type });
  // The Info frame in front, so the file decodes without LAME's delay and padding (mp3Gapless.ts)
  const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
  return new Blob([withGaplessInfo(bytes, channels[0].length) as Uint8Array<ArrayBuffer>], { type });
}

/** One encoding of `channels` turned by `gain` in a compressed format: MP3 at 320 kb/s, Ogg Vorbis at quality 8 (about 256 kb/s). */
async function compressAs(channels: readonly Float32Array[], sampleRate: number, format: 'mp3' | 'ogg', gain = 1, signal?: AbortSignal): Promise<Blob> {
  if (format === 'mp3') {
    const encoder = await createMp3Encoder();
    encoder.configure({ sampleRate, channels: channels.length as 1 | 2, bitrate: 320 });
    return compress(encoder, channels, gain, 'audio/mpeg', signal);
  }
  const encoder = await createOggEncoder();
  encoder.configure({ sampleRate, channels: channels.length as 1 | 2, vbrQuality: 8 });
  return compress(encoder, channels, gain, 'audio/ogg', signal);
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
 * A sound to encode: its channels, or how to get them (a stem parked in a Blob until it's
 * encoded, so a dozen long stems are never all in memory at once).
 */
export type SoundSource = readonly Float32Array[] | (() => Promise<readonly Float32Array[]>);

/**
 * Several sounds encoded in a compressed format with one gain, so they keep their levels to each
 * other (a game's intro and its loop, which play one into the other; stems or layers, which must
 * keep adding up to the mix; a song's versions): turned down together by the most any of them
 * overshot the ceiling (see EncodeOptions.ceilingDbtp). One sound is in hand at a time.
 */
export async function encodeTogether(sounds: readonly SoundSource[], sampleRate: number, format: 'mp3' | 'ogg', opts: Pick<EncodeOptions, 'ceilingDbtp' | 'onHeld' | 'decode' | 'signal'> = {}): Promise<Blob[]> {
  const ceiling = opts.ceilingDbtp === undefined ? LIMITER_CEILING_DBTP : opts.ceilingDbtp;
  const channelsOf = async (s: SoundSource) => (typeof s === 'function' ? await s() : s);
  const counts: number[] = [];
  const encodeAll = async (gain: number) => {
    const out: Blob[] = [];
    for (const [i, s] of sounds.entries()) {
      const channels = await channelsOf(s);
      counts[i] = channels.length;
      out.push(await compressAs(channels, sampleRate, format, gain, opts.signal));
    }
    return out;
  };
  if (ceiling === null) {
    const blobs = await encodeAll(1);
    opts.onHeld?.({ trimDb: 0, peakDbtp: null });
    return blobs;
  }
  const decode = opts.decode ?? browserDecode;
  // The most any of them peaks once decoded (null: one of them can't be decoded), each decoded and let go of in turn
  const measure = async (blobs: Blob[]) => {
    let peak = 0;
    for (const [i, blob] of blobs.entries()) {
      const decoded = await decode(await blob.arrayBuffer(), sampleRate, counts[i]);
      if (!decoded) return null;
      peak = Math.max(peak, await truePeakInPieces(decoded, opts.signal));
    }
    return peak;
  };
  const held = await holdDecodedPeak(encodeAll, measure, ceiling, { blindTrimDb: BLIND_TRIM_DB[format], signal: opts.signal });
  opts.onHeld?.({ trimDb: held.trimDb, peakDbtp: held.peakDbtp });
  return held.encoded;
}

/** Encode rendered channels (one or two) in `format`. MP3 at 320 kb/s, Ogg Vorbis at quality 8 (about 256 kb/s). */
export async function encodeAudio(channels: Float32Array[], sampleRate: number, format: AudioFormat, opts: EncodeOptions): Promise<Blob> {
  if (format === 'wav') return encodeChannels(channels, sampleRate, opts.bitDepth, opts.cues ?? [], opts.loop, opts.ditherSeed);
  const [blob] = await encodeTogether([channels], sampleRate, format, opts);
  return blob;
}
