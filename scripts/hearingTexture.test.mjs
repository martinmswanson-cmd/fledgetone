// Unit tests for the hearing report's texture measures (src/audio/hearing/texture.ts), measured on the made
// test signals of scripts/fixtures/hearingSignals.mjs. Run with `npm test`.
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

const { textureOf } = await import('../src/audio/hearing/texture.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

test('flatness: noise high, a sine none', () => {
  const n = textureOf([S.white(4, -12, 1)], 48000).flatness;
  assert.ok(n > 0.45 && n < 0.65); assert.ok(textureOf([S.sine(1000, 4, -6)], 48000).flatness < 0.01);
});
test('roughness follows beating between 20 and 150 Hz', () => {
  const r = (x) => textureOf([x], 48000).roughness;
  assert.ok(r(S.sine(1000, 4, -6)) < 0.05);
  assert.ok(r(S.am(1000, 70, 1, 4, -6)) > 0.4);
  assert.ok(r(S.am(1000, 4, 1, 4, -6)) < 0.1);
  assert.ok(r(S.saw(55, 4, -6)) > r(S.sine(55, 4, -6)) + 0.2);
  assert.ok(r(S.saw(880, 4, -6)) < 0.1);
});
test('percussive share', () => {
  const hits = S.at(4, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((t) => [t, S.burst(0.2, 20, 0, -6, 1)]));
  assert.ok(textureOf([hits], 48000).percussiveShare > 0.8);
  assert.ok(textureOf([S.sine(440, 4, -6)], 48000).percussiveShare < 0.1);
});
test('flat tops', () => {
  const f = textureOf([S.clip(S.sine(200, 2, 0), 0.5)], 48000).flatTops;
  assert.ok(f.share > 0.2); near(f.levelDb, -6.0, 0.1);
  assert.equal(textureOf([S.sine(200, 2, 0)], 48000).flatTops, null);
});
test('silent and empty input give finite numbers', () => {
  for (const x of [new Float32Array(48000), new Float32Array(0)]) {
    const t = textureOf([x], 48000);
    assert.deepEqual(t, { flatness: 0, roughness: 0, percussiveShare: 0, flatTops: null });
  }
});
test('clean sines have no flat tops, at any pitch or rate, or rounded to 16 bits', () => {
  const q = (x) => Float32Array.from(x, (v) => Math.round(v * 32767) / 32767);
  for (const sr of [48000, 44100]) for (const hz of [20, 55, 100, 440, 2000]) for (const peak of [-1, 0]) {
    const x = S.sine(hz, 3, peak, sr);
    assert.equal(textureOf([x], sr).flatTops, null, `${hz} Hz ${peak} dB ${sr}`);
    assert.equal(textureOf([q(x)], sr).flatTops, null, `${hz} Hz ${peak} dB ${sr} 16-bit`);
  }
});
test('clipped low and mid sines are found', () => {
  const a = textureOf([S.clip(S.sine(55, 3, 0), 0.99)], 48000).flatTops;
  assert.ok(a); near(a.levelDb, -0.09, 0.1);
  const b = textureOf([S.clip(S.sine(1000, 3, 0), 0.7)], 48000).flatTops;
  assert.ok(b); near(b.levelDb, -3.1, 0.1); assert.ok(b.share > 0.3);
});
test('a clean saw and pink noise have no flat tops', () => {
  assert.equal(textureOf([S.saw(55, 3, -6)], 48000).flatTops, null);
  assert.equal(textureOf([S.pink(3, -12, 1)], 48000).flatTops, null);
});

// Roughness readings recorded from the first version of roughnessOf (a full-rate inverse transform per
// band and hop, the rectified band, one transform per band per segment), before it was made faster.
// The faster one must read each within 0.02.
const T = 6;
const pair = (a, b) => S.mix(S.sine(a, T, -12), S.sine(b, T, -12));
const hat = (i) => S.band(S.burst(0.06, 12, 0, -14, 100 + i), 5000, 20000);
const bassAndPink = (seconds) => S.mix(S.saw(55, seconds, -6), S.pink(seconds, -20, 1));
/** Each made signal by name, with its sample rate. */
const MADE = {
  'sine 100': () => S.sine(100, T, -6),
  'sine 1000': () => S.sine(1000, T, -6),
  'sine 5000': () => S.sine(5000, T, -6),
  'saw 55': () => S.saw(55, T, -6),
  'saw 110': () => S.saw(110, T, -6),
  'saw 440': () => S.saw(440, T, -6),
  ...Object.fromEntries(
    [5, 20, 40, 70, 100, 150, 300].flatMap((rate) => [1, 0.5].map((depth) => [`am 1000 at ${rate} depth ${depth}`, () => S.am(1000, rate, depth, T, -6)]))
  ),
  'am 250 at 40': () => S.am(250, 40, 1, T, -6),
  'am 250 at 70': () => S.am(250, 70, 1, T, -6),
  'am 4000 at 70': () => S.am(4000, 70, 1, T, -6),
  'sines 1000 + 1040': () => pair(1000, 1040),
  'sines 1000 + 1070': () => pair(1000, 1070),
  'sines 200 + 240': () => pair(200, 240),
  'sines 3000 + 3100': () => pair(3000, 3100),
  'white seed 1': () => S.white(T, -12, 1),
  'white seed 2': () => S.white(T, -12, 2),
  'pink seed 1': () => S.pink(T, -12, 1),
  'pink seed 2': () => S.pink(T, -12, 2),
  'saw 55 clipped at 0.5': () => S.clip(S.saw(55, T, 0), 0.5),
  'square 55': () => S.gain(S.clip(S.saw(55, T, 0), 0.05), 20),
  'wobble bass': () => S.wobble(55, 150, 3000, 2, T, -6),
  'tremolo bass': () => S.tremolo(S.saw(55, T, -6), 4, 0.5),
  'kick and hats': () => S.mix(S.every(2, T, () => S.decay(S.sine(55, 0.6, -6), 150)), S.every(8, T, hat)),
  'saw 55 and pink 6 s': () => bassAndPink(6),
  'saw 55 and pink 25 s': () => bassAndPink(25),
  'saw 55 and pink 0.5 s': () => bassAndPink(0.5),
  'am 1000 at 70, 44100': () => [S.am(1000, 70, 1, T, -6, 44100), 44100],
  'am 1000 at 70, 22050': () => [S.am(1000, 70, 1, T, -6, 22050), 22050],
  'am 1000 at 70, 96000': () => [S.am(1000, 70, 1, T, -6, 96000), 96000],
  'am 7000 at 70, 22050': () => [S.am(7000, 70, 1, T, -6, 22050), 22050],
  'white seed 1, 22050': () => [S.white(T, -12, 1, 22050), 22050],
  'first half silent': () => S.at(T, [[T / 2, S.am(1000, 70, 1, T / 2, -6)]]),
  'am 1000 at 70, 0.05 s': () => S.am(1000, 70, 1, 0.05, -6),
  'am 1000 at 70, 0.01 s': () => S.am(1000, 70, 1, 0.01, -6),
};
const ROUGHNESS_BEFORE = [
  ['sine 100', 0],
  ['sine 1000', 0],
  ['sine 5000', 0],
  ['saw 55', 0.6],
  ['saw 110', 0.21],
  ['saw 440', 0],
  ['am 1000 at 5 depth 1', 0],
  ['am 1000 at 5 depth 0.5', 0],
  ['am 1000 at 20 depth 1', 0.49],
  ['am 1000 at 20 depth 0.5', 0.25],
  ['am 1000 at 40 depth 1', 0.71],
  ['am 1000 at 40 depth 0.5', 0.35],
  ['am 1000 at 70 depth 1', 0.71],
  ['am 1000 at 70 depth 0.5', 0.35],
  ['am 1000 at 100 depth 1', 0.71],
  ['am 1000 at 100 depth 0.5', 0.35],
  ['am 1000 at 150 depth 1', 0.52],
  ['am 1000 at 150 depth 0.5', 0.26],
  ['am 1000 at 300 depth 1', 0],
  ['am 1000 at 300 depth 0.5', 0],
  ['am 250 at 40', 0.71],
  ['am 250 at 70', 0.71],
  ['am 4000 at 70', 0.71],
  ['sines 1000 + 1040', 0.48],
  ['sines 1000 + 1070', 0.48],
  ['sines 200 + 240', 0.49],
  ['sines 3000 + 3100', 0.47],
  ['white seed 1', 0.16],
  ['white seed 2', 0.16],
  ['pink seed 1', 0.29],
  ['pink seed 2', 0.28],
  ['saw 55 clipped at 0.5', 0.54],
  ['square 55', 0.21],
  ['wobble bass', 0.55],
  ['tremolo bass', 0.64],
  ['kick and hats', 1.03],
  ['saw 55 and pink 6 s', 0.47],
  ['saw 55 and pink 25 s', 0.47],
  ['saw 55 and pink 0.5 s', 0.46],
  ['am 1000 at 70, 44100', 0.71],
  ['am 1000 at 70, 22050', 0.71],
  ['am 1000 at 70, 96000', 0.71],
  ['am 7000 at 70, 22050', 0.71],
  ['white seed 1, 22050', 0.16],
  ['first half silent', 1],
  ['am 1000 at 70, 0.05 s', 0.65],
  ['am 1000 at 70, 0.01 s', 0.33],
];
test('roughness holds the readings recorded before it was made faster', () => {
  for (const [name, before] of ROUGHNESS_BEFORE) {
    const made = MADE[name]();
    const [x, sr] = Array.isArray(made) ? made : [made, 48000];
    near(textureOf([x], sr).roughness, before, 0.02 + 1e-9, name);
  }
});
