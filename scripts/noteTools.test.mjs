// Unit tests for the piano roll's composing helpers (src/store/noteTools.ts). Run with `npm test`.
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
const T = await import('../src/store/noteTools.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');

const N = (id, note, start, duration = '4n', velocity = 0.8) => ({ id, note, startOffset: start, duration, velocity });
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('note names and MIDI numbers', () => {
  assert.equal(T.midiOf('C4'), 60);
  assert.equal(T.midiOf('A0'), 21);
  assert.equal(T.midiOf('Bb2'), T.midiOf('A#2'));
  assert.ok(Number.isNaN(T.midiOf('H2')));
  for (let m = 12; m < 120; m++) assert.equal(T.midiOf(T.nameOf(m)), m);
});

test('scales: membership and snapping', () => {
  const aMinor = { root: 9, id: 'minor' };
  assert.ok(T.inScale(T.midiOf('C4'), aMinor));
  assert.ok(!T.inScale(T.midiOf('C#4'), aMinor));
  assert.equal(T.nameOf(T.snapToScale(T.midiOf('C#4'), aMinor)), 'D4'); // tie goes up
  assert.equal(T.nameOf(T.snapToScale(T.midiOf('G#4'), aMinor)), 'A4');
});

test('chords: fixed shapes and chords in key', () => {
  assert.deepEqual(T.chordNotes(60, 'minor', null), [60, 63, 67]);
  const cMajor = { root: 0, id: 'major' };
  // Degree ii in C is D minor, vii is B diminished, V7 is a dominant 7th
  assert.deepEqual(T.chordNotes(62, 'diatonic', cMajor).map(T.nameOf), ['D4', 'F4', 'A4']);
  assert.deepEqual(T.chordNotes(71, 'diatonic', cMajor).map(T.nameOf), ['B4', 'D5', 'F5']);
  assert.deepEqual(T.chordNotes(67, 'diatonic7', cMajor).map(T.nameOf), ['G4', 'B4', 'D5', 'F5']);
  // An out-of-key root is pulled into the key first
  assert.deepEqual(T.chordNotes(61, 'diatonic', cMajor).map(T.nameOf), ['D4', 'F4', 'A4']);
});

test('quantize moves starts to the song grid, with strength', () => {
  const notes = [N('a', 'C4', 0.07), N('b', 'E4', 0.3)];
  const q = T.quantize(notes, 1 / 16, 0);
  near(q[0].startOffset, 0.0625);
  near(q[1].startOffset, 0.3125);
  const half = T.quantize(notes, 1 / 16, 0, 0.5);
  near(half[0].startOffset, 0.07 + (0.0625 - 0.07) / 2);
  // A clip starting mid-bar: its grid is the song's
  const offset = T.quantize([N('c', 'C4', 0.03)], 1 / 4, 0.1);
  near(offset[0].startOffset, 0.15);
});

test('strum spreads a chord low to high and keeps its end', () => {
  const chord = [N('a', 'G4', 0, '2n'), N('b', 'C4', 0, '2n'), N('c', 'E4', 0, '2n')];
  const s = T.strum(chord, 4, 1 / 96);
  const byNote = Object.fromEntries(s.map((n) => [n.note, n]));
  near(byNote.C4.startOffset, 0);
  near(byNote.E4.startOffset, 1 / 96);
  near(byNote.G4.startOffset, 2 / 96);
  near(byNote.G4.startOffset + durationToBars(byNote.G4.duration), 0.5, 1 / 3072);
});

test('arpeggiate breaks a chord up over its length', () => {
  let i = 0;
  const id = () => `x${i++}`;
  const chord = [N('a', 'C4', 0, '2n'), N('b', 'E4', 0, '2n'), N('c', 'G4', 0, '2n')];
  const up = T.arpeggiate(chord, 1 / 16, 'up', id);
  assert.deepEqual(up.map((n) => n.note), ['C4', 'E4', 'G4', 'C4', 'E4', 'G4', 'C4', 'E4']);
  near(up[7].startOffset, 7 / 16);
  const ud = T.arpeggiate(chord, 1 / 16, 'upDown', id);
  assert.deepEqual(ud.map((n) => n.note).slice(0, 6), ['C4', 'E4', 'G4', 'E4', 'C4', 'E4']);
  // Single notes are left alone
  assert.deepEqual(T.arpeggiate([N('z', 'C4', 0)], 1 / 16, 'up', id), [N('z', 'C4', 0)]);
});

test('legato, transpose, fit to scale, humanize', () => {
  const notes = [N('a', 'C4', 0, '16n'), N('b', 'D4', 0.25, '16n'), N('c', 'E4', 0.75, '16n')];
  const l = T.legato(notes, 1);
  // Each runs a 64th into the next (so a mono synth glides); the last to the clip's end
  near(durationToBars(l[0].duration), 0.25 + 1 / 64);
  near(durationToBars(l[1].duration), 0.5 + 1 / 64);
  near(durationToBars(l[2].duration), 0.25);
  assert.deepEqual(T.transpose(notes, 12, 0, 127).map((n) => n.note), ['C5', 'D5', 'E5']);
  // Out of range: stays
  assert.equal(T.transpose([N('a', 'C4', 0)], 12, 0, 70)[0].note, 'C4');
  assert.deepEqual(T.fitToScale([N('a', 'C#4', 0), N('b', 'F#4', 0)], { root: 0, id: 'major' }).map((n) => n.note), ['D4', 'G4']);
  const h = T.humanize(notes, 1, 1 / 192, 0.1, () => 1);
  near(h[1].startOffset, 0.25 + 1 / 192);
  near(h[0].velocity, 0.9);
  const h0 = T.humanize(notes, 1, 1 / 192, 0.1, () => 0);
  near(h0[0].startOffset, 0); // never before the clip
});

const SP = await import('../src/store/synthPatch.ts');

test('synth patches: presets are valid, saved patches are made safe', () => {
  for (const { name } of SP.SYNTH_PRESETS) {
    const p = SP.presetPatch(name);
    assert.deepEqual(SP.normalizeSynthPatch(JSON.parse(JSON.stringify(p))), p, name);
  }
  const wild = SP.normalizeSynthPatch({ osc1: { wave: 'banana', octave: 9, level: -2 }, unison: { voices: 40 }, filter: { cutoff: 1e9 }, lfo: { sync: '1/3' }, level: 'loud' });
  assert.equal(wild.osc1.wave, 'sawtooth');
  assert.equal(wild.osc1.octave, 3);
  assert.equal(wild.osc1.level, 0);
  assert.equal(wild.unison.voices, 7);
  assert.equal(wild.filter.cutoff, 20000);
  assert.equal(wild.lfo.sync, SP.defaultSynthPatch().lfo.sync);
  assert.equal(wild.level, SP.defaultSynthPatch().level);
  assert.equal(SP.normalizeSynthPatch('nope'), undefined);
});

test('ratchet splits each note evenly, rising to its own velocity', () => {
  let k = 0;
  const out = T.ratchet([N('a', 'C4', 0, '4n', 0.8)], 4, () => `r${k++}`);
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((n) => +n.startOffset.toFixed(4)), [0, 0.0625, 0.125, 0.1875]);
  assert.ok(out.every((n) => durationToBars(n.duration) === 0.0625));
  assert.equal(out[0].id, 'a');
  assert.ok(out[0].velocity < out[3].velocity && Math.abs(out[3].velocity - 0.8) < 1e-9);
});

test('roll repeats a note at the grid rate for its length', () => {
  let k = 0;
  const out = T.roll([N('s', 'D1', 0.5, '4n', 0.9)], 1 / 32, () => `r${k++}`);
  assert.equal(out.length, 8);
  assert.ok(Math.abs(out[7].startOffset - (0.5 + 7 / 32)) < 1e-9);
  assert.ok(out[0].velocity < 0.4 && Math.abs(out[7].velocity - 0.9) < 1e-9);
});

test('durations in whole bars ("1m", "2m") are read as bars', () => {
  assert.equal(durationToBars('1m'), 1);
  assert.equal(durationToBars('2m'), 2);
  assert.equal(durationToBars('3m'), 3);
  assert.equal(durationToBars('4n'), 0.25);
});

test('retrograde: the notes mirrored in time, each keeping its length', async () => {
  const { retrograde } = await import('../src/store/noteTools.ts');
  const notes = [
    { id: 'a', note: 'C4', startOffset: 0, duration: '4n', velocity: 0.8 },
    { id: 'b', note: 'D4', startOffset: 0.25, duration: '8n', velocity: 0.8 },
    { id: 'c', note: 'E4', startOffset: 0.5, duration: '2n', velocity: 0.8 },
  ];
  const r = retrograde(notes, 1);
  const at = Object.fromEntries(r.map((n) => [n.note, n.startOffset]));
  // Spans 0..1: E (0.5-1.0) now first at 0, D (0.25-0.375) at 0.625, C (0-0.25) last at 0.75
  assert.deepEqual(at, { E4: 0, D4: 0.625, C4: 0.75 });
  assert.deepEqual(retrograde(retrograde(notes, 1), 1).map((n) => n.startOffset), notes.map((n) => n.startOffset));
});
