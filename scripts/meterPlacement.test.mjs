// Where new clips and the drop of a speed-up land in songs not in 4/4: on the beat of the meter
// there (tempoMap.ts beatFloor), on measure lines (roundToMeasure, measureAt) and the ruler's
// measures (addMeasures, measuresFrom), as the timeline, Slicer, sample flip, speed-up and the
// Arrange dialog's openers use them. In 4/4 each gives what it always gave. Run with `npm test`.
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
const { beatFloor, roundToMeasure, measureStart, measuresFrom, measureAt, addMeasures } = await import('../src/audio/tempoMap.ts');
const { barNumberNear, formatBarSpan } = await import('../src/store/timelineTypes.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const meter = (num, den, points = []) => ({ base: { num, den }, points });
const FOUR = meter(4, 4);
const THREE = meter(3, 4);
const SEVEN = meter(7, 8);
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('beatFloor is the quarter at or before a position in 4/4, and the meter’s beat inside the measure otherwise', () => {
  for (const bar of [1, 1.1, 2.26, 3.999, 7.5]) assert.equal(beatFloor(bar, FOUR), Math.floor(bar * 4 + 1e-6) / 4);
  // 7/8: measure 2 starts at 1.875; just after its line the clip starts on it, not on the quarter 1.75 in measure 1
  near(beatFloor(1.95, SEVEN), 1.875);
  near(beatFloor(1.875 + 0.125 * 3 + 0.01, SEVEN), 1.875 + 0.375);
  // the last eighth of a measure stays in it
  near(beatFloor(2.749, SEVEN), 2.625);
  near(beatFloor(1.8, THREE), 1.75);
  for (const bar of [1.3, 2.9, 5.55]) assert.equal(measureAt(beatFloor(bar, SEVEN), SEVEN).measure, measureAt(bar, SEVEN).measure);
});

test('the Arrange dialog opened at a measure line shows that measure (the dialog numbers the position it is given)', () => {
  for (const map of [THREE, meter(6, 8), SEVEN, meter(5, 4)]) {
    for (let m = 2; m <= 12; m++) {
      const pos = measureStart(m, map);
      assert.equal(barNumberNear(Math.max(measureStart(2, map), roundToMeasure(pos, map)), map), m, `${map.base.num}/${map.base.den} m${m}`);
      assert.equal(barNumberNear(roundToMeasure(pos + 0.01, map), map), m);
    }
  }
  // 4/4 as before: Math.round
  for (const pos of [2, 3.4, 3.5, 7.9]) assert.equal(roundToMeasure(pos, FOUR), Math.round(pos));
});

test('the speed-up suggestion is the 4 measures before the measure line nearest the drop', () => {
  // (as speedUpActions.ts suggestBlock works it out)
  const block = (bar, map) => {
    const drop = Math.max(measureStart(2, map), roundToMeasure(bar, map));
    return { from: Math.max(1, measuresFrom(drop, -4, map)), to: drop };
  };
  assert.deepEqual(block(9.3, FOUR), { from: 5, to: 9 });
  assert.deepEqual(block(2.2, FOUR), { from: 1, to: 2 });
  // 3/4: nearest line to 4.2 is measure 5 (bar 4); four measures back is measure 1
  assert.deepEqual(block(4.2, THREE), { from: 1, to: 4 });
  assert.deepEqual(block(measureStart(9, THREE) + 0.1, THREE), { from: measureStart(5, THREE), to: measureStart(9, THREE) });
  const b = block(6.1, SEVEN);
  assert.equal(measureAt(b.to, SEVEN).measure - measureAt(b.from, SEVEN).measure, 4);
  near(b.to, measureAt(b.to, SEVEN).start);
});

test('new 2-bar clips at the playhead start on its measure and are two measures long', () => {
  const at = measureAt(2.3, SEVEN).start;
  near(at, 1.875);
  near(addMeasures(at, 2, SEVEN) - at, 1.75);
  assert.equal(formatBarSpan(at, addMeasures(at, 2, SEVEN), SEVEN), '2 bars');
  assert.equal(measureAt(2.3, FOUR).start, 2);
  assert.equal(addMeasures(2, 2, FOUR) - 2, 2);
});

test('the openers and placers use the meter, not whole notes', () => {
  assert.doesNotMatch(src('src/search/paletteEntries.ts'), /openArrange\('drops', Math\.max\(2, Math\.round/);
  assert.doesNotMatch(src('src/components/timeline/RulerContextMenu.tsx'), /openArrange\('drops', Math\.round/);
  assert.doesNotMatch(src('src/components/timeline/ClipContextMenu.tsx'), /openArrange\('drops', Math\.round|Math\.floor\(menu\.bar \* 4/);
  assert.match(src('src/components/timeline/TrackLane.tsx'), /beatFloor\(raw, meter\)/);
  assert.doesNotMatch(src('src/store/speedUpActions.ts'), /drop - 4/);
  assert.doesNotMatch(src('src/components/inspector/SlicerPanel.tsx'), /Math\.floor\(st\.playheadPosition\)/);
  assert.doesNotMatch(src('src/store/flipActions.ts'), /Math\.floor\(after\.playheadPosition\)/);
  assert.match(src('src/components/timeline/LauncherPanel.tsx'), /formatBarSpan\(1, 1 \+ slot\.clip\.lengthBars, meter\)/);
  assert.match(src('src/store/timelineStore.ts'), /meter: songMeterOf\(s\) \}\)/);
});
