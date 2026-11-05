// Time signature and tempo changes through the arranging edits (src/store/rippleMeters.ts): deleting
// bars keeps the meter and tempo the music after them had, inserting moves the changes with the
// music, and a stretch laid out anew (Pocket's Move and Play it twice, the Beat switch) takes its
// own with it. And the Showcase video's bar lines and the rhythm game's beats count the song's
// measures, not 4-beat bars (src/store/showcase.ts, rhythmChart.ts). In 4/4 everything is as it
// always was. Run with `npm test`.
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
const { rippleSongTime, placeSongTime } = await import('../src/store/rippleMeters.ts');
const { meterAt, tempoAt, toMeasureBeat } = await import('../src/audio/tempoMap.ts');
const { showcaseData } = await import('../src/store/showcase.ts');
const { buildChart } = await import('../src/store/rhythmChart.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
let n = 0;
const newId = (kind) => `${kind}${++n}`;
const FOUR = { num: 4, den: 4 };
const THREE = { num: 3, den: 4 };
// 100 BPM in 4/4, turning 140 BPM in 3/4 at bar 3
const song = () => ({ bpm: 100, tempoPoints: [{ id: 'tp', bar: 3, bpm: 140, ramp: false }], meter: FOUR, meterPoints: [{ id: 'mp', bar: 3, ...THREE }] });
const remove = (from, to) => ({ kind: 'remove', from, to, minLoop: 0.25 });
const view = (t) => ({ meter: `${t.meter.num}/${t.meter.den}`, meters: t.meterPoints.map((p) => `${p.bar}:${p.num}/${p.den}`), bpm: t.bpm, tempos: t.tempoPoints.map((p) => `${p.bar}:${p.bpm}`) });
const meterMap = (t) => ({ base: t.meter, points: t.meterPoints });
const tempoMap = (t) => ({ bpm: t.bpm, points: t.tempoPoints });

test('deleting bars from bar 1 up to a change: the change becomes the song\'s own meter and tempo', () => {
  assert.deepEqual(view(rippleSongTime(song(), remove(1, 3), newId)), { meter: '3/4', meters: [], bpm: 140, tempos: [] });
});

test('deleting bars from bar 1 that hold a change: the song starts in the meter and tempo after them', () => {
  // (bars 1 to 3.75: the change at 3 is inside, one 3/4 measure goes with it)
  assert.deepEqual(view(rippleSongTime(song(), remove(1, 3.75), newId)), { meter: '3/4', meters: [], bpm: 140, tempos: [] });
});

test('deleting bars after bar 1 that hold a change: one is put back where they were taken out', () => {
  const t = rippleSongTime(song(), remove(2, 4), newId);
  assert.deepEqual(view(t), { meter: '4/4', meters: ['2:3/4'], bpm: 100, tempos: ['2:140'] });
  // A change at the end of the deleted bars just moves up to where they started
  assert.deepEqual(view(rippleSongTime(song(), remove(2, 3), newId)), { meter: '4/4', meters: ['2:3/4'], bpm: 100, tempos: ['2:140'] });
});

test('deleting bars that hold no change moves the later changes up and adds nothing', () => {
  assert.deepEqual(view(rippleSongTime(song(), remove(1, 2), newId)), { meter: '4/4', meters: ['2:3/4'], bpm: 100, tempos: ['2:140'] });
  // A change and back again inside the deleted bars: the music after is as it was, nothing put back
  const there = { bpm: 100, tempoPoints: [{ id: 'a', bar: 3, bpm: 140, ramp: false }, { id: 'b', bar: 4, bpm: 100, ramp: false }], meter: FOUR, meterPoints: [{ id: 'c', bar: 3, ...THREE }, { id: 'd', bar: 3.75, ...FOUR }] };
  assert.deepEqual(view(rippleSongTime(there, remove(2, 5), newId)), { meter: '4/4', meters: [], bpm: 100, tempos: [] });
});

test('inserting bars moves the changes at and after the insert point with the music', () => {
  assert.deepEqual(view(rippleSongTime(song(), { kind: 'insert', at: 3, bars: 2 }, newId)), { meter: '4/4', meters: ['5:3/4'], bpm: 100, tempos: ['5:140'] });
  assert.deepEqual(view(rippleSongTime(song(), { kind: 'insert', at: 1, bars: 1 }, newId)), { meter: '4/4', meters: ['4:3/4'], bpm: 100, tempos: ['4:140'] });
});

test('in 4/4 with no changes, an insert or delete leaves the tempo and meter as they were (the same objects)', () => {
  const plain = { bpm: 122, tempoPoints: [], meter: FOUR, meterPoints: [] };
  for (const edit of [remove(1, 3), remove(2, 4), { kind: 'insert', at: 1, bars: 2 }]) {
    const t = rippleSongTime(plain, edit, newId);
    assert.equal(t.bpm, 122);
    assert.equal(t.meter, plain.meter);
    assert.equal(t.meterPoints, plain.meterPoints);
    assert.equal(t.tempoPoints, plain.tempoPoints);
  }
  assert.equal(placeSongTime(plain, 1, [{ src: 3, len: 2 }, { src: 1, len: 2 }], 5, newId), null);
});

// Pocket's waltz: Verse 1-3 (120, 4/4), Waltz 3-6 (90, 3/4), Out 6-8 (120, 4/4)
const waltz = () => ({
  bpm: 120,
  tempoPoints: [{ id: 'tp', bar: 3, bpm: 90, ramp: false }, { id: 'tq', bar: 6, bpm: 120, ramp: false }],
  meter: FOUR,
  meterPoints: [{ id: 'mp', bar: 3, ...THREE }, { id: 'mq', bar: 6, ...FOUR }],
});

test('moving a section earlier: it keeps its meter and tempo, and the one it swapped with keeps its own', () => {
  // The Waltz to the start (moveSection(1, -1)): Waltz 1-4, Verse 4-6, Out 6-8
  const t = placeSongTime(waltz(), 1, [{ src: 3, len: 3 }, { src: 1, len: 2 }], 6, newId);
  assert.deepEqual(view(t), { meter: '3/4', meters: ['4:4/4'], bpm: 90, tempos: ['4:120'] });
  for (const bar of [1, 2.5, 3.25]) assert.deepEqual(meterAt(bar, meterMap(t)), THREE, `${bar}`);
  assert.equal(tempoAt(5, tempoMap(t)), 120);
  // The waltz's four measures each start on a downbeat
  assert.deepEqual([1, 1.75, 2.5, 3.25].map((b) => toMeasureBeat(b, meterMap(t))).map((m) => `m${m.measure}b${m.beat}`), ['m1b1', 'm2b1', 'm3b1', 'm4b1']);
});

test('moving the last section earlier: what follows the two keeps the meter and tempo it had', () => {
  // Out before the Waltz (moveSection(2, -1)): Verse 1-3, Out 3-5, Waltz 5-8, and 4/4 at 120 again after
  const t = placeSongTime(waltz(), 3, [{ src: 6, len: 2 }, { src: 3, len: 3 }], 8, newId);
  assert.deepEqual(view(t), { meter: '4/4', meters: ['5:3/4', '8:4/4'], bpm: 120, tempos: ['5:90', '8:120'] });
});

test('a section copied after itself has its own meter and tempo changes in the copy too', () => {
  // A section 3-6.25: a 4/4 measure, then three of 3/4 at 90 BPM from bar 4; 4/4 at 120 again after it
  const inside = { bpm: 120, tempoPoints: [{ id: 'a', bar: 4, bpm: 90, ramp: false }, { id: 'b', bar: 6.25, bpm: 120, ramp: false }], meter: FOUR, meterPoints: [{ id: 'c', bar: 4, ...THREE }, { id: 'd', bar: 6.25, ...FOUR }] };
  // Copied after itself: 3-6.25 again at 6.25-9.5, the rest from 9.5
  const t = placeSongTime(inside, 6.25, [{ src: 3, len: 3.25 }], 6.25, newId);
  assert.deepEqual(view(t), { meter: '4/4', meters: ['4:3/4', '6.25:4/4', '7.25:3/4', '9.5:4/4'], bpm: 120, tempos: ['4:90', '6.25:120', '7.25:90', '9.5:120'] });
});

test('the store and Pocket use the rules: deleting, moving and copying, each one undo step', () => {
  const store = src('src/store/timelineStore.ts');
  const ripple = store.slice(store.indexOf('const applyRipple = ('), store.indexOf('const insertTime = ('));
  assert.match(ripple, /rippleSongTime\(s, edit,/);
  assert.match(ripple, /bpmChanged \? \{ bpm: time\.bpm \}/);
  assert.match(ripple, /baseMeterChanged \? \{ meter: time\.meter \}/);
  const pocket = src('src/pocket/pocketSections.ts');
  assert.match(pocket, /laySongTime\(was, a\.from, \[\{ src: b\.from, len: lenB \}, \{ src: a\.from, len: a\.to - a\.from \}\], b\.to\)/);
  assert.match(pocket, /laySongTime\(was, sec\.to, \[\{ src: sec\.from, len \}\], sec\.to\)/);
  assert.match(src('src/store/arrangeActions.ts'), /laySongTime\(\{ bpm, tempoPoints, meter, meterPoints \}, b, \[\{ src: a, len \}\], b\)/);
});

// ---------- Showcase bar lines and the rhythm chart ----------

const track = (id, instrumentKey) => ({ id, name: id, color: '#fff', instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0 });
// 8 measures with a kick on each downbeat and a snare on every other beat (a beat being 1/den), at 120 BPM
function hits(num, den) {
  const len = num / den;
  const notes = [];
  for (let m = 0; m < 8; m++) for (let b = 0; b < num; b++) notes.push({ id: `n${m}_${b}`, note: b === 0 ? 'C1' : 'D1', startOffset: m * len + b / den, duration: '16n', velocity: 0.8 });
  return { len: 8 * len, clips: [{ id: 'c', trackId: 't', name: 'D', startBar: 1, lengthBars: 8 * len, notes, isSelected: false }] };
}
const toSeconds = (bar) => (bar - 1) * 2;
const at = (seconds, map) => {
  const mb = toMeasureBeat(1 + seconds / 2, map);
  return `m${mb.measure}b${mb.beat}`;
};
const pairsOf = (chart) => {
  const count = {};
  for (const c of chart) count[c.time] = (count[c.time] ?? 0) + 1;
  return Object.keys(count).filter((t) => count[t] > 1).map(Number).sort((a, b) => a - b);
};

for (const [num, den] of [[3, 4], [6, 8]]) {
  test(`in ${num}/${den} the Showcase's bar lines and the Hard chart's pairs fall on each measure's downbeat`, () => {
    const map = { base: { num, den }, points: [] };
    const { len, clips } = hits(num, den);
    const data = showcaseData([track('t', 'drums')], clips, 1, 1 + len, toSeconds, map);
    const downbeats = [...Array(9).keys()].map((m) => `m${m + 1}b1`);
    assert.deepEqual(data.bars.map((t) => at(t, map)), downbeats);
    assert.deepEqual(data.beats, Array(9).fill(num));
    assert.deepEqual(pairsOf(buildChart(data, 'hard')).map((t) => at(t, map)), downbeats.slice(0, 8));
  });
}

test('a song that changes meter has its bar lines where its measures start', () => {
  // 4/4 for two measures, then 3/4
  const map = { base: FOUR, points: [{ id: 'm', bar: 3, ...THREE }] };
  const data = showcaseData([track('t', 'drums')], [], 1, 5, toSeconds, map);
  assert.deepEqual(data.bars, [1, 2, 3, 3.75, 4.5].map(toSeconds));
  assert.deepEqual(data.beats, [4, 4, 3, 3, 3]);
});

test('in 4/4 the Showcase data and every chart are exactly as before', () => {
  const map = { base: FOUR, points: [] };
  const { len, clips } = hits(4, 4);
  const before = showcaseData([track('t', 'drums')], clips, 1, 1 + len, toSeconds);
  const after = showcaseData([track('t', 'drums')], clips, 1, 1 + len, toSeconds, map);
  assert.deepEqual(after, before);
  assert.equal('beats' in after, false);
  assert.deepEqual(after.bars, [0, 2, 4, 6, 8, 10, 12, 14, 16]);
  for (const d of ['easy', 'normal', 'hard']) assert.deepEqual(buildChart(after, d), buildChart(before, d), d);
  assert.deepEqual(pairsOf(buildChart(after, 'hard')), [0, 2, 4, 6, 8, 10, 12, 14]);
  // The try-out and the export hand it the song's meter
  assert.match(src('src/components/game/RhythmTryOut.tsx'), /barToSeconds\(bar, tempo\), songMeterOf\(s\)\)/);
  assert.match(src('src/components/timeline/ExportDialog.tsx'), /barToSeconds\(bar, tempo\), opts\.meter\)/);
});
