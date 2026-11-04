// Unit tests for the measure and beat lines inside a clip (spanMeterLines in src/audio/tempoMap.ts). Run with `npm test`.
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

const { spanMeterLines, FOUR_FOUR } = await import('../src/audio/tempoMap.ts');

const close = (a, b) => Math.abs(a - b) < 1e-9;
const round = (lines) => lines.map((l) => ({ ...l, at: Math.round(l.at * 1e6) / 1e6 }));

test('3/4: three quarter beats a measure, measures 0.75 bars apart', () => {
  const map = { base: { num: 3, den: 4 }, points: [] };
  const lines = round(spanMeterLines(1, 1.5, map));
  assert.deepEqual(lines, [
    { at: 0, measure: 1, beat: 1 },
    { at: 0.25, measure: 1, beat: 2 },
    { at: 0.5, measure: 1, beat: 3 },
    { at: 0.75, measure: 2, beat: 1 },
    { at: 1, measure: 2, beat: 2 },
    { at: 1.25, measure: 2, beat: 3 },
  ]);
});

test('7/8: eighth note beats, a clip starting part-way through a measure counts from the song', () => {
  const map = { base: { num: 7, den: 8 }, points: [] };
  // Measure 2 starts at 1.875; a clip from 2.25 (measure 2, beat 4) for one bar
  const lines = spanMeterLines(2.25, 1, map);
  assert.equal(lines[0].measure, 2);
  assert.equal(lines[0].beat, 4);
  assert.ok(close(lines[0].at, 0));
  const downbeats = lines.filter((l) => l.beat === 1);
  assert.equal(downbeats.length, 1);
  assert.equal(downbeats[0].measure, 3);
  assert.ok(close(2.25 + downbeats[0].at, 2.75));
  assert.equal(lines.length, 8);
  for (const l of lines) assert.ok(l.at >= 0 && l.at < 1);
});

test('a song that changes meter mid-clip: 4/4 then 5/4 from bar 3', () => {
  const map = { base: FOUR_FOUR, points: [{ id: 'a', bar: 3, num: 5, den: 4 }] };
  const lines = round(spanMeterLines(2, 2.5, map));
  const downbeats = lines.filter((l) => l.beat === 1).map((l) => [l.at, l.measure]);
  assert.deepEqual(downbeats, [[0, 2], [1, 3], [2.25, 4]]);
  // Measure 3 has five beats
  assert.equal(lines.filter((l) => l.measure === 3).length, 5);
  assert.equal(lines.length, 10);
});

test('4/4: a line every quarter, a measure every bar', () => {
  const lines = round(spanMeterLines(1, 2, { base: FOUR_FOUR, points: [] }));
  assert.equal(lines.length, 8);
  assert.deepEqual(lines.filter((l) => l.beat === 1).map((l) => l.at), [0, 1]);
});
