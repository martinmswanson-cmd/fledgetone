// An arranging action of several steps (Song form, Beat switch, Pocket's "Play it twice", Move,
// remove: oneUndoStep in timelineStore.ts) is one undo step that takes the loop and the playhead
// back with the music, however many inserts and removes of time it made, and redo moves them
// again. And an empty song's first section in Pocket is 4 measures of its time signature. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const { measureStart } = await import('../src/audio/tempoMap.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('several ripple edits move a position forward in the order made and back in the reverse order', () => {
  // A section removed from 1-5, then put back after the one that followed it (a Move): remove, then insert
  const edits = [{ kind: 'remove', from: 1, to: 5, minLoop: 0.25 }, { kind: 'insert', at: 5, bars: 4 }].map(rippleRules);
  const forward = (bar) => edits.reduce((at, r) => r.movePoint(at), bar);
  const back = (bar) => edits.reduceRight((at, r) => r.backPoint(at), bar);
  for (const bar of [9, 12, 20]) assert.equal(back(forward(bar)), bar, `bar ${bar}`);
  // Two inserts one after the other (a song form's sections)
  const two = [{ kind: 'insert', at: 5, bars: 4 }, { kind: 'insert', at: 13, bars: 8 }].map(rippleRules);
  assert.equal(two.reduce((at, r) => r.movePoint(at), 10), 22);
  assert.equal(two.reduceRight((at, r) => r.backPoint(at), 22), 10);
});

test('the arranging actions fold their steps with oneUndoStep, which keeps the ripple with the step', () => {
  const store = src('src/store/timelineStore.ts');
  const fold = store.slice(store.indexOf('export function oneUndoStep'), store.indexOf('function putBack('));
  assert.match(fold, /e\.ripple\?\.edits/);
  assert.match(fold, /ripple: \{ before, after: spotOf\(end\), edits \}/);
  assert.match(store, /edits: \[edit\],/);
  assert.match(store, /const made = allOrNothing\(\(\) => oneUndoStep\(make\), quiet\);/);
  for (const path of ['src/store/arrangeActions.ts', 'src/pocket/pocketSections.ts']) {
    const text = src(path);
    assert.match(text, /allOrNothing\(\(\) => oneUndoStep\(edit\)|oneUndoStepOr\(edit, /, path);
    // (putting back the past from before the edit dropped what its inserts moved)
    assert.doesNotMatch(text, /const past = tl\(\)\.past;/, path);
  }
});

test("an empty song's first section in Pocket is 4 measures (4 bars in 4/4)", () => {
  const meter = (num, den) => ({ base: { num, den }, points: [] });
  assert.equal(measureStart(5, meter(4, 4)), 5);
  assert.equal(measureStart(5, meter(3, 4)), 4);
  assert.equal(measureStart(5, meter(6, 8)), 4);
  assert.match(src('src/pocket/pocketSections.ts'), /to: measureStart\(1 \+ FIRST_SECTION_BARS, meter\)/);
});
