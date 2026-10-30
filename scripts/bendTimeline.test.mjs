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
  const b = createBendTimeline();
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
  const b = createBendTimeline();
  b.set(50, 5);
  b.set(30, 1);
  b.set(70, 5);
  assert.equal(b.at(2), 30);
  assert.equal(b.at(5), 70);
});

test('a cut drops the bends still to come, those for that very time too', () => {
  const b = createBendTimeline();
  for (let i = 0; i <= 10; i++) b.set(i * 10, i);
  b.set(40, 4, true);
  assert.equal(b.at(4), 40);
  assert.equal(b.at(9), 40);
  assert.deepEqual(b.after(4), []);
  b.set(0, 4, true);
  assert.equal(b.at(4), 0, "the cut's own bend replaces one sent for its time");
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
