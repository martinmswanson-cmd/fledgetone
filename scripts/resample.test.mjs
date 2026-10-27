// Unit tests for resampling: Fledge Synth's user tables (src/audio/plugins/userTable.ts and the
// engine's fledge_table_* in public/fledgetone-plugins/fledge.wasm), the mangles
// (src/audio/mangle.ts), the Slicer patterns (src/store/resample.ts), and the optional project
// fields they add (a table in a plugin's settings, a mangled clip, reversed slices), through a
// save, a share link and back. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const U = await import('../src/audio/plugins/userTable.ts');
const M = await import('../src/audio/mangle.ts');
const R = await import('../src/store/resample.ts');
const { serializeProject, parseProject } = await import('../src/store/project.ts');
const { songLink, projectFromHash } = await import('../src/store/shareLink.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');
const { normalizeClipAudio, normalizeSlicer, referencedSoundIds } = await import('../src/store/audioClips.ts');
const { FLEDGE_TABLES } = await import('../src/audio/plugins/fledgeLayout.ts');

const SR = 44100;
/** `seconds` of a tone at `hz` whose brightness rises from a sine to a buzz. */
const tone = (hz, seconds, sr = SR) => {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = (2 * Math.PI * hz * i) / sr;
    const k = (3 * i) / n;
    out[i] = 0.5 * Math.sin(ph + k * Math.sin(ph));
  }
  return out;
};
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// --- User tables ---

test('the pitch of a held tone is found, and nothing in noise', () => {
  for (const hz of [55, 110, 220, 440, 880]) {
    const p = U.detectPeriod(tone(hz, 0.5), SR);
    assert.ok(p && Math.abs(SR / p - hz) / hz < 0.005, `${hz} Hz: found ${p && SR / p}`);
  }
  let x = 1;
  const noise = Float32Array.from({ length: SR / 2 }, () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1);
  assert.equal(U.detectPeriod(noise, SR), null);
});

test('a table from a sound: N cycles of 2048, joined end to start, no DC, levelled, moving through the sound', () => {
  const t = U.tableFromSound([tone(220, 1.5)], SR, { frames: 16, cycle: 'pitch' });
  assert.ok(t && t.found && Math.abs(t.hz - 220) < 1);
  assert.equal(t.cycles.length, 16 * U.USER_CYCLE);
  const cycle = (f) => t.cycles.subarray(f * U.USER_CYCLE, (f + 1) * U.USER_CYCLE);
  for (let f = 0; f < 16; f++) {
    const c = cycle(f);
    const mean = c.reduce((s, v) => s + v, 0) / c.length;
    assert.ok(Math.abs(mean) < 1e-4, `frame ${f} DC ${mean}`);
    assert.ok(Math.abs(peak(c) - 0.95) < 0.01);
    // The end leads smoothly into the start
    assert.ok(Math.abs(c[c.length - 1] - c[0]) < 0.05, `frame ${f} joins with a step of ${c[c.length - 1] - c[0]}`);
  }
  // The sound gets brighter: so do the frames (more of the cycle's energy in quick changes)
  const bright = (c) => rms(c.map((v, i) => v - c[(i + c.length - 1) % c.length])) / rms(c);
  assert.ok(bright(cycle(15)) > bright(cycle(0)) * 1.5, `${bright(cycle(0))} -> ${bright(cycle(15))}`);
  // A fixed cycle length, and too little sound
  assert.equal(U.tableFromSound([tone(220, 1)], SR, { frames: 8, cycle: 1024 }).period, 1024);
  assert.equal(U.tableFromSound([tone(220, 0.01)], SR, { frames: 8, cycle: 2048 }), null);
  assert.equal(U.tableFromSound([new Float32Array(SR)], SR, { frames: 8, cycle: 'pitch' }), null);
});

test('a table packs into the settings and back; a link carries a light copy; damaged ones are refused', async () => {
  const t = U.tableFromSound([tone(110, 1)], SR, { frames: 32, cycle: 'pitch' });
  const packed = await U.packUserTable(t.cycles, t.frames, 'Pad');
  assert.deepEqual(U.normalizeUserTable(packed), packed);
  const back = await U.unpackUserTable(packed);
  assert.equal(back.length, t.cycles.length);
  assert.ok(back.every((v, i) => Math.abs(v - t.cycles[i]) < 1 / 32767 + 1e-6));
  const light = await U.linkUserTable(packed);
  assert.ok(light.frames === U.LINK_FRAMES && light.size === U.LINK_CYCLE && light.bits === 8);
  assert.ok(light.data.length < 3000, `a link's table is ${light.data.length} characters`);
  assert.ok(packed.data.length > 20 * light.data.length);
  const lightBack = await U.unpackUserTable(light);
  // Its first cycle is the full one less its top harmonics: close, a little duller
  const err = rms(lightBack.subarray(0, 2048).map((v, i) => v - t.cycles[i])) / rms(t.cycles.subarray(0, 2048));
  assert.ok(err < 0.15, `light copy differs by ${err}`);
  for (const bad of [null, {}, { ...packed, v: 2 }, { ...packed, frames: 0 }, { ...packed, frames: 65 }, { ...packed, size: 1000 }, { ...packed, bits: 12 }, { ...packed, data: 'not base64!' }, { ...packed, data: 'x'.repeat(2e6) }]) {
    assert.equal(U.normalizeUserTable(bad), undefined, JSON.stringify(bad)?.slice(0, 60));
  }
  // Well formed but not what it says: can't be read, so no table (the synth plays Basic shapes)
  assert.equal(await U.unpackUserTable({ ...packed, frames: 31 }), null);
});

test('resampling a cycle keeps its harmonics and makes none up', () => {
  const c = Float32Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * 3 * i) / 2048) + 0.5 * Math.sin((2 * Math.PI * 200 * i) / 2048));
  const down = U.resampleCycle(c, 256);
  // Harmonic 200 is above what 256 samples hold: gone, harmonic 3 kept
  const expect = Float32Array.from({ length: 256 }, (_, i) => Math.sin((2 * Math.PI * 3 * i) / 256));
  assert.ok(down.every((v, i) => Math.abs(v - expect[i]) < 1e-6));
  const up = U.resampleCycle(expect, 2048);
  assert.ok(up.every((v, i) => Math.abs(v - Math.sin((2 * Math.PI * 3 * i) / 2048)) < 1e-6));
});

// --- The engine ---

const { instance: { exports: e } } = await WebAssembly.instantiate(readFileSync(new URL('../public/fledgetone-plugins/fledge.wasm', import.meta.url)));
const text = (p) => {
  const m = new Uint8Array(e.memory.buffer);
  let end = p;
  while (m[end]) end++;
  return Buffer.from(m.subarray(p, end)).toString('utf8');
};
const synth = (program) => {
  const h = e.bb_create(0, 48000);
  const index = new Map();
  for (let i = 0; i < e.bb_params(h); i++) index.set(text(e.bb_param_name(h, i)), i);
  if (program !== undefined) e.bb_set_program(h, program);
  const set = (name, v) => e.bb_set(h, index.get(name), e.fledge_normal(index.get(name), v));
  return { h, index, set };
};
const play = (h, blocks = 200) => {
  e.bb_position(h, 0);
  for (const n of [33, 45, 57]) e.bb_midi(h, 0x90, n, 100);
  const out = [];
  for (let b = 0; b < blocks; b++) {
    e.bb_process(h, 128);
    out.push(...new Float32Array(e.memory.buffer, e.bb_buffer(h, 2), 128), ...new Float32Array(e.memory.buffer, e.bb_buffer(h, 3), 128));
  }
  return out;
};
const loadTable = (h, cycles, frames) => {
  const ptr = e.fledge_table_buffer(h, frames);
  new Float32Array(e.memory.buffer, ptr, frames * U.USER_CYCLE).set(cycles);
  return e.fledge_table_set(h, frames);
};

test('the oscillator table menu has "User table", where the engine has it', () => {
  const s = synth();
  assert.equal(FLEDGE_TABLES[U.USER_TABLE_INDEX], 'User table');
  assert.equal(text(e.bb_param_display(s.h, s.index.get('A table'))), 'Basic shapes');
  s.set('A table', U.USER_TABLE_INDEX);
  assert.equal(text(e.bb_param_display(s.h, s.index.get('A table'))), 'User table');
  assert.ok(Math.abs(e.bb_get(s.h, s.index.get('A table')) - U.USER_TABLE_INDEX / (U.TABLE_CAP - 1)) < 1e-6);
  e.bb_destroy(s.h);
});

test('the engine plays a user table once given (Basic shapes until then), safely, and takes it away again', () => {
  const t = U.tableFromSound([tone(220, 1)], SR, { frames: 16, cycle: 'pitch' });
  const run = (withTable, table) => {
    const s = synth();
    if (withTable) assert.equal(loadTable(s.h, t.cycles, 16), 1);
    s.set('A table', table);
    s.set('A position', 0.7);
    s.set('B on', 0);
    const out = play(s.h);
    e.bb_destroy(s.h);
    return out;
  };
  const basic = run(false, 0);
  assert.deepEqual(run(false, U.USER_TABLE_INDEX), basic);
  const user = run(true, U.USER_TABLE_INDEX);
  assert.notDeepEqual(user, basic);
  assert.ok(peak(user) <= 0.9 && rms(user) > 1e-3, `peak ${peak(user)} rms ${rms(user)}`);
  // Too many frames, or none: refused / cleared
  const s = synth();
  assert.equal(e.fledge_table_buffer(s.h, 65), 0);
  assert.equal(loadTable(s.h, t.cycles, 16), 1);
  assert.equal(e.fledge_table_set(s.h, 0), 0);
  e.bb_destroy(s.h);
});

test('every preset plays bit for bit the same with a user table loaded beside it', () => {
  const t = U.tableFromSound([tone(150, 1)], SR, { frames: 8, cycle: 'pitch' });
  const programs = e.bb_programs(e.bb_create(0, 48000));
  for (let p = 0; p < programs; p += 3) {
    const a = synth(p);
    const b = synth(p);
    loadTable(b.h, t.cycles, 8);
    assert.deepEqual(play(b.h, 60), play(a.h, 60), `preset ${p}`);
    e.bb_destroy(a.h);
    e.bb_destroy(b.h);
  }
});

test('the picture copy draws the user table, Basic shapes without one', () => {
  const t = U.tableFromSound([tone(220, 1)], SR, { frames: 4, cycle: 'pitch' });
  const draw = () => Array.from(new Float32Array(e.memory.buffer, e.fledge_wave(U.USER_TABLE_INDEX, 0, 0, 0), 256));
  e.fledge_picture_set(0);
  const basic = Array.from(new Float32Array(e.memory.buffer, e.fledge_wave(0, 0, 0, 0), 256));
  assert.deepEqual(draw(), basic);
  const ptr = e.fledge_picture_buffer(4);
  new Float32Array(e.memory.buffer, ptr, 4 * 2048).set(t.cycles);
  assert.equal(e.fledge_picture_set(4), 1);
  assert.notDeepEqual(draw(), basic);
  e.fledge_picture_set(0);
});

// --- The project ---

const fledgeTrack = (state) => ({
  id: 'f1', name: 'Table', color: '#fff', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0,
  eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0, instrumentKey: 'plugin',
  plugin: { id: 'p1', url: 'builtin:fledge/Fledge Synth', name: 'Fledge Synth', state },
});
const song = (tracks, clips = []) => ({ name: 'Resample', bpm: 140, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks, clips });

test('a user table is kept through a save; a damaged one is left out; older states are as they were', async () => {
  const t = U.tableFromSound([tone(110, 1)], SR, { frames: 16, cycle: 'pitch' });
  const table = await U.packUserTable(t.cycles, 16, 'Vowel');
  const state = { builtin: 1, program: 16, values: [0.5, 0.25], table };
  const back = parseProject(JSON.parse(JSON.stringify(serializeProject(song([fledgeTrack(state)])))));
  assert.deepEqual(back.tracks[0].plugin.state, state);
  const broken = parseProject(JSON.parse(JSON.stringify(serializeProject(song([fledgeTrack({ ...state, table: { ...table, bits: 3 } })])))));
  assert.deepEqual(broken.tracks[0].plugin.state, { builtin: 1, program: 16, values: [0.5, 0.25] });
  // Without a table: the state untouched (the same object shape as before)
  const old = { builtin: 1, program: 3, values: [0.1] };
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(serializeProject(song([fledgeTrack(old)]))))).tracks[0].plugin.state, old);
});

test('a share link carries the light copy of a user table', async () => {
  const t = U.tableFromSound([tone(110, 1)], SR, { frames: 32, cycle: 'pitch' });
  const table = await U.packUserTable(t.cycles, 32, 'Vowel');
  const link = await songLink(song([fledgeTrack({ builtin: 1, program: 16, values: [0.5], table })]), '');
  const opened = await projectFromHash(link.replace(/^[^#]*/, ''));
  const got = opened.tracks[0].plugin.state.table;
  assert.ok(got && got.frames === 8 && got.bits === 8 && got.size === 256);
  assert.ok((await U.unpackUserTable(got)).length === 8 * 2048);
  assert.ok(link.length < 6000, `link ${link.length} characters`);
});

test('a mangled clip and reversed slices are optional fields, read back and tidied', () => {
  const audio = normalizeClipAudio({ soundId: 's2', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, mangled: { from: 's1', offset: 1.5, bars: 2, steps: ['stutter 1/16', 'crushed', 7] } });
  assert.deepEqual(audio.mangled, { from: 's1', offset: 1.5, bars: 2, steps: ['stutter 1/16', 'crushed'] });
  assert.equal(normalizeClipAudio({ soundId: 's2', mangled: { from: '', offset: 0, bars: 1 } }).mangled, undefined);
  assert.equal(normalizeClipAudio({ soundId: 's2', mangled: { from: 's1', offset: 0, bars: -1 } }).mangled, undefined);
  assert.ok(referencedSoundIds({ clips: [{ audio }], tracks: [] }).includes('s1'));
  // The whole audio before the mangle is kept (its sounds too), without a mangle of its own
  const was = { soundId: 's1', offset: 1.5, gain: -3, fadeIn: 0, fadeOut: 0, shiftedFrom: 's0', shift: 2, envelope: [{ src: 1.5, db: -20 }] };
  const kept = normalizeClipAudio({ soundId: 's2', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, mangled: { from: 's1', offset: 1.5, bars: 2, steps: [], was: { ...was, mangled: { from: 'z', offset: 0, bars: 1, was } } } });
  assert.deepEqual(kept.mangled.was, was);
  assert.ok(referencedSoundIds({ clips: [{ audio: kept }], tracks: [] }).includes('s0'));
  assert.equal(normalizeClipAudio({ soundId: 's2', mangled: { from: 's1', offset: 0, bars: 1, was: { soundId: '' } } }).mangled.was, undefined);
  const sl = normalizeSlicer({ soundId: 'x', start: 0, end: 4, slices: [0, 1, 2, 3], reversed: [3, 3, 9, -1, 1.5, 0] });
  assert.deepEqual(sl.reversed, [0, 3]);
  assert.equal('reversed' in normalizeSlicer({ soundId: 'x', start: 0, end: 4, slices: [0, 1] }), false);
});

// --- Mangles ---

test('tape speed changes pitch and length together; pitch and formant keep the length; stretch keeps the pitch', () => {
  const x = [tone(220, 1)];
  const half = M.tape(x, -12, SR);
  assert.equal(half[0].length, 2 * SR);
  assert.ok(Math.abs(SR / U.detectPeriod(half[0], SR) - 110) < 1);
  const up = M.mangle(x, { kind: 'pitch', semitones: 12 }, SR);
  assert.equal(up[0].length, SR);
  assert.ok(Math.abs(SR / U.detectPeriod(up[0], SR) - 440) < 4);
  const f = M.mangle(x, { kind: 'formant', semitones: 5 }, SR);
  assert.equal(f[0].length, SR);
  assert.ok(Math.abs(SR / U.detectPeriod(f[0], SR) - 220) < 2, `formant keeps the pitch: ${SR / U.detectPeriod(f[0], SR)}`);
  const long = M.mangle(x, { kind: 'stretch', factor: 2 }, SR);
  assert.ok(Math.abs(long[0].length - 2 * SR) < 2);
  assert.ok(Math.abs(SR / U.detectPeriod(long[0], SR) - 220) < 2);
  assert.ok(Math.abs(M.lengthFactor({ kind: 'tape', semitones: -12 }) - 2) < 1e-9);
});

test('stutter repeats the start of each beat; shuffle is a seeded new order of the same cells', () => {
  const ramp = [Float32Array.from({ length: 8000 }, (_, i) => i / 8000)];
  const st = M.stutter(ramp, 500, 2000, SR);
  // Inside each beat, cell k plays cell 0 of the beat (away from the fades)
  for (const beat of [0, 2000, 4000]) for (const k of [1, 2, 3]) assert.ok(Math.abs(st[0][beat + k * 500 + 250] - ramp[0][beat + 250]) < 1e-6);
  const a = M.shuffle(ramp, 500, 7, SR);
  assert.deepEqual(a, M.shuffle(ramp, 500, 7, SR));
  assert.notDeepEqual(a, M.shuffle(ramp, 500, 8, SR));
  // The first cell stays; every cell is used once
  assert.ok(Math.abs(a[0][250] - ramp[0][250]) < 1e-6);
  const starts = Array.from({ length: 16 }, (_, k) => Math.round(a[0][k * 500 + 250] * 8000) - 250).sort((p, q) => p - q);
  assert.deepEqual(starts, Array.from({ length: 16 }, (_, k) => k * 500));
});

test('gate closes on its rests, crush steps the level; every mangle is level-matched and never peaks higher', () => {
  const x = [tone(220, 1), tone(330, 1)];
  const g = M.gate(x, 1000, [true, false], SR);
  assert.ok(Math.abs(g[0][1500]) < 1e-9 && Math.abs(g[0][500] - x[0][500]) < 1e-9);
  const c = M.crush(x, 3, 4);
  assert.ok(new Set(c[0]).size <= 9);
  assert.equal(c[0][1], c[0][0]);
  for (const op of [{ kind: 'gate', step: 2756, pattern: [...M.GATE_PATTERNS.Trance].map((ch) => ch === 'x') }, { kind: 'crush', bits: 4, downsample: 8 }, { kind: 'tape', semitones: 7 }, { kind: 'stutter', cell: 1378, beat: 11025 }, { kind: 'formant', semitones: -5 }]) {
    const out = M.mangle(x, op, SR);
    const pIn = Math.max(peak(x[0]), peak(x[1]));
    const pOut = Math.max(peak(out[0]), peak(out[1]));
    assert.ok(pOut <= pIn + 1e-6, `${op.kind} peaks at ${pOut} over ${pIn}`);
    assert.ok(rms(out[0]) > rms(x[0]) * 0.4, `${op.kind} keeps its loudness`);
  }
});

test('a mangle takes the clip gain envelope with it: a part pulled down stays down, a boost stays under full scale', () => {
  const x = [tone(220, 1)];
  // Down 30 dB from 0.5 s in the sound (the clip starting 0.25 s in)
  const env = [{ src: 0, db: 0 }, { src: 0.75, db: 0 }, { src: 0.7501, db: -30 }];
  const { channels, gainDb } = M.bakeEnvelope(x, env, SR / 4, SR);
  assert.equal(gainDb, 0);
  assert.ok(Math.abs(channels[0][100] - x[0][100]) < 1e-6);
  assert.ok(peak(channels[0].subarray(SR / 2 + 10)) < peak(x[0]) * 0.04);
  const out = M.mangle(channels, { kind: 'crush', bits: 8, downsample: 1 }, SR);
  assert.ok(peak(out[0].subarray(SR / 2 + 10)) < peak(x[0]) * 0.05, 'the quiet part comes back quiet');
  // At the bottom of the range: silent. No envelope: as it was
  assert.ok(peak(M.bakeEnvelope(x, [{ src: 0, db: -60 }], 0, SR).channels[0]) === 0);
  assert.equal(M.bakeEnvelope(x, undefined, 0, SR).channels, x);
  // +12 dB on a tone at 0.8: kept at full scale, the rest given back as clip gain
  const loud = M.bakeEnvelope([Float32Array.from(x[0], (v) => v * 0.8 / peak(x[0]))], [{ src: 0, db: 12 }], 0, SR);
  assert.ok(Math.abs(peak(loud.channels[0]) - 1) < 1e-6);
  assert.ok(Math.abs(loud.gainDb - 20 * Math.log10(0.8 * 10 ** (12 / 20))) < 1e-3);
});

// --- Slicer patterns and what a resample takes ---

test('a quiet print plays as quietly as it was: what the clip gain cannot reach goes on the fader', () => {
  assert.deepEqual(R.printLevel(-6), { gain: -6, volume: 0 });
  assert.deepEqual(R.printLevel(-40), { gain: -24, volume: -16 });
  assert.deepEqual(R.printLevel(-100), { gain: -24, volume: -60 });
  // Too loud for both: quieter, never louder
  assert.deepEqual(R.printLevel(40), { gain: 24, volume: 6 });
});

test('a stutter pattern is the same for the same seed, on the grid, ends in a roll; shuffle starts on slice 1', () => {
  const p = R.slicePattern('stutter', 16, 1, 2, 42);
  assert.deepEqual(p, R.slicePattern('stutter', 16, 1, 2, 42));
  assert.notDeepEqual(p, R.slicePattern('stutter', 16, 1, 2, 43));
  assert.ok(p.every((n) => n.startOffset >= 0 && n.startOffset < 2 && Number.isInteger(Math.round(n.startOffset * 32 * 1e6) / 1e6)));
  const lastBeat = p.filter((n) => n.startOffset >= 1.75);
  assert.equal(lastBeat.length, 8);
  assert.ok(lastBeat.every((n) => n.duration === '32n'));
  const sh = R.slicePattern('shuffle', 8, 1, 1, 5);
  assert.equal(sh.length, 16);
  assert.equal(sh[0].note, 'C3');
  assert.ok(sh.every((n) => /^[A-G]#?3$/.test(n.note)));
});

test('what a resample spans: the clips chosen, or the bars on the tracks asked for', () => {
  const clips = [
    { id: 'a', trackId: 't1', name: 'Chords', startBar: 3, lengthBars: 2 },
    { id: 'b', trackId: 't2', name: 'Bass', startBar: 1, lengthBars: 8 },
  ];
  assert.deepEqual(R.resampleSpan({ kind: 'clips', clipIds: ['a'] }, clips), { from: 3, to: 5, clips: [clips[0]] });
  assert.equal(R.resampleSpan({ kind: 'range', from: 5, to: 9, trackIds: ['t1'] }, clips), null);
  assert.equal(R.resampleSpan({ kind: 'range', from: 5, to: 9 }, clips).clips.length, 1);
  assert.equal(R.resampleSpan({ kind: 'clips', clipIds: [] }, clips), null);
  assert.equal(R.resampleName({ kind: 'clips', clipIds: ['a'] }, clips, new Map()), 'Chords (resampled)');
  assert.equal(R.resampleName({ kind: 'range', from: 1, to: 3, trackIds: ['t2'] }, clips, new Map([['t2', 'Bass']])), 'Bass bars 1–2 (resampled)');
  assert.equal(R.resampleName({ kind: 'range', from: 5, to: 6 }, clips, new Map()), 'Mix bar 5 (resampled)');
  assert.equal(R.resampleName({ kind: 'range', from: 1, to: 2.5 }, clips, new Map()), 'Mix bars 1–2.5 (resampled)');
});
