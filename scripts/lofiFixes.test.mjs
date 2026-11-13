// Fixes found making a lofi song: an instrument with its own room (the Glide Pad) starts with no reverb send, however a
// track gets it (a new track, a switch, the agent), and a switch away from it to another instrument brings its kind of
// part's send back unless the send was set by hand; saved songs keep theirs. And the Brush Kit's closed hat is raised to
// sit with the other recorded kits' hats (every loudness and take of that row, nothing else). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const K = await import('../src/store/partKind.ts');
const { makeTrack, switchedReverbSend, newTrackReverbSend, SEATED_SEND } = await import('../src/store/trackFactory.ts');
const { applyCostume } = await import('../src/store/costumes.ts');
const { applyOps } = await import('../src/agent/ops.ts');
const { createStarter } = await import('../src/store/starters.ts');
const { parseProject, serializeProject } = await import('../src/store/project.ts');
const { INSTRUMENTS, INSTRUMENT_KEYS, BRUSH_HAT_DB, seatOf } = await import('../src/audio/instrumentCatalog.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a new Glide Pad track starts with no reverb send (it has its own room); other pads still start in the room', () => {
  assert.ok(K.OWN_ROOM.has('glidePad'));
  assert.equal(K.startReverbSend('glidePad'), 0);
  assert.equal(makeTrack('glidePad', []).reverbSend, 0);
  assert.equal(makeTrack('wavetable', []).reverbSend, K.START_REVERB.pad);
  assert.equal(makeTrack('supersaw', []).reverbSend, K.START_REVERB.pad);
  assert.equal(makeTrack('lead', []).reverbSend, K.START_REVERB.lead);
});

test('switching to the Glide Pad: no send; away from it: its kind of part’s again, unless set by hand; others unchanged', () => {
  assert.equal(switchedReverbSend('wavetable', 'glidePad', 0.22), 0);
  assert.equal(switchedReverbSend('lead', 'glidePad', 0.5), 0);
  assert.equal(switchedReverbSend('glidePad', 'wavetable', 0), K.START_REVERB.pad);
  assert.equal(switchedReverbSend('glidePad', 'lead', 0), K.START_REVERB.lead);
  assert.equal(switchedReverbSend('glidePad', 'subBass', 0), K.START_REVERB.bass);
  // (a send turned up by hand on the Glide Pad stays)
  assert.equal(switchedReverbSend('glidePad', 'wavetable', 0.3), 0.3);
  // (any other switch keeps the send, as it always has)
  assert.equal(switchedReverbSend('wavetable', 'keys', 0.4), 0.4);
  assert.equal(switchedReverbSend('lead', 'wavetable', 0.18), 0.18);
  // Leaving it, what a new track of that instrument starts with, its seat in the hall included
  assert.ok(seatOf('realStrings'));
  assert.equal(switchedReverbSend('glidePad', 'realStrings', 0), SEATED_SEND);
  assert.equal(makeTrack('taiko', []).reverbSend, SEATED_SEND);
  assert.equal(switchedReverbSend('glidePad', 'taiko', 0), SEATED_SEND);
  // The studio's switch (Studio and Pocket both call it) sets it, in the same undo step as the instrument
  const store = src('src/store/timelineStore.ts');
  const body = store.slice(store.indexOf('    setTrackInstrument: (id, instrumentKey, opts) => {'), store.indexOf('    setTrackPlugin: (id, url, name, state) => {'));
  assert.match(body, /reverbSend: switchedReverbSend\(current\.instrumentKey, instrumentKey, current\.reverbSend\),/);
  assert.match(body, /updateTrack\(\s*id,[\s\S]*,\s*true\s*\);/);
});

test('leaving the Glide Pad gives every instrument exactly what a new track of it starts with', () => {
  let n = 0;
  for (const key of INSTRUMENT_KEYS) {
    const made = makeTrack(key, []).reverbSend;
    assert.equal(newTrackReverbSend(key), made, key);
    assert.equal(switchedReverbSend('glidePad', key, 0), key === 'glidePad' ? 0 : made, key);
    n++;
  }
  assert.ok(n > 200, `${n} instruments`);
});

test('a costume and a plugin put in its place follow the same rule', () => {
  const pad = { ...makeTrack('wavetable', []), id: 'p' };
  const to = applyCostume([pad], [], { id: 'c', name: 'C', tracks: { p: { instrument: 'glidePad' } } }).tracks[0];
  assert.equal(to.instrumentKey, 'glidePad');
  assert.equal(to.reverbSend, 0);
  const back = applyCostume([to], [], { id: 'c', name: 'C', tracks: { p: { instrument: 'realStrings' } } }).tracks[0];
  assert.equal(back.reverbSend, SEATED_SEND);
  const store = src('src/store/timelineStore.ts');
  const body = store.slice(store.indexOf('    setTrackPlugin: (id, url, name, state) => {'), store.indexOf('    setTrackSound: (id, sound) => {'));
  assert.match(body, /reverbSend: switchedReverbSend[(]current[.]instrumentKey, 'plugin', current[.]reverbSend[)]/);
  assert.equal(switchedReverbSend('glidePad', 'plugin', 0), makeTrack('plugin', []).reverbSend);
});

test('the agent’s set_instrument does the same', () => {
  const s = createStarter('lofi');
  const keys = s.tracks.find((t) => t.instrumentKey === 'realElectricPiano');
  assert.ok(keys.reverbSend > 0);
  const out = applyOps(s, { opsVersion: 1, ops: [{ op: 'set_instrument', trackId: keys.id, instrument: 'glidePad' }] }, { idBase: 'x' });
  assert.ok(out.ok);
  assert.equal(out.song.tracks.find((t) => t.id === keys.id).reverbSend, 0);
  const back = applyOps(out.song, { opsVersion: 1, ops: [{ op: 'set_instrument', trackId: keys.id, instrument: 'wavetable' }] }, { idBase: 'y' });
  assert.equal(back.song.tracks.find((t) => t.id === keys.id).reverbSend, K.START_REVERB.pad);
});

test('a saved song keeps the sends it has, the Glide Pad’s too', () => {
  const p = { name: 'Old', bpm: 80, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [{ ...makeTrack('glidePad', []), reverbSend: 0.4 }], clips: [] };
  assert.equal(parseProject(JSON.parse(JSON.stringify(serializeProject(p)))).tracks[0].reverbSend, 0.4);
});

test('the Brush Kit’s closed hat: every loudness and take raised, nothing else', () => {
  const s = INSTRUMENTS.brushKit.samples;
  assert.equal(BRUSH_HAT_DB, 4);
  const hats = Object.keys(s.samples).filter((k) => k.startsWith('F#1|'));
  assert.equal(hats.length, 8);
  for (const k of hats) assert.equal(s.gains[k], BRUSH_HAT_DB);
  for (const k of Object.keys(s.gains)) assert.ok(k.startsWith('F#1|'), k);
  // (the other recorded kits as they were)
  assert.equal(INSTRUMENTS.sessionKit.samples.gains, undefined);
  assert.equal(INSTRUMENTS.studioKit.samples.gains, undefined);
});
