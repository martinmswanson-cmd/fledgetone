// One preview at a time (src/audio/exclusivePreview.ts): a preview that starts stops every other
// one registered, never itself; a stop that throws doesn't keep the others playing; taking a
// registration back (or replacing it) is exact. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { claimPreview, registerPreview } = await import('../src/audio/exclusivePreview.ts');

test('a preview starting stops the others, not itself', () => {
  const stopped = [];
  const offA = registerPreview('a', () => stopped.push('a'));
  const offB = registerPreview('b', () => {
    stopped.push('b');
    throw new Error('already gone');
  });
  const offC = registerPreview('c', () => stopped.push('c'));
  claimPreview('a');
  assert.deepEqual(stopped, ['b', 'c']);
  stopped.length = 0;
  claimPreview('someone-new');
  assert.deepEqual(stopped.sort(), ['a', 'b', 'c']);
  offA();
  offB();
  offC();
  stopped.length = 0;
  claimPreview('x');
  assert.deepEqual(stopped, []);
});

test('a second registration under an id replaces the first, and the first one\'s take-back leaves it', () => {
  const stopped = [];
  const first = registerPreview('p', () => stopped.push('first'));
  const second = registerPreview('p', () => stopped.push('second'));
  first();
  claimPreview('q');
  assert.deepEqual(stopped, ['second']);
  second();
});
