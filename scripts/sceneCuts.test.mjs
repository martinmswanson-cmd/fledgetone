// Unit tests for scene-cut detection (src/store/sceneCuts.ts). Run with `npm test`.
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

const { frameDifference, pickCuts } = await import('../src/store/sceneCuts.ts');

const frame = (fill) => {
  const f = new Uint8ClampedArray(16 * 9 * 4);
  for (let i = 0; i < 16 * 9; i++) { const [r, g, b] = fill(i); f.set([r, g, b, 255], i * 4); }
  return f;
};

test('frame differences: same is 0, a different scene is large, a small shift is small', () => {
  const a = frame((i) => [i % 200, 50, 90]);
  const b = frame((i) => [(i + 1) % 200, 50, 90]);
  const c = frame(() => [10, 220, 30]);
  assert.equal(frameDifference(a, a), 0);
  assert.ok(frameDifference(a, b) < 0.1);
  assert.ok(frameDifference(a, c) > 0.5);
});

test('cuts stand out from the steps around them, once each', () => {
  const times = Array.from({ length: 41 }, (_, i) => i * 0.125);
  const diffs = Array.from({ length: 40 }, (_, i) => 0.03 + (i % 3) * 0.01);
  diffs[10] = 0.6; // a cut
  diffs[25] = 0.5;
  diffs[26] = 0.45; // the same cut seen across two steps
  diffs[33] = 0.2; // a change below the threshold
  assert.deepEqual(pickCuts(diffs, times), [10, 25]);
});

test('fast action (big differences everywhere) is not a run of cuts', () => {
  const times = Array.from({ length: 21 }, (_, i) => i * 0.125);
  const diffs = Array.from({ length: 20 }, (_, i) => 0.3 + (i % 2) * 0.05);
  diffs[12] = 0.95;
  assert.deepEqual(pickCuts(diffs, times), [12]);
});
