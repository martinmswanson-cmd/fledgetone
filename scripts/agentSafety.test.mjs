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
const { checkSafety, TRACK_JUMP_DB, MASTER_JUMP_DB } = await import('../src/agent/safety.ts');
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
