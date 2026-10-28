// Make space (src/store/makeSpace.ts): the parts above the bass lose their rumble and a little of their low mids, parts in the lead's range give way to it, the lead gets a little presence, a bass over a sub gives a little in the low mids; a lone bass and the drums are untouched.
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

const { makeSpace, LOW_MID_HZ, LOW_MID_DB, PRESENCE_HZ, PRESENCE_DB, BASS_MUD_DB } = await import('../src/store/makeSpace.ts');
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

test('a synth patch that sounds an octave under its notes keeps its fundamental', () => {
  // Written from A3 (220 Hz), but one plays its oscillator an octave down and the other has a sub
  // an octave down: both sound from 110 Hz
  const osc = (on, octave) => ({ on, wave: 'sawtooth', octave, semi: 0, fine: 0, level: on ? 0.8 : 0 });
  const hoover = { ...track('hoover', 'synthDesigner'), synth: { osc1: osc(true, -1), osc2: osc(false, 0), sub: 0 } };
  const subby = { ...track('sub', 'synthDesigner'), synth: { osc1: osc(true, 0), osc2: osc(false, 0), sub: 0.5 } };
  const tracks = [track('lead', 'realFlute'), hoover, subby];
  const notes = ['A3', 'C4', 'E4', 'A3', 'C4', 'E4'];
  const clips = [clip('lead', ['C5', 'D5', 'E5', 'G5', 'E5', 'D5']), clip('hoover', notes), clip('sub', notes)];
  const out = makeSpace(tracks, clips).tracks;
  for (const id of ['hoover', 'sub']) {
    const cut = out.find((t) => t.id === id).fx.peq.bands[0];
    assert.ok(!cut.on || cut.freq < 110, `${id}: low cut at ${cut.freq} Hz`);
  }
});

test('the low mids: parts under middle D give a little at 280 Hz, the lead keeps its body and gets presence', () => {
  const tracks = [track('bass', 'realElectricBass'), track('lead', 'realFlute'), track('stabs', 'realStrings'), track('high', 'realStrings')];
  const clips = [
    clip('bass', ['C2', 'G1', 'C2', 'A#1', 'C2', 'G1']),
    clip('lead', ['C5', 'D5', 'E5', 'G5', 'E5', 'D5', 'C5', 'A4']),
    clip('stabs', ['G3', 'C4', 'E4', 'A3', 'C4', 'E4', 'F3', 'A3', 'C4'], true),
    clip('high', ['E5', 'G5', 'C6', 'F5', 'A5', 'C6'], true),
  ];
  const out = makeSpace(tracks, clips).tracks;
  const stabs = out.find((t) => t.id === 'stabs').fx.peq.bands[2];
  assert.deepEqual([stabs.type, stabs.freq, stabs.gain], ['bell', LOW_MID_HZ, LOW_MID_DB]);
  assert.ok(LOW_MID_DB < 0 && LOW_MID_DB >= -3, 'a gentle cut');
  assert.equal(out.find((t) => t.id === 'high').fx.peq.bands[2].gain, 0, 'a part over the low mids keeps them');
  const lead = out.find((t) => t.id === 'lead').fx.peq.bands;
  assert.equal(lead[2].gain, 0, 'the lead keeps its body');
  assert.deepEqual([lead[4].type, lead[4].freq, lead[4].gain], ['highshelf', PRESENCE_HZ, PRESENCE_DB]);
  assert.ok(PRESENCE_DB > 0 && PRESENCE_DB <= 2, 'a gentle lift');
  assert.equal(out.find((t) => t.id === 'bass'), tracks[0], 'a bass alone is untouched');
});

test('a bass over a sub gives a little where its harmonics thicken the low mids; the sub is untouched', () => {
  const tracks = [track('sub', 'subBass'), track('bass', 'realElectricBass'), track('lead', 'realFlute')];
  const clips = [
    clip('sub', ['E1', 'E1', 'F1', 'E1', 'A#0', 'E1']),
    clip('bass', ['E2', 'G2', 'E3', 'D2', 'B2', 'E2', 'F2', 'A#2']),
    clip('lead', ['C5', 'D5', 'E5', 'G5', 'E5', 'D5']),
  ];
  const { tracks: out, changes } = makeSpace(tracks, clips);
  assert.equal(out.find((t) => t.id === 'sub'), tracks[0]);
  const b = out.find((t) => t.id === 'bass').fx.peq;
  assert.ok(b.on);
  assert.equal(b.bands[0].on, false, 'no low cut on a bass');
  assert.equal(b.bands[2].type, 'bell');
  assert.equal(b.bands[2].gain, BASS_MUD_DB);
  assert.ok(b.bands[2].freq >= 160 && b.bands[2].freq <= 320, `at ${b.bands[2].freq} Hz`);
  assert.ok(changes.some((c) => c.trackId === 'bass' && /over the sub/.test(c.what)));
});
