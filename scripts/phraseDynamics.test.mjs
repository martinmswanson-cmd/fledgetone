// Shape dynamics (src/store/phraseDynamics.ts): a phrase rises to its highest note and eases off at its end, keeping its average loudness.
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

const { shapeDynamics } = await import('../src/store/phraseDynamics.ts');
const line = (names, at = 0) => names.map((note, i) => ({ id: note + i + at, note, startOffset: at + i * 0.125, duration: '8n', velocity: 0.7 }));

test('a phrase swells to its top note and eases off at the end, its average kept', () => {
  const notes = line(['C4', 'D4', 'E4', 'G4', 'C5', 'G4', 'E4', 'D4']);
  const out = shapeDynamics(notes);
  const v = out.map((n) => n.velocity);
  const top = v[4];
  assert.ok(v.every((x) => x <= top + 1e-9), 'the top note is the loudest');
  assert.ok(v[7] < v[6], 'the last note eases off');
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(Math.abs(mean(v) - 0.7) < 0.01, 'the phrase’s average stays');
});

test('a rest starts a new phrase, each shaped on its own', () => {
  const notes = [...line(['C4', 'E4', 'G4', 'E4']), ...line(['A4', 'C5', 'A4', 'F4'], 1)];
  const out = shapeDynamics(notes);
  assert.ok(out[2].velocity > out[0].velocity && out[5].velocity > out[4].velocity);
});
