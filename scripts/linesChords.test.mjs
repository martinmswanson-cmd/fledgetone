// Lines video (src/store/linesChords.ts): the chord named at each moment, only where the notes make it clear.
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

const { lineChords } = await import('../src/store/linesChords.ts');

const n = (start, end, midi, extra = {}) => ({ start, end, midi, color: '#fff', track: 0, drum: false, ...extra });
const chord = (start, end, midis) => midis.map((m) => n(start, end, m));
const data = (notes, bars = [0, 2, 4], beats) => ({ notes: [...notes].sort((x, y) => x.start - y.start || x.midi - y.midi), tracks: [{ name: 'a', color: '#fff' }], bars, ...(beats ? { beats } : {}), low: 0, high: 0, drumRows: [] });
const C = { root: 0, mode: 'major' };

test('a chord a bar, named and joined across its two halves', () => {
  const spans = lineChords(data([...chord(0, 2, [48, 52, 55]), ...chord(2, 4, [45, 48, 52])]), C);
  assert.deepEqual(spans, [{ at: 0, end: 2, name: 'C' }, { at: 2, end: 4, name: 'Am' }]);
});

test('a seventh is named, further extensions are dropped', () => {
  assert.equal(lineChords(data(chord(0, 2, [48, 52, 55, 58])), C)[0].name, 'C7');
  assert.equal(lineChords(data(chord(0, 2, [48, 52, 55, 58, 62, 69])), C)[0].name, 'C7');
  assert.equal(lineChords(data(chord(0, 2, [48, 52, 55, 59])), C)[0].name, 'Cmaj7');
  assert.equal(lineChords(data(chord(0, 2, [45, 48, 52, 55])), C)[0].name, 'Am7');
  // A major third under a raised fifth: the plain chord
  assert.equal(lineChords(data(chord(0, 2, [45, 49, 53])), C)[0].name, 'A');
});

test('no third, no name', () => {
  assert.deepEqual(lineChords(data(chord(0, 2, [48, 55])), C), []);
  assert.deepEqual(lineChords(data(chord(0, 2, [48, 53, 55])), C), []);
  assert.deepEqual(lineChords(data([n(0, 2, 60)]), C), []);
  assert.deepEqual(lineChords(data([]), C), []);
});

test('a passing note does not change the name; drums and unpitched instruments are ignored', () => {
  const notes = [...chord(0, 2, [48, 52, 55]), n(0.5, 0.6, 61), n(0, 2, 49, { drum: true }), n(0, 2, 54, { perc: true })];
  assert.deepEqual(lineChords(data(notes), C), [{ at: 0, end: 2, name: 'C' }]);
});

test('a change mid-measure is caught; a measure of an odd number of beats is one window', () => {
  const notes = [...chord(0, 1, [48, 52, 55]), ...chord(1, 2, [43, 47, 50])];
  assert.deepEqual(lineChords(data(notes, [0, 2]), C).map((s) => [s.at, s.name]), [[0, 'C'], [1, 'G']]);
  assert.equal(lineChords(data(chord(0, 2, [48, 52, 55]), [0, 2], [3]), C).length, 1);
});

test('roots are spelled as the key writes them', () => {
  assert.equal(lineChords(data(chord(0, 2, [46, 50, 53])), { root: 5, mode: 'major' })[0].name, 'B♭');
});
