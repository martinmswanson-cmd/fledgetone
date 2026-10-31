// Unit tests for the bends an instrument that bends as a whole keeps by time (src/audio/bendTimeline.ts)
// and for a held-over note's clip playing as its own clip (src/store/noteChance.ts ownClipId).
// Run with `npm test`.
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
const { createBendTimeline } = await import('../src/audio/bendTimeline.ts');
const { clipRuns, ownClipId } = await import('../src/store/noteChance.ts');

test('a bend sent ahead of its time is in force only from then; a note starting before it starts unbent', () => {
  const b = createBendTimeline(() => 0);
  assert.equal(b.moved(), false);
  b.set(100, 2);
  b.set(200, 3);
  b.set(0, 4);
  assert.equal(b.at(1), 0);
  assert.equal(b.at(2.5), 100);
  assert.equal(b.at(3), 200);
  assert.equal(b.at(9), 0);
  assert.deepEqual(b.after(2.5), [[3, 200], [4, 0]]);
  assert.equal(b.moved(), true);
});

test('sent out of order, bends still go by time; one sent for the same time later wins', () => {
  const b = createBendTimeline(() => 0);
  b.set(50, 5);
  b.set(30, 1);
  b.set(70, 5);
  assert.equal(b.at(2), 30);
  assert.equal(b.at(5), 70);
});

test('a cut drops the bends still to come, those for that very time too', () => {
  const b = createBendTimeline(() => 0);
  for (let i = 0; i <= 10; i++) b.set(i * 10, i);
  b.set(40, 4, true);
  assert.equal(b.at(4), 40);
  assert.equal(b.at(9), 40);
  assert.deepEqual(b.after(4), []);
  b.set(0, 4, true);
  assert.equal(b.at(4), 0, "the cut's own bend replaces one sent for its time");
});

test('bends are kept by the clock: a long curve sent ahead keeps the points a note starting before its end needs', () => {
  let now = 0;
  const b = createBendTimeline(() => now);
  // A 60 s curve sent whole when its note starts
  for (let i = 0; i <= 600; i++) b.set(i % 2 ? 30 : -30, i / 10);
  assert.equal(b.at(5.05), -30, 'a point 55 s before the last one sent is still there');
  assert.equal(b.after(5).length, 600 - 50);
  now = 40;
  b.set(0, 70);
  assert.equal(b.at(10.15), 30, 'kept 30 s behind the clock');
  assert.equal(b.at(10.05), -30, 'the one in force 30 s behind it is kept');
  assert.equal(b.after(9).length, 600 - 100 + 2, 'older ones go (from the one at 10 s, with the one at 70 s)');
});

test('the bends sent for between two times', () => {
  const b = createBendTimeline(() => 0);
  for (let i = 0; i <= 10; i++) b.set(i * 10, i);
  assert.deepEqual(b.after(2, 5), [[3, 30], [4, 40]]);
  assert.deepEqual(b.after(2, 2.5), []);
  assert.deepEqual(b.after(2, 1), []);
  assert.deepEqual(b.after(8), [[9, 90], [10, 100]]);
});

test("a held-over note's clip goes by its own clip's id and passes", () => {
  assert.equal(ownClipId('c1~held'), 'c1');
  assert.equal(ownClipId('c1'), 'c1');
  const note = (id, chance) => ({ id, note: 'C4', startOffset: 0, duration: '4m', velocity: 0.8, chance });
  const clips = [
    { id: 'a', trackId: 't', startBar: 1, lengthBars: 1, notes: [note('n', 0.5)] },
    { id: 'b', trackId: 't', startBar: 2, lengthBars: 1, notes: [note('n', 0.5)] },
    { id: 'b~held', trackId: 't', startBar: 3, lengthBars: 1, notes: [note('n', 0.5)] },
  ];
  const runs = clipRuns(clips);
  assert.equal(runs.get('b~held'), runs.get('b'));
  assert.equal(runs.get('b').index, 1);
});
