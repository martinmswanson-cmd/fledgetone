// Unit tests for game stingers (src/store/stingers.ts). Run with `npm test`.
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

const { STINGER_KINDS, STINGER_VARIATIONS, stingerNotes, fitNotesToRange, createStinger, parseStingers } = await import('../src/store/stingers.ts');
const { keyOf } = await import('../src/store/songKey.ts');
const { midiOf } = await import('../src/store/noteTools.ts');

const pc = (n) => ((midiOf(n) % 12) + 12) % 12;

test('every stinger kind and variation is in key, inside its length, and not empty', () => {
  for (const key of [keyOf(0, 'major'), keyOf(9, 'minor'), keyOf(6, 'major')]) {
    for (const { kind } of STINGER_KINDS) {
      for (let v = 0; v < STINGER_VARIATIONS; v++) {
        const { notes, lengthBars } = stingerNotes(kind, key, v);
        assert.ok(notes.length >= 2, `${kind} ${v}`);
        for (const n of notes) {
          assert.ok(n.startOffset >= 0 && n.startOffset < lengthBars, `${kind} ${v} ${n.startOffset} < ${lengthBars}`);
          assert.ok(Number.isFinite(midiOf(n.note)), n.note);
        }
        if (kind !== 'danger' && kind !== 'gameOver') {
          const steps = new Set(key.steps.map((s) => (s + key.root) % 12));
          for (const n of notes) assert.ok(steps.has(pc(n.note)), `${kind} ${v} ${n.note} in ${key.name}`);
        }
      }
    }
  }
});

test('game over lands on the minor tonic chord', () => {
  const { notes } = stingerNotes('gameOver', keyOf(0, 'major'), 0);
  const last = Math.max(...notes.map((n) => n.startOffset));
  const chord = new Set(notes.filter((n) => n.startOffset === last).map((n) => pc(n.note)));
  assert.deepEqual([...chord].sort((a, b) => a - b), [0, 3, 7]);
});

test('notes move by octaves into an instrument range', () => {
  const notes = [{ id: 'a', note: 'C3', startOffset: 0, duration: '4n', velocity: 1 }, { id: 'b', note: 'G3', startOffset: 0, duration: '4n', velocity: 1 }];
  assert.deepEqual(fitNotesToRange(notes, [60, 84]).map((n) => n.note), ['C4', 'G4']);
  assert.deepEqual(fitNotesToRange(notes, [36, 84]).map((n) => n.note), ['C3', 'G3']);
});

test('stingers are named, numbered and survive a save', () => {
  const a = createStinger('victory', keyOf(2, 'major'), []);
  const b = createStinger('victory', keyOf(2, 'major'), [a]);
  assert.equal(a.name, 'Victory');
  assert.equal(b.name, 'Victory 2');
  const parsed = parseStingers(JSON.parse(JSON.stringify([a, { id: 'x', kind: 'nope' }, b])), (k) => typeof k === 'string');
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], a);
});
