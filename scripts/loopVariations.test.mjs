// Unit tests for loop variations (src/store/loopVariations.ts). Run with `npm test`.
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

const { loopVariation } = await import('../src/store/loopVariations.ts');

const tracks = [{ id: 'd', instrumentKey: 'drums' }, { id: 'p', instrumentKey: 'piano' }];
const n = (note, startOffset, id) => ({ id, note, startOffset, duration: '16n', velocity: 0.8 });
// A 2-bar drum loop from bar 5: kick on beats, hats on 8ths, snare on 2 and 4
const drumNotes = [];
for (let b = 0; b < 2; b++) for (let i = 0; i < 8; i++) drumNotes.push(n('F#1', b + i / 8, `h${b}${i}`));
for (let b = 0; b < 2; b++) for (const q of [0, 0.5]) drumNotes.push(n('C1', b + q, `k${b}${q}`));
for (let b = 0; b < 2; b++) for (const q of [0.25, 0.75]) drumNotes.push(n('D1', b + q, `s${b}${q}`));
const clips = [
  { id: 'cd', trackId: 'd', name: 'd', startBar: 5, lengthBars: 2, isSelected: false, notes: drumNotes },
  { id: 'cp', trackId: 'p', name: 'p', startBar: 5, lengthBars: 2, isSelected: false, notes: [n('C4', 0, 'p1'), n('E4', 1, 'p2')] },
];
const inLastBeat = (c, x) => c.startBar + x.startOffset >= 6.75;

test('take A is the loop as written', () => {
  assert.deepEqual(loopVariation(clips, tracks, 5, 7, 0), clips);
});

test('take B: snare fill on the last beat, new clip ids, melody untouched', () => {
  const b = loopVariation(clips, tracks, 5, 7, 1);
  assert.notEqual(b[0].id, 'cd');
  assert.deepEqual(b[1].notes, clips[1].notes);
  const last = b[0].notes.filter((x) => inLastBeat(b[0], x));
  assert.deepEqual(last.map((x) => x.note).sort(), ['D1', 'D1', 'D1', 'D1']);
  assert.equal(b[0].notes.filter((x) => !inLastBeat(b[0], x)).length, drumNotes.filter((x) => 5 + x.startOffset < 6.75).length);
});

test('take C: a tom fill; take D: hats out for the first half and a kick pickup', () => {
  const c = loopVariation(clips, tracks, 5, 7, 2);
  const lastC = c[0].notes.filter((x) => inLastBeat(c[0], x)).map((x) => x.note);
  assert.ok(lastC.includes('D2') && lastC.includes('F1'));
  const d = loopVariation(clips, tracks, 5, 7, 3);
  const hatsFirstHalf = d[0].notes.filter((x) => x.note === 'F#1' && 5 + x.startOffset < 6);
  assert.equal(hatsFirstHalf.length, 0);
  assert.ok(d[0].notes.some((x) => x.note === 'C1' && Math.abs(5 + x.startOffset - (6.75 + 2 / 16)) < 1e-9));
});
