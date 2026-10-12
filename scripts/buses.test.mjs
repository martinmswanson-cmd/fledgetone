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
