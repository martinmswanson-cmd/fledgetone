// Unit tests for store helpers: how insert / delete bars move positions (src/store/ripple.ts) and
// which sessions are worth offering to restore (src/store/project.ts). Run with `npm test`.
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
const { rippleRules } = await import('../src/store/ripple.ts');
const { hasWork } = await import('../src/store/project.ts');

const loop = (inBar, outBar) => ({ inBar, outBar, enabled: true });

test('insert bars: positions at or after the insert point move with the music, and back', () => {
  const { movePoint, backPoint, moveLoop } = rippleRules({ kind: 'insert', at: 5, bars: 2 });
  assert.deepEqual([1, 4.99, 5, 9].map(movePoint), [1, 4.99, 7, 11]);
  assert.deepEqual([1, 7, 11].map(backPoint), [1, 5, 9]);
  // A position in the inserted bars goes back to the insert point
  assert.equal(backPoint(6), 5);
  // A loop starting there moves; one ending there stays
  assert.deepEqual(moveLoop(loop(5, 9)), loop(7, 11));
  assert.deepEqual(moveLoop(loop(1, 5)), loop(1, 5));
  assert.deepEqual(moveLoop(loop(3, 7)), loop(3, 9));
  // Pushed off the end of the timeline (bar 401), Out is pinned there
  assert.deepEqual(rippleRules({ kind: 'insert', at: 390, bars: 8 }).moveLoop(loop(395, 399)), loop(397, 401));
  assert.deepEqual(rippleRules({ kind: 'insert', at: 390, bars: 8 }).moveLoop(loop(380, 399)), loop(380, 401));
});

test('delete bars: later positions move back, positions inside go to the cut, and back', () => {
  const { movePoint, backPoint, moveLoop } = rippleRules({ kind: 'remove', from: 5, to: 7, minLoop: 0.25 });
  assert.deepEqual([1, 5, 6, 7, 9].map(movePoint), [1, 5, 5, 5, 7]);
  assert.deepEqual([1, 5, 7].map(backPoint), [1, 5, 9]);
  assert.deepEqual(moveLoop(loop(1, 9)), loop(1, 7));
  // "Delete bars In → Out": the loop keeps its length, over what came after
  assert.deepEqual(moveLoop(loop(5, 7)), loop(5, 7));
});

test('a ripple edit is plain data, so an undo step holding it holds nothing else', () => {
  for (const edit of [{ kind: 'insert', at: 3, bars: 4 }, { kind: 'remove', from: 2, to: 3.5, minLoop: 0.0625 }]) {
    assert.deepEqual(JSON.parse(JSON.stringify(edit)), edit);
    // The same edit always moves positions the same way
    const a = rippleRules(edit);
    const b = rippleRules(JSON.parse(JSON.stringify(edit)));
    for (const bar of [1, 2.5, 3, 3.25, 6, 400]) {
      assert.equal(a.movePoint(bar), b.movePoint(bar));
      assert.equal(a.backPoint(bar), b.backPoint(bar));
    }
  }
});

test('a session with clips or markers is worth restoring; an empty one is not', () => {
  assert.equal(hasWork({ clips: [], markers: [] }), false);
  assert.equal(hasWork({ clips: [] }), false);
  assert.equal(hasWork({ clips: [{ id: 'c' }] }), true);
  // Hit points placed on a video before any music is written
  assert.equal(hasWork({ clips: [], markers: [{ id: 'm', name: 'Explosion', anchor: 'time', bar: 3, seconds: 4.8 }] }), true);
});
