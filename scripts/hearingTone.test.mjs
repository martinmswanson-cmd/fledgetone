// Unit tests for the hearing report's tone measures (src/audio/hearing/tone.ts), measured on the made
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

const { toneOf } = await import('../src/audio/hearing/tone.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

test('a sine: centre and roll-off sit on it', () => {
  const t = toneOf([S.sine(1000, 2, -6)], 48000);
  near(t.centreHz, 1000, 20); assert.ok(Math.abs(Math.log2(t.rolloffHz / 1000)) < 1 / 6);
});
test('white noise rises 3 dB an octave, pink is level', () => {
  near(toneOf([S.white(8, -12, 1)], 48000).tiltDbPerOctave, 3.0, 0.3);
  near(toneOf([S.pink(8, -12, 1)], 48000).tiltDbPerOctave, 0, 0.3);
  near(toneOf([S.white(8, -12, 1)], 48000).centreHz, 10010, 500);
});
test('a narrow peak in noise is found; noise alone has none', () => {
  const t = toneOf([S.mix(S.pink(8, -12, 1), S.sine(3000, 8, -21))], 48000);
  assert.ok(Math.abs(Math.log2(t.peaks[0].hz / 3000)) < 1 / 24); assert.ok(t.peaks[0].overDb >= 6);
  assert.deepEqual(toneOf([S.pink(8, -12, 1)], 48000).peaks, []);
});
test('sub against bass', () => {
  assert.ok(toneOf([S.mix(S.sine(40, 2, -6), S.sine(120, 2, -26))], 48000).subVsBassDb > 15);
  assert.ok(toneOf([S.mix(S.sine(40, 2, -26), S.sine(120, 2, -6))], 48000).subVsBassDb < -15);
});
test('right at every sample rate, and nothing above half of it (Review Focus 4)', () => {
  for (const sr of [22050, 44100, 96000]) {
    const t = toneOf([S.sine(1000, 2, -6, sr)], sr);
    near(t.centreHz, 1000, 20);
    assert.ok(t.spectrum.freqs.every((f) => f <= sr / 2));
    assert.ok([...t.spectrum.mid, ...t.spectrum.side].every(Number.isFinite));
  }
});
