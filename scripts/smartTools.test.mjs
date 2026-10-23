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

test('the syncopated drop: kicks 1 to 3 16ths apart, about six a bar, snare on two and four, 16th hats with accents and rolls', () => {
  const part = S.drummer('syncDrop', 8, 0.85, 0, 5, newId);
  const kicks = part.filter((x) => x.note === 'C1').map((x) => x.startOffset * 16);
  const perBar = kicks.length / 8;
  assert.ok(perBar >= 5.5 && perBar <= 8, `${perBar} kicks a bar`);
  const gaps = kicks.slice(1).map((k, i) => Math.round(k - kicks[i]));
  const short = gaps.filter((g) => g >= 1 && g <= 3).length / gaps.length;
  assert.ok(short >= 0.85, `${(short * 100).toFixed(0)}% of kick gaps are 1-3 16ths`);
  // Not four on the floor: kicks off the beat
  assert.ok(kicks.filter((k) => k % 4 !== 0).length > kicks.length / 2);
  for (let b = 0; b < 8; b++) {
    const sn = part.filter((x) => x.note === 'D1' && x.startOffset >= b && x.startOffset < b + 1 && x.velocity > 0.8).map((x) => Math.round((x.startOffset - b) * 16));
    assert.deepEqual(sn, [4, 12], `bar ${b}`);
    // Every 16th has a hat
    const hats = new Set(part.filter((x) => x.note === 'F#1' && x.startOffset >= b && x.startOffset < b + 1).map((x) => x.startOffset * 16));
    for (let st = 0; st < 16; st++) assert.ok(hats.has(b * 16 + st), `bar ${b} step ${st}`);
  }
  // Rolls: hats off the 16th grid (32nds or triplets), on the grid's own ticks
  const off = part.filter((x) => x.note === 'F#1' && Math.abs(x.startOffset * 16 - Math.round(x.startOffset * 16)) > 1e-6);
  assert.ok(off.length >= 4, `${off.length} roll hits`);
  off.forEach((x) => assert.ok(Math.abs(x.startOffset * 768 - Math.round(x.startOffset * 768)) < 1e-6));
  // The hats lean on the beat and the 16th after it
  const vel = [0, 1, 2, 3].map((p) => {
    const v = part.filter((x) => x.note === 'F#1' && Number.isInteger(Math.round(x.startOffset * 16 * 1e6) / 1e6) && Math.round(x.startOffset * 16) % 4 === p).map((x) => x.velocity);
    return v.reduce((a, b) => a + b, 0) / v.length;
  });
  assert.ok(vel[0] > vel[2] && vel[1] > vel[2] && vel[1] > vel[3], vel.join(' '));
});

test('the syncopated drop in 3/4, 6/8, 7/8 and 5/4: every hit and roll inside its measure, two snares a measure, the ghost snare plays; 4/4 as before', () => {
  for (const [num, den] of [[3, 4], [6, 8], [7, 8], [5, 4]]) {
    const measure = num / den;
    const steps = Math.round(measure * 16);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const part = S.drummer('syncDrop', 4, 0.85, 0, seed, newId, { num, den });
      const end = 4 * measure;
      for (const x of part) assert.ok(x.startOffset >= 0 && x.startOffset < end - 1e-9, `${num}/${den} seed ${seed}: ${x.note} at ${x.startOffset} past the clip (${end})`);
      for (let b = 0; b < 4; b++) {
        const inBar = part.filter((x) => x.startOffset >= b * measure - 1e-9 && x.startOffset < (b + 1) * measure - 1e-9);
        // Nothing from this measure spills into the next: the hats at the end of each measure are this measure's own
        const hats = inBar.filter((x) => x.note === 'F#1').map((x) => (x.startOffset - b * measure) * 16);
        assert.ok(hats.every((h) => h < steps), `${num}/${den} bar ${b}`);
        const backbeat = inBar.filter((x) => x.note === 'D1' && x.velocity > 0.8);
        assert.equal(backbeat.length, 2, `${num}/${den} bar ${b}: ${backbeat.length} snares`);
        if (b % 2 === 1 && seed === 1) assert.ok(inBar.some((x) => x.note === 'D1' && x.velocity < 0.6 && Math.round((x.startOffset - b * measure) * 16) === steps - 1), `${num}/${den}: the ghost snare`);
      }
    }
  }
  // 4/4 unchanged: the rolls at 14.5 and 15.5, or the triplets from 12
  const four = S.drummer('syncDrop', 8, 0.85, 0, 5, newId);
  const offGrid = four.filter((x) => x.note === 'F#1' && Math.abs(x.startOffset * 16 - Math.round(x.startOffset * 16)) > 1e-6).map((x) => ((x.startOffset * 16) % 16).toFixed(3));
  for (const at of offGrid) assert.ok(['14.500', '15.500', '12.667', '13.333', '14.667', '15.333'].includes(at), at);
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
