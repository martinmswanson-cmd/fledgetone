// A "bar" in the shuttle keys (J, Shift+J, Shift+L), a new empty clip, a chord progression's chord
// and a Math pattern's length is a bar as the ruler counts it: three beats in 3/4, a whole note
// in 4/4 as before. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const tm = await import('../src/audio/tempoMap.ts');
const S = await import('../src/store/smartTools.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const FOUR = { base: { num: 4, den: 4 }, points: [] };
const THREE = { base: { num: 3, den: 4 }, points: [] };
// 4/4 for two measures, then 3/4 from bar 3 (measure 3)
const MIXED = { base: { num: 4, den: 4 }, points: [{ id: 'm1', bar: 3, num: 3, den: 4 }] };

test('addMeasures: n bars on from a position, as the ruler counts them', () => {
  // 4/4: just bar + n
  for (const [b, n] of [[1, 1], [5.25, 2], [3, 0.5], [7.5, -3]]) assert.equal(tm.addMeasures(b, n, FOUR), b + n);
  // 3/4: a bar is 0.75 of a whole note
  near(tm.addMeasures(1, 1, THREE), 1.75);
  near(tm.addMeasures(1, 4, THREE), 4);
  near(tm.addMeasures(1.25, 1, THREE), 2); // keeps the beat it's on
  near(tm.addMeasures(1, 0.5, THREE), 1.375);
  // Across a change: measure 2 (4/4) then measure 3 in 3/4
  near(tm.addMeasures(2, 1, MIXED), 3);
  near(tm.addMeasures(2, 2, MIXED), 3.75);
  near(tm.addMeasures(2.5, 1, MIXED), 3.375); // half way through, half way through the next
});

test('chord spans: a measure per "1 bar" chord, the clip whole measures', () => {
  // 4/4 as before
  const four = S.chordSpans(1, 4, 1, FOUR);
  assert.deepEqual(four.spans, [0, 1, 2, 3].map((i) => ({ start: i, length: 1 })));
  assert.equal(four.length, 4);
  assert.deepEqual(S.chordSpans(5, 4, 0.5, FOUR).spans.map((s) => s.start), [0, 0.5, 1, 1.5]);
  // 3/4: four chords are four measures, three whole notes
  const three = S.chordSpans(1, 4, 1, THREE);
  assert.deepEqual(three.spans.map((s) => s.start), [0, 0.75, 1.5, 2.25]);
  assert.ok(three.spans.every((s) => s.length === 0.75));
  assert.equal(three.length, 3);
  assert.equal(S.chordSpans(1, 4, 2, THREE).length, 6);
  // Over a change of meter: each chord the length of its own measure
  assert.deepEqual(S.chordSpans(2, 2, 1, MIXED).spans, [{ start: 0, length: 1 }, { start: 1, length: 0.75 }]);
});

test('chord notes follow the spans; without them nothing changes', () => {
  let n = 0;
  const newId = () => `n${n++}`;
  const chords = [[0, 4, 7], [5, 9, 0], [7, 11, 2], [0, 4, 7]];
  const plain = S.chordNotesFor(chords, 1, 'sustain', newId).map(({ id, ...x }) => x);
  const spanned = S.chordNotesFor(chords, 1, 'sustain', newId, S.chordSpans(1, 4, 1, FOUR).spans).map(({ id, ...x }) => x);
  assert.deepEqual(spanned, plain);
  const three = S.chordNotesFor(chords, 1, 'sustain', newId, S.chordSpans(1, 4, 1, THREE).spans);
  assert.deepEqual([...new Set(three.map((x) => x.startOffset))], [0, 0.75, 1.5, 2.25]);
  assert.ok(three.every((x) => x.duration === three[0].duration));
  const pulse = S.chordNotesFor([[0, 4, 7]], 1, 'pulse', newId, S.chordSpans(1, 1, 1, THREE).spans);
  assert.deepEqual([...new Set(pulse.map((x) => x.startOffset))], [0, 0.25, 0.5], 'three beats in a 3/4 bar');
});

test('the shuttle keys step bars as the ruler counts them', () => {
  // The steps Timeline.tsx takes
  const forward = (pos, m) => tm.measureStart(tm.measureAt(pos + 1e-6, m).measure + 1, m);
  const back = (pos, m, shift) => {
    const bar = tm.measureAt(pos - 1e-6, m);
    return Math.max(1, shift ? tm.measureStart(bar.measure - 3, m) : bar.start);
  };
  // 4/4: as before (floor + 1, ceil - 1, and 3 more back)
  for (const pos of [1, 1.5, 4, 4.9999995, 5, 5.0000005, 7.25, 12]) {
    assert.equal(forward(pos, FOUR), Math.floor(pos + 1e-6) + 1, `L ${pos}`);
    const bar = Math.ceil(pos - 1e-6) - 1;
    assert.equal(back(pos, FOUR, false), Math.max(1, bar), `J ${pos}`);
    assert.equal(back(pos, FOUR, true), Math.max(1, bar - 3), `Shift+J ${pos}`);
  }
  // 3/4: measure 5 starts at 4
  assert.equal(forward(4, THREE), 4.75);
  assert.equal(back(4, THREE, false), 3.25);
  assert.equal(back(4.5, THREE, false), 4);
  // From measure 9 (bar 7), four measures back is measure 5
  assert.equal(back(7, THREE, true), 4);
  assert.equal(back(1.5, THREE, true), 1);
  const timeline = src('src/components/timeline/Timeline.tsx');
  assert.match(timeline, /s\.seek\(measureStart\(measureAt\(s\.playheadPosition \+ 1e-6, meter\)\.measure \+ 1, meter\), true\)/);
  assert.match(timeline, /const bar = measureAt\(s\.playheadPosition - 1e-6, meter\);\s+s\.seek\(Math\.max\(1, e\.shiftKey \? measureStart\(bar\.measure - 3, meter\) : bar\.start\), true\)/);
});

test('new empty clips, Smart tools and Math patterns are sized and placed by the ruler’s bars', () => {
  assert.match(src('src/components/timeline/TrackLane.tsx'), /createEmptyClip\(track\.id, bar, addMeasures\(bar, 1, songMeterOf\(s\)\) - bar\)/);
  const menu = src('src/components/timeline/ClipContextMenu.tsx');
  assert.match(menu, /createEmptyClip\(track\.id, at, addMeasures\(at, bars, meter\) - at\)/);
  // Make clip at bar: the start of the measure clicked in (Math.floor would be a whole note's start)
  assert.match(menu, /bar: measureAt\(Math\.max\(1, menu\.bar\) \+ 1e-6, meter\)\.start/);
  assert.doesNotMatch(menu, /Math\.floor\(menu\.bar \+ 1e-6\)/);
  // In 4/4 that's the old Math.floor(bar)
  for (const b of [1, 1.5, 5, 5.9999995, 6.75]) assert.equal(tm.measureAt(Math.max(1, b) + 1e-6, FOUR).start, Math.max(1, Math.floor(b + 1e-6)));
  // Right-clicking measure 6 in 3/4 (bar 4.75 to 5.5) makes it at measure 6
  assert.equal(tm.measureAt(5.2 + 1e-6, THREE).start, 4.75);
  const actions = src('src/store/smartActions.ts');
  assert.match(actions, /chordSpans\(atBar, chords\.length, chordBars, songMeterOf\(tl\(\)\)\)/);
  assert.match(actions, /const length = addMeasures\(atBar, bars, songMeterOf\(tl\(\)\)\) - atBar;\s+const notes = mathPattern\(pattern, \{ root: key\.root, steps: key\.steps \}, length, newId\);/);
});
