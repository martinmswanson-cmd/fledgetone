// Unit tests for the key change (src/store/keyChange.ts). Run with `npm test`.
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
const { keyChange, isPitched } = await import('../src/store/keyChange.ts');

const track = (id, instrumentKey) => ({ id, instrumentKey });
const clip = (id, trackId, startBar, lengthBars, notes) => ({ id, trackId, name: id, startBar, lengthBars, isSelected: false, notes: notes.map(([note, startOffset], i) => ({ id: `${id}${i}`, note, startOffset, duration: '4n', velocity: 0.8 })) });

test('pitched notes from the bar on move; earlier ones and drums stay', () => {
  const tracks = [track('p', 'piano'), track('d', 'drums'), track('t', 'taiko')];
  const clips = [
    clip('a', 'p', 1, 4, [['C4', 0], ['E4', 2], ['G4', 3.5]]),
    clip('b', 'p', 9, 1, [['A4', 0]]),
    clip('k', 'd', 5, 1, [['C1', 0]]),
    clip('x', 't', 5, 1, [['C2', 0]]),
  ];
  const { clips: out, moved } = keyChange(clips, tracks, 3, 2);
  assert.deepEqual(out[0].notes.map((n) => n.note), ['C4', 'F#4', 'A4']);
  assert.equal(out[1].notes[0].note, 'B4');
  assert.equal(out[2], clips[2]);
  assert.equal(out[3], clips[3]);
  assert.equal(moved, 3);
});

test("notes that would leave the instrument's range stay and are counted", () => {
  const { clips: out, moved, outOfRange } = keyChange([clip('a', 'v', 1, 1, [['C7', 0]])], [track('v', 'violin')], 1, 12);
  assert.equal(out[0].notes[0].note, 'C7');
  assert.equal(moved, 0);
  assert.equal(outOfRange, 1);
});

test('which instruments count as pitched', () => {
  assert.ok(isPitched('piano') && isPitched('bass808') && isPitched('timpani'));
  assert.ok(!isPitched('drums') && !isPitched('fx') && !isPitched('taiko') && !isPitched('seashore'));
});
