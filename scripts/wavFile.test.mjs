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

const { encodeChannels, ditherSeedOf } = await import('../src/audio/wavFile.ts');

/** The 16-bit samples of a mono file, minus what an undithered file would hold: the dither alone. */
async function ditherOf(signal, seed) {
  const bytes = new DataView(await encodeChannels([signal], 48000, 16, [], undefined, seed).arrayBuffer());
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = bytes.getInt16(44 + 2 * i, true) - signal[i] * 0x7fff;
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
