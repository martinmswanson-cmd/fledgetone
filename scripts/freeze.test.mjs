// Unit tests for freezing tracks (src/store/freeze.ts). Run with `npm test`.
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
const { freezeFingerprint, freezeIsCurrent, liveView, trackForFreezing, frozenClipId } = await import('../src/store/freeze.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');

const track = (id, key, extra = {}) => ({ id, name: id, color: '#888', instrumentKey: key, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0.2, delaySend: 0, ...extra });
const clip = (id, trackId, startBar, notes) => ({ id, trackId, name: id, startBar, lengthBars: 2, isSelected: false, notes: notes.map(([note, at], i) => ({ id: id + i, note, startOffset: at, duration: '8n', velocity: 0.8 })) });

const synth = track('lead', 'supersaw');
const drums = track('drums', 'drumMachine');
const base = () => ({ tracks: [synth, drums], clips: [clip('c1', 'lead', 3, [['C4', 0], ['E4', 0.5]]), clip('k', 'drums', 1, [['C1', 0], ['C1', 1]])], bpm: 140, swing: 0 });
const fp = (t, all) => freezeFingerprint(t, all);
const never = () => false;

test('mixing a frozen track keeps its freeze: volume, pan, sends, mute, solo, name', () => {
  const all = base();
  const before = fp(synth, all);
  for (const change of [{ volume: -6 }, { pan: 0.5 }, { distance: 0.7 }, { reverbSend: 0.8 }, { delaySend: 0.4 }, { isMuted: true }, { isSoloed: true }, { name: 'Renamed' }, { color: '#fff' }]) {
    const t = { ...synth, ...change };
    assert.equal(fp(t, { ...all, tracks: [t, drums] }), before, JSON.stringify(change));
  }
  // and volume or send automation stays live too
  const auto = { ...synth, automation: [{ param: 'volume', points: [{ bar: 1, value: 0.2 }, { bar: 5, value: 0.9 }] }] };
  assert.equal(fp(auto, { ...all, tracks: [auto, drums] }), before);
});

test('anything rendered into the freeze makes it out of date', () => {
  const all = base();
  const before = fp(synth, all);
  const changed = [
    ['a note', { ...all, clips: [clip('c1', 'lead', 3, [['C4', 0], ['F4', 0.5]]), all.clips[1]] }],
    ['a clip moved', { ...all, clips: [{ ...all.clips[0], startBar: 4 }, all.clips[1]] }],
    ['tempo', { ...all, bpm: 141 }],
    ['swing', { ...all, swing: 0.2 }],
  ];
  for (const [what, a] of changed) assert.notEqual(fp(synth, a), before, what);
  for (const [what, t] of [
    ['instrument', { ...synth, instrumentKey: 'pluck' }],
    ['an insert', { ...synth, fx: { ...synth.fx, distortion: { on: true, amount: 0.3 } } }],
    ['the EQ', { ...synth, eq: { low: 2, mid: 0, high: 0 } }],
    ['filter automation', { ...synth, automation: [{ param: 'filterCutoff', points: [{ bar: 1, value: 0.2 }] }] }],
  ]) assert.notEqual(fp(t, { ...all, tracks: [t, drums] }), before, what);
});

test("another track's kicks matter only to a kick-triggered Pump, and only from drum tracks that sound", () => {
  const all = base();
  const moreKicks = { ...all, clips: [all.clips[0], clip('k', 'drums', 1, [['C1', 0], ['C1', 1], ['C1', 1.5]])] };
  assert.equal(fp(synth, moreKicks), fp(synth, all), 'no Pump: kicks are not part of it');
  const pumped = { ...synth, fx: { ...synth.fx, pump: { ...synth.fx.pump, on: true, trigger: 'kick' } } };
  const withPump = { ...all, tracks: [pumped, drums] };
  assert.notEqual(fp(pumped, { ...moreKicks, tracks: [pumped, drums] }), fp(pumped, withPump));
  // Live playback ducks only on drums that sound: muting them, or soloing another track, changes the sound
  assert.notEqual(fp(pumped, { ...withPump, tracks: [pumped, { ...drums, isMuted: true }] }), fp(pumped, withPump));
  const soloed = { ...pumped, isSoloed: true };
  assert.notEqual(fp(soloed, { ...withPump, tracks: [soloed, drums] }), fp(pumped, withPump));
});

test('a frozen drum track still says it is drums, so its kicks keep driving Pumps', () => {
  const all = base();
  const fd = { ...drums, frozen: { soundId: 'd', startBar: 1, seconds: 3, gainDb: 0, fingerprint: '' } };
  fd.frozen.fingerprint = fp(fd, { ...all, tracks: [synth, fd] });
  const v = liveView({ ...all, tracks: [synth, fd] }, never);
  assert.deepEqual([v.tracks[1].instrumentKey, v.tracks[1].frozenFrom], ['audio', 'drumMachine']);
});

test('the render copy is centred at 0 dB, up front, with no sends, its live automation left out', () => {
  const t = trackForFreezing({ ...synth, volume: -8, pan: -1, reverbSend: 1, delaySend: 1, distance: 0.6, isMuted: true, automation: [{ param: 'pan', points: [] }, { param: 'eqLow', points: [] }] });
  assert.deepEqual([t.volume, t.pan, t.reverbSend, t.delaySend, t.distance, t.isMuted], [0, 0, 0, 0, undefined, false]);
  assert.deepEqual(t.automation.map((l) => l.param), ['eqLow']);
});

test('a current freeze plays as an Audio track with one clip of its sound; out of date, armed or missing, it plays live', () => {
  const all = base();
  const frozen = { ...synth, volume: -4, fx: { ...synth.fx, distortion: { on: true, amount: 0.5 } }, frozen: { soundId: 'abc', startBar: 3, seconds: 3.6, gainDb: -2, fingerprint: '' } };
  frozen.frozen.fingerprint = fp(frozen, { ...all, tracks: [frozen, drums] });
  const state = { ...all, tracks: [frozen, drums] };
  assert.ok(freezeIsCurrent(frozen, state, never));
  const v = liveView(state, never);
  const t = v.tracks[0];
  assert.equal(t.instrumentKey, 'audio');
  assert.equal(t.fx.distortion.on, false, 'inserts are in the sound');
  assert.equal(t.volume, -4, 'volume stays live');
  const fc = v.clips.find((c) => c.id === frozenClipId('lead'));
  assert.deepEqual([fc.startBar, fc.audio.soundId, fc.audio.gain], [3, 'abc', -2]);
  assert.ok(Math.abs(fc.lengthBars - (3.6 * 140) / 240) < 1e-9);
  assert.ok(v.clips.some((c) => c.id === 'c1'), 'the note clips stay (their kicks drive Pumps)');
  assert.equal(v.tracks[1], drums, 'other tracks pass through untouched');
  // Unchanged: the same arrays, so the engine does nothing
  const again = liveView(state, never, v);
  assert.equal(again.tracks, v.tracks);
  assert.equal(again.clips, v.clips);
  // Out of date, armed, or its sound gone: plays live
  const edited = { ...state, swing: 0.3 };
  assert.equal(liveView(edited, never, v).tracks[0].instrumentKey, 'supersaw');
  const armed = { ...frozen, isArmed: true };
  assert.equal(liveView({ ...state, tracks: [armed, drums] }, never).tracks[0].instrumentKey, 'supersaw');
  assert.equal(liveView(state, (id) => id === 'abc').tracks[0].instrumentKey, 'supersaw');
});

test('how often a note plays is part of a freeze: setting it, its clip and a kick that sits out', () => {
  const hats = track('hats', 'drumMachine');
  const base = clip('h1', 'hats', 1, [['F#1', 0], ['F#1', 0.25]]);
  const all = (c) => ({ tracks: [hats], clips: [c], bpm: 120, swing: 0 });
  const plain = fp(hats, all(base));
  const half = { ...base, notes: base.notes.map((n, i) => (i ? { ...n, chance: 0.5 } : n)) };
  assert.notEqual(fp(hats, all(half)), plain);
  // The draw comes from the clip's id: another id is another sound
  assert.notEqual(fp(hats, all({ ...half, id: 'h2' })), fp(hats, all(half)));
  // A clip with none keeps the fingerprint it had (freezes made before stay current)
  assert.equal(fp(hats, all({ ...base, id: 'other' })), fp(hats, all(base)));
  // A Pump on the kick hears whether a kick may sit out
  const pad = track('pad', 'supersaw', { fx: { ...defaultTrackFx(), pump: { ...defaultTrackFx().pump, on: true, trigger: 'kick' } } });
  const kick = clip('k1', 'drums', 1, [['C1', 0], ['C1', 0.5]]);
  const withKick = (k) => ({ tracks: [pad, drums], clips: [k], bpm: 120, swing: 0 });
  assert.notEqual(fp(pad, withKick({ ...kick, notes: kick.notes.map((n, i) => (i ? { ...n, cond: { n: 1, of: 2 } } : n)) })), fp(pad, withKick(kick)));
});

test('a Pump that follows a track hears that track sit out, and the runs of copies it plays in', () => {
  const bass = track('bass', 'supersaw', { fx: { ...defaultTrackFx(), pump: { ...defaultTrackFx().pump, on: true, trigger: 'track', source: 'chords' } } });
  const chords = track('chords', 'supersaw');
  const a = clip('a', 'chords', 1, [['C4', 0], ['E4', 0.5]]);
  const all = (cs) => ({ tracks: [bass, chords], clips: cs, bpm: 120, swing: 0 });
  const plain = fp(bass, all([a]));
  const sometimes = { ...a, notes: a.notes.map((n, i) => (i ? { ...n, chance: 0.25 } : n)) };
  assert.notEqual(fp(bass, all([sometimes])), plain);
  // A copy next to it, then that copy changed: the pass of the note that plays sometimes moves
  const copy = { ...sometimes, id: 'b', startBar: 3 };
  const changed = { ...copy, notes: [...copy.notes, { id: 'x', note: 'G4', startOffset: 1, duration: '8n', velocity: 0.8 }] };
  assert.notEqual(fp(bass, all([sometimes, changed])), fp(bass, all([sometimes, copy])));
});
