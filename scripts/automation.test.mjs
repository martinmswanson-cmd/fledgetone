// Unit tests for the automation maths (lane values, the setting scales, curve sampling, edits). Run with `npm test`.
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
const {
  AUTOMATION,
  LAST_BAR,
  formatDb,
  formatHz,
  formatPan,
  insertLaneBars,
  insertPoint,
  isLinearMap,
  laneValueAt,
  laneValueBefore,
  lanePieceFrom,
  movePoints,
  nextPointBar,
  normalizePoints,
  parseAutomation,
  rampPoints,
  removeLaneBars,
  sampleStretch,
  shiftRange,
} = await import('../src/audio/automation.ts');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const P = (...pairs) => pairs.map(([bar, value]) => ({ bar, value }));

test('a lane value at a bar: before, between, after and at a jump', () => {
  const pts = P([2, 0], [4, 1], [4, 0.2], [6, 0.6]);
  assert.equal(laneValueAt([], 3), null);
  assert.equal(laneValueAt(pts, 1), 0); // before the first point: its value
  near(laneValueAt(pts, 3), 0.5);
  assert.equal(laneValueAt(pts, 4), 0.2); // at a jump: the value from there on
  assert.equal(laneValueBefore(pts, 4), 1); // ...and the value arriving there
  near(laneValueAt(pts, 5), 0.4);
  assert.equal(laneValueAt(pts, 9), 0.6); // after the last: its value
  assert.equal(laneValueBefore(pts, 1), 0);
  assert.equal(nextPointBar(pts, 2), 4);
  assert.equal(nextPointBar(pts, 4), 6);
  assert.equal(nextPointBar(pts, 6), Infinity);
});

test('lane pieces stop at the next point or the limit', () => {
  const pts = P([2, 0], [4, 1], [4, 0.2], [6, 0.6]);
  assert.deepEqual(lanePieceFrom(pts, 1, 10), { endBar: 2, from: 0, to: 0 });
  const p = lanePieceFrom(pts, 3, 10);
  assert.equal(p.endBar, 4);
  near(p.from, 0.5);
  assert.equal(p.to, 1); // arrives at the top before the jump down
  const q = lanePieceFrom(pts, 4, 5);
  assert.equal(q.endBar, 5);
  assert.equal(q.from, 0.2);
  near(q.to, 0.4);
  assert.deepEqual(lanePieceFrom(pts, 7, 9), { endBar: 9, from: 0.6, to: 0.6 });
});

test('volume lane: a fader-like scale, -60 dB silent', () => {
  const v = AUTOMATION.volume;
  near(v.toReal(1), 6);
  near(v.toReal(10 ** (-6 / 80)), 0, 1e-9); // 0 dB about 84% up
  near(v.toReal(0.5), 6 + 80 * Math.log10(0.5)); // about -18 dB in the middle
  assert.equal(v.toReal(0), -Infinity);
  assert.equal(v.toNorm(-60), 0);
  assert.equal(v.toNorm(-Infinity), 0);
  near(v.toNorm(v.toReal(0.7)), 0.7);
  assert.equal(formatDb(-60), '-inf');
  assert.equal(formatDb(-5.94), '-5.9 dB');
  assert.equal(formatDb(1.5), '+1.5 dB');
});

test('cutoff and resonance lanes are logarithmic', () => {
  const c = AUTOMATION.filterCutoff;
  near(c.toReal(0), 20);
  near(c.toReal(1), 20000, 1e-6);
  near(c.toReal(0.5), Math.sqrt(20 * 20000), 1e-6); // the middle is the geometric mean
  near(c.toNorm(2000), 2 / 3, 1e-12);
  const r = AUTOMATION.filterResonance;
  near(r.toReal(0), 0.5);
  near(r.toReal(1), 15, 1e-9);
  near(r.toNorm(r.toReal(0.3)), 0.3);
  assert.equal(formatHz(350), '350 Hz');
  assert.equal(formatHz(1250), '1.25 kHz');
  assert.equal(formatHz(12500), '12.5 kHz');
});

test('pan, sends and EQ map straight', () => {
  near(AUTOMATION.pan.toReal(0), -1);
  near(AUTOMATION.pan.toReal(0.75), 0.5);
  assert.equal(formatPan(-0.4), 'L40');
  assert.equal(formatPan(0.001), 'C');
  near(AUTOMATION.reverbSend.toReal(0.3), 0.3);
  near(AUTOMATION.eqLow.toReal(0), -24);
  near(AUTOMATION.eqLow.toReal(1), 12);
  near(AUTOMATION.eqMid.toNorm(0), 2 / 3);
  // Every scale reads back (above the volume lane's silent bottom, about 15% up)
  for (const spec of Object.values(AUTOMATION)) {
    for (const n of [0.2, 0.5, 0.9]) near(spec.toNorm(spec.toReal(n)), n, 1e-9);
  }
});

test('stretches: straight maps get two values, curves one every 10 ms', () => {
  assert.equal(isLinearMap((n) => 2 * n - 1), true);
  assert.equal(isLinearMap((n) => 20 * 1000 ** n), false);
  assert.equal(isLinearMap((n) => 10 ** (AUTOMATION.volume.toReal(n) / 20)), false);
  const line = sampleStretch(0.2, 0.8, 1.5, (n) => n, true);
  assert.deepEqual([...line].map((v) => +v.toFixed(6)), [0.2, 0.8]);
  const curve = sampleStretch(0, 1, 0.25, AUTOMATION.filterCutoff.toReal, false);
  assert.equal(curve.length, 26);
  near(curve[0], 20, 1e-4);
  near(curve[25], 20000, 0.01);
  near(curve[13], AUTOMATION.filterCutoff.toReal(13 / 25), 0.01);
  assert.equal(sampleStretch(0, 1, 0.001, (n) => n, false).length, 2);
});

test('points stay on the timeline and in order', () => {
  const pts = normalizePoints(P([5, 0.5], [0, 2], [3, -1], [999, 0.4], [3, 0.7]));
  assert.deepEqual(pts, P([1, 1], [3, 0], [3, 0.7], [5, 0.5], [LAST_BAR, 0.4]));
  const kept = P([2, 0.5]);
  assert.equal(normalizePoints(kept)[0], kept[0]); // valid points keep their identity
  const { points, index } = insertPoint(P([1, 0], [3, 1], [3, 0.5]), { bar: 3, value: 0.2 });
  assert.equal(index, 3);
  assert.deepEqual(points.map((p) => p.value), [0, 1, 0.5, 0.2]);
});

test('a group of points moves only as far as its neighbours allow', () => {
  const pts = P([2, 0], [4, 1], [5, 1], [8, 0]);
  assert.deepEqual(shiftRange(pts, new Set([1, 2])), [-2, 3]);
  assert.deepEqual(shiftRange(pts, new Set([0])), [-1, 2]);
  assert.deepEqual(shiftRange(pts, new Set([3])), [-3, LAST_BAR - 8]);
});

test('dragging points: together, kept in order, Alt leaves copies', () => {
  const pts = P([2, 0], [4, 1], [5, 1], [8, 0]);
  const { points, moved } = movePoints(pts, new Set([1, 2]), 1, -0.25, false);
  assert.deepEqual(points, P([2, 0], [5, 0.75], [6, 0.75], [8, 0]));
  assert.equal(moved.size, 2);
  assert.ok([...moved].every((p) => points.includes(p)));
  assert.equal(points[0], pts[0]); // points that stay keep their identity
  // Onto the next point's bar: still before it (a jump from the moved value to the neighbour's)
  assert.deepEqual(movePoints(pts, new Set([2]), 3, 0, false).points, P([2, 0], [4, 1], [8, 1], [8, 0]));
  // Alt: the copy stays put, on the side it was left behind on
  assert.deepEqual(movePoints(pts, new Set([0]), 1, 0.5, true).points, P([2, 0], [3, 0.5], [4, 1], [5, 1], [8, 0]));
  assert.deepEqual(movePoints(pts, new Set([3]), -2, 0, true).points, P([2, 0], [4, 1], [5, 1], [6, 0], [8, 0]));
  assert.deepEqual(movePoints(pts, new Set([1]), 0, -1, true).points, P([2, 0], [4, 1], [4, 0], [5, 1], [8, 0]));
});

test('inserting bars holds the value across the gap and moves later points', () => {
  const pts = P([1, 0], [5, 1]);
  const out = insertLaneBars(pts, 3, 4);
  assert.deepEqual(out, P([1, 0], [3, 0.5], [7, 0.5], [9, 1]));
  // The lane reads the same before the insert point and, shifted, after the gap
  for (const bar of [1, 2, 2.9]) near(laneValueAt(out, bar), laneValueAt(pts, bar));
  for (const bar of [3, 4, 5]) near(laneValueAt(out, bar + 4), laneValueAt(pts, bar));
  // A jump at the insert point moves along with the music
  const jump = insertLaneBars(P([1, 0], [3, 0], [3, 1], [5, 1]), 3, 2);
  assert.deepEqual(jump, P([1, 0], [3, 0], [5, 0], [5, 1], [7, 1]));
  // Nothing before the insert point: everything moves
  assert.deepEqual(insertLaneBars(P([4, 0.2], [6, 0.8]), 2, 1), P([5, 0.2], [7, 0.8]));
  // Nothing at or after it: unchanged
  assert.deepEqual(insertLaneBars(P([1, 0.3]), 4, 2), P([1, 0.3]));
  // Pushed off the end: dropped, with the value at the end kept
  const end = insertLaneBars(P([1, 0], [LAST_BAR, 1]), LAST_BAR - 100, 200);
  assert.equal(end[end.length - 1].bar, LAST_BAR);
  assert.ok(end.every((p) => p.bar <= LAST_BAR));
});

test('deleting bars cuts the lane like the music', () => {
  const pts = P([1, 0], [9, 1]);
  const out = removeLaneBars(pts, 3, 7);
  assert.deepEqual(out, P([1, 0], [3, 0.25], [3, 0.75], [5, 1]));
  for (const bar of [1, 2, 2.99]) near(laneValueAt(out, bar), laneValueAt(pts, bar));
  for (const bar of [7, 8, 9, 12]) near(laneValueAt(out, bar - 4), laneValueAt(pts, bar));
  // Points only inside the removed bars: the value before and after them survives
  assert.deepEqual(removeLaneBars(P([3, 0], [5, 1]), 2, 8), P([2, 0], [2, 1]));
  // A flat lane gets no jump
  assert.deepEqual(removeLaneBars(P([1, 0.5], [9, 0.5]), 3, 5), P([1, 0.5], [3, 0.5], [7, 0.5]));
  assert.deepEqual(removeLaneBars(P([1, 0.5]), 3, 5), P([1, 0.5]));
});

test('ramps replace the points between In and Out', () => {
  assert.deepEqual(rampPoints(P([1, 0.5], [4, 0.9], [9, 0.1]), 3, 5, 0, 1), P([1, 0.5], [3, 0], [5, 1], [9, 0.1]));
  assert.deepEqual(rampPoints([], 2, 4, 1, 0), P([2, 1], [4, 0]));
});

test('project lanes are validated', () => {
  assert.equal(parseAutomation(undefined), undefined);
  assert.equal(parseAutomation('nope'), undefined);
  assert.equal(parseAutomation([]), undefined);
  const lanes = parseAutomation([
    { param: 'volume', points: [{ bar: 3, value: 0.5 }, { bar: 1, value: 4 }, { bar: 'x', value: 0 }, null] },
    { param: 'volume', points: [{ bar: 2, value: 0 }] },
    { param: 'wobble', points: [] },
    { param: 'pan', points: 'bad' },
    { param: 'filterCutoff', points: [] },
  ]);
  assert.deepEqual(lanes, [
    { param: 'volume', points: P([1, 1], [3, 0.5]) },
    { param: 'filterCutoff', points: [] },
  ]);
});
