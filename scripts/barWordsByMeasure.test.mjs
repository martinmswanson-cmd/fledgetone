// Unit tests for bar numbers in words by measure (formatBarPosition, formatBarRange, barSpan in
// src/store/timelineTypes.ts): in a song not in 4/4 they're named as the ruler numbers them. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
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
const t = await import('../src/store/timelineTypes.ts');
const { bounceName } = await import('../src/store/bounceToPad.ts');
const { resampleName } = await import('../src/store/resample.ts');

const plain = { base: { num: 4, den: 4 }, points: [] };
const waltz = { base: { num: 3, den: 4 }, points: [] };
const sixEight = { base: { num: 6, den: 8 }, points: [] };
// 4/4 for two measures, then 3/4 from bar 3
const mixed = { base: { num: 4, den: 4 }, points: [{ id: 'm1', bar: 3, num: 3, den: 4 }] };

test('4/4 (or no meter) reads exactly as before', () => {
  for (const meter of [undefined, null, plain]) {
    assert.equal(t.formatBarRange(1, 17, meter), 'bars 1–16');
    assert.equal(t.formatBarRange(3, 4, meter), 'bar 3');
    assert.equal(t.formatBarRange(1, 4.5, meter), 'bars 1–4.5');
    assert.equal(t.formatBarRange(2.5, 3, meter), 'bars 2.5–3');
    assert.equal(t.formatBarPosition(4.5, meter), '4.5');
    assert.equal(t.formatBarPosition(9, meter), '9');
    assert.equal(t.barSpan(2.5, 4, meter), 1.5);
    assert.equal(t.formatBarSpan(1, 7, meter), '6 bars');
    assert.equal(t.formatBarSpan(3, 4, meter), '1 bar');
    assert.equal(t.formatBarSpan(2.5, 4, meter), '1.5 bars');
  }
  assert.equal(bounceName(5, 9, undefined, undefined, plain), 'Bars 5–8');
  assert.equal(resampleName({ kind: 'range', from: 1, to: 5 }, [], new Map(), plain), 'Mix bars 1–4 (resampled)');
});

test('3/4: a loop over measures 3–4 of an 8-measure song reads as the ruler numbers it', () => {
  // A measure is 0.75 of a 4/4 bar: measure 3 starts at 2.5, measure 5 at 4, the 8 measures end at 7
  assert.equal(t.formatBarRange(2.5, 4, waltz), 'bars 3–4');
  assert.equal(t.formatBarRange(1, 2.5, waltz), 'bars 1–2');
  assert.equal(t.formatBarRange(2.5, 3.25, waltz), 'bar 3');
  assert.equal(t.formatBarSpan(2.5, 4, waltz), '2 bars');
  assert.equal(t.formatBarSpan(1, 7, waltz), '8 bars');
  assert.equal(t.formatBarSpan(2.5, 3.25, waltz), '1 bar');
});

test('3/4: positions inside a measure read as measure.beat, as on the ruler', () => {
  assert.equal(t.formatBarPosition(2.5, waltz), '3');
  assert.equal(t.formatBarPosition(2.75, waltz), '3.2');
  assert.equal(t.formatBarPosition(2.875, waltz), '3.2.50');
  // A stretch with an edge inside a measure is named by its edges
  assert.equal(t.formatBarRange(2.75, 4, waltz), 'bars 3.2–5');
  assert.equal(t.formatBarRange(1, 3, waltz), 'bars 1–3.3');
  // Part of a measure counts for the part it covers
  assert.equal(t.formatBarSpan(2.75, 4, waltz), '1.667 bars');
});

test('6/8 counts its beats in eighths', () => {
  assert.equal(t.formatBarRange(1, 2.5, sixEight), 'bars 1–2');
  assert.equal(t.formatBarPosition(1.125, sixEight), '1.2');
  assert.equal(t.formatBarPosition(1.375, sixEight), '1.4');
});

test('a change of time signature: measures numbered across it', () => {
  assert.equal(t.formatBarRange(1, 3.75, mixed), 'bars 1–3');
  assert.equal(t.formatBarRange(3, 4.5, mixed), 'bars 3–4');
  assert.equal(t.formatBarPosition(3.75, mixed), '4');
  assert.equal(t.formatBarSpan(1, 4.5, mixed), '4 bars');
  assert.equal(t.formatBarSpan(2, 3.75, mixed), '2 bars');
});

test('bounce and resample names number bars by measure, not in 4/4', () => {
  assert.equal(bounceName(2.5, 4, undefined, undefined, waltz), 'Bars 3–4');
  assert.equal(bounceName(2.5, 3.25, undefined, 'Keys', waltz), 'Keys bar 3');
  assert.equal(resampleName({ kind: 'range', from: 2.5, to: 4, trackIds: ['t1'] }, [], new Map([['t1', 'Keys']]), waltz), 'Keys bars 3–4 (resampled)');
});
