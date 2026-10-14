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

const { transitionCue, parseTransitions, ruleFor, bridgeNotes, bridgeTarget } = await import('../src/store/transitions.ts');
const { midiOf } = await import('../src/store/noteTools.ts');

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

test('phrase and loop-end timing, and bridge lengths, are read back; junk is dropped', () => {
  const rules = parseTransitions({ 'a>b': { kind: 'bridge', quantize: 'phrase', phraseBars: 8, bridgeBars: 2 }, 'a>c': { kind: 'cut', quantize: 'end', phraseBars: 5, bridgeBars: 3 } });
  assert.deepEqual(rules['a>b'], { kind: 'bridge', quantize: 'phrase', phraseBars: 8, bridgeBars: 2 });
  assert.deepEqual(rules['a>c'], { kind: 'cut', quantize: 'end' });
});

const pcs = (notes) => [...new Set(notes.map((n) => ((midiOf(n.note) % 12) + 12) % 12))].sort((a, b) => a - b);

test("a bridge into C major is its dominant seventh (G B D F), the bass stepping up through B", () => {
  const target = bridgeTarget([{ midi: 36, at: 0 }, { midi: 60, at: 0 }, { midi: 64, at: 0 }, { midi: 67, at: 0 }], 0.25);
  assert.equal(target.bass, 36);
  const b = bridgeNotes(target, 1, 1, 4);
  assert.equal(b.lengthBars, 1);
  assert.deepEqual(pcs(b.chords), [2, 5, 7, 11]);
  // The bass: G on the downbeat, B on the last beat, just under the new root
  assert.equal(midiOf(b.bass[0].note) % 12, 7);
  assert.equal(midiOf(b.bass[b.bass.length - 1].note), 35);
  assert.equal(b.bass[b.bass.length - 1].startOffset, 0.75);
  // Drums: the kit's rows, with a snare fill over the last beat
  assert.ok(b.drums.every((n) => ['C1', 'D1', 'F#1'].includes(n.note)));
  assert.equal(b.drums.filter((n) => n.note === 'D1' && n.startOffset >= 0.75).length, 4);
});

test('a two-bar bridge turns through ii before a major chord and iv before a minor one', () => {
  const major = bridgeNotes(bridgeTarget([{ midi: 62, at: 0 }, { midi: 66, at: 0 }, { midi: 69, at: 0 }], 0.25), 2, 1, 4);
  assert.equal(major.lengthBars, 2);
  // Into D major: E minor (E G B), then A7 (A C# E G)
  assert.deepEqual(pcs(major.chords.filter((n) => n.startOffset < 1)), [4, 7, 11]);
  assert.deepEqual(pcs(major.chords.filter((n) => n.startOffset >= 1)), [1, 4, 7, 9]);
  // Into A minor: D minor (D F A), then E7 (E G# B D)
  const minor = bridgeNotes(bridgeTarget([{ midi: 57, at: 0 }, { midi: 60, at: 0 }, { midi: 64, at: 0 }], 0.25), 2, 1, 4);
  assert.deepEqual(pcs(minor.chords.filter((n) => n.startOffset < 1)), [2, 5, 9]);
  assert.deepEqual(pcs(minor.chords.filter((n) => n.startOffset >= 1)), [2, 4, 8, 11]);
});

test('a bridge in 3/4 is a 3/4 measure: the chord once, the fill on beat three', () => {
  const b = bridgeNotes(bridgeTarget([{ midi: 48, at: 0 }, { midi: 64, at: 0 }], 0.25), 1, 0.75, 3);
  assert.equal(b.lengthBars, 0.75);
  assert.ok(b.chords.every((n) => n.startOffset === 0));
  assert.ok(b.drums.every((n) => n.startOffset < 0.75));
  assert.equal(b.drums.filter((n) => n.note === 'D1' && n.startOffset >= 0.5).length, 4);
});

test('with nothing at the very start, the first bar decides; with no notes at all it still makes a dominant of C', () => {
  assert.equal(bridgeTarget([{ midi: 45, at: 0.5 }], 0.25).bass, 45);
  const b = bridgeNotes(bridgeTarget([], 0.25), 1, 1, 4);
  assert.deepEqual(pcs(b.chords), [2, 5, 7, 11]);
});
