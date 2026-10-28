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
const { holdDecodedPeak, BLIND_TRIM_DB, truePeakInPieces, streamingTruePeak } = await import('../src/audio/decodedPeak.ts');
const { truePeakOf } = await import('../src/audio/loudness.ts');
const { limitChannels } = await import('../src/audio/effects/limiter.ts');
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
  const measure = async (gain) => 0.89 * gain * over;
  const held = await holdDecodedPeak(encode, measure, -1, { blindTrimDb: 2 });
  assert.ok(held.trimDb > 0.7 && held.trimDb < 0.95, `turned down ${held.trimDb.toFixed(2)} dB`);
  assert.ok(0.89 * held.encoded * over <= 10 ** (-1 / 20), 'under the ceiling decoded');
  assert.ok(held.peakDbtp <= -1 && Math.abs(held.peakDbtp - 20 * Math.log10(0.89 * held.encoded * over)) < 1e-9, 'the decoded peak told');
  assert.equal(encodes, 2);
  // Under the ceiling already: once, untouched
  encodes = 0;
  const quiet = await holdDecodedPeak(encode, async (g) => 0.5 * g, -1, { blindTrimDb: 2 });
  assert.deepEqual([quiet.trimDb, quiet.encoded, encodes], [0, 1, 1]);
  // Can't decode: turned down the blind amount, the peak unknown
  for (const db of [BLIND_TRIM_DB.mp3, BLIND_TRIM_DB.ogg, BLIND_TRIM_DB.video]) {
    const blind = await holdDecodedPeak(encode, async () => null, -1, { blindTrimDb: db });
    assert.ok(Math.abs(blind.trimDb - db) < 1e-9);
    assert.equal(blind.peakDbtp, null);
  }
  // Measured once and over, then can't be: the blind amount comes off past the measured trim
  let calls = 0;
  const once = await holdDecodedPeak(encode, async (g) => (calls++ === 0 ? 0.89 * g * over : null), -1, { blindTrimDb: 2 });
  assert.ok(once.trimDb > 2.7 && once.trimDb < 2.95, `turned down ${once.trimDb.toFixed(2)} dB`);
});

test('MP3 at 320 kb/s blind: the turn-down covers what a dense, clipped mix overshoots (Ogg needs less)', () => {
  // Measured (ffmpeg): LAME overshot -1 dBTP by up to 1.8 dB on dense, clipped mixes; Vorbis by up to 0.7
  assert.ok(BLIND_TRIM_DB.mp3 >= 1.9);
  assert.ok(BLIND_TRIM_DB.ogg >= 0.8 && BLIND_TRIM_DB.ogg <= BLIND_TRIM_DB.mp3);
  assert.ok(BLIND_TRIM_DB.video >= 1.3);
});

test("an encoder whose peaks don't follow its gain: every pass is measured, and what's kept decoded under the ceiling", async () => {
  // A stand-in like LAME at 320 kb/s: turned down a little, its overshoot can grow (0.2 dB down came out higher)
  const ceiling = 10 ** (-1 / 20);
  for (let seed = 1; seed <= 200; seed++) {
    const wobble = (gain) => {
      let h = Math.imul(seed, 2654435761) ^ Math.round(gain * 1e6);
      h = Math.imul(h ^ (h >>> 15), 2246822519);
      return ((h >>> 0) / 2 ** 32) * 0.6; // 0 to 0.6 dB, unrelated to the gain
    };
    const base = 0.3 + (seed % 13) / 10; // a first overshoot of 0.3 to 1.5 dB
    const measured = new Set();
    const encode = async (gain) => ({ gain });
    const measure = async (e) => {
      measured.add(e);
      return 0.888 * e.gain * 10 ** ((base + wobble(e.gain)) / 20);
    };
    const held = await holdDecodedPeak(encode, measure, -1, { blindTrimDb: 2 });
    assert.ok(measured.has(held.encoded), `seed ${seed}: the file kept was measured`);
    assert.ok(held.peakDbtp !== null && held.peakDbtp <= -1, `seed ${seed}: kept at ${held.peakDbtp?.toFixed(3)} dBTP`);
    assert.ok(0.888 * held.encoded.gain * 10 ** ((base + wobble(held.encoded.gain)) / 20) <= ceiling);
  }
});

test('a Cancel stops the passes', async () => {
  const controller = new AbortController();
  let encodes = 0;
  const encode = async (gain) => {
    if (++encodes === 2) controller.abort();
    return gain;
  };
  await assert.rejects(holdDecodedPeak(encode, async (g) => 2 * g, -1, { blindTrimDb: 2, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(encodes, 2);
  // And the encoder itself, part way through a long sound
  const sr = 44100;
  const long = [0, 1].map(() => Float32Array.from({ length: sr * 60 }, (_, i) => 0.5 * Math.sin(i / 9)));
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 20);
  await assert.rejects(encodeAudio(long, sr, 'mp3', { bitDepth: 16, ceilingDbtp: null, signal: stop.signal }), { name: 'AbortError' });
});

test('the true peak measured in pieces (with breaths) or as a decoder hands pieces over is the true peak', async () => {
  let s = 3;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const chans = [0, 1].map(() => Float32Array.from({ length: 400000 }, (_, i) => 0.7 * Math.sin(i / 3.1) * Math.sin(i / 5000) + 0.1 * rnd()));
  const want = truePeakOf(chans);
  assert.equal(await truePeakInPieces(chans), want);
  const streamed = streamingTruePeak();
  for (let at = 0; at < chans[0].length; at += 4801) for (const [c, ch] of chans.entries()) streamed.push(c, ch.subarray(at, at + 4801));
  assert.equal(streamed.peak(), want);
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
    const [a, b] = await encodeTogether([hot, calm], sr, 'mp3', { decode, onHeld: (h) => (told = h.trimDb) });
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

test('stems encoded together keep adding up: one gain for all, each fetched only when it is encoded (ffmpeg decoding)', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const sr = 48000;
  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'stems-'));
  try {
    const decode = async (bytes, _sr, channels) => {
      fs.writeFileSync(pathMod.join(dir, 'x.mp3'), Buffer.from(bytes));
      const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', pathMod.join(dir, 'x.mp3'), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
      const n = pcm.length / 4 / channels;
      return Array.from({ length: channels }, (_, c) => Float32Array.from({ length: n }, (_, i) => pcm.readFloatLE((i * channels + c) * 4)));
    };
    // A clipped, bright stem at -1 dBTP (it overshoots once encoded), a quiet mono one, a calm stereo one
    let seed = 5;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    const hot = [0, 1].map(() => Float32Array.from({ length: sr * 2 }, (_, i) => Math.max(-1, Math.min(1, 3 * Math.sign(Math.sin((2 * Math.PI * 150 * i) / sr)) * 0.5 + rnd()))));
    limitChannels(hot[0], hot[1], sr, -1);
    const mono = [Float32Array.from({ length: sr * 2 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / sr))];
    const calm = [0, 1].map(() => Float32Array.from({ length: sr * 2 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 220 * i) / sr)));
    let fetched = 0;
    const lazy = (s) => async () => {
      fetched++;
      return s;
    };
    let held = null;
    const files = await encodeTogether([lazy(hot), lazy(mono), lazy(calm)], sr, 'mp3', { decode, onHeld: (h) => (held = h) });
    assert.ok(held.trimDb > 0.05, `turned down ${held.trimDb.toFixed(2)} dB`);
    assert.ok(held.peakDbtp <= -1, `the loudest decoded at ${held.peakDbtp.toFixed(2)} dBTP`);
    assert.ok(fetched >= 6, 'each stem fetched again for every encoding');
    const decoded = await Promise.all(files.map(async (f, i) => decode(await f.arrayBuffer(), sr, [2, 1, 2][i])));
    assert.ok(20 * Math.log10(truePeakOf(decoded[0])) <= -1, 'the hot one under -1 dBTP decoded');
    // The quiet ones turned down by as much (their levels to the hot one kept): the sum still the mix
    for (const [i, src] of [[1, mono], [2, calm]]) {
      const rms = (chs) => Math.sqrt(chs.reduce((a, ch) => a + ch.slice(4800, -4800).reduce((b, v) => b + v * v, 0), 0));
      const moved = 20 * Math.log10(rms(decoded[i]) / rms(src));
      assert.ok(Math.abs(moved + held.trimDb) < 0.1, `stem ${i} moved ${moved.toFixed(2)} dB, the trim ${held.trimDb.toFixed(2)}`);
      assert.equal(decoded[i][0].length, src[0].length);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dense, clipped mixes the first passes left over -1 dBTP decode under it now (ffmpeg decoding)', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const sr = 44100;
  const n = sr * 8;
  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'dense-'));
  try {
    const decode = async (bytes, _sr, channels) => {
      fs.writeFileSync(pathMod.join(dir, 'x.mp3'), Buffer.from(bytes));
      const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', pathMod.join(dir, 'x.mp3'), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
      const m = pcm.length / 4 / channels;
      return Array.from({ length: channels }, (_, c) => Float32Array.from({ length: m }, (_, i) => pcm.readFloatLE((i * channels + c) * 4)));
    };
    // (Two that came out at -0.955 and -0.915 dBTP when the third encoding went unmeasured)
    for (const [seed, drive] of [[3, 6], [14, 1.5]]) {
      let s = seed * 9973;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
      const L = new Float32Array(n);
      const R = new Float32Array(n);
      let b = 0;
      const f1 = 40 + seed * 7;
      const f2 = 100 + seed * 13;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const k = Math.exp(-((t * 2.1) % 1) * 10) * Math.sin(2 * Math.PI * f1 * t);
        b = 0.97 * b + 0.03 * rnd();
        L[i] = drive * (k + 0.4 * Math.sign(Math.sin(2 * Math.PI * f2 * t)) + 1.5 * b + 0.1 * rnd());
        R[i] = drive * (k + 0.4 * Math.sign(Math.sin(2 * Math.PI * f2 * 1.003 * t)) + 1.5 * b + 0.1 * rnd());
        if (seed % 2) {
          L[i] = Math.max(-1, Math.min(1, L[i]));
          R[i] = Math.max(-1, Math.min(1, R[i]));
        } else {
          L[i] = Math.tanh(L[i]);
          R[i] = Math.tanh(R[i]);
        }
      }
      limitChannels(L, R, sr, -1);
      let held = null;
      const mp3 = await encodeAudio([L, R], sr, 'mp3', { bitDepth: 16, decode, onHeld: (h) => (held = h) });
      const peak = 20 * Math.log10(truePeakOf(await decode(await mp3.arrayBuffer(), sr, 2)));
      assert.ok(peak <= -1, `seed ${seed}: decoded at ${peak.toFixed(3)} dBTP`);
      assert.ok(Math.abs(peak - held.peakDbtp) < 1e-6, 'the peak told is the file kept');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
