import { cueChunks, loopChunk } from './wavCues';
import type { WavCue } from './wavCues';

/**
 * A WAV file from rendered channels: 16- or 24-bit PCM (16-bit with a quiet TPDF dither), or
 * 32-bit float, with cue points and loop points after the audio. No audio engine here, so Node
 * can unit-test it; exportWav.ts and the game kit write their files with it.
 */

/** A dither seed for a file named `name` (a stem's track id): the same name always gets the same one. */
export function ditherSeedOf(name: string): number {
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The bit depth of the sounds the app renders and keeps in the library (frozen tracks, bounces to a
 * pad, resamples): 24-bit, so a part played back from one is as clean as the part was (16-bit's
 * dither hiss sat about 96 dB down and added up with every frozen track). Older 16-bit ones still
 * load and play as they were.
 */
export const KEPT_RENDER_BITS = 24;

/** Encode `data` (one array per channel) as a WAV file at `bitDepth` bits. */
export function encodeChannels(
  data: Float32Array[],
  sampleRate: number,
  bitDepth: 16 | 24 | 32,
  cues: readonly WavCue[] = [],
  /** Frames [start, end) the file loops (written as a 'smpl' chunk). */
  loop?: { start: number; end: number },
  /**
   * Which dither sequence a 16-bit file gets (see ditherSeedOf). Files meant to be mixed together
   * (stems) each need their own: with one shared sequence their dither adds up in step, 6 dB
   * louder per doubling of the files instead of 3, a hiss that grows with every stem.
   */
  ditherSeed = 0
): Blob {
  const channels = data.length;
  const frames = data[0].length;
  const float = bitDepth === 32;
  const blockAlign = channels * (bitDepth / 8);
  const dataSize = frames * blockAlign;
  // Float WAVs need the extended 18-byte format chunk and a fact chunk (the frame count)
  const formatSize = float ? 18 : 16;
  const headerSize = 12 + 8 + formatSize + (float ? 12 : 0) + 8;
  // Chunks after the audio (readers that expect the audio straight after the header still find
  // it there). A chunk of odd length is padded to an even one before the next.
  const cueBytes = cueChunks(cues);
  const loopBytes = loop ? loopChunk(sampleRate, loop.start, loop.end) : new Uint8Array(0);
  const trailer = new Uint8Array(cueBytes.length + loopBytes.length);
  trailer.set(cueBytes);
  trailer.set(loopBytes, cueBytes.length);
  // (RIFF pads every odd-sized chunk, the last one too)
  const pad = dataSize & 1;
  const view = new DataView(new ArrayBuffer(headerSize + dataSize + pad + trailer.length));

  let offset = 0;
  const text = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i));
  };
  const u16 = (v: number) => {
    view.setUint16(offset, v, true);
    offset += 2;
  };
  const u32 = (v: number) => {
    view.setUint32(offset, v, true);
    offset += 4;
  };

  text('RIFF');
  u32(headerSize - 8 + dataSize + pad + trailer.length);
  text('WAVE');
  text('fmt ');
  u32(formatSize);
  u16(float ? 3 : 1); // WAVE_FORMAT_IEEE_FLOAT or WAVE_FORMAT_PCM
  u16(channels);
  u32(sampleRate);
  u32(sampleRate * blockAlign);
  u16(blockAlign);
  u16(bitDepth);
  if (float) {
    u16(0); // no extension
    text('fact');
    u32(4);
    u32(frames);
  }
  text('data');
  u32(dataSize);

  // The dither's random numbers: a fixed sequence per seed, so the same mix makes the same file
  let seed = (0x9e3779b9 ^ Math.imul(ditherSeed | 0, 0x85ebca6b)) >>> 0 || 0x9e3779b9;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      if (float) {
        view.setFloat32(offset, data[c][i], true);
        offset += 4;
        continue;
      }
      const s = Math.max(-1, Math.min(1, data[c][i]));
      if (bitDepth === 16) {
        // TPDF dither (two random values, ±1 step in all): the rounding error becomes a steady,
        // very quiet hiss instead of distortion that follows the music, which a fade or a soft
        // reverb tail would otherwise end in. Digital silence stays silent.
        // One scale for both halves of the wave, as readers divide by it: scaling the positive half
        // by one step less bent the wave (a second harmonic at -104 dB). Full scale clips one step
        // short at the top, as the format has one step fewer there.
        const dither = s === 0 ? 0 : random() - random();
        view.setInt16(offset, Math.max(-0x8000, Math.min(0x7fff, Math.round(s * 0x8000 + dither))), true);
        offset += 2;
      } else {
        const v = Math.min(0x7fffff, Math.round(s * 0x800000));
        view.setUint8(offset, v & 0xff);
        view.setUint8(offset + 1, (v >> 8) & 0xff);
        view.setUint8(offset + 2, (v >> 16) & 0xff);
        offset += 3;
      }
    }
  }
  new Uint8Array(view.buffer).set(trailer, offset + pad);
  return new Blob([view], { type: 'audio/wav' });
}
