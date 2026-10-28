// Pocket's clip maths (src/pocket/pocketClips.ts): a cell's clips made one with their lanes where
// they played, a section's linked copy that stays linked, and an edit's undo steps folded into
// one. Run with `npm test`.
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
const { mergePieces, sectionCopy, foldSteps } = await import('../src/pocket/pocketClips.ts');
const { syncPatterns } = await import('../src/store/patterns.ts');

const clip = (startBar, lengthBars, extra = {}) => ({ id: `c${startBar}`, trackId: 't', name: 'x', startBar, lengthBars, isSelected: false, notes: [{ id: `n${startBar}`, note: 'A2', startOffset: 0, duration: '4n', velocity: 0.8 }], ...extra });
const lane = (steps, grid = 6) => [{ id: 'l', target: 'filterCutoff', grid, steps }];

test("a piece's notes and step lanes move to where it plays in the section", () => {
  const out = mergePieces([clip(2, 1, { stepLanes: lane([{ at: 0, value: 0.9 }, { at: 0.5, value: 0.1 }]) })], 1, null);
  assert.deepEqual(out.notes.map((n) => n.startOffset), [1]);
  assert.deepEqual(out.stepLanes[0].steps, [{ at: 1, value: 0.9 }, { at: 1.5, value: 0.1 }]);
});

test("pieces one after another keep each one's lane steps (one lane per setting)", () => {
  const out = mergePieces([clip(2, 1, { stepLanes: lane([{ at: 0, value: 0.9 }]) }), clip(3, 1, { stepLanes: lane([{ at: 0, value: 0.3 }]) })], 1, null);
  assert.equal(out.stepLanes.length, 1);
  assert.deepEqual(out.stepLanes[0].steps, [{ at: 1, value: 0.9 }, { at: 2, value: 0.3 }]);
  assert.deepEqual(out.notes.map((n) => n.startOffset), [1, 2]);
});

test("controller lanes keep their values where each piece plays, and rest where none does", () => {
  const out = mergePieces([clip(2, 1, { expression: { bend: [{ at: 0, value: 1 }, { at: 0.5, value: 2 }] } }), clip(3, 1)], 1, null);
  const bend = out.expression.bend;
  assert.deepEqual(bend.filter((p) => p.at >= 1 && p.at <= 2), [{ at: 1, value: 1 }, { at: 1.5, value: 2 }, { at: 2, value: 2 }, { at: 2, value: 0 }]);
  assert.equal(bend.at(-1).value, 0);
});

test("pieces that can't be one clip as they sound say so", () => {
  // A lane on one piece, notes without it on the next: the setting went back to the track's own there
  assert.equal(typeof mergePieces([clip(1, 1, { stepLanes: lane([{ at: 0, value: 0.9 }]) }), clip(2, 1)], 1, null), 'string');
  // Different feels
  assert.equal(typeof mergePieces([clip(1, 1, { groove: { swing: 0.3, grid: 16 } }), clip(2, 1)], 1, null), 'string');
  // A lane off its grid once moved
  assert.equal(typeof mergePieces([clip(1.01, 1, { stepLanes: lane([{ at: 0, value: 0.9 }]) })], 1, null), 'string');
  // Plain pieces are fine
  assert.equal(typeof mergePieces([clip(1, 1), clip(3, 1)], 1, null), 'object');
});

test('a linked copy shares its notes, so the store keeps it linked; an unlinked one gets its own', () => {
  const orig = clip(1, 4);
  const copy = sectionCopy(orig, 4, 'copy', 'p1', () => 'new');
  assert.equal(copy.notes, orig.notes);
  assert.equal(copy.startBar, 5);
  assert.equal(syncPatterns([orig], [{ ...orig, pattern: 'p1' }, copy]), null);
  const own = sectionCopy({ ...orig, pattern: 'p0' }, 4, 'copy', undefined, () => 'new');
  assert.equal(own.pattern, undefined);
  assert.equal(own.notes[0].id, 'new');
});

test("an edit's undo steps fold into its first", () => {
  assert.deepEqual(foldSteps(['a'], ['a', 'b', 'c']), ['a', 'b']);
  assert.deepEqual(foldSteps([], ['b', 'c', 'd']), ['b']);
  assert.equal(foldSteps(['a'], ['a', 'b']), null);
  // A capped history (the oldest dropped as the edit pushed)
  assert.deepEqual(foldSteps(['a', 'b', 'c'], ['b', 'c', 'x', 'y']), ['b', 'c', 'x']);
});
