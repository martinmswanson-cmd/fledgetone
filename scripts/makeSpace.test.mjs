// Make space (src/store/makeSpace.ts): the parts above the bass lose their rumble, parts in the lead's range give way to it, the bass and drums are untouched.
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

const { makeSpace } = await import('../src/store/makeSpace.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');

const track = (id, instrumentKey) => ({ id, name: id, color: '#fff', instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0 });
const clip = (trackId, notes, chord = false) => ({
  id: 'c' + trackId,
  trackId,
  name: 'c',
  startBar: 1,
  lengthBars: 4,
  isSelected: false,
  notes: notes.map((note, i) => ({ id: trackId + i, note, startOffset: chord ? Math.floor(i / 3) * 0.25 : i * 0.125, duration: '8n', velocity: 0.8 })),
});

test('carves room: low cut, less in the bass octaves, a dip where the lead is', () => {
  const tracks = [track('bass', 'realElectricBass'), track('lead', 'realFlute'), track('pad', 'realStrings'), track('kit', 'drums')];
  const clips = [
    clip('bass', ['C2', 'G1', 'C2', 'A#1', 'C2', 'G1']),
    clip('lead', ['C5', 'D5', 'E5', 'G5', 'E5', 'D5', 'C5', 'A4']),
    clip('pad', ['C3', 'E3', 'G3', 'A3', 'C4', 'E4', 'F3', 'A3', 'C5', 'G2', 'B2', 'D3'], true),
    clip('kit', ['C2', 'D2', 'F#2', 'C2', 'D2', 'F#2']),
  ];
  const { tracks: out, changes } = makeSpace(tracks, clips);
  const pad = out.find((t) => t.id === 'pad');
  assert.ok(pad.fx.peq.on);
  assert.ok(pad.fx.peq.bands[0].on && pad.fx.peq.bands[0].freq >= 60, 'a low cut under its lowest note');
  assert.equal(pad.fx.peq.bands[1].gain, -2, 'thinner where the bass plays');
  assert.ok(pad.fx.peq.bands[3].gain < 0, 'out of the lead’s way');
  assert.equal(out.find((t) => t.id === 'bass'), tracks[0], 'the bass is untouched');
  assert.equal(out.find((t) => t.id === 'kit'), tracks[3], 'drums are untouched');
  assert.ok(changes.length >= 2);
});

test('a band the user moved is left alone', () => {
  const pad = track('pad', 'realStrings');
  pad.fx.peq.bands[3] = { ...pad.fx.peq.bands[3], gain: 4 };
  const tracks = [track('lead', 'realFlute'), pad];
  const clips = [clip('lead', ['C5', 'D5', 'E5', 'G5', 'E5', 'D5']), clip('pad', ['C4', 'E4', 'G4', 'C5', 'E5', 'G4'], true)];
  const out = makeSpace(tracks, clips).tracks.find((t) => t.id === 'pad');
  assert.equal(out.fx.peq.bands[3].gain, 4);
});
