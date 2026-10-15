// The instruments' repeatable noise (src/audio/seededNoise.ts): the same buffers and the same starting points for the same track, drum and time, so a song renders the same sample for sample, while each hit still differs from the next. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const { fillWhiteNoise, noiseKey, noiseStart, seededRandom, toneNoiseChannel, trackSeed } = await import('../src/audio/seededNoise.ts');

test('the noise buffers are the same every time, and white noise of the right level', () => {
  const a = new Float32Array(44100);
  const b = new Float32Array(44100);
  fillWhiteNoise(a, 7, 0.5);
  fillWhiteNoise(b, 7, 0.5);
  assert.deepEqual(a, b);
  const other = new Float32Array(44100);
  fillWhiteNoise(other, 8, 0.5);
  assert.notDeepEqual(a, other);
  const mean = a.reduce((s, x) => s + x, 0) / a.length;
  const rms = Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
  assert.ok(Math.abs(mean) < 0.01, `mean ${mean}`);
  // Uniform in [-0.5, 0.5]: RMS 0.5 / sqrt(3)
  assert.ok(Math.abs(rms - 0.5 / Math.sqrt(3)) < 0.005, `rms ${rms}`);
  assert.ok(a.every((x) => Math.abs(x) <= 0.5));
  for (const colour of ['white', 'pink', 'brown']) assert.deepEqual(toneNoiseChannel(colour, 4096, 3), toneNoiseChannel(colour, 4096, 3));
});

test('a burst starts at the same point for the same key and time, and elsewhere for another', () => {
  const key = noiseKey(trackSeed('track-1'), 'snare');
  assert.equal(noiseStart(key, 1.25), noiseStart(key, 1.25));
  // Float noise in the time doesn't move it
  assert.equal(noiseStart(key, 0.1 + 0.2), noiseStart(key, 0.3));
  // Every hit differs from the next, the snare from the hat, one track from another
  const starts = new Set(Array.from({ length: 200 }, (_, i) => noiseStart(key, i * 0.125)));
  assert.equal(starts.size, 200);
  assert.notEqual(noiseStart(noiseKey(trackSeed('track-1'), 'hat'), 1.25), noiseStart(key, 1.25));
  assert.notEqual(noiseStart(noiseKey(trackSeed('track-2'), 'snare'), 1.25), noiseStart(key, 1.25));
  // Spread over the whole buffer
  const all = [...starts];
  assert.ok(all.every((s) => s >= 0 && s < 1));
  assert.ok(Math.min(...all) < 0.05 && Math.max(...all) > 0.95);
});

test('the generator repeats from its seed', () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});
