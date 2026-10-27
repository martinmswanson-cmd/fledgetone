// Groove feels (src/store/grooveFeels.ts), their measurement (src/audio/grooveExtract.ts) and the glue styles (src/store/glueMix.ts): the measured templates' numbers, how a feel moves and accents a note, reading feels back from files, and the analysis finding known offsets in synthetic hits.
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

const G = await import('../src/store/grooveFeels.ts');
const X = await import('../src/audio/grooveExtract.ts');
const { withFeel, normalizeClipGroove } = await import('../src/store/drumGroove.ts');
const GM = await import('../src/store/glueMix.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');

test('every measured feel: 16 steps per part, offsets and velocities in range, the kick on the grid, plain names', () => {
  const ids = new Set();
  for (const f of G.GROOVE_FEELS) {
    assert.ok(!ids.has(f.id), f.id);
    ids.add(f.id);
    assert.ok(f.name && f.about && f.from && f.bpm > 60);
    assert.ok(Object.keys(f.roles).length > 0, f.id);
    for (const [role, m] of Object.entries(f.roles)) {
      assert.ok(G.GROOVE_ROLES.includes(role));
      assert.equal(m.t.length, 16);
      assert.equal(m.v.length, 16);
      for (const t of m.t) assert.ok(Math.abs(t) <= X.MAX_FEEL_OFFSET, `${f.id} ${role} ${t}`);
      for (const v of m.v) assert.ok(v >= 0.7 && v <= 1.15, `${f.id} ${role} ${v}`);
      if (role === 'kick') assert.ok(m.t.every((t) => t === 0));
    }
  }
  // The house shuffle swings the second 16th of every beat on the hats, about a quarter of a 16th
  const house = G.grooveFeelById('houseShuffle').roles.hats;
  for (const s of [1, 5, 9, 13]) assert.ok(house.t[s] > 0.2 && house.t[s] < 0.35, `${s}`);
  for (const s of [0, 4, 8, 12]) assert.equal(house.t[s], 0);
});

test('a feel moves a note by its step, times the amount, and accents it the same way', () => {
  const f = G.grooveFeelById('houseShuffle');
  const full = G.feelNote(f, 1, 'hats', 1);
  assert.equal(full.shift, f.roles.hats.t[1]);
  const half = G.feelNote(f, 0.5, 'hats', 1);
  assert.ok(Math.abs(half.shift - f.roles.hats.t[1] / 2) < 1e-4);
  assert.ok(Math.abs(half.vel - (1 + (f.roles.hats.v[1] - 1) / 2)) < 1e-9);
  assert.deepEqual(G.feelNote(f, 0, 'hats', 1), { shift: 0, vel: 1 });
  // A part the feel doesn't have plays as written; a later bar is the same step
  assert.deepEqual(G.feelNote(G.grooveFeelById('artcoreBreathe'), 1, 'lead', 3), { shift: 0, vel: 1 });
  assert.deepEqual(G.feelNote(f, 1, 'hats', 17), full);
});

test('off the 16th grid (a triplet), a note leans with the 8ths either side and keeps its velocity', () => {
  const map = { t: Array.from({ length: 16 }, (_, i) => (i === 2 ? 0.1 : i % 2 ? 0.3 : 0)), v: Array(16).fill(1.1) };
  // 4/3 of a 16th: two thirds of the way from step 0 (0) to step 2 (0.1); the swung step 1 doesn't pull it
  const at = G.mapAt(map, 4 / 3);
  assert.ok(Math.abs(at.shift - 0.1 * (2 / 3)) < 1e-9);
  assert.equal(at.vel, 1);
  assert.deepEqual(G.mapAt(map, 1), { shift: 0.3, vel: 1.1 });
});

test('which part a note plays', () => {
  assert.equal(G.drumRoleOf('C1'), 'kick');
  assert.equal(G.drumRoleOf('D#1'), 'snare');
  assert.equal(G.drumRoleOf('F#1'), 'hats');
  assert.equal(G.drumRoleOf('G#2'), 'perc');
  assert.equal(G.melodicRoleOf('bass', []), 'bass');
  const chord = [0, 0, 0, 0.25, 0.25, 0.25].map((startOffset) => ({ startOffset }));
  assert.equal(G.melodicRoleOf('music', chord), 'chords');
  assert.equal(G.melodicRoleOf('music', [0, 0.25, 0.5, 0.75].map((startOffset) => ({ startOffset }))), 'lead');
});

test("a clip's feel survives a file, and a broken or unknown one is dropped", () => {
  const user = { id: 'user-abc', name: 'From audio 1', about: '', from: '8 bars', bpm: 124, roles: { hats: { t: Array(16).fill(0.1), v: Array(16).fill(1) } } };
  const g = { swing: 0, grid: 16, feel: { id: 'user-abc', amount: 0.6, role: 'hats', user } };
  assert.deepEqual(normalizeClipGroove(JSON.parse(JSON.stringify(g))), g);
  assert.equal(normalizeClipGroove({ swing: 0, grid: 16, feel: { id: 'nope', amount: 1 } }).feel, undefined);
  assert.equal(G.normalizeClipFeel({ id: 'user-x', amount: 1, user: { ...user, id: 'user-y' } }), undefined);
  assert.equal(G.normalizeClipFeel({ id: 'houseShuffle', amount: 7 }).amount, 1);
  // Offsets from a file are held in range, a short map is dropped
  const wild = G.normalizeUserFeel({ ...user, roles: { hats: { t: Array(16).fill(3), v: Array(16).fill(1) }, bass: { t: [0], v: [1] } } });
  assert.equal(wild.roles.hats.t[0], G.MAX_FEEL_SHIFT);
  assert.equal(wild.roles.bass, undefined);
});

test('a feel takes the place of the swing; taken off, the clip goes back to the song swing', () => {
  const on = withFeel({ swing: 0.5, grid: 8, template: 'lazy' }, { id: 'bassTight', amount: 1 });
  assert.deepEqual(on, { swing: 0, grid: 8, feel: { id: 'bassTight', amount: 1 } });
  assert.equal(withFeel(withFeel(undefined, { id: 'bassTight', amount: 1 }), null), null);
  const rows = { 'F#1': { swing: 0.3 } };
  assert.deepEqual(withFeel({ swing: 0, grid: 16, rows, feel: { id: 'bassTight', amount: 1 } }, null), { swing: 0, grid: 16, rows });
});

// Synthetic drums: a pitch-swept kick on the beats, a clap on 2 and 4 (late by `snareLate`), noise hats on every 16th, the off ones `swing` late
function synth({ bpm = 124, bars = 8, swing = 0.2, snareLate = 0.1, start = 0.5, sr = 44100 } = {}) {
  const six = 15 / bpm;
  const x = new Float32Array(Math.ceil((bars * 16 + 4) * six * sr) + sr);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const hit = (t, len, f) => { const i0 = Math.round(t * sr); for (let i = 0; i < len * sr; i++) x[i0 + i] += f(i / sr); };
  let prev = 0;
  for (let k = 0; k < bars * 16; k++) {
    const t = start + k * six, s = k % 16;
    if (s % 4 === 0) { let ph = 0; hit(t, 0.3, (tt) => { ph += (2 * Math.PI * (50 + 150 * Math.exp(-tt / 0.03))) / sr; return 0.8 * Math.sin(ph) * Math.exp(-tt / 0.2) * Math.min(1, tt / 0.001); }); }
    if (s === 4 || s === 12) hit(t + snareLate * six, 0.15, (tt) => 0.5 * rnd() * Math.exp(-tt / 0.04));
    hit(t + (s % 2 ? swing * six : 0), 0.04, () => { const n = rnd(); const h = n - prev; prev = n; return 0.15 * h; });
  }
  return { x, sr, bpm, start };
}

test('the analysis finds known offsets in synthetic hits, within a millisecond or two (a clap over a hat reads a hair early)', () => {
  const { x, sr, bpm, start } = synth();
  // A guess a little off in tempo and phase: the grid is fitted
  const m = X.extractGroove(x, sr, { bpm: bpm * 1.002, barStart: start + 0.003 }, { roles: ['kick', 'snare', 'hats'] });
  assert.ok(Math.abs(m.grid.bpm - bpm) < 0.05, `${m.grid.bpm}`);
  const six = 15 / bpm;
  for (const s of [1, 3, 5, 7, 9, 11, 13, 15]) assert.ok(Math.abs(m.roles.hats.t[s] - 0.2) * six * 1000 < 1.5, `hat ${s}: ${m.roles.hats.t[s]}`);
  for (const s of [0, 2, 4, 6]) assert.equal(m.roles.hats.t[s], 0, `hat ${s}`);
  for (const s of [4, 12]) assert.ok(Math.abs(m.roles.snare.t[s] - 0.1) * six * 1000 < 2, `snare ${s}: ${m.roles.snare.t[s]}`);
});

test('a straight recording measures straight: no step is moved', () => {
  const { x, sr, bpm, start } = synth({ swing: 0, snareLate: 0 });
  const m = X.extractGroove(x, sr, { bpm, barStart: start }, { roles: ['kick', 'snare', 'hats'] });
  for (const map of Object.values(m.roles)) assert.ok(map.t.every((t) => t === 0), JSON.stringify(map.t));
});

test('what is not clear stays on the grid: scattered hits move nothing', () => {
  // A step hit at random offsets in each bar: no clear cluster
  const hits = [0.05, 0.4, -0.3, 0.25, -0.1, 0.33, -0.38, 0.15].map((o, b) => ({ t: (b * 16 + o) * (15 / 120), level: -10 }));
  const map = X.grooveMapOf(hits, { bpm: 120, barStart: 0 }, 3, 'hats');
  assert.ok(!map || map.t.every((t) => t === 0));
});

const track = (id, instrumentKey, extra = {}) => ({ id, name: id, color: '#fff', instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0, ...extra });
let n = 0;
const bus = (name) => track('bus' + n++, 'bus', { name });

test('glue styles: each glues gently (makeup never over 1 dB), the harder styles compress and saturate more', () => {
  for (const id of GM.GLUE_BUS_STYLE_IDS) {
    const st = GM.GLUE_BUS_STYLES[id];
    for (const kind of ['drums', 'music']) {
      assert.ok(st[kind].compressor.makeup <= 1);
      assert.ok(st[kind].saturate.amount <= 0.35 && st[kind].saturate.mix <= 0.5);
    }
  }
  const { clean, bass, pumping } = GM.GLUE_BUS_STYLES;
  assert.ok(clean.drums.saturate.amount < bass.drums.saturate.amount && bass.drums.saturate.amount < pumping.drums.saturate.amount);
  assert.ok(clean.pump < bass.pump && bass.pump < pumping.pump);
});

test('glue in a style: one drum track gets a drum bus too, and the record keeps the style', () => {
  const tracks = [track('d', 'drums'), track('k', 'keys'), track('p', 'pluck')];
  const { tracks: out, record } = GM.applyGlue(tracks, [], (name) => bus(name), 'pumping');
  assert.equal(record.style, 'pumping');
  const drumBus = out.find((t) => t.name === 'Drum bus');
  assert.ok(drumBus);
  assert.equal(out.find((t) => t.id === 'd').output, drumBus.id);
  assert.equal(drumBus.fx.saturate.amount, GM.GLUE_BUS_STYLES.pumping.drums.saturate.amount);
  assert.equal(GM.applyGlue(tracks, [], (name) => bus(name)).record.style, undefined);
});

test('group and glue: drums onto a drum bus, the bass onto a bass bus keeping its low end, the rest onto a music bus', () => {
  const tracks = [track('d', 'drums'), track('b', 'bass808'), track('k', 'keys'), track('x', 'keys')];
  const { tracks: out, buses } = GM.groupAndGlue(tracks, [], ['d', 'b', 'k'], (name) => bus(name), 'clean');
  assert.equal(buses.length, 3);
  const [db, bb, mb] = buses.map((id) => out.find((t) => t.id === id));
  assert.equal(db.name, 'Drum bus');
  assert.equal(bb.name, 'Bass bus');
  assert.equal(out.find((t) => t.id === 'd').output, db.id);
  assert.equal(out.find((t) => t.id === 'b').output, bb.id);
  assert.equal(out.find((t) => t.id === 'k').output, mb.id);
  assert.equal(out.find((t) => t.id === 'x').output, undefined);
  assert.ok(!(bb.fx.peq?.on && bb.fx.peq.bands[0].on), 'no low cut on the bass bus');
  assert.equal(mb.fx.compressor.threshold, GM.GLUE_BUS_STYLES.clean.music.compressor.threshold);
  // Already on a bus: nothing to do
  assert.equal(GM.groupAndGlue(out, [], ['d'], (name) => bus(name)).buses.length, 0);
});

test('glue buses never split a folder', () => {
  const f = { id: 'f1', name: 'Kit' };
  const tracks = [{ ...track('kk', 'drums'), folder: f }, { ...track('sn', 'drums'), folder: f }, track('k', 'keys')];
  const one = GM.groupAndGlue(tracks, [], ['kk'], (name) => bus(name)).tracks;
  assert.deepEqual(one.map((t) => t.folder?.id ?? null), ['f1', 'f1', 'f1', null], 'a bus for tracks in one folder goes in that folder');
  const two = GM.groupAndGlue(tracks, [], ['kk', 'k'], (name) => bus(name)).tracks;
  const ids = two.map((t) => t.folder?.id ?? null);
  assert.equal(ids.lastIndexOf('f1') - ids.indexOf('f1') + 1, ids.filter((x) => x === 'f1').length, 'the folder stays in one piece');
});

test('glue leaves a lone music part on the master', () => {
  const { tracks: out } = GM.applyGlue([track('d', 'drums'), track('k', 'keys')], [], (name) => bus(name));
  assert.equal(out.find((t) => t.id === 'k').output, undefined);
  assert.ok(!out.some((t) => t.name === 'Music bus'));
});
