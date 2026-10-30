// Unit tests for group bus routing (src/store/buses.ts). Run with `npm test`.
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
const b = await import('../src/store/buses.ts');

const t = (id, extra = {}) => ({ id, instrumentKey: 'piano', isMuted: false, isSoloed: false, ...extra });
const bus = (id, extra = {}) => t(id, { instrumentKey: 'bus', ...extra });

test('a track plays into its bus, and buses into buses', () => {
  const tracks = [bus('drums'), bus('music'), t('kick', { output: 'drums' }), t('snare', { output: 'drums' }), t('keys', { output: 'music' }), { ...bus('drums2'), output: 'drums' }, t('hat', { output: 'drums2' })];
  assert.equal(b.busOf(tracks[2], tracks).id, 'drums');
  assert.deepEqual(b.busChain(tracks[6], tracks).map((x) => x.id), ['drums2', 'drums']);
  // Not into a track that isn't a bus, nor one that's gone
  assert.equal(b.busOf(t('x', { output: 'kick' }), tracks), undefined);
  assert.equal(b.busOf(t('x', { output: 'nope' }), tracks), undefined);
});

test('no loops', () => {
  const tracks = [bus('a', { output: 'b' }), bus('b'), t('k', { output: 'a' })];
  assert.equal(b.wouldLoop('b', 'a', tracks), true);
  assert.equal(b.wouldLoop('a', 'a', tracks), true);
  assert.equal(b.wouldLoop('k', 'b', tracks), false);
  assert.deepEqual(b.busTargets(tracks[1], tracks).map((x) => x.id), []);
  assert.deepEqual(b.busTargets(tracks[2], tracks).map((x) => x.id), ['a', 'b']);
  // A loop in a file is cut
  const looped = [bus('a', { output: 'b' }), bus('b', { output: 'a' })];
  const tidy = b.tidyRoutes(looped);
  assert.ok(tidy.some((x) => !x.output));
  assert.equal(b.tidyRoutes(tracks), tracks);
});

test('solo through buses: a soloed bus lets its tracks through; a soloed track lets its bus through', () => {
  const tracks = [bus('drums'), t('kick', { output: 'drums' }), t('keys')];
  assert.equal(b.soloLit(tracks), null);
  const soloBus = tracks.map((x) => (x.id === 'drums' ? { ...x, isSoloed: true } : x));
  assert.deepEqual([...b.audibleIds(soloBus)].sort(), ['drums', 'kick']);
  const soloKick = tracks.map((x) => (x.id === 'kick' ? { ...x, isSoloed: true } : x));
  assert.deepEqual([...b.audibleIds(soloKick)].sort(), ['drums', 'kick']);
  const muteBus = tracks.map((x) => (x.id === 'drums' ? { ...x, isMuted: true } : x));
  assert.deepEqual([...b.audibleIds(muteBus)].sort(), ['keys']);
});

test('buses come first, outermost first', () => {
  const tracks = [t('kick', { output: 'inner' }), bus('inner', { output: 'outer' }), bus('outer')];
  assert.deepEqual(b.busFirst(tracks).map((x) => x.id), ['outer', 'inner', 'kick']);
});

test('returns: sends, solo-safe, render order, tidy', () => {
  const tr = (id, key, extra = {}) => ({ id, instrumentKey: key, isMuted: false, isSoloed: false, ...extra });
  const tracks = [
    tr('a', 'lead', { sends: [{ to: 'r', level: 0.5 }, { to: 'gone', level: 1 }, { to: 'r', level: 0.2 }] }),
    tr('b', 'bass', { isSoloed: true }),
    tr('r', 'return', { sends: [{ to: 'r', level: 1 }] }),
    tr('g', 'bus'),
  ];
  assert.deepEqual(b.liveSends(tracks[0], tracks), [{ to: 'r', level: 0.5 }]);
  assert.deepEqual(b.sendTargets(tracks[0], tracks).map((t) => t.id), ['r']);
  assert.deepEqual(b.sendTargets(tracks[2], tracks), []);
  // A solo leaves the return on
  assert.ok(b.audibleIds(tracks).has('r'));
  assert.ok(!b.audibleIds(tracks).has('a'));
  assert.deepEqual(b.busFirst(tracks).map((t) => t.id), ['g', 'r', 'a', 'b']);
  const tidy = b.tidySends(tracks);
  assert.deepEqual(tidy[0].sends, [{ to: 'r', level: 0.5 }]);
  assert.equal(tidy[2].sends, undefined);
});

// Outputs and sends are one graph: a return playing into a bus that sends to it would feed back
const ret = (id, extra = {}) => t(id, { instrumentKey: 'return', ...extra });

/** Every route that plays (outputs into buses, live sends into returns); true when they form a loop. */
function hasLoop(tracks) {
  const byId = new Map(tracks.map((x) => [x.id, x]));
  const outs = (x) => [...(b.busOf(x, tracks) && !b.busChain(b.busOf(x, tracks), tracks).some((o) => o.id === x.id) ? [x.output] : []), ...b.liveSends(x, tracks).map((s) => s.to)];
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const n of outs(byId.get(id))) if (visit(n)) return true;
    state.set(id, 2);
    return false;
  };
  return tracks.some((x) => visit(x.id));
}
/** The same, from the raw fields (what a file says), with no guard. */
function rawLoop(tracks) {
  const ids = new Map(tracks.map((x) => [x.id, x]));
  const outs = (x) => [...(x.output && ids.get(x.output) && b.isBus(ids.get(x.output)) ? [x.output] : []), ...(b.isReturn(x) ? [] : (x.sends ?? []).filter((s) => ids.get(s.to) && b.isReturn(ids.get(s.to))).map((s) => s.to))].filter((n) => n !== x.id);
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const n of outs(ids.get(id))) if (visit(n)) return true;
    state.set(id, 2);
    return false;
  };
  return tracks.some((x) => visit(x.id));
}

test('a return into a bus that sends to it: refused both ways, and cut on load', () => {
  const tracks = [t('lead', { output: 'b1' }), bus('b1', { sends: [{ to: 'r1', level: 1 }] }), ret('r1')];
  // The return can't play into the bus that feeds it
  assert.equal(b.wouldLoop('r1', 'b1', tracks), true);
  assert.deepEqual(b.busTargets(tracks[2], tracks).map((x) => x.id), []);
  assert.deepEqual(b.loopingBuses(tracks[2], tracks).map((x) => x.id), ['b1']);
  // The other way round: a return already playing into the bus, the bus can't send to it
  const other = [t('lead', { output: 'b1' }), bus('b1'), ret('r1', { output: 'b1' })];
  assert.equal(b.sendWouldLoop('b1', 'r1', other), true);
  assert.deepEqual(b.sendTargets(other[1], other).map((x) => x.id), []);
  assert.deepEqual(b.loopingReturns(other[1], other).map((x) => x.id), ['r1']);
  assert.deepEqual(b.sendTargets(other[0], other).map((x) => x.id), ['r1']);
  // A file with the loop: the send that closes it goes, with its lane and MIDI knob; the output stays
  const looped = [
    t('lead', { output: 'b1' }),
    bus('b1', { sends: [{ to: 'r1', level: 1 }], automation: [{ param: 'send:r1', points: [] }, { param: 'volume', points: [] }], midiMap: [{ cc: 20, param: 'send:r1' }] }),
    ret('r1', { output: 'b1' }),
  ];
  assert.deepEqual(b.liveSends(looped[1], looped), []);
  const fixed = b.breakLoops(looped);
  assert.equal(fixed[1].sends, undefined);
  assert.deepEqual(fixed[1].automation.map((l) => l.param), ['volume']);
  assert.equal(fixed[1].midiMap, undefined);
  assert.equal(fixed[2].output, 'b1');
  assert.equal(hasLoop(looped), false);
  assert.equal(rawLoop(fixed), false);
  // No loop: the very same array
  assert.equal(b.breakLoops(tracks), tracks);
  assert.equal(b.breakLoops(other), other);
});

test('a longer loop through two buses and two returns', () => {
  // r1 → b2 → send r2 → b1 → send r1
  const tracks = [bus('b1', { sends: [{ to: 'r1', level: 1 }] }), bus('b2', { sends: [{ to: 'r2', level: 1 }] }), ret('r1', { output: 'b2' }), ret('r2', { output: 'b1' })];
  assert.equal(rawLoop(tracks), true);
  assert.equal(hasLoop(tracks), false);
  // In track order: b1's send is kept, b2's (which closes the loop) is cut
  const fixed = b.breakLoops(tracks);
  assert.deepEqual(fixed[0].sends, [{ to: 'r1', level: 1 }]);
  assert.equal(fixed[1].sends, undefined);
  assert.equal(b.wouldLoop('r2', 'b1', fixed.map((x) => (x.id === 'r2' ? { ...x, output: undefined } : x))), false);
  assert.equal(b.sendWouldLoop('b2', 'r2', fixed), true);
});

/** A small seeded random number generator, so a failure repeats. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test('random routings: no loop survives, on load or in what plays', () => {
  let looped = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    const pick = (list) => list[Math.floor(r() * list.length)];
    const n = 3 + Math.floor(r() * 8);
    const kinds = Array.from({ length: n }, () => pick(['piano', 'bus', 'bus', 'return', 'return']));
    const ids = kinds.map((_, i) => `x${i}`);
    const tracks = kinds.map((k, i) => {
      const extra = { instrumentKey: k };
      if (r() < 0.7) extra.output = pick(ids);
      if (k !== 'return' && r() < 0.8) extra.sends = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ to: pick(ids), level: 0.5 }));
      return t(ids[i], extra);
    });
    // What plays never loops, whatever the file says
    if (rawLoop(tracks)) looped++;
    assert.equal(hasLoop(tracks), false, `seed ${seed}: what plays loops`);
    const fixed = b.breakLoops(tracks);
    assert.equal(rawLoop(fixed), false, `seed ${seed}: a loop survived breakLoops`);
    assert.deepEqual(b.breakLoops(fixed), fixed, `seed ${seed}: breakLoops not settled`);
    // Every output that isn't a loop of outputs alone is kept
    for (const [i, x] of tracks.entries()) {
      const bus0 = b.busOf(x, tracks);
      if (bus0 && !b.busChain(bus0, tracks).some((o) => o.id === x.id)) assert.equal(fixed[i].output, x.output, `seed ${seed}: an output was dropped`);
    }
    // A loop-free file's sends all play
    if (!rawLoop(tracks)) assert.equal(fixed, b.breakLoops(tracks));
  }
  // (Plenty of them had a loop to cut)
  assert.ok(looped > 40, `only ${looped} of the random routings had a loop`);
});

test('random menu clicks: what the menus offer never makes a loop', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed);
    const pick = (list) => list[Math.floor(r() * list.length)];
    let tracks = Array.from({ length: 6 + Math.floor(r() * 4) }, (_, i) => t(`x${i}`, { instrumentKey: pick(['piano', 'bus', 'return']) }));
    for (let step = 0; step < 40; step++) {
      const x = pick(tracks);
      if (r() < 0.5) {
        const offer = b.busTargets(x, tracks);
        // Every bus is either offered or greyed as a loop (or is the track itself)
        assert.equal(offer.length + b.loopingBuses(x, tracks).length, tracks.filter((o) => b.isBus(o) && o.id !== x.id).length + (offer.some((o) => o.id === x.id) ? 1 : 0));
        if (offer.length) {
          const to = pick(offer).id;
          tracks = tracks.map((o) => (o.id === x.id ? { ...o, output: to } : o));
        }
      } else {
        const offer = b.sendTargets(x, tracks);
        if (offer.length) {
          const to = pick(offer).id;
          tracks = tracks.map((o) => (o.id === x.id ? { ...o, sends: [...(o.sends ?? []).filter((s) => s.to !== to), { to, level: 0.5 }] } : o));
        }
      }
      assert.equal(rawLoop(tracks), false, `seed ${seed} step ${step}: the menus made a loop`);
      assert.equal(b.breakLoops(tracks), tracks);
    }
  }
});
