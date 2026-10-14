// Unit tests for the math patterns (src/store/mathPatterns.ts). Run with `npm test`.
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
const M = await import('../src/store/mathPatterns.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');
const { midiOf } = await import('../src/store/noteTools.ts');

const C_MAJOR = { root: 0, steps: [0, 2, 4, 5, 7, 9, 11] };
let n = 0;
const id = () => `n${n++}`;

test('Fibonacci mod 4 repeats every 6: 0, 1, 1, 2, 3, 1', () => {
  assert.deepEqual(M.fibonacciMod4(12), [0, 1, 1, 2, 3, 1, 0, 1, 1, 2, 3, 1]);
  const notes = M.fibonacciGroove(C_MAJOR, 2, id);
  assert.equal(notes.length, 16);
  assert.ok(notes.every((x) => [0, 4, 7, 11].includes(midiOf(x.note) % 12)), 'only tonic seventh chord tones');
});

test('the fifths walk steps four scale notes (a fifth) each time and covers all seven', () => {
  const notes = M.fifthsWalk(C_MAJOR, 2, id);
  assert.equal(notes.length, 8);
  assert.deepEqual(notes.slice(0, 7).map((x) => x.note.replace(/\d/, '')), ['C', 'G', 'D', 'A', 'E', 'B', 'F']);
});

test("Pascal's triangle mod 2 is the Sierpinski triangle", () => {
  assert.deepEqual(M.pascalRow(4), [0, 4]);
  assert.deepEqual(M.pascalRow(5), [0, 1, 4, 5]);
  assert.deepEqual(M.pascalRow(7), [0, 1, 2, 3, 4, 5, 6, 7]);
  const notes = M.pascalHarp(C_MAJOR, 2, id);
  // 16 rows: 3^4 = 81 odd entries in rows 0..15
  assert.equal(notes.length, 81);
});

test('the pendulums line up again every 4 bars', () => {
  const notes = M.pendulumWave(C_MAJOR, 8, id);
  const first = notes.filter((x) => x.startOffset < 4).map((x) => `${x.note}@${x.startOffset.toFixed(4)}`);
  const second = notes.filter((x) => x.startOffset >= 4).map((x) => `${x.note}@${(x.startOffset - 4).toFixed(4)}`);
  assert.deepEqual(second, first);
  // Pendulum k swings 6 + k times per cycle, crossing the middle twice a swing
  assert.equal(first.length, 2 * (6 + 7 + 8 + 9 + 10 + 11));
});

test('the endless riser fades in at the bottom and out at the top, and every note glides up a semitone', () => {
  const notes = M.endlessRiser(C_MAJOR, 4, id);
  assert.ok(notes.every((x) => x.expr?.bend?.at(-1)?.value === 1));
  const lowest = Math.min(...notes.map((x) => midiOf(x.note)));
  const highest = Math.max(...notes.map((x) => midiOf(x.note)));
  const loud = (m) => Math.max(...notes.filter((x) => midiOf(x.note) === m).map((x) => x.velocity), 0);
  assert.ok(loud(lowest) < 0.3 && loud(highest) < 0.3, 'quiet at both ends');
  assert.ok(Math.max(...notes.map((x) => x.velocity)) > 0.8, 'full in the middle');
});

test('the stutter build doubles the last-beat hits each bar: 2, 4, 8, 16', () => {
  const snares = [0, 1, 2, 3].map((bar) => ({ id: id(), note: 'D2', startOffset: bar + 0.75, duration: '16n', velocity: 0.8 }));
  const out = M.stutterBuild(snares, id);
  const perBar = [0, 1, 2, 3].map((bar) => out.filter((x) => Math.floor(x.startOffset) === bar).length);
  assert.deepEqual(perBar, [2, 4, 8, 16]);
  // Hits on beats 1-3 are left alone
  const kick = { id: 'k', note: 'C2', startOffset: 0.25, duration: '8n', velocity: 0.9 };
  assert.deepEqual(M.stutterBuild([kick], id), [kick]);
});

test('spring bounce, tritone slide and scoop draw bend curves over each note', () => {
  const one = [{ id: 'a', note: 'C2', startOffset: 0, duration: '2n', velocity: 0.9 }];
  const spring = M.springBounce(one, 2)[0].expr.bend;
  assert.equal(spring[0].value, 1.3);
  assert.ok(Math.abs(spring.at(-1).value) < 0.15, 'nearly settled after a second');
  const slide = M.tritoneSlide(one, 2)[0].expr.bend;
  assert.equal(slide[0].value, 0);
  assert.ok(slide.at(-1).value > 5.5 && slide.at(-1).value <= 6, 'ends near half an octave up');
  const sc = M.scoop(one, 2)[0].expr.bend;
  assert.equal(sc[0].value, -3);
  assert.equal(sc.at(-1).value, 0);
  assert.ok(sc.at(-1).at <= durationToBars('2n'));
});
