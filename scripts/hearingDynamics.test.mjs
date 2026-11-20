// Unit tests for the hearing report's dynamics and attack groups (src/audio/hearing/dynamics.ts and
// attack.ts), measured on the made test signals of scripts/fixtures/hearingSignals.mjs. Run with `npm test`.
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

const { dynamicsOf } = await import('../src/audio/hearing/dynamics.ts');
const { attackOf } = await import('../src/audio/hearing/attack.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

test('a stereo sine at -20 dBFS reads -20 LUFS, crest 3 dB, no range', () => {
  const s = S.sine(1000, 20, -20); const d = dynamicsOf([s, s], 48000);
  near(d.lufs, -20.0, 0.1); near(d.crestDb, 3.0, 0.1); assert.ok(d.rangeLu <= 0.2); assert.equal(d.shortTerm.length, 18);
});
test('two levels 10 LU apart give a range of about 10', () => {
  const s = S.at(40, [[0, S.sine(1000, 20, -20)], [20, S.sine(1000, 20, -30)]]);
  near(dynamicsOf([s, s], 48000).rangeLu, 10, 1);
});
test('short audio has no range or short-term maximum', () => {
  const d = dynamicsOf([S.sine(1000, 2, -20)], 48000);
  assert.equal(d.rangeLu, null); assert.equal(d.shortTermMaxLufs, null);
});
test('silent and empty audio give nulls, never NaN', () => {
  for (const c of [[], [new Float32Array(0)], [new Float32Array(48000 * 4)]]) {
    const d = dynamicsOf(c, 48000);
    assert.deepEqual([d.lufs, d.shortTermMaxLufs, d.truePeakDbtp, d.crestDb, d.rangeLu], [null, null, null, null, null]);
    assert.ok(d.shortTerm.every((v) => v === null));
  }
  assert.deepEqual(attackOf([], 48000), { onsetsPerSecond: 0, riseMs: null, single: null });
  assert.deepEqual(attackOf([new Float32Array(48000)], 48000), { onsetsPerSecond: 0, riseMs: null, single: null });
});
test('onsets and sharp attacks', () => {
  const hits = S.at(4, Array.from({ length: 16 }, (_, i) => [i / 4, S.burst(0.2, 50, 0, -6, i)]));
  const a = attackOf([hits], 48000);
  near(a.onsetsPerSecond, 4, 0.5); assert.ok(a.riseMs < 3); assert.equal(a.single, null);
});
test('soft attacks read slow', () => {
  const swells = S.at(4, Array.from({ length: 8 }, (_, i) => [i / 2, S.burst(0.4, 200, 80, -6, i)]));
  const r = attackOf([swells], 48000).riseMs; assert.ok(r > 40 && r < 110);
});
test('a single hit is measured as one', () => {
  const a = attackOf([S.at(1, [[0.1, S.burst(0.6, 50, 0, -6, 1)]])], 48000);
  near(a.single.fall20Ms, 115, 35); assert.ok(a.single.riseMs < 3); assert.ok(a.single.peakDb > -30, 'the loudness is read at the hit, not in the lead-in silence');
});
test('sharp hits on a sustained bed still read sharp', () => {
  const bed = S.sine(220, 4, -20);
  const hits = S.at(4, Array.from({ length: 4 }, (_, i) => [i + 0.2, S.burst(0.2, 50, 0, -8, i)]));
  assert.ok(attackOf([S.mix(bed, hits)], 48000).riseMs < 5);
});
test('soft swells on a sustained bed still read slow', () => {
  const bed = S.sine(220, 4, -20);
  const swells = S.at(4, Array.from({ length: 4 }, (_, i) => [i + 0.2, S.burst(0.4, 200, 80, -8, i)]));
  const r = attackOf([S.mix(bed, swells)], 48000).riseMs; assert.ok(r > 40 && r < 110, `${r}`);
});
test('a steady sine has no rise', () => {
  const a = attackOf([S.sine(220, 4, -20)], 48000);
  assert.equal(a.riseMs, null); assert.equal(a.single, null); assert.ok(Number.isFinite(a.onsetsPerSecond));
});
test('stereo input gives finite attack values', () => {
  const l = S.at(4, Array.from({ length: 8 }, (_, i) => [i / 2, S.burst(0.2, 50, 0, -6, i)]));
  const r = S.at(4, Array.from({ length: 8 }, (_, i) => [i / 2 + 0.25, S.burst(0.2, 50, 0, -6, i + 9)]));
  const a = attackOf([l, r], 48000);
  assert.ok(Number.isFinite(a.onsetsPerSecond) && Number.isFinite(a.riseMs));
});
