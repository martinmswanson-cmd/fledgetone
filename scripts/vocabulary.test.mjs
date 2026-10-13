// Unit tests for the game-music vocabulary: scales, borrowed-chord progressions, 8th swing, drum styles. Run with `npm test`.
// Run with `npm test`.
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
const { SCALES, inScale, chordNotes } = await import('../src/store/noteTools.ts');
const { swingDelay, swungNotes } = await import('../src/audio/transport.ts');

let n = 0;
const newId = () => `n${n++}`;
const C = keyOf(0, 'major');
const Am = keyOf(9, 'minor');
const prog = (id) => S.PROGRESSIONS.find((p) => p.id === id);
const names = (key, id) => S.progressionChords(key, prog(id)).map(S.chordName);

test('the new scales hold the right notes', () => {
  // E Phrygian dominant: E F G# A B C D (the 5th mode of A harmonic minor)
  const e = { root: 4, id: 'phrygianDominant' };
  assert.deepEqual([64, 65, 68, 69, 71, 72, 74].map((m) => inScale(m, e)), Array(7).fill(true));
  assert.equal(inScale(67, e), false);
  assert.equal(SCALES.wholeTone.steps.length, 6);
  assert.equal(SCALES.octatonicHW.steps.length, 8);
  assert.equal(SCALES.chromatic.steps.length, 12);
  for (const [id, sc] of Object.entries(SCALES)) {
    assert.equal(new Set(sc.steps).size, sc.steps.length, id);
    assert.ok(sc.steps.every((x) => x >= 0 && x < 12) && sc.steps[0] === 0, id);
  }
  // "In key" chords on the chromatic scale stack semitones: a cluster
  assert.deepEqual(chordNotes(60, 'diatonic', { root: 0, id: 'chromatic' }), [60, 62, 64]);
});

test('borrowed and chromatic progressions spell the right chords', () => {
  assert.deepEqual(names(C, 'levelClear'), ['G#', 'A#', 'C', 'C']);
  assert.deepEqual(names(C, 'openField'), ['C', 'A#', 'F', 'C']);
  assert.deepEqual(names(C, 'ache'), ['C', 'F', 'Fm', 'C']);
  assert.deepEqual(names(C, 'lydian'), ['C', 'D', 'C', 'D']);
  assert.deepEqual(names(C, 'calmVamp'), ['Cmaj7', 'Fmaj7', 'Cmaj7', 'Fmaj7']);
  assert.deepEqual(names(Am, 'menace'), ['Am', 'A#', 'Am', 'A#']);
  assert.deepEqual(names(Am, 'tragic'), ['Am', 'Fm', 'Am', 'Fm']);
  assert.deepEqual(names(Am, 'cliche'), ['Am', 'Am(maj7)', 'Am7', 'Am6']);
  assert.deepEqual(names(Am, 'triumph'), ['Am', 'F', 'G', 'A']);
  assert.deepEqual(names(Am, 'dread'), ['G#dim7', 'E7', 'G#dim7', 'E7']);
  // With 7ths on, a borrowed ♭VII leans like a dominant
  assert.deepEqual(S.progressionChords(C, prog('levelClear'), true).map(S.chordName), ['G#maj7', 'A#7', 'Cmaj7', 'Cmaj7']);
  // Every progression has four chords and a unique id
  assert.equal(new Set(S.PROGRESSIONS.map((p) => p.id)).size, S.PROGRESSIONS.length);
  for (const p of S.PROGRESSIONS) assert.equal(p.chords.length, 4, p.id);
});

test('8th swing: off-beat 8ths play late, a full shuffle on the triplet', () => {
  const beat = 60 / 120;
  // At 0.5 an off-beat 8th lands on the last triplet 8th: 1/6 of a beat late
  assert.ok(Math.abs(swingDelay(0.5, 120, 192, 8) - beat / 6) < 1e-12);
  // 16th swing is unchanged
  assert.ok(Math.abs(swingDelay(0.5, 120, 192, 16) - beat / 12) < 1e-12);
  const eighths = [0, 96, 192, 288];
  assert.deepEqual(swungNotes(eighths, 0, 192, 8), [false, true, false, true]);
  // A beat with 16ths in it plays straight (its off-beat 8th too)
  assert.deepEqual(swungNotes([0, 48, 96, 144, 192, 288], 0, 192, 8), [false, false, false, false, false, true]);
});

test('drum styles follow their time signature', () => {
  const waltz = S.drummer('waltz', 4, 0.5, 0, 1, newId, { num: 3, den: 4 });
  assert.ok(waltz.every((x) => x.startOffset < 3 - 1e-9), 'four measures of 3/4 are 3 bars long');
  const kicks = waltz.filter((x) => x.note === 'C1').map((x) => x.startOffset);
  assert.deepEqual(kicks, [0, 0.75, 1.5, 2.25]);
  const jig = S.drummer('jig', 2, 0.5, 0, 1, newId, { num: 6, den: 8 });
  const accents = jig.filter((x) => x.note === 'F1' && x.velocity > 0.7).map((x) => x.startOffset);
  // The beat of 6/8 is a dotted quarter: accents every 3/8 of a bar
  assert.deepEqual(accents, [0, 0.375, 0.75, 1.125]);
  // A fill at the end of a 3/4 measure stays inside it
  const filled = S.drummer('waltz', 4, 0.8, 2, 2, newId, { num: 3, den: 4 });
  assert.ok(filled.length > 0);
  for (const style of S.DRUM_STYLES) {
    const part = S.drummer(style.id, 4, 0.8, 4, 3, newId, style.meter);
    assert.ok(part.length > 0, style.id);
    const len = 4 * (style.meter ? style.meter.num / style.meter.den : 1);
    assert.ok(part.every((x) => x.startOffset >= 0 && x.startOffset < len - 1e-9), style.id);
  }
  // The heartbeat has no crash and no fills
  assert.ok(!S.drummer('heartbeat', 8, 0.5, 4, 1, newId).some((x) => x.note === 'C#2'));
});
