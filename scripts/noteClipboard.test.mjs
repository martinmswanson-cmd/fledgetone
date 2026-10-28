// Unit tests for the piano roll's note clipboard (src/store/noteClipboard.ts): what a copy keeps,
// where a paste and a duplicate put the notes, and notes that wouldn't fit. Run with `npm test`.
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

const { duplicateAt, heldNotes, holdNotes, noteClip, placeNotes } = await import('../src/store/noteClipboard.ts');

const note = (id, n, startOffset, duration = '8n', extra = {}) => ({ id, note: n, startOffset, duration, velocity: 0.8, ...extra });

test('a copy keeps the notes as they are, counted from the first one, without their ids', () => {
  const clip = noteClip([note('b', 'E4', 1.25, '4n', { chance: 0.5 }), note('a', 'C4', 1)]);
  assert.equal(clip.from, 1);
  assert.equal(clip.span, 0.5);
  assert.deepEqual(
    clip.notes.map((n) => [n.note, n.startOffset, n.duration, n.chance]),
    [['E4', 0.25, '4n', 0.5], ['C4', 0, '8n', undefined]]
  );
  assert.ok(clip.notes.every((n) => !('id' in n)));
  assert.equal(noteClip([]), null);
});

test('a paste puts them from the place given, keeping their timing and pitches; notes past the clip end are left out', () => {
  const clip = noteClip([note('a', 'C4', 0), note('b', 'G4', 0.5), note('c', 'E4', 1.5)]);
  assert.deepEqual(placeNotes(clip, 2, 4).map((n) => [n.note, n.startOffset]), [['C4', 2], ['G4', 2.5], ['E4', 3.5]]);
  assert.deepEqual(placeNotes(clip, 3, 4).map((n) => [n.note, n.startOffset]), [['C4', 3], ['G4', 3.5]]);
  assert.deepEqual(placeNotes(clip, 4, 4), []);
  // (No drift from adding bar fractions)
  assert.equal(placeNotes(noteClip([note('a', 'C4', 0.1), note('b', 'D4', 0.3)]), 0.2, 4)[1].startOffset, 0.4);
});

test('a duplicate goes straight after the notes, on the grid', () => {
  // Two 8ths from bar 0: an 8th-note grid puts the copy right after them
  const clip = noteClip([note('a', 'C4', 0), note('b', 'D4', 0.125)]);
  assert.equal(duplicateAt(clip, 0.125), 0.25);
  // A coarser grid rounds up to its next line
  assert.equal(duplicateAt(clip, 1), 1);
  // A note shorter than a grid step still moves on by one step
  assert.equal(duplicateAt(noteClip([note('a', 'C4', 0.5, '32n')]), 0.25), 0.75);
});

test('the clipboard keeps what was copied last, and nothing copied leaves it as it was', () => {
  assert.equal(heldNotes(), null);
  const first = noteClip([note('a', 'C4', 0)]);
  holdNotes(first);
  holdNotes(null);
  assert.equal(heldNotes(), first);
});
