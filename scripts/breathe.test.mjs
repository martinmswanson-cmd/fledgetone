// Breathing (src/store/breathe.ts): tempo glides easing into each phrase end, a ritardando at the last
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
const { breathe } = await import('../src/store/breathe.ts');
const { barToSeconds, tempoAt } = await import('../src/audio/tempoMap.ts');

const FOUR = { base: { num: 4, den: 4 }, points: [] };
let n = 0;
const id = () => `t${n++}`;

test('each 4-bar phrase eases into its end and picks up on the next downbeat', () => {
  const pts = breathe([], 100, FOUR, { from: 1, to: 9, phrase: 4, amount: 0.1 }, id);
  assert.ok(Array.isArray(pts));
  const map = { bpm: 100, points: pts };
  assert.equal(tempoAt(2, map), 100);
  assert.ok(tempoAt(4.5, map) < 100 && tempoAt(4.5, map) > 90, 'easing in the last bar');
  assert.equal(tempoAt(5, map), 100, 'back on the downbeat');
  // The last phrase slows more, over two bars
  assert.ok(tempoAt(7.5, map) < 100);
  assert.ok(tempoAt(8.9, map) < 85);
  // Longer than steady, but not by much
  const steady = barToSeconds(9, 100);
  assert.ok(barToSeconds(9, map) > steady && barToSeconds(9, map) < steady * 1.1);
});

test('phrases count measures: in 3/4, 4 measures are 3 bars', () => {
  const waltz = { base: { num: 3, den: 4 }, points: [] };
  const pts = breathe([], 120, waltz, { from: 1, to: 7, phrase: 4, amount: 0.1 }, id);
  const map = { bpm: 120, points: pts };
  assert.equal(tempoAt(4, map), 120, 'measure 5 starts at bar 4');
  assert.ok(tempoAt(3.9, map) < 120);
});

test('an existing jump after the range is kept, and a glide inside refuses', () => {
  const jump = [{ id: 'j', bar: 13, bpm: 140, ramp: false }];
  const pts = breathe(jump, { bpm: 100, points: jump }, FOUR, { from: 1, to: 9, phrase: 4, amount: 0.1 }, id);
  assert.ok(pts.some((p) => p.id === 'j'));
  const glide = [{ id: 'g', bar: 5, bpm: 120, ramp: true }];
  assert.equal(typeof breathe(glide, { bpm: 100, points: glide }, FOUR, { from: 1, to: 9, phrase: 4, amount: 0.1 }, id), 'string');
});
