// WAV files (src/audio/wavFile.ts): a 16-bit file's dither is repeatable, and stems get different dither sequences, so it doesn't add up in step when they're mixed.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
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

const { encodeChannels, ditherSeedOf, KEPT_RENDER_BITS } = await import('../src/audio/wavFile.ts');

/** The 16-bit samples of a mono file, minus what an undithered file would hold: the dither alone. */
async function ditherOf(signal, seed) {
  const bytes = new DataView(await encodeChannels([signal], 48000, 16, [], undefined, seed).arrayBuffer());
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = bytes.getInt16(44 + 2 * i, true) - signal[i] * 0x8000;
  return out;
}

const corr = (a, b) => {
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb);
};

test('each stem gets its own dither, the same every time', async () => {
  // A quiet tail: under a step of 16 bits, where the dither is most of what's there
  const signal = new Float32Array(48000).map((_, i) => 0.00002 * Math.sin(i / 7));
  const a = await ditherOf(signal, ditherSeedOf('track-a'));
  const b = await ditherOf(signal, ditherSeedOf('track-b'));
  const again = await ditherOf(signal, ditherSeedOf('track-a'));
  assert.deepEqual(a, again);
  assert.ok(Math.abs(corr(a, b)) < 0.05, `stems' dither correlates ${corr(a, b).toFixed(3)}`);
  // Summed, eight stems' dither adds as noise does (about 9 dB more), not in step (18 dB more)
  const seeds = Array.from({ length: 8 }, (_, i) => ditherSeedOf(`stem ${i}`));
  const sum = new Float64Array(signal.length);
  for (const s of seeds) (await ditherOf(signal, s)).forEach((v, i) => (sum[i] += v));
  const power = (x) => x.reduce((p, v) => p + v * v, 0) / x.length;
  const rise = 10 * Math.log10(power(sum) / power(a));
  assert.ok(rise > 7 && rise < 11, `eight stems' dither ${rise.toFixed(1)} dB over one`);
});

test('a file without a seed keeps the dither it always had', async () => {
  const signal = new Float32Array(4096).map((_, i) => 0.3 * Math.sin(i / 5));
  const plain = new Uint8Array(await encodeChannels([signal], 44100, 16).arrayBuffer());
  const zero = new Uint8Array(await encodeChannels([signal], 44100, 16, [], undefined, 0).arrayBuffer());
  assert.deepEqual(plain, zero);
  assert.notEqual(ditherSeedOf('a'), ditherSeedOf('b'));
});

test('both halves of the wave are scaled alike, so a reader gets the level back exactly', async () => {
  // A sine at -1 dBFS: no second harmonic from scaling the positive half differently
  const n = 1 << 14;
  const signal = new Float32Array(n).map((_, i) => 0.891 * Math.sin((2 * Math.PI * 64 * i) / n));
  for (const depth of [16, 24]) {
    const bytes = new DataView(await encodeChannels([signal], 48000, depth).arrayBuffer());
    const read = (i) => (depth === 16 ? bytes.getInt16(44 + 2 * i, true) / 0x8000 : ((bytes.getInt32(44 + 3 * i - 1, true) >> 8) / 0x800000));
    let re = 0, im = 0, re1 = 0, im1 = 0;
    for (let i = 1; i < n; i++) {
      const x = read(i);
      re += x * Math.cos((2 * Math.PI * 128 * i) / n);
      im += x * Math.sin((2 * Math.PI * 128 * i) / n);
      re1 += x * Math.cos((2 * Math.PI * 64 * i) / n);
      im1 += x * Math.sin((2 * Math.PI * 64 * i) / n);
    }
    const h2 = 20 * Math.log10(Math.hypot(re, im) / Math.hypot(re1, im1));
    assert.ok(h2 < -115, `${depth}-bit: second harmonic ${h2.toFixed(1)} dB`);
  }
  // Full scale: the most each format holds, both ways
  const full = new DataView(await encodeChannels([Float32Array.of(1, -1, 1.5, -1.5)], 48000, 24).arrayBuffer());
  assert.deepEqual([0, 1, 2, 3].map((i) => full.getInt32(44 + 3 * i - 1, true) >> 8), [0x7fffff, -0x800000, 0x7fffff, -0x800000]);
});

test('the sounds the app renders and keeps (freezes, bounces, resamples) are 24-bit: a quiet reverb tail keeps its shape, with no dither under it', async () => {
  assert.equal(KEPT_RENDER_BITS, 24);
  // A tail at -110 dBFS: under a 16-bit step (about -96 dBFS) it's only dither there
  const tail = new Float32Array(48000).map((_, i) => 0.000003 * Math.sin(i / 9));
  const bytes = new DataView(await encodeChannels([tail], 48000, KEPT_RENDER_BITS).arrayBuffer());
  assert.equal(bytes.getUint16(34, true), 24);
  const got = new Float64Array(tail.length);
  for (let i = 0; i < tail.length; i++) {
    const at = 44 + 3 * i;
    const v = bytes.getUint8(at) | (bytes.getUint8(at + 1) << 8) | (bytes.getInt8(at + 2) << 16);
    got[i] = v / 0x800000;
  }
  assert.ok(corr(got, tail) > 0.99, 'the tail is still there');
  let worst = 0;
  for (let i = 0; i < tail.length; i++) worst = Math.max(worst, Math.abs(got[i] - tail[i]));
  assert.ok(worst <= 1 / 0x800000, 'within a 24-bit step');
});
