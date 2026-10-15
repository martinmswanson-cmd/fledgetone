// Unit tests for the producer arrangement tools: the dark melody generator (src/store/darkMelody.ts),
// drop-outs, stops and beat switches (beatSwitch.ts), song form (songForm.ts) and the producer
// tag's maths (producerTag.ts). Run with `npm test`.
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
const { darkMelody, DARK_STYLES, hasFlatSecond, registerRoot, darkKeyFor } = await import('../src/store/darkMelody.ts');
const { cutGap, stopSpan, halfTime, doubleTime, bassOnKicks, kicksOf, switchedNotes, trackRole } = await import('../src/store/beatSwitch.ts');
const { planSongForm, defaultLengths, repeatLoop, thinDrums, treatPart, SECTION_RECIPES, preHookDrop } = await import('../src/store/songForm.ts');
const { tagBars, trimSilence, fadeEdges, parseTag } = await import('../src/store/producerTag.ts');
const { durationToBars, barsToDuration } = await import('../src/store/timelineTypes.ts');
const { midiOf } = await import('../src/store/noteTools.ts');
const { SCALES } = await import('../src/store/noteTools.ts');
const { keyOf } = await import('../src/store/songKey.ts');

let n = 0;
const id = () => `n${n++}`;
const note = (name, at, len = 1 / 16, velocity = 0.8) => ({ id: id(), note: name, startOffset: at, duration: barsToDuration(len), velocity });
const hit = (name, at) => ({ id: id(), note: name, startOffset: at, duration: '16n', velocity: 0.9 });
const opts = (o = {}) => ({ style: 'trap', scale: 'minor', root: 9, bars: 2, density: 0.5, register: 'mid', seed: 1, ...o });
const end = (x) => x.startOffset + durationToBars(x.duration);
const pc = (name) => ((midiOf(name) % 12) + 12) % 12;

test('dark melody: the same seed gives the same melody, another seed another', () => {
  for (const style of ['trap', 'drill', 'rage', 'phonk']) {
    const a = darkMelody(opts({ style, seed: 7 }), id).map((x) => [x.note, x.startOffset, x.duration, x.velocity]);
    const b = darkMelody(opts({ style, seed: 7 }), id).map((x) => [x.note, x.startOffset, x.duration, x.velocity]);
    const c = darkMelody(opts({ style, seed: 8 }), id).map((x) => [x.note, x.startOffset, x.duration, x.velocity]);
    assert.deepEqual(a, b, style);
    assert.notDeepEqual(a, c, style);
  }
});

test('dark melody: in the scale (plus the flat second), inside the loop, and always with the flat second', () => {
  for (const style of ['trap', 'drill', 'rage', 'phonk'])
    for (const scale of ['minor', 'harmonicMinor', 'phrygian'])
      for (const bars of [1, 2, 4])
        for (let seed = 1; seed <= 12; seed++) {
          const root = seed % 12;
          const notes = darkMelody(opts({ style, scale, bars, seed, root }), id);
          assert.ok(notes.length >= 2, `${style} ${bars} ${seed}`);
          const allowed = new Set([...SCALES[scale].steps.map((s) => (s + root) % 12), (root + 1) % 12]);
          for (const x of notes) {
            assert.ok(allowed.has(pc(x.note)), `${style} ${scale} ${x.note} not in key`);
            assert.ok(x.startOffset >= 0 && x.startOffset < bars, 'starts inside the loop');
            assert.ok(end(x) <= bars + 1e-6, `${style} ${bars} note rings past the loop's end`);
          }
          assert.ok(hasFlatSecond(notes, root), `${style} ${scale} ${bars} seed ${seed}: no flat second`);
        }
});

test('dark melody: the motif repeats and the ending changes', () => {
  let changed = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const notes = darkMelody(opts({ bars: 4, seed, style: 'trap' }), id);
    const bar = (b) => notes.filter((x) => x.startOffset >= b - 1e-6 && x.startOffset < b + 1 - 1e-6).map((x) => [x.note, +(x.startOffset - b).toFixed(4)]);
    // A A' A A'': bars 1 and 3 are the same motif; bar 2 starts like it
    assert.deepEqual(bar(0), bar(2), `seed ${seed}`);
    const firstHalf = (b) => bar(b).filter(([, at]) => at < 0.5 - 1e-6);
    assert.deepEqual(firstHalf(1), firstHalf(0), `seed ${seed}: the answer starts like the motif`);
    if (JSON.stringify(bar(3)) !== JSON.stringify(bar(0))) changed++;
    // The last ending comes home to the root (or its octave below)
    const last = notes[notes.length - 1];
    assert.equal(pc(last.note), 9, `seed ${seed}: ends on the root`);
  }
  assert.equal(changed, 20, 'every last ending differs from the motif');
});

test('dark melody: density adds notes, sparse leaves space, register moves it', () => {
  const count = (density, style) => {
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) total += darkMelody(opts({ density, style, bars: 4, seed }), id).length;
    return total / 30;
  };
  for (const style of ['trap', 'drill', 'rage', 'phonk']) assert.ok(count(0.9, style) > count(0.1, style) + 2, style);
  // Sparse trap: well under half the 16ths, and a rest of an 8th or more in every bar
  for (let seed = 1; seed <= 20; seed++) {
    const notes = darkMelody(opts({ density: 0.2, bars: 4, seed }), id);
    assert.ok(notes.length <= 4 * 7, `seed ${seed}: ${notes.length} notes`);
    for (let b = 0; b < 4; b++) {
      const starts = notes.filter((x) => Math.floor(x.startOffset + 1e-9) === b).map((x) => x.startOffset);
      const gaps = starts.map((s, i) => (starts[i + 1] ?? b + 1) - s);
      assert.ok(Math.max(...gaps) >= 0.125 - 1e-6, `seed ${seed} bar ${b}: no space`);
    }
  }
  const mean = (register) => {
    const all = Array.from({ length: 10 }, (_, s) => darkMelody(opts({ register, seed: s + 1 }), id)).flat();
    return all.reduce((a, x) => a + midiOf(x.note), 0) / all.length;
  };
  assert.ok(mean('low') + 8 < mean('mid') && mean('mid') + 8 < mean('high'));
  assert.equal(registerRoot(9, 'mid') % 12, 9);
});

test('dark melody: rhythms are on the 16th grid (drill adds 8th-note triplets)', () => {
  let triplets = 0;
  for (const style of ['trap', 'drill', 'rage', 'phonk'])
    for (let seed = 1; seed <= 15; seed++)
      for (const x of darkMelody(opts({ style, seed, bars: 4 }), id)) {
        const on16 = Math.abs(x.startOffset * 16 - Math.round(x.startOffset * 16)) < 1e-6;
        const on12 = Math.abs(x.startOffset * 12 - Math.round(x.startOffset * 12)) < 1e-3;
        if (style !== 'drill') assert.ok(on16, `${style} ${x.startOffset}`);
        else {
          assert.ok(on16 || on12);
          if (!on16) triplets++;
        }
      }
  assert.ok(triplets > 0, 'some drill melodies have triplet runs');
});

test('dark melody: defaults to the song key, a major key to its relative minor', () => {
  assert.equal(darkKeyFor(keyOf(7, 'minor')).root, 7);
  assert.equal(darkKeyFor(keyOf(0, 'major')).root, 9);
  assert.equal(darkKeyFor(null).root, 0);
  assert.ok(DARK_STYLES.every((s) => ['minor', 'harmonicMinor', 'phrygian'].includes(s.scale)));
});

test('cutGap: notes in the gap go, notes ringing into it end at it', () => {
  const notes = [note('C2', 0, 1), hit('C1', 0.5), hit('C1', 0.75), hit('C1', 0.9375)];
  const out = cutGap(notes, 0.75, 1);
  assert.equal(out.length, 2);
  assert.equal(out[0].note, 'C2');
  assert.ok(Math.abs(end(out[0]) - 0.75) < 1e-6, 'the long note stops where the gap starts');
  assert.equal(out[1].startOffset, 0.5);
  // A note that would be left shorter than a 64th is dropped (a click, not a note)
  assert.equal(cutGap([note('C2', 0.74, 0.25)], 0.75, 1).length, 0);
  assert.deepEqual(stopSpan(4, 1), [4.75, 5]);
  assert.deepEqual(stopSpan(4, 0.5), [4.875, 5]);
});

test('half time and double time keep the section length', () => {
  const drums = [hit('C1', 0), hit('D1', 0.25), hit('C1', 0.5), hit('D1', 0.75), hit('C1', 1), hit('D1', 1.25)];
  const half = halfTime(drums, 2, id, true);
  assert.deepEqual(half.map((x) => [x.note, x.startOffset]), [['C1', 0], ['D1', 0.5], ['C1', 1], ['D1', 1.5]]);
  assert.ok(half.every((x) => x.duration === '16n'), 'drum hits keep their length');
  const dbl = doubleTime(drums, 2, id, true);
  assert.equal(dbl.length, 12);
  assert.ok(dbl.every((x) => x.startOffset < 2));
  assert.deepEqual(dbl.slice(0, 3).map((x) => x.startOffset), [0, 0.125, 0.25]);
  const bass = [note('A1', 0, 1)];
  assert.ok(Math.abs(durationToBars(halfTime(bass, 2, id)[0].duration) - 2) < 1e-6, 'bass notes stretch');
  assert.ok(Math.abs(durationToBars(doubleTime(bass, 2, id)[0].duration) - 0.5) < 1e-6);
});

test('a new pattern: the bass follows the new kicks at the old pitches', () => {
  const bass = [note('A1', 0, 0.5), note('F1', 0.5, 0.5)];
  const kicks = kicksOf([hit('C1', 0), hit('F#1', 0.125), hit('C1', 0.375), hit('C1', 0.625)]);
  assert.deepEqual(kicks, [0, 0.375, 0.625]);
  const out = bassOnKicks(bass, kicks, 1, id);
  assert.deepEqual(out.map((x) => [x.note, x.startOffset]), [['A1', 0], ['A1', 0.375], ['F1', 0.625]]);
  assert.ok(Math.abs(end(out[2]) - 1) < 1e-6, 'the last one holds to the section end');
  const melody = [note('A4', 0, 0.25)];
  assert.deepEqual(switchedNotes('melody', melody, 1, 'half', id).map((x) => [x.note, x.startOffset]), [['A4', 0]], 'the melody stays');
});

test('track roles from the instrument', () => {
  assert.equal(trackRole({ instrumentKey: 'drumMachine' }), 'drums');
  assert.equal(trackRole({ instrumentKey: 'bass808' }), 'bass');
  assert.equal(trackRole({ instrumentKey: 'piano' }), 'melody');
  assert.equal(trackRole({ instrumentKey: 'fx' }), 'fx');
  assert.equal(trackRole({ instrumentKey: 'audio' }), 'audio');
  assert.equal(trackRole({ instrumentKey: 'bus' }), 'mix');
});

test('song form: the sections in order, numbered, end to end', () => {
  const plan = planSongForm(defaultLengths(4));
  assert.deepEqual(plan.map((s) => s.name), ['Intro', 'Hook 1', 'Verse 1', 'Hook 2', 'Verse 2', 'Bridge', 'Hook 3', 'Outro']);
  assert.deepEqual(plan.map((s) => s.at), [0, 4, 12, 28, 36, 52, 60, 68]);
  const short = planSongForm({ intro: 0, hook: 8, verse: 8, bridge: 0, outro: 4 });
  assert.deepEqual(short.map((s) => s.name), ['Hook 1', 'Verse 1', 'Hook 2', 'Verse 2', 'Hook 3', 'Outro']);
});

test('song form: the loop repeats to fill a section, parts in and out by section', () => {
  const loop = [hit('C1', 0), hit('F#1', 0.125), hit('F#1', 0.1875), hit('A#1', 0.375), hit('D1', 0.5), note('A1', 3.5, 1)];
  const rep = repeatLoop(loop, 4, 8, id);
  assert.equal(rep.length, 12);
  assert.ok(rep.every((x) => end(x) <= 8 + 1e-6));
  // The 808 at 3.5 that rang past the loop's end is cut at it
  assert.ok(Math.abs(end(rep.find((x) => x.note === 'A1')) - 4) < 1e-6);
  const thin = thinDrums(rep);
  assert.ok(!thin.some((x) => x.note === 'A#1'), 'no open hats in a verse');
  assert.ok(thin.filter((x) => x.note === 'F#1').every((x) => Math.abs(x.startOffset * 8 - Math.round(x.startOffset * 8)) < 1e-6), 'hats on 8ths only');
  assert.equal(treatPart(loop, 'drums', SECTION_RECIPES.intro.drums), null, 'no drums in the intro');
  assert.equal(treatPart(loop, 'bass', SECTION_RECIPES.intro.bass), null, 'no bass in the intro');
  assert.ok(treatPart(loop, 'melody', SECTION_RECIPES.outro.melody));
  assert.deepEqual(treatPart(loop, 'drums', SECTION_RECIPES.bridge.drums).map((x) => x.note), ['C1']);
  assert.ok(treatPart([note('A4', 0)], 'melody', 'soft')[0].velocity < 0.8);
  const dropped = preHookDrop(rep, 8);
  assert.ok(!dropped.some((x) => x.startOffset >= 7.5), 'the drums drop out before the hook');
});

test('producer tag: where it goes, trimming and the remembered tag', () => {
  assert.deepEqual(tagBars(1, 33, 0, 0.5), [1]);
  assert.deepEqual(tagBars(1, 33, 8, 0.5), [1, 9, 17, 25]);
  assert.deepEqual(tagBars(1, 3, 8, 0.5), [1]);
  const rate = 1000;
  const c = new Float32Array(3000);
  for (let i = 1000; i < 1500; i++) c[i] = 0.5 * Math.sin(i);
  const [a, b] = trimSilence([c], rate);
  assert.ok(a < 1000 && a >= 960 && b > 1500 && b <= 1630, `${a} ${b}`);
  assert.deepEqual(trimSilence([new Float32Array(100)], rate), [0, 0]);
  const ones = [new Float32Array(100).fill(1)];
  fadeEdges(ones, 1000);
  assert.equal(ones[0][0], 0);
  assert.equal(ones[0][50], 1);
  assert.equal(parseTag(null), null);
  assert.equal(parseTag('{bad'), null);
  assert.equal(parseTag('{"soundId":"x","seconds":0}'), null);
  assert.deepEqual(parseTag('{"soundId":"x","seconds":1.5,"name":"  "}'), { soundId: 'x', name: 'Tag', seconds: 1.5 });
});
