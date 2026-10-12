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
  near(durationToBars(l[0].duration), 0.25);
  near(durationToBars(l[1].duration), 0.5);
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
