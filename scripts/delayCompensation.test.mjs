// Unit tests for delay compensation (src/audio/delayCompensation.ts). Run with `npm test`.
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
const d = await import('../src/audio/delayCompensation.ts');

const off = { on: false };
const fx = (extra = {}) => ({ compressor: off, mbc: off, ...extra });
const t = (id, extra = {}) => ({ id, instrumentKey: 'piano', isMuted: false, isSoloed: false, fx: fx(), ...extra });
const comp = (id, extra = {}) => t(id, { fx: fx({ compressor: { on: true } }), ...extra });
const bus = (id, extra = {}) => t(id, { instrumentKey: 'bus', ...extra });
const ret = (id, extra = {}) => t(id, { instrumentKey: 'return', ...extra });
const N = 256;

/** Each source track's path lengths to the master (its own delay, the delays added, what each path passes through) */
function arrivals(tracks, frames = N) {
  const nodes = d.mixNodes(tracks, frames);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { delays } = d.compensateDelays(nodes);
  const of = (id) => delays.get(id) ?? { tail: 0, dry: 0, sends: {} };
  // From a strip's input to the master, along each of its paths
  const from = (id) => {
    const n = byId.get(id);
    const x = of(id);
    const base = n.own + x.tail;
    const out = n.out ? from(n.out).map((v) => base + x.dry + v) : [base + x.dry];
    for (const r of n.sends) out.push(...from(r).map((v) => base + (x.sends[r] ?? 0) + v));
    return out;
  };
  return nodes.filter((n) => n.source).map((n) => ({ id: n.id, paths: [...new Set(from(n.id))] }));
}

test('nothing compressed: no delays at all', () => {
  const tracks = [t('a'), t('b'), bus('g'), t('c', { output: 'g' }), ret('r'), t('e', { sends: [{ to: 'r', level: 0.5 }] })];
  const { total, delays } = d.compensateTracks(tracks, N);
  assert.equal(total, 0);
  assert.equal(delays.size, 0);
});

test('a compressed track: the others wait for it', () => {
  const { total, delays } = d.compensateTracks([comp('kick'), t('bass'), t('pad')], N);
  assert.equal(total, N);
  assert.equal(delays.get('kick'), undefined);
  assert.deepEqual(delays.get('bass'), { tail: N, dry: 0, sends: {} });
  assert.deepEqual(delays.get('pad'), { tail: N, dry: 0, sends: {} });
});

test('compressors in series add up; the multiband one counts once; the amp counts', () => {
  assert.equal(d.trackCompressors(t('x')), 0);
  assert.equal(d.trackCompressors(comp('x')), 1);
  assert.equal(d.trackCompressors(t('x', { fx: fx({ compressor: { on: true }, mbc: { on: true } }) })), 2);
  assert.equal(d.trackCompressors(t('x', { instrumentKey: 'realGuitar' })), 1);
  assert.equal(d.trackCompressors(bus('x', { fx: fx({ mbc: { on: true } }) })), 1);
  const { total, delays } = d.compensateTracks([t('a', { fx: fx({ compressor: { on: true }, mbc: { on: true } }) }), comp('b'), t('c')], 100);
  assert.equal(total, 200);
  assert.equal(delays.get('b').tail, 100);
  assert.equal(delays.get('c').tail, 200);
});

test('a compressed bus holds back its tracks: the rest wait, the bus itself needs nothing', () => {
  const tracks = [bus('drums', { fx: fx({ compressor: { on: true } }) }), t('kick', { output: 'drums' }), comp('snare', { output: 'drums' }), t('keys')];
  const { total, delays } = d.compensateTracks(tracks, N);
  assert.equal(total, 2 * N);
  assert.equal(delays.get('kick').tail, N);
  assert.equal(delays.get('snare'), undefined);
  assert.equal(delays.get('keys').tail, 2 * N);
  assert.equal(delays.get('drums'), undefined);
  for (const a of arrivals(tracks)) assert.deepEqual(a.paths, [2 * N], a.id);
});

test('a parallel compressor on a return: the dry sound waits for the send', () => {
  const tracks = [ret('crush', { fx: fx({ compressor: { on: true } }) }), t('drums', { sends: [{ to: 'crush', level: 1 }] }), t('bass')];
  const { total, delays } = d.compensateTracks(tracks, N);
  assert.equal(total, N);
  assert.deepEqual(delays.get('drums'), { tail: 0, dry: N, sends: {} });
  assert.deepEqual(delays.get('bass'), { tail: N, dry: 0, sends: {} });
  for (const a of arrivals(tracks)) assert.deepEqual(a.paths, [N], a.id);
});

test('a track in a compressed bus sending to a plain return: the send waits', () => {
  const tracks = [bus('g', { fx: fx({ compressor: { on: true } }) }), ret('verb'), t('a', { output: 'g', sends: [{ to: 'verb', level: 0.3 }] }), t('b')];
  const { delays } = d.compensateTracks(tracks, N);
  assert.deepEqual(delays.get('a'), { tail: 0, dry: 0, sends: { verb: N } });
  for (const a of arrivals(tracks)) assert.deepEqual(a.paths, [N], a.id);
});

test('every path of a tangled mix arrives together, and no delay is negative', () => {
  const tracks = [
    bus('top', { fx: fx({ mbc: { on: true } }) }),
    bus('mid', { output: 'top', fx: fx({ compressor: { on: true } }) }),
    ret('r1', { fx: fx({ compressor: { on: true }, mbc: { on: true } }) }),
    ret('r2', { output: 'mid' }),
    comp('a', { output: 'mid', sends: [{ to: 'r1', level: 1 }] }),
    t('b', { output: 'top', sends: [{ to: 'r2', level: 1 }, { to: 'r1', level: 1 }] }),
    t('c', { instrumentKey: 'realGuitar' }),
    t('e', { sends: [{ to: 'r2', level: 1 }] }),
  ];
  const { total, delays } = d.compensateTracks(tracks, 7);
  const all = arrivals(tracks, 7);
  assert.equal(all.length, 4);
  for (const a of all) assert.deepEqual(a.paths, [total], a.id);
  for (const x of delays.values()) {
    assert.ok(x.tail >= 0 && x.dry >= 0);
    for (const v of Object.values(x.sends)) assert.ok(v > 0);
  }
});

test('muting a track does not move the others', () => {
  const a = d.compensateTracks([comp('a'), t('b')], N);
  const b = d.compensateTracks([comp('a', { isMuted: true }), t('b')], N);
  assert.deepEqual([...a.delays], [...b.delays]);
});
