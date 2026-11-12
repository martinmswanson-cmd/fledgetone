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
const { plainHashes } = await import('./chills-plain-snapshot.mjs');
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
  assert.equal(names(0, 'major', 'mediant'), 'C A♭ C E');
  assert.equal(names(0, 'major', 'borrowedIv'), 'C G F Fm');
  assert.equal(names(0, 'major', 'deceptive'), 'C F G7 A♭');
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
  assert.equal(names(9, 'minor', 'liftStep'), 'Am F C F♯7 Bm G D A');
  assert.equal(names(5, 'major', 'liftHalf'), 'F C Dm B♭ G♭ D♭ E♭m C♭');
  // Every chord's notes are its chord in the key, in every key and mode
  for (const mode of ['major', 'minor'])
    for (let root = 0; root < 12; root++)
      for (const p of X.CHILLS) {
        const key = keyOf(root, mode);
        const v = X.chillsVoicings(key, p, { range: [36, 96], voicing: 'plain' });
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
  const build = actions.slice(actions.indexOf('export async function buildForChills'));
  assert.equal((build.match(/checkpoint\(\)/g) ?? []).length, 1);
  assert.match(build, /useTimelineStore\.setState\(\{ past, future: \[\] \}\)/);
  assert.match(build, /allOrNothing\(/);
  assert.match(build, /checkSafety\(before, after\)/);
  // New parts are set from the measured music, and the result is measured again: the sound check's caution counts them
  assert.match(build, /musicPeak - PAD_UNDER_LU - padLufs/);
  assert.match(build, /musicEnd - RISER_UNDER_DB - loudest/);
  assert.match(build, /measuredRise\(la\.bars, lb\.bars, la\.song\)/);
  // Nothing chosen, nothing to change: no undo step (an early return before the checkpoint), and the button is off
  assert.ok(build.indexOf("if (!buildChosen(o))") < build.indexOf('checkpoint()'));
  assert.ok(build.indexOf('if (!plan.tracks.size && !plan.riser && !plan.pad)') < build.indexOf('checkpoint()'));
  assert.match(src('src/components/timeline/SmartDialog.tsx'), /disabled=\{!tracks\.length \|\| !buildChosen\(opts\)\}/);
  // A resonant Filter isn't swept
  assert.match(build.length ? actions : '', /filter\.resonance > RESONANT_Q/);
  assert.match(actions, /plural\(plan\.swelled, 'track swells', 'tracks swell'\)/);
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

test('a bass instrument plays the roots, in its range; every instrument stays in its range', () => {
  const ranges = { slap: [24, 55], sub: [24, 48], b808: [24, 52], trumpet: [52, 84], guitar: [40, 76], stabs: [48, 84], violins: [55, 88] };
  for (const [name, range] of Object.entries(ranges))
    for (const mode of ['major', 'minor'])
      for (let root = 0; root < 12; root++)
        for (const p of X.CHILLS) {
          const key = keyOf(root, mode);
          const notes = X.chillsFill(key, p, 1, 9, FOUR, id, { range });
          assert.ok(notes.length, `${name} ${p.id} ${key.name}: something to play`);
          for (const x of notes) assert.ok(midiOf(x.note) >= range[0] && midiOf(x.note) <= range[1], `${name} ${p.id} ${key.name}: ${x.note}`);
          if (range[1] < X.LOW_REGISTER + 12) {
            assert.equal(X.registerOf(range).kind, 'roots');
            const v = X.chillsVoicings(key, p, { range });
            X.chillsChords(key, p).forEach((c, i) => {
              if (p.pedal) return assert.equal(v[i].bass.length + v[i].upper.length, 0);
              assert.deepEqual(v[i].upper, []);
              assert.equal(v[i].bass.length, 1);
              assert.equal(pc(v[i].bass[0]), pc(root + (c.bass ?? c.semis) + (c.up ?? 0)), `${name} ${p.id}: the chord's root`);
            });
          }
        }
});

test('the swell follows a lane at every one of its points: a silence in it stays silent, never louder at any moment', () => {
  const lane = [{ bar: 1, value: vol.toNorm(-6) }, { bar: 7.5, value: vol.toNorm(-6) }, { bar: 7.51, value: 0 }, { bar: 7.74, value: 0 }, { bar: 7.75, value: vol.toNorm(-6) }];
  const points = B.swellLane(lane, -6, { from: 5, peak: 9, gap: true, depthDb: 6 }, FOUR);
  for (const bar of [7.52, 7.6, 7.7, 7.73]) assert.equal(laneValueAt(points, bar), 0);
  for (let bar = 1; bar < 12; bar += 1 / 256) assert.ok(laneValueAt(points, bar) <= laneValueAt(lane, bar) + 1e-9, `at ${bar}`);
  // A user's crescendo inside the build, and a curved lane
  const rising = [{ bar: 2, value: vol.toNorm(-20) }, { bar: 6, value: vol.toNorm(0), curve: 0.7 }, { bar: 8.3, value: vol.toNorm(-10) }];
  const r = B.swellLane(rising, 0, { from: 5, peak: 9, gap: false, depthDb: 6 }, FOUR);
  for (let bar = 1; bar < 12; bar += 1 / 256) assert.ok(dbAt(r, bar) <= dbAt(rising, bar) + 0.01, `at ${bar}: ${dbAt(r, bar)} over ${dbAt(rising, bar)}`);
});

test('a build from the music\'s level: nothing dips first, nothing before it changes, only the breath', () => {
  for (const depthDb of [3, 6]) {
    const o = { from: 5, peak: 9, gap: true, depthDb, start: 'level' };
    assert.equal(B.dipsFirst(o), false);
    assert.equal(B.dipsFirst({ from: 5, peak: 9, gap: true }), true);
    close(B.buildPlaces(o, FOUR).lead, 5);
    const points = B.swellLane(undefined, -6, o, FOUR);
    // No point before the build: the bars before it play as they did
    assert.ok(points.every((p) => p.bar >= 5 - 1e-9), JSON.stringify(points));
    // The track's level all through the build, up to the breath
    for (let bar = 1; bar <= 9 - 1 / 8 + 1e-9; bar += 1 / 32) close(dbAt(points, bar), -6, 1e-3);
    close(dbAt(points, 9 - 1 / 16), -6 - B.GAP_DB, 1e-3);
    close(dbAt(points, 9), -6, 1e-3);
    // Never above the level, and every change a slope
    assert.ok(B.riseOver(points, 1, 13, -6) <= 1e-3);
    assert.equal(B.stepUp(points), 0);
    for (let i = 1; i < points.length; i++) assert.ok(points[i].bar > points[i - 1].bar);
  }
  // Over a lane the track has: followed exactly up to the breath
  const existing = [{ bar: 1, value: vol.toNorm(-3) }, { bar: 6, value: vol.toNorm(-9) }, { bar: 12, value: vol.toNorm(-9) }];
  const own = B.swellLane(existing, 0, { from: 5, peak: 9, gap: false, depthDb: 6, start: 'level' }, FOUR);
  for (let bar = 1; bar < 13; bar += 1 / 16) close(dbAt(own, bar), dbAt(existing, bar), 1e-3);
  // The filter isn't darkened first, so nothing opens: the lane as it was
  assert.deepEqual(B.openingLane(undefined, 20000, { from: 5, peak: 9, gap: true, start: 'level' }, FOUR), []);
  assert.deepEqual(B.openingLane(existing, 20000, { from: 5, peak: 9, gap: true, start: 'level' }, FOUR), existing);
  // The store side: the swell and the filter only when it dips first; the dip stays the default; in the studio and in Pocket
  const actions = src('src/store/chillsActions.ts');
  assert.match(actions, /const swell = dipsFirst\(o\) && o\.volume;/);
  assert.match(actions, /const sweep = dipsFirst\(o\) && o\.filter;/);
  assert.match(actions, /BUILD_DEFAULTS[^=]*= \{ start: 'dip',/);
  assert.match(actions, /buildChosen = [^\n]*\(dipsFirst\(o\) && \(o\.volume \|\| o\.filter\)\) \|\| o\.riser \|\| o\.gap \|\| o\.layer/);
  assert.match(actions, /nothing dips first: the tracks keep their level all through it/);
  assert.match(src('src/components/timeline/SmartDialog.tsx'), /way\('level', 'Start from the music’s level'/);
  assert.match(src('src/pocket/PocketSheets.tsx'), /buildForChills\(\{ \.\.\.BUILD_DEFAULTS, start: 'level',/);
});

test('a chills progression written over a clip takes its name only where the app named it', () => {
  const tracks = [{ id: 't1', name: 'Pad' }, { id: 't2', name: 'Keys' }];
  const clip = (id, name, more = {}) => ({ id, trackId: 't1', name, startBar: 1, lengthBars: 4, notes: [], isSelected: false, ...more });
  const prog = X.chillsById('risingBass').name;
  // The app's names: a new clip's on its track, another progression's, one made from a file, none
  for (const name of ['Pad 2', 'Pad 12', X.chillsById('mediant').name, '', '  '])
    assert.equal(X.autoClipName({ name }, 'Pad'), true, name);
  assert.equal(X.autoClipName({ name: 'Drums', nameFromFile: true }, 'Pad'), true);
  // Typed, or not surely the app's: kept
  for (const name of ['Verse 2', 'Pad', 'Pad 2b', 'Pad two', 'Keys 1', 'My idea'])
    assert.equal(X.autoClipName({ name }, 'Pad'), false, name);
  const clips = [clip('a', 'Pad 2'), clip('b', 'Chorus'), clip('f', 'Loop 1', { nameFromFile: true })];
  const out = X.namedForChills(clips, tracks, 'a', prog);
  assert.equal(out[0].name, prog);
  assert.equal(out[1], clips[1]);
  assert.equal(X.namedForChills(clips, tracks, 'b', prog), clips, 'a typed name: nothing changes');
  const file = X.namedForChills(clips, tracks, 'f', prog)[2];
  assert.equal(file.name, prog);
  assert.equal('nameFromFile' in file, false);
  // Linked clips: each that has an app's name follows (they all play it now); a typed one is kept
  const linked = [clip('a', 'Pad 2', { pattern: 'p' }), clip('b', 'Pad 3', { pattern: 'p' }), clip('c', 'Mine', { pattern: 'p' }), clip('d', 'Pad 4')];
  const named = X.namedForChills(linked, tracks, 'b', prog).map((c) => c.name);
  assert.deepEqual(named, [prog, prog, 'Mine', 'Pad 4']);
  // Studio's CHILLS and Pocket's For chills name it inside the edit's one step
  const roll = src('src/components/timeline/PianoRoll.tsx');
  assert.match(roll, /store\.setClipNotes\(clip\.id, next\);\s*\/\/[^\n]*\n\s*if \(name\) nameAfterChills\(clip\.id, name\);/);
  assert.match(src('src/components/timeline/ChordRiffBar.tsx'), /apply\(out, undefined, prog\.name\)/);
  assert.match(src('src/pocket/PocketSheets.tsx'), /editCell\(track\.id, sec, \(\) => notes, true, \(id\) => nameAfterChills\(id, prog\.name\)\)/);
  assert.match(src('src/pocket/pocketCell.ts'), /s\.setClipNotes\(id, next\);\s*then\?\.\(id\);/);
});

test('"New empty clip" starts where the lane menu\'s dialogs make theirs: the start of the bar clicked in', async () => {
  const { clickedBarStart } = await import('../src/audio/tempoMap.ts');
  // 14 px into bar 9 at 48 px a bar, snapped to a 16th: 9.25, made at bar 9
  close(clickedBarStart(9.25, FOUR), 9);
  close(clickedBarStart(9.9375, FOUR), 9);
  close(clickedBarStart(9, FOUR), 9);
  close(clickedBarStart(9 - 1e-9, FOUR), 9);
  close(clickedBarStart(0.5, FOUR), 1);
  // In 3/4 a bar is three beats
  close(clickedBarStart(1 + 0.75 * 2 + 0.5, WALTZ), 1 + 0.75 * 2);
  const menu = src('src/components/timeline/ClipContextMenu.tsx');
  assert.match(menu, /const clickedBar = clickedBarStart\(menu\.bar, meter\);/);
  assert.match(menu, /open: \{ mode, trackId: menu\.trackId, bar: clickedBar \}/);
  const newClip = menu.slice(menu.indexOf('const newClip'), menu.indexOf('const items'));
  assert.match(newClip, /const at = clickedBar;/);
  assert.doesNotMatch(newClip, /beatFloor/);
});

test('the guide says how far the breath drops truthfully: the tracks, with reverb and echoes ringing on', () => {
  const guide = src('GUIDE.md');
  const build = guide.slice(guide.indexOf('- **Build into a peak…**'));
  assert.doesNotMatch(build.slice(0, build.indexOf('\n')), /near-silence \(18 dB down\)/);
  assert.match(build.slice(0, build.indexOf('\n')), /the tracks drop 18 dB/);
});

// ---------- Plain and rich chords ----------

/** The Plain output of every progression there was before rich chords came (2026.11.12), hashed over every key, both modes, a dozen ranges, two meters, four spans and two velocities */
const PLAIN_BEFORE = {
  mediant: '367e92fb715210a5',
  borrowedIv: '77415d8639f715c3',
  deceptive: 'f4650e2e21298bb4',
  suspended: 'ff73c4e1e8cf271c',
  pedal: '2c557f0cd307c183',
  liftStep: 'aa69c99f0bf513a3',
  liftHalf: '385f59d6df9fc542',
  risingBass: 'f41a473ca2c965d3',
  widening: 'cbe8a0f8979dee96',
};

test('plain chords are exactly as they were, by default and when picked', () => {
  const ids = Object.keys(PLAIN_BEFORE);
  assert.deepEqual(plainHashes(ids), PLAIN_BEFORE);
  assert.deepEqual(plainHashes(ids, { voicing: 'plain' }), PLAIN_BEFORE);
  for (const p of X.CHILLS) assert.equal(X.voicingOf(p), ids.includes(p.id) ? 'plain' : 'rich', p.id);
});

const RICH_RANGES = [[36, 96], [48, 96], [24, 108], [21, 108], [36, 88]];
const sounding = (v) => [...v.bass, ...v.upper];
/** Each chord's notes over its root stacked up from the first root out of the low register: the plain way to play them */
const naive = (key, c) => {
  const root = pc(key.root + c.semis + (c.up ?? 0));
  const ivs = X.richIntervals(X.richQuality(key, c));
  const r = X.LOW_REGISTER + pc(root - X.LOW_REGISTER);
  return ivs.map((iv) => r + iv);
};

test('rich chords: one low note, 4 or 5 notes above it, in range, no low clusters, the top no higher than A5', () => {
  for (const range of RICH_RANGES)
    for (const mode of ['major', 'minor'])
      for (let root = 0; root < 12; root++)
        for (const p of X.CHILLS) {
          const key = keyOf(root, mode);
          const v = X.chillsVoicings(key, p, { range, voicing: 'rich' });
          v.forEach((c, i) => {
            const where = `${p.id} ${key.name} ${range} chord ${i}: ${c.bass}|${c.upper}`;
            // (a bass climbing from F♯3 on an instrument starting at C3 leaves no room for rich chords up there: those play plain, and are named so)
            if (c.plain) {
              assert.ok(p.climb && range[0] > X.BASS_FLOOR, `${where}: rich fits`);
              assert.ok(!/(maj|m)?(9|11|13)/.test(X.chillsNames(key, p, 'rich', range)[i]), `${where}: named plain`);
              return;
            }
            assert.ok(c.upper.length >= 4 && c.upper.length <= 5, where);
            // (chords that open out keep opening, as in plain; over the climbing bass they climb a little higher)
            // (on an instrument whose bass starts as high as C3, up to E6 where there's no room under A5)
            if (!p.widen) assert.ok(Math.max(...c.upper) <= X.RICH_TOP + (range[0] > X.BASS_FLOOR ? X.RICH_HIGH_ROOM : p.climb ? X.RICH_CLIMB_ROOM : 0), where);
            assert.ok(Math.min(...c.upper) >= X.LOW_REGISTER, where);
            for (const m of sounding(c)) assert.ok(m >= range[0] && m <= range[1], where);
            assert.ok(c.bass.length <= (p.widen ? 2 : 1), where);
            const up = [...c.upper].sort((a, b) => a - b);
            for (let k = 1; k < up.length; k++) {
              const d = up[k] - up[k - 1];
              assert.ok(d !== 1, `${where}: no half step`);
              if (d <= 2) assert.ok(up[k - 1] >= X.RICH_STEP_FLOOR, `${where}: a whole step only from A3 up`);
            }
          });
        }
});

test('rich chords lead smoothly: each voice moves a 4th at most, and less in all than chords stacked from their roots', () => {
  for (const range of RICH_RANGES)
    for (const mode of ['major', 'minor'])
      for (let root = 0; root < 12; root++)
        for (const p of X.CHILLS.filter((q) => !q.widen)) {
          const key = keyOf(root, mode);
          const chords = X.chillsChords(key, p);
          const v = X.chillsVoicings(key, p, { range, voicing: 'rich' });
          let total = 0;
          let plainTotal = 0;
          for (let i = 1; i < v.length; i++) {
            // (into the key change the whole chord moves up as one: that's the lift)
            if (chords[i].up && !chords[i - 1].up) continue;
            // (nor to or from a chord with no room to be rich, played plain)
            if (v[i].plain || v[i - 1].plain) continue;
            const move = X.richMove(v[i - 1].upper, v[i].upper);
            // (on an instrument starting at C3, where the chords have less room under A5, a voice may move up to a 5th)
            assert.ok(move.most <= X.RICH_MOST_MOVE + (range[0] > X.BASS_FLOOR ? 2 : 0), `${p.id} ${key.name} ${range} ${i}: ${v[i - 1].upper} to ${v[i].upper} moves ${move.most}`);
            total += move.total;
            plainTotal += X.richMove(naive(key, chords[i - 1]), naive(key, chords[i])).total;
          }
          // Played again, the last chord leads back to the first too (but the climb, which goes back down its octave)
          if (!X.playsOnce(p) && !p.climb) {
            const back = X.richMove(v[v.length - 1].upper, v[0].upper);
            if (!range.includes(48)) assert.ok(back.most <= X.RICH_MOST_MOVE, `${p.id} ${key.name} ${range}: back to the first moves ${back.most}`);
            total += back.total;
            plainTotal += X.richMove(naive(key, chords[chords.length - 1]), naive(key, chords[0])).total;
          }
          assert.ok(total < plainTotal, `${p.id} ${key.name}: ${total} vs ${plainTotal} stacked from the roots`);
        }
});

test('rich chords hold the notes they are named for; common tones stay put', () => {
  for (const mode of ['major', 'minor'])
    for (let root = 0; root < 12; root++)
      for (const p of X.CHILLS) {
        const key = keyOf(root, mode);
        const v = X.chillsVoicings(key, p, { range: [36, 96], voicing: 'rich' });
        X.chillsChords(key, p).forEach((c, i) => {
          const pcs = X.chillsChordPcs(key, c, 'rich');
          const ivs = X.richIntervals(X.richQuality(key, c));
          for (const m of v[i].upper) assert.ok(pcs.includes(pc(m)), `${p.id} ${key.name} ${i}: ${m} in ${pcs}`);
          // Every note but the 5th (and the root, where the bass plays it) is there: the 3rd, the 7th, the 9th...
          pcs.forEach((q, k) => {
            if (ivs[k] === 7 || (ivs[k] === 0 && v[i].bass.length)) return;
            if (ivs[k] === 0 && p.pedal) return;
            assert.ok(v[i].upper.some((m) => pc(m) === q), `${p.id} ${key.name} ${i}: has ${ivs[k]}`);
          });
        });
      }
  // Gm9 to C13 in F major: the F and A stay, the others move a step
  const key = keyOf(5, 'major');
  const v = X.chillsVoicings(key, prog('soulTurn'), { range: [36, 96] });
  const shared = v[2].upper.filter((m) => v[3].upper.includes(m));
  assert.ok(shared.length >= 2, `${v[2].upper} ${v[3].upper}`);
});

test('chord names: what is written, flats in flat keys and sharps in sharp ones, plain and rich', () => {
  const names = (root, mode, p, voicing) => X.chillsNames(keyOf(root, mode), prog(p), voicing).join(' ');
  assert.equal(names(5, 'major', 'soulTurn'), 'Fmaj9 Dm9 Gm9 C13 Am7 Dm9 Gm9 C13 D♭maj9 B♭m9 Am7 D7♯9 D7♭9 Gm9 C7♭9 Fmaj9');
  assert.equal(names(5, 'major', 'soulTurn', 'plain'), 'F Dm Gm C7 Am Dm Gm C7 D♭ B♭m Am D D7 Gm C7 F');
  assert.equal(names(0, 'minor', 'soulTurn'), 'Cm9 Fm9 Dm7♭5 G7♭9 E♭maj9 Cm9 Dm7♭5 G7♭9 A♭maj9 Fm9 E♭maj9 A7♯9 A7♭9 Dm7♭5 G7♭9 Cm9');
  assert.equal(names(0, 'minor', 'soulTurn', 'plain'), 'Cm Fm Dm7♭5 G7 E♭ Cm Dm7♭5 G7 A♭ Fm E♭ A A7 Dm7♭5 G7 Cm');
  assert.equal(names(11, 'minor', 'minorHome'), 'Em9 Bm11 Em9 Bm11 Em9 Bm11 Em9 B6');
  assert.equal(names(11, 'minor', 'minorHome', 'plain'), 'Em Bm Em Bm Em Bm Em B');
  assert.equal(names(2, 'major', 'minorHome'), 'Gm9 Dm11 Gm9 Dm11 Gm9 Dm11 Gm9 D6');
  // Minor keys on flat notes spell flats; sharp keys sharps
  assert.equal(names(0, 'minor', 'deceptive'), 'Cm Fm G7 A♭');
  assert.equal(names(7, 'minor', 'mediant'), 'Gm E♭ Cm G');
  assert.equal(names(5, 'minor', 'suspended'), 'Fm D♭ E♭sus4 E♭ Fsus4 Fm');
  assert.equal(names(1, 'minor', 'mediant'), 'C♯m A F♯m C♯');
  assert.equal(names(10, 'major', 'borrowedIv'), 'B♭ F E♭ E♭m');
  assert.equal(names(3, 'major', 'deceptive'), 'E♭ A♭ B♭7 C♭');
  assert.equal(names(0, 'major', 'deceptive', 'rich'), 'Cmaj9 Fmaj9 G13 A♭maj9');
  assert.equal(names(0, 'major', 'suspended', 'rich'), 'Am9 Fmaj9 G9sus4 G9 Csus4(add9) Cadd9');
  assert.equal(names(0, 'major', 'pedal', 'rich'), 'Cmaj9 Fmaj9/C Am9/C G9/C');
  assert.equal(X.chillsKeyName(keyOf(10, 'minor')), 'B♭ minor');
  assert.equal(X.chillsKeyName(keyOf(8, 'minor')), 'G♯ minor');
  // No flat key's plain names have a sharp, nor a sharp key's a flat (but a key change's new key)
  for (const p of X.CHILLS.filter((q) => !q.lift))
    for (const [root, mode] of [[5, 'major'], [10, 'major'], [3, 'major'], [8, 'major'], [0, 'minor'], [2, 'minor'], [5, 'minor'], [7, 'minor'], [10, 'minor']]) {
      const n = X.chillsNames(keyOf(root, mode), p, 'plain').join(' ');
      assert.ok(!n.includes('♯') && !n.includes('#'), `${p.id} ${X.chillsKeyName(keyOf(root, mode))}: ${n}`);
    }
  for (const p of X.CHILLS.filter((q) => !q.lift && q.id !== 'mediant' && q.id !== 'borrowedIv' && q.id !== 'deceptive' && q.id !== 'soulTurn' && q.id !== 'minorHome'))
    for (const [root, mode] of [[2, 'major'], [4, 'major'], [9, 'major'], [11, 'major'], [4, 'minor'], [11, 'minor'], [1, 'minor']]) {
      const n = X.chillsNames(keyOf(root, mode), p, 'plain').join(' ');
      assert.ok(!n.includes('♭') && !/[A-G]b/.test(n), `${p.id} ${X.chillsKeyName(keyOf(root, mode))}: ${n}`);
    }
  // On an instrument with no room for a rich chord, it's played and named plain
  const tiny = X.chillsVoicings(keyOf(0, 'major'), prog('deceptive'), { range: [60, 72], voicing: 'rich' });
  if (tiny.some((v) => v.plain)) assert.notEqual(X.chillsNames(keyOf(0, 'major'), prog('deceptive'), 'rich', [60, 72]).join(' '), names(0, 'major', 'deceptive', 'rich'));
});

test('the soul turnaround: ii–V loops, a borrowed ♭VI maj9 and iv m9, a V of ii bending ♯9 to ♭9, ending ii–V7♭9–Imaj9', () => {
  const p = prog('soulTurn');
  assert.equal(p.major.length, 16);
  assert.equal(p.minor.length, 16);
  const key = keyOf(5, 'major');
  const q = X.chillsChords(key, p).map((c) => [c.semis, X.richQuality(key, c)]);
  assert.deepEqual(q.slice(8, 10), [[8, 'maj9'], [5, 'min9']]);
  assert.deepEqual(q.slice(11, 13), [[9, 'dom7s9'], [9, 'dom7b9']]);
  assert.deepEqual(q.slice(13), [[2, 'min9'], [7, 'dom7b9'], [0, 'maj9']]);
  // At 60 BPM, two beats a chord: 16 chords in 8 bars, half a bar each, once round
  const spans = X.chillsSpans(1, 9, 16, FOUR, X.playsOnce(p));
  assert.equal(spans.length, 16);
  for (const s of spans) close(s.length, 0.5);
  // The ♯9 falls a half step to the ♭9 over the same root and 3rd
  const v = X.chillsVoicings(key, p, { range: [36, 96] });
  const sharp9 = v[11].upper.find((m) => pc(m) === pc(5 + 9 + 3));
  assert.ok(v[12].upper.includes(sharp9 - 2) || v[12].upper.some((m) => pc(m) === pc(5 + 9 + 1)), `${v[11].upper} ${v[12].upper}`);
});

test('two minor chords, then a major home: iv–i four times, home major the last time, played once', () => {
  const p = prog('minorHome');
  assert.ok(X.playsOnce(p));
  for (const mode of ['major', 'minor']) {
    const key = keyOf(11, mode);
    const ch = X.chillsChords(key, p);
    assert.equal(ch.length, 8);
    ch.slice(0, 7).forEach((c, i) => assert.deepEqual([c.semis, c.quality], i % 2 ? [0, 'min'] : [5, 'min']));
    assert.deepEqual([ch[7].semis, ch[7].quality], [0, 'maj']);
    const v = X.chillsVoicings(key, p, { range: [36, 96] });
    // The home minor 11th over its root: the 3rd, 5th, 7th, 9th and 11th above (D F♯ A C♯ E over B)
    assert.deepEqual(v[1].upper.map((m) => pc(m - 11)).sort((a, b) => a - b), [2, 3, 5, 7, 10]);
    // The last chord bright: the major 3rd and the 6th
    assert.ok(v[7].upper.some((m) => pc(m - 11) === 4) && v[7].upper.some((m) => pc(m - 11) === 9));
  }
  assert.equal(X.chillsFill(keyOf(11, 'minor'), p, 1, 33, FOUR, id, { range: [36, 96] }).filter((n) => n.startOffset === 0).length > 0, true);
  assert.equal(X.chillsSpans(1, 33, 8, FOUR, true).length, 8);
});

test('a rich chord is no louder than the plain one: its added notes softer', () => {
  for (const p of X.CHILLS)
    for (const mode of ['major', 'minor']) {
      const key = keyOf(2, mode);
      const spans = X.chillsChords(key, p).map((_, i) => ({ start: i, length: 1 }));
      const plain = X.chillsNotes(key, p, spans, id, { range: [36, 96], voicing: 'plain' });
      const rich = X.chillsNotes(key, p, spans, id, { range: [36, 96], voicing: 'rich' });
      const power = (notes, t) => notes.filter((x) => x.startOffset === t).reduce((s, x) => s + x.velocity ** 2, 0);
      for (const s of spans) {
        const db = 10 * Math.log10(power(rich, s.start) / power(plain, s.start));
        assert.ok(db <= 1.5, `${p.id} ${key.name} at ${s.start}: ${db.toFixed(2)} dB`);
      }
    }
});

test('rich chords that open out: each wider than the last', () => {
  for (const mode of ['major', 'minor'])
    for (let root = 0; root < 12; root++) {
      const v = X.chillsVoicings(keyOf(root, mode), prog('widening'), { range: [36, 96], voicing: 'rich' });
      const span = v.map((c) => Math.max(...sounding(c)) - Math.min(...sounding(c)));
      for (let i = 1; i < span.length; i++) assert.ok(span[i] > span[i - 1], `${root} ${mode}: ${span}`);
    }
});

test('plain or rich is offered in the studio dialog, the piano roll and Pocket, and written as chosen', () => {
  for (const file of ['src/components/timeline/SmartDialog.tsx', 'src/components/timeline/ChordRiffBar.tsx', 'src/pocket/PocketSheets.tsx']) {
    const text = src(file);
    assert.ok(text.includes('CHILLS_VOICINGS'), `${file} offers the choice`);
    assert.ok(/voicing/.test(text) && /chillsNames\([^)]*voicing/.test(text), `${file} names the chords as voiced`);
  }
  assert.ok(/makeChillsClip\([^)]*voicing/.test(src('src/components/timeline/SmartDialog.tsx')));
  assert.ok(/chillsFill\([^;]*voicing/.test(src('src/components/timeline/ChordRiffBar.tsx')));
  assert.ok(/chillsFill\([^;]*voicing/.test(src('src/pocket/PocketSheets.tsx')));
});

test('a key change keeps a chord played plain for want of room plain, and named so', () => {
  // Brass-like stabs (C3 to C6): no room for some rich chords; moved up a key, they stay plain
  for (const range of [[48, 84], [36, 64 + 12], [52, 84]])
    for (const [root, mode] of [[0, 'major'], [9, 'minor'], [2, 'minor']])
      for (const pid of ['liftStep', 'liftHalf']) {
        const key = keyOf(root, mode);
        const p = prog(pid);
        const v = X.chillsVoicings(key, p, { range, voicing: 'rich' });
        const names = X.chillsNames(key, p, 'rich', range);
        X.chillsChords(key, p).forEach((c, i) => {
          const rich = !v[i].plain;
          // A chord named rich has 4 or 5 notes over its bass; one named plain is the plain chord
          if (rich) assert.ok(v[i].upper.length >= 4, `${pid} ${key.name} ${range} ${i}: ${names[i]} = ${v[i].upper}`);
          else assert.ok(!/(maj|m)?(9|11|13)/.test(names[i]), `${pid} ${key.name} ${range} ${i}: ${names[i]} is plain`);
        });
        const notes = X.chillsNotes(key, p, X.chillsChords(key, p).map((_, i) => ({ start: i, length: 1 })), id, { range, voicing: 'rich' });
        const plainNotes = X.chillsNotes(key, p, X.chillsChords(key, p).map((_, i) => ({ start: i, length: 1 })), id, { range, voicing: 'plain' });
        // (a chord played plain plays at the plain velocities)
        v.forEach((c, i) => {
          if (!c.plain) return;
          const at = notes.filter((x) => x.startOffset === i).map((x) => x.velocity);
          const was = plainNotes.filter((x) => x.startOffset === i).map((x) => x.velocity);
          assert.ok(Math.max(...at) <= Math.max(...was) + 1e-9, `${pid} ${i}: ${at} vs ${was}`);
        });
      }
  const v = X.chillsVoicings(keyOf(0, 'major'), prog('liftStep'), { range: [48, 84], voicing: 'rich' });
  v.forEach((c, i) => {
    if (i >= 4 && i < 7) assert.equal(!!c.plain, !!v[i - 4].plain, `chord ${i} moved up keeps how chord ${i - 4} was played`);
  });
});

test('across a key change the new key is spelled to agree with the chord that leads to it', () => {
  const names = (root, mode, id) => X.chillsNames(keyOf(root, mode), prog(id), 'plain');
  assert.deepEqual(names(8, 'minor', 'liftStep').slice(3, 5), ['E♯7', 'A♯m']);
  assert.deepEqual(names(11, 'major', 'liftStep').slice(3, 5), ['G♯7', 'C♯']);
  assert.deepEqual(names(1, 'minor', 'liftStep').slice(3, 5), ['A♯7', 'D♯m']);
  assert.deepEqual(names(10, 'major', 'liftStep').slice(3, 5), ['G7', 'C']);
  // Every key: the pivot's root is a 5th over the new home, letter for letter
  const LET = 'CDEFGAB';
  for (const mode of ['major', 'minor'])
    for (let root = 0; root < 12; root++) {
      const n = names(root, mode, 'liftStep');
      assert.equal((LET.indexOf(n[3][0]) + 3) % 7, LET.indexOf(n[4][0]), `${root} ${mode}: ${n[3]} to ${n[4]}`);
    }
  // A half step up: no more than one sharp or flat on the new home, and its own name with it
  for (const mode of ['major', 'minor'])
    for (let root = 0; root < 12; root++) {
      const n = names(root, mode, 'liftHalf');
      assert.ok(/^[A-G][♭♯]?m?$/.test(n[4]), `${root} ${mode}: ${n[4]}`);
    }
});

test('key names are spelled the way the key is written, everywhere they are shown', () => {
  assert.equal(keyOf(10, 'major').name, 'B♭ major');
  assert.equal(keyOf(3, 'minor').name, 'E♭ minor');
  assert.equal(keyOf(1, 'minor').name, 'C♯ minor');
  assert.equal(keyOf(1, 'major').name, 'D♭ major');
  assert.equal(keyOf(6, 'major').name, 'F♯ major');
  for (const file of ['src/components/timeline/SmartDialog.tsx', 'src/components/timeline/ArrangeDialog.tsx']) assert.ok(!/<option key=\{n\} value=\{i\}>\{n\}<\/option>/.test(src(file)), `${file}: the key menu spells its keys`);
  assert.ok(src('src/pocket/PocketPads.tsx').includes('spellNote('));
});
