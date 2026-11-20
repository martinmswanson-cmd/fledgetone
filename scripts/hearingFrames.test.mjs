// Unit tests for the hearing report's windowed spectra and bands (src/audio/hearing/frames.ts),
// measured on the made test signals of scripts/fixtures/hearingSignals.mjs. Run with `npm test`.
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

const F = await import('../src/audio/hearing/frames.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

test('a full-scale sine sums to half power and peaks at its bin', () => {
  const f = F.framesOf(S.sine(1000, 1, 0), 48000, 4096, 1024);
  const frame = f.power[10];
  near(10 * Math.log10(frame.reduce((a, b) => a + b, 0)), -3.01, 0.1);
  assert.equal(frame.indexOf(Math.max(...frame)), 85);
});
test('bands stop at half the sample rate', () => {
  for (const sr of [22050, 44100, 48000, 96000]) {
    const { edges } = F.bandEdges(6, sr);
    assert.ok(edges.at(-1) <= Math.min(20000, sr / 2) * 1.0001);
    assert.ok(edges[0] >= 19.99);
  }
});
test('band power keeps the total', () => {
  const f = F.framesOf(S.white(1, -12, 1), 48000, 4096, 1024);
  const { edges } = F.bandEdges(6, 48000, 20, 24000);
  const whole = f.power[5].reduce((a, b) => a + b, 0);
  near(10 * Math.log10(F.toBands(f.power[5], 48000, 4096, edges).reduce((a, b) => a + b, 0) / whole), 0, 0.2);
});
test('db never gives NaN or minus infinity', () => { assert.equal(F.db(0), -120); assert.equal(F.db(-1), -120); });
test('mid and side', () => {
  const l = S.sine(440, 0.1, -6);
  assert.equal(F.sideOf([l]), null);
  assert.ok(F.sideOf([l, l]).every((v) => v === 0));
  assert.deepEqual(F.midOf([l, l.map((v) => -v)]).filter((v) => v !== 0).length, 0);
});
test('short and empty signals', () => {
  assert.equal(F.framesOf(new Float32Array(0), 48000, 4096, 1024).power.length, 0);
  assert.equal(F.framesOf(S.sine(1000, 0.01, 0), 48000, 4096, 1024).power.length, 1);
});
