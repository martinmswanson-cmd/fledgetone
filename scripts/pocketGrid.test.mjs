// Pocket's note maths (src/pocket/pocketGrid.ts): steps per bar, a note's length in steps, the
// rows of the key, notes matched by pitch whatever their spelling, and a section jump waiting for
// the bar line. Run with `npm test`.
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
const { stepsPerBar, scaleRows, noteToMidi, midiToNote, noteSteps, toRoll, fromRoll, sectionJump, jumpStep, sectionPlace, sectionChordPlan, rollRulerMarks, takePlace, rollLengths } = await import('../src/pocket/pocketGrid.ts');
const { measureStart } = await import('../src/audio/tempoMap.ts');
const { keyOf } = await import('../src/store/songKey.ts');

test('a bar has 16 steps in 4/4 and 12 in 6/8 and 3/4', () => {
  assert.equal(stepsPerBar({ num: 4, den: 4 }), 16);
  assert.equal(stepsPerBar({ num: 6, den: 8 }), 12);
  assert.equal(stepsPerBar({ num: 3, den: 4 }), 12);
});

test('a note covers as many 16ths as it lasts (at least one)', () => {
  assert.equal(noteSteps({ duration: '4n' }, 16), 4);
  assert.equal(noteSteps({ duration: '1m' }, 16), 16);
  assert.equal(noteSteps({ duration: '32n' }, 16), 1);
});

test('notes match by pitch, whatever their spelling', () => {
  assert.equal(noteToMidi('A#3'), noteToMidi('Bb3'));
  assert.equal(midiToNote(60), 'C4');
  assert.equal(midiToNote(noteToMidi('Db2')), 'C#2');
});

test("the note grid has only the key's notes, two octaves, high to low, in range", () => {
  const rows = scaleRows(keyOf(9, 'minor'), [21, 108], 60);
  assert.equal(rows.length, 15);
  assert.equal(rows[rows.length - 1].replace(/\d+$/, ''), 'A');
  assert.ok(rows.every((r) => ['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(r.replace(/\d+$/, ''))));
  assert.ok(noteToMidi(rows[0]) > noteToMidi(rows[1]));
  // A narrow range cuts the rows short rather than leaving it
  const bass = scaleRows(keyOf(0, 'major'), [28, 50], 40);
  assert.ok(bass.every((r) => noteToMidi(r) >= 28 && noteToMidi(r) <= 50));
});

test("the piano roll keeps notes it didn't change exactly as they were (off the grid, triplets, 32nds)", () => {
  const notes = [
    { id: 'a', note: 'A2', startOffset: 0.02, duration: '8t', velocity: 0.7 },
    { id: 'b', note: 'C3', startOffset: 1 / 12, duration: '8t', velocity: 0.7 },
    { id: 'c', note: 'E3', startOffset: 2 / 12, duration: '32n', velocity: 0.7, chance: 0.5 },
  ];
  assert.deepEqual(fromRoll(toRoll(notes)), notes);
  // One moved: only it lands on the grid
  const roll = toRoll(notes);
  roll[0] = { ...roll[0], step: 4 };
  const out = fromRoll(roll);
  assert.equal(out[0].startOffset, 0.25);
  assert.deepEqual(out.slice(1), notes.slice(1));
});

test('a jump back to an earlier section waits for the bar line, then lands', () => {
  // Playing B (bars 5-9) at 5.8, A (1-5) chosen: the loop runs from A to the bar line, so it doesn't wrap at once
  const j = sectionJump(5.8, 1, 5);
  assert.deepEqual(j, { from: 1, to: 5, when: 6, loop: [1, 6] });
  assert.equal(jumpStep(j, 5.9), 'wait');
  assert.equal(jumpStep(j, 5.995), 'seek');
  // The loop wrapped into A on the bar line: it's there, only its loop is set
  assert.equal(jumpStep(j, 1.02), 'land');
});

test('a jump forward plays to the bar line, then goes to the section', () => {
  const j = sectionJump(1.5, 9, 17);
  assert.deepEqual(j, { from: 9, to: 17, when: 2, loop: [1, 17] });
  assert.equal(jumpStep(j, 1.7), 'wait');
  assert.equal(jumpStep(j, 2), 'seek');
  // The next section, starting on that bar line: it's reached by playing on
  const next = sectionJump(4.5, 5, 9);
  assert.equal(jumpStep(next, 5), 'land');
});

test('no jump to the section already playing', () => {
  assert.equal(sectionJump(3.2, 1, 5), null);
});

const meterMap = (num, den) => ({ base: { num, den }, points: [] });
const FOUR = meterMap(4, 4);
const THREE = meterMap(3, 4);
const SIX8 = meterMap(6, 8);

test('in 3/4 a jump waits for the end of the measure playing, three beats long', () => {
  // Playing measure 1 (bars 1-1.75) of A, B (measure 5 on) chosen
  const from = measureStart(5, THREE);
  const j = sectionJump(1.2, from, measureStart(13, THREE), THREE);
  assert.deepEqual(j.loop, [1, measureStart(13, THREE)]);
  assert.equal(j.when, 1.75);
  // Late in measure 2 (1.75-2.5), back to A: lands at 2.5, not at bar 3
  const back = sectionJump(2.4, 1, from, THREE);
  assert.equal(back, null);
  const j2 = sectionJump(from + 0.8, 1, from, THREE);
  assert.equal(j2.when, from + 1.5);
  assert.deepEqual(j2.loop, [1, from + 1.5]);
  // In 4/4 the same as without a meter
  assert.deepEqual(sectionJump(5.8, 1, 5, FOUR), sectionJump(5.8, 1, 5));
});

test("the header's place counts measures from the section's first, beats in the meter", () => {
  assert.deepEqual(sectionPlace(measureStart(2, THREE), 1, THREE), { measure: 2, beat: 1 });
  assert.deepEqual(sectionPlace(1.5, 1, THREE), { measure: 1, beat: 3 });
  assert.deepEqual(sectionPlace(measureStart(6, THREE) + 0.25, measureStart(5, THREE), THREE), { measure: 2, beat: 2 });
  // 6/8: the beats are eighths
  assert.deepEqual(sectionPlace(1 + 5 / 8, 1, SIX8), { measure: 1, beat: 6 });
  // 4/4 as before
  assert.deepEqual(sectionPlace(6.75, 5, FOUR), { measure: 2, beat: 4 });
  assert.deepEqual(sectionPlace(6.75, 5), { measure: 2, beat: 4 });
});

test('the chords sheet writes a chord a measure, as the studio does', () => {
  // 8 measures of 3/4: two measures a chord, four chords, each 1.5 bars
  const from = measureStart(5, THREE), to = measureStart(13, THREE);
  const p = sectionChordPlan(from, to, THREE);
  assert.equal(p.chordBars, 2);
  assert.equal(p.count, 4);
  assert.deepEqual(p.spans.map((x) => +x.start.toFixed(6)), [0, 1.5, 3, 4.5]);
  assert.ok(p.spans.every((x) => Math.abs(x.length - 1.5) < 1e-9));
  // 4 measures of 3/4: a chord a measure
  const q = sectionChordPlan(1, measureStart(5, THREE), THREE);
  assert.equal(q.count, 4);
  assert.ok(q.spans.every((x) => Math.abs(x.length - 0.75) < 1e-9));
  // 4/4 as before: no spans, a chord chordBars long
  assert.deepEqual(sectionChordPlan(5, 13, FOUR), { chordBars: 2, count: 4 });
  assert.deepEqual(sectionChordPlan(1, 3), { chordBars: 0.5, count: 4 });
});

test("the piano roll's ruler marks the meter's beats", () => {
  assert.deepEqual(rollRulerMarks(1, measureStart(3, THREE), THREE).map((m) => m.label), ['1', '1.2', '1.3', '2', '2.2', '2.3']);
  assert.deepEqual(rollRulerMarks(1, measureStart(3, THREE), THREE).map((m) => m.step), [0, 4, 8, 12, 16, 20]);
  const six = rollRulerMarks(1, 1.75, SIX8);
  assert.deepEqual(six.map((m) => m.label), ['1', '1.2', '1.3', '1.4', '1.5', '1.6']);
  assert.deepEqual(six.map((m) => m.step), [0, 2, 4, 6, 8, 10]);
  // 4/4 as before
  assert.deepEqual(rollRulerMarks(5, 7, FOUR).map((m) => m.label), ['1', '1.2', '1.3', '1.4', '2', '2.2', '2.3', '2.4']);
});

test("a take's place: bars to a tenth in 4/4, measures and beats in other meters", () => {
  assert.equal(takePlace(4.25, FOUR), '4.3');
  assert.equal(takePlace(4.25), '4.3');
  assert.equal(takePlace(measureStart(3, THREE), THREE), '3');
  assert.equal(takePlace(measureStart(3, THREE) + 0.25, THREE), '3.2');
});

test("on a section of an odd length the chords sheet's last chord stops at the section's end", async () => {
  const { chordNotesFor } = await import('../src/store/smartTools.ts');
  const { durationToBars } = await import('../src/store/timelineTypes.ts');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
  let id = 0;
  const newId = () => `n${id++}`;
  const C = [0, 4, 7];
  // 9 bars of 4/4: five chords of two bars, the last one bar
  const p = sectionChordPlan(1, 10);
  assert.equal(p.count, 5);
  assert.deepEqual(p.spans.slice(-2), [{ start: 6, length: 2 }, { start: 8, length: 1 }]);
  for (const style of ['sustain', 'pulse', 'offbeat', 'arp']) {
    const notes = chordNotesFor(Array(p.count).fill(C), p.chordBars, style, newId, p.spans);
    const end = Math.max(...notes.map((n) => n.startOffset + durationToBars(n.duration)));
    assert.ok(end <= 9 + 1e-6, `${style} rings to ${end}`);
  }
  // 11 bars from bar 5
  assert.deepEqual(sectionChordPlan(5, 16).spans.at(-1), { start: 10, length: 1 });
  // 9 measures of 3/4: the last chord one measure (0.75)
  const q = sectionChordPlan(1, measureStart(10, THREE), THREE);
  assert.equal(q.count, 5);
  const last = q.spans.at(-1);
  near(last.start, 6);
  near(last.length, 0.75);
  // A whole number of chords as before
  assert.deepEqual(sectionChordPlan(1, 9), { chordBars: 2, count: 4 });
});

test("a jump in the song's last measure stops at the timeline's end", () => {
  // 3/2: the last measure starts on bar 400 and would run to 401.5, past the end (401)
  const THREE_TWO = meterMap(3, 2);
  const j = sectionJump(400.3, 1, 5, THREE_TWO);
  assert.equal(j.when, 401);
  assert.deepEqual(j.loop, [1, 401]);
  // A section running to the end, jumped to from earlier: its loop ends there too
  const k = sectionJump(91.3, 397, 401.5, THREE_TWO);
  assert.deepEqual(k, { from: 397, to: 401.5, when: 92.5, loop: [91, 401] });
  // Inside the timeline as before
  assert.deepEqual(sectionJump(5.8, 1, 5), { from: 1, to: 5, when: 6, loop: [1, 6] });
});

test("the ruler reads 1 at the start of a section starting part-way through a measure", () => {
  // 1/2 has one beat a measure: a section from 16.875 has none of measure 1's beats in it
  const HALF = meterMap(1, 2);
  const marks = rollRulerMarks(16.875, 18, HALF);
  assert.deepEqual(marks.map((m) => m.label), ['1', '2', '3']);
  assert.deepEqual(marks.map((m) => m.step), [0, 2, 10]);
  // On a beat of measure 1 it reads that beat, as before
  assert.deepEqual(rollRulerMarks(1.25, 3, meterMap(2, 2)).map((m) => m.label), ['1.2', '2', '2.2']);
  // On a measure line as before
  assert.deepEqual(rollRulerMarks(17, 18, HALF).map((m) => m.label), ['1', '2']);
});

test("a held step's roll lengths follow the time signature at the step", () => {
  const four = { base: { num: 4, den: 4 }, points: [] };
  assert.deepEqual(rollLengths(1.5, four), [{ bars: 1 / 4, label: 'over a beat' }, { bars: 1 / 2, label: 'over two beats' }, { bars: 1, label: 'over a bar' }]);
  const three = { base: { num: 3, den: 4 }, points: [] };
  assert.deepEqual(rollLengths(1, three).map((r) => r.bars), [1 / 4, 1 / 2, 3 / 4]);
  const six = { base: { num: 6, den: 8 }, points: [] };
  assert.deepEqual(rollLengths(1.25, six).map((r) => r.bars), [1 / 8, 1 / 4, 3 / 4]);
  // 2/4: two beats are the bar, offered once
  assert.deepEqual(rollLengths(1, { base: { num: 2, den: 4 }, points: [] }).map((r) => r.label), ['over a beat', 'over a bar']);
  // the bar where the step is: 4/4, then 7/8 from bar 3
  const mixed = { base: { num: 4, den: 4 }, points: [{ id: 'm', bar: 3, num: 7, den: 8 }] };
  assert.deepEqual(rollLengths(2.5, mixed).map((r) => r.bars), [1 / 4, 1 / 2, 1]);
  assert.deepEqual(rollLengths(3.25, mixed).map((r) => r.bars), [1 / 8, 1 / 4, 7 / 8]);
});
