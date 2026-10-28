/**
 * Gapless MP3: the Info frame (Xing header with LAME's extension) that tells a decoder how many
 * samples of an MP3 are the encoder's own. LAME starts every file with ENCODER_DELAY samples of
 * its own before the sound and pads the end out to a whole frame; without this frame a player
 * can't know, so the sound starts about 25 ms late (1105 samples: those 576 and the decoder's 529)
 * and a loop gaps. The encoder in the app (wasm-media-encoders) doesn't write it, so encoders.ts
 * adds it to what the encoder made: a silent first frame holding the frame count, the size, a seek
 * table and the delay and padding, as LAME itself writes it. ffmpeg, Chromium and the usual players
 * read it and decode the file to the exact sample. Plain bytes, no audio engine, so Node tests it.
 */

/** Samples LAME puts before the sound (lame_get_encoder_delay). */
export const ENCODER_DELAY = 576;

const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES_V1 = [44100, 48000, 32000];

/** One MPEG audio layer III frame's header, read from `at`; null where there's no frame. */
export function readFrame(b: Uint8Array, at: number): { length: number; samples: number; mpeg1: boolean; mono: boolean; bitrateIndex: number; sampleRate: number } | null {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[at + 1] >> 3) & 3; // 3: MPEG 1, 2: MPEG 2, 0: MPEG 2.5
  const layer = (b[at + 1] >> 1) & 3;
  const bitrateIndex = b[at + 2] >> 4;
  const rateIndex = (b[at + 2] >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const mpeg1 = version === 3;
  const sampleRate = RATES_V1[rateIndex] / (mpeg1 ? 1 : version === 2 ? 2 : 4);
  const kbps = (mpeg1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex];
  const padding = (b[at + 2] >> 1) & 1;
  const length = Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / sampleRate) + padding;
  return { length, samples: mpeg1 ? 1152 : 576, mpeg1, mono: b[at + 3] >> 6 === 3, bitrateIndex, sampleRate };
}

/** CRC-16 as LAME's tag uses it (polynomial 0x8005, reflected: CRC-16/ARC), carried on from `crc`. */
export function crc16(b: Uint8Array, from = 0, to = b.length, crc = 0): number {
  for (let i = from; i < to; i++) {
    crc ^= b[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/**
 * `mp3` (LAME's frames, as the encoder made them from `samples` samples a channel) with an Info
 * frame in front saying how many of the decoded samples are the sound. Returned as it is when it
 * doesn't start with a frame, already has a Xing or Info frame, or the numbers don't fit.
 */
export function withGaplessInfo(mp3: Uint8Array, samples: number, encoderDelay = ENCODER_DELAY): Uint8Array {
  const first = readFrame(mp3, 0);
  if (!first) return mp3;
  const sideInfo = first.mpeg1 ? (first.mono ? 17 : 32) : first.mono ? 9 : 17;
  const tagAt = 4 + sideInfo;
  const tag = String.fromCharCode(...mp3.subarray(tagAt, tagAt + 4));
  if (tag === 'Xing' || tag === 'Info') return mp3;
  // Count the frames (every one the same kind: LAME's)
  let frames = 0;
  for (let at = 0; at < mp3.length; ) {
    const f = readFrame(mp3, at);
    if (!f) break;
    frames++;
    at += f.length;
  }
  const padding = frames * first.samples - encoderDelay - samples;
  if (padding < 0 || padding > 4095 || encoderDelay > 4095) return mp3;
  // The Info frame: the first frame's header (its bitrate, rate and channels: a constant-bitrate
  // file stays one), no padding, no CRC, and silence (an all-zero side info decodes to nothing)
  const size = readFrame(Uint8Array.of(mp3[0], mp3[1] | 1, mp3[2] & ~2, mp3[3]), 0)!.length;
  if (size < tagAt + 156) return mp3;
  const info = new Uint8Array(size);
  info.set([mp3[0], mp3[1] | 1, mp3[2] & ~2, mp3[3]]);
  const view = new DataView(info.buffer);
  const total = size + mp3.length;
  let o = tagAt;
  const text = (s: string) => {
    for (let i = 0; i < s.length; i++) info[o++] = s.charCodeAt(i);
  };
  text('Info'); // constant bitrate ('Xing' is for VBR)
  view.setUint32(o, 0x0f); // frames, bytes, seek table, quality
  view.setUint32(o + 4, frames);
  view.setUint32(o + 8, total);
  o += 12;
  // The seek table: at a constant bitrate, n% of the time is n% of the bytes
  for (let i = 0; i < 100; i++) info[o++] = Math.floor((i * 256) / 100);
  view.setUint32(o, 0); // quality (unknown)
  o += 4;
  // LAME's extension
  text('LAME3.100');
  info[o++] = 0x01; // tag revision 0, constant bitrate
  info[o++] = 0; // lowpass (not given)
  o += 4 + 2 + 2; // peak, radio and audiophile replay gain (none)
  info[o++] = 0; // encoding flags, ATH type
  info[o++] = Math.min(255, (first.mpeg1 ? BITRATES_V1 : BITRATES_V2)[first.bitrateIndex]);
  info[o++] = encoderDelay >> 4;
  info[o++] = ((encoderDelay & 0xf) << 4) | (padding >> 8);
  info[o++] = padding & 0xff;
  o += 1 + 1 + 2; // misc, MP3 gain, preset and surround (none)
  view.setUint32(o, total); // the music's length in bytes, this frame included
  o += 4;
  view.setUint16(o, crc16(mp3)); // the music's CRC
  o += 2;
  view.setUint16(o, crc16(info, 0, o)); // this tag's CRC: everything before it
  const out = new Uint8Array(total);
  out.set(info);
  out.set(mp3, size);
  return out;
}
