// Pocket's note maths (src/pocket/pocketGrid.ts): steps per bar, a note's length in steps, the
// rows of the key, and notes matched by pitch whatever their spelling. Run with `npm test`.
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
const { stepsPerBar, scaleRows, noteToMidi, midiToNote, noteSteps } = await import('../src/pocket/pocketGrid.ts');
const { keyOf } = await import('../src/store/songKey.ts');

test('a bar has 16 steps in 4/4 and 12 in 6/8 and 3/4', () => {
  assert.equal(stepsPerBar({ num: 4, den: 4 }), 16);
  assert.equal(stepsPerBar({ num: 6, den: 8 }), 12);
  assert.equal(stepsPerBar({ num: 3, den: 4 }), 12);
});

test('a note covers as many 16ths as it lasts (at least one)', () => {
  assert.equal(noteSteps({ duration: '4n' }, 16), 4);
  assert.equal(noteSteps({ duration: '1m' }, 16), 16);
  assert.equal(noteSteps({ duration: '32n' }, 16), 1);
});

test('notes match by pitch, whatever their spelling', () => {
  assert.equal(noteToMidi('A#3'), noteToMidi('Bb3'));
  assert.equal(midiToNote(60), 'C4');
  assert.equal(midiToNote(noteToMidi('Db2')), 'C#2');
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
