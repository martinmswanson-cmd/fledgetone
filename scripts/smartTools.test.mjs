// Unit tests for the writing helpers (src/store/smartTools.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

// ---------- Bars as the song counts them (3/4, 7/8), 4/4 as before ----------

const TM = await import('../src/audio/tempoMap.ts');
const meterMap = (num, den) => ({ base: { num, den }, points: [] });
const FOUR_MAP = meterMap(4, 4);
const THREE_MAP = meterMap(3, 4);
const SEVEN_MAP = meterMap(7, 8);
/** A short fingerprint of a tool's output, to hold 4/4 to the notes it always wrote */
const fnv = (v) => {
  const s = JSON.stringify(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16);
};
const counter = () => {
  let i = 0;
  return () => `n${i++}`;
};
const onMeasure = (map, atBar) => (x) => TM.onMeterLine(atBar + x, 'bar', map);

test('chords for a melody: one chord per measure (half a measure for a short clip) in 3/4 and 7/8', () => {
  for (const map of [THREE_MAP, SEVEN_MAP]) {
    const m = TM.measureBars(map.base);
    // Eight measures of a tune, a note on each measure's first beat
    const pitches = [60, 65, 67, 60, 69, 62, 67, 60];
    const tune = pitches.map((midi, i) => ({ at: i * m, bars: m, midi }));
    const len = 8 * m;
    const spans = S.clipChordSpans(1, len, 1, map);
    assert.equal(spans.length, 8, `${map.base.num}/${map.base.den}: a chord a measure`);
    assert.ok(spans.every((sp) => onMeasure(map, 1)(sp.start) && Math.abs(sp.length - m) < 1e-9));
    const { chords } = S.harmonize(tune, C, len, 1, spans);
    assert.equal(chords.length, 8);
    const notes = S.chordNotesFor(chords, 1, 'sustain', newId, spans);
    const starts = [...new Set(notes.map((x) => x.startOffset))];
    assert.equal(starts.length, 8);
    assert.ok(starts.every(onMeasure(map, 1)), 'every chord starts on a bar line');
    // Each measure's chord holds the note that starts it
    chords.forEach((pcs, i) => assert.ok(pcs.includes(pitches[i] % 12), `measure ${i + 1}`));
    // Two measures: a chord every half measure, the last stopping at the clip's end
    const half = S.clipChordSpans(1, 2 * m, 0.5, map);
    assert.equal(half.length, 4);
    assert.ok(Math.abs(half[1].start - m / 2) < 1e-9 && Math.abs(half[2].start - m) < 1e-9);
    // A clip part-way into its last measure: the last chord stops at the clip's end
    const cut = S.clipChordSpans(1, 2 * m + m / 2, 1, map);
    assert.equal(cut.length, 3);
    assert.ok(Math.abs(cut[2].length - m / 2) < 1e-9);
  }
});

test('chords for a melody in 4/4: the chords and notes it always made', () => {
  const tune = [[60, 0], [64, 0.5], [65, 1], [69, 1.5], [67, 2], [71, 2.5], [72, 3]].map(([midi, at]) => ({ at, bars: 0.5, midi }));
  assert.equal(fnv([S.harmonize(tune, C, 4, 1), S.harmonize(tune, C, 4, 0.5)]), '6b341a1c');
  // (with spans of a whole note each, the same chords as without)
  assert.deepEqual(S.harmonize(tune, C, 4, 1, S.chordSpans(1, 4, 1, FOUR_MAP).spans), S.harmonize(tune, C, 4, 1));
});

test('quarter-note pulse chords lean on each measure’s first beat in 3/4 and 7/8, on each whole note in 4/4', () => {
  const pop = S.progressionChords(C, S.PROGRESSIONS[0]).slice(0, 2);
  for (const [map, atBar] of [[THREE_MAP, 1], [SEVEN_MAP, 1], [THREE_MAP, TM.measureStart(3, THREE_MAP)]]) {
    const { spans } = S.chordSpans(atBar, 2, 2, map);
    const notes = S.chordNotesFor(pop, 2, 'pulse', newId, spans, { map, atBar });
    const loud = [...new Set(notes.filter((x) => x.velocity > 0.7).map((x) => x.startOffset))].sort((a, b) => a - b);
    // Two chords of two measures each: four measures, four accents, each on a bar line
    assert.equal(loud.length, 4, `${map.base.num}/${map.base.den}`);
    assert.ok(loud.every(onMeasure(map, atBar)));
  }
  // 4/4: the accents and notes as before, the meter passed or not
  const { spans } = S.chordSpans(1, 2, 2, FOUR_MAP);
  const before = S.chordNotesFor(pop, 2, 'pulse', counter(), spans);
  assert.deepEqual(S.chordNotesFor(pop, 2, 'pulse', counter(), spans, { map: FOUR_MAP, atBar: 1 }), before);
  assert.deepEqual([...new Set(before.filter((x) => x.velocity > 0.7).map((x) => x.startOffset))], [0, 1, 2, 3]);
  assert.equal(fnv(['sustain', 'pulse', 'offbeat', 'arp'].map((st) => S.chordNotesFor(S.progressionChords(C, S.PROGRESSIONS[0]), 2, st, counter()))), 'afe4a7f9');
});

test('the syncopated bass plays its push in each measure of a chord, and the drone is struck every two measures', () => {
  for (const map of [THREE_MAP, SEVEN_MAP]) {
    const m = TM.measureBars(map.base);
    const chordPart = S.chordNotesFor(S.progressionChords(C, S.PROGRESSIONS[0]).slice(0, 2), 2, 'sustain', newId, S.chordSpans(1, 2, 2, map).spans);
    const len = 4 * m;
    const bass = S.bassFromChords(chordPart, len, 'syncopated', newId, 33, m);
    const downs = bass.filter((x) => x.velocity > 0.85).map((x) => x.startOffset);
    assert.equal(downs.length, 4, `${map.base.num}/${map.base.den}: one push a measure`);
    assert.ok(downs.every(onMeasure(map, 1)));
    assert.ok(bass.every((x) => x.startOffset < len - 1e-9));
    const drone = S.accompany(chordPart, len, 'drone', newId, map.base);
    const struck = [...new Set(drone.map((x) => x.startOffset))];
    assert.deepEqual(struck.map((x) => Math.round((x / m) * 1e6) / 1e6), [0, 2]);
  }
  // 4/4 as before
  const chordPart = S.chordNotesFor(S.progressionChords(C, S.PROGRESSIONS[0]), 2, 'sustain', counter());
  assert.equal(fnv(['root', 'eighths', 'octaves', 'syncopated'].map((st) => S.bassFromChords(chordPart, 8, st, counter()))), '6eaa895f');
  assert.equal(fnv(S.accompany(chordPart, 8, 'drone', counter())), '3d1f0735');
});

test('the studio and Pocket pass the song’s meter to the chord, bass and drum tools', () => {
  const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const actions = src('src/store/smartActions.ts');
  assert.match(actions, /const key = songKey\(\);\s+const \{ chords \} = harmonize\(melody, key, clip\.lengthBars, chordBars, spans\)/);
  assert.match(actions, /chordNotesFor\(chords, chordBars, style, newId, spans, \{ map, atBar \}\)/);
  assert.match(actions, /bassFromChords\(clip\.notes, clip\.lengthBars, style, newId, 33, meter\.num \/ meter\.den\)/);
  const pocket = src('src/pocket/PocketSheets.tsx');
  assert.match(pocket, /chordNotesFor\(all, chordBars, style, pocketNoteId, spans, \{ map: meter, atBar: sec\.from \}\)/);
  assert.match(pocket, /const meter = meterAt\(sec\.from, map\)/);
});
