// Ended handlers on the render's clock (src/audio/endedDue.ts): which sources an export lets go of at a suspend, and in what order, whatever moment the browser reported their ends. Run with `npm test`.
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

const { endedDue } = await import('../src/audio/endedDue.ts');

test('a source told to stop is due once the render reaches its stop, reported or not', () => {
  const waiting = [
    { stopAt: 2.5, ended: false },
    { stopAt: 1.2, ended: true },
    { stopAt: 3.1, ended: true },
    { stopAt: 2.0, ended: false },
  ];
  assert.deepEqual(endedDue(waiting, 1), []);
  // In order of their stop times
  assert.deepEqual(endedDue(waiting, 3), [1, 3, 0]);
  // Exactly at its stop is due
  assert.deepEqual(endedDue(waiting, 2), [1, 3]);
});

test('whether the browser has reported an end yet never changes what a render lets go of', () => {
  const stops = [0.4, 1.7, 1.7, 0.9, 2.2, 3.5];
  for (let mask = 0; mask < 1 << stops.length; mask++) {
    const waiting = stops.map((stopAt, i) => ({ stopAt, ended: !!(mask & (1 << i)) }));
    // Same stop time: in the order they were given a handler
    assert.deepEqual(endedDue(waiting, 2), [0, 3, 1, 2]);
  }
});

test('one never told to stop waits for the report, and everything goes at the end', () => {
  const waiting = [
    { stopAt: null, ended: false },
    { stopAt: 1, ended: false },
    { stopAt: null, ended: true },
  ];
  assert.deepEqual(endedDue(waiting, 2), [1, 2]);
  assert.deepEqual(endedDue(waiting, Infinity), [1, 0, 2]);
});
