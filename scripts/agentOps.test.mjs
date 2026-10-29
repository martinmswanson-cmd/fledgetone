// The agent's ops (src/agent/ops.ts): every op on a starter song, the song passed in left as it
// was, the same ops giving the same song (ids included), linked clips following, the tempo's undo
// rule, errors naming the op and the field, values brought into range as warnings, and the result
// opening exactly as it is. Run with `npm test`.
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
const { applyOps, OP_NAMES, MAX_OPS } = await import('../src/agent/ops.ts');
const { createStarter } = await import('../src/store/starters.ts');
const { parseProject, serializeProject } = await import('../src/store/project.ts');
const { stableJson } = await import('../src/agent/fingerprint.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};
const base = () => createStarter('lofi');
const run = (song, ops, idBase = 'sg-test') => applyOps(song, { opsVersion: 1, ops }, { idBase });
const mustApply = (song, ops, idBase) => {
  const out = run(song, ops, idBase);
  assert.ok(out.ok, `expected the ops to apply: ${JSON.stringify(out.errors)}`);
  return out;
};

// The lofi starter: Keys, Drums, Bass, Flute, Rain; a clip each
const song0 = base();
const KEYS = song0.tracks[0].id;
const DRUMS = song0.tracks[1].id;
const BASS = song0.tracks[2].id;
const BASS_CLIP = song0.clips.find((c) => c.trackId === BASS).id;
const KEYS_CLIP = song0.clips.find((c) => c.trackId === KEYS).id;
const DRUM_CLIP = song0.clips.find((c) => c.trackId === DRUMS).id;
const MARKER = song0.markers[1].id;

/** Each op, with ops that use it and a check of what it did. */
const CASES = {
  add_notes: [[{ op: 'add_notes', clipId: BASS_CLIP, notes: [{ pitch: 'D2', start: 0.5, length: 0.25, velocity: 0.7 }, { pitch: 'Bb1', start: 1, length: 0.5 }] }], (s, b) => {
    const c = s.clips.find((x) => x.id === BASS_CLIP);
    assert.equal(c.notes.length, b.clips.find((x) => x.id === BASS_CLIP).notes.length + 2);
    const added = c.notes.slice(-2);
    assert.deepEqual(added.map((n) => [n.note, n.startOffset, n.duration, n.velocity]), [['D2', 0.5, '0.25m', 0.7], ['A#1', 1, '0.5m', 0.8]]);
  }],
  change_notes: [[{ op: 'change_notes', clipId: BASS_CLIP, notes: [{ id: song0.clips.find((c) => c.id === BASS_CLIP).notes[0].id, pitch: 'E2', length: 1, velocity: 0.5 }] }], (s) => {
    const n = s.clips.find((x) => x.id === BASS_CLIP).notes[0];
    assert.deepEqual([n.note, n.duration, n.velocity], ['E2', '1m', 0.5]);
  }],
  remove_notes: [[{ op: 'remove_notes', clipId: BASS_CLIP, fromBar: 5, toBar: 6 }], (s, b) => {
    const before = b.clips.find((x) => x.id === BASS_CLIP);
    const after = s.clips.find((x) => x.id === BASS_CLIP);
    assert.ok(after.notes.length < before.notes.length);
    assert.ok(after.notes.every((n) => n.startOffset >= 1));
  }],
  transpose_notes: [[{ op: 'transpose_notes', clipId: KEYS_CLIP, semitones: 2 }], (s, b) => {
    const from = b.clips.find((x) => x.id === KEYS_CLIP).notes[0].note;
    const to = s.clips.find((x) => x.id === KEYS_CLIP).notes[0].note;
    assert.notEqual(from, to);
  }],
  add_clip: [[{ op: 'add_clip', trackId: BASS, startBar: 17, lengthBars: 4, name: 'Outro bass', ref: 'outro', notes: [{ pitch: 'D2', start: 0, length: 4 }] }, { op: 'add_notes', clipId: '$outro', notes: [{ pitch: 'A1', start: 2, length: 1 }] }], (s) => {
    const c = s.clips.find((x) => x.name === 'Outro bass');
    assert.equal(c.startBar, 17);
    assert.equal(c.notes.length, 2);
    assert.equal(c.trackId, BASS);
  }],
  move_clip: [[{ op: 'move_clip', clipId: BASS_CLIP, toBar: 7 }], (s) => assert.equal(s.clips.find((x) => x.id === BASS_CLIP).startBar, 7)],
  resize_clip: [[{ op: 'resize_clip', clipId: BASS_CLIP, lengthBars: 8 }], (s) => assert.equal(s.clips.find((x) => x.id === BASS_CLIP).lengthBars, 8)],
  remove_clip: [[{ op: 'remove_clip', clipId: BASS_CLIP }], (s) => assert.ok(!s.clips.some((x) => x.id === BASS_CLIP))],
  duplicate_clip: [[{ op: 'duplicate_clip', clipId: BASS_CLIP, toBar: 17, ref: 'copy' }], (s, b) => {
    assert.equal(s.clips.length, b.clips.length + 1);
    const copy = s.clips[s.clips.length - 1];
    assert.equal(copy.startBar, 17);
    assert.notEqual(copy.notes[0].id, b.clips.find((x) => x.id === BASS_CLIP).notes[0].id);
  }],
  add_track: [[{ op: 'add_track', instrument: 'synthDesigner', name: 'Lead', ref: 'lead' }, { op: 'set_track', trackId: '$lead', volumeDb: -6 }], (s, b) => {
    assert.equal(s.tracks.length, b.tracks.length + 1);
    const t = s.tracks[s.tracks.length - 1];
    assert.deepEqual([t.name, t.instrumentKey, t.volume], ['Lead', 'synthDesigner', -6]);
  }],
  set_track: [[{ op: 'set_track', trackId: KEYS, volumeDb: -8, pan: -0.3, mute: true, solo: false, name: 'Rhodes', reverbSend: 0.4, delaySend: 0.1, distance: 0.2 }], (s) => {
    const t = s.tracks.find((x) => x.id === KEYS);
    assert.deepEqual([t.volume, t.pan, t.isMuted, t.name, t.reverbSend, t.delaySend, t.distance], [-8, -0.3, true, 'Rhodes', 0.4, 0.1, 0.2]);
  }],
  set_eq: [[{ op: 'set_eq', trackId: KEYS, low: -3, high: 2 }], (s) => assert.deepEqual(s.tracks.find((x) => x.id === KEYS).eq, { low: -3, mid: 0, high: 2 })],
  set_insert: [[{ op: 'set_insert', trackId: KEYS, insert: 'reverb', settings: { on: true, decay: 3.5, mix: 0.25 } }], (s) => {
    const r = s.tracks.find((x) => x.id === KEYS).fx.reverb;
    assert.deepEqual([r.on, r.decay, r.mix], [true, 3.5, 0.25]);
  }],
  set_instrument: [[{ op: 'set_instrument', trackId: KEYS, instrument: 'synthDesigner' }], (s) => assert.equal(s.tracks.find((x) => x.id === KEYS).instrumentKey, 'synthDesigner')],
  set_synth_preset: [[{ op: 'set_instrument', trackId: KEYS, instrument: 'synthDesigner' }, { op: 'set_synth_preset', trackId: KEYS, preset: 'Supersaw lead' }], (s) => assert.equal(s.tracks.find((x) => x.id === KEYS).synth.unison.voices, 7)],
  set_automation: [[{ op: 'set_automation', trackId: KEYS, param: 'fx:reverb.mix', points: [{ bar: 9, value: 0.1 }, { bar: 13, value: 0.6, curve: 0.5 }] }], (s) => {
    const t = s.tracks.find((x) => x.id === KEYS);
    const lane = t.automation.find((l) => l.param === 'fx:reverb.mix');
    assert.deepEqual(lane.points, [{ bar: 9, value: 0.1 }, { bar: 13, value: 0.6, curve: 0.5 }]);
    // Drawing an insert's lane switches the insert on, as the studio does
    assert.equal(t.fx.reverb.on, true);
  }],
  remove_automation: [
    [{ op: 'remove_automation', trackId: KEYS, param: 'pan' }],
    (s) => assert.ok(!s.tracks.find((x) => x.id === KEYS).automation?.some((l) => l.param === 'pan')),
    (b) => ({ ...b, tracks: b.tracks.map((t) => (t.id === KEYS ? { ...t, automation: [{ param: 'pan', points: [{ bar: 1, value: 0.2 }, { bar: 9, value: 0.8 }] }] } : t)) }),
  ],
  set_tempo: [[{ op: 'set_tempo', bpm: 90 }], (s, b) => {
    assert.equal(s.bpm, 90);
    // Always a new tempo-change list, so undoing the Accept brings the old tempo back
    assert.notEqual(s.tempoPoints, b.tempoPoints);
  }],
  add_tempo_change: [[{ op: 'add_tempo_change', bar: 9, bpm: 100, ref: 't' }], (s) => assert.deepEqual(s.tempoPoints.map((p) => [p.bar, p.bpm]), [[9, 100]])],
  remove_tempo_change: [[{ op: 'remove_tempo_change', id: 'tempo-9' }], (s) => assert.equal(s.tempoPoints.length, 0), (b) => ({ ...b, tempoPoints: [{ id: 'tempo-9', bar: 9, bpm: 100, ramp: false }] })],
  add_marker: [[{ op: 'add_marker', bar: 13, name: 'Lift' }], (s) => assert.ok(s.markers.some((m) => m.name === 'Lift' && m.bar === 13))],
  move_marker: [[{ op: 'move_marker', markerId: MARKER, bar: 6 }], (s) => assert.equal(s.markers.find((m) => m.id === MARKER).bar, 6)],
  rename_marker: [[{ op: 'rename_marker', markerId: MARKER, name: 'Groove A' }], (s) => assert.equal(s.markers.find((m) => m.id === MARKER).name, 'Groove A')],
  remove_marker: [[{ op: 'remove_marker', markerId: MARKER }], (s) => assert.ok(!s.markers.some((m) => m.id === MARKER))],
  set_master: [[{ op: 'set_master', levelDb: 2, glue: 'punchy', width: { on: true, amount: 1.5 }, clipper: { on: true, drive: 2 } }], (s) => {
    assert.deepEqual([s.master.level, s.master.glue, s.master.width.amount, s.master.clipper.on, s.master.clipper.drive], [2, 'punchy', 1.5, true, 2]);
  }],
};

test('every op has a case here', () => {
  assert.deepEqual(Object.keys(CASES).sort(), [...OP_NAMES].sort());
});

for (const [name, [ops, check, prep = (b) => b]] of Object.entries(CASES)) {
  test(`${name}: applies to a starter, leaves the song passed in as it was, and opens as it is`, () => {
    const b = deepFreeze(prep(base()));
    const before = stableJson(b);
    const out = mustApply(b, ops);
    check(out.song, b);
    assert.equal(stableJson(b), before, 'the song passed in changed');
    assert.ok(out.diff.changes.length > 0, 'a change was described');
    // The file check is the gate: what it reads back is what applyOps gave
    const saved = serializeProject(out.song);
    const again = serializeProject(parseProject(JSON.parse(JSON.stringify(saved))));
    assert.equal(stableJson(again), stableJson(JSON.parse(JSON.stringify(saved))));
  });
}

test('untouched tracks and clips are the very objects passed in', () => {
  const b = base();
  const out = mustApply(b, CASES.add_notes[0]);
  assert.equal(out.song.tracks[0], b.tracks[0]);
  assert.equal(out.song.clips.find((c) => c.id === KEYS_CLIP), b.clips.find((c) => c.id === KEYS_CLIP));
  assert.equal(out.song.master, b.master);
  assert.equal(out.song.markers, b.markers);
});

test('the same ops on the same song with the same id base give the same song, ids and all', () => {
  const ops = [...CASES.add_track[0], ...CASES.add_clip[0], ...CASES.duplicate_clip[0], ...CASES.add_marker[0]];
  const a = mustApply(base(), ops, 'sg-abc');
  const b = mustApply(base(), ops, 'sg-abc');
  assert.deepEqual(a.song, b.song);
  assert.deepEqual(a.refs, b.refs);
  assert.match(a.refs.lead, /sg-abc/);
  const c = mustApply(base(), ops, 'sg-other');
  assert.notEqual(c.refs.lead, a.refs.lead);
});

test('linked clips follow an edit of one of them', () => {
  const out = mustApply(base(), [
    { op: 'duplicate_clip', clipId: BASS_CLIP, toBar: 17, linked: true, ref: 'twin' },
    { op: 'add_notes', clipId: BASS_CLIP, notes: [{ pitch: 'G2', start: 0.75, length: 0.25 }] },
  ]);
  const original = out.song.clips.find((c) => c.id === BASS_CLIP);
  const twin = out.song.clips.find((c) => c.id === out.refs.twin);
  assert.ok(original.pattern && original.pattern === twin.pattern);
  assert.equal(twin.notes.length, original.notes.length);
  assert.ok(twin.notes.some((n) => n.note === 'G2' && n.startOffset === 0.75));
  assert.ok(out.diff.touchedClips.includes(out.refs.twin));
});

test('a ref names what an earlier op made', () => {
  const out = mustApply(base(), [{ op: 'add_tempo_change', bar: 9, bpm: 100, ref: 't' }, { op: 'remove_tempo_change', id: '$t' }]);
  assert.equal(out.song.tempoPoints.length, 0);
  const wrongKind = run(base(), [{ op: 'add_marker', bar: 13, ref: 'm' }, { op: 'remove_clip', clipId: '$m' }]);
  assert.match(wrongKind.errors[0].message, /is a marker, not a clip/);
});

test('a tempo change retimes markers held to their time, and audio-free clips keep their bars', () => {
  const b = base();
  const timed = { ...b, markers: [...b.markers, { id: 'hit', name: 'Hit', anchor: 'time', bar: 9, seconds: b.markers[2].seconds }] };
  const out = mustApply(timed, [{ op: 'set_tempo', bpm: 164 }]);
  const hit = out.song.markers.find((m) => m.id === 'hit');
  // Twice the tempo: the same second is twice as many bars in
  assert.ok(Math.abs(hit.bar - (1 + (9 - 1) * 2)) < 1e-6, `hit at ${hit.bar}`);
  const groove = out.song.markers.find((m) => m.id === MARKER);
  assert.equal(groove.bar, 5);
  assert.deepEqual(out.song.clips.map((c) => c.startBar), b.clips.map((c) => c.startBar));
});

test('errors name the op and the field', () => {
  const bad = run(base(), [{ op: 'set_tempo', bpm: 100 }, { op: 'add_notes', clipId: BASS_CLIP, notes: [{ pitch: 'C4', start: 0, length: 1 }, { pitch: 'H2', start: 0, length: 1 }] }]);
  assert.equal(bad.ok, false);
  assert.deepEqual([bad.errors[0].op, bad.errors[0].path], [1, 'ops[1].notes[1].pitch']);
  assert.match(bad.errors[0].message, /isn't a pitch/);

  const shape = run(base(), [{ op: 'set_track', trackId: KEYS, volume: 3 }, { op: 'nope' }, { op: 'move_clip' }]);
  assert.equal(shape.ok, false);
  assert.deepEqual(shape.errors.map((e) => e.path), ['ops[0].volume', 'ops[1].op', 'ops[2].clipId']);

  const missing = run(base(), [{ op: 'add_notes', clipId: '$later', notes: [] }]);
  assert.match(missing.errors[0].message, /no earlier op made "\$later"/);
  const unknown = run(base(), [{ op: 'remove_clip', clipId: 'clip-nope' }]);
  assert.deepEqual([unknown.errors[0].op, unknown.errors[0].path], [0, 'ops[0].clipId']);

  assert.equal(applyOps(base(), { opsVersion: 2, ops: [] }, { idBase: 'x' }).ok, false);
  const many = run(base(), Array.from({ length: MAX_OPS + 1 }, () => ({ op: 'set_tempo', bpm: 100 })));
  assert.match(many.errors[0].message, /too many/);
});

test('values out of range are brought into range, with a warning', () => {
  const out = mustApply(base(), [
    { op: 'set_track', trackId: KEYS, volumeDb: 20, pan: 3 },
    { op: 'set_insert', trackId: KEYS, insert: 'filter', settings: { on: true, cutoff: 99999 } },
    { op: 'set_tempo', bpm: 400 },
    { op: 'add_notes', clipId: BASS_CLIP, notes: [{ pitch: 'C2', start: 0, length: 0.001 }] },
  ]);
  const t = out.song.tracks.find((x) => x.id === KEYS);
  assert.deepEqual([t.volume, t.pan, t.fx.filter.cutoff, out.song.bpm], [6, 1, 20000, 240]);
  const n = out.song.clips.find((c) => c.id === BASS_CLIP).notes.at(-1);
  assert.equal(durationToBars(n.duration), 1 / 16);
  for (const re of [/volume 20 dB is out of range/, /pan 3 is out of range/, /cutoff 99999 is out of range/, /400 BPM is out of range/, /shorter than the shortest/]) assert.ok(out.warnings.some((w) => re.test(w)), `no warning like ${re}`);
});

test('things a suggestion may not do are refused in plain words', () => {
  const cases = [
    [{ op: 'add_track', instrument: 'audio' }, /sound files/],
    [{ op: 'add_track', instrument: 'harpsichord9000' }, /unknown instrument/],
    [{ op: 'transpose_notes', clipId: DRUM_CLIP, semitones: 2 }, /drum/],
    [{ op: 'set_synth_preset', trackId: KEYS, preset: 'Supersaw lead' }, /isn't a Synth Designer track/],
    [{ op: 'add_marker', bar: 5 }, /already at bar 5/],
    [{ op: 'set_automation', trackId: KEYS, param: 'plugin:p1:cutoff', points: [] }, /plugin settings/],
    [{ op: 'add_notes', clipId: BASS_CLIP, notes: [{ pitch: 'C2', start: 40, length: 1 }] }, /outside the clip/],
    [{ op: 'set_track', trackId: KEYS, output: BASS }, /isn't a bus/],
  ];
  for (const [op, re] of cases) {
    const out = run(base(), [op]);
    assert.equal(out.ok, false, JSON.stringify(op));
    assert.match(out.errors[0].message, re);
  }
});

test('the bars to hear a suggestion in start one bar before the change', () => {
  const out = mustApply(base(), [{ op: 'add_notes', clipId: BASS_CLIP, notes: [{ pitch: 'D2', start: 4, length: 1 }] }]);
  assert.deepEqual(out.diff.audition, { fromBar: 8, toBar: 10 });
});

test('the same suggestion applied twice makes new ids the second time, and nothing is lost to repeated ids', () => {
  const ops = [
    { op: 'add_track', instrument: 'synthDesigner', ref: 't' },
    { op: 'add_clip', trackId: '$t', startBar: 1, lengthBars: 2, ref: 'c', notes: [{ pitch: 'C4', start: 0, length: 1 }] },
    { op: 'add_marker', bar: 13, name: 'Again' },
  ];
  const once = mustApply(base(), ops, 'sg-same');
  assert.equal(once.idBase, 'sg-same');
  const twice = mustApply(once.song, ops.slice(0, 2), 'sg-same');
  assert.equal(twice.idBase, 'sg-same~2');
  const ids = (list) => list.map((x) => x.id);
  for (const list of [twice.song.tracks, twice.song.clips, twice.song.markers, twice.song.clips.flatMap((c) => c.notes)]) assert.equal(new Set(ids(list)).size, list.length);
  const back = parseProject(JSON.parse(JSON.stringify(serializeProject(twice.song))));
  assert.equal(back.tracks.length, twice.song.tracks.length);
  assert.equal(back.clips.length, twice.song.clips.length);
  // A third time: the next free base
  assert.equal(mustApply(twice.song, ops.slice(0, 1), 'sg-same').idBase, 'sg-same~3');
});

test('copies of clips count against the notes a suggestion may add', () => {
  const notes = Array.from({ length: 3000 }, (_, i) => ({ pitch: 'C4', start: (i % 64) / 16, length: 1 / 16 }));
  const made = mustApply(base(), [{ op: 'add_clip', trackId: KEYS, startBar: 17, lengthBars: 4, notes, ref: 'c' }]);
  const clipId = made.refs.c;
  const one = run(made.song, [{ op: 'duplicate_clip', clipId, toBar: 21 }]);
  assert.ok(one.ok);
  for (const linked of [false, true]) {
    const two = run(made.song, [{ op: 'duplicate_clip', clipId, toBar: 21, linked }, { op: 'duplicate_clip', clipId, toBar: 25, linked }]);
    assert.equal(two.ok, false, `linked: ${linked}`);
    assert.deepEqual([two.errors[0].op, two.errors[0].path], [1, 'ops[1].clipId']);
    assert.match(two.errors[0].message, /too many notes/);
  }
});

test('a Pump ducking to a track made by an earlier op saves its id; ducking to itself is refused', () => {
  const out = mustApply(base(), [{ op: 'add_track', instrument: 'drums', ref: 'k' }, { op: 'set_insert', trackId: KEYS, insert: 'pump', settings: { on: true, trigger: 'track', source: '$k' } }]);
  assert.equal(out.song.tracks.find((t) => t.id === KEYS).fx.pump.source, out.refs.k);
  const self = run(base(), [{ op: 'set_insert', trackId: KEYS, insert: 'pump', settings: { on: true, source: KEYS } }]);
  assert.equal(self.ok, false);
  assert.match(self.errors[0].message, /can't duck to itself/);
});

test("names an object has by inheritance aren't pitches or settings", () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const pitch = run(base(), [{ op: 'add_notes', clipId: DRUM_CLIP, notes: [{ pitch: name, start: 0, length: 0.25 }] }]);
    assert.equal(pitch.ok, false, name);
    assert.match(pitch.errors[0].message, /isn't a pitch/);
  }
  const insert = run(base(), [{ op: 'set_insert', trackId: KEYS, insert: 'filter', settings: { toString: 1 } }]);
  assert.match(insert.errors[0].message, /has no setting "toString"/);
  const master = run(base(), [{ op: 'set_master', ott: { constructor: 1 } }]);
  assert.match(master.errors[0].message, /has no setting "constructor"/);
  // A drum row's own name still works
  assert.ok(run(base(), [{ op: 'add_notes', clipId: DRUM_CLIP, notes: [{ pitch: 'kick', start: 0, length: 0.25 }] }]).ok);
});

test('repeated ids a song already had (a saved file keeps them) do not stop a suggestion', () => {
  const raw = JSON.parse(JSON.stringify(serializeProject(base())));
  raw.clips[0].notes[1].id = raw.clips[0].notes[0].id;
  raw.markers.push({ ...raw.markers[0] });
  raw.tempoPoints = [{ id: 'tp', bar: 5, bpm: 100 }, { id: 'tp', bar: 9, bpm: 110 }];
  const song = parseProject(raw);
  const out = run(song, [{ op: 'set_track', trackId: KEYS, volumeDb: -12 }, { op: 'add_notes', clipId: song.clips[0].id, notes: [{ pitch: 'C4', start: 0, length: 0.25 }] }]);
  assert.ok(out.ok, JSON.stringify(out.errors));
});
