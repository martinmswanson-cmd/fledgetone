// Swells (src/store/swell.ts): the mod wheel drawn over phrases of notes
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
const { phrases, swellLane } = await import('../src/store/swell.ts');
const { exprValueAt } = await import('../src/store/expression.ts');

const n = (startOffset, duration) => ({ startOffset, duration });

test('touching and overlapping notes make one phrase; a rest starts another', () => {
  assert.deepEqual(phrases([n(0, '4n'), n(0.25, '2n'), n(0.8, '4n'), n(2, '1n')]), [[0, 1.05], [2, 3]]);
});

test('a swell grows into the middle and fades; crescendo and diminuendo go one way', () => {
  const lane = swellLane(undefined, [n(0, '1m')], 'swell');
  assert.ok(exprValueAt(lane, 0) < 0.5 && exprValueAt(lane, 0.55) > 0.9 && exprValueAt(lane, 1) < 0.5);
  const up = swellLane(undefined, [n(0, '1m')], 'crescendo');
  assert.ok(exprValueAt(up, 0) < exprValueAt(up, 0.5) && exprValueAt(up, 0.5) < exprValueAt(up, 1));
  const down = swellLane(undefined, [n(0, '1m')], 'diminuendo');
  assert.ok(exprValueAt(down, 0) > exprValueAt(down, 0.5) && exprValueAt(down, 0.5) > exprValueAt(down, 1));
});

test('the wheel outside the phrases is kept; inside, replaced; points stay in order', () => {
  const before = [{ at: 0, value: 0.8 }, { at: 1.5, value: 0.2 }, { at: 3.5, value: 0.6 }];
  const lane = swellLane(before, [n(1, '1m')], 'crescendo');
  assert.ok(lane.some((p) => p.at === 0 && p.value === 0.8));
  assert.ok(lane.some((p) => p.at === 3.5));
  assert.ok(!lane.some((p) => p.at === 1.5 && p.value === 0.2));
  assert.ok(lane.every((p, i) => i === 0 || p.at >= lane[i - 1].at));
});
