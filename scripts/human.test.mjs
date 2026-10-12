// Unit tests for the Human insert's note drift (src/audio/human.ts). Run with `npm test`.
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

const { hashSeed, noteDrift, detuned, HUMAN_MAX_LATE, HUMAN_MAX_DYNAMICS, HUMAN_MAX_CENTS } = await import('../src/audio/human.ts');

const full = { on: true, timing: 1, dynamics: 1, pitch: 1 };

test('the same note drifts the same way every time', () => {
  const seed = hashSeed('clip1|note7|384');
  assert.deepEqual(noteDrift(seed, full), noteDrift(seed, full));
  assert.equal(hashSeed('a'), hashSeed('a'));
  assert.notEqual(hashSeed('clip1|note7|384'), hashSeed('clip2|note7|384'));
});

test('drift stays in range and varies from note to note', () => {
  const drifts = Array.from({ length: 2000 }, (_, i) => noteDrift(hashSeed(`c|n${i}|${i * 48}`), full));
  for (const d of drifts) {
    assert.ok(d.late >= 0 && d.late <= HUMAN_MAX_LATE + 1e-12);
    assert.ok(d.gain >= 1 - HUMAN_MAX_DYNAMICS - 1e-12 && d.gain <= 1 + HUMAN_MAX_DYNAMICS + 1e-12);
    assert.ok(Math.abs(d.cents) <= HUMAN_MAX_CENTS + 1e-12);
  }
  const lates = new Set(drifts.map((d) => d.late.toFixed(6)));
  assert.ok(lates.size > 500, 'notes should not all land the same');
  const meanCents = drifts.reduce((a, d) => a + d.cents, 0) / drifts.length;
  assert.ok(Math.abs(meanCents) < 0.5, 'pitch drift centres on in tune');
  const meanGain = drifts.reduce((a, d) => a + d.gain, 0) / drifts.length;
  assert.ok(Math.abs(meanGain - 1) < 0.02, 'dynamics centre on the written velocity');
});

test('amounts at zero leave notes as written ', () => {
  const d = noteDrift(hashSeed('x'), { on: true, timing: 0, dynamics: 0, pitch: 0 });
  assert.ok(d.late === 0 && d.gain === 1 && d.cents === 0);
});

test('detuned moves a note by cents as a frequency', () => {
  const freq = (n) => (n === 'A4' ? 440 : NaN);
  assert.equal(detuned('A4', 0, freq), 'A4');
  assert.equal(detuned('A4', 1200, freq), '880.000hz');
  assert.equal(detuned('A4', -10, freq), `${(440 * 2 ** (-10 / 1200)).toFixed(3)}hz`);
  assert.equal(detuned('???', 10, freq), '???');
});
