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

const { transitionCue, parseTransitions, ruleFor } = await import('../src/store/transitions.ts');

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

test('older files (a kind per state gone into) become rules from any state', () => {
  assert.deepEqual(parseTransitions({ a: 'fill', b: 'nope', d: 'riser' }), { '*>a': { kind: 'fill' }, '*>d': { kind: 'riser' } });
  assert.deepEqual(parseTransitions(null), {});
  assert.deepEqual(parseTransitions(['fill']), {});
});

test('matrix rules: options kept, junk dropped', () => {
  const rules = parseTransitions({ 'a>b': { kind: 'crossfade', beats: 8, quantize: 'beat' }, '*>b': { kind: 'stinger', stingerId: 's1', beats: 99 }, 'x>y': { kind: 'warp' } });
  assert.deepEqual(rules, { 'a>b': { kind: 'crossfade', beats: 8, quantize: 'beat' }, '*>b': { kind: 'stinger', stingerId: 's1' } });
});

test("a state's own rule wins over Any; with neither it cuts", () => {
  const rules = { 'a>b': { kind: 'crossfade' }, '*>b': { kind: 'riser' } };
  assert.equal(ruleFor(rules, 'a', 'b').kind, 'crossfade');
  assert.equal(ruleFor(rules, 'c', 'b').kind, 'riser');
  assert.equal(ruleFor(rules, null, 'b').kind, 'riser');
  assert.equal(ruleFor(rules, 'a', 'c').kind, 'cut');
});
