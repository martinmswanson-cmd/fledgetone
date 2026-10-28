// Gapless MP3 (src/audio/mp3Gapless.ts): the Info frame in front of the encoder's frames says how many samples are LAME's own, so the file decodes to the exact sample. And a compressed file held under its ceiling once decoded (decodedPeak.ts, encoders.ts).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import pathMod from 'node:path';

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

const { withGaplessInfo, readFrame, crc16, ENCODER_DELAY } = await import('../src/audio/mp3Gapless.ts');
const { holdDecodedPeak, BLIND_TRIM_DB } = await import('../src/audio/decodedPeak.ts');
const { encodeAudio, encodeTogether } = await import('../src/audio/encoders.ts');
const { createMp3Encoder } = await import('wasm-media-encoders');

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** LAME's frames for `channels`, as the encoder makes them (no Info frame). */
async function lame(channels, sampleRate) {
  const encoder = await createMp3Encoder();
  encoder.configure({ sampleRate, channels: channels.length, bitrate: 320 });
  const parts = [Buffer.from(encoder.encode(channels)), Buffer.from(encoder.finalize())];
  return new Uint8Array(Buffer.concat(parts));
}

const tone = (n, sr, hz, at = 100) => {
  const x = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / sr));
  x[at] = 0.95; // a click to find the start by
  return x;
};

test('the Info frame: a silent first frame with the frame count, the size, a seek table, the delay and padding, and good CRCs', async () => {
  for (const [sr, n, ch] of [[44100, 44100 * 2 + 123, 2], [48000, 30001, 2], [44100, 20000, 1]]) {
    const raw = await lame(Array.from({ length: ch }, () => tone(n, sr, 440)), sr);
    const out = withGaplessInfo(raw, n);
    const info = readFrame(out, 0);
    assert.ok(info && info.sampleRate === sr && info.mono === (ch === 1));
    // The encoder's frames follow it untouched
    assert.deepEqual(out.subarray(info.length), raw);
    let frames = 0;
    for (let at = 0; at < raw.length; at += readFrame(raw, at).length) frames++;
    const tagAt = 4 + (ch === 1 ? 17 : 32);
    const view = new DataView(out.buffer, out.byteOffset);
    assert.equal(String.fromCharCode(...out.subarray(tagAt, tagAt + 4)), 'Info');
    assert.equal(view.getUint32(tagAt + 8), frames);
    assert.equal(view.getUint32(tagAt + 12), out.length);
    assert.equal(String.fromCharCode(...out.subarray(tagAt + 120, tagAt + 129)), 'LAME3.100');
    const delay = (out[tagAt + 141] << 4) | (out[tagAt + 142] >> 4);
    const padding = ((out[tagAt + 142] & 0xf) << 8) | out[tagAt + 143];
    assert.equal(delay, ENCODER_DELAY);
    assert.equal(delay + n + padding, frames * 1152);
    assert.equal(view.getUint16(tagAt + 152), crc16(raw));
    assert.equal(view.getUint16(tagAt + 154), crc16(out, 0, tagAt + 154));
    // Already tagged: left as it is
    assert.equal(withGaplessInfo(out, n), out);
  }
  // CRC-16/ARC's check value
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0xbb3d);
  // Not an MP3: as it came
  const junk = Uint8Array.of(1, 2, 3, 4, 5);
  assert.equal(withGaplessInfo(junk, 10), junk);
});

test('the app\'s MP3 decodes to the exact sample: no delay at the start, no padding at the end (ffmpeg)', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'gapless-'));
  try {
    for (const [sr, n] of [[44100, 44100 * 3 + 77], [48000, 48000 + 5]]) {
      const l = tone(n, sr, 440);
      const r = tone(n, sr, 550);
      const mp3 = await encodeAudio([l, r], sr, 'mp3', { bitDepth: 16, ceilingDbtp: null });
      fs.writeFileSync(pathMod.join(dir, 'a.mp3'), Buffer.from(await mp3.arrayBuffer()));
      const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', pathMod.join(dir, 'a.mp3'), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
      const left = Float32Array.from({ length: pcm.length / 8 }, (_, i) => pcm.readFloatLE(i * 8));
      assert.equal(left.length, n, `${sr}: decoded length`);
      let most = 0;
      for (let i = 1; i < 400; i++) if (Math.abs(left[i]) > Math.abs(left[most])) most = i;
      assert.equal(most, 100, `${sr}: the click lands where it was`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a compressed file over its ceiling once decoded is turned down by the overshoot, and only then encoded again', async () => {
  // A stand-in codec that adds 0.8 dB to the peaks
  const over = 10 ** (0.8 / 20);
  let encodes = 0;
  const encode = async (gain) => {
    encodes++;
    return gain;
  };
  const decode = async (gain) => [Float32Array.of(0, 0.89 * gain * over, 0)];
  const { encoded, trimDb } = await holdDecodedPeak(encode, decode, -1);
  assert.ok(trimDb > 0.7 && trimDb < 0.95, `turned down ${trimDb.toFixed(2)} dB`);
  assert.ok(0.89 * encoded * over <= 10 ** (-1 / 20), 'under the ceiling decoded');
  assert.equal(encodes, 2);
  // Under the ceiling already: once, untouched
  encodes = 0;
  const quiet = await holdDecodedPeak(encode, async (g) => [Float32Array.of(0.5 * g)], -1);
  assert.deepEqual([quiet.trimDb, quiet.encoded, encodes], [0, 1, 1]);
  // Can't decode: turned down the blind amount
  const blind = await holdDecodedPeak(encode, async () => null, -1);
  assert.ok(Math.abs(blind.trimDb - BLIND_TRIM_DB) < 1e-9);
});

test('an intro and its loop are turned down together, by the most either overshot (ffmpeg decoding)', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const sr = 44100;
  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'together-'));
  try {
    const decode = async (bytes) => {
      fs.writeFileSync(pathMod.join(dir, 'x.mp3'), Buffer.from(bytes));
      const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', pathMod.join(dir, 'x.mp3'), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
      const l = Float32Array.from({ length: pcm.length / 8 }, (_, i) => pcm.readFloatLE(i * 8));
      const r = Float32Array.from({ length: pcm.length / 8 }, (_, i) => pcm.readFloatLE(i * 8 + 4));
      return [l, r];
    };
    // The hot one 3 dB over -1 dBTP (as a render limited for something else would be), the calm one far under
    const hot = [0, 1].map(() => Float32Array.from({ length: sr }, (_, i) => 1.26 * Math.sin((2 * Math.PI * 1000 * i) / sr)));
    const calm = [0, 1].map(() => Float32Array.from({ length: sr }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / sr)));
    let told = -1;
    const [a, b] = await encodeTogether([hot, calm], sr, 'mp3', { decode, onTrim: (db) => (told = db) });
    assert.ok(told > 2.8 && told < 3.4, `turned down ${told.toFixed(2)} dB`);
    for (const blob of [a, b]) {
      const [l, r] = await decode(await blob.arrayBuffer());
      let peak = 0;
      for (const ch of [l, r]) for (const v of ch) peak = Math.max(peak, Math.abs(v));
      assert.ok(20 * Math.log10(peak) <= -1, `decoded peak ${(20 * Math.log10(peak)).toFixed(2)} dBFS`);
    }
    // The calm one turned down as much: 0.1 is now about 0.07
    const [cl] = await decode(await b.arrayBuffer());
    let cp = 0;
    for (const v of cl) cp = Math.max(cp, Math.abs(v));
    assert.ok(Math.abs(20 * Math.log10(cp / 0.1) + told) < 0.3, `calm one at ${(20 * Math.log10(cp)).toFixed(2)} dBFS`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
