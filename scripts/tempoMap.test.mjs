// Unit tests for the tempo map and meter map (src/audio/tempoMap.ts). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const tm = await import('../src/audio/tempoMap.ts');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const map = (bpm, points) => ({ bpm, points: points.map((p, i) => ({ id: `t${i}`, ramp: false, ...p })) });

test('a plain number is a steady tempo, as before', () => {
  near(tm.barToSeconds(5, 120), 8);
  near(tm.secondsToBar(8, 120), 5);
  near(tm.tempoAt(9, 120), 120);
  assert.equal(tm.isSteady(120), true);
});

test('a jump: each stretch plays at its own tempo', () => {
  const m = map(120, [{ bar: 5, bpm: 60 }]);
  near(tm.barToSeconds(5, m), 8); // 4 bars at 120
  near(tm.barToSeconds(6, m), 12); // then a bar at 60 is 4 s
  near(tm.secondsToBar(12, m), 6);
  near(tm.secondsToBar(4, m), 3);
  near(tm.tempoAt(4.99, m), 120);
  near(tm.tempoAt(5, m), 60);
  assert.equal(tm.isSteady(m), false);
});

test('a glide changes linearly in time, and positions and seconds agree both ways', () => {
  const m = map(100, [{ bar: 3, bpm: 140, ramp: true }]);
  // 8 beats gliding 100 -> 140 take 120*8/240 = 4 s
  near(tm.barToSeconds(3, m), 4);
  near(tm.tempoAt(1, m), 100);
  near(tm.tempoAt(3, m), 140);
  // Half way in time the tempo is half way
  const half = tm.secondsToBar(2, m);
  near(tm.tempoAt(half, m), 120, 1e-6);
  for (const bar of [1, 1.3, 2, 2.71, 3, 4.5, 10]) near(tm.secondsToBar(tm.barToSeconds(bar, m), m), bar, 1e-9);
  // After the glide it holds at 140
  near(tm.barToSeconds(4, m) - tm.barToSeconds(3, m), 240 / 140);
  const from = tm.tempoFrom(2, m);
  near(from.glide.to, 140);
  near(from.glide.seconds, tm.barToSeconds(3, m) - tm.barToSeconds(2, m));
  assert.equal(tm.tempoFrom(3.5, m).glide, null);
});

test('a glide down, then a jump', () => {
  const m = map(160, [{ bar: 2, bpm: 80, ramp: true }, { bar: 4, bpm: 120 }]);
  near(tm.barToSeconds(2, m), (120 * 4) / 240);
  near(tm.barToSeconds(4, m), 2 + 8 * (60 / 80));
  near(tm.tempoAt(4, m), 120);
  for (const s of [0.3, 1.7, 2.2, 5, 9]) near(tm.barToSeconds(tm.secondsToBar(s, m), m), s, 1e-9);
});

test('points are read in order, and only after bar 1', () => {
  const m = map(120, [{ bar: 9, bpm: 90 }, { bar: 5, bpm: 60 }, { bar: 1, bpm: 200 }]);
  near(tm.tempoAt(1, m), 120);
  near(tm.tempoAt(6, m), 60);
  near(tm.tempoAt(10, m), 90);
  assert.deepEqual(tm.tempoChangeBars(m), [5, 9]);
});

test('inserting and removing time moves the points after', () => {
  const pts = [{ bar: 3 }, { bar: 6 }, { bar: 9 }];
  assert.deepEqual(tm.shiftTempoPoints(pts, 4, 2).map((p) => p.bar), [3, 8, 11]);
  assert.deepEqual(tm.shiftTempoPoints(pts, 4, -3).map((p) => p.bar), [3, 6]);
});

test('meters: measures follow the time signature without moving positions', () => {
  const m = { base: { num: 4, den: 4 }, points: [{ id: 'm', bar: 3, num: 3, den: 4 }, { id: 'n', bar: 4.5, num: 6, den: 8 }] };
  // Bars 1, 2 in 4/4; then 3/4 measures of 0.75 from bar 3: 3, 3.75, then 6/8 from 4.5
  assert.deepEqual(tm.measuresBetween(1, 6, m).map((x) => [x.bar, x.measure, `${x.meter.num}/${x.meter.den}`]), [
    [1, 1, '4/4'],
    [2, 2, '4/4'],
    [3, 3, '3/4'],
    [3.75, 4, '3/4'],
    [4.5, 5, '6/8'],
    [5.25, 6, '6/8'],
  ]);
  near(tm.measureStart(5, m), 4.5);
  assert.deepEqual(tm.toMeasureBeat(3.75 + 0.5, m), { measure: 4, beat: 3, hundredths: 0 });
  assert.deepEqual(tm.toMeasureBeat(4.5 + 3 / 8, m), { measure: 5, beat: 4, hundredths: 0 });
  near(tm.fromMeasureBeat(5, 4, 0, m), 4.5 + 3 / 8);
  assert.equal(tm.fromMeasureBeat(4, 4, 0, m), null); // 3/4 has no beat 4
  // A change put off a measure line lands on the nearest one
  const off = { base: { num: 3, den: 4 }, points: [{ id: 'x', bar: 2.6, num: 4, den: 4 }] };
  near(tm.measuresBetween(1, 4, off).find((x) => x.meter.num === 4).bar, 1 + 0.75 * 2);
  near(tm.nearestMeasureStart(1.8, off), 1.75);
});

test('plain 4/4 counts as it always did', () => {
  const plain = { base: tm.FOUR_FOUR, points: [] };
  assert.deepEqual(tm.toMeasureBeat(17.5 + 0.0725, plain), { measure: 17, beat: 3, hundredths: 29 });
  assert.equal(tm.isPlainMeter(plain), true);
  assert.equal(tm.beatsBetween(2, 3, plain).length, 4);
});

test('meter text', () => {
  assert.deepEqual(tm.parseMeter('7/8'), { num: 7, den: 8 });
  assert.equal(tm.parseMeter('5/3'), null);
  assert.equal(tm.formatMeter({ num: 12, den: 8 }), '12/8');
});

test('steadyBetween: true while one tempo holds, false across a jump or inside a glide', () => {
  assert.equal(tm.steadyBetween(1, 50, 120), true);
  assert.equal(tm.steadyBetween(1, 50, { bpm: 120, points: [] }), true);
  const map = { bpm: 120, points: [{ id: 'a', bar: 5, bpm: 90, ramp: false }, { id: 'b', bar: 9, bpm: 140, ramp: true }] };
  assert.equal(tm.steadyBetween(1, 5, map), true);
  assert.equal(tm.steadyBetween(2, 6, map), false);
  assert.equal(tm.steadyBetween(5, 9, map), false);
  assert.equal(tm.steadyBetween(9, 40, map), true);
});
