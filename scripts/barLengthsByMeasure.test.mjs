// Unit tests for lengths and typed bars by measure: the loop's Length (formatBarsBeatsLength,
// parseBarsBeatsLength in src/audio/transport.ts), the measure lengths under them
// (src/audio/tempoMap.ts) and the bar fields of the arrange dialogs (barNumberNear, barNumberStart,
// rulerBarsLength in src/store/timelineTypes.ts). In a song not in 4/4 they count measures as the
// ruler does; in 4/4 they read exactly as before. Run with `npm test`.
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
const tr = await import('../src/audio/transport.ts');
const tm = await import('../src/audio/tempoMap.ts');
const t = await import('../src/store/timelineTypes.ts');

const plain = { base: { num: 4, den: 4 }, points: [] };
const waltz = { base: { num: 3, den: 4 }, points: [] };
const sixEight = { base: { num: 6, den: 8 }, points: [] };
// 4/4 for two measures, then 3/4 from bar 3
const mixed = { base: { num: 4, den: 4 }, points: [{ id: 'm1', bar: 3, num: 3, den: 4 }] };

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('in 4/4 a length reads and parses as before', () => {
  tr.setSongMeter(plain);
  assert.equal(tr.formatBarsBeatsLength(4), '4.0.00');
  assert.equal(tr.formatBarsBeatsLength(2.5, 3.25), '2.2.00');
  assert.equal(tr.formatBarsBeatsLength(0.125), '0.0.50');
  assert.equal(tr.parseBarsBeatsLength('8'), 8);
  assert.equal(tr.parseBarsBeatsLength('2.2', 5.5), 2.5);
  assert.equal(tr.parseBarsBeatsLength('0.1.50'), 0.375);
  assert.equal(tr.parseBarsBeatsLength('1.4'), null);
  assert.equal(tr.parseBarsBeatsLength('x'), null);
});

test('in 3/4 a length is counted in measures from where it starts', () => {
  tr.setSongMeter(waltz);
  // The loop over measures 1-4: 3 bars
  assert.equal(tr.formatBarsBeatsLength(3, 1), '4.0.00');
  // Typing 4 makes four measures, not 5.333
  assert.equal(tr.parseBarsBeatsLength('4', 1), 3);
  close(tr.parseBarsBeatsLength('2.2', 1), 2 * 0.75 + 0.5);
  assert.equal(tr.formatBarsBeatsLength(2, 1), '2.2.00');
  // Beats past the measure's are too many (2 more beats at most in 3/4, as 3 in 4/4)
  assert.equal(tr.parseBarsBeatsLength('1.2', 1), 1.25);
  assert.equal(tr.parseBarsBeatsLength('1.3', 1), null);
  // From part-way through a measure (measure 2, beat 2): two measures on, at beat 2 again
  const from = 1.75 + 0.25;
  assert.equal(tr.formatBarsBeatsLength(1.5, from), '2.0.00');
  close(tr.parseBarsBeatsLength('2', from), 1.5);
  // Round trip
  for (const len of [0.25, 0.75, 1, 2.5, 7.75, 12]) close(tr.parseBarsBeatsLength(tr.formatBarsBeatsLength(len, 1), 1), len);
  tr.setSongMeter(plain);
});

test('in 6/8 the beats are eighths', () => {
  tr.setSongMeter(sixEight);
  assert.equal(tr.formatBarsBeatsLength(0.75 * 2 + 0.25, 1), '2.2.00');
  close(tr.parseBarsBeatsLength('2.5', 1), 1.5 + 5 / 8);
  assert.equal(tr.parseBarsBeatsLength('0.6', 1), null);
  tr.setSongMeter(plain);
});

test('across a time signature change, measures are the ones there', () => {
  // Measures 1-2 are 4/4 (bars 1-3), then 3/4
  assert.deepEqual(tm.toMeasureBeatLength(1, 2 + 0.75 * 2, mixed), { measures: 4, beats: 0, hundredths: 0 });
  close(tm.fromMeasureBeatLength(1, 4, 0, 0, mixed), 3.5);
  close(tm.fromMeasureBeatLength(2, 2, 1, 0, mixed), 1 + 0.75 + 0.25);
  close(tm.measuresAfter(3.75, -2, mixed), 2);
  // Beat 4 of a 4/4 measure, a measure on: the 3/4 measure there has no beat 4, so its end
  close(tm.measuresAfter(2.75, 1, mixed), 3.75);
});

test('bar fields: the ruler number near a position, where a number starts, a length of bars', () => {
  // 4/4 and no meter: as before
  for (const m of [undefined, null, plain]) {
    assert.equal(t.barNumberNear(7.6, m), 8);
    assert.equal(t.barNumberAt(7.6, m), 7);
    assert.equal(t.barNumberStart(9, m), 9);
    assert.equal(t.rulerBarsLength(3, 2, m), 2);
    assert.equal(t.rulerBarsLength(3, 0.5, m), 0.5);
  }
  // 3/4: bar 7 is where measure 9 starts
  assert.equal(t.barNumberNear(7, waltz), 9);
  assert.equal(t.barNumberNear(7.3, waltz), 9);
  assert.equal(t.barNumberNear(7.5, waltz), 10);
  assert.equal(t.barNumberAt(7.7, waltz), 9);
  assert.equal(t.barNumberStart(9, waltz), 7);
  assert.equal(t.barNumberAt(400, waltz), 533);
  assert.equal(t.rulerBarsLength(7, 4, waltz), 3);
  assert.equal(t.rulerBarsLength(7, 0.5, waltz), 0.375);
  // A typed measure lands on the ruler's measure
  assert.equal(t.formatBarPosition(t.barNumberStart(9, waltz), waltz), '9');
  assert.equal(t.formatBarSpan(7, 7 + t.rulerBarsLength(7, 4, waltz), waltz), '4 bars');
  // Mixed: measure 4 starts at bar 3.75
  assert.equal(t.barNumberStart(4, mixed), 3.75);
  assert.equal(t.rulerBarsLength(2, 2, mixed), 1.75);
});
