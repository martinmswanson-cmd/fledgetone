// A guitar's chord strummed (src/audio/guitarStrum.ts): low to high on a downstroke, high to low on the way back up, quicker when harder or shorter, the last strings a little softer, the same every time.
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

const { strumPlan, STRUMMED, STRUM_MOST, STRING_GAP_LOUD, STRING_GAP_SOFT, UPSTROKE_WITHIN } = await import('../src/audio/guitarStrum.ts');

const G = [43, 47, 50, 55, 59, 67];
const order = (plan) => plan.notes.map((n, i) => [n.delay, G[i]]).sort((a, b) => a[0] - b[0]).map(([, m]) => m);
const span = (plan) => Math.max(...plan.notes.map((n) => n.delay));

test('a single note plays as written and leaves no strum behind', () => {
  const plan = strumPlan([60], 1, 0.5, 0.8, null, 1);
  assert.deepEqual(plan.notes, [{ index: 0, delay: 0, gain: 1 }]);
  assert.equal(plan.strum, null);
});

test('a chord on its own is a downstroke: low to high, the first string at once', () => {
  const plan = strumPlan([...G].reverse(), 0, 1, 0.7, null, 5);
  assert.equal(plan.strum.down, true);
  const sorted = [...plan.notes].sort((a, b) => a.delay - b.delay);
  assert.equal(sorted[0].delay, 0);
  const pitches = sorted.map((n) => [...G].reverse()[n.index]);
  assert.deepEqual(pitches, G);
});

test('a chord soon after a downstroke is an upstroke (high to low); after a pause, down again', () => {
  const first = strumPlan(G, 0, 0.3, 0.7, null, 1);
  const up = strumPlan(G, 0.3, 0.3, 0.6, first.strum, 2);
  assert.equal(up.strum.down, false);
  assert.deepEqual(order(up), [...G].reverse());
  const next = strumPlan(G, 0.6, 0.3, 0.7, up.strum, 3);
  assert.equal(next.strum.down, true, 'after an upstroke comes a downstroke');
  const late = strumPlan(G, 0.3 + UPSTROKE_WITHIN[1] + 0.1, 0.3, 0.7, first.strum, 4);
  assert.equal(late.strum.down, true, 'a pause starts the hand down again');
  const flam = strumPlan(G, 0.02, 0.3, 0.7, first.strum, 4);
  assert.equal(flam.strum.down, true, 'two chords almost together are not a down-up');
});

test('a harder strum is quicker, and every strum fits its chord', () => {
  const soft = span(strumPlan(G, 0, 2, 0.2, null, 9));
  const hard = span(strumPlan(G, 0, 2, 1, null, 9));
  assert.ok(hard < soft, `${hard} < ${soft}`);
  assert.ok(hard >= STRING_GAP_LOUD * 5 * 0.7 && soft <= STRING_GAP_SOFT * 5 * 1.3);
  for (let seed = 0; seed < 50; seed++) assert.ok(span(strumPlan(G, seed, 4, 0.1, null, seed)) <= STRUM_MOST * 1.3 + 1e-9);
  // An eighth-note chord at 180 BPM (0.17 s) is strummed in under a quarter of it
  assert.ok(span(strumPlan(G, 0, 0.17, 0.3, null, 3)) <= 0.17 * 0.25 * 1.3);
});

test('the strings reached last are a little softer: a downstroke tilts down, an upstroke spares the top strings', () => {
  const down = strumPlan(G, 0, 1, 0.7, null, 11);
  const byTime = [...down.notes].sort((a, b) => a.delay - b.delay);
  const tilt = 20 * Math.log10(byTime[byTime.length - 1].gain / byTime[0].gain);
  assert.ok(tilt < -1 && tilt > -3, `${tilt}`);
  const up = strumPlan(G, 0.25, 1, 0.7, down.strum, 12);
  const upTime = [...up.notes].sort((a, b) => a.delay - b.delay);
  assert.ok(upTime[0].gain > upTime[upTime.length - 1].gain * 1.4);
  for (const n of [...down.notes, ...up.notes]) assert.ok(n.gain > 0.4 && n.gain < 1.2);
});

test('the same chord at the same moment strums the same way (exports repeat), another moment a little differently', () => {
  assert.deepEqual(strumPlan(G, 2, 1, 0.7, null, 77), strumPlan(G, 2, 1, 0.7, null, 77));
  assert.notDeepEqual(strumPlan(G, 2, 1, 0.7, null, 77).notes, strumPlan(G, 2, 1, 0.7, null, 78).notes);
});

test('the guitars, banjos and mandolin are strummed; a piano is not', () => {
  for (const k of ['guitar', 'realGuitar', 'realLeadGuitar', 'realNylonGuitar', 'nylonGuitar', 'realBanjo', 'mandolin']) assert.ok(STRUMMED.has(k), k);
  assert.ok(!STRUMMED.has('piano') && !STRUMMED.has('realGrandPiano'));
});

test('every strummed instrument is in the catalog', async () => {
  const { INSTRUMENTS } = await import('../src/audio/instrumentCatalog.ts');
  for (const k of STRUMMED) assert.ok(INSTRUMENTS[k], k);
});
