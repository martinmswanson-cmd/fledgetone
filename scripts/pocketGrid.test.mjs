// Pocket's step grids (src/pocket/pocketGrid.ts): steps per bar, turning steps on and off, held
// notes, the note grid's rows in key, and notes matched by pitch whatever their spelling. Run with
// `npm test`.
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
const { stepsPerBar, toggleStep, toggleCovering, scaleRows, noteToMidi, midiToNote, noteSteps } = await import('../src/pocket/pocketGrid.ts');
const { keyOf } = await import('../src/store/songKey.ts');

let n = 0;
const id = () => `n${++n}`;

test('a bar has 16 steps in 4/4 and 12 in 6/8 and 3/4', () => {
  assert.equal(stepsPerBar({ num: 4, den: 4 }), 16);
  assert.equal(stepsPerBar({ num: 6, den: 8 }), 12);
  assert.equal(stepsPerBar({ num: 3, den: 4 }), 12);
});

test('a step turns on as a 16th, and off again', () => {
  const on = toggleStep([], 'C1', 4, 16, 1, 0.85, id);
  assert.equal(on.length, 1);
  assert.equal(on[0].startOffset, 0.25);
  assert.equal(on[0].duration, '16n');
  assert.deepEqual(toggleStep(on, 'C1', 4, 16, 1, 0.85, id), []);
  // Another row on the same step is its own note
  assert.equal(toggleStep(on, 'D1', 4, 16, 1, 0.85, id).length, 2);
});

test('a held note is removed by tapping anywhere along it', () => {
  const notes = toggleCovering([], 'G4', 0, 16, 4, 0.8, id);
  assert.equal(noteSteps(notes[0], 16), 4);
  assert.deepEqual(toggleCovering(notes, 'G4', 3, 16, 2, 0.8, id), []);
  assert.equal(toggleCovering(notes, 'G4', 4, 16, 2, 0.8, id).length, 2);
});

test('notes match by pitch, whatever their spelling', () => {
  assert.equal(noteToMidi('A#3'), noteToMidi('Bb3'));
  assert.equal(midiToNote(60), 'C4');
  const flat = [{ id: 'x', note: 'Bb3', startOffset: 0, duration: '8n', velocity: 0.8 }];
  assert.deepEqual(toggleCovering(flat, 'A#3', 1, 16, 2, 0.8, id), []);
});

test("the note grid has only the key's notes, two octaves, high to low, in range", () => {
  const rows = scaleRows(keyOf(9, 'minor'), [21, 108], 60);
  assert.equal(rows.length, 15);
  assert.equal(rows[rows.length - 1].replace(/\d+$/, ''), 'A');
  assert.ok(rows.every((r) => ['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(r.replace(/\d+$/, ''))));
  assert.ok(noteToMidi(rows[0]) > noteToMidi(rows[1]));
  // A narrow range cuts the rows short rather than leaving it
  const bass = scaleRows(keyOf(0, 'major'), [28, 50], 40);
  assert.ok(bass.every((r) => noteToMidi(r) >= 28 && noteToMidi(r) <= 50));
});
