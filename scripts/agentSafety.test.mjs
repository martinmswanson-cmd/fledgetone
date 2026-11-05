// Cautions about a suggestion's levels (src/agent/safety.ts): a track up by more than 6 dB, the
// master by more than 3, the Loud master or the clipper switched on. Run with `npm test`.
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
const { checkSafety, TRACK_JUMP_DB, MASTER_JUMP_DB, OTT_FULL_LIFT_DB } = await import('../src/agent/safety.ts');
const { applyOps } = await import('../src/agent/ops.ts');
const { createStarter } = await import('../src/store/starters.ts');

const base = () => createStarter('lofi');
const withTrack = (p, i, patch) => ({ ...p, tracks: p.tracks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

test('a track up by more than 6 dB is a warning; up by less is not', () => {
  const a = base();
  assert.equal(TRACK_JUMP_DB, 6);
  assert.deepEqual(checkSafety(a, withTrack(a, 0, { volume: a.tracks[0].volume + 5 })), []);
  const w = checkSafety(a, withTrack(a, 0, { volume: a.tracks[0].volume + 9 }));
  assert.equal(w.length, 1);
  assert.match(w[0], /"Keys" goes up by 9 dB/);
  assert.deepEqual(checkSafety(a, withTrack(a, 0, { volume: a.tracks[0].volume - 20 })), []);
});

test('the master up by more than 3 dB, the Loud master or the clipper switched on', () => {
  const a = base();
  assert.equal(MASTER_JUMP_DB, 3);
  assert.deepEqual(checkSafety(a, { ...a, master: { ...a.master, level: a.master.level + 2 } }), []);
  assert.match(checkSafety(a, { ...a, master: { ...a.master, level: a.master.level + 4 } })[0], /master Level goes up by 4 dB/);
  assert.match(checkSafety(a, { ...a, master: { ...a.master, loud: { on: true, target: 'loud', push: 4, subTilt: 0 } } })[0], /Loud master/);
  assert.match(checkSafety(a, { ...a, master: { ...a.master, clipper: { on: true, drive: 3, softness: 0.5, ceiling: -1 } } })[0], /clipper/);
});

test('a new track set loud, and a volume lane drawn high', () => {
  const a = base();
  const loudNew = { ...a, tracks: [...a.tracks, { ...a.tracks[0], id: 'new', name: 'New', volume: 6 }] };
  assert.deepEqual(checkSafety(a, loudNew), []);
  const lane = withTrack(a, 4, { automation: [{ param: 'volume', points: [{ bar: 1, value: 1 }] }] });
  assert.match(checkSafety(a, lane).join(' '), /On "Rain", the volume automation goes up/);
});

test('applyOps carries the warnings: +9 dB through an op', () => {
  const a = base();
  const out = applyOps(a, { opsVersion: 1, ops: [{ op: 'set_track', trackId: a.tracks[4].id, volumeDb: a.tracks[4].volume + 9 }] }, { idBase: 'sg' });
  assert.ok(out.ok);
  assert.ok(out.warnings.some((w) => /"Rain" goes up by 9 dB/.test(w)), out.warnings.join('\n'));
});

const warningsFor = (ops, song = base()) => {
  const out = applyOps(song, { opsVersion: 1, ops }, { idBase: 'sg' });
  assert.ok(out.ok, JSON.stringify(out.errors));
  return out.warnings.join('\n');
};

test('insert gains, drives and feedback pushed up are warnings', () => {
  const t = base().tracks[0].id;
  const band = { on: true, type: 'bell', freq: 3000, gain: 24, q: 1 };
  const cases = [
    [[{ op: 'set_insert', trackId: t, insert: 'compressor', settings: { on: true, makeup: 18 } }], /On "Keys", the compressor makes up 18 dB more/],
    [[{ op: 'set_insert', trackId: t, insert: 'peq', settings: { on: true, bands: [band] } }], /On "Keys", the parametric EQ lifts a band by 24 dB more/],
    [[{ op: 'set_insert', trackId: t, insert: 'mbc', settings: { on: true, bands: [{ threshold: -24, ratio: 3, gain: 18 }, { threshold: -20, ratio: 2.5, gain: 1 }, { threshold: -22, ratio: 3, gain: 1.5 }] } }], /multiband compressor lifts a band/],
    [[{ op: 'set_eq', trackId: t, low: 12, mid: 12, high: 12 }], /On "Keys", the EQ low goes up by 12 dB[\s\S]*EQ mid goes up[\s\S]*EQ high goes up/],
    [[{ op: 'set_insert', trackId: t, insert: 'distortion', settings: { on: true, amount: 1 } }], /This turns on Distortion on "Keys" at 100% drive/],
    [[{ op: 'set_insert', trackId: t, insert: 'saturate', settings: { on: true, amount: 1 } }], /This turns on Saturation on "Keys" at 100% drive/],
    [[{ op: 'set_insert', trackId: t, insert: 'echo', settings: { on: true, feedback: 0.9 } }], /Delay feeds back at 90%/],
  ];
  for (const [ops, re] of cases) assert.match(warningsFor(ops), re, JSON.stringify(ops[0]));
  // Small moves say nothing
  assert.equal(warningsFor([{ op: 'set_eq', trackId: t, low: 2 }, { op: 'set_insert', trackId: t, insert: 'echo', settings: { on: true, feedback: 0.5 } }]), '');
});

test('automation of a gain, a drive or a feedback drawn high is a warning', () => {
  const t = base().tracks[0].id;
  const high = [{ bar: 1, value: 1 }, { bar: 9, value: 1 }];
  for (const [param, re] of [['fx:compressor.makeup', /compressor makeup automation goes up/], ['eqHigh', /EQ high automation goes up/], ['fx:distortion.amount', /distortion drive automation/], ['fx:echo.feedback', /delay feedback automation/], ['volume', /volume automation goes up/]])
    assert.match(warningsFor([{ op: 'set_automation', trackId: t, param, points: high }]), re, param);
  assert.equal(warningsFor([{ op: 'set_automation', trackId: t, param: 'pan', points: high }]), '');
});

test('gain stacked along the way out, and an unmuted track, are warnings', () => {
  const a = base();
  const t = a.tracks[0];
  // +6 on the track and +6 on a new bus it plays into: neither over the line alone, 12 dB in all
  assert.match(warningsFor([{ op: 'add_track', instrument: 'bus', ref: 'b' }, { op: 'set_track', trackId: '$b', volumeDb: 6 }, { op: 'set_track', trackId: t.id, volumeDb: t.volume + 6, output: '$b' }]), /"Keys" comes out up to 12 dB louder through the buses and the master/);
  // Every track +6 and the master +3
  const all = [...a.tracks.map((x) => ({ op: 'set_track', trackId: x.id, volumeDb: Math.min(6, x.volume + 6) })), { op: 'set_master', levelDb: a.master.level + 3 }];
  assert.match(warningsFor(all), /and \d+ more come out up to 9 dB louder/);
  // The master alone is said once, not for every track
  const master = warningsFor([{ op: 'set_master', levelDb: a.master.level + 7 }]);
  assert.match(master, /master Level goes up by 7 dB/);
  assert.doesNotMatch(master, /through the buses/);
  const muted = { ...a, tracks: a.tracks.map((x, i) => (i === 0 ? { ...x, isMuted: true } : x)) };
  assert.match(warningsFor([{ op: 'set_track', trackId: t.id, mute: false }], muted), /This unmutes "Keys"/);
});

test('a lane redrawn no higher than it was says nothing; a drive pushed harder (not switched on) says so', () => {
  const t = base().tracks[0];
  const first = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 0.9 }, { bar: 9, value: 0.9 }] }] }, { idBase: 'sg-1' });
  assert.match(first.warnings.join('\n'), /volume automation goes up/);
  assert.equal(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 0.9 }, { bar: 9, value: 0.8 }, { bar: 13, value: 0.85 }] }], first.song), '');
  const driven = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_insert', trackId: t.id, insert: 'distortion', settings: { on: true, amount: 0.2 } }] }, { idBase: 'sg-2' }).song;
  assert.match(warningsFor([{ op: 'set_insert', trackId: t.id, insert: 'distortion', settings: { amount: 1 } }], driven), /On "Keys", Distortion is driven much harder \(20% to 100% drive\)/);
  // No "'s" glued to a quoted name anywhere
  assert.doesNotMatch(warningsFor([{ op: 'set_insert', trackId: t.id, insert: 'compressor', settings: { on: true, makeup: 18 } }]), /"'s/);
});

test('a quiet track unmuted is a note, a loud one a warning', () => {
  const a = base();
  const quiet = { ...a, tracks: a.tracks.map((x, i) => (i === 4 ? { ...x, isMuted: true, volume: -30 } : x)) };
  const q = applyOps(quiet, { opsVersion: 1, ops: [{ op: 'set_track', trackId: a.tracks[4].id, mute: false }] }, { idBase: 'sg' });
  assert.equal(q.warnings.join(''), '');
  assert.match(q.notes.join(''), /This unmutes "Rain", quietly under the rest of the mix/);
  const loud = { ...a, tracks: a.tracks.map((x, i) => (i === 4 ? { ...x, isMuted: true, volume: 0 } : x)) };
  const l = applyOps(loud, { opsVersion: 1, ops: [{ op: 'set_track', trackId: a.tracks[4].id, mute: false }] }, { idBase: 'sg' });
  assert.match(l.warnings.join(''), /This unmutes "Rain" \(at 0 dB\)/);
  assert.deepEqual(l.notes, []);
});

test('a volume lane that held a track down, removed or emptied, is a warning', () => {
  const t = base().tracks[0];
  const low = [{ bar: 1, value: 0.1 }, { bar: 9, value: 0.1 }];
  const held = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_track', trackId: t.id, volumeDb: 0 }, { op: 'set_automation', trackId: t.id, param: 'volume', points: low }] }, { idBase: 'sg-1' }).song;
  for (const op of [{ op: 'remove_automation', trackId: t.id, param: 'volume' }, { op: 'set_automation', trackId: t.id, param: 'volume', points: [] }])
    assert.match(warningsFor([op], held), /This takes away the volume automation on "Keys": it held it down, and it comes up by as much as \d+(\.\d)? dB/, op.op);
  // A lane that sat at the fader's own level says nothing when it goes
  const flat = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_track', trackId: t.id, volumeDb: -20 }, { op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 1 }] }] }, { idBase: 'sg-2' }).song;
  assert.equal(warningsFor([{ op: 'remove_automation', trackId: t.id, param: 'volume' }], flat), '');
  // A delay feedback lane that kept it short, taken away from a delay set to feed back hard
  const echo = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_insert', trackId: t.id, insert: 'echo', settings: { on: true, feedback: 0.9 } }, { op: 'set_automation', trackId: t.id, param: 'fx:echo.feedback', points: [{ bar: 1, value: 0.1 }] }] }, { idBase: 'sg-3' }).song;
  assert.match(warningsFor([{ op: 'remove_automation', trackId: t.id, param: 'fx:echo.feedback' }], echo), /takes away the delay feedback automation on "Keys": it feeds back at 90% all along/);
});

test('un-soloing a quiet soloed track brings the rest back: a warning', () => {
  const a = base();
  const t = a.tracks[4];
  const soloed = { ...a, tracks: a.tracks.map((x, i) => (i === 4 ? { ...x, isSoloed: true, volume: -30 } : x)) };
  const w = warningsFor([{ op: 'set_track', trackId: t.id, solo: false }], soloed);
  assert.match(w, /This un-solos "Rain": every other track is heard again\./);
  // Moving the solo to another track: that track is heard
  assert.match(warningsFor([{ op: 'set_track', trackId: t.id, solo: false }, { op: 'set_track', trackId: a.tracks[0].id, solo: true }], soloed), /This un-solos "Rain": "Keys" \(at -?\d+(\.\d)? dB\) is heard again\./);
  // Soloing (fewer heard) says nothing
  assert.equal(warningsFor([{ op: 'set_track', trackId: t.id, solo: true }]), '');
});

test('a lane kept but redrawn louder somewhere along the song is a warning, said from where it comes up', () => {
  const t = base().tracks[0];
  // Loud only in bar 1, held far down after; redrawn at its top all along
  const held = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_track', trackId: t.id, volumeDb: 0 }, { op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 1 }, { bar: 2, value: 0.05 }, { bar: 64, value: 0.05 }] }] }, { idBase: 'sg-1' }).song;
  const top = [{ bar: 1, value: 1 }, { bar: 64, value: 1 }];
  assert.match(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'volume', points: top }], held), /^This redraws the volume automation on "Keys": it comes up by as much as 66 dB from bar 1\.\d\. Turn your speakers down before you listen\.$/);
  // The low part raised with a jump at bar 2: from bar 2
  assert.match(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 1 }, { bar: 2, value: 0.05 }, { bar: 2, value: 1 }, { bar: 64, value: 1 }] }], held), /it comes up by as much as 66 dB from bar 2\./);
  // A drive lane: on at 10%, the lane at the top in bar 1 then down to nothing, redrawn at its top all along
  const driven = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_insert', trackId: t.id, insert: 'distortion', settings: { on: true, amount: 0.1 } }, { op: 'set_automation', trackId: t.id, param: 'fx:distortion.amount', points: [{ bar: 1, value: 1 }, { bar: 1.25, value: 0 }, { bar: 64, value: 0 }] }] }, { idBase: 'sg-2' }).song;
  assert.match(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'fx:distortion.amount', points: top }], driven), /This redraws the distortion drive automation on "Keys": it is driven much harder from bar 1\.\d \(as much as 0% to 100% drive\): it gets louder and harsher\./);
  // A delay feedback lane short in bar 1 to 8, redrawn to feed back hard from bar 9
  const echo = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_insert', trackId: t.id, insert: 'echo', settings: { on: true, feedback: 0.3 } }, { op: 'set_automation', trackId: t.id, param: 'fx:echo.feedback', points: [{ bar: 1, value: 0.2 }, { bar: 64, value: 0.2 }] }] }, { idBase: 'sg-3' }).song;
  assert.match(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'fx:echo.feedback', points: [{ bar: 1, value: 0.2 }, { bar: 9, value: 0.2 }, { bar: 9, value: 1 }, { bar: 64, value: 1 }] }], echo), /This redraws the delay feedback automation on "Keys": it feeds back at up to \d+% from bar 9: its echoes build up and take a long time to die away\./);
});

test('a lane redrawn quieter, or a fade-in moved later, says nothing', () => {
  const t = base().tracks[0];
  const fadeIn = [{ bar: 1, value: 0 }, { bar: 9, value: 0.84 }, { bar: 64, value: 0.84 }];
  const song = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_track', trackId: t.id, volumeDb: 0 }, { op: 'set_automation', trackId: t.id, param: 'volume', points: fadeIn }] }, { idBase: 'sg-1' }).song;
  assert.equal(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 0 }, { bar: 17, value: 0 }, { bar: 25, value: 0.84 }, { bar: 64, value: 0.84 }] }], song), '');
  assert.equal(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 0 }, { bar: 9, value: 0.7 }, { bar: 64, value: 0.6, curve: 0.5 }] }], song), '');
  // A drive lane made gentler
  const driven = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_insert', trackId: t.id, insert: 'distortion', settings: { on: true, amount: 0.5 } }, { op: 'set_automation', trackId: t.id, param: 'fx:distortion.amount', points: [{ bar: 1, value: 0.8 }, { bar: 64, value: 0.8 }] }] }, { idBase: 'sg-2' }).song;
  assert.equal(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'fx:distortion.amount', points: [{ bar: 1, value: 0.2 }, { bar: 32, value: 0.8 }] }], driven), '');
});

test('a volume lane added over a quiet fader is a warning; one at the fader level is not', () => {
  const t = base().tracks[0];
  const quiet = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_track', trackId: t.id, volumeDb: -30 }] }, { idBase: 'sg-1' }).song;
  // At the fader's -30 dB up to bar 33 (0.355 up the lane), then at the top
  assert.match(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 0.355 }, { bar: 33, value: 0.355 }, { bar: 33, value: 1 }] }], quiet), /^On "Keys", the volume automation goes up to 3\d(\.\d)? dB over what it was\.$/);
  assert.equal(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 0.355 }, { bar: 33, value: 0.355 }] }], quiet), '');
});

test('a bus lane redrawn louder is a warning too', () => {
  const song = applyOps(base(), { opsVersion: 1, ops: [{ op: 'add_track', instrument: 'bus', ref: 'b' }, { op: 'set_automation', trackId: '$b', param: 'volume', points: [{ bar: 1, value: 0.2 }, { bar: 64, value: 0.2 }] }] }, { idBase: 'sg-1' }).song;
  const bus = song.tracks.find((x) => x.instrumentKey === 'bus');
  assert.match(warningsFor([{ op: 'set_automation', trackId: bus.id, param: 'volume', points: [{ bar: 1, value: 0.2 }, { bar: 5, value: 1 }] }], song), /This redraws the volume automation on "[^"]+": it comes up by as much as \d+(\.\d)? dB from bar \d/);
});

test('a volume lane at silence says a number of dB, never Infinity', () => {
  const t = base().tracks[0];
  const silent = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 0 }, { bar: 5, value: 0 }] }] }, { idBase: 'sg-1' }).song;
  const removed = warningsFor([{ op: 'remove_automation', trackId: t.id, param: 'volume' }], silent);
  const redrawn = warningsFor([{ op: 'set_automation', trackId: t.id, param: 'volume', points: [{ bar: 1, value: 1 }] }], silent);
  assert.match(removed, /This takes away the volume automation on "Keys": it held it down, and it comes up by as much as \d+(\.\d)? dB\./);
  assert.match(redrawn, /This redraws the volume automation on "Keys": it comes up by as much as 66 dB from bar 1\./);
  assert.doesNotMatch(removed + redrawn, /Infinity|NaN/);
  // Said once: not again as louder through the buses and the master
  assert.doesNotMatch(removed + redrawn, /through the buses/);
});

test('a parametric EQ or multiband cut taken away, or a band raised from below 0 dB, is a warning', () => {
  const t = base().tracks[0];
  const cut = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_insert', trackId: t.id, insert: 'peq', settings: { on: true, bands: [{ on: true, type: 'bell', freq: 500, gain: -24, q: 0.3 }] } }] }, { idBase: 'sg-1' }).song;
  assert.match(warningsFor([{ op: 'set_insert', trackId: t.id, insert: 'peq', settings: { on: false } }], cut), /^This switches off the parametric EQ on "Keys": it held it down, and around 500 Hz it comes up by 24 dB\. Turn your speakers down before you listen\.$/);
  assert.match(warningsFor([{ op: 'set_insert', trackId: t.id, insert: 'peq', settings: { bands: [{ on: true, type: 'bell', freq: 500, gain: 0, q: 0.3 }] } }], cut), /^On "Keys", the parametric EQ cuts less: around 500 Hz it comes up by 24 dB\./);
  // A low-cut at 5 kHz taken away
  const lowCut = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_insert', trackId: t.id, insert: 'peq', settings: { on: true, bands: [{ on: true, type: 'lowcut', freq: 5000, gain: 0, q: 0.7 }] } }] }, { idBase: 'sg-2' }).song;
  assert.match(warningsFor([{ op: 'set_insert', trackId: t.id, insert: 'peq', settings: { bands: [{ on: false, type: 'lowcut', freq: 5000, gain: 0, q: 0.7 }] } }], lowCut), /the parametric EQ cuts less: around \d+ Hz it comes up by \d+(\.\d)? dB/);
  // A cut made deeper, or a band only nudged, says nothing
  assert.equal(warningsFor([{ op: 'set_insert', trackId: t.id, insert: 'peq', settings: { bands: [{ on: true, type: 'bell', freq: 500, gain: -20, q: 0.3 }] } }], cut), '');
  const mb = applyOps(base(), { opsVersion: 1, ops: [{ op: 'set_insert', trackId: t.id, insert: 'mbc', settings: { on: true, bands: [{ threshold: 0, ratio: 1, gain: -12 }, { threshold: 0, ratio: 1, gain: -12 }, { threshold: 0, ratio: 1, gain: -12 }] } }] }, { idBase: 'sg-3' }).song;
  const up = [{ threshold: 0, ratio: 1, gain: 6 }, { threshold: 0, ratio: 1, gain: 6 }, { threshold: 0, ratio: 1, gain: 6 }];
  assert.match(warningsFor([{ op: 'set_insert', trackId: t.id, insert: 'mbc', settings: { bands: up } }], mb), /^On "Keys", the multiband compressor lifts a band by 18 dB more\.$/);
  assert.match(warningsFor([{ op: 'set_insert', trackId: t.id, insert: 'mbc', settings: { on: false } }], mb), /^This switches off the multiband compressor on "Keys": its bands held it down, and it comes up by as much as 12 dB\. Turn your speakers down before you listen\.$/);
  assert.equal(warningsFor([{ op: 'set_insert', trackId: t.id, insert: 'mbc', settings: { bands: up.map((b) => ({ ...b, gain: -8 })) } }], mb), '');
});

test('a volume lane counts along the way out: a track led out of a bus held down, a muted track with a lane', () => {
  const s = base();
  const [keys, , , , rain] = s.tracks;
  const held = applyOps(s, { opsVersion: 1, ops: [{ op: 'add_track', instrument: 'bus', ref: 'B', name: 'Grp' }, { op: 'set_track', trackId: keys.id, output: '$B' }, { op: 'set_automation', trackId: '$B', param: 'volume', points: [{ bar: 1, value: 0.3 }] }] }, { idBase: 'sg-1' }).song;
  assert.match(warningsFor([{ op: 'set_track', trackId: keys.id, output: null }], held), /"Keys" comes out up to 35\.8 dB louder through the buses and the master together/);
  const muted = applyOps(s, { opsVersion: 1, ops: [{ op: 'set_automation', trackId: rain.id, param: 'volume', points: [{ bar: 1, value: 1 }] }, { op: 'set_track', trackId: rain.id, mute: true }] }, { idBase: 'sg-2' }).song;
  const out = applyOps(muted, { opsVersion: 1, ops: [{ op: 'set_track', trackId: rain.id, mute: false }] }, { idBase: 'sg-3' });
  assert.match(out.warnings.join('\n'), /This unmutes "Rain" \(at 6 dB\): it will be heard again\./);
  assert.deepEqual(out.notes, []);
});

test('a drive or makeup lane on an insert that was off is measured from nothing', () => {
  const t = base().tracks[0];
  assert.match(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'fx:distortion.amount', points: [{ bar: 1, value: 0.65 }] }]), /^On "Keys", the distortion drive automation pushes it to 65%\.$/);
  assert.match(warningsFor([{ op: 'set_automation', trackId: t.id, param: 'fx:compressor.makeup', points: [{ bar: 1, value: 0.5 }] }]), /^On "Keys", the compressor makeup automation goes up to 9 dB over what it was\.$/);
});

test('unmuting a track a solo keeps silent is a note, not a warning', () => {
  const s = base();
  const soloed = applyOps(s, { opsVersion: 1, ops: [{ op: 'set_track', trackId: s.tracks[0].id, mute: true }, { op: 'set_track', trackId: s.tracks[4].id, solo: true }] }, { idBase: 'sg-1' }).song;
  const out = applyOps(soloed, { opsVersion: 1, ops: [{ op: 'set_track', trackId: s.tracks[0].id, mute: false }] }, { idBase: 'sg-2' });
  assert.deepEqual(out.warnings, []);
  assert.deepEqual(out.notes, ['This unmutes "Keys", but it stays silent: other tracks are soloed.']);
});

// ---- Round 30: inserts that held a track down, notes played harder, sends, the OTT, and false cautions ----

const ap = (song, ops) => {
  const out = applyOps(song, { opsVersion: 1, ops }, { idBase: 'sg-' + Math.random().toString(36).slice(2, 7) });
  assert.ok(out.ok, JSON.stringify(out.errors));
  return out.song;
};

test('a Filter, compressor or Gate that held a track down, switched off, opened or eased, is a warning', () => {
  const K = base().tracks[0].id;
  const filt = ap(base(), [{ op: 'set_insert', trackId: K, insert: 'filter', settings: { on: true, type: 'lowpass', cutoff: 80, slope: 24 } }]);
  assert.match(warningsFor([{ op: 'set_insert', trackId: K, insert: 'filter', settings: { on: false } }], filt), /^This switches off the Filter on "Keys": it held it down, and around [\d.]+ (Hz|kHz) it comes up by \d+(\.\d)? dB\. Turn your speakers down before you listen\.$/);
  assert.match(warningsFor([{ op: 'set_insert', trackId: K, insert: 'filter', settings: { cutoff: 20000 } }], filt), /^On "Keys", the Filter lets much more through: around/);
  assert.match(warningsFor([{ op: 'set_automation', trackId: K, param: 'filterCutoff', points: [{ bar: 1, value: 1 }] }], filt), /^On "Keys", the Filter lets much more through from bar 1: around/);
  // A cutoff lane that held it shut from bar 9, redrawn open there
  const swept = ap(base(), [{ op: 'set_insert', trackId: K, insert: 'filter', settings: { on: true, type: 'lowpass', cutoff: 20000, slope: 24 } }, { op: 'set_automation', trackId: K, param: 'filterCutoff', points: [{ bar: 1, value: 1 }, { bar: 9, value: 1 }, { bar: 9, value: 0.05 }, { bar: 64, value: 0.05 }] }]);
  assert.match(warningsFor([{ op: 'set_automation', trackId: K, param: 'filterCutoff', points: [{ bar: 1, value: 1 }, { bar: 64, value: 1 }] }], swept), /the Filter lets much more through from bar 9/);
  // A resonance peak raised
  assert.match(warningsFor([{ op: 'set_insert', trackId: K, insert: 'filter', settings: { on: true, resonance: 15, cutoff: 800 } }], ap(base(), [{ op: 'set_insert', trackId: K, insert: 'filter', settings: { on: true, cutoff: 800 } }])), /On "Keys", the Filter peaks: around 800 Hz it comes up by \d+(\.\d)? dB/);
  // Closing a filter, or one that hardly held anything back, says nothing
  assert.equal(warningsFor([{ op: 'set_insert', trackId: K, insert: 'filter', settings: { cutoff: 60 } }], filt), '');
  const lowCut = ap(base(), [{ op: 'set_insert', trackId: K, insert: 'filter', settings: { on: true, type: 'highpass', cutoff: 20, slope: 12 } }]);
  assert.equal(warningsFor([{ op: 'set_insert', trackId: K, insert: 'filter', settings: { on: false } }], lowCut), '');

  const comp = ap(base(), [{ op: 'set_insert', trackId: K, insert: 'compressor', settings: { on: true, threshold: -60, ratio: 20, makeup: 0 } }]);
  assert.match(warningsFor([{ op: 'set_insert', trackId: K, insert: 'compressor', settings: { on: false } }], comp), /^This switches off the compressor on "Keys": it held it down, and it comes up much louder\. Turn your speakers down before you listen\.$/);
  assert.match(warningsFor([{ op: 'set_insert', trackId: K, insert: 'compressor', settings: { threshold: 0 } }], comp), /^On "Keys", the compressor holds it down much less: it comes up much louder\./);
  assert.match(warningsFor([{ op: 'set_automation', trackId: K, param: 'fx:compressor.threshold', points: [{ bar: 1, value: 1 }] }], comp), /^On "Keys", the compressor holds it down much less from bar 1: it comes up much louder\./);
  // The compressor as it comes (threshold -20, ratio 4, makeup 3) switched off: hardly held down
  const plainComp = ap(base(), [{ op: 'set_insert', trackId: K, insert: 'compressor', settings: { on: true } }]);
  assert.equal(warningsFor([{ op: 'set_insert', trackId: K, insert: 'compressor', settings: { on: false } }], plainComp), '');

  const gate = ap(base(), [{ op: 'set_insert', trackId: K, insert: 'gate', settings: { on: true, depth: 1, length: 0.1 } }]);
  assert.match(warningsFor([{ op: 'set_insert', trackId: K, insert: 'gate', settings: { on: false } }], gate), /^This switches off the Gate on "Keys": it held it down, and it comes up by about 10 dB\. Turn your speakers down before you listen\.$/);
  assert.match(warningsFor([{ op: 'set_automation', trackId: K, param: 'fx:gate.length', points: [{ bar: 1, value: 1 }] }], gate), /^On "Keys", the Gate chops it much less from bar 1: it comes up by about \d+(\.\d)? dB\./);
  assert.equal(warningsFor([{ op: 'set_insert', trackId: K, insert: 'gate', settings: { length: 0.2 } }], gate), '');
});

test('notes played much harder, the same notes stacked, or copies of a clip piled on a bar, are a warning', () => {
  const clip = base().clips[0];
  const soft = ap(base(), [{ op: 'change_notes', clipId: clip.id, notes: clip.notes.map((n) => ({ id: n.id, velocity: 0.05 })) }]);
  assert.match(warningsFor([{ op: 'change_notes', clipId: clip.id, notes: clip.notes.map((n) => ({ id: n.id, velocity: 1 })) }], soft), /^On "Keys", the notes play much harder \(louder notes, or more of them at once\) from bar 1: it comes up by about 26 dB\. Turn your speakers down before you listen\.$/);
  const stack = Array.from({ length: 40 }, () => ({ pitch: 'C4', start: 0, length: 1, velocity: 1 }));
  assert.match(warningsFor([{ op: 'add_notes', clipId: clip.id, notes: stack }]), /On "Keys", the notes play much harder .* from bar 1: it comes up by about 1\d(\.\d)? dB/);
  assert.match(warningsFor(Array.from({ length: 12 }, () => ({ op: 'duplicate_clip', clipId: clip.id, toBar: clip.startBar }))), /On "Keys", the notes play much harder .*: it comes up by about 11(\.\d)? dB/);
  // The starter's own velocities raised to the top: under 6 dB (measured +4.6 LU), so nothing
  assert.equal(warningsFor([{ op: 'change_notes', clipId: clip.id, notes: clip.notes.map((n) => ({ id: n.id, velocity: 1 })) }]), '');
  // A copy of the clip in bars it was silent in, or a few notes added, say nothing
  assert.equal(warningsFor([{ op: 'duplicate_clip', clipId: clip.id, toBar: 200 }]), '');
  assert.equal(warningsFor([{ op: 'add_notes', clipId: clip.id, notes: [{ pitch: 'C5', start: 0, length: 0.25, velocity: 0.8 }] }]), '');
});

test('a send pushed over full level is a warning: the reverb at 300%', () => {
  const K = base().tracks[0].id;
  assert.match(warningsFor([{ op: 'set_track', trackId: K, reverbSend: 3 }]), /^On "Keys", the reverb send goes up to 300%: the reverb comes out much louder\. Turn your speakers down before you listen\.$/);
  // Up to full level (measured +3 LU for the delay), or a send lane (never over full), say nothing
  assert.equal(warningsFor([{ op: 'set_track', trackId: K, delaySend: 1 }, { op: 'set_track', trackId: K, reverbSend: 1 }]), '');
  const ret = ap(base(), [{ op: 'add_track', instrument: 'return', ref: 'R', name: 'Verb' }]);
  const R = ret.tracks.at(-1).id;
  assert.equal(warningsFor([{ op: 'set_automation', trackId: K, param: `send:${R}`, points: [{ bar: 1, value: 1 }] }], ret), '');
  // A reverb send lane that held a 300% send down, taken away
  const held = ap(base(), [{ op: 'set_track', trackId: K, reverbSend: 3 }, { op: 'set_automation', trackId: K, param: 'reverbSend', points: [{ bar: 1, value: 0.1 }] }]);
  assert.match(warningsFor([{ op: 'remove_automation', trackId: K, param: 'reverbSend' }], held), /This takes away the reverb send automation on "Keys": it sends at 300% all along/);
});

test('the master OTT switched on, or pushed much harder, is a warning even without gain', () => {
  const a = base();
  assert.match(warningsFor([{ op: 'set_master', ott: { on: true, depth: 1, inGain: 0, outGain: 0 } }]), /^This switches on the master OTT: the whole song gets louder\.$/);
  const on = ap(a, [{ op: 'set_master', ott: { on: true, depth: 0.2 } }]);
  assert.match(warningsFor([{ op: 'set_master', ott: { depth: 1 } }], on), /^The master OTT is pushed much harder \(20% to 100% depth\): the whole song gets louder\.$/);
  assert.equal(warningsFor([{ op: 'set_master', ott: { depth: 0.4 } }], on), '');
});

test('the master OTT switched on at depth 0 (or hardly any) lifts nothing: no caution; its gains still count (scan r31)', () => {
  // Each band's gain goes with the depth (ott.ts): at depth 0 the OTT passes the song through, but for its gains
  assert.equal(OTT_FULL_LIFT_DB, 6.7);
  assert.equal(warningsFor([{ op: 'set_master', ott: { on: true, depth: 0 } }]), '');
  assert.equal(warningsFor([{ op: 'set_master', ott: { on: true, depth: 0.4, inGain: 0, outGain: 0 } }]), '');
  assert.equal(warningsFor([{ op: 'set_master', ott: { on: true, depth: 0, inGain: -12, outGain: 3 } }]), '');
  // 6.7 x 0.5 = 3.35 dB, over the master's 3: a caution
  assert.match(warningsFor([{ op: 'set_master', ott: { on: true, depth: 0.5, inGain: 0, outGain: 0 } }]), /^This switches on the master OTT: the whole song gets louder\.$/);
  // At depth 0 its gains alone lift it: out +2 and in +2 is 4 dB
  assert.match(warningsFor([{ op: 'set_master', ott: { on: true, depth: 0, inGain: 2, outGain: 2 } }]), /^This switches on the master OTT/);
});

test('no false cautions: a setting a lane plays over, a fader rise taken back, distance 0', () => {
  const s = base();
  const K = s.tracks[0].id;
  const vlane = ap(s, [{ op: 'set_automation', trackId: K, param: 'volume', points: [{ bar: 1, value: 0.7 }] }]);
  assert.equal(warningsFor([{ op: 'set_track', trackId: K, volumeDb: 6 }], vlane), '');
  const eqlo = ap(s, [{ op: 'set_automation', trackId: K, param: 'eqLow', points: [{ bar: 1, value: 0.5 }] }]);
  assert.equal(warningsFor([{ op: 'set_eq', trackId: K, low: 12 }], eqlo), '');
  // (the bands without a lane still say so)
  assert.equal(warningsFor([{ op: 'set_eq', trackId: K, low: 12, mid: 12, high: 12 }], eqlo), 'On "Keys", the EQ mid goes up by 12 dB.\nOn "Keys", the EQ high goes up by 12 dB.');
  const mk = ap(s, [{ op: 'set_insert', trackId: K, insert: 'compressor', settings: { on: true, makeup: 0 } }, { op: 'set_automation', trackId: K, param: 'fx:compressor.makeup', points: [{ bar: 1, value: 0 }] }]);
  assert.equal(warningsFor([{ op: 'set_insert', trackId: K, insert: 'compressor', settings: { makeup: 18 } }], mk), '');
  // Keys +12 with the master -12, or with the bus it plays into -12: no louder all the way out
  const keys = s.tracks[0].volume;
  assert.equal(warningsFor([{ op: 'set_track', trackId: K, volumeDb: keys + 12 }, { op: 'set_master', levelDb: s.master.level - 12 }]), '');
  const bus = ap(s, [{ op: 'add_track', instrument: 'bus', ref: 'B', name: 'Grp' }, { op: 'set_track', trackId: K, output: '$B' }]);
  assert.equal(warningsFor([{ op: 'set_track', trackId: K, volumeDb: keys + 12 }, { op: 'set_track', trackId: bus.tracks.at(-1).id, volumeDb: -12 }], bus), '');
  // ...but one the master takes back only in part still says so
  assert.match(warningsFor([{ op: 'set_track', trackId: K, volumeDb: keys + 12 }, { op: 'set_master', levelDb: s.master.level - 3 }]), /"Keys" goes up by 12 dB/);
  const F = s.tracks[3].id;
  const far = ap(s, [{ op: 'set_track', trackId: F, distance: 1 }]);
  const near = applyOps(far, { opsVersion: 1, ops: [{ op: 'set_track', trackId: F, distance: 0 }] }, { idBase: 'sg-near' });
  assert.deepEqual(near.warnings, []);
  assert.equal(near.song.tracks[3].distance, undefined);
});

test("the reviewer's cases measured no louder say nothing", () => {
  const s = base();
  const K = s.tracks[0].id;
  const clip = s.clips[0];
  const quiet = [
    [[{ op: 'set_track', trackId: K, volumeDb: 6 }, { op: 'set_track', trackId: K, volumeDb: -11.5 }]],
    [[{ op: 'set_track', trackId: K, delaySend: 1 }]],
    [[{ op: 'set_insert', trackId: K, insert: 'distortion', settings: { on: true, amount: 0.4 } }]],
    [[{ op: 'set_master', glue: 'punchy' }]],
    [[{ op: 'set_master', glue: 'off' }]],
    [[{ op: 'set_master', glue: 'tight' }]],
    [[{ op: 'set_master', width: { on: true, amount: 2 } }]],
    [[{ op: 'set_insert', trackId: K, insert: 'lofi', settings: { on: false } }]],
    [[{ op: 'set_automation', trackId: K, param: 'fx:lofi.mix', points: [{ bar: 1, value: 0 }] }]],
    [[{ op: 'change_notes', clipId: clip.id, notes: clip.notes.map((n) => ({ id: n.id, velocity: 1 })) }]],
    [[{ op: 'set_insert', trackId: K, insert: 'reverb', settings: { on: true, decay: 10, mix: 1 } }]],
    [[{ op: 'set_insert', trackId: K, insert: 'echo', settings: { on: true, feedback: 0.79, mix: 1 } }]],
    [[{ op: 'set_tempo', bpm: 41 }]],
    [[{ op: 'set_track', trackId: K, mute: true }]],
    [[{ op: 'set_insert', trackId: K, insert: 'pump', settings: { on: false } }], [{ op: 'set_insert', trackId: K, insert: 'pump', settings: { on: true, depth: 1, release: 600, trigger: 'kick' } }]],
    [[{ op: 'set_automation', trackId: K, param: 'fx:pump.depth', points: [{ bar: 1, value: 0 }] }], [{ op: 'set_insert', trackId: K, insert: 'pump', settings: { on: true, depth: 1, release: 600, trigger: 'kick' } }]],
    [[{ op: 'set_automation', trackId: K, param: 'volume', points: [{ bar: 1, value: 0.3, curve: 1 }, { bar: 5, value: 0.85 }] }], [{ op: 'set_automation', trackId: K, param: 'volume', points: [{ bar: 1, value: 0.3 }, { bar: 5, value: 0.85 }] }]],
  ];
  for (const [ops, setup] of quiet) assert.equal(warningsFor(ops, setup ? ap(s, setup) : s), '', JSON.stringify(ops[0]));
});

const { measuredRise, measuredCaution, safetyCautions, louderSaid, MEASURED_JUMP_LU, MEASURED_PEAK_DB, MEASURED_FLOOR_LU, SILENT_SONG_LUFS } = await import('../src/agent/safety.ts');
const { barLoudness } = await import('../src/agent/listenReport.ts');

test('the measured caution: Suggested much louder than the song in some bar, where the rules said nothing', () => {
  assert.equal(MEASURED_JUMP_LU, 6);
  assert.equal(MEASURED_PEAK_DB, 6);
  const bars = (list) => list.map(([lufs, peak]) => ({ lufs, peak }));
  const song = { lufs: -20, peak: -6 };
  const before = bars([[-20, -6], [-20, -6], [-30, -12], [-20, -6]]);
  // Bar 2 up 9 LU: from bar 2, up to 9 dB
  const up = measuredRise(before, bars([[-20, -6], [-11, -4], [-30, -12], [-18, -6]]), song);
  assert.deepEqual(up, { db: 9, bar: 2, own: 9 });
  assert.equal(measuredCaution(up, null), 'Suggested comes out up to 9 dB louder (from bar 2). Turn your speakers down before you listen.');
  // Said nothing more when the rules already warned about level, by about as much
  assert.equal(measuredCaution(up, 6), null);
  // Up 6 LU, or a quiet bar brought up only to the song's own level: nothing
  assert.equal(measuredRise(before, bars([[-14, -6], [-20, -6], [-20, -6], [-20, -6]]), song), null);
  // The true peak up by more than 6 dB over the song's highest: a warning even at the same loudness (said against the bar's own peak)
  assert.deepEqual(measuredRise(before, bars([[-20, -6], [-20, -6], [-30, 1], [-20, -6]]), song), { db: 7, bar: 3, own: 13 });
  // A song silent all through is compared with a quiet mix's loudness
  const silent = bars([[-Infinity, -Infinity], [-Infinity, -Infinity]]);
  assert.equal(measuredRise(silent, bars([[-24, -10], [-24, -10]]), { lufs: -Infinity, peak: -Infinity }), null);
  assert.deepEqual(measuredRise(silent, bars([[-24, -10], [SILENT_SONG_LUFS + 8, -1]]), { lufs: -Infinity, peak: -Infinity }), { db: 8, bar: 2, own: 8 + MEASURED_FLOOR_LU });
  // Bars the suggestion adds past the song's end are measured against the song
  assert.deepEqual(measuredRise(before, bars([[-20, -6], [-20, -6], [-30, -12], [-20, -6], [-10, -3]]), song), { db: 10, bar: 5, own: 10 + MEASURED_FLOOR_LU });
  // In a song not in 4/4, the bar as the ruler numbers it
  assert.match(measuredCaution({ db: 7.4, bar: 3, own: 7.4 }, null, { base: { num: 3, den: 4 }, points: [] }), /^Suggested comes out up to 7 dB louder \(from bar \d+( beat [\d.]+)?\)\./);
});

test("the measured caution says the bar's own rise against Now, not against the song's loudness (scan r31)", () => {
  assert.equal(MEASURED_FLOOR_LU, 20);
  const bars = (list) => list.map(([lufs, peak]) => ({ lufs, peak }));
  // The reviewer's wall of supersaws: bar 1 from -31.9 to -10.3 LUFS in a song of -26.9: +21.6 against Now, +16.6 against the song
  const song = { lufs: -26.9, peak: -10.5 };
  const before = bars([[-31.9, -14], [-34.2, -15], [-26.6, -11]]);
  const rise = measuredRise(before, bars([[-10.3, -1], [-10.3, -1], [-22.2, -9]]), song);
  assert.equal(rise.bar, 1);
  assert.ok(Math.abs(rise.db - 16.6) < 1e-9, String(rise.db));
  // (bar 2: -10.3 against -34.2)
  assert.ok(Math.abs(rise.own - 23.9) < 1e-9, String(rise.own));
  assert.equal(measuredCaution(rise, null), 'Suggested comes out up to 24 dB louder (from bar 1). Turn your speakers down before you listen.');
  // Deciding when to warn is as before: a quiet bar brought up only to the song's level says nothing, however far it rose
  assert.equal(measuredRise(bars([[-45, -30]]), bars([[-24, -10]]), song), null);
  // A silent bar of Now counts as MEASURED_FLOOR_LU under the song
  assert.equal(measuredRise(bars([[-Infinity, -Infinity]]), bars([[-12, -2]]), song).own, -12 - (-26.9 - MEASURED_FLOOR_LU));
  // Words for a caution measured before the musician's last edit
  assert.equal(measuredCaution(rise, null, null, true), 'Before your last edit, Suggested came out up to 24 dB louder (from bar 1). Turn your speakers down before you listen.');
});

test('a caution not about level (a delay fed back) leaves the measured caution to say how much louder; one about level, only when it measured clearly more (scan r31)', () => {
  const s = base();
  const [K, R] = [s.tracks[0].id, s.tracks.find((t) => t.name === 'Rain')?.id ?? s.tracks.at(-1).id];
  const marks = (ops, from = s) => safetyCautions(from, ap(from, ops));
  // The delay fed back: a caution, not about level
  const fb = marks([{ op: 'set_insert', trackId: R, insert: 'echo', settings: { on: true, feedback: 0.9 } }]);
  assert.equal(fb.length, 1);
  assert.match(fb[0].text, /the Delay feeds back at 90%/);
  assert.equal(fb[0].louder, undefined);
  assert.equal(louderSaid(fb), null);
  const rise = { db: 16.6, bar: 1, own: 21.6 };
  assert.equal(measuredCaution(rise, louderSaid(fb)), 'Suggested comes out up to 22 dB louder (from bar 1). Turn your speakers down before you listen.');
  // A lane feeding back, too
  const lane = marks([{ op: 'set_insert', trackId: R, insert: 'echo', settings: { on: true, feedback: 0.2 } }, { op: 'set_automation', trackId: R, param: 'fx:echo.feedback', points: [{ bar: 1, value: 0.95 }] }]);
  assert.ok(lane.length >= 1 && lane.every((c) => c.louder === undefined), JSON.stringify(lane));
  // A fader up 9 dB: about level, stating 9 dB
  const up = marks([{ op: 'set_track', trackId: K, volumeDb: s.tracks[0].volume + 9 }]);
  assert.equal(up.length, 1);
  assert.equal(up[0].louder, 9);
  assert.equal(louderSaid(up), 9);
  // ...so a measured 12 dB says nothing more, a measured 22 dB says it's more
  assert.equal(measuredCaution({ db: 10, bar: 1, own: 12 }, louderSaid(up)), null);
  assert.equal(measuredCaution(rise, louderSaid(up)), 'Suggested comes out up to 22 dB louder (from bar 1), more than the cautions above say. Turn your speakers down before you listen.');
  // A caution about level with no number counts as the line it crossed (6 dB)
  const loud = marks([{ op: 'set_master', loud: { on: true } }]);
  assert.equal(louderSaid(loud), TRACK_JUMP_DB);
  assert.equal(measuredCaution({ db: 10, bar: 1, own: 11 }, louderSaid(loud)), null);
  // applyOps says the same: cautioned only by a caution about level
  const r = applyOps(s, { opsVersion: 1, ops: [{ op: 'set_insert', trackId: R, insert: 'echo', settings: { on: true, feedback: 0.9 } }] }, { idBase: 'r31' });
  assert.equal(r.cautioned, false);
  assert.equal(r.louderSaid, null);
  const r2 = applyOps(s, { opsVersion: 1, ops: [{ op: 'set_track', trackId: K, volumeDb: s.tracks[0].volume + 9 }] }, { idBase: 'r31' });
  assert.equal(r2.cautioned, true);
  assert.equal(r2.louderSaid, 9);
});

test("a bar's loudness from a render's gating blocks", () => {
  // 100 ms hops: blocks centred at 0.2, 0.3, ... s; bar 1 is 0 to 1 s, bar 2 is 1 to 2 s
  const blocks = Array.from({ length: 20 }, (_, i) => ((i + 2) * 0.1 < 1 ? 1e-2 : 1e-1));
  const [b1, b2] = barLoudness(blocks, 0.1, [{ start: 0, end: 1 }, { start: 1, end: 2 }]);
  assert.ok(Math.abs(b1 - (-0.691 - 20)) < 1e-9, String(b1));
  assert.ok(Math.abs(b2 - (-0.691 - 10)) < 1e-9, String(b2));
  // Gated as integrated loudness is: a near-silent stretch in a bar doesn't pull it down
  const gaps = [1e-1, 1e-1, 1e-9, 1e-9, 1e-1, 1e-1, 1e-9, 1e-9];
  assert.ok(Math.abs(barLoudness(gaps, 0.1, [{ start: 0, end: 1 }])[0] - (-0.691 - 10)) < 1e-9);
  // A bar shorter than a hop reads the block nearest its middle; silence is -Infinity
  assert.ok(Number.isFinite(barLoudness(blocks, 0.1, [{ start: 0.5, end: 0.55 }])[0]));
  assert.equal(barLoudness([0, 0, 0], 0.1, [{ start: 0, end: 0.3 }])[0], -Infinity);
});
