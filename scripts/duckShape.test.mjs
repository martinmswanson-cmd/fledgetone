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

test('no shape steps the gain at once: points at least 3 ms apart at any length, drawn points on one x merged', () => {
  /** The quickest change between a plan's vertices, as the shortest time any real move takes. */
  const quickest = (plan) => {
    let min = Infinity;
    for (let i = 1; i < plan.vertices.length; i++) {
      const [t0, g0] = plan.vertices[i - 1];
      const [t1, g1] = plan.vertices[i];
      if (Math.abs(g1 - g0) > 1e-6) min = Math.min(min, t1 - t0);
    }
    return min;
  };
  for (const length of [0.05, 0.1, 0.3]) {
    for (const shape of ['hard', 'tick', 'swell', 'hole']) {
      const plan = S.planShapedDuck(2, S.SHAPE_POINTS[shape], 1, length);
      assert.ok(quickest(plan) >= 0.002 - 1e-9, `${shape} at ${length * 1000} ms: ${(quickest(plan) * 1000).toFixed(2)} ms`);
    }
  }
  // Hard cut's edge at a 50 ms length: down over 3 ms, not 1
  const hard = S.planShapedDuck(0, S.SHAPE_POINTS.hard, 1, 0.05);
  assert.ok(gainAt(hard, 0.0015) > 0.45, 'half way down at 1.5 ms');
  assert.ok(gainAt(hard, 0.003) < 1e-9, 'all the way down by 3 ms');
  // At a long length it's as before (its own 2% is more than 3 ms)
  const long = S.planShapedDuck(0, S.SHAPE_POINTS.hard, 1, 0.3);
  assert.ok(Math.abs(gainAt(long, 0.003) - 0.5) < 1e-9);
  // Drawn: two points on one x (a vertical step) keep the first
  assert.deepEqual(S.normalizeDuckPoints([[0.3, 1], [0.3, 0], [0.302, 0.5], [0.6, 1]]), [[0, 0], [0.3, 1], [0.6, 1], [1, 0]]);
  const step = S.planShapedDuck(0, [[0, 0], [0.5, 1], [0.5, 0], [1, 0]], 1, 0.05);
  assert.ok(quickest(step) >= 0.003 - 1e-9, 'a vertical step as it would play is 3 ms long');
});

test("only a drum kit's real kick, snare and clap rows send drum hits: not a percussion kit's conga or claves (live, export, freeze, hit check)", async () => {
  const { pumpHitOf } = await import('../src/audio/instrumentCatalog.ts');
  const { freezeFingerprint } = await import('../src/store/freeze.ts');
  const { drumOnsets } = await import('../src/audio/hitOnsets.ts');
  assert.equal(pumpHitOf('drumMachine', 'C1'), 'kick');
  assert.equal(pumpHitOf('drumMachine', 'D1'), 'snare');
  assert.equal(pumpHitOf('drumMachine', 'D#1'), 'snare', 'the clap counts as a snare');
  assert.equal(pumpHitOf('drumMachine', 'F#1'), null);
  for (const note of ['C1', 'D1', 'D#1']) {
    assert.equal(pumpHitOf('latinPercussion', note), null, `Latin Percussion ${note}`);
    assert.equal(pumpHitOf('percussionExtras', note), null, `Percussion Extras ${note}`);
  }
  // A kit with a rimshot on the clap's row: a stroke on the snare, so it counts as one; a woodblock doesn't
  assert.equal(pumpHitOf('sessionKit', 'C1'), 'kick');
  assert.equal(pumpHitOf('sessionKit', 'D1'), 'snare');
  assert.equal(pumpHitOf('sessionKit', 'D#1'), 'snare');
  assert.equal(pumpHitOf('brushKit', 'G#2'), null);
  assert.equal(pumpHitOf('supersaw', 'C1'), null, 'a synth playing C1 is no kick');
  assert.equal(pumpHitOf(undefined, 'C1'), null);

  const fx = T.defaultTrackFx();
  const track = (id, key, extra = {}) => ({ id, name: id, color: '#888', instrumentKey: key, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx, reverbSend: 0, delaySend: 0, ...extra });
  const clip = (id, trackId, notes) => ({ id, trackId, name: id, startBar: 1, lengthBars: 1, isSelected: false, notes: notes.map(([note, at], i) => ({ id: id + i, note, startOffset: at, duration: '16n', velocity: 0.8 })) });
  const bass = track('bass', 'supersaw', { fx: { ...fx, pump: { ...fx.pump, on: true, trigger: 'kickSnare' } } });
  const perc = track('perc', 'latinPercussion');
  const all = (notes) => ({ tracks: [bass, perc], clips: [clip('p', 'perc', notes)], bpm: 120, swing: 0 });
  assert.equal(freezeFingerprint(bass, all([['C1', 0], ['D1', 0.25]])), freezeFingerprint(bass, all([['C1', 0.5], ['D#1', 0.75]])), "a conga moved doesn't change what the Pump hears");
  const tracks = [perc];
  const { kicks, snares } = drumOnsets(tracks, [clip('p', 'perc', [['C1', 0], ['D1', 0.25]])], 120, 1, 2);
  assert.deepEqual([kicks, snares], [[], []]);
});

test('a frozen drum track still sends its kicks and snares to the Pumps (live view keeps the kit it was)', async () => {
  const F = await import('../src/store/freeze.ts');
  const kits = F.pumpKitsOf([
    { id: 'drums', instrumentKey: 'audio', frozenFrom: 'drumMachine' },
    { id: 'live', instrumentKey: 'studioKit' },
    { id: 'bass', instrumentKey: 'subBass' },
    { id: 'vox', instrumentKey: 'audio' },
  ]);
  assert.deepEqual([...kits], [['drums', 'drumMachine'], ['live', 'studioKit']]);
});

test("a drawn point dragged right up against its neighbour isn't dropped", () => {
  for (let i = 0; i < 2000; i++) {
    const a = 0.02 + i * 0.00047;
    const pts = S.normalizeDuckPoints([[0, 0], [a, 0.5], [a + 0.005, 0.8], [1, 0]]);
    assert.equal(pts.length, 4, `point at ${a} kept`);
  }
});
