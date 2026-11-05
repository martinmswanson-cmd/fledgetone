// A click that wobbles a little on a tempo or time signature flag, or on a Pro EQ band, makes no
// undo step and keeps Redo; a real drag is one undo step. Fit to length that leaves every tempo as
// it was makes no undo step either. Run with `npm test`.
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
const { tempoChangeMoveTo, meterChangeMoveTo, scaledTempos } = await import('../src/store/tempoMoves.ts');
const { TOTAL_BARS } = await import('../src/store/timelineTypes.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('a tempo change moved to its own bar, or onto another change, stays put', () => {
  const pts = [{ id: 'a', bar: 3, bpm: 140 }, { id: 'b', bar: 5, bpm: 100 }];
  assert.equal(tempoChangeMoveTo(pts, 'a', 3), 3);
  assert.equal(tempoChangeMoveTo(pts, 'a', 5), 3);
  assert.equal(tempoChangeMoveTo(pts, 'a', 4.25), 4.25);
  // Not onto bar 1, not past the song's end
  assert.equal(tempoChangeMoveTo(pts, 'a', 0), 1 + 1 / 16);
  assert.equal(tempoChangeMoveTo(pts, 'b', TOTAL_BARS + 9), TOTAL_BARS);
});

test('a time signature change goes to the nearest measure start, only between its neighbours', () => {
  const meter = { num: 4, den: 4 };
  const pts = [{ id: 'm', bar: 5, num: 3, den: 4 }, { id: 'n', bar: 11, num: 4, den: 4 }];
  // A wobble rounds back to where it is
  assert.equal(meterChangeMoveTo(meter, pts, 'm', 5.1), 5);
  assert.equal(meterChangeMoveTo(meter, pts, 'm', 4.9), 5);
  assert.equal(meterChangeMoveTo(meter, pts, 'm', 7.2), 7);
  // Past a neighbour (or onto bar 1) it stays put
  assert.equal(meterChangeMoveTo(meter, pts, 'm', 12), 5);
  assert.equal(meterChangeMoveTo(meter, pts, 'm', 1), 5);
  // The later one moves in 3/4 measures from bar 5
  assert.equal(meterChangeMoveTo(meter, pts, 'n', 8.1), 8);
  assert.equal(meterChangeMoveTo(meter, pts, 'n', 8.5), 8.75);
});

test('scaling every tempo by 1, or too little to move one a hundredth, changes nothing', () => {
  const pts = [{ id: 'a', bar: 3, bpm: 140 }];
  assert.equal(scaledTempos(122, pts, 1), null);
  assert.equal(scaledTempos(122, pts, 1 + 1e-6), null);
  assert.equal(scaledTempos(122, [], 1), null);
  assert.deepEqual(scaledTempos(122, pts, 1.5), { bpm: 183, tempoPoints: [{ id: 'a', bar: 3, bpm: 210 }] });
  assert.equal(typeof scaledTempos(122, pts, 2), 'string');
  // The store's action takes no undo step for no change; Fit to length closes for the same tempo
  const store = src('src/store/timelineStore.ts');
  const scale = store.slice(store.indexOf('    scaleTempo: (factor) => {'), store.indexOf('    addTempoChange:'));
  assert.match(scale, /if \(!scaled\) return null;[\s\S]*pushPast/);
  assert.match(src('src/components/TempoControls.tsx'), /if \(newBpm === bpm\) return onClose\(\);\s*if \(mapped\)/);
});

test('flag and Pro EQ drags take their undo step with the first change, not the first move', () => {
  const row = src('src/components/timeline/TempoRow.tsx');
  const drag = row.slice(row.indexOf('const startDrag'), row.indexOf('const onUp'));
  assert.ok(drag.indexOf('Math.abs(to - now) < 1e-9) return;') > 0);
  assert.ok(drag.indexOf('Math.abs(to - now) < 1e-9) return;') < drag.indexOf('s.checkpoint()'));
  const peq = src('src/components/inspector/PeqEditor.tsx');
  const move = peq.slice(peq.indexOf('const drag = '), peq.indexOf('const up = '));
  assert.ok(move.indexOf('was.gain === patch.gain))) return;') > 0);
  assert.ok(move.indexOf('was.gain === patch.gain))) return;') < move.indexOf('checkpoint()'));
});
