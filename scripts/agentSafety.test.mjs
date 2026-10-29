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
