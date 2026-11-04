// The bar-counting arrangement tools in songs not in 4/4: inserting bars, the build-up & drop, stops,
// tags and the pre-hook drop count the ruler's measures and land on its measure lines (tempoMap.ts
// roundToMeasure / measuresFrom / insertedMeasureBars, buildDrop.ts, beatSwitch.ts stopSpan,
// producerTag.ts tagBars, songForm.ts preHookDrop). In 4/4 each gives what it always gave. Run with `npm test`.
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
const { roundToMeasure, measuresFrom, insertedMeasureBars, measureAt, measureStart } = await import('../src/audio/tempoMap.ts');
const { buildUpSteps, snareRollSteps, dropHitSteps } = await import('../src/store/buildDrop.ts');
const { stopSpan, cutGap } = await import('../src/store/beatSwitch.ts');
const { tagBars } = await import('../src/store/producerTag.ts');
const { preHookDrop } = await import('../src/store/songForm.ts');
const { DROP_HIT } = await import('../src/store/demoSong.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const meter = (num, den, points = []) => ({ base: { num, den }, points });
const FOUR = meter(4, 4);
const THREE = meter(3, 4);
const SEVEN = meter(7, 8);
// 4/4, 3/4 from bar 5 (measure 5), back to 4/4 at bar 8 (measure 9)
const CHANGING = meter(4, 4, [{ id: 'a', bar: 5, num: 3, den: 4 }, { id: 'b', bar: 8, num: 4, den: 4 }]);
const onLine = (bar, map) => Math.abs(bar - measureAt(bar, map).start) < 1e-6;

test('roundToMeasure rounds to whole bars in 4/4 (as the tools always did) and to measure lines otherwise', () => {
  assert.equal(roundToMeasure(4.5, FOUR), 5);
  assert.equal(roundToMeasure(4.49, FOUR), 4);
  // 3/4: measures at 1, 1.75, 2.5, 3.25, 4 ...
  assert.equal(roundToMeasure(4, THREE), 4);
  assert.equal(roundToMeasure(3.5, THREE), 3.25);
  assert.equal(roundToMeasure(3.7, THREE), 4);
  for (const bar of [1.3, 2.9, 5.55, 9.01]) for (const map of [THREE, SEVEN, CHANGING]) assert.ok(onLine(roundToMeasure(bar, map), map), `${bar}`);
});

test('measuresFrom counts measures in the meter of each one passed, and parts of the last', () => {
  assert.equal(measuresFrom(5, -2, FOUR), 3);
  assert.equal(measuresFrom(5, -0.5, FOUR), 4.5);
  assert.equal(measuresFrom(measureStart(9, THREE), -4, THREE), measureStart(5, THREE));
  assert.equal(measuresFrom(measureStart(5, THREE), -0.5, THREE), measureStart(4, THREE) + 0.375);
  assert.equal(measuresFrom(measureStart(3, THREE), -8, THREE), 1, 'stops at bar 1');
  // Across a change: two measures back from measure 10 (bar 9) are measure 8 (3/4, bar 7.25)
  assert.equal(measuresFrom(9, -2, CHANGING), 7.25);
  assert.equal(measuresFrom(4, 3, CHANGING), 6.5);
});

test('a measure inserted at a time signature change is in the meter before it, so the change moves with the music', () => {
  assert.equal(insertedMeasureBars(5, FOUR), 1);
  assert.equal(insertedMeasureBars(1, THREE), 0.75);
  assert.equal(insertedMeasureBars(4, THREE), 0.75);
  assert.equal(insertedMeasureBars(5, CHANGING), 1, 'the 4/4 before the 3/4');
  assert.equal(insertedMeasureBars(5.75, CHANGING), 0.75);
  assert.equal(insertedMeasureBars(8, CHANGING), 0.75, 'the 3/4 before the 4/4');
  // Every later change stays on a measure line of the meter before it after the insert
  for (const at of [3, 5, 5.75, 7.25, 8, 9]) {
    for (const n of [1, 2, 3]) {
      const bars = n * insertedMeasureBars(at, CHANGING);
      const moved = CHANGING.points.map((p) => (p.bar >= at - 1e-9 ? { ...p, bar: p.bar + bars } : p));
      // Each change lands where the meter before it has a measure line
      let map = meter(4, 4);
      for (const p of moved) {
        assert.ok(onLine(p.bar, map), `insert ${n} at ${at}: change at ${p.bar}`);
        map = meter(4, 4, [...map.points, p]);
      }
    }
  }
});

test('the store inserts measures (not 4-beat bars) at a measure line when the song is not in 4/4', () => {
  const store = src('src/store/timelineStore.ts');
  const insert = store.slice(store.indexOf('    insertBars: (atBar, bars) => {'), store.indexOf('    addBuildAndDrop: (dropBar) => {'));
  assert.match(insert, /if \(isPlainMeter\(map\)\) return insertTime\(clampBar\(atBar\), bars, bars\);/);
  assert.match(insert, /nearestMeasureStart\(clampBar\(atBar\), map\)/);
  assert.match(insert, /bars \* insertedMeasureBars\(at, map\)/);
  // Tools that make room for a stretch of known length insert exactly that
  for (const path of ['src/store/arrangeActions.ts', 'src/pocket/pocketSections.ts']) assert.doesNotMatch(src(path), /\.insertBars\(/, path);
});

test('in 4/4 the build-up, roll and drop hit are what they always were', () => {
  assert.deepEqual(buildUpSteps(4).map(([s, , v, d]) => [s, v, d]), [[0, 0.85, '4:0:0'], [0, 0.7, '4:0:0'], [48, 0.85, '1n']]);
  assert.equal(snareRollSteps(4).length, 4 + 8 + 32);
  assert.equal(snareRollSteps(2).length, 32);
  assert.equal(dropHitSteps(), DROP_HIT);
  // The measure-by-measure roll, given four 4/4 measures, is the same roll
  const three = (steps) => steps.map((s) => s.slice(0, 3));
  assert.deepEqual(three(snareRollSteps(4, [1, 1, 1, 1])), three(snareRollSteps(4)));
  assert.deepEqual(three(snareRollSteps(3, [1, 1, 1])), three(snareRollSteps(3)));
});

test('not in 4/4, the build-up and roll are written in the measures before the drop', () => {
  // Four 3/4 measures (12 16ths each)
  const three = [0.75, 0.75, 0.75, 0.75];
  const build = buildUpSteps(3, three);
  assert.equal(build[0][3], '3:0:0');
  assert.equal(build[2][0], 36, 'the reverse crash in the last measure');
  assert.equal(build[2][3], '2n.', 'as long as that measure');
  const roll = snareRollSteps(3, three);
  assert.deepEqual(roll.filter(([s]) => s < 12).map(([s]) => s), [0, 4, 8], 'quarters in the first measure');
  assert.deepEqual(roll.filter(([s]) => s >= 12 && s < 24).map(([s]) => s), [12, 14, 16, 18, 20, 22], '8ths in the second');
  const sixteenths = roll.filter(([s]) => s >= 24);
  assert.equal(sixteenths.length, 24, '16ths over the last two');
  assert.equal(sixteenths[0][2], 0.65);
  assert.ok(Math.abs(sixteenths[23][2] - 0.95) < 1e-9);
  assert.ok(roll.every(([s]) => s < 48));
  // 7/8: 14 16ths a measure; a two-measure build keeps the roll's end
  const seven = snareRollSteps(1.75, [0.875, 0.875]);
  assert.equal(seven.length, 28);
  assert.equal(seven[27][0], 27);
  // The drop hit's downlifter starts on its second measure and ends with it
  const hit = dropHitSteps([0.875, 0.875]);
  assert.equal(hit[2][0], 14);
  assert.equal(hit[2][3], '0:3:2');
});

test('a stop is the last beat of the measure, a beat being the meter\'s own', () => {
  assert.deepEqual(stopSpan(4, 1), [4.75, 5]);
  assert.deepEqual(stopSpan(4, 1, FOUR), [4.75, 5]);
  assert.deepEqual(stopSpan(4.4, 0.5, FOUR), [4.875, 5]);
  // 3/4: the measure starting at 3.25 ends at 4 (measure 5)
  assert.deepEqual(stopSpan(3.25, 1, THREE), [3.75, 4]);
  assert.deepEqual(stopSpan(3.1, 0.5, THREE), [3.875, 4]);
  // 6/8: a beat is an eighth
  assert.deepEqual(stopSpan(1.75, 1, meter(6, 8)), [2.375, 2.5]);
  // 7/8 measure 3 starts at 2.75, ends at 3.625
  assert.deepEqual(stopSpan(2.75, 0.5, SEVEN), [3.5625, 3.625]);
});

test('tags go every few measures from the nearest measure line', () => {
  assert.deepEqual(tagBars(1, 33, 8, 0.5, FOUR), [1, 9, 17, 25]);
  assert.deepEqual(tagBars(1.2, 3, 0, 0.5, THREE), [1]);
  // 3/4, every 4 measures (3 bars), the song 12 bars long: measures 1, 5, 9, 13
  assert.deepEqual(tagBars(1, 13, 4, 0.5, THREE), [1, 4, 7, 10]);
  assert.deepEqual(tagBars(1.8, 13, 4, 0.5, THREE), [1.75, 4.75, 7.75, 10.75]);
  for (const b of tagBars(1, 40, 8, 0.4, SEVEN)) assert.ok(onLine(b, SEVEN));
});

test('the pre-hook drop is the last half of the last measure', () => {
  const notes = [0, 0.25, 0.5, 0.75, 1, 1.25].map((at, i) => ({ id: `n${i}`, note: 'C1', startOffset: at, duration: '16n', velocity: 0.8 }));
  assert.deepEqual(preHookDrop(notes, 2), cutGap(notes, 1.5, 2));
  // Two 3/4 measures: the drop from 1.125 to 1.5
  assert.deepEqual(preHookDrop(notes, 1.5, 0.375).map((n) => n.startOffset), [0, 0.25, 0.5, 0.75, 1]);
});

test('the arrange tools and the Song menu count measures, and name them as the ruler does', () => {
  const arrange = src('src/store/arrangeActions.ts');
  for (const fn of ['addStop', 'addDropFx', 'beatSwitch', 'layOutSong', 'dropOut']) {
    const body = arrange.slice(arrange.indexOf(`export function ${fn}(`));
    assert.match(body.slice(0, body.indexOf('\n}\n')), /formatBar(Position|Range)\(/, fn);
  }
  const menu = src('src/components/menu/MenuBar.tsx');
  assert.match(menu, /const at = Math\.max\(1, roundToMeasure\(s\.playheadPosition, meter\)\);/);
  assert.doesNotMatch(menu, /Math\.max\(1, Math\.round\(s\.playheadPosition\)\)/);
});
