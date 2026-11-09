// Chills progressions and the build into a peak (src/store/chills.ts, chillsBuild.ts,
// chillsActions.ts): the right chords in several keys and both modes, voicings that stay in the
// instrument's range with no low clusters, the key-change lift, the late suspensions, the pedal,
// the climbing bass and the widening chords; and the build's lanes: written, their rise capped,
// never a step, a track's own lane kept outside the build, and one undo step. Run with `npm test`.
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
const X = await import('../src/store/chills.ts');
const B = await import('../src/store/chillsBuild.ts');
const { keyOf } = await import('../src/store/songKey.ts');
const { midiOf } = await import('../src/store/noteTools.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');
const { AUTOMATION, laneValueAt } = await import('../src/audio/automation.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const FOUR = { base: { num: 4, den: 4 }, points: [] };
const WALTZ = { base: { num: 3, den: 4 }, points: [] };
const pc = (m) => ((m % 12) + 12) % 12;
let n = 0;
const id = () => `n${++n}`;
const prog = (id) => X.chillsById(id);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const RANGES = [[36, 96], [48, 96], [24, 108], [36, 88], [21, 108]];

test('the chords are right in several keys, major and minor', () => {
  const names = (root, mode, p) => X.chillsNames(keyOf(root, mode), prog(p)).join(' ');
  assert.equal(names(0, 'major', 'mediant'), 'C G# C E');
  assert.equal(names(0, 'major', 'borrowedIv'), 'C G F Fm');
  assert.equal(names(0, 'major', 'deceptive'), 'C F G7 G#');
  assert.equal(names(9, 'minor', 'deceptive'), 'Am Dm E7 F');
  assert.equal(names(9, 'minor', 'mediant'), 'Am F Dm A');
  assert.equal(names(7, 'major', 'borrowedIv'), 'G D C Cm');
  assert.equal(names(2, 'minor', 'borrowedIv'), 'Dm G Gm Dm');
  assert.equal(names(0, 'major', 'suspended'), 'Am F Gsus4 G Csus4 C');
  assert.equal(names(4, 'minor', 'suspended'), 'Em C Dsus4 D Esus4 Em');
  assert.equal(names(0, 'major', 'pedal'), 'C F/C Am/C G/C');
  assert.equal(names(0, 'major', 'risingBass'), 'C Dm C/E F G Am G/B C');
  assert.equal(names(9, 'minor', 'risingBass'), 'Am G/B C Dm E F G Am');
  assert.equal(names(0, 'major', 'liftStep'), 'C G Am A7 D A Bm G');
  assert.equal(names(9, 'minor', 'liftStep'), 'Am F C F#7 Bm G D A');
  assert.equal(names(5, 'major', 'liftHalf'), 'F C Dm A# F# C# D#m B');
  // Every chord's notes are its chord in the key, in every key and mode
  for (const mode of ['major', 'minor'])
    for (let root = 0; root < 12; root++)
      for (const p of X.CHILLS) {
        const key = keyOf(root, mode);
        const v = X.chillsVoicings(key, p, { range: [36, 96] });
        X.chillsChords(key, p).forEach((c, i) => {
          const pcs = X.chillsPcs(key, c);
          for (const m of v[i].upper) assert.ok(pcs.includes(pc(m)), `${p.id} ${key.name} chord ${i}: ${m} is in ${pcs}`);
          // Every note of the chord is in its voicing (a wider one may double some)
          for (const q of pcs) assert.ok(v[i].upper.some((m) => pc(m) === q), `${p.id} ${key.name} chord ${i} has ${q}`);
        });
      }
});

test('voicings stay in the range, with one low note and no low clusters', () => {
  for (const range of RANGES)
    for (const mode of ['major', 'minor'])
      for (let root = 0; root < 12; root++)
        for (const p of X.CHILLS) {
          const key = keyOf(root, mode);
          const notes = X.chillsFill(key, p, 1, 9, FOUR, id, { range });
          const starts = new Map();
          for (const note of notes) {
            const m = midiOf(note.note);
            assert.ok(m >= range[0] && m <= range[1], `${p.id} ${key.name} ${range}: ${note.note} out of range`);
            const at = Math.round(note.startOffset * 192);
            starts.set(at, [...(starts.get(at) ?? []), m]);
          }
          // Everything sounding at each chord change: below E3, notes at least a 5th apart
          for (const at of starts.keys()) {
            const t = at / 192;
            const sounding = notes.filter((x) => x.startOffset <= t + 1e-9 && x.startOffset + durationToBars(x.duration) > t + 1e-9).map((x) => midiOf(x.note)).sort((a, b) => a - b);
            const low = sounding.filter((m) => m < X.LOW_REGISTER);
            for (let i = 1; i < low.length; i++) assert.ok(low[i] - low[i - 1] >= 7, `${p.id} ${key.name} ${range} at ${t}: ${low}`);
            assert.ok(low.length <= 2, `${p.id} ${key.name}: at most a bass and its 5th down low (${low})`);
            if (low.length) assert.ok(low[0] >= (p.climb ? X.CLIMB_FLOOR : X.BASS_FLOOR) || low[0] >= range[0], `${p.id}: bass ${low[0]} not too low`);
          }
        }
});

test('the chord above the bass is a 5th or more over it, out of the low register', () => {
  for (const p of X.CHILLS)
    for (const root of [0, 3, 6, 9, 11]) {
      const v = X.chillsVoicings(keyOf(root, 'major'), p, { range: [36, 96] });
      for (const { bass, upper } of v) {
        assert.ok(Math.min(...upper) >= X.LOW_REGISTER, `${p.id}: ${upper}`);
        if (bass.length) assert.ok(Math.min(...upper) - bass[0] >= 7, `${p.id}: ${bass} under ${upper}`);
      }
    }
});

test('a key change lifts the whole progression: up a half step, and up a whole step led by the new key\'s V7', () => {
  for (const root of [0, 4, 7, 10])
    for (const mode of ['major', 'minor']) {
      const key = keyOf(root, mode);
      const half = X.chillsVoicings(key, prog('liftHalf'), { range: [36, 96] });
      assert.equal(half.length, 8);
      for (let i = 0; i < 4; i++) assert.deepEqual([...half[i + 4].bass, ...half[i + 4].upper], [...half[i].bass, ...half[i].upper].map((m) => m + 1));
      const step = X.chillsVoicings(key, prog('liftStep'), { range: [36, 96] });
      for (let i = 0; i < 3; i++) assert.deepEqual([...step[i + 4].bass, ...step[i + 4].upper], [...step[i].bass, ...step[i].upper].map((m) => m + 2));
      // The pivot is the dominant 7th of the new key: its root a 5th over the new home
      const pivot = X.chillsPcs(key, X.chillsChords(key, prog('liftStep'))[3]);
      assert.equal(pivot[0], pc(root + 2 + 7));
      assert.deepEqual(pivot.map((q) => pc(q - pivot[0])), [0, 4, 7, 10]);
    }
  // Played once over its span, however long: repeated, it would drop back down
  const spans = X.chillsSpans(1, 17, 8, FOUR, true);
  assert.equal(spans.length, 8);
  assert.deepEqual(spans.map((s) => s.length), [2, 2, 2, 2, 2, 2, 2, 2]);
});

test('a suspension falls to its 3rd three quarters through the chord', () => {
  const key = keyOf(0, 'major');
  const notes = X.chillsNotes(key, prog('suspended'), [0, 1, 2, 3].map((i) => ({ start: i, length: 1 })), id, { range: [36, 96] });
  // G chord at bar 2: a C held to 2.75, then B from 2.75 to 3
  const sus = notes.find((x) => x.startOffset === 2 && pc(midiOf(x.note)) === 0);
  const third = notes.find((x) => x.startOffset === 2.75 && pc(midiOf(x.note)) === 11);
  assert.ok(sus && third);
  close(durationToBars(sus.duration), 0.75);
  close(durationToBars(third.duration), 0.25);
  assert.equal(midiOf(sus.note) - midiOf(third.note), 1);
  // C chord at bar 3: F falls to E
  assert.ok(notes.some((x) => x.startOffset === 3 && pc(midiOf(x.note)) === 5));
  assert.ok(notes.some((x) => x.startOffset === 3.75 && pc(midiOf(x.note)) === 4));
});

test('the pedal holds the home note under each time through; the climbing bass rises every chord', () => {
  const key = keyOf(2, 'major');
  const notes = X.chillsNotes(key, prog('pedal'), [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ start: i, length: 1 })), id, { range: [36, 96] });
  const low = notes.filter((x) => midiOf(x.note) < X.LOW_REGISTER);
  assert.equal(low.length, 2);
  for (const [k, x] of low.entries()) {
    assert.equal(pc(midiOf(x.note)), 2);
    close(x.startOffset, k * 4);
    close(durationToBars(x.duration), 4);
  }
  for (const mode of ['major', 'minor'])
    for (let root = 0; root < 12; root++) {
      const v = X.chillsVoicings(keyOf(root, mode), prog('risingBass'), { range: [24, 108] });
      const bass = v.map((c) => c.bass[0]);
      for (let i = 1; i < bass.length; i++) assert.ok(bass[i] > bass[i - 1] && bass[i] - bass[i - 1] <= 2, `${root} ${mode}: ${bass}`);
      assert.equal(bass[7] - bass[0], 12);
      assert.equal(pc(bass[0]), root);
    }
});

test('widening chords get more notes each, each note softer, so the chord grows without a jump in level', () => {
  for (const mode of ['major', 'minor']) {
    const key = keyOf(5, mode);
    const notes = X.chillsNotes(key, prog('widening'), [0, 1, 2, 3].map((i) => ({ start: i, length: 1 })), id, { range: [36, 96] });
    const at = (t) => notes.filter((x) => x.startOffset === t);
    const counts = [0, 1, 2, 3].map((t) => at(t).length);
    for (let i = 1; i < 4; i++) assert.ok(counts[i] > counts[i - 1], `${counts}`);
    const spread = [0, 1, 2, 3].map((t) => Math.max(...at(t).map((x) => midiOf(x.note))) - Math.min(...at(t).map((x) => midiOf(x.note))));
    for (let i = 1; i < 4; i++) assert.ok(spread[i] > spread[i - 1], `${spread}`);
    // Summed as unrelated notes (power), the widest is at most 3 dB over the closest
    const power = (t) => at(t).reduce((s, x) => s + x.velocity ** 2, 0);
    assert.ok(10 * Math.log10(power(3) / power(0)) <= 3, `${10 * Math.log10(power(3) / power(0))} dB`);
  }
});

test('the chords fill a clip or section: a whole number of times through, the last held to the end, in the song\'s measures', () => {
  assert.deepEqual(X.chillsSpans(1, 9, 4, FOUR), [0, 2, 4, 6].map((s) => ({ start: s, length: 2 })));
  assert.deepEqual(X.chillsSpans(1, 5, 4, FOUR), [0, 1, 2, 3].map((s) => ({ start: s, length: 1 })));
  // 6 bars, 4 chords: a bar each, the last held over the rest
  assert.deepEqual(X.chillsSpans(1, 7, 4, FOUR).map((s) => s.length), [1, 1, 1, 3]);
  // 2 bars and 8 chords: a quarter bar each
  assert.equal(X.chillsSpans(1, 3, 8, FOUR).length, 8);
  // 16 bars, 4 chords: 4 bars each
  assert.deepEqual(X.chillsSpans(1, 17, 4, FOUR).map((s) => s.length), [4, 4, 4, 4]);
  // In 3/4 a chord a measure is three beats
  const waltz = X.chillsSpans(1, 1 + 4 * 0.75, 4, WALTZ);
  assert.deepEqual(waltz.map((s) => s.start), [0, 0.75, 1.5, 2.25]);
  for (const s of waltz) close(s.length, 0.75);
});

const vol = AUTOMATION.volume;
const dbAt = (points, bar) => vol.toReal(laneValueAt(points, bar));

test('the swell: a volume lane from under the track\'s level back to it, its rise capped, never a step', () => {
  for (const depthDb of [3, 4.5, 6, 12]) {
    for (const gap of [true, false]) {
      const o = { from: 5, peak: 9, gap, depthDb };
      const points = B.swellLane(undefined, -6, o, FOUR);
      assert.ok(points.length >= 6);
      // Before the build and from the peak on: the track's own level
      close(dbAt(points, 1), -6, 1e-3);
      close(dbAt(points, 4.75), -6, 1e-3);
      close(dbAt(points, 9), -6, 1e-3);
      close(dbAt(points, 12), -6, 1e-3);
      // The build starts at most 6 dB under it (12 asked: 6) and nothing is ever above the level before the build
      close(dbAt(points, 5), -6 - Math.min(6, depthDb), 1e-3);
      assert.ok(B.riseOver(points, 4, 13, -6) <= 1e-3);
      // Each step of the way up is a slope: no two points at one place, no rise over a measure bigger than the whole swell
      assert.equal(B.stepUp(points), 0);
      for (let i = 1; i < points.length; i++) assert.ok(points[i].bar > points[i - 1].bar);
      for (let bar = 5; bar < 9 - 1 / 8; bar += 1 / 16) assert.ok(dbAt(points, bar + 1 / 16) - dbAt(points, bar) <= B.BUILD_MOST_RISE_DB / 4 + 1e-6, `at ${bar}`);
      // It grows slowly at first: less than half way up half way through
      assert.ok(dbAt(points, 7) < -6 - Math.min(6, depthDb) / 2);
      if (gap) {
        // Near-silence for the last 8th, then back to the level before the build, never above it
        close(dbAt(points, 9 - 1 / 16), -6 - B.GAP_DB, 1e-3);
        assert.ok(dbAt(points, 9 - 1 / 8 - 1e-4) >= -6 - 1e-3);
      }
    }
  }
});

test('a lane the track already has is kept outside the build and followed inside it', () => {
  const existing = [{ bar: 1, value: vol.toNorm(-3) }, { bar: 6, value: vol.toNorm(-9) }, { bar: 12, value: vol.toNorm(-9) }, { bar: 14, value: vol.toNorm(0) }];
  const points = B.swellLane(existing, 0, { from: 7, peak: 11, gap: false, depthDb: 6 }, FOUR);
  for (const bar of [1, 3, 6, 6.5, 11, 12, 13, 14, 20]) close(dbAt(points, bar), dbAt(existing, bar), 1e-3);
  close(dbAt(points, 7), -15, 1e-3);
  // The track's own points before and after the build are its own
  assert.ok(points.some((p) => p.bar === 1) && points.some((p) => p.bar === 12) && points.some((p) => p.bar === 14));
  // A silent track isn't swelled
  assert.equal(B.swellLane(undefined, -60, { from: 7, peak: 11, gap: false, depthDb: 6 }, FOUR), null);
});

test('the filter opens over the build, from 500 Hz back to the track\'s own cutoff', () => {
  const cut = AUTOMATION.filterCutoff;
  const points = B.openingLane(undefined, 20000, { from: 3, peak: 7, gap: true }, FOUR);
  close(cut.toReal(laneValueAt(points, 2)), 20000, 1);
  close(cut.toReal(laneValueAt(points, 3)), B.BUILD_LOW_CUTOFF, 1);
  for (let bar = 3; bar < 7; bar += 1 / 8) assert.ok(laneValueAt(points, bar + 1 / 8) >= laneValueAt(points, bar) - 1e-9);
  close(cut.toReal(laneValueAt(points, 7)), 20000, 1);
  close(cut.toReal(laneValueAt(points, 30)), 20000, 1);
  // A filter already lower than 500 Hz stays where it was
  const dark = B.openingLane(undefined, 300, { from: 3, peak: 7, gap: false }, FOUR);
  for (const p of dark) close(cut.toReal(p.value), 300, 0.5);
});

test('the build in 3/4: a measure line point each three beats, the near-silence half a beat', () => {
  const p = B.buildPlaces({ from: 1 + 4 * 0.75, peak: 1 + 8 * 0.75, gap: true }, WALTZ);
  assert.deepEqual(p.marks, [4.75, 5.5, 6.25]);
  close(p.gapStart, 7 - 1 / 8);
  close(p.lead, 4 - 0.25);
});

test('the build is one undo step, with the app\'s cautions, and reachable in the studio and in Pocket', () => {
  const actions = src('src/store/chillsActions.ts');
  const build = actions.slice(actions.indexOf('export function buildForChills'));
  assert.equal((build.match(/checkpoint\(\)/g) ?? []).length, 1);
  assert.match(build, /useTimelineStore\.setState\(\{ past, future: \[\] \}\)/);
  assert.match(build, /allOrNothing\(/);
  assert.match(build, /checkSafety\(before, currentProject\(\)\)/);
  assert.match(src('src/components/timeline/ClipContextMenu.tsx'), /Build into a peak…/);
  assert.match(src('src/components/timeline/ClipContextMenu.tsx'), /Chills progression…/);
  assert.match(src('src/components/timeline/ChordRiffBar.tsx'), /chillsFill\(/);
  const pocket = src('src/pocket/PocketSheets.tsx');
  assert.match(pocket, /chillsFill\(/);
  assert.match(pocket, /buildForChills\(/);
  // The words: no op names or ids in what people read
  for (const p of X.CHILLS) {
    assert.doesNotMatch(`${p.name} ${p.detail}`, /[_{}]|\bAI\b|  /);
    assert.ok(p.detail.endsWith('.'));
  }
});
