// Unit tests for game state transitions (src/store/transitions.ts). Run with `npm test`.
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

const { transitionCue, parseTransitions } = await import('../src/store/transitions.ts');

test('a fill plays on the song\'s own kit over the beat before the switch', () => {
  const cue = transitionCue('fill', [{ instrumentKey: 'piano' }, { instrumentKey: 'acousticKit' }]);
  assert.equal(cue.instrumentKey, 'acousticKit');
  assert.equal(cue.leadIn, 0.25);
  assert.deepEqual(cue.notes.map((n) => n.startOffset), [-0.25, -0.1875, -0.125, -0.0625]);
  assert.equal(transitionCue('fill', [{ instrumentKey: 'piano' }]).instrumentKey, 'drums');
});

test('a riser leads in a bar; an impact lands on the downbeat; a cut is nothing', () => {
  assert.equal(transitionCue('riser', []).leadIn, 1);
  assert.equal(transitionCue('riser', []).notes[0].startOffset, -1);
  assert.equal(transitionCue('impact', []).notes[0].startOffset, 0);
  assert.equal(transitionCue('cut', []), null);
});

test('transitions from a file keep only known kinds', () => {
  assert.deepEqual(parseTransitions({ a: 'fill', b: 'nope', c: 'cut', d: 'riser' }), { a: 'fill', d: 'riser' });
  assert.deepEqual(parseTransitions(null), {});
  assert.deepEqual(parseTransitions(['fill']), {});
});
