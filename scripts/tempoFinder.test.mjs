// Unit tests for the tempo finder (src/store/tempoFinder.ts). Run with `npm test`.
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

const { findTempos, fitHits, scoreTempo } = await import('../src/store/tempoFinder.ts');

test('finds the tempo that puts every hit on the beat', () => {
  // Hits on beats 3, 9 and 22 at 128 BPM (and a frame of slop on one)
  const beat = 60 / 128;
  const hits = [3 * beat, 9 * beat + 0.01, 22 * beat];
  const [best] = findTempos(hits, { grid: 'beat', min: 90, max: 140, tolerance: 1 / 30, near: 120 });
  assert.equal(best.onGrid, 3);
  assert.ok(Math.abs(best.bpm - 128) < 0.6, `got ${best.bpm}`);
});

test('bar grid: hits land on bar lines', () => {
  const bar = 240 / 100;
  const hits = [bar * 2, bar * 5, bar * 7];
  const [best] = findTempos(hits, { grid: 'bar', min: 80, max: 120, tolerance: 0.01, near: 100 });
  assert.equal(best.onGrid, 3);
  const fit = fitHits(hits, best.bpm, 'bar');
  assert.deepEqual(fit.map((h) => Math.round(h.bar)), [3, 6, 8]);
});

test('suggestions are at least 1 BPM apart and within range', () => {
  const list = findTempos([1.3, 2.9, 4.4, 7.7], { grid: 'beat', min: 70, max: 180, tolerance: 1 / 30, near: 120 });
  assert.equal(list.length, 5);
  for (const s of list) assert.ok(s.bpm >= 70 && s.bpm <= 180);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(Math.abs(list[i].bpm - list[j].bpm) >= 1);
});

test('nothing to fit gives nothing; scoring the current tempo works', () => {
  assert.deepEqual(findTempos([], { grid: 'beat', min: 70, max: 180, tolerance: 0.03, near: 120 }), []);
  const now = scoreTempo([0.5, 1.0, 1.25], 120, 'beat', 0.001);
  assert.equal(now.onGrid, 2);
});
