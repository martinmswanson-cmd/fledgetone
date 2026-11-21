// The reading check's made sounds: one known property planted in each (a click, a resonance, a wobble,
// a pump, width in one band, clipping, hum, and two pairs: dull and bright, clean and distorted bass),
// written as 48 kHz, 24-bit stereo WAV files of 8 seconds. expected.json says what each holds; README.md
// says how an agent is asked to find it. Also exports the 24-bit WAV reader and writer the README's
// planting script uses.
// Run with `node scripts/audio-check/hearing/make.mjs <out folder>`.
import { register } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);

const S = await import('../../fixtures/hearingSignals.mjs');

export const SR = 48000;
const SECONDS = 8;
const lin = (db) => 10 ** (db / 20);
const rmsOf = (x, from = 0, to = x.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};
/** `x` scaled to `rmsDb` RMS. */
const atRms = (x, rmsDb) => S.gain(x, rmsDb - 20 * Math.log10(rmsOf(x)));

/** A WAV file's channels and rate (16-bit, 24-bit or 32-bit float PCM). */
export function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error(`${path} isn't a WAV file`);
  let at = 12;
  let fmt;
  while (at + 8 <= buf.length) {
    const id = buf.toString('latin1', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(at + 8), channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    if (id === 'data' && fmt) {
      const bytes = fmt.bits / 8;
      const frames = Math.floor(Math.min(size, buf.length - at - 8) / (bytes * fmt.channels));
      const float = fmt.bits === 32 && (fmt.format === 3 || fmt.format === 0xfffe);
      const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < fmt.channels; c++) {
          const p = at + 8 + bytes * (i * fmt.channels + c);
          channels[c][i] = float ? buf.readFloatLE(p) : buf.readIntLE(p, bytes) / 2 ** (fmt.bits - 1);
        }
      return { sampleRate: fmt.rate, channels };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error(`${path} has no sound in it`);
}

/** Writes `channels` as a 24-bit PCM WAV, each sample rounded and held inside full scale. */
export function writeWav24(path, channels, sampleRate = SR) {
  const frames = channels[0].length;
  const n = channels.length;
  const data = 3 * n * frames;
  const buf = Buffer.alloc(44 + data);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(36 + data, 4);
  buf.write('WAVEfmt ', 8, 'latin1');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(n, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 3 * n, 28);
  buf.writeUInt16LE(3 * n, 32);
  buf.writeUInt16LE(24, 34);
  buf.write('data', 36, 'latin1');
  buf.writeUInt32LE(data, 40);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < n; c++) buf.writeIntLE(Math.max(-8388608, Math.min(8388607, Math.round(channels[c][i] * 8388608))), 44 + 3 * (i * n + c), 3);
  writeFileSync(path, buf);
}

/**
 * Raises one sample at `seconds` in every channel by `times` the RMS of the 50 ms around it: a click.
 * Changes the channels in place.
 */
export function plantClick(channels, sampleRate, seconds, times = 4) {
  const i = Math.round(seconds * sampleRate);
  const half = Math.round(0.025 * sampleRate);
  for (const c of channels) c[i] += Math.sign(c[i] || 1) * times * rmsOf(c, Math.max(0, i - half), Math.min(c.length, i + half));
}

/** Pink noise from 40 Hz to 16 kHz at `rmsDb`. */
const bandPink = (rmsDb, seed) => atRms(S.band(S.pink(SECONDS, 0, seed), 40, 16000), rmsDb);

/**
 * The bed: sines at 220 and 330 Hz over pink noise from 40 Hz to 16 kHz, the same in both channels, with
 * each channel's own quieter noise above 300 Hz so it is stereo but its low end is not wide.
 */
function bed() {
  const shared = S.mix(S.sine(220, SECONDS, -16), S.sine(330, SECONDS, -19), bandPink(-24, 1));
  return [2, 3].map((seed) => S.mix(shared, atRms(S.band(S.pink(SECONDS, 0, seed), 300, 16000), -36)));
}

/** A level envelope that dips by `dipDb` at each of `rate` beats a second and comes back over `backMs`. */
function dips(rate, dipDb, backMs) {
  const n = SECONDS * SR;
  const out = new Float32Array(n);
  const low = lin(-dipDb);
  for (let i = 0; i < n; i++) {
    const t = (i / SR) % (1 / rate);
    const into = 0.003; // a 3 ms fall, so the dip itself is no click
    out[i] = t < into ? 1 - (1 - low) * (t / into) : low + (1 - low) * Math.min(1, (t - into) / (backMs / 1000)) ** 2;
  }
  return out;
}
const times = (x, env) => Float32Array.from(x, (v, i) => v * env[i]);
const both = (x) => [x, Float32Array.from(x)];

/** Each made file's name and its channels. */
export function madeSounds() {
  return {
    'clean.wav': () => bed(),
    'click.wav': () => {
      const ch = bed();
      plantClick(ch, SR, 5);
      return ch;
    },
    'resonance.wav': () => [1, 2].map((seed) => S.mix(S.pink(SECONDS, -18, seed), atRms(S.sine(3000, SECONDS, 0), -30))),
    'wobble.wav': () => {
      const bass = S.gate(S.saw(55, SECONDS, -6), 6, -12);
      const hiss = (seed) => atRms(S.band(S.pink(SECONDS, 0, seed), 300, 20000), 20 * Math.log10(rmsOf(bass)) - 12);
      return [S.mix(bass, hiss(1)), S.mix(bass, hiss(2))];
    },
    'pump.wav': () => {
      const chords = times(S.mix(S.saw(440, SECONDS, -12), S.saw(554, SECONDS, -12)), dips(2, 6, 300));
      const thump = S.decay(S.sine(60, 0.1, -6), 30);
      return both(S.mix(chords, S.every(2, SECONDS, () => thump)));
    },
    'side-band.wav': () => {
      const mid = S.pink(SECONDS, -20, 1);
      const side = atRms(S.band(S.white(SECONDS, 0, 2), 5000, 10000), -30);
      return [S.mix(mid, side), S.mix(mid, side.map((v) => -v))];
    },
    'clipping.wav': () => both(S.clip(S.sine(200, SECONDS, 6), 1)),
    'hum.wav': () => [1, 2].map((seed) => S.mix(S.pink(SECONDS, -18, seed), atRms(S.sine(60, SECONDS, 0), -24), atRms(S.sine(120, SECONDS, 0), -24))),
    'dull.wav': () => [1, 2].map((seed) => S.pink(SECONDS, -18, seed)),
    'bright.wav': () => [1, 2].map((seed) => S.mix(S.pink(SECONDS, -18, seed), atRms(S.band(S.white(SECONDS, 0, seed + 10), 5000, 16000), -18))),
    'clean-bass.wav': () => both(S.sine(55, SECONDS, -6)),
    'distorted-bass.wav': () => both(S.clip(S.gain(S.sine(55, SECONDS, -6), 18), 0.5)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const folder = process.argv[2];
  if (!folder) {
    console.error('Usage: node scripts/audio-check/hearing/make.mjs <out folder>');
    process.exit(2);
  }
  mkdirSync(folder, { recursive: true });
  for (const [name, make] of Object.entries(madeSounds())) {
    writeWav24(join(folder, name), make());
    console.log(name);
  }
}
