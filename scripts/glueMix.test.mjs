// Glue (src/store/glueMix.ts): switched on it ties the parts into one mix and records what it changed; switched off it puts that back, keeping anything changed by hand since.
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

const { applyGlue, removeGlue } = await import('../src/store/glueMix.ts');
const { defaultTrackFx, normalizeMasterSettings, defaultMasterSettings } = await import('../src/store/timelineTypes.ts');

const track = (id, instrumentKey, extra = {}) => ({ id, name: id, color: '#fff', instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0, ...extra });
const clip = (trackId, notes, chord = false) => ({
  id: 'c' + trackId,
  trackId,
  name: 'c',
  startBar: 1,
  lengthBars: 4,
  isSelected: false,
  notes: notes.map((note, i) => ({ id: trackId + i, note, startOffset: chord ? Math.floor(i / 3) * 0.25 : i * 0.125, duration: '8n', velocity: 0.8 })),
});
let buses = 0;
const newBus = (name) => track('bus' + ++buses, 'bus', { name });

const song = () => {
  const tracks = [track('kit', 'drums'), track('snare', 'studioKit'), track('bass', 'realElectricBass'), track('lead', 'realFlute'), track('pad', 'realStrings'), track('arp', 'pluck'), track('riser', 'fx')];
  const clips = [
    clip('kit', ['C2', 'D2', 'F#2', 'C2', 'D2', 'F#2']),
    clip('snare', ['D2', 'D2', 'D2', 'D2']),
    clip('bass', ['C2', 'G1', 'C2', 'A#1', 'C2', 'G1']),
    clip('lead', ['C5', 'D5', 'E5', 'G5', 'E5', 'D5', 'C5', 'A4', 'G4', 'A4']),
    clip('pad', ['C3', 'E3', 'G3', 'A3', 'C4', 'E4', 'F3', 'A3', 'C5'], true),
    clip('arp', ['C4', 'E4', 'G4', 'C5', 'G4', 'E4', 'C4', 'E4'], true),
    clip('riser', ['C4']),
  ];
  return { tracks, clips };
};

test('glue on: buses, the bass ducks, one room, the parts spread, the lead stays in front', () => {
  const { tracks, clips } = song();
  const { tracks: out, record } = applyGlue(tracks, clips, newBus);
  const by = (id) => out.find((t) => t.id === id);
  const drumBus = out.find((t) => t.name === 'Drum bus'), musicBus = out.find((t) => t.name === 'Music bus');
  assert.ok(drumBus && musicBus, 'a drum bus and a music bus');
  assert.deepEqual(record.buses, [drumBus.id, musicBus.id]);
  assert.equal(by('kit').output, drumBus.id);
  assert.equal(by('snare').output, drumBus.id);
  assert.equal(by('lead').output, musicBus.id);
  assert.equal(by('bass').output, undefined, 'the bass stays on the master');
  assert.ok(musicBus.fx.pump.on && musicBus.fx.pump.trigger === 'kick', 'the music bus breathes with the kick');
  assert.ok(by('bass').fx.pump.on, 'the bass ducks under the kick');
  assert.equal(by('pad').reverbSend, 0.2);
  assert.equal(by('kit').reverbSend, 0.1);
  assert.equal(by('lead').pan, 0, 'the lead stays in the middle');
  assert.notEqual(by('pad').pan, 0);
  assert.equal(by('pad').pan, -by('arp').pan, 'spread either side');
  assert.equal(by('riser'), tracks.find((t) => t.id === 'riser'), 'effects are left alone');
});

test('glue off puts back everything it changed', () => {
  const { tracks, clips } = song();
  const { tracks: on, record } = applyGlue(tracks, clips, newBus);
  const off = removeGlue(on, record);
  assert.deepEqual(off, tracks);
});

test('glue off keeps what was changed by hand since', () => {
  const { tracks, clips } = song();
  const { tracks: on, record } = applyGlue(tracks, clips, newBus);
  const musicBus = on.find((t) => t.name === 'Music bus');
  const edited = on.map((t) => (t.id === 'pad' ? { ...t, pan: 0.6 } : t.id === 'riser' ? { ...t, output: musicBus.id } : t));
  const off = removeGlue(edited, record);
  assert.equal(off.find((t) => t.id === 'pad').pan, 0.6, 'a pan moved by hand stays');
  assert.equal(off.find((t) => t.id === 'pad').reverbSend, 0, 'the rest of the pad is put back');
  assert.equal(off.find((t) => t.id === 'riser').output, undefined, 'a track put on a glue bus by hand goes back to the master');
  assert.ok(!off.some((t) => t.name === 'Music bus' || t.name === 'Drum bus'), 'the buses are gone');
});

test('a reverb send already higher is never lowered, and a track already on a bus stays there', () => {
  const { tracks, clips } = song();
  const mine = track('myBus', 'bus');
  const t2 = [...tracks.map((t) => (t.id === 'pad' ? { ...t, reverbSend: 0.5 } : t.id === 'arp' ? { ...t, output: 'myBus' } : t)), mine];
  const { tracks: out } = applyGlue(t2, clips, newBus);
  assert.equal(out.find((t) => t.id === 'pad').reverbSend, 0.5);
  assert.equal(out.find((t) => t.id === 'arp').output, 'myBus');
});

test('the record survives saving and loading with the master settings', () => {
  const { tracks, clips } = song();
  const { record } = applyGlue(tracks, clips, newBus);
  const loaded = normalizeMasterSettings(JSON.parse(JSON.stringify({ ...defaultMasterSettings(), glueMix: record })));
  assert.deepEqual(loaded.glueMix, JSON.parse(JSON.stringify(record)));
  assert.equal(normalizeMasterSettings(defaultMasterSettings()).glueMix, undefined);
});

test('tracks named as the lead (and its layers) stay in the middle', () => {
  const { tracks, clips } = song();
  const named = tracks.map((t) => (t.id === 'pad' ? { ...t, name: 'Lead layer' } : t));
  const { tracks: out } = applyGlue(named, clips, newBus);
  assert.equal(out.find((t) => t.id === 'pad').pan, 0);
});
