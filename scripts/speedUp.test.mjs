// Speed up into the drop (src/store/speedUp.ts): the tempo rising over the last part of a block,
// its curve, the bar and beat maths, the snap back on the drop, the drum roll and where tempo-
// following audio clips are cut. Run with `npm test`.
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
const { speedUpPoints, rampStart, describeBeats, barBeat, curveAt, rollSpans, rollNotes, audioCuts, SNAP_LEAD, BUILD_STEPS, MAX_PIECE_DRIFT } = await import('../src/store/speedUp.ts');
const { barToSeconds, tempoAt } = await import('../src/audio/tempoMap.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');

const FOUR = { base: { num: 4, den: 4 }, points: [] };
let n = 0;
const id = () => `p${++n}`;
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const opts = (o) => ({ from: 1, to: 9, share: 0.25, amount: 0.25, curve: 'steady', snapBack: true, ...o });

test('the last 25% of 8 bars is the last 2 bars, in whole beats', () => {
  assert.deepEqual(rampStart(1, 9, 0.25, FOUR), { start: 7, beats: 8 });
  // 10% of 4 bars is 1.6 beats: 2 beats
  assert.deepEqual(rampStart(5, 9, 0.1, FOUR), { start: 8.5, beats: 2 });
  // Never less than a beat, never more than the block
  assert.deepEqual(rampStart(8, 9, 0.1, FOUR), { start: 8.75, beats: 1 });
  assert.deepEqual(rampStart(5, 9, 1, FOUR), { start: 5, beats: 16 });
  // In 6/8 a beat is an 8th
  const six = { base: { num: 6, den: 8 }, points: [] };
  assert.equal(rampStart(1, 4, 0.25, six).beats, 6);
  assert.equal(rampStart(1, 4, 0.25, six).start, 3.25);
});

test('lengths and positions read as bars and beats', () => {
  assert.equal(describeBeats(8, 7, FOUR), '2 bars');
  assert.equal(describeBeats(6, 7, FOUR), '1 bar 2 beats');
  assert.equal(describeBeats(3, 7, FOUR), '3 beats');
  assert.equal(describeBeats(1, 7, FOUR), '1 beat');
  assert.equal(barBeat(7, FOUR), '7');
  assert.equal(barBeat(8.5, FOUR), '8.3');
});

test('steady: one glide to 25% faster, a 32nd before the drop, then back on the drop', () => {
  const plan = speedUpPoints([], 120, FOUR, opts({}), id);
  assert.equal(typeof plan, 'object');
  assert.equal(plan.start, 7);
  assert.equal(plan.toBpm, 150);
  const pts = plan.points.map((p) => [p.bar, p.bpm, p.ramp]);
  assert.deepEqual(pts, [[7, 120, false], [9 - SNAP_LEAD, 150, true], [9, 120, false]]);
  const map = { bpm: 120, points: plan.points };
  // Before the speed-up nothing moves
  close(barToSeconds(7, map), 12);
  // Halfway through the glide (in time) the tempo is halfway
  const t0 = barToSeconds(7, map);
  const t1 = barToSeconds(9 - SNAP_LEAD, map);
  close(tempoAt(7, map), 120);
  close(tempoAt(9 - SNAP_LEAD, map), 150);
  // Faster: the two bars take less than 4 s, and more than at 150 throughout
  assert.ok(t1 - t0 < 4 * (2 - SNAP_LEAD) / 2 && t1 - t0 > (240 * (2 - SNAP_LEAD)) / 150);
  // After the drop: the old tempo, every bar as long as before
  close(tempoAt(9, map), 120);
  close(barToSeconds(13, map) - barToSeconds(9, map), 8);
});

test('stay at the new speed: no snap back, the glide ends on the drop', () => {
  const plan = speedUpPoints([], 120, FOUR, opts({ snapBack: false, amount: 0.5 }), id);
  assert.deepEqual(plan.points.map((p) => [p.bar, p.bpm, p.ramp]), [[7, 120, false], [9, 180, true]]);
  close(tempoAt(12, { bpm: 120, points: plan.points }), 180);
});

test('slow, then fast: glides along a rising curve, below the steady line, ending at the top', () => {
  const plan = speedUpPoints([], 100, FOUR, opts({ curve: 'build', amount: 1 }), id);
  const ramps = plan.points.filter((p) => p.ramp);
  assert.equal(ramps.length, BUILD_STEPS);
  assert.equal(ramps.at(-1).bpm, 200);
  let last = 100;
  let lastRise = 0;
  for (const p of ramps) {
    const x = (p.bar - plan.start) / (plan.top - plan.start);
    assert.ok(p.bpm > last, 'rises');
    assert.ok(p.bpm - last > lastRise - 1e-9, 'faster and faster');
    assert.ok(p.bpm <= 100 + 100 * x + 1e-9, 'under the steady line');
    lastRise = p.bpm - last;
    last = p.bpm;
  }
  assert.equal(curveAt('build', 0.5), 0.25);
  assert.equal(curveAt('steady', 0.5), 0.5);
});

test('the music before the speed-up and after the drop keeps its timing, glides included', () => {
  // A glide from 100 at bar 1 to 140 at bar 12 runs through the block
  const old = [{ id: 'a', bar: 12, bpm: 140, ramp: true }, { id: 'b', bar: 20, bpm: 90, ramp: false }];
  const before = { bpm: 100, points: old };
  const plan = speedUpPoints(old, before, FOUR, opts({ from: 5, to: 9 }), id);
  const after = { bpm: 100, points: plan.points };
  // Up to the speed-up start: identical times
  for (const bar of [1, 3, 5, 7, 8]) close(barToSeconds(bar, after), barToSeconds(bar, before), 1e-9);
  // From the drop on: the same tempo, so every stretch lasts as long as before
  for (const bar of [9.5, 10, 12, 15, 20, 25]) {
    close(tempoAt(bar, after), tempoAt(bar, before), 1e-6);
    close(barToSeconds(bar, after) - barToSeconds(9, after), barToSeconds(bar, before) - barToSeconds(9, before), 1e-9);
  }
  // The points past the block are untouched
  assert.ok(plan.points.some((p) => p.id === 'a') && plan.points.some((p) => p.id === 'b'));
});

test('a tempo change inside the speed-up is replaced; the old map is left alone', () => {
  const old = [{ id: 'x', bar: 8, bpm: 90, ramp: false }];
  const plan = speedUpPoints(old, { bpm: 120, points: old }, FOUR, opts({}), id);
  assert.equal(plan.replaced, 1);
  assert.ok(!plan.points.some((p) => p.id === 'x'));
  // The snap back goes to the tempo the old map had at the drop
  assert.equal(plan.afterBpm, 90);
  assert.deepEqual(old, [{ id: 'x', bar: 8, bpm: 90, ramp: false }]);
});

test('the top tempo is held at 240 BPM, and nonsense blocks are refused', () => {
  const plan = speedUpPoints([], 200, FOUR, opts({ amount: 0.5 }), id);
  assert.equal(plan.toBpm, 240);
  assert.equal(plan.capped, true);
  assert.equal(typeof speedUpPoints([], 120, FOUR, opts({ from: 9, to: 9 }), id), 'string');
  assert.equal(typeof speedUpPoints([], 240, FOUR, opts({}), id), 'string');
  // A block from bar 1, all of it: no point at bar 1 (the song's own tempo is there)
  const whole = speedUpPoints([], 120, FOUR, opts({ from: 1, to: 3, share: 1 }), id);
  assert.ok(whole.points.every((p) => p.bar > 1));
});

test('the drum roll: 8ths, then 16ths, then 32nds, getting louder', () => {
  assert.deepEqual(rollSpans(0, 1).map((s) => [s.from, s.to, s.rate]), [[0, 0.375, 1 / 8], [0.375, 0.625, 1 / 16], [0.625, 1, 1 / 32]]);
  const hits = rollNotes(7, 8, 'D1', 1, id);
  const gaps = hits.slice(1).map((h, i) => h.startOffset - hits[i].startOffset);
  assert.equal(hits[0].startOffset, 7);
  assert.ok(gaps.every((g, i) => i === 0 || g <= gaps[i - 1] + 1e-9), 'denser');
  assert.ok(Math.min(...gaps) > 1 / 32 - 1e-6);
  assert.ok(hits.every((h, i) => i === 0 || h.velocity >= hits[i - 1].velocity), 'louder');
  assert.ok(hits.at(-1).startOffset + durationToBars(hits.at(-1).duration) <= 8 + 1e-6);
  assert.ok(hits.every((h) => h.note === 'D1'));
  // A one-beat speed-up has room only for the fast part
  assert.ok(rollSpans(0, 0.25).every((s) => s.rate < 1 / 8));
});

test('audio clips that follow the tempo are cut where they would drift', () => {
  const plan = speedUpPoints([], 120, FOUR, opts({ curve: 'build', amount: 0.5 }), id);
  const map = { bpm: 120, points: plan.points };
  const cuts = audioCuts(plan.start, 9, map, 1 / 4);
  assert.equal(cuts[0], 7);
  assert.equal(cuts.at(-1), 9);
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1];
    const b = cuts[i];
    assert.ok(b > a);
    assert.ok(b - a <= 1 / 4 + 1e-9);
    // Played at the tempo where it starts, a piece ends within 3 ms of where the music is
    const drift = Math.abs(((b - a) * 240) / tempoAt(a + 1e-6, map) - (barToSeconds(b, map) - barToSeconds(a, map)));
    assert.ok(drift <= MAX_PIECE_DRIFT + 1e-9 || b - a <= 1 / 32 + 1e-9, `${a}-${b} drifts ${drift}`);
  }
  // Fewer, longer pieces where the tempo moves slowly (the start of the curve)
  assert.ok(cuts[1] - cuts[0] > cuts.at(-1) - cuts.at(-2));
  // A steady tempo is cut on the beats
  assert.deepEqual(audioCuts(1, 2, 120, 1 / 4), [1, 1.25, 1.5, 1.75, 2]);
});
