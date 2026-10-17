// Unit tests for linked clips (src/store/patterns.ts) and the piano roll's chord, arpeggio and riff
// tools (src/store/chordTools.ts). Run with `npm test`.
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
const p = await import('../src/store/patterns.ts');
const t = await import('../src/store/chordTools.ts');
const { keyOf } = await import('../src/store/songKey.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');

const note = (n, at = 0) => ({ id: `${n}${at}`, note: n, startOffset: at, duration: '4n', velocity: 0.8 });
const clip = (id, startBar, notes, extra = {}) => ({ id, trackId: 't', name: id, startBar, lengthBars: 1, notes, isSelected: false, ...extra });

test('editing one linked clip changes the others; unlinked clips stay', () => {
  const shared = [note('C4')];
  const prev = [clip('a', 1, shared, { pattern: 'p' }), clip('b', 2, shared, { pattern: 'p' }), clip('c', 3, shared)];
  const edited = [note('C4'), note('E4', 0.25)];
  const next = prev.map((c) => (c.id === 'a' ? { ...c, notes: edited } : c));
  const out = p.syncPatterns(prev, next);
  assert.equal(out.find((c) => c.id === 'b').notes, edited);
  assert.equal(out.find((c) => c.id === 'c').notes, shared);
  // Moving a linked clip changes nothing else
  assert.equal(p.syncPatterns(prev, prev.map((c) => (c.id === 'b' ? { ...c, startBar: 5 } : c))), null);
});

test('an undo (every member changed at once) is left alone', () => {
  const prev = [clip('a', 1, [note('C4')], { pattern: 'p' }), clip('b', 2, [note('C4')], { pattern: 'p' })];
  const older = [note('D4')];
  assert.equal(p.syncPatterns(prev, prev.map((c) => ({ ...c, notes: older }))), null);
});

test("an edit of a clip's frame (trim its start, split it) takes it out of the pattern", () => {
  const shared = [note('C4'), note('E4', 0.5)];
  const prev = [clip('a', 1, shared, { pattern: 'p' }), clip('b', 2, shared, { pattern: 'p' })];
  // Trim a's start by half a bar: its notes move to stay in place
  const trimmed = { ...prev[0], startBar: 1.5, lengthBars: 0.5, notes: [{ ...shared[1], startOffset: 0 }] };
  const out = p.syncPatterns(prev, [trimmed, prev[1]]);
  assert.equal(out[0].pattern, undefined);
  assert.equal(out[1].notes, shared);
  // Split b: its left half shrinks (unlinked), its new right half has other notes (unlinked)
  const left = { ...prev[1], lengthBars: 0.5, notes: [shared[0]] };
  const right = { ...prev[1], id: 'r', startBar: 2.5, lengthBars: 0.5, notes: [{ ...shared[1], startOffset: 0 }] };
  const out2 = p.syncPatterns(prev, [prev[0], left, right]);
  assert.equal(out2[0].notes, shared);
  assert.equal(out2[1].pattern, undefined);
  assert.equal(out2[2].pattern, undefined);
});

test('pattern labels and sizes', () => {
  const clips = [clip('a', 3, [], { pattern: 'x' }), clip('b', 1, [], { pattern: 'y' }), clip('c', 5, [], { pattern: 'x' }), clip('d', 2, [], { pattern: 'z' })];
  assert.deepEqual([...p.patternLabels(clips)], [['x', 'P1']]);
  assert.equal(p.patternSize(clips, 'x'), 2);
  assert.equal(p.patternSize(clips, undefined), 0);
  assert.ok(!p.canLink({ ...clips[0], audio: { soundId: 's' } }));
});

test('chords by degree: names, and a progression voiced close together', () => {
  assert.deepEqual(t.degreeLabels(keyOf(0, 'major')), ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
  assert.deepEqual(t.degreeLabels(keyOf(9, 'minor')), ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']);
  assert.equal(t.degreeChordName(keyOf(0, 'major'), 4, true), 'G7');
  let n = 0;
  let prev = null;
  const lows = [];
  for (const d of [0, 4, 5, 3]) {
    const r = t.stampDegree(keyOf(0, 'major'), d, { at: d, lengthBars: 1, prev }, () => `n${n++}`);
    assert.equal(r.notes.length, 3);
    prev = r.voiced;
    lows.push(Math.min(...r.voiced));
  }
  // No chord jumps more than a fifth from the last
  for (let i = 1; i < lows.length; i++) assert.ok(Math.abs(lows[i] - lows[i - 1]) <= 7);
});

test('the arpeggiator: patterns, octaves and gate', () => {
  assert.deepEqual(t.arpCycle([60, 64, 67], 'up', 2), [60, 64, 67, 72, 76, 79]);
  assert.deepEqual(t.arpCycle([60, 64, 67], 'upDown', 1), [60, 64, 67, 64]);
  assert.deepEqual(t.arpCycle([60, 64, 67], 'converge', 1), [60, 67, 64]);
  assert.deepEqual(t.arpCycle([60, 64, 67], 'pinky', 1), [60, 67, 64, 67]);
  assert.deepEqual(t.arpCycle([60, 64, 67], 'thumb', 1), [60, 64, 60, 67]);
  let n = 0;
  const chord = ['C4', 'E4', 'G4'].map((x) => ({ ...note(x), duration: '1m' }));
  const out = t.arpeggiateChords([...chord, note('A4', 0.5)], { style: 'up', rateBars: 1 / 16, octaves: 2, gate: 0.5 }, () => `a${n++}`);
  const arp = out.filter((x) => x.startOffset !== 0.5 || x.note !== 'A4');
  assert.equal(out.length, 17); // 16 sixteenths of the chord, and the single note as it was
  assert.deepEqual(arp.slice(0, 7).map((x) => x.note), ['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C4']);
  assert.equal(durationToBars(arp[0].duration), 1 / 32);
});

test('riffs: the same seed gives the same riff, in the key, within the range', () => {
  let n = 0;
  const id = () => `r${n++}`;
  const key = keyOf(9, 'minor');
  const a = t.riff(key, { style: 'pluck', lengthBars: 4, seed: 7 }, id);
  const b = t.riff(key, { style: 'pluck', lengthBars: 4, seed: 7 }, id);
  const c = t.riff(key, { style: 'pluck', lengthBars: 4, seed: 8 }, id);
  const sig = (r) => r.map((x) => `${x.note}@${x.startOffset}`).join(' ');
  assert.equal(sig(a), sig(b));
  assert.notEqual(sig(a), sig(c));
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const midi = (s) => names.indexOf(s.slice(0, -1)) + 12 * (Number(s.slice(-1)) + 1);
  for (const x of a) {
    assert.ok([9, 11, 0, 2, 4, 5, 7].includes(midi(x.note) % 12), x.note);
    assert.ok(x.startOffset >= 0 && x.startOffset < 4);
  }
  // A bass line starts each chord on its root
  const bass = t.riff(key, { style: 'bass', lengthBars: 2, seed: 5, chords: [{ at: 0, end: 1, pcs: [9, 0, 4] }, { at: 1, end: 2, pcs: [5, 9, 0] }], range: [28, 60] }, id);
  assert.equal(midi(bass.find((x) => x.startOffset === 0).note) % 12, 9);
  assert.equal(midi(bass.find((x) => x.startOffset === 1).note) % 12, 5);
  for (const x of bass) assert.ok(midi(x.note) >= 28 && midi(x.note) <= 60);
});
