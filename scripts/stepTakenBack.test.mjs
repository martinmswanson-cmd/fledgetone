// An arranging step that fails part way (a tempo change pushed past the end by Beat switch, Song
// form or a Pocket section) or finds it has nothing to do (a Stop or Drop out where nothing plays,
// a tag already there) puts the song back exactly as it was, the undo and redo histories included:
// an Undo of its checkpoint would have lost the oldest step of a full history. A Stop leaves the
// clips it doesn't cut as they were, so their linked copies stay linked, and a linked clip it does
// cut leaves its pattern. Undo and Redo never unlink. Run with `npm test`.
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
const { cutClipGap } = await import('../src/store/beatSwitch.ts');
const { syncPatterns } = await import('../src/store/patterns.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const clip = (id, startBar, notes, pattern) => ({ id, trackId: 't', name: 'A', startBar, lengthBars: 4, notes, isSelected: false, ...(pattern ? { pattern } : {}) });

test('a clip with nothing in the gap is the very clip it was, and its linked copies stay linked', () => {
  const notes = [{ id: 'a', note: 'C3', startOffset: 0, duration: '4n', velocity: 0.5 }];
  const a = clip('a', 1, notes, 'p');
  const b = clip('b', 5, notes, 'p');
  // A stop over bar 2's last beat: nothing of either clip plays there
  const cutA = cutClipGap(a, 2.75, 3);
  const cutB = cutClipGap(b, 2.75, 3);
  assert.equal(cutA, a);
  assert.equal(cutB, b);
  assert.equal(syncPatterns([a, b], [cutA, cutB]), null);
});

test('a linked clip that is cut leaves its pattern; its copies keep playing what they did', () => {
  const notes = [
    { id: 'a', note: 'C3', startOffset: 0, duration: '4n', velocity: 0.5 },
    { id: 'b', note: 'G3', startOffset: 1.8, duration: '8n', velocity: 0.5 },
  ];
  const a = clip('a', 1, notes, 'p');
  const b = clip('b', 5, notes, 'p');
  const cutA = cutClipGap(a, 2.75, 3);
  assert.notEqual(cutA, a);
  assert.equal(cutA.pattern, undefined);
  assert.deepEqual(cutA.notes.map((n) => n.id), ['a']);
  // ...and nothing follows it: the copy at bar 5 still plays both notes
  const synced = syncPatterns([a, b], [cutA, b]);
  assert.equal(synced, null);
  // An unlinked clip that is cut stays unlinked, its frame as it was
  const plain = clip('c', 1, notes);
  const cutPlain = cutClipGap(plain, 2.75, 3);
  assert.equal(cutPlain.startBar, 1);
  assert.equal(cutPlain.lengthBars, 4);
  assert.equal(cutPlain.notes.length, 1);
});

test('Undo and Redo put the linked clips back as they were: nothing follows, nothing leaves', () => {
  const store = src('src/store/timelineStore.ts');
  const wrapper = store.slice(store.indexOf('function withLinkedClips'), store.indexOf('export const useTimelineStore'));
  assert.match(wrapper, /puttingBack \? null : syncPatterns\(s\.clips, next\.clips\)/);
});

test('a step that fails or does nothing is put back exactly, not undone', () => {
  const store = src('src/store/timelineStore.ts');
  const or = store.slice(store.indexOf('export function oneUndoStepOr'), store.indexOf('function putBack('));
  // (the state from before, past and future included, and the field taken hold of)
  assert.match(or, /const before = useTimelineStore\.getState\(\);/);
  assert.match(or, /if \(made\.done && !keep\(made\.value\)\) putBack\(before, checkpointBefore\);/);
  for (const path of ['src/store/arrangeActions.ts', 'src/pocket/pocketSections.ts']) {
    const text = src(path);
    assert.doesNotMatch(text, /tl\(\)\.undo\(\)/, path);
    assert.doesNotMatch(text, /futureBefore/, path);
  }
  const arrange = src('src/store/arrangeActions.ts');
  // Beat switch and Song form: their insert of time refused
  assert.equal((arrange.match(/\}, \(\) => !error\);/g) ?? []).length, 2);
  // Stop and Drop out where nothing plays: no volume dip, no undo step
  assert.equal((arrange.match(/\(\) => changed > 0,/g) ?? []).length, 2);
  // A tag already there
  assert.match(arrange, /\}, \(\) => count > 0\);/);
  assert.match(src('src/pocket/pocketSections.ts'), /oneUndoStepOr\(edit, \(said\) => !said, true\)/);
});
