// The Pump's duck shapes (src/audio/effects/duckShape.ts), the drum hits a Pump hears
// (pumpHears in timelineTypes.ts) and Duck to kick's styles (src/store/duckToKick.ts). Run with `npm test`.
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

const S = await import('../src/audio/effects/duckShape.ts');
const T = await import('../src/store/timelineTypes.ts');

const dbOf = (g) => 20 * Math.log10(g);
/** The gain of a plan at time t (s). */
const gainAt = (plan, t) => S.verticesGain(plan.vertices, t);

test('Hole for drums: down 18 dB within 25 ms, held 50-100 ms, back by its length', () => {
  const depth = S.depthOfDb(-18);
  const plan = S.planShapedDuck(1, S.SHAPE_POINTS.hole, depth, 0.15);
  assert.equal(gainAt(plan, 1), 1, 'starts at full volume');
  // Reaches the floor within 25 ms
  const floorAt = plan.vertices.find(([, g]) => g <= 1 - depth + 1e-9)[0] - 1;
  assert.ok(floorAt <= 0.025, `floor reached at ${(floorAt * 1000).toFixed(1)} ms`);
  // Held at the floor (within 0.5 dB) for 50-100 ms
  let held = 0;
  for (let t = 0; t < 0.15; t += 0.0005) if (dbOf(gainAt(plan, 1 + t)) <= -17.5) held += 0.0005;
  assert.ok(held >= 0.05 && held <= 0.1, `held ${(held * 1000).toFixed(0)} ms`);
  assert.ok(Math.abs(dbOf(gainAt(plan, 1.05)) + 18) < 0.01, 'depth is the Pump depth');
  assert.equal(gainAt(plan, 1.151), 1, 'back by its length');
});

test('every preset starts and ends at full volume, never goes under its depth, and Smooth has no points', () => {
  assert.equal(S.shapePoints(undefined), null);
  assert.equal(S.shapePoints('smooth'), null);
  assert.equal(S.shapePoints('drawn'), null, 'drawn without points plays Smooth');
  for (const shape of ['hard', 'tick', 'swell', 'hole']) {
    const pts = S.shapePoints(shape);
    assert.deepEqual(pts[0], [0, 0], shape);
    assert.deepEqual(pts[pts.length - 1], [1, 0], shape);
    const plan = S.planShapedDuck(0, pts, 0.5, 0.2);
    for (let t = 0; t <= 0.25; t += 0.001) {
      const g = gainAt(plan, t);
      assert.ok(g >= 0.5 - 1e-9 && g <= 1, `${shape} at ${t}`);
    }
    assert.equal(gainAt(plan, 0.21), 1);
  }
  // Short tick is back long before Long swell
  const tick = S.planShapedDuck(0, S.SHAPE_POINTS.tick, 0.5, 0.3);
  const swell = S.planShapedDuck(0, S.SHAPE_POINTS.swell, 0.5, 0.3);
  assert.ok(gainAt(tick, 0.15) > 0.99 && gainAt(swell, 0.15) < 0.85);
});

test('a duck during another follows the lower of the two: no jump up, the earlier one carried on past its end', () => {
  const first = S.planShapedDuck(0, S.SHAPE_POINTS.swell, 0.6, 0.4);
  const at = 0.05;
  const before = (t) => gainAt(first, t);
  const times = first.vertices.map(([t]) => t).filter((t) => t > at);
  const second = S.planShapedDuck(at, S.SHAPE_POINTS.tick, 0.3, 0.1, before, times);
  // Continuous where it starts
  assert.ok(Math.abs(gainAt(second, at) - before(at)) < 1e-9);
  // Never above either duck (within the straight-line approximation of the crossing)
  for (let t = at; t < 0.45; t += 0.001) {
    assert.ok(gainAt(second, t) <= before(t) + 0.01, `t ${t}`);
  }
  // After the short tick, the long swell is still coming back
  assert.ok(Math.abs(gainAt(second, 0.3) - before(0.3)) < 0.01);
  assert.equal(gainAt(second, 0.41), 1);
});

test('drawn points are made safe: in order, clamped, starting and ending at full volume', () => {
  assert.deepEqual(S.normalizeDuckPoints([[0.5, 2], [0.2, 0.5], [1.5, 1], ['x', 1]]), [[0, 0], [0.2, 0.5], [0.5, 1], [1, 0]]);
  assert.equal(S.normalizeDuckPoints('nope'), undefined);
  assert.equal(S.normalizeDuckPoints([[0, 1], [1, 1]]), undefined);
  const many = Array.from({ length: 40 }, (_, i) => [(i + 1) / 42, 0.5]);
  assert.equal(S.normalizeDuckPoints(many).length, S.MAX_DUCK_POINTS);
});

test('old Pumps open as they were; shapes and the snare triggers are kept', () => {
  const old = T.normalizeTrackFx({ pump: { on: true, depth: 0.7, release: 300, trigger: 'kick' } }).pump;
  assert.deepEqual(old, { on: true, depth: 0.7, release: 300, trigger: 'kick' });
  const shaped = T.normalizeTrackFx({ pump: { on: true, depth: 0.9, release: 150, trigger: 'kickSnare', shape: 'hole' } }).pump;
  assert.equal(shaped.trigger, 'kickSnare');
  assert.equal(shaped.shape, 'hole');
  const drawn = T.normalizeTrackFx({ pump: { on: true, depth: 0.5, release: 200, trigger: 'snare', shape: 'drawn', points: [[0.1, 1]] } }).pump;
  assert.deepEqual(drawn.points, [[0, 0], [0.1, 1], [1, 0]]);
  assert.equal(T.normalizeTrackFx({ pump: { shape: 'wobbly', trigger: 'cowbell' } }).pump.shape, undefined);
  assert.equal(T.normalizeTrackFx({ pump: { shape: 'smooth' } }).pump.shape, undefined, 'Smooth is the absent shape');
});

test('kick, snare and kick+snare triggers hear the right drum hits', () => {
  assert.equal(T.pumpHears('kick', 'kick'), true);
  assert.equal(T.pumpHears('kick', 'snare'), false);
  assert.equal(T.pumpHears('snare', 'snare'), true);
  assert.equal(T.pumpHears('snare', 'kick'), false);
  assert.equal(T.pumpHears('kickSnare', 'kick'), true);
  assert.equal(T.pumpHears('kickSnare', 'snare'), true);
  assert.equal(T.pumpHears('beat', 'kick'), false);
  assert.equal(T.pumpHears('track', 'snare'), false);
  assert.equal(T.pumpFollowsDrums('kickSnare'), true);
  assert.equal(T.pumpFollowsDrums('eighth'), false);
});

test('Duck to kick by style: a hole on kick and snare in the bass, the chords 5-7 dB (pumping), at most 3 dB (future bass), back within 130-230 ms', async () => {
  const D = await import('../src/store/duckToKick.ts');
  const db = (d) => 20 * Math.log10(1 - d);
  for (const style of D.DUCK_STYLES) {
    for (const bpm of [100, 128, 145, 175]) {
      const bass = D.duckPump('bass', style, bpm);
      assert.equal(bass.trigger, 'kickSnare');
      assert.equal(bass.shape, 'hole');
      assert.ok(db(bass.depth) <= -10 && db(bass.depth) >= -20.5, `${style} bass ${db(bass.depth)}`);
      const music = D.duckPump('music', style, bpm);
      assert.equal(music.trigger, 'kick');
      assert.equal(music.shape, undefined, 'the music parts pump Smooth');
      assert.ok(music.release >= 130 && music.release <= 230, `${style} at ${bpm}: ${music.release}`);
      if (style === 'pumping') assert.ok(db(music.depth) <= -5 && db(music.depth) >= -7.01);
      if (style === 'future') assert.ok(db(music.depth) >= -3);
    }
  }
  assert.equal(D.duckStyleFor('futurebass'), 'future');
  assert.equal(D.duckStyleFor('dubstep'), 'bass');
  assert.equal(D.duckStyleFor('darksynth'), 'pumping');
});
