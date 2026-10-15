// Unit tests for the score helpers (src/store/scoreNotes.ts) and the Classics starters' scores
// (src/store/classicsScores.ts): packing round trips, the hand-written notation and its bar checks,
// the pedal and dynamics helpers, and checks on the notes themselves: each piece's length, its
// opening bars as printed, its key (the pitch classes it spends its time on), and the Canon's
// three voices sounding in harmony with the ground bass. Run with `npm test`.
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
const S = await import('../src/store/scoreNotes.ts');
const { canonLine, scorePart } = await import('../src/store/classicsScores.ts');

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const name = (p) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
const end = (notes) => Math.max(...notes.map((n) => n.start + n.dur));
const firstNames = (notes, count) => [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch).slice(0, count).map((n) => name(n.pitch));

test('a packed score unpacks to the same notes', () => {
  const notes = [
    { pitch: 60, start: 0, dur: 1, vel: 0.6 },
    { pitch: 64, start: 0, dur: 1, vel: 0.6 },
    { pitch: 67, start: 1 / 3, dur: 1 / 3, vel: 0.8 },
    { pitch: 72, start: 4.125, dur: 0.0625, vel: 0.2 },
  ];
  const back = S.unpackScore(S.packScore(notes, true));
  assert.equal(back.length, 4);
  for (const [i, n] of notes.entries()) {
    assert.equal(back[i].pitch, n.pitch);
    assert.ok(Math.abs(back[i].start - n.start) < 1e-9 && Math.abs(back[i].dur - n.dur) < 1e-9);
    assert.ok(Math.abs(back[i].vel - n.vel) < 0.02);
  }
  // Without velocities none come back
  assert.equal(S.unpackScore(S.packScore(notes))[0].vel, undefined);
});

test('the hand-written notation: lengths, chords, rests, ties and bar checks', () => {
  const n = S.parseLine('F#5:1 r:1 D4+F#4:2 | A4:1/2 B#3:1/2 C#4:3/4 C4:1/4 E4:2~ | E4:1 r:3 |');
  assert.deepEqual(n.map((x) => [name(x.pitch), x.start, x.dur]), [['F#5', 0, 1], ['D4', 2, 2], ['F#4', 2, 2], ['A4', 4, 0.5], ['C4', 4.5, 0.5], ['C#4', 5, 0.75], ['C4', 5.75, 0.25], ['E4', 6, 3]]);
  assert.throws(() => S.parseLine('A4:1 B4:1 | C5:4 |'), /Bar 1 lasts 2/);
  assert.throws(() => S.parseLine('H4:1'), /Not a note/);
  assert.equal(S.pitchOf('F##4'), S.pitchOf('G4'));
});

test('curves, slices and pedal changes', () => {
  assert.equal(S.curveAt([[0, 0], [4, 1]], 2), 0.5);
  assert.equal(S.curveAt([[0, 0], [4, 1]], 9), 1);
  assert.deepEqual(S.notesBetween([{ pitch: 60, start: 1, dur: 4 }, { pitch: 62, start: 5, dur: 1 }], 0, 4), [{ pitch: 60, start: 1, dur: 3 }]);
  // A rolling left hand: one change per bass note, not one per note of the arpeggio
  const bass = [36, 43, 48, 52, 48, 43].map((p, i) => ({ pitch: p, start: i * 0.5, dur: 0.5 })).concat([41, 48, 53, 57].map((p, i) => ({ pitch: p, start: 4 + i * 0.5, dur: 0.5 })));
  assert.deepEqual(S.bassChanges(bass, 1, 4), [0, 4]);
  assert.deepEqual(S.pedalPoints([0, 4], 8, 0.125), [[0, 0], [0.125, 1], [4, 0], [4.125, 1], [8, 0]]);
});

test('every piece is complete, from its first bar to its last', () => {
  // Canon: 54 bars of the line; Moonlight 69 bars; Prelude 42; Mountain King 88; Clair de lune 72 bars of 9/8
  assert.equal(end(canonLine(0)), 54 * 4);
  assert.equal(end([...scorePart('moonTriplets'), ...scorePart('moonBass'), ...scorePart('moonMelody')]), 69 * 4);
  assert.equal(end(scorePart('preludeCello')), 42 * 4);
  assert.ok(Math.abs(end(scorePart('kingRight').concat(scorePart('kingLeft'))) - 87.5 * 4) < 0.6, `${end(scorePart('kingLeft'))}`);
  assert.ok(Math.abs(end(scorePart('clairUpper').concat(scorePart('clairLower'))) - 72 * 4.5) < 2, `${end(scorePart('clairUpper'))}`);
});

test('the opening bars are as printed', () => {
  assert.deepEqual(firstNames(canonLine(0), 8), ['F#5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'B4', 'C#5']);
  assert.deepEqual(firstNames(scorePart('preludeCello'), 8), ['G2', 'D3', 'B3', 'A3', 'B3', 'D3', 'B3', 'D3']);
  assert.deepEqual(firstNames(scorePart('moonTriplets'), 6), ['G#3', 'C#4', 'E4', 'G#3', 'C#4', 'E4']);
  assert.deepEqual(firstNames(scorePart('moonBass'), 2), ['C#2', 'C#3']);
  // Moonlight's tune enters on the fourth beat of bar 5, G sharp in a dotted rhythm
  const tune = scorePart('moonMelody');
  assert.deepEqual([name(tune[0].pitch), tune[0].start, tune[0].dur, tune[1].dur], ['G#4', 19, 0.75, 0.25]);
  // The Mountain King's theme in B minor: B C# D E F# D F#
  assert.deepEqual(firstNames(scorePart('kingRight').filter((n) => n.start >= 4), 7), ['B1', 'C#2', 'D2', 'E2', 'F#2', 'D2', 'F#2']);
  // Clair de lune: Db major, the right hand's first third F-Ab, then Db-F, C-Eb, Db-F
  assert.deepEqual(firstNames(scorePart('clairUpper'), 8), ['F5', 'G#5', 'C#5', 'F5', 'C5', 'D#5', 'C#5', 'F5']);
});

/** The share of a part's sounding time spent on each scale's notes. */
function inScale(notes, root, steps) {
  const set = new Set(steps.map((s) => (root + s) % 12));
  const total = notes.reduce((a, n) => a + n.dur, 0);
  return notes.filter((n) => set.has(n.pitch % 12)).reduce((a, n) => a + n.dur, 0) / total;
}
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];

test('each piece stays in its key', () => {
  assert.ok(inScale(canonLine(0), 2, MAJOR) > 0.97, 'Canon in D major');
  assert.ok(inScale(scorePart('preludeCello'), 7, MAJOR) > 0.9, 'Prelude in G major');
  const moon = [...scorePart('moonTriplets'), ...scorePart('moonBass'), ...scorePart('moonMelody')];
  assert.ok(inScale(moon, 1, HARMONIC_MINOR) > 0.8, 'Moonlight in C sharp minor');
  assert.ok(inScale([...scorePart('kingRight'), ...scorePart('kingLeft')], 11, HARMONIC_MINOR) > 0.75, 'Mountain King in B minor');
  assert.ok(inScale([...scorePart('clairUpper'), ...scorePart('clairLower')], 1, MAJOR) > 0.75, 'Clair de lune in D flat major');
});

test("the Canon's three voices agree with the ground bass on every beat but its suspensions and appoggiaturas", () => {
  const ground = [50, 45, 47, 42, 43, 38, 43, 45];
  const line = canonLine(8);
  const voices = [line, S.shiftNotes(line, 8), S.shiftNotes(line, 16)].map((v) => v.filter((n) => n.start < 224));
  const at = (v, t) => v.find((n) => n.start <= t + 1e-9 && n.start + n.dur > t + 1e-9);
  const clashes = [];
  for (let t = 8; t < 224; t++) {
    for (const v of voices) {
      const n = at(v, t);
      if (!n) continue;
      const iv = (((n.pitch - ground[t % 8]) % 12) + 12) % 12;
      // A dissonance on a beat is only allowed held over from before it (a suspension)
      if ([1, 2, 5, 6, 10, 11].includes(iv) && n.start > t - 1e-9) clashes.push(`${t}: ${name(n.pitch)}`);
    }
  }
  // The two written-out appoggiaturas, D over A on the last beat of bars 10 and 40 (the D-C# that
  // a trill decorates in some editions), in each voice
  assert.deepEqual(clashes, ['39: D5', '47: D5', '55: D5', '159: D4', '167: D4', '175: D4']);
});
