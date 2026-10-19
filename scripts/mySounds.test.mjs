// Unit tests for favourite instruments and saved sounds (mySounds.ts): what a saved sound keeps,
// putting it on a track, and reading it back. Run with `npm test`.
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
// A stand-in for the browser's storage
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };
const { soundOf, withSound, parseSound, useMySounds } = await import('../src/store/mySounds.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');
const { presetPatch, SYNTH_PRESETS } = await import('../src/store/synthPatch.ts');

const track = (id, instrumentKey, extra = {}) => ({ id, name: id, color: '#fff', instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0, ...extra });

test("a saved sound keeps the instrument's settings but not the track's level, pan, routing or name", () => {
  const synth = presetPatch(SYNTH_PRESETS[1].id);
  const t = track('lead', 'synthDesigner', { synth, volume: -6, pan: 0.5, output: 'bus1', ring: 4, eq: { low: 2, mid: 0, high: -1 }, reverbSend: 0.4 });
  const s = soundOf(t);
  assert.deepEqual(s.synth, synth);
  assert.equal(s.ring, 4);
  assert.equal(s.reverbSend, 0.4);
  assert.deepEqual(s.eq, { low: 2, mid: 0, high: -1 });
  for (const f of ['volume', 'pan', 'output', 'name', 'id', 'isMuted']) assert.equal(f in s, false, f);
});

test('putting a sound on a track replaces its sound, keeps its mix, and gives its plugins new ids', () => {
  const saved = soundOf(track('jx', 'plugin', { plugin: { id: 'p1', url: 'builtin:mda/jx10', name: 'JX10', state: { knobs: [1, 2, 3] } }, pluginFx: [{ id: 'p2', url: 'builtin:air/x', name: 'X' }] }));
  const target = track('t', 'realGrandPiano', { volume: -3, pan: -0.2, ring: 12, output: 'bus1' });
  const next = withSound(target, saved);
  assert.equal(next.instrumentKey, 'plugin');
  assert.deepEqual(next.plugin.state, { knobs: [1, 2, 3] });
  assert.notEqual(next.plugin.id, 'p1');
  assert.notEqual(next.pluginFx[0].id, 'p2');
  // The piano's ring isn't in the sound, so it goes; the mix stays
  assert.equal(next.ring, undefined);
  assert.equal(next.volume, -3);
  assert.equal(next.pan, -0.2);
  assert.equal(next.output, 'bus1');
  assert.equal(next.id, 't');
  // ...and the saved sound itself is untouched
  assert.equal(saved.plugin.id, 'p1');
});

test('stored sounds are checked when read: bad ones are dropped, values clamped', () => {
  const ok = parseSound({ id: 's1', name: 'Long piano', settings: soundOf(track('x', 'realGrandPiano', { ring: 999 })) });
  assert.equal(ok.settings.ring, 30);
  assert.equal(parseSound({ id: 's2', name: 'Bus', settings: soundOf(track('x', 'bus')) }), null);
  assert.equal(parseSound({ id: 's3', name: 'Nothing', settings: { instrumentKey: 'notAnInstrument' } }), null);
  assert.equal(parseSound({ id: 's4', name: '', settings: soundOf(track('x', 'realGrandPiano')) }), null);
  assert.equal(parseSound({ id: 's5', name: 'Plugin without its plugin', settings: soundOf(track('x', 'plugin')) }), null);
  assert.equal(parseSound('junk'), null);
});

test('favourites toggle, and saving under a name already used updates that sound', () => {
  const st = useMySounds.getState();
  st.toggleFavourite('realCello');
  assert.deepEqual(useMySounds.getState().favourites, ['realCello']);
  useMySounds.getState().toggleFavourite('realCello');
  assert.deepEqual(useMySounds.getState().favourites, []);
  assert.equal(useMySounds.getState().saveSound('Pad', track('a', 'realCello', { ring: 5 })), 'saved');
  assert.equal(useMySounds.getState().saveSound(' pad ', track('a', 'realCello', { ring: 9 })), 'replaced');
  const [pad] = useMySounds.getState().sounds;
  assert.equal(useMySounds.getState().sounds.length, 1);
  assert.equal(pad.settings.ring, 9);
  // Kept in storage, and read back the same
  const back = JSON.parse(stored.get('fledgetone.mySounds')).map(parseSound);
  assert.deepEqual(back, useMySounds.getState().sounds);
  useMySounds.getState().removeSound(pad.id);
  assert.equal(useMySounds.getState().sounds.length, 0);
});
