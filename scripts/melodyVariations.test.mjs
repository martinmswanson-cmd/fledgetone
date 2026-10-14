// Unit tests for melody variations (src/store/melodyVariations.ts). Run with `npm test`.
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
const { melodyVariation } = await import('../src/store/melodyVariations.ts');
const { midiOf } = await import('../src/store/noteTools.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');

const C_MAJOR = { root: 0, steps: [0, 2, 4, 5, 7, 9, 11] };
const A_MINOR = { root: 9, steps: [0, 2, 3, 5, 7, 8, 10] };
let n = 0;
const id = () => `n${n++}`;
const note = (name, at, dur = '4n') => ({ id: id(), note: name, startOffset: at, duration: dur, velocity: 0.8 });
// C D E G, a quarter each, then C an octave up held: a bar and a half
const tune = [note('C4', 0), note('D4', 0.25), note('E4', 0.5), note('G4', 0.75), note('C5', 1, '2n')];
const names = (ns) => ns.map((x) => x.note);
const vary = (kind, key = C_MAJOR, notes = tune, seed = 1) => melodyVariation(notes, kind, key, 2, 1, 4, seed, id);

test('up a step and a harmony a third above stay in the scale', () => {
  assert.deepEqual(names(vary('stepUp')), ['D4', 'E4', 'F4', 'A4', 'D5']);
  assert.deepEqual(names(vary('harmony')), ['E4', 'F4', 'G4', 'B4', 'E5']);
  // The rhythm is the tune's
  assert.deepEqual(vary('harmony').map((x) => x.startOffset), tune.map((x) => x.startOffset));
});

test('the mirror turns every rise into a fall around the first note', () => {
  assert.deepEqual(names(vary('mirror')), ['C4', 'B3', 'A3', 'F3', 'C3']);
});

test('darker goes to the parallel minor, brighter to the major (and minor to major, major to Lydian)', () => {
  assert.deepEqual(names(vary('darker')), ['C4', 'D4', 'D#4', 'G4', 'C5']);
  const withF = [note('C4', 0), note('F4', 0.25), note('A4', 0.5), note('B4', 0.75)];
  assert.deepEqual(names(vary('brighter', C_MAJOR, withF)), ['C4', 'F#4', 'A4', 'B4']);
  const aMinor = [note('A3', 0), note('C4', 0.25), note('E4', 0.5), note('G4', 0.75)];
  assert.deepEqual(names(vary('brighter', A_MINOR, aMinor)), ['A3', 'C#4', 'E4', 'G#4']);
  // A minor tune goes darker to Phrygian: the second lowered
  assert.deepEqual(names(vary('darker', A_MINOR, [note('A3', 0), note('B3', 0.25)])), ['A3', 'A#3']);
});

test('an answer keeps the rhythm, starts a step from where the call ended, and ends on the key note', () => {
  const a = vary('answer');
  assert.deepEqual(a.map((x) => x.startOffset), tune.map((x) => x.startOffset));
  assert.equal(midiOf(a[a.length - 1].note) % 12, 0);
  const lastCall = midiOf(tune[tune.length - 1].note);
  assert.ok(Math.abs(midiOf(a[0].note) - lastCall) <= 2, `${a[0].note} vs C5`);
  // It goes the other way: the call rose, the answer falls
  assert.ok(midiOf(a[1].note) < midiOf(a[0].note));
});

test('simpler keeps the notes on the beat, each held to the next', () => {
  const busy = [note('C4', 0, '8n'), note('D4', 0.125, '8n'), note('E4', 0.25, '8n'), note('F4', 0.375, '8n'), note('G4', 0.5, '8n')];
  const s = vary('simpler', C_MAJOR, busy);
  assert.deepEqual(names(s), ['C4', 'E4', 'G4']);
  assert.ok(durationToBars(s[0].duration) > 0.2 && durationToBars(s[0].duration) <= 0.25);
});

test('busier fills a leap with a passing note, leaving steps alone', () => {
  const leap = [note('C4', 0, '2n'), note('G4', 0.5, '2n')];
  const b = vary('busier', C_MAJOR, leap);
  assert.equal(b.length, 3);
  assert.equal(b[1].startOffset, 0.25);
  assert.ok(midiOf(b[1].note) > 60 && midiOf(b[1].note) < 67);
  assert.equal(vary('busier', C_MAJOR, [note('C4', 0, '2n'), note('D4', 0.5, '2n')]).length, 2);
});

test('syncopated pushes downbeat notes an eighth early, never the first, and nothing overlaps', () => {
  const s = vary('syncopated');
  assert.equal(s[0].startOffset, 0);
  // E4 on beat 3 and C5 on the next bar line come an eighth early
  assert.equal(s[2].startOffset, 0.375);
  assert.equal(s[4].startOffset, 0.875);
  for (let i = 0; i + 1 < s.length; i++) assert.ok(s[i].startOffset + durationToBars(s[i].duration) <= s[i + 1].startOffset + 1e-6);
});

test('surprise combines two and changes with the seed; an empty clip gives nothing', () => {
  assert.notDeepEqual(names(vary('surprise', C_MAJOR, tune, 1)), names(vary('surprise', C_MAJOR, tune, 2)));
  assert.deepEqual(vary('answer', C_MAJOR, []), []);
  // Every variation gives fresh ids
  const ids = new Set(tune.map((x) => x.id));
  assert.ok(vary('stepUp').every((x) => !ids.has(x.id)));
});
