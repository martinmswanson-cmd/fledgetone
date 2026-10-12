// Unit tests for take folders and comping (src/store/takes.ts). Run with `npm test`.
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
const t = await import('../src/store/takes.ts');

const note = (id, at) => ({ id, note: 'C4', startOffset: at, duration: '8n', velocity: 0.8 });
const folder = () => ({
  id: 'c',
  trackId: 'k',
  name: 'Takes',
  startBar: 5,
  lengthBars: 4,
  isSelected: false,
  notes: [],
  takes: [
    { id: 'a', name: 'Take 1', notes: [note('a1', 0), note('a2', 1), note('a3', 2), note('a4', 3)] },
    { id: 'b', name: 'Take 2', notes: [note('b1', 0.5), note('b2', 1.5), note('b3', 2.5), note('b4', 3.5)] },
  ],
});

test('a folder plays its last take until comped', () => {
  const c = folder();
  assert.deepEqual(t.compSegments(c), [{ at: 0, take: 1 }]);
  assert.deepEqual(t.compNotes(c).map((n) => n.id), ['b1', 'b2', 'b3', 'b4']);
});

test('comping a stretch from another take', () => {
  const c = folder();
  const comp = t.setCompRange(c, 1, 2.5, 0);
  assert.deepEqual(comp, [{ at: 0, take: 1 }, { at: 1, take: 0 }, { at: 2.5, take: 1 }]);
  const applied = t.applyComp({ ...c, comp }, () => 'x');
  assert.deepEqual(applied.notes.map((n) => n.startOffset), [0.5, 1, 2, 2.5, 3.5]);
  // Comping the rest back to the same take merges the segments
  assert.deepEqual(t.setCompRange({ ...c, comp }, 0, 4, 1), [{ at: 0, take: 1 }]);
});

test('adding and removing takes', () => {
  const plain = { id: 'c', trackId: 'k', name: 'x', startBar: 1, lengthBars: 2, isSelected: false, notes: [note('n', 0)] };
  const two = t.addTake(plain, { id: 'z', name: 'Take 2', notes: [note('m', 1)] });
  assert.equal(two.takes.length, 2);
  assert.deepEqual(two.takes[0].notes.map((n) => n.id), ['n']);
  assert.deepEqual(two.comp, [{ at: 0, take: 1 }]);
  const one = t.removeTake({ ...two, comp: [{ at: 0, take: 1 }, { at: 1, take: 0 }] }, 1);
  assert.deepEqual(one.comp, [{ at: 0, take: 0 }, { at: 1, take: 0 }].slice(0, 2));
  assert.equal(t.removeTake(t.flattenTakes(one), 0), null);
});

test('a comped sound plays as pieces of each take, crossfaded where they meet', () => {
  const audio = (id) => ({ soundId: id, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0.02 });
  const c = { id: 'm', trackId: 'k', name: 'Vox', startBar: 3, lengthBars: 4, isSelected: false, notes: [], audio: audio('s1'), takes: [{ id: 'a', name: 'Take 1', audio: audio('s1') }, { id: 'b', name: 'Take 2', audio: audio('s2') }], comp: [{ at: 0, take: 0 }, { at: 2, take: 1 }] };
  const pieces = t.expandAudioComp(c, 2);
  assert.deepEqual(pieces.map((p) => [p.startBar, p.lengthBars, p.audio.soundId, p.audio.offset]), [[3, 2 + t.COMP_CROSSFADE / 2, 's1', 0], [5, 2, 's2', 4]]);
  assert.equal(pieces[0].audio.fadeOut, 0);
  assert.equal(pieces[1].audio.fadeOut, 0.02);
  // Not comped across takes: as it is
  assert.deepEqual(t.expandAudioComp({ ...c, comp: [{ at: 0, take: 0 }] }, 2), [{ ...c, comp: [{ at: 0, take: 0 }] }]);
});

test('trim and split carry the takes and the comp', () => {
  const c = { ...folder(), comp: [{ at: 0, take: 0 }, { at: 2, take: 1 }] };
  const trimmed = t.trimTakes(c, 1, 0);
  assert.deepEqual(trimmed.comp, [{ at: 0, take: 0 }, { at: 1, take: 1 }]);
  assert.deepEqual(trimmed.takes[0].notes.map((n) => n.startOffset), [-1, 0, 1, 2]);
  let id = 0;
  const [left, right] = t.splitTakes(c, 3, 0, () => `n${id++}`);
  assert.deepEqual(left.comp, [{ at: 0, take: 0 }, { at: 2, take: 1 }]);
  assert.deepEqual(left.takes[0].notes.map((n) => n.startOffset), [0, 1, 2]);
  assert.deepEqual(right.comp, [{ at: 0, take: 1 }]);
  assert.deepEqual(right.takes[1].notes.map((n) => n.startOffset), [0.5]);
});

// Seconds at a steady 120 BPM: 2 s a bar
const between = (a, b) => (b - a) * 2;
const after = (bar, s) => bar + s / 2;

test('a mic recording over a looping region: a take per pass, partial first pass dropped', () => {
  const loop = { inBar: 5, outBar: 7 };
  // Started at bar 6 (half a pass), then two whole passes and a bit: 2 + 4 + 4 + 1 s
  const pieces = t.recordedPieces(6, 11, loop, null, true, between, after);
  assert.deepEqual(pieces, [
    { startBar: 5, lengthBars: 2, from: 2 },
    { startBar: 5, lengthBars: 2, from: 6 },
    { startBar: 5, lengthBars: 2, from: 10 },
  ]);
  // Takes off: the last whole pass (not the bit after the last wrap)
  assert.deepEqual(t.recordedPieces(6, 11, loop, null, false, between, after), [{ startBar: 5, lengthBars: 2, from: 6 }]);
});

test('a mic recording punched in: only the punch range is kept', () => {
  assert.deepEqual(t.recordedPieces(1, 20, null, { inBar: 3, outBar: 4.5 }, false, between, after), [{ startBar: 3, lengthBars: 1.5, from: 4 }]);
  // Punch outside what was recorded
  assert.deepEqual(t.recordedPieces(1, 2, null, { inBar: 3, outBar: 4 }, false, between, after), []);
  // Punch inside a loop, with takes: each pass's punch range
  const pieces = t.recordedPieces(5, 8, { inBar: 5, outBar: 7 }, { inBar: 5.5, outBar: 6 }, true, between, after);
  assert.deepEqual(pieces, [
    { startBar: 5.5, lengthBars: 0.5, from: 1 },
    { startBar: 5.5, lengthBars: 0.5, from: 5 },
  ]);
});

test('review fixes: comp keeps the folder\'s gain and stretch; pieces carry the stretch', () => {
  const audio = (soundId, offset) => ({ soundId, offset, gain: 0, fadeIn: 0, fadeOut: 0 });
  const c = {
    id: 'm', trackId: 'k', name: 'Vox', startBar: 1, lengthBars: 2, isSelected: false, notes: [],
    audio: { ...audio('a', 0), gain: -6, fadeIn: 0.1, stretchBpm: 100 },
    takes: [{ id: 'a', name: 'A', audio: audio('a', 0) }, { id: 'b', name: 'B', audio: audio('b', 3) }],
    comp: [{ at: 0, take: 1 }],
  };
  const applied = t.applyComp(c, () => 'x');
  assert.equal(applied.audio.soundId, 'b');
  assert.equal(applied.audio.offset, 3);
  assert.equal(applied.audio.gain, -6);
  assert.equal(applied.audio.stretchBpm, 100);
  const pieces = t.expandAudioComp({ ...c, comp: [{ at: 0, take: 0 }, { at: 1, take: 1 }] }, 2);
  assert.ok(pieces.every((p) => p.audio.stretchBpm === 100 && p.audio.gain === -6));
});

test('review fixes: piano roll edits survive a comp change', () => {
  const c = t.applyComp(folder(), () => 'n');
  // Transpose what plays (take 2's notes) up an octave
  const edited = { ...c, notes: c.notes.map((n) => ({ ...n, note: 'C5' })) };
  const kept = t.keepNoteEdits(edited);
  assert.ok(kept.takes[1].notes.every((n) => n.note === 'C5'));
  assert.ok(kept.takes[0].notes.every((n) => n.note === 'C4'));
  assert.equal(t.keepNoteEdits(c), c);
});

test('review fixes: recorded passes', () => {
  const loop = { inBar: 5, outBar: 7 };
  // Takes on, one pass and a 50 ms tail: the tail isn't a take
  assert.deepEqual(t.recordedPieces(5, 4.05, loop, null, true, between, after), [{ startBar: 5, lengthBars: 2, from: 0 }]);
  // Takes off, punch over the loop, stopped just after the wrap: the whole pass, not the sliver
  assert.deepEqual(t.recordedPieces(5, 4.05, loop, { inBar: 5, outBar: 7 }, false, between, after), [{ startBar: 5, lengthBars: 2, from: 0 }]);
  // Started before the loop In: the passes after it are takes from the In
  const pieces = t.recordedPieces(3, 12, loop, null, true, between, after);
  assert.deepEqual(pieces.map((p) => [p.startBar, p.lengthBars, p.from]), [[5, 2, 4], [5, 2, 8]]);
});
