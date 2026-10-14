// Unit tests for the writing helpers (src/store/smartTools.ts). Run with `npm test`.
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
const S = await import('../src/store/smartTools.ts');
const { keyOf } = await import('../src/store/songKey.ts');
const { midiOf } = await import('../src/store/noteTools.ts');

let n = 0;
const newId = () => `n${n++}`;
const C = keyOf(0, 'major');
const Am = keyOf(9, 'minor');
const names = (chords) => chords.map(S.chordName);

test('chords of a key, and their names', () => {
  assert.deepEqual(names([0, 1, 2, 3, 4, 5, 6].map((d) => S.degreeChord(C, { degree: d }))), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
  assert.deepEqual(names([S.degreeChord(Am, { degree: 4 }), S.degreeChord(Am, { degree: 4, major: true })]), ['Em', 'E']);
  assert.deepEqual(names([S.degreeChord(C, { degree: 4 }, true), S.degreeChord(C, { degree: 0 }, true), S.degreeChord(C, { degree: 1 }, true)]), ['G7', 'Cmaj7', 'Dm7']);
  const pop = S.PROGRESSIONS.find((p) => p.id === 'pop');
  assert.deepEqual(names(S.progressionChords(keyOf(7, 'major'), pop)), ['G', 'D', 'Em', 'C']);
});

test('voice leading keeps chords close together', () => {
  const pop = S.progressionChords(C, S.PROGRESSIONS.find((p) => p.id === 'pop'));
  const notes = S.chordNotesFor(pop, 1, 'sustain', newId);
  const byBar = [0, 1, 2, 3].map((b) => notes.filter((x) => x.startOffset === b).map((x) => midiOf(x.note)).sort((a, b) => a - b));
  for (let i = 1; i < 4; i++) {
    const moved = byBar[i].reduce((s, m, k) => s + Math.abs(m - byBar[i - 1][k]), 0);
    assert.ok(moved <= 6, `bar ${i + 1} moves ${moved} semitones`);
  }
  for (const bar of byBar) assert.ok(bar[0] >= 50 && bar[bar.length - 1] <= 78);
});

test('harmonize finds the chords a melody spells out', () => {
  const mel = (bar, notes) => notes.map((m, i) => ({ at: bar + i / 4, bars: 0.25, midi: m }));
  const melody = [...mel(0, [60, 64, 67, 64]), ...mel(1, [65, 69, 72, 69]), ...mel(2, [67, 71, 74, 71]), ...mel(3, [72, 67, 64, 60])];
  assert.deepEqual(names(S.harmonize(melody, C, 4, 1).chords), ['C', 'F', 'G', 'C']);
  // In A minor, a G# asks for the major V
  const minor = [...mel(0, [69, 72, 76, 72]), ...mel(1, [68, 71, 76, 71]), ...mel(2, [69, 72, 76, 81])];
  assert.deepEqual(names(S.harmonize(minor, Am, 3, 1).chords), ['Am', 'E', 'Am']);
});

test('a bass line plays the chord roots, low', () => {
  const chords = S.chordNotesFor(S.progressionChords(C, S.PROGRESSIONS.find((p) => p.id === 'ballad')), 1, 'pulse', newId);
  const bass = S.bassFromChords(chords, 4, 'root', newId);
  assert.deepEqual(bass.map((x) => [x.startOffset, x.note]), [[0, 'A1'], [1, 'F2'], [2, 'C2'], [3, 'G2']]);
  assert.equal(S.chordRoot([64, 67, 72]), 0); // C/E is still C
  assert.equal(S.bassFromChords(chords, 4, 'eighths', newId).length, 32);
});

test('the drummer: the same choices give the same part; fills land at the ends of phrases', () => {
  const a = S.drummer('rock', 8, 0.5, 4, 7, newId);
  const b = S.drummer('rock', 8, 0.5, 4, 7, newId);
  assert.deepEqual(a.map((x) => [x.note, x.startOffset, x.velocity]), b.map((x) => [x.note, x.startOffset, x.velocity]));
  const snares = (from, to) => a.filter((x) => x.note === 'D1' && x.startOffset >= from && x.startOffset < to).length;
  assert.equal(snares(0, 1), 2); // the backbeat
  assert.ok(a.some((x) => x.note === 'C#2' && x.startOffset === 4)); // a crash after the first fill
  assert.ok(a.filter((x) => x.startOffset >= 3.75 && x.startOffset < 4).every((x) => x.note !== 'F#1')); // the hats make way
  for (const style of S.DRUM_STYLES) assert.ok(S.drummer(style.id, 4, 0.8, 0, 1, newId).length > 8, style.id);
});

test('a fill replaces the end of the bar, keeping kicks on the beat', () => {
  const beat = S.drummer('house', 2, 0.2, 0, 3, newId);
  const filled = S.fillBar(beat, 0, 'snare', 2, newId);
  const last = filled.filter((x) => x.startOffset >= 0.75 && x.startOffset < 1);
  assert.deepEqual(last.filter((x) => x.note === 'D1').map((x) => x.startOffset), [0.75, 0.8125, 0.875, 0.9375]);
  assert.ok(last.some((x) => x.note === 'C1' && x.startOffset === 0.75));
  assert.ok(filled.some((x) => x.note === 'C#2' && x.startOffset === 1));
  // At the clip's end there's no next downbeat for a crash
  assert.ok(!S.fillBar(beat, 1, 'toms', 2, newId).some((x) => x.startOffset >= 2));
});

test('extended and suspended chords get their names; every progression names every chord', () => {
  const name = (root, q) => S.chordName(S.CHORD_QUALITIES[q].map((i) => (root + i) % 12));
  assert.deepEqual(
    ['maj6', 'add9', 'maj9', 'dom9', 'min9', 'min11', 'sus4', 'dom7sus4', 'dom13sus4', 'halfDim7', 'min6', 'mMaj7', 'dim7'].map((q) => name(0, q)),
    ['C6', 'Cadd9', 'Cmaj9', 'C9', 'Cm9', 'Cm11', 'Csus4', 'C7sus4', 'C13sus4', 'Cm7b5', 'Cm6', 'Cm(maj7)', 'Cdim7']
  );
  // The triads and 7ths name as they always have
  assert.deepEqual(['maj', 'min', 'dim', 'aug', 'dom7', 'maj7', 'min7'].map((q) => name(7, q)), ['G', 'Gm', 'Gdim', 'G+', 'G7', 'Gmaj7', 'Gm7']);
  for (const p of S.PROGRESSIONS) {
    const key = keyOf(p.mode === 'major' ? 2 : 9, p.mode);
    const chords = S.progressionChords(key, p, true);
    assert.equal(chords.length, 4, p.id);
    for (const c of names(chords)) assert.match(c, /^[A-G]#?/, p.id);
  }
  // The city-at-night turn in D: Dmaj7 - F#m7 - Bm9 - Gmaj7
  assert.deepEqual(names(S.progressionChords(keyOf(2, 'major'), S.PROGRESSIONS.find((p) => p.id === 'cityNight'))), ['Dmaj7', 'F#m7', 'Bm9', 'Gmaj7']);
});

test('brushes: soft snare 8ths leaning on two and four, quiet throughout', () => {
  const notes = S.drummer('brushes', 4, 0.5, 0, 1, () => 'n', { num: 4, den: 4 });
  const snares = notes.filter((n) => n.note === 'D1');
  assert.ok(snares.length >= 28, 'a swirl of 8ths');
  assert.ok(notes.every((n) => n.velocity <= 0.6), 'nothing loud');
  const onTwoFour = (n) => Math.abs(((n.startOffset * 4) % 2) - 1) < 1e-6;
  const avg = (xs) => xs.reduce((a, n) => a + n.velocity, 0) / xs.length;
  assert.ok(avg(snares.filter(onTwoFour)) > avg(snares.filter((n) => !onTwoFour(n))) + 0.05, 'two and four lean');
});
