// Unit tests for splitting a mixdown into parts rendered at the same time (src/audio/renderParts.ts). Run with `npm test`.
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
const rp = await import('../src/audio/renderParts.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');

const track = (id, extra = {}) => ({ id, name: id, instrumentKey: 'piano', isMuted: false, isSoloed: false, volume: 0, pan: 0, reverbSend: 0, delaySend: 0, fx: defaultTrackFx(), ...extra });
const bus = (id, extra = {}) => track(id, { instrumentKey: 'bus', ...extra });
const ret = (id, extra = {}) => track(id, { instrumentKey: 'return', ...extra });
const withFx = (name, settings = {}) => ({ ...defaultTrackFx(), [name]: { ...defaultTrackFx()[name], on: true, ...settings } });
/** A 16-bar clip of quarter notes on each track. */
const clipsFor = (tracks) => tracks.map((t) => ({ id: `c-${t.id}`, trackId: t.id, startBar: 1, lengthBars: 16, notes: Array.from({ length: 64 }, (_, i) => ({ pitch: 60, startOffset: i / 4, duration: '4n', velocity: 0.8 })) }));
const range = { startBar: 1, endBar: 17 };

/** Which part each track ended up in, and every player placed exactly once. */
function placed(parts, players) {
  const where = new Map();
  parts.forEach((p, i) => p.forEach((t) => {
    assert.ok(!where.has(t.id), `${t.id} is in two parts`);
    where.set(t.id, i);
  }));
  assert.deepEqual([...where.keys()].sort(), players.map((t) => t.id).sort());
  return where;
}

test('independent tracks spread over the parts, each once, the buses and returns left to follow', () => {
  const tracks = [track('a'), track('b'), track('c'), track('d'), track('e'), track('f')];
  const parts = rp.renderParts(tracks, tracks, clipsFor(tracks), range, 3);
  assert.equal(parts.length, 3);
  placed(parts, tracks);
  // Balanced: two equal tracks each
  assert.deepEqual(parts.map((p) => p.length), [2, 2, 2]);
});

test('no split: one part allowed, a single track, or only one group', () => {
  const tracks = [track('a'), track('b')];
  assert.equal(rp.renderParts(tracks, tracks, clipsFor(tracks), range, 1).length, 1);
  assert.equal(rp.renderParts(tracks, [tracks[0]], clipsFor(tracks), range, 4).length, 1);
  const glued = [bus('grp', { fx: withFx('compressor') }), track('a', { output: 'grp' }), track('b', { output: 'grp' })];
  const parts = rp.renderParts(glued, glued, clipsFor(glued), range, 4);
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0].map((t) => t.id), ['a', 'b']);
});

test('tracks into a bus with a non-linear insert stay together; a linear bus is copied into each part', () => {
  for (const name of ['compressor', 'distortion', 'lofi', 'mbc']) {
    const tracks = [bus('grp', { fx: withFx(name) }), track('a', { output: 'grp' }), track('b', { output: 'grp' }), track('c'), track('d')];
    const where = placed(rp.renderParts(tracks, tracks, clipsFor(tracks), range, 4), tracks.slice(1));
    assert.equal(where.get('a'), where.get('b'), name);
  }
  // EQ, Filter, Chorus, Delay, Reverb, Gate and Pump are linear: the bus's tracks can be split
  const linear = { ...defaultTrackFx() };
  for (const name of ['filter', 'chorus', 'echo', 'reverb', 'gate', 'pump', 'peq']) linear[name] = { ...linear[name], on: true };
  const tracks = [bus('grp', { fx: linear }), track('a', { output: 'grp' }), track('b', { output: 'grp' })];
  const where = placed(rp.renderParts(tracks, tracks, clipsFor(tracks), range, 2), tracks.slice(1));
  assert.notEqual(where.get('a'), where.get('b'));
});

test('a non-linear bus anywhere down the chain holds its tracks together', () => {
  const tracks = [bus('outer', { fx: withFx('compressor') }), bus('inner', { output: 'outer' }), track('a', { output: 'inner' }), track('b', { output: 'outer' }), track('c'), track('d')];
  const where = placed(rp.renderParts(tracks, tracks, clipsFor(tracks), range, 4), tracks.slice(2));
  assert.equal(where.get('a'), where.get('b'));
});

test('a return with a non-linear insert keeps its senders together, a linear one does not', () => {
  const send = (to) => ({ sends: [{ to, level: 0.5 }] });
  const tracks = [ret('crush', { fx: withFx('distortion') }), track('a', send('crush')), track('b', send('crush')), track('c'), track('d')];
  const where = placed(rp.renderParts(tracks, tracks, clipsFor(tracks), range, 4), tracks.slice(1));
  assert.equal(where.get('a'), where.get('b'));
  const hall = [ret('hall', { fx: withFx('reverb') }), track('c', send('hall')), track('d', send('hall'))];
  const w1 = placed(rp.renderParts(hall, hall, clipsFor(hall), range, 2), hall.slice(1));
  assert.notEqual(w1.get('c'), w1.get('d'));
  // A send at level 0 still counts (automation can raise it)
  const silent = [ret('crush', { fx: withFx('compressor') }), track('a', { sends: [{ to: 'crush', level: 0 }] }), track('b', send('crush')), track('c')];
  const w2 = placed(rp.renderParts(silent, silent, clipsFor(silent), range, 3), silent.slice(1));
  assert.equal(w2.get('a'), w2.get('b'));
  // A muted return takes nothing, so it holds nothing together
  const muted = [ret('crush', { fx: withFx('compressor'), isMuted: true }), track('a', send('crush')), track('b', send('crush'))];
  const w3 = placed(rp.renderParts(muted, muted.slice(1), clipsFor(muted), range, 2), muted.slice(1));
  assert.notEqual(w3.get('a'), w3.get('b'));
});

test('a return playing into a non-linear bus joins its senders to that bus\'s tracks', () => {
  const tracks = [bus('grp', { fx: withFx('compressor') }), ret('hall', { output: 'grp' }), track('a', { output: 'grp' }), track('b', { sends: [{ to: 'hall', level: 0.3 }] }), track('c'), track('d')];
  const where = placed(rp.renderParts(tracks, tracks, clipsFor(tracks), range, 4), tracks.slice(2));
  assert.equal(where.get('a'), where.get('b'));
});

test('the Pump and ducking follow notes, not sound, so they hold nothing together', () => {
  const tracks = [track('kick', { instrumentKey: 'drums' }), track('bass', { fx: withFx('pump', { trigger: 'kick' }) }), track('pad', { fx: withFx('pump', { trigger: 'track', source: 'bass' }) }), track('voice', { duckProxy: { depth: 10 } })];
  const parts = rp.renderParts(tracks, tracks, clipsFor(tracks), range, 4);
  assert.ok(parts.length >= 3);
  placed(parts, tracks);
});

test('tracks with plugins share one part (they run as AudioWorklets, which take turns anyway)', () => {
  const plugin = { url: 'x', name: 'x' };
  const tracks = [track('a', { plugin }), track('b', { pluginFx: [plugin] }), track('c'), track('d')];
  const where = placed(rp.renderParts(tracks, tracks, clipsFor(tracks), range, 4), tracks);
  assert.equal(where.get('a'), where.get('b'));
});

test('a bus or return is non-linear with any insert not known to be linear on', () => {
  assert.equal(rp.isNonLinearMix(bus('x')), false);
  assert.equal(rp.isNonLinearMix(bus('x', { fx: withFx('filter') })), false);
  assert.equal(rp.isNonLinearMix(bus('x', { fx: withFx('compressor') })), true);
  assert.equal(rp.isNonLinearMix(bus('x', { fx: { ...defaultTrackFx(), newThing: { on: true } } })), true);
  assert.equal(rp.isNonLinearMix(bus('x', { pluginFx: [{ url: 'x', name: 'x' }] })), true);
});

test('the cost guess: held synth voices cost more than short recorded notes, and only the range counts', () => {
  const pad = track('pad', { instrumentKey: 'synthDesigner' });
  const keys = track('keys');
  const long = (t) => [{ id: 'c', trackId: t.id, startBar: 1, lengthBars: 16, notes: Array.from({ length: 16 }, (_, i) => ({ pitch: 60, startOffset: i, duration: '1m', velocity: 0.8 })) }];
  assert.ok(rp.trackCost(pad, long(pad), 1, 17) > rp.trackCost(keys, long(keys), 1, 17));
  assert.ok(rp.trackCost(keys, long(keys), 1, 5) < rp.trackCost(keys, long(keys), 1, 17));
  assert.ok(rp.trackCost(track('x', { fx: withFx('mbc') }), [], 1, 17) > rp.trackCost(track('x'), [], 1, 17));
});

test('one heavy track and a few light ones: not worth splitting, or the heavy one alone', () => {
  const heavy = track('heavy', { instrumentKey: 'synthDesigner' });
  const tracks = [heavy, track('a'), track('b')];
  const clips = [
    { id: 'h', trackId: 'heavy', startBar: 1, lengthBars: 16, notes: Array.from({ length: 64 }, (_, i) => ({ pitch: 60, startOffset: i / 4, duration: '1m', velocity: 0.8 })) },
    { id: 'a', trackId: 'a', startBar: 1, lengthBars: 1, notes: [{ pitch: 60, startOffset: 0, duration: '16n', velocity: 0.8 }] },
  ];
  const parts = rp.renderParts(tracks, tracks, clips, range, 4);
  assert.ok(parts.length <= 2);
  if (parts.length === 2) assert.ok(parts.some((p) => p.length === 1 && p[0].id === 'heavy'));
  // Only the fewest parts that do the job: the two light tracks don't each get one
  const even = [track('a'), track('b'), track('c'), track('d')];
  assert.equal(rp.renderParts(even, even, clipsFor(even), range, 4).length, 4);
});
