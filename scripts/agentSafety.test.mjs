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
  assert.match(checkSafety(a, { ...a, master: { ...a.master, clipper: { on: true, drive: 4, softness: 0.5, ceiling: -1 } } })[0], /clipper/);
  // (switched on adding no more than 3 dB: only a note)
  const notes = [];
  assert.deepEqual(checkSafety(a, { ...a, master: { ...a.master, clipper: { on: true, drive: 3, softness: 0.5, ceiling: -1 } } }, notes), []);
  assert.match(notes.join(' '), /switches on the master clipper at 3 dB of drive: it plays up to 3 dB louder/);
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
  assert.equal(warningsFor([{ op: 'set_master', ott: { on: true, depth: 1, inGain: 0, outGain: 0 } }]), 'This switches on the master OTT at 100% depth: its quiet parts come up by as much as 7.2 dB. Turn your speakers down before you listen.');
  const on = ap(a, [{ op: 'set_master', ott: { on: true, depth: 0.2 } }]);
  assert.equal(warningsFor([{ op: 'set_master', ott: { depth: 1 } }], on), 'The master OTT is pushed much harder (20% to 100% depth): its quiet parts come up by as much as 5.8 dB. Turn your speakers down before you listen.');
  assert.equal(warningsFor([{ op: 'set_master', ott: { depth: 0.4 } }], on), '');
});

test('the master OTT switched on at depth 0 (or hardly any) lifts nothing: no caution; its gains still count (scan r31)', () => {
  // Each band's gain goes with the depth (ott.ts): at depth 0 the OTT passes the song through, but for its gains
  assert.equal(OTT_FULL_LIFT_DB, 7.2);
  assert.equal(warningsFor([{ op: 'set_master', ott: { on: true, depth: 0 } }]), '');
  assert.equal(warningsFor([{ op: 'set_master', ott: { on: true, depth: 0.4, inGain: 0, outGain: 0 } }]), '');
  assert.equal(warningsFor([{ op: 'set_master', ott: { on: true, depth: 0, inGain: -12, outGain: 3 } }]), '');
  // 7.2 x 0.5 = 3.6 dB, over the master's 3: a caution
  assert.match(warningsFor([{ op: 'set_master', ott: { on: true, depth: 0.5, inGain: 0, outGain: 0 } }]), /^This switches on the master OTT at 50% depth: its quiet parts come up by as much as 3\.6 dB\./);
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
  const muted = { ...s, tracks: s.tracks.map((t, i) => (i === 0 ? { ...t, isMuted: true } : t)) };
  const loud = marks([{ op: 'set_track', trackId: K, mute: false }], muted);
  assert.ok(loud.length === 1 && /unmutes/.test(loud[0].text), JSON.stringify(loud));
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

// ---- Round 32: the master's switches state what they add; switched off, a cut taken away ----

test('the clipper or the Loud master switched on states the gain it adds; adding 3 dB or less is only a note, and leaves the sound check to say how much louder (scan r32)', async () => {
  const { safetyCautions, louderSaid, measuredCaution } = await import('../src/agent/safety.ts');
  const q = { ...base(), master: { ...base().master, level: -14 } };
  const run = (set) => {
    const notes = [];
    const c = safetyCautions(q, ap(q, [{ op: 'set_master', ...set }]), notes);
    return { c, notes, said: louderSaid(c) };
  };
  // Drive 11 into the clipper: measured +11.0 LU, true peak +11.0 dB
  const clip = run({ clipper: { on: true, drive: 11, ceiling: 0 } });
  assert.deepEqual(clip.c, [{ text: 'This switches on the master clipper at 11 dB of drive: the song comes out up to 11 dB louder. Turn your speakers down before you listen.', louder: 11 }]);
  // Pushed 11: measured +11.0 LU
  const loud = run({ loud: { on: true, push: 11 } });
  assert.deepEqual(loud.c, [{ text: 'This switches on the Loud master, pushed 11 dB: the song comes out 11 dB louder. Turn your speakers down before you listen.', louder: 11 }]);
  // ...so a measured 18 dB still says it's more
  assert.match(measuredCaution({ db: 18, bar: 1, own: 18 }, loud.said), /up to 18 dB louder \(from bar 1\), more than the cautions above say/);
  // Drive 0, push 0 (measured the same in every bar), push -12: no caution, a note, and nothing hides the sound check
  for (const set of [{ clipper: { on: true, drive: 0, ceiling: 0 } }, { loud: { on: true, push: 0 } }, { loud: { on: true, push: -12 } }]) {
    const r = run(set);
    assert.deepEqual(r.c, [], JSON.stringify(set));
    assert.equal(r.said, null);
    assert.equal(r.notes.length, 1);
    assert.match(r.notes[0], /plays no louder/);
    assert.doesNotMatch(r.notes[0], /gets louder/);
    assert.equal(measuredCaution({ db: 9.9, bar: 6, own: 9.9 }, r.said), 'Suggested comes out up to 10 dB louder (from bar 6). Turn your speakers down before you listen.');
  }
  // A little drive or push: a note with its number
  assert.deepEqual(run({ loud: { on: true, push: 2 } }).notes, ['This switches on the Loud master: it plays up to 2 dB louder.']);
  // The sub tilt adds to the lows: up 4 is a caution (the lows), with the push it adds up
  assert.deepEqual(run({ loud: { on: true, push: 0, subTilt: 4 } }).c, [{ text: 'This switches on the Loud master with its sub tilt up 4 dB: the lows come out up to 4 dB louder. Turn your speakers down before you listen.', louder: 4 }]);
  assert.equal(run({ loud: { on: true, push: 5, subTilt: 2 } }).c[0].text, 'This switches on the Loud master, pushed 5 dB with its sub tilt up 2 dB: the song comes out up to 7 dB louder. Turn your speakers down before you listen.');
  // (a tilt under a cut push: no part of the song comes out louder)
  assert.deepEqual(run({ loud: { on: true, push: -6, subTilt: 4 } }).c, []);
});

test('the OTT switched on is judged by how much it lifts the song only, not by the depth it was left at while off (scan r32)', async () => {
  const { safetyCautions } = await import('../src/agent/safety.ts');
  const q = { ...base(), master: { ...base().master, level: -14 } };
  assert.equal(q.master.ott.on, false);
  assert.equal(q.master.ott.depth, 0.5);
  // Measured: -0.5, +1.2, +1.6 LU
  for (const ott of [{ on: true, depth: 1, outGain: -6 }, { on: true, depth: 0.95, outGain: -4 }, { on: true, depth: 0.5, outGain: -1 }]) assert.deepEqual(safetyCautions(q, ap(q, [{ op: 'set_master', ott }])), [], JSON.stringify(ott));
  // Still a caution when it lifts the song by more than 3 dB, and pushed harder while on
  assert.match(safetyCautions(q, ap(q, [{ op: 'set_master', ott: { on: true, depth: 1 } }]))[0].text, /switches on the master OTT/);
  const on = ap(q, [{ op: 'set_master', ott: { on: true, depth: 0.3, outGain: -3 } }]);
  assert.match(safetyCautions(on, ap(on, [{ op: 'set_master', ott: { depth: 1 } }]))[0].text, /pushed much harder \(30% to 100% depth\)/);
});

test('the Loud master, the OTT or the clipper switched off where it held the song down: a caution with the number, in switch-off words (scan r32)', async () => {
  const { safetyCautions } = await import('../src/agent/safety.ts');
  const q = { ...base(), master: { ...base().master, level: 0 } };
  const off = (master, set) => {
    const from = { ...q, master: { ...q.master, ...master } };
    return safetyCautions(from, ap(from, [{ op: 'set_master', ...set }]));
  };
  // Measured +12.0 LU each
  assert.deepEqual(off({ loud: { on: true, target: 'loud', push: -12, subTilt: 0 } }, { loud: { on: false } }), [
    { text: 'Switching off the Loud master takes away its 12 dB cut: the song comes out 12 dB louder. Turn your speakers down before you listen.', louder: 12 },
  ]);
  assert.deepEqual(off({ ott: { ...q.master.ott, on: true, depth: 0, outGain: -12, inGain: 0 } }, { ott: { on: false } }), [
    { text: 'Switching off the master OTT takes away its 12 dB cut: the song comes out 12 dB louder. Turn your speakers down before you listen.', louder: 12 },
  ]);
  assert.deepEqual(off({ ott: { ...q.master.ott, on: true, depth: 0, outGain: 0, inGain: -12 } }, { ott: { on: false } }), [
    { text: 'Switching off the master OTT takes away its 12 dB cut: the song comes out 12 dB louder. Turn your speakers down before you listen.', louder: 12 },
  ]);
  // ...and the in gain's cut taken away while it stays on (at depth 0 a plain gain)
  assert.match(off({ ott: { ...q.master.ott, on: true, depth: 0, outGain: 0, inGain: -12 } }, { ott: { inGain: 0 } })[0].text, /The master OTT's gain goes up by 12 dB/);
  // The clipper's ceiling: switched off or raised, its peaks come back up to the limiter (measured: true peak +10.3 dB)
  const clip = { clipper: { on: true, drive: 0, softness: 0.3, ceiling: -12 } };
  assert.deepEqual(off(clip, { clipper: { on: false } }), [
    { text: 'Switching off the master clipper takes away its ceiling at -12 dB: the peaks it held down come up by as much as 11 dB. Turn your speakers down before you listen.', louder: 11 },
  ]);
  assert.deepEqual(off(clip, { clipper: { ceiling: 0 } }), [
    { text: "The master clipper's ceiling goes up from -12 to 0 dB: the peaks it held down come up by as much as 11 dB. Turn your speakers down before you listen.", louder: 11 },
  ]);
  // The sub tilt raised while on (measured: the lows about 6 dB up)
  assert.deepEqual(off({ loud: { on: true, target: 'loud', push: 0, subTilt: -4 } }, { loud: { subTilt: 4 } }), [
    { text: "The Loud master's sub tilt goes up by 8 dB: the lows come out up to 8 dB louder. Turn your speakers down before you listen.", louder: 8 },
  ]);
  // Quiet: switched off where they turned it up or held nothing down (the clipper at drive 11: measured 11 LU quieter)
  assert.deepEqual(off({ loud: { on: true, target: 'loud', push: 6, subTilt: 2 } }, { loud: { on: false } }), []);
  assert.deepEqual(off({ ott: { ...q.master.ott, on: true, depth: 1, outGain: 6, inGain: 3 } }, { ott: { on: false } }), []);
  assert.deepEqual(off({ ott: { ...q.master.ott, on: true, depth: 0, outGain: 0, inGain: 6 } }, { ott: { inGain: 0, outGain: 6 } }), []);
  assert.deepEqual(off({ clipper: { on: true, drive: 11, softness: 0.3, ceiling: 0 } }, { clipper: { on: false } }), []);
  assert.deepEqual(off({ clipper: { on: true, drive: 3, softness: 0.3, ceiling: -3 } }, { clipper: { on: false } }), []);
  assert.deepEqual(off({ clipper: { on: true, drive: 3, softness: 0.3, ceiling: -1 } }, { clipper: { ceiling: 0 } }), []);
});

// ---- Round 33: the clipper's drive and ceiling together, the OTT's in gain cut, small master rises adding up ----

test('the clipper driven harder with its ceiling raised: one caution with the larger rise and "Turn your speakers down" (scan r33)', async () => {
  const { safetyCautions } = await import('../src/agent/safety.ts');
  const q = { ...base(), master: { ...base().master, level: 0, clipper: { on: true, drive: 0, softness: 0.5, ceiling: -12 } } };
  const run = (clipper) => safetyCautions(q, ap(q, [{ op: 'set_master', clipper }]));
  // Drive +5 and the ceiling -12 to 0: measured +5.7 LU, true peak +10.9 dB (it said only "driven 5 dB harder")
  assert.deepEqual(run({ drive: 5, ceiling: 0 }), [
    { text: 'The master clipper is driven 5 dB harder and its ceiling goes up from -12 to 0 dB: the song comes out up to 11 dB louder. Turn your speakers down before you listen.', louder: 11 },
  ]);
  // Drive +2 with the same ceiling (measured: true peak +10.9 dB): the same caution, as before with 11
  assert.equal(run({ drive: 2, ceiling: 0 })[0].louder, 11);
  assert.match(run({ drive: 2, ceiling: 0 })[0].text, /^The master clipper is driven 2 dB harder and its ceiling goes up from -12 to 0 dB: the song comes out up to 11 dB louder\. Turn your speakers down/);
  // The drive alone, or the ceiling alone, keep their own words
  assert.deepEqual(run({ drive: 5 }), [{ text: 'The master clipper is driven 5 dB harder.', louder: 5 }]);
  assert.match(run({ ceiling: 0 })[0].text, /^The master clipper's ceiling goes up from -12 to 0 dB: the peaks it held down come up by as much as 11 dB/);
  // A drive well over the ceiling's small rise: the drive's number
  const high = { ...q, master: { ...q.master, clipper: { on: true, drive: 2, softness: 0.5, ceiling: -6 } } };
  assert.deepEqual(safetyCautions(high, ap(high, [{ op: 'set_master', clipper: { drive: 8, ceiling: -5 } }])), [
    { text: 'The master clipper is driven 6 dB harder and its ceiling goes up from -6 to -5 dB: the song comes out up to 6 dB louder. Turn your speakers down before you listen.', louder: 6 },
  ]);
  // Both small: nothing
  assert.deepEqual(run({ drive: 2, ceiling: -10 }), []);
});

test('the OTT in gain cut counts: switched on at depth 0 with in -6 and out +4 is no caution, and leaves the sound check its say (scan r33)', async () => {
  const { safetyCautions, louderSaid, measuredCaution, OTT_IN_EASE } = await import('../src/agent/safety.ts');
  assert.equal(OTT_IN_EASE, 0.6);
  const q = { ...base(), master: { ...base().master, level: -14 } };
  const run = (ott, from = q) => {
    const notes = [];
    const c = safetyCautions(from, ap(from, [{ op: 'set_master', ott }]), notes);
    return { c, said: louderSaid(c) };
  };
  // Measured -2 LU: no caution, so an organ swapped beside it (measured 7.9 dB louder) is warned about
  const d0 = run({ on: true, depth: 0, inGain: -6, outGain: 4 });
  assert.deepEqual(d0.c, []);
  assert.equal(d0.said, null);
  assert.equal(measuredCaution({ db: 7.9, bar: 8, own: 7.9 }, d0.said), 'Suggested comes out up to 8 dB louder (from bar 8). Turn your speakers down before you listen.');
  // Depth 0 and in -12, out +4 (measured -8 LU); depth 0.4, in -6, out +3 (measured 0.0 LU in its loudest bar)
  assert.deepEqual(run({ on: true, depth: 0, inGain: -12, outGain: 4 }).c, []);
  assert.deepEqual(run({ on: true, depth: 0.4, inGain: -6, outGain: 3 }).c, []);
  // At full depth its upward compression lifts much of the cut back: in -12, out +4 is still a caution
  // (measured: up to 3.6 LU in a bar; said 7.2 - 12 x 0.4 + 4 = 6.4), and at depth 1 with no gain, 7.2
  const full = run({ on: true, depth: 1, inGain: -12, outGain: 4 }).c;
  assert.deepEqual(full.map((c) => c.text), ['This switches on the master OTT at 100% depth: its quiet parts come up by as much as 6.4 dB. Turn your speakers down before you listen.']);
  assert.ok(Math.abs(full[0].louder - 6.4) < 1e-9);
  assert.equal(run({ on: true, depth: 1, inGain: 0, outGain: 0 }).c[0].louder, 7.2);
  // While it's on, the same: in 0 to -6 with out 0 to +4 at depth 0 (measured -2 LU) is no caution
  const on0 = ap(q, [{ op: 'set_master', ott: { on: true, depth: 0, inGain: 0, outGain: 0 } }]);
  assert.deepEqual(run({ inGain: -6, outGain: 4 }, on0).c, []);
  // ...and an in gain raised still counts in full
  assert.match(run({ inGain: 6 }, on0).c[0].text, /^The master OTT's gain goes up by 6 dB\.$/);
});

test('small rises on several master controls add up: one caution with their sum (scan r33)', async () => {
  const { safetyCautions } = await import('../src/agent/safety.ts');
  const q = { ...base(), master: { ...base().master, level: -14, loud: { on: true, target: 'loud', push: 0, subTilt: 0 }, clipper: { on: true, drive: 0, softness: 0.5, ceiling: 0 } } };
  const run = (set, from = q) => safetyCautions(from, ap(from, [{ op: 'set_master', ...set }]));
  const together = (n) => ({ text: `Together these master changes make the song up to ${n} dB louder. Turn your speakers down before you listen.`, louder: n });
  // Level, push and drive up 3 each: measured +9 LU, +9 dB true peak (it said nothing)
  assert.deepEqual(run({ levelDb: -11, loud: { push: 3 }, clipper: { drive: 3 } }), [together(9)]);
  assert.deepEqual(run({ levelDb: -12, loud: { push: 2 } }), [together(4)]);
  // One already over the line says its own; the sum says more
  assert.deepEqual(run({ levelDb: -10, loud: { push: 3 } }), [{ text: 'The master Level goes up by 4 dB. Turn your speakers down before you listen.', louder: 4 }, together(7)]);
  // The OTT switched on with its out gain up counts too
  const plain = { ...q, master: { ...q.master, loud: undefined, clipper: undefined } };
  assert.deepEqual(run({ levelDb: -11, ott: { on: true, depth: 0, inGain: 0, outGain: 3 } }, plain), [together(6)]);
  // A rise taken back by a cut, a single control, or a caution that already says as much: nothing more
  assert.deepEqual(run({ levelDb: -11, loud: { push: -3 } }), []);
  assert.deepEqual(run({ levelDb: -12, loud: { push: 1 } }), []);
  assert.deepEqual(run({ levelDb: -11 }), []);
  assert.deepEqual(run({ loud: { push: 8 }, clipper: { drive: 1 } }).map((c) => c.text), ['The Loud master pushes 8 dB harder.', 'Together these master changes make the song up to 9 dB louder. Turn your speakers down before you listen.']);
  assert.deepEqual(run({ levelDb: -13, loud: { push: 8 } }).length, 2);
  // (the Level down 1 takes 1 dB off the push's 8: measured, see the next test)
  assert.deepEqual(run({ levelDb: -15, loud: { push: 8 } }), [{ text: 'The Loud master pushes 8 dB harder, but other master changes in this suggestion turn part of it back down: together they make the song up to 7 dB louder. Turn your speakers down before you listen.', louder: 7 }]);
  assert.deepEqual(run({ loud: { push: 8 } }), [{ text: 'The Loud master pushes 8 dB harder.', louder: 8 }]);
});

// ---- Round 34: a master plain gain's rise turned back down by another's cut ----

test('a master Level rise taken back by a cut on another master gain: a note, or a caution with the net (scan r34)', async () => {
  const { safetyCautions, louderSaid } = await import('../src/agent/safety.ts');
  const q = { ...base(), master: { ...base().master, level: -20, loud: { on: true, target: 'loud', push: 0, subTilt: 0 }, clipper: { on: true, drive: 6, softness: 0.5, ceiling: 0 }, ott: { ...base().master.ott, on: true, depth: 0, inGain: 0, outGain: 0 } } };
  const run = (set, from = q) => {
    const notes = [];
    const c = safetyCautions(from, ap(from, [{ op: 'set_master', ...set }]), notes);
    return { c, notes, said: louderSaid(c) };
  };
  const back = (what) => `${what}, but other master changes in this suggestion turn it back down.`;
  // Level +4 with the OTT's out gain -4 (on, depth 0), or with the push -4: measured 0 LU, 0 dB peak
  for (const set of [{ levelDb: -16, ott: { outGain: -4 } }, { levelDb: -16, loud: { push: -4 } }, { levelDb: -16, clipper: { drive: 2 } }]) {
    const r = run(set);
    assert.deepEqual(r.c, []);
    assert.equal(r.said, null);
    assert.deepEqual(r.notes, [back('The master Level goes up by 4 dB')]);
  }
  // The other way round: the push, the OTT's gain or the drive up, the Level down as much
  assert.deepEqual(run({ levelDb: -24, loud: { push: 4 } }).notes, [back('The Loud master pushes 4 dB harder')]);
  assert.deepEqual(run({ levelDb: -24, ott: { outGain: 4 } }).notes, [back("The master OTT's gain goes up by 4 dB")]);
  assert.deepEqual(run({ levelDb: -24, clipper: { drive: 10 } }).c, []);
  // Part of it taken back, the rest no more than 3 dB: a note with what's left (Level +4, push -2)
  const part = run({ levelDb: -16, loud: { push: -2 } });
  assert.deepEqual(part.c, []);
  assert.deepEqual(part.notes, ['The master Level goes up by 4 dB, but other master changes in this suggestion turn most of it back down: together they make the song up to 2 dB louder.']);
  // ...more than 3 dB left (Level +6, push -2: measured +4 LU): a caution with the net, and the net is what it says
  const net = run({ levelDb: -14, loud: { push: -2 } });
  assert.deepEqual(net.c, [{ text: 'The master Level goes up by 6 dB, but other master changes in this suggestion turn part of it back down: together they make the song up to 4 dB louder. Turn your speakers down before you listen.', louder: 4 }]);
  assert.equal(net.said, 6);
  // Two rises over the line taken back by one cut: one caution naming both
  assert.deepEqual(run({ levelDb: -15, loud: { push: 5 }, clipper: { drive: 0 } }).c, [
    { text: 'The master Level goes up by 5 dB and the Loud master pushes 5 dB harder, but other master changes in this suggestion turn part of them back down: together they make the song up to 4 dB louder. Turn your speakers down before you listen.', louder: 4 },
  ]);
  // Ear safety: a cut that doesn't hold the whole song down takes nothing off
  // (the sub tilt raised 5 with the push cut 4: the lows come up by the tilt as well, so the Level's caution stays)
  assert.deepEqual(run({ levelDb: -16, loud: { push: -4, subTilt: 5 } }).c, [{ text: 'The master Level goes up by 4 dB. Turn your speakers down before you listen.', louder: 4 }]);
  // (the OTT's depth eased: only its quiet parts come down)
  const deep = { ...q, master: { ...q.master, ott: { ...q.master.ott, depth: 1 } } };
  assert.deepEqual(run({ levelDb: -16, ott: { depth: 0 } }, deep).c, [{ text: 'The master Level goes up by 4 dB. Turn your speakers down before you listen.', louder: 4 }]);
  // (the Loud master or the clipper switched off: their push or drive goes with their clipper)
  const pushed = { ...q, master: { ...q.master, loud: { ...q.master.loud, push: 4 } } };
  assert.deepEqual(run({ levelDb: -16, loud: { on: false } }, pushed).c, [{ text: 'The master Level goes up by 4 dB. Turn your speakers down before you listen.', louder: 4 }]);
  assert.deepEqual(run({ levelDb: -16, clipper: { on: false } }).c, [{ text: 'The master Level goes up by 4 dB. Turn your speakers down before you listen.', louder: 4 }]);
  // The Level up alone, or with other rises: as before
  assert.deepEqual(run({ levelDb: -16 }).c, [{ text: 'The master Level goes up by 4 dB. Turn your speakers down before you listen.', louder: 4 }]);
  assert.deepEqual(run({ levelDb: -16, loud: { push: 2 } }).c.map((c) => c.louder), [4, 6]);
});

// ---- Round 35: the Loud master's sub tilt counts with the other master rises ----

test("the sub tilt's rise counts with the master's plain gains: one caution with their sum, the lows most (scan r35)", async () => {
  const { safetyCautions, louderSaid } = await import('../src/agent/safety.ts');
  const q = { ...base(), master: { ...base().master, level: -20, loud: { on: true, target: 'loud', push: 0, subTilt: 0 }, ott: { ...base().master.ott, on: true, depth: 0, inGain: 0, outGain: 0 } } };
  const run = (set, from = q) => {
    const notes = [];
    const c = safetyCautions(from, ap(from, [{ op: 'set_master', ...set }]), notes);
    return { c, notes, said: louderSaid(c) };
  };
  const lows = (n) => ({ text: `Together these master changes make the song up to ${n} dB louder (the lows most). Turn your speakers down before you listen.`, louder: n });
  // Level +2.9 with the sub tilt +2.9 (measured +3.6 LU, +4.4 dB peak), or the OTT's out gain with it: it said nothing
  assert.deepEqual(run({ levelDb: -17.1, loud: { subTilt: 2.9 } }).c.map((c) => c.text), [lows(5.8).text]);
  assert.deepEqual(run({ ott: { outGain: 2.9 }, loud: { subTilt: 2.9 } }).c.map((c) => c.text), [lows(5.8).text]);
  // The Loud master switched on at push 0 with its tilt 2.9, the Level +2.9: its note, and a numbered caution
  const off = { ...q, master: { ...q.master, loud: undefined } };
  const on = run({ levelDb: -17.1, loud: { on: true, push: 0, subTilt: 2.9 } }, off);
  assert.deepEqual(on.notes, ['This switches on the Loud master: it plays up to 2.9 dB louder.']);
  assert.deepEqual(on.c.map((c) => c.text), [lows(5.8).text]);
  assert.ok(on.said > 5.7);
  // Level, push and tilt up 3 each (measured 6.9 LU in a bar, +7.6 dB peak): the sum, over the Loud master's own 6
  const all = run({ levelDb: -17, loud: { push: 3, subTilt: 3 } });
  assert.deepEqual(all.c.map((c) => c.louder), [6, 9]);
  assert.equal(all.c[1].text, lows(9).text);
  // Level +4 and tilt +4 (measured 5.3 LU, +6.2 dB peak): their two cautions, and the sum
  assert.deepEqual(run({ levelDb: -16, loud: { subTilt: 4 } }).c.map((c) => c.louder), [4, 4, 8]);
  // The tilt alone, a tilt cut, or a sum no more than 3 dB: nothing more
  assert.deepEqual(run({ loud: { subTilt: 2 } }).c, []);
  assert.deepEqual(run({ levelDb: -18.5, loud: { subTilt: 1.5 } }).c, []);
  assert.deepEqual(run({ loud: { push: 5, subTilt: -5 } }).c.map((c) => c.text), ['The Loud master pushes 5 dB harder.']);
  // A Level rise taken back by a cut, the tilt up as well: its own caution says as much
  assert.deepEqual(run({ levelDb: -16, loud: { push: -4, subTilt: 4 } }).c, [{ text: 'The master Level goes up by 4 dB. Turn your speakers down before you listen.', louder: 4 }]);
});

// ---- Round 36: a control switched on is weighed with the other master changes ----

test('the clipper, the Loud master or the OTT switched on, taken back by the Level: a note (scan r36)', async () => {
  const { safetyCautions, louderSaid } = await import('../src/agent/safety.ts');
  const q = { ...base(), master: { ...base().master, level: -12, loud: undefined, clipper: undefined } };
  const run = (set, from = q) => {
    const notes = [];
    const c = safetyCautions(from, ap(from, [{ op: 'set_master', ...set }]), notes);
    return { c, notes, said: louderSaid(c) };
  };
  const back = (what) => `${what}, but other master changes in this suggestion turn it back down.`;
  // Switched on at drive 6 (ceiling 0 or -1) or push 6 with the Level -6: measured 0 LU, 0 dB true peak (it said "6 dB louder")
  for (const [set, what] of [
    [{ levelDb: -18, clipper: { on: true, drive: 6, ceiling: 0 } }, 'This switches on the master clipper at 6 dB of drive'],
    [{ levelDb: -18, clipper: { on: true, drive: 6 } }, 'This switches on the master clipper at 6 dB of drive'],
    [{ levelDb: -18, loud: { on: true, push: 6 } }, 'This switches on the Loud master, pushed 6 dB'],
    [{ levelDb: -18, ott: { on: true, depth: 0, inGain: 0, outGain: 6 } }, 'This switches on the master OTT'],
  ]) {
    const r = run(set);
    assert.deepEqual(r.c, [], what);
    assert.equal(r.said, null);
    assert.deepEqual(r.notes, [back(what)]);
  }
  // Taken back in part: the net, with its own words first
  assert.deepEqual(run({ levelDb: -14, clipper: { on: true, drive: 6, ceiling: 0 } }).c, [
    { text: 'This switches on the master clipper at 6 dB of drive, but other master changes in this suggestion turn part of it back down: together they make the song up to 4 dB louder. Turn your speakers down before you listen.', louder: 4 },
  ]);
  // Two switched on, one cut: both named
  assert.deepEqual(run({ levelDb: -22, clipper: { on: true, drive: 5, ceiling: 0 }, loud: { on: true, push: 5 } }).notes, [
    back('This switches on the Loud master, pushed 5 dB and this switches on the master clipper at 5 dB of drive').replace('turn it back', 'turn them back'),
  ]);
  // Alone, as before; with its sub tilt, what the lows come to (tilt 4, Level -2: up to 2 dB)
  assert.deepEqual(run({ clipper: { on: true, drive: 6, ceiling: 0 } }).c, [{ text: 'This switches on the master clipper at 6 dB of drive: the song comes out up to 6 dB louder. Turn your speakers down before you listen.', louder: 6 }]);
  const tilted = run({ levelDb: -14, loud: { on: true, push: 0, subTilt: 4 } });
  assert.deepEqual(tilted.c, []);
  assert.deepEqual(tilted.notes, ['This switches on the Loud master with its sub tilt up 4 dB, but other master changes in this suggestion turn most of it back down: together they make the song up to 2 dB louder.']);
  // A control switched off is no cut: the Loud master switched off at push +6 doesn't fold the clipper switched on
  const pushed = { ...q, master: { ...q.master, loud: { on: true, target: 'loud', push: 6, subTilt: 0 } } };
  assert.deepEqual(run({ loud: { on: false }, clipper: { on: true, drive: 6, ceiling: 0 } }, pushed).c.map((c) => c.louder), [6]);
});

test('a change of the master glue style counts what it can add: Tight to Off says so, with other rises the sum (scan r36)', async () => {
  const { safetyCautions, GLUE_RISE_DB } = await import('../src/agent/safety.ts');
  const tight = { ...base(), master: { ...base().master, level: -20, glue: 'tight', loud: { on: true, target: 'loud', push: 0, subTilt: 0 } } };
  const run = (set, from = tight) => {
    const notes = [];
    return { c: safetyCautions(from, ap(from, [{ op: 'set_master', ...set }]), notes), notes };
  };
  // Measured (loudest bar or true peak, the most of six songs): never a cut, and no style to itself
  for (const [from, to] of Object.entries(GLUE_RISE_DB).flatMap(([f, row]) => Object.keys(row).map((t) => [f, t]))) {
    assert.ok(GLUE_RISE_DB[from][to] >= 0);
    if (from === to) assert.equal(GLUE_RISE_DB[from][to], 0);
  }
  // Tight to Off alone: +3.8 dB true peak on a hot mix (it said nothing)
  assert.deepEqual(run({ glue: 'off' }).c, [{ text: 'The master glue goes from Tight to Off: the peaks it held down come up by as much as 4 dB. Turn your speakers down before you listen.', louder: 4 }]);
  // ...with the Level and the push up 2.5 each: +8.5 dB true peak (it said 5)
  assert.deepEqual(run({ glue: 'off', levelDb: -17.5, loud: { push: 2.5 } }).c.map((c) => c.louder), [4, 9]);
  // ...taken back by the Level: a note
  assert.deepEqual(run({ glue: 'off', levelDb: -24 }).c, []);
  assert.deepEqual(run({ glue: 'off', levelDb: -24 }).notes, ['The master glue goes from Tight to Off, but other master changes in this suggestion turn it back down.']);
  // Gentle to Punchy with the Level +2.5 on a quiet song: +3.7 LU (it said nothing)
  const gentle = { ...tight, master: { ...tight.master, glue: 'gentle' } };
  assert.deepEqual(run({ glue: 'punchy', levelDb: -17.5 }, gentle).c, [{ text: 'Together these master changes make the song up to 4 dB louder. Turn your speakers down before you listen.', louder: 4 }]);
  // A glue change alone under 3 dB, or with a rise that stays under 3 together: nothing
  for (const glue of ['off', 'standard', 'punchy', 'tight']) assert.deepEqual(run({ glue }, gentle).c, [], glue);
  assert.deepEqual(run({ glue: 'tight' }, { ...tight, master: { ...tight.master, glue: 'off' } }).c, []);
  assert.deepEqual(run({ glue: 'standard', levelDb: -19 }, gentle).c, []);
  // A glue change the other way never takes a rise back (Off to Tight is +2.3 LU on a quiet song)
  const off = { ...tight, master: { ...tight.master, glue: 'off' } };
  assert.deepEqual(run({ glue: 'tight', levelDb: -16 }, off).c.map((c) => c.louder), [4, 6.5]);
});

// ---- Round 37: the OTT's lift goes with how quietly the song is fed into it; a band-pass is never a boost ----

test('the master OTT switched on: what its quiet parts can come up by goes with how quietly the song is fed into it (scan r37)', async () => {
  const { safetyCautions, louderSaid, ottLiftDb, OTT_LIFT_MAX_DB } = await import('../src/agent/safety.ts');
  const run = (from, set) => {
    const notes = [];
    const c = safetyCautions(from, ap(from, [{ op: 'set_master', ...set }]), notes);
    return { c, notes, said: louderSaid(c) };
  };
  // Lo-Fi (faders summing to 0.3 dB): 7.2 at full depth (measured +7.0 LU in its loudest-rising bar)
  const lofi = base();
  assert.ok(Math.abs(ottLiftDb(lofi) - 7.2) < 1e-9);
  // Ambient (faders summing to -7.1 dB): 14.3 (measured +13.6 LU in a bar, +8.6 whole; it said 6.7)
  const amb = createStarter('ambient');
  assert.equal(Math.round(ottLiftDb(amb) * 10) / 10, 14.3);
  assert.deepEqual(run(amb, { ott: { on: true, depth: 1 } }).c.map((c) => c.text), ['This switches on the master OTT at 100% depth: its quiet parts come up by as much as 14.3 dB. Turn your speakers down before you listen.']);
  // Its depth scales it (measured +5.1 LU at 0.4, it said nothing), its out gain is a plain gain (depth 1, out -4: +9.6 LU, it said nothing)
  assert.deepEqual(run(amb, { ott: { on: true, depth: 0.4 } }).c.map((c) => c.louder.toFixed(1)), ['5.7']);
  assert.deepEqual(run(amb, { ott: { on: true, depth: 1, outGain: -4 } }).c.map((c) => c.louder.toFixed(1)), ['10.3']);
  // The Level down 4 with it is weighed against it, and leaves a caution (measured +9.6 LU in a bar; it made it a note of 2.7)
  const lv4 = run(amb, { levelDb: amb.master.level - 4, ott: { on: true, depth: 1 } });
  assert.deepEqual(lv4.c.map((c) => c.text), ['This switches on the master OTT at 100% depth, but other master changes in this suggestion turn part of it back down: together they make the song up to 10.3 dB louder. Turn your speakers down before you listen.']);
  assert.deepEqual(lv4.notes, []);
  // Quieter still, more: its faders 10 dB down (measured +19.5 LU), never more than the OTT can lift
  const quiet = { ...amb, tracks: amb.tracks.map((t) => ({ ...t, volume: t.volume - 10 })) };
  assert.equal(Math.round(ottLiftDb(quiet) * 10) / 10, 24);
  assert.equal(ottLiftDb({ ...amb, tracks: amb.tracks.map((t) => ({ ...t, volume: -60 })) }), OTT_LIFT_MAX_DB);
  // A muted track isn't fed into it, nor one without clips
  const muted = { ...lofi, tracks: lofi.tracks.map((t, i) => (i === 4 ? t : { ...t, isMuted: true })) };
  assert.ok(ottLiftDb(muted) > ottLiftDb(lofi) + 10);
  // Any depth, even under the line, is at least a note (Lo-Fi at depth 0.25: +1.6 LU)
  const quarter = run(lofi, { ott: { on: true, depth: 0.25 } });
  assert.deepEqual(quarter.c, []);
  assert.deepEqual(quarter.notes, ['This switches on the master OTT at 25% depth: its quiet parts come up by as much as 1.8 dB.']);
  assert.deepEqual(run(lofi, { ott: { on: true, depth: 0.5, inGain: -6 } }).notes, ['This switches on the master OTT at 50% depth: it brings the quiet parts up, and its gains keep the song no louder.']);
  // ...at depth 0, only its gains
  assert.deepEqual(run(lofi, { ott: { on: true, depth: 0 } }).notes, []);
  // An in gain raised at depth is eased a little (Lo-Fi, depth 1, in +6: +10.1 LU; said 7.2 + 6 x 0.7)
  assert.deepEqual(run(lofi, { ott: { on: true, depth: 1, inGain: 6 } }).c.map((c) => c.louder.toFixed(1)), ['11.4']);
  // Pushed harder while on, by the same lift: Ambient 0.3 to 1 is 10 dB, Lo-Fi 0.2 to 0.6 is 2.9, nothing
  const ambOn = ap(amb, [{ op: 'set_master', ott: { on: true, depth: 0.3 } }]);
  assert.deepEqual(run(ambOn, { ott: { depth: 1 } }).c.map((c) => c.text), ['The master OTT is pushed much harder (30% to 100% depth): its quiet parts come up by as much as 10 dB. Turn your speakers down before you listen.']);
  const lofiOn = ap(lofi, [{ op: 'set_master', ott: { on: true, depth: 0.2 } }]);
  assert.deepEqual(run(lofiOn, { ott: { depth: 0.6 } }).c, []);
});

test('a band-pass Filter is no boost: 0 dB at its centre whatever its resonance; taken away, what it held down comes back (scan r37)', async () => {
  const { safetyCautions, louderSaid } = await import('../src/agent/safety.ts');
  const { plainNames } = await import('../src/agent/names.ts');
  const amb = createStarter('ambient');
  const K = amb.tracks[2].id;
  const filter = (settings, from = amb) => {
    const c = safetyCautions(from, ap(from, [{ op: 'set_insert', trackId: K, insert: 'filter', settings }]));
    return { c, said: louderSaid(c) };
  };
  // Switched on at 800 Hz, Q 12 (it said "comes up by 86.3 dB"; measured -3.7 LU) or Q 4 at 12 dB per octave (it said 24.1; -2.7 LU): nothing
  for (const settings of [{ on: true, type: 'bandpass', cutoff: 800, resonance: 12 }, { on: true, type: 'bandpass', cutoff: 800, resonance: 4, slope: 12 }, { on: true, type: 'bandpass', cutoff: 100, resonance: 18 }]) {
    const r = filter(settings);
    assert.deepEqual(r.c, [], JSON.stringify(settings));
    assert.equal(r.said, null);
  }
  // Beside the OTT switched on, the OTT's caution alone, so it says what was measured (+13.6 LU in a bar)
  const both = safetyCautions(amb, ap(amb, [{ op: 'set_master', ott: { on: true, depth: 1 } }, { op: 'set_insert', trackId: K, insert: 'filter', settings: { on: true, type: 'bandpass', cutoff: 800, resonance: 12 } }]));
  assert.deepEqual(both.map((c) => c.louder.toFixed(1)), ['14.3']);
  // A narrow band-pass switched off: what it held down comes back, by no more than it took off
  const narrow = ap(amb, [{ op: 'set_insert', trackId: K, insert: 'filter', settings: { on: true, type: 'bandpass', cutoff: 800, resonance: 12 } }]);
  const off = filter({ on: false }, narrow).c;
  assert.equal(off.length, 1);
  assert.match(plainNames(off[0].text), /^This switches off the Filter on "Kalimba": it held it down, and around .* it comes up by [\d.]+ dB\. Turn your speakers down before you listen\.$/);
  assert.ok(off[0].louder > 6 && off[0].louder <= 60);
  // ...widened (resonance 12 to 0.7): it lets much more through, never a peak
  const wide = filter({ resonance: 0.7 }, narrow).c;
  assert.match(plainNames(wide[0].text), /^On "Kalimba", the Filter lets much more through: around/);
  // A resonant low-pass still peaks (Q 12 at 24 dB per octave: about 21.6 dB, as the second stage plays)
  assert.match(plainNames(filter({ on: true, type: 'lowpass', cutoff: 800, resonance: 12 }).c[0].text), /^On "Kalimba", the Filter peaks: around 800 Hz it comes up by 2\d\.\d dB\./);
});
