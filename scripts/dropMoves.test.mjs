// Unit tests for reading the Drop pad's moves from the song (src/store/dropMoves.ts). Run with `npm test`.
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

const { dropMoves, isDropTrack } = await import('../src/store/dropMoves.ts');
const { DROP_ROWS } = await import('../src/audio/instrumentCatalog.ts');
const { DROP_EFFECTS } = await import('../src/audio/effects/dropFx.ts');

const track = (id, extra = {}) => ({ id, name: id, instrumentKey: 'dropPad', isMuted: false, isSoloed: false, ...extra });
const note = (row, startOffset, duration) => ({ id: `n${row}${startOffset}`, note: DROP_ROWS[row].note, startOffset, duration, velocity: 1 });
const clip = (trackId, startBar, notes, extra = {}) => ({ id: `c${trackId}${startBar}`, trackId, name: 'c', startBar, lengthBars: 4, isSelected: false, notes, ...extra });

test('a row for every effect, in the kernel\'s order', () => {
  assert.equal(DROP_ROWS.length, DROP_EFFECTS.length);
  DROP_ROWS.forEach((r, i) => assert.equal(r.fx, i));
});

test('each note holds its row\'s effect, from where it starts for its length', () => {
  const moves = dropMoves([track('d')], [clip('d', 5, [note(2, 1, '4n'), note(0, 0.5, '0:0:6')])]);
  assert.deepEqual(moves, [
    { fx: 0, from: 5.5, to: 5.5 + 6 / 16 },
    { fx: 2, from: 6, to: 6.25 },
  ]);
});

test('only Drop tracks, and not when muted or left out by solo', () => {
  const keys = { ...track('k'), instrumentKey: 'keys' };
  assert.equal(isDropTrack(keys), false);
  const clips = [clip('d', 1, [note(1, 0, '4n')]), clip('k', 1, [{ ...note(1, 0, '4n') }])];
  assert.equal(dropMoves([track('d'), keys], clips).length, 1);
  assert.equal(dropMoves([track('d', { isMuted: true }), keys], clips).length, 0);
  assert.equal(dropMoves([track('d'), { ...keys, isSoloed: true }], clips).length, 0);
});

test('notes hidden by a trim don\'t play; one running past its clip still lasts its length', () => {
  const moves = dropMoves([track('d')], [clip('d', 1, [note(3, 3.5, '1m'), note(4, 4.25, '4n')])]);
  assert.deepEqual(moves, [{ fx: 3, from: 4.5, to: 5.5 }]);
});
