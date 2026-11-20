// Unit tests for the hearing report's movement group (src/audio/hearing/movement.ts): how a sound
// changes over its length and which bands wobble at a steady rate, measured on made signals.
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

const { movementOf, noteOf } = await import('../src/audio/hearing/movement.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

test('a gated bass: its rate, depth and note value', () => {
  const m = movementOf([S.gate(S.saw(110, 8, -6), 4, -12)], 48000, 120);
  const low = m.modulations.find((x) => x.band === 'low');
  near(low.hz, 4.0, 0.1); near(low.depthDb, 12, 1.5); assert.equal(low.note, '1/8');
});
test('a steady tone does not move', () => {
  const m = movementOf([S.sine(440, 8, -6)], 48000);
  assert.deepEqual(m.modulations, []); assert.ok(m.changeDb < 0.2);
});
test('a pad ducked on the beat shows in the mid band', () => {
  const pad = S.gate(S.mix(S.saw(440, 8, -12), S.saw(554, 8, -12)), 2, -6);
  const mid = movementOf([pad], 48000, 120).modulations.find((x) => x.band === 'mid');
  near(mid.hz, 2.0, 0.1); near(mid.depthDb, 6, 1.5); assert.equal(mid.note, '1/4');
});
test('note values', () => {
  assert.equal(noteOf(3.0, 120), '1/4T'); assert.equal(noteOf(16, 120), '1/32'); assert.equal(noteOf(2.5, 120), undefined);
});
test('short audio has no modulations', () => assert.deepEqual(movementOf([S.sine(440, 1, -6)], 48000).modulations, []));
test('silent and empty input give finite numbers and no modulations', () => {
  for (const ch of [[new Float32Array(48000 * 4)], [new Float32Array(0)], []]) {
    const m = movementOf(ch, 48000, 120);
    assert.deepEqual(m.modulations, []); assert.equal(m.changeDb, 0);
  }
});
