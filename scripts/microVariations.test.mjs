// Unit tests for micro-variations (src/store/microVariations.ts). Run with `npm test`.
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

const { variationTakes, takeNotes, trimmedLength, DEFAULT_BOUNDS } = await import('../src/store/microVariations.ts');

test('the first take is as written; the others spread within the bounds, all different', () => {
  const takes = variationTakes(8, { pitch: 5, cutoff: 12, release: 20, velocity: 10 }, 42);
  assert.equal(takes.length, 8);
  assert.deepEqual(takes[0], { rate: 1, cutoff: 1, releaseMs: 0, velocity: 1 });
  for (const t of takes) {
    assert.ok(t.rate >= 0.95 - 1e-9 && t.rate <= 1.05 + 1e-9);
    assert.ok(t.cutoff >= 0.88 - 1e-9 && t.cutoff <= 1.12 + 1e-9);
    assert.ok(Math.abs(t.releaseMs) <= 20 + 1e-9);
    assert.ok(t.velocity >= 0.9 - 1e-9 && t.velocity <= 1.1 + 1e-9);
  }
  const rates = takes.slice(1).map((t) => t.rate.toFixed(4));
  assert.equal(new Set(rates).size, 7, 'no two takes at the same pitch');
  const lo = Math.min(...takes.map((t) => t.rate));
  const hi = Math.max(...takes.map((t) => t.rate));
  assert.ok(hi - lo > 0.06, 'the takes use the range');
  assert.deepEqual(variationTakes(8, DEFAULT_BOUNDS, 42), variationTakes(8, DEFAULT_BOUNDS, 42));
});

test('note lengths and velocities follow the take', () => {
  const notes = [{ id: 'a', note: 'D1', startOffset: 0, duration: '8n', velocity: 0.8 }];
  // 120 BPM: an 8th is 96 ticks (0.25 s); +50 ms is +19.2 ticks
  const [n] = takeNotes(notes, { rate: 1, cutoff: 1, releaseMs: 50, velocity: 1.1 }, 120);
  assert.equal(n.duration, '115i');
  assert.ok(Math.abs(n.velocity - 0.88) < 1e-9);
  assert.equal(takeNotes(notes, { rate: 1, cutoff: 1, releaseMs: -10000, velocity: 9 }, 120)[0].duration, '1i');
});

test('silence at the end is trimmed (with a short tail)', () => {
  const ch = new Float32Array(44100);
  ch[1000] = 0.5;
  assert.equal(trimmedLength([ch], 44100), 1000 + 441);
});
