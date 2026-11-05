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
const { barToSeconds, meterAt, tempoAt, toMeasureBeat } = await import('../src/audio/tempoMap.ts');
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

// ---------- Glides across an edit ----------

// 100 BPM to bar 5, then gliding up to 180 BPM at bar 13 (the tempo row's Glide box)
const glide = () => ({ bpm: 100, tempoPoints: [{ id: 'a', bar: 5, bpm: 100, ramp: false }, { id: 'b', bar: 13, bpm: 180, ramp: true }], meter: FOUR, meterPoints: [] });
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
// Every bar before `upTo` plays when it did, at the tempo it had
function sameBefore(was, now, upTo) {
  for (let x = 1; x < upTo - 1e-3; x += 0.05) {
    assert.ok(near(barToSeconds(x, tempoMap(now)), barToSeconds(x, tempoMap(was))), `bar ${x} moved`);
    assert.ok(near(tempoAt(x, tempoMap(now)), tempoAt(x, tempoMap(was))), `bar ${x} changed tempo`);
  }
}
// `bars` bars from `at` now play as they did from `src`: the same tempo and each step the same length
function sameMusic(was, now, at, src, bars, tol = 1e-6) {
  for (let x = 0; x < bars - 0.05 - 1e-9; x += 0.05) {
    assert.ok(near(tempoAt(at + x, tempoMap(now)), tempoAt(src + x, tempoMap(was)), tol * 100), `bar ${at + x}: tempo`);
    const d = (t, b) => barToSeconds(b + 0.05, tempoMap(t)) - barToSeconds(b, tempoMap(t));
    assert.ok(near(d(now, at + x), d(was, src + x), tol), `bar ${at + x}: timing`);
  }
}

test('deleting bars from the middle of a glide leaves the bars before them as they were', () => {
  const was = glide();
  const t = rippleSongTime(was, remove(8, 10), newId);
  sameBefore(was, t, 8);
  // From bar 8 the music that was at bar 10 on, gliding on to 180 at bar 11
  sameMusic(was, t, 8, 10, 6);
  assert.deepEqual(t.tempoPoints.map((p) => [p.bar, p.ramp]), [[5, false], [7.999, true], [8, false], [11, true]]);
});

test('deleting bars right after a glide ends, or up to where one ends, keeps both sides', () => {
  // The glide ends at bar 13, where the deleted bars start
  const was = glide();
  let t = rippleSongTime(was, remove(13, 15), newId);
  sameBefore(was, t, 13);
  sameMusic(was, t, 13, 15, 4);
  // Bars 9-13 go: the glide's end lands where they started, and the music after it stays at 180
  t = rippleSongTime(was, remove(9, 13), newId);
  sameBefore(was, t, 9);
  sameMusic(was, t, 9, 13, 4);
  // From bar 1, into a glide: the song starts at the tempo it had reached, and glides on from there
  const fromStart = { bpm: 100, tempoPoints: [{ id: 'b', bar: 9, bpm: 160, ramp: true }], meter: FOUR, meterPoints: [] };
  t = rippleSongTime(fromStart, remove(1, 3), newId);
  assert.equal(t.bpm, Math.round(tempoAt(3, tempoMap(fromStart)) * 100) / 100);
  sameMusic(fromStart, t, 1, 3, 8, 1e-4);
});

test('inserting bars in the middle of a glide leaves the bars before as they were and moves the rest whole', () => {
  const was = glide();
  const t = rippleSongTime(was, { kind: 'insert', at: 9, bars: 4 }, newId);
  sameBefore(was, t, 9);
  sameMusic(was, t, 13, 9, 6);
  // At bar 1, a glide that starts there starts again after the inserted bars
  const fromStart = { bpm: 100, tempoPoints: [{ id: 'b', bar: 9, bpm: 160, ramp: true }], meter: FOUR, meterPoints: [] };
  const u = rippleSongTime(fromStart, { kind: 'insert', at: 1, bars: 2 }, newId);
  sameMusic(fromStart, u, 3, 1, 10);
});

test('moving or copying a section under a glide leaves the bars before it as they were', () => {
  // Gliding from 100 at bar 1 to 160 at bar 9; sections at 1, 5, 9 and 13
  const was = { bpm: 100, tempoPoints: [{ id: 'b', bar: 9, bpm: 160, ramp: true }], meter: FOUR, meterPoints: [] };
  // Play it twice on section 5-9: the copy at 9 plays as bars 5-9 did, and what was at 9 follows at 13
  let t = placeSongTime(was, 9, [{ src: 5, len: 4 }], 9, newId);
  sameBefore(was, t, 9);
  sameMusic(was, t, 9, 5, 4);
  sameMusic(was, t, 13, 9, 4);
  // The last two sections swapped (the glide ends where the first of them starts)
  t = placeSongTime(was, 9, [{ src: 13, len: 4 }, { src: 9, len: 4 }], 17, newId);
  sameBefore(was, t, 9);
  sameMusic(was, t, 9, 13, 4);
  sameMusic(was, t, 13, 9, 4);
  // Sections 5-9 and 9-13 swapped: the glide is under way where they start
  t = placeSongTime(was, 5, [{ src: 9, len: 4 }, { src: 5, len: 4 }], 13, newId);
  sameBefore(was, t, 5);
  sameMusic(was, t, 5, 9, 4);
  sameMusic(was, t, 9, 5, 4);
  sameMusic(was, t, 13, 13, 4);
});

test('any song with glides: an insert, a delete or two stretches swapped re-time nothing that did not move', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 400; k++) {
    const points = [];
    for (let i = 0; i < 1 + Math.floor(rnd() * 4); i++) points.push({ id: `t${i}`, bar: 1.25 + Math.round(rnd() * 64) / 4, bpm: 60 + Math.round(rnd() * 120), ramp: rnd() < 0.5 });
    points.sort((a, b) => a.bar - b.bar);
    const was = { bpm: 100, tempoPoints: points.filter((p, i) => i === 0 || p.bar - points[i - 1].bar > 1e-6), meter: FOUR, meterPoints: [] };
    const at = 1.25 + Math.round(rnd() * 64) / 4;
    const bars = 0.25 + Math.round(rnd() * 16) / 4;
    let t = rippleSongTime(was, { kind: 'insert', at, bars }, newId);
    sameBefore(was, t, at);
    sameMusic(was, t, at + bars, at, 12);
    const from = 1.25 + Math.round(rnd() * 48) / 4;
    t = rippleSongTime(was, remove(from, from + bars), newId);
    sameBefore(was, t, from);
    sameMusic(was, t, from, from + bars, 12);
    const a = 2 + Math.floor(rnd() * 12);
    const l1 = 1 + Math.floor(rnd() * 5);
    const l2 = 1 + Math.floor(rnd() * 5);
    t = placeSongTime(was, a, [{ src: a + l1, len: l2 }, { src: a, len: l1 }], a + l1 + l2, newId);
    sameBefore(was, t, a);
    sameMusic(was, t, a, a + l1, l2 - 1e-3);
    sameMusic(was, t, a + l2, a, l1 - 1e-3);
    sameMusic(was, t, a + l1 + l2, a + l1 + l2, 8);
  }
});

test('without glides the tempo after an edit is as it always was', () => {
  const plain = { bpm: 100, tempoPoints: [{ id: 'a', bar: 5, bpm: 140, ramp: false }, { id: 'b', bar: 9, bpm: 90, ramp: false }], meter: FOUR, meterPoints: [] };
  assert.deepEqual(rippleSongTime(plain, { kind: 'insert', at: 7, bars: 2 }, newId).tempoPoints, [plain.tempoPoints[0], { ...plain.tempoPoints[1], bar: 11 }]);
  assert.deepEqual(view(rippleSongTime(plain, remove(4, 6), newId)), { meter: '4/4', meters: [], bpm: 100, tempos: ['4:140', '7:90'] });
  assert.deepEqual(view(placeSongTime(plain, 5, [{ src: 9, len: 2 }, { src: 5, len: 4 }], 11, newId)), { meter: '4/4', meters: [], bpm: 100, tempos: ['5:90', '7:140', '11:90'] });
});

test('Song form lays the loop\'s tempo and time signature changes into every section, counting measures', () => {
  const arrange = src('src/store/arrangeActions.ts');
  const form = arrange.slice(arrange.indexOf('export function layOutSong('), arrange.indexOf('// ---------- Producer tag'));
  assert.match(form, /measuresFrom\(from, loopBars, map\)/);
  assert.match(form, /measuresBetween\(from, to, map\)/);
  assert.match(form, /out\.push\(\{ src: from, len: Math\.min\(loopLen, sec\.bars - k \* loopLen\) \}\)/);
  assert.match(form, /laySongTime\(\{ bpm, tempoPoints, meter, meterPoints \}, from, pieces, to\)/);
  // A 4-measure loop of two 4/4 measures and two 6/8 (3.5 bars), laid out as two sections of 4 and
  // 6 measures: each starts with the loop's own changes, and the song after it is in 6/8 again
  const loop = { bpm: 100, tempoPoints: [{ id: 't', bar: 3, bpm: 140, ramp: false }], meter: FOUR, meterPoints: [{ id: 'm', bar: 3, num: 6, den: 8 }] };
  const t = placeSongTime(loop, 1, [{ src: 1, len: 3.5 }, { src: 1, len: 3.5 }, { src: 1, len: 2 }], 4.5, newId);
  assert.deepEqual(view(t), { meter: '4/4', meters: ['3:6/8', '4.5:4/4', '6.5:6/8', '8:4/4', '10:6/8'], bpm: 100, tempos: ['3:140', '4.5:100', '6.5:140', '8:100', '10:140'] });
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
