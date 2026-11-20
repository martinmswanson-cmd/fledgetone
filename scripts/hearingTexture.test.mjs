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
