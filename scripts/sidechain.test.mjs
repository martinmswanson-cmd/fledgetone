// Sidechains (src/store/sidechain.ts): which track a plugin may listen to, which sidechains are in
// effect, and what follows from one in project files, split exports and freezes. Run with `npm test`.
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
const sc = await import('../src/store/sidechain.ts');
const rp = await import('../src/audio/renderParts.ts');
const { freezeFingerprint } = await import('../src/store/freeze.ts');
const { serializeProject, parseProject } = await import('../src/store/project.ts');
const { withSafeIds } = await import('../src/store/ownKey.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');

const COMP = 'builtin:fledge-compressor/Fledge Compressor';
const track = (id, extra = {}) => ({ id, name: id, color: '#fff', instrumentKey: 'piano', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, reverbSend: 0, delaySend: 0, fx: defaultTrackFx(), ...extra });
const bus = (id, extra = {}) => track(id, { instrumentKey: 'bus', ...extra });
const ret = (id, extra = {}) => track(id, { instrumentKey: 'return', ...extra });
const comp = (id, sidechain, extra = {}) => ({ id, url: COMP, name: 'Fledge Compressor', ...(sidechain ? { sidechain } : {}), ...extra });
const ids = (list) => list.map((t) => t.id);

test('a plugin may listen to any other track its own sound does not go into', () => {
  const tracks = [track('kick'), track('bass', { output: 'low', sends: [{ to: 'room', level: 0.5 }], pluginFx: [comp('c')] }), bus('low', { output: 'all' }), bus('all'), ret('room'), track('pad')];
  const bass = tracks[1];
  // Not itself, its bus, its bus's bus or the return it sends to: its own sound is in those
  assert.deepEqual(ids(sc.sidechainChoices(bass, 'c', tracks)), ['kick', 'pad']);
  assert.ok(sc.canSidechain(bass, 'c', 'kick', tracks));
  for (const no of ['bass', 'low', 'all', 'room', 'gone']) assert.ok(!sc.canSidechain(bass, 'c', no, tracks), no);
  // The kick may listen to the bus the bass plays into (the kick isn't in it)
  assert.ok(sc.canSidechain(tracks[0], 'x', 'low', tracks));
});

test('two tracks cannot listen to each other, directly or round a longer loop', () => {
  const tracks = [track('a', { pluginFx: [comp('ca', 'b')] }), track('b', { pluginFx: [comp('cb')] }), track('c', { pluginFx: [comp('cc', 'a')] })];
  // b's sound goes into a (a listens to it), and a's into c: b may listen to neither
  assert.deepEqual(ids(sc.sidechainChoices(tracks[1], 'cb', tracks)), []);
  // A plugin's own sidechain doesn't count against choosing it again: a may still pick b (not c, which listens to a)
  assert.deepEqual(ids(sc.sidechainChoices(tracks[0], 'ca', tracks)), ['b']);
  // A second plugin on the same track may listen to the same track
  assert.ok(sc.canSidechain(tracks[0], 'other', 'b', tracks));
});

test('only the sidechains in effect are left on the tracks that are built', () => {
  const fine = [track('kick'), track('bass', { pluginFx: [comp('c', 'kick')] })];
  assert.equal(sc.withSidechains(fine), fine);
  assert.deepEqual(sc.sidechainSources(fine[1], fine), ['kick']);
  // A track that's gone, a bypassed plugin, and a loop from a file made by hand (both ways dropped)
  const tracks = [
    track('a', { pluginFx: [comp('1', 'gone'), comp('2', 'b'), comp('3', 'kick', { bypass: true }), comp('4', 'kick'), comp('5', 'kick')] }),
    track('b', { pluginFx: [comp('6', 'a')] }),
    track('kick'),
  ];
  const built = sc.withSidechains(tracks);
  assert.deepEqual(built[0].pluginFx.map((p) => p.sidechain ?? null), [null, null, null, 'kick', 'kick']);
  assert.deepEqual(built[1].pluginFx.map((p) => p.sidechain ?? null), [null]);
  assert.equal(built[2], tracks[2]);
  assert.deepEqual(sc.sidechainSources(tracks[0], tracks), ['kick']);
  // The song itself keeps what was chosen (the track may come back with an undo)
  assert.equal(tracks[0].pluginFx[0].sidechain, 'gone');
  const none = [track('x'), track('y', { pluginFx: [comp('c')] })];
  assert.equal(sc.withSidechains(none), none);
});

test('a sidechain survives saving and opening, and follows a renamed id', () => {
  const p = { name: 'Keyed', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, clips: [], sounds: [] };
  const tracks = [track('kick'), track('bass', { pluginFx: [comp('c', 'kick'), comp('d'), { ...comp('e'), sidechain: 7 }] })];
  const back = parseProject(JSON.parse(JSON.stringify(serializeProject({ ...p, tracks }))));
  assert.deepEqual(back.tracks.find((t) => t.id === 'bass').pluginFx.map((f) => f.sidechain), ['kick', undefined, undefined]);
  // An id that is a prototype name is renamed everywhere, the sidechain with it
  const raw = { tracks: [{ id: 'toString' }, { id: 'bass', pluginFx: [{ id: 'c', sidechain: 'toString' }] }] };
  withSafeIds(raw);
  assert.equal(raw.tracks[1].pluginFx[0].sidechain, raw.tracks[0].id);
  assert.notEqual(raw.tracks[0].id, 'toString');
});

const clipsFor = (tracks) => tracks.map((t) => ({ id: `c-${t.id}`, trackId: t.id, startBar: 1, lengthBars: 16, notes: Array.from({ length: 64 }, (_, i) => ({ pitch: 60, startOffset: i / 4, duration: '4n', velocity: 0.8 })) }));
const partOf = (parts) => new Map(parts.flatMap((p, i) => p.map((t) => [t.id, i])));

test('in a split export a track renders with the track it listens to', () => {
  const tracks = [track('kick', { instrumentKey: 'drums' }), track('bass', { pluginFx: [comp('c', 'kick')] }), track('a'), track('b'), track('c'), track('d')];
  const where = partOf(rp.renderParts(tracks, tracks, clipsFor(tracks), { startBar: 1, endBar: 17 }, 4));
  assert.equal(where.get('kick'), where.get('bass'));
  assert.ok(new Set(where.values()).size > 1, 'the others still spread out');
  // Listening to a bus: with every track that plays into it
  const bused = [track('bass', { pluginFx: [comp('c', 'drums')] }), track('kick', { output: 'drums' }), track('hat', { output: 'drums' }), bus('drums'), track('a'), track('b'), track('c')];
  const w = partOf(rp.renderParts(bused, bused.filter((t) => t.instrumentKey !== 'bus'), clipsFor(bused), { startBar: 1, endBar: 17 }, 4));
  assert.equal(w.get('bass'), w.get('kick'));
  assert.equal(w.get('bass'), w.get('hat'));
});

test('a freeze of a track goes out of date when the track it listens to changes', () => {
  const kick = track('kick', { instrumentKey: 'drums' });
  const bass = track('bass', { pluginFx: [comp('c', 'kick')] });
  const clips = clipsFor([kick, bass]);
  const all = (tracks, c = clips) => ({ tracks, clips: c, bpm: 120, swing: 0 });
  const base = freezeFingerprint(bass, all([kick, bass]));
  assert.equal(freezeFingerprint(bass, all([kick, bass])), base);
  // The kick's notes, its effects, its pan and its mute change what the bass's compressor hears
  const moved = clips.map((c) => (c.trackId === 'kick' ? { ...c, notes: c.notes.slice(1) } : c));
  assert.notEqual(freezeFingerprint(bass, all([kick, bass], moved)), base);
  assert.notEqual(freezeFingerprint(bass, all([{ ...kick, eq: { low: 6, mid: 0, high: 0 } }, bass])), base);
  assert.notEqual(freezeFingerprint(bass, all([{ ...kick, pan: -0.5 }, bass])), base);
  assert.notEqual(freezeFingerprint(bass, all([{ ...kick, isMuted: true }, bass])), base);
  // Its fader doesn't: it's heard before it
  assert.equal(freezeFingerprint(bass, all([{ ...kick, volume: -12 }, bass])), base);
  // Without the sidechain the kick is nothing to the bass, and a freeze made before sidechains stays as it was
  const plain = { ...bass, pluginFx: [comp('c')] };
  const before = freezeFingerprint(plain, all([kick, plain]));
  assert.equal(freezeFingerprint(plain, all([kick, plain], moved)), before);
  assert.notEqual(before, base);
});
