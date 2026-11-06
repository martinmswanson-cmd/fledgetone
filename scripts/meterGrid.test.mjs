// The note grid in other time signatures (tempoMap meterGridLine): in 7/8 or 5/8 a quarter grid
// counts from each measure's start, so every downbeat is a line; in 4/4 and 3/4 nothing changes.
// Run with `npm test`.
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
const tm = await import('../src/audio/tempoMap.ts');
const { quantize } = await import('../src/store/noteTools.ts');
const { snapBar } = await import('../src/store/timelineTypes.ts');
const { STEPS_PER_WHOLE } = await import('../src/pocket/pocketGrid.ts');

const meter = (num, den, points = []) => ({ base: { num, den }, points });
const N = (id, start) => ({ id, note: 'C4', startOffset: start, duration: '8n', velocity: 0.8 });
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const GRIDS = [1 / 32, 1 / 48, 1 / 16, 1 / 24, 1 / 8, 1 / 4];

test('in 7/8 and 5/8 a quarter grid has a line on every downbeat', () => {
  for (const [num, den] of [[7, 8], [5, 8]]) {
    const map = meter(num, den);
    const len = num / den;
    for (let m = 0; m < 6; m++) {
      const downbeat = 1 + m * len;
      assert.equal(tm.meterGridLine(downbeat, 1 / 4, map), downbeat);
      assert.equal(tm.meterGridLine(downbeat + 0.01, 1 / 4, map), downbeat);
      assert.equal(tm.meterGridLine(downbeat - 0.01, 1 / 4, map), downbeat);
      // A quarter into the measure, counted from its start
      near(tm.meterGridLine(downbeat + 0.26, 1 / 4, map), downbeat + 0.25);
      assert.equal(tm.meterGridLine(downbeat + 0.01, 1 / 4, map, 'floor'), downbeat);
      near(tm.meterGridLine(downbeat + 0.01, 1 / 4, map, 'ceil'), downbeat + 0.25);
    }
    // The lines of measure 1 and 2 in 7/8: 0, 1/4, 1/2, 3/4, then the downbeat at 7/8
    if (num === 7) assert.deepEqual(tm.meterGridLines(1, 1 + 2 * len, 1 / 4, map).map((b) => +(b - 1).toFixed(6)), [0, 0.25, 0.5, 0.75, 0.875, 1.125, 1.375, 1.625]);
  }
});

test('Quantize to grid leaves a note on measure 2\'s downbeat in 7/8 where it is', () => {
  for (const [num, den] of [[7, 8], [5, 8]]) {
    const map = meter(num, den);
    const start = 1 + num / den; // a clip from measure 2, two measures long
    const notes = [N('a', 0), N('b', num / den), N('c', 0.27)];
    const q = quantize(notes, 1 / 4, start - 1, 1, false, (2 * num) / den, map);
    assert.equal(q[0].startOffset, 0);
    near(q[1].startOffset, num / den);
    near(q[2].startOffset, 0.25);
    // A clip starting at bar 1 too: measure 2's downbeat stays put
    const q1 = quantize([N('d', num / den + 0.02)], 1 / 4, 0, 1, false, 4, map);
    near(q1[0].startOffset, num / den);
  }
});

test('in 4/4 and 3/4 the grid, quantize and timeline snap give exactly what they did', () => {
  // The old rules, counted from bar 1
  const oldSnap = (bar, step) => Math.round((bar - 1) / step) * step + 1;
  const oldQuantize = (x, g, c) => Math.round((x + c) / g) * g - c;
  for (const map of [meter(4, 4), meter(3, 4), meter(6, 8), meter(3, 4, [{ id: 'm', bar: 4, num: 4, den: 4 }])]) {
    for (const g of GRIDS) {
      assert.ok(tm.gridFitsMeasures(g, map), `${map.base.num}/${map.base.den} ${g}`);
      for (let i = 0; i < 400; i++) {
        const bar = 1 + i * 0.0137;
        assert.equal(tm.meterGridLine(bar, g, map), oldSnap(bar, g));
      }
      for (const c of [0, 0.75, 1.5, 2.25, 0.1]) {
        const notes = Array.from({ length: 50 }, (_, i) => N(`n${i}`, i * 0.0391));
        const q = quantize(notes, g, c, 1, false, 4, map);
        const plain = quantize(notes, g, c, 1, false, 4);
        q.forEach((n, i) => {
          assert.equal(n.startOffset, plain[i].startOffset);
          assert.equal(n.startOffset, Math.max(0, oldQuantize(notes[i].startOffset, g, c)));
        });
      }
    }
    for (const grid of ['1/4', '1/8', '1/16']) {
      for (let i = 0; i < 300; i++) {
        const bar = 1 + i * 0.0213;
        const step = { '1/4': 0.25, '1/8': 0.125, '1/16': 0.0625 }[grid];
        assert.equal(snapBar(bar, grid, { bpm: 120, fps: 30, meter: map.base, meterPoints: map.points }), oldSnap(bar, step));
      }
    }
  }
});

test('the timeline snaps clips to the downbeats of 7/8 with a quarter grid', () => {
  const timing = { bpm: 120, fps: 30, meter: { num: 7, den: 8 }, meterPoints: [] };
  assert.equal(snapBar(1.875 + 0.02, '1/4', timing), 1.875);
  assert.equal(snapBar(1.875 + 0.24, '1/4', timing), 2.125);
  // Without the song's meter (older callers) it counts from bar 1 as before
  assert.equal(snapBar(1.875 + 0.02, '1/4', { bpm: 120, fps: 30 }), 2);
  // Through a meter change: 4/4 then 7/8 from bar 3
  const changed = { bpm: 120, fps: 30, meter: { num: 4, den: 4 }, meterPoints: [{ id: 'm', bar: 3, num: 7, den: 8 }] };
  assert.equal(snapBar(1.9, '1/4', changed), 2);
  assert.equal(snapBar(3.875 + 0.03, '1/4', changed), 3.875);
});

test('studio and Pocket agree: Pocket\'s 16th steps from a section start are studio grid lines, and its beats are on the quarter grid in 7/8', () => {
  const map = meter(7, 8);
  for (const from of [1, 1 + 7 / 8, 1 + 4 * (7 / 8)]) {
    for (let step = 0; step < 4 * 14; step++) {
      const bar = from + step / STEPS_PER_WHOLE;
      assert.equal(tm.meterGridLine(bar, 1 / 16, map), bar);
    }
    // Pocket's ruler counts each measure's beats from its downbeat: the studio's grid has every downbeat
    for (const { bar, downbeat } of tm.beatsBetween(from, from + 4 * (7 / 8), map)) if (downbeat) near(tm.meterGridLine(bar + 0.01, 1 / 4, map), bar);
  }
});
