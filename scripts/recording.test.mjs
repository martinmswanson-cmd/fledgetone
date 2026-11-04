// Unit tests for MIDI recording maths (src/store/recording.ts): how a take gathers what it hears
// into a clip, quantize, and the settings kept per browser. Run with `npm test`.
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
const { createTake, quantizeTakeClip, normalizeRecordOptions, DEFAULT_RECORD_OPTIONS, QUANTIZE_TICKS } = await import('../src/store/recording.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

/** 120 BPM: a bar is 2 s, a beat 0.5 s. Audio seconds of a song position (bar 1 at t0). */
const BPM = 120;
const t0 = 10;
const at = (bar) => t0 + (bar - 1) * 2;

test('a take places notes where they were heard, with their velocity and length, in one clip of whole bars', () => {
  const take = createTake(1);
  assert.equal(take.count(), 0);
  // Beat 2 of bar 1, an 8th long; beat 1 of bar 2, a quarter long
  take.noteOn(60, 'C4', 100 / 127, 1.25, at(1.25));
  take.noteOff(60, at(1.25) + 0.25);
  take.noteOn(64, 'E4', 0.5, 2, at(2));
  assert.equal(take.count(), 2);
  take.noteOff(64, at(2) + 0.5);
  const clip = take.finish(2.6, at(2.6), BPM);
  assert.equal(clip.startBar, 1);
  assert.equal(clip.lengthBars, 2);
  assert.equal(clip.notes.length, 2);
  assert.equal(clip.notes[0].note, 'C4');
  near(clip.notes[0].startOffset, 0.25);
  assert.equal(clip.notes[0].duration, '8n');
  near(clip.notes[0].velocity, 100 / 127);
  assert.equal(clip.notes[1].note, 'E4');
  near(clip.notes[1].startOffset, 1);
  assert.equal(clip.notes[1].duration, '4n');
  assert.equal(clip.notes[1].velocity, 0.5);
});

test('the clip ends on the bar line nearest the stop, or after the last note', () => {
  const stoppedAt = (bar, noteBar = 1.5) => {
    const take = createTake(1);
    take.noteOn(60, 'C4', 1, noteBar, at(noteBar));
    take.noteOff(60, at(noteBar) + 0.1);
    return take.finish(bar, at(bar), BPM);
  };
  // Just past bar 3: the take ends on bar 3 (2 bars), not a bar later
  assert.equal(stoppedAt(3.02).lengthBars, 2);
  // Nearly at bar 3: also 2 bars
  assert.equal(stoppedAt(2.8).lengthBars, 2);
  // Mid-bar: the bar line it's nearest to
  assert.equal(stoppedAt(3.4).lengthBars, 2);
  assert.equal(stoppedAt(3.6).lengthBars, 3);
  // A note sounding past the nearest line keeps its bar
  assert.equal(stoppedAt(3.02, 3.0).lengthBars, 3);
  // Never shorter than a bar
  assert.equal(stoppedAt(1.1).lengthBars, 1);
});

test('a note still held at the stop ends there, and a short tap keeps a 32nd', () => {
  const take = createTake(1);
  take.noteOn(60, 'C4', 1, 1, at(1));
  take.noteOn(62, 'D4', 1, 1.5, at(1.5));
  take.noteOff(62, at(1.5) + 0.001);
  const clip = take.finish(2, at(2), BPM);
  assert.equal(clip.notes[0].note, 'C4');
  near(durationToBars(clip.notes[0].duration), 1);
  assert.equal(clip.notes[1].duration, '32n');
});

test('the sustain pedal holds let-go notes until it comes up; striking a held key ends the earlier note', () => {
  const take = createTake(1);
  take.sustain(true, at(1));
  take.noteOn(60, 'C4', 1, 1, at(1));
  take.noteOff(60, at(1.25));
  take.noteOn(64, 'E4', 1, 1.5, at(1.5));
  take.noteOff(64, at(1.5) + 0.01);
  // The pedal comes up at beat 1 of bar 2: both notes end there
  take.sustain(false, at(2));
  // Same key again while sustained: the first C4 ends at the new strike
  take.sustain(true, at(2));
  take.noteOn(60, 'C4', 1, 2, at(2));
  take.noteOff(60, at(2.1));
  take.noteOn(60, 'C4', 0.7, 2.5, at(2.5));
  take.noteOff(60, at(2.75));
  const clip = take.finish(3, at(3), BPM);
  const byStart = clip.notes.map((n) => [n.note, n.startOffset, +durationToBars(n.duration).toFixed(4)]);
  assert.deepEqual(byStart, [
    ['C4', 0, 1],
    ['E4', 0.5, 0.5],
    ['C4', 1, 0.5],
    ['C4', 1.5, 0.5],
  ]);
  // The last C4 was let go with the pedal still down, so it sounded until the stop
  assert.equal(clip.lengthBars, 2);
});

test('a note number is one key: the same note name from two keys (a drum pad an octave up) are separate notes', () => {
  const take = createTake(1);
  take.noteOn(24, 'C1', 1, 1, at(1));
  take.noteOn(36, 'C1', 0.5, 1.25, at(1.25));
  take.noteOff(24, at(1.5));
  take.noteOff(36, at(1.75));
  const clip = take.finish(2, at(2), BPM);
  assert.deepEqual(
    clip.notes.map((n) => [n.note, n.startOffset, n.velocity, n.duration]),
    [
      ['C1', 0, 1, '2n'],
      ['C1', 0.25, 0.5, '2n'],
    ]
  );
});

test('a loop pass covers the whole loop, and notes heard after the wrap land early in the clip', () => {
  const take = createTake(3);
  take.noteOn(60, 'C4', 1, 3.5, at(3.5));
  take.noteOff(60, at(3.75));
  // The loop (1 to 5) came round: back to bar 1
  take.cover(1, 5);
  take.noteOn(62, 'D4', 1, 1.5, at(5.5));
  take.noteOff(62, at(5.75));
  const clip = take.finish(2, at(6), BPM);
  assert.equal(clip.startBar, 1);
  assert.equal(clip.lengthBars, 4);
  assert.deepEqual(
    clip.notes.map((n) => [n.note, n.startOffset]),
    [
      ['D4', 0.5],
      ['C4', 2.5],
    ]
  );
});

test('an empty take makes no clip', () => {
  const take = createTake(1);
  assert.equal(take.finish(3, at(3), BPM), null);
  const held = createTake(1);
  held.noteOn(60, 'C4', 1, 1, at(1));
  assert.notEqual(held.finish(2, at(2), BPM), null);
});

test('the clip never leaves the timeline', () => {
  const take = createTake(399.5);
  take.noteOn(60, 'C4', 1, 400.9, at(400.9));
  const clip = take.finish(401, at(401), BPM);
  assert.equal(clip.startBar, 399);
  assert.equal(clip.startBar + clip.lengthBars, 401);
});

const clipOf = (notes, startBar = 1, lengthBars = 2) => ({
  id: 'c',
  trackId: 't',
  name: 'Take 1',
  startBar,
  lengthBars,
  isSelected: true,
  notes: notes.map(([note, startOffset, velocity = 1, duration = '16n'], i) => ({ id: `n${i}`, note, startOffset, duration, velocity })),
});

test('quantize snaps starts to the grid, keeps lengths, and leaves the clip alone when off', () => {
  const clip = clipOf([
    ['C4', 0.01, 1, '8n'],
    ['D4', 0.3, 1, '4n'],
    ['E4', 0.49, 1, '16n'],
  ]);
  assert.equal(quantizeTakeClip(clip, 'off'), clip);
  const q16 = quantizeTakeClip(clip, '1/16');
  assert.deepEqual(
    q16.notes.map((n) => [n.note, n.startOffset, n.duration]),
    [
      ['C4', 0, '8n'],
      ['D4', 0.3125, '4n'],
      ['E4', 0.5, '16n'],
    ]
  );
  const q8 = quantizeTakeClip(clip, '1/8');
  assert.deepEqual(
    q8.notes.map((n) => n.startOffset),
    [0, 0.25, 0.5]
  );
  // Triplet 16ths: thirds of an 8th (32 ticks)
  const q16t = quantizeTakeClip(clip, '1/16T');
  assert.deepEqual(
    q16t.notes.map((n) => Math.round(n.startOffset * 768)),
    [0, 224, 384]
  );
  assert.equal(QUANTIZE_TICKS['1/16T'], 32);
});

test('quantize is on the song grid, not the clip (a clip on bar 3 snaps the same lines)', () => {
  const clip = clipOf([['C4', 0.07]], 3, 1);
  assert.equal(quantizeTakeClip(clip, '1/16').notes[0].startOffset, 0.0625);
  // Notes never move before the clip's start
  const early = clipOf([['C4', 0.02]], 3, 1);
  assert.equal(quantizeTakeClip(early, '1/8').notes[0].startOffset, 0);
});

test('two strikes of one note on the same line become one (the louder, then the longer), and a note snapped onto the end grows the clip', () => {
  const clip = clipOf([
    ['C4', 0.26, 0.5, '8n'],
    ['C4', 0.24, 0.9, '16n'],
    ['C4', 0.5, 0.9, '16n'],
    ['C4', 0.51, 0.9, '4n'],
    ['D4', 1.99, 1, '16n'],
  ]);
  const q = quantizeTakeClip(clip, '1/16');
  assert.deepEqual(
    q.notes.map((n) => [n.note, n.startOffset, n.velocity, n.duration]),
    [
      ['C4', 0.25, 0.9, '16n'],
      ['C4', 0.5, 0.9, '4n'],
      ['D4', 2, 1, '16n'],
    ]
  );
  assert.equal(q.lengthBars, 3);
  assert.equal(q.id, clip.id);
  // A note snapped into the last bar's middle needs that bar, not one more
  assert.equal(quantizeTakeClip(clipOf([['C4', 2.3]], 1, 2), '1/8').lengthBars, 3);
  // Near the end of the timeline the clip can't grow past bar 401
  assert.equal(quantizeTakeClip(clipOf([['C4', 0.99]], 400, 1), '1/16').lengthBars, 1);
});

test('a punch-in off the grid: a note just after it snaps to the next line, never before the clip or onto its end', () => {
  // Punched in at bar 2.01 (out at 3), a note played at 2.03: the line before (2.0) is outside the clip
  const punch = clipOf([['C4', 0.02], ['D4', 0.5], ['E4', 0.98]], 2.01, 0.99);
  const q = quantizeTakeClip(punch, '1/8');
  const at = q.notes.map((n) => [n.note, +(punch.startBar + n.startOffset).toFixed(6)]);
  assert.deepEqual(at, [['C4', 2.125], ['D4', 2.5], ['E4', 2.875]]);
  assert.ok(q.notes.every((n) => n.startOffset >= 0 && n.startOffset < q.lengthBars));
  assert.equal(q.lengthBars, 0.99);
  // A punch too short to hold a grid line: the note stays as played
  const tiny = quantizeTakeClip(clipOf([['C4', 0.01]], 2.01, 0.05), '1/8');
  assert.equal(+tiny.notes[0].startOffset.toFixed(6), 0.01);
  // A folder's take (can't grow): a note snapped onto the end goes to the line before it
  const folderTake = quantizeTakeClip(clipOf([['C4', 1.99]], 1, 2), '1/16', false);
  assert.equal(folderTake.notes[0].startOffset, 1.9375);
  assert.equal(folderTake.lengthBars, 2);
});

test('record settings: missing or bad values fall back, good ones are kept', () => {
  assert.deepEqual(normalizeRecordOptions(null), DEFAULT_RECORD_OPTIONS);
  assert.deepEqual(normalizeRecordOptions('junk'), DEFAULT_RECORD_OPTIONS);
  assert.deepEqual(normalizeRecordOptions({ countIn: false, quantize: '1/8', metronome: true, metronomeVolume: 0.3 }), {
    countIn: false,
    quantize: '1/8',
    metronome: true,
    metronomeVolume: 0.3,
    takes: false,
  });
  const bad = normalizeRecordOptions({ countIn: 'yes', quantize: '1/3', metronome: 1, metronomeVolume: 7 });
  assert.deepEqual(bad, { ...DEFAULT_RECORD_OPTIONS, metronomeVolume: 1 });
  assert.equal(normalizeRecordOptions({ metronomeVolume: -2 }).metronomeVolume, 0);
  assert.equal(normalizeRecordOptions({ metronomeVolume: NaN }).metronomeVolume, DEFAULT_RECORD_OPTIONS.metronomeVolume);
});

test('takes: each loop pass is a take of its own, the last one playing', () => {
  const take = createTake(1);
  take.noteOn(60, 'C4', 0.8, 1, at(1));
  take.noteOff(60, at(1.25));
  take.cover(1, 3); // the loop came round
  take.noteOn(62, 'D4', 0.8, 1.5, at(1.5));
  take.noteOff(62, at(1.75));
  take.cover(1, 3);
  take.control('bend', 1, 2);
  take.noteOn(64, 'E4', 0.8, 2, at(2));
  take.noteOff(64, at(2.25));
  const clip = take.finish(3, at(3), BPM, { passes: true });
  assert.equal(clip.takes.length, 3);
  assert.deepEqual(clip.takes.map((t) => t.notes.map((n) => n.note)), [['C4'], ['D4'], ['E4']]);
  assert.deepEqual(clip.notes.map((n) => n.note), ['E4']);
  assert.ok(clip.takes[2].expression?.bend && !clip.takes[0].expression);
  // Without passes, all of them together, as before
  assert.equal(createTakeFromAbove(), 3);
  function createTakeFromAbove() {
    const again = createTake(1);
    again.noteOn(60, 'C4', 0.8, 1, at(1));
    again.noteOff(60, at(1.25));
    again.cover(1, 3);
    again.noteOn(62, 'D4', 0.8, 1.5, at(1.5));
    again.noteOff(62, at(1.75));
    again.noteOn(64, 'E4', 0.8, 2, at(2));
    again.noteOff(64, at(2.25));
    const c = again.finish(3, at(3), BPM, { passes: false });
    assert.equal(c.takes, undefined);
    return c.notes.length;
  }
});

test('punch: only notes started in the range are kept, and the clip is the range', () => {
  const take = createTake(1);
  take.noteOn(60, 'C4', 0.8, 1.5, at(1.5));
  take.noteOff(60, at(1.75));
  take.noteOn(62, 'D4', 0.8, 2.5, at(2.5));
  take.noteOff(62, at(3.5)); // held past the punch out
  take.noteOn(64, 'E4', 0.8, 3.25, at(3.25));
  take.noteOff(64, at(3.5));
  const clip = take.finish(4, at(4), BPM, { punch: { inBar: 2, outBar: 3 } });
  assert.equal(clip.startBar, 2);
  assert.equal(clip.lengthBars, 1);
  assert.deepEqual(clip.notes.map((n) => [n.note, n.startOffset]), [['D4', 0.5]]);
  near(durationToBars(clip.notes[0].duration), 0.5, 1e-6);
  assert.equal(createTake(1).finish(2, at(2), BPM, { punch: { inBar: 2, outBar: 3 } }), null);
});

test('takes: a note played just before the wrap is heard stays in its pass', () => {
  const take = createTake(1);
  // The Transport says the loop wraps at at(3) a moment ahead; a note heard just before it is still pass 1
  take.cover(1, 3, at(3));
  take.noteOn(60, 'C4', 0.8, 2.9, at(2.9));
  take.noteOff(60, at(2.95));
  take.noteOn(62, 'D4', 0.8, 1.2, at(3.2));
  take.noteOff(62, at(3.3));
  const clip = take.finish(3, at(3.5), BPM, { passes: true });
  assert.deepEqual(clip.takes.map((t) => t.notes.map((n) => n.note)), [['C4'], ['D4']]);
});

test("a note quantized at the song's very end stays on the last line, inside the clip", () => {
  // The clip can't grow past the song's end: the note goes to the line before it, not onto its end
  const atEnd = clipOf([['C4', 0.99]], 400, 1);
  const q = quantizeTakeClip(atEnd, '1/16');
  assert.equal(q.lengthBars, 1);
  assert.ok(q.notes[0].startOffset < q.lengthBars, String(q.notes[0].startOffset));
  near(q.notes[0].startOffset, 1 - 1 / 16);
});

// Not in 4/4: a take's clip lies on the ruler's measure lines (3/4: measures at 1, 1.75, 2.5, 3.25, 4 ...)
const THREE = { base: { num: 3, den: 4 }, points: [] };
const SEVEN = { base: { num: 7, den: 8 }, points: [] };

test('in 3/4 a take runs from the measure it started in to the measure line nearest where it stopped', () => {
  // Recorded from measure 3 (bar 2.5), a note on its downbeat, stopped just past measure 4's line
  const take = createTake(2.5);
  take.noteOn(60, 'C4', 0.8, 2.5, at(2.5));
  take.noteOff(60, at(2.5) + 0.5);
  const clip = take.finish(3.3, at(3.3), BPM, { meter: THREE });
  assert.equal(clip.startBar, 2.5);
  near(clip.lengthBars, 0.75);
  near(clip.notes[0].startOffset, 0);
  // Without the meter (or in 4/4) it's whole bars, as before
  const plain = createTake(2.5);
  plain.noteOn(60, 'C4', 0.8, 2.5, at(2.5));
  plain.noteOff(60, at(2.5) + 0.5);
  const old = plain.finish(3.3, at(3.3), BPM, { meter: { base: { num: 4, den: 4 }, points: [] } });
  assert.deepEqual([old.startBar, old.lengthBars], [2, 1]);
});

test('in 7/8 a take started inside a measure starts on that measure and ends on the end of the one its last note reached', () => {
  // Measures at 1, 1.875, 2.75, 3.625: started at 1.9, a long note into the third measure
  const take = createTake(1.9);
  take.noteOn(60, 'C4', 0.8, 1.95, at(1.95));
  take.noteOff(60, at(2.9));
  const clip = take.finish(2.95, at(2.95), BPM, { meter: SEVEN });
  near(clip.startBar, 1.875);
  near(clip.startBar + clip.lengthBars, 3.625);
  near(clip.notes[0].startOffset, 1.95 - 1.875);
  // Nothing past the first measure: still one whole measure long
  const short = createTake(1.9);
  short.noteOn(60, 'C4', 0.8, 1.95, at(1.95));
  short.noteOff(60, at(2));
  const one = short.finish(2, at(2), BPM, { meter: SEVEN });
  near(one.startBar, 1.875);
  near(one.lengthBars, 0.875);
});

test('a punched take keeps the exact punch range whatever the meter', () => {
  const take = createTake(1.5);
  take.noteOn(60, 'C4', 0.8, 1.9, at(1.9));
  take.noteOff(60, at(2));
  const clip = take.finish(2.6, at(2.6), BPM, { meter: THREE, punch: { inBar: 1.6, outBar: 2.2 } });
  assert.equal(clip.startBar, 1.6);
  near(clip.lengthBars, 0.6);
});

test('in 3/4 a note quantized onto the clip end grows the clip by a measure, not a whole note', () => {
  const q = quantizeTakeClip(clipOf([['C4', 0.74]], 1, 0.75), '1/16', true, THREE);
  near(q.notes[0].startOffset, 0.75);
  near(q.lengthBars, 1.5);
  // 4/4 grows a bar, as before
  const four = quantizeTakeClip(clipOf([['C4', 0.99]], 1, 1), '1/16', true, { base: { num: 4, den: 4 }, points: [] });
  assert.equal(four.lengthBars, 2);
  // A clip off a measure line doesn't grow
  const off = quantizeTakeClip(clipOf([['C4', 0.74]], 1.25, 0.75), '1/16', true, THREE);
  near(off.lengthBars, 0.75);
});

test("a take in the song's last measure stops at the timeline's end, whatever the meter", () => {
  // In 3/2 the last measure starts on bar 400 and would run to 401.5, past the end (401)
  const THREE_TWO = { base: { num: 3, den: 2 }, points: [] };
  for (const meter of [THREE_TWO, { base: { num: 7, den: 4 }, points: [] }, SEVEN]) {
    const take = createTake(400.2);
    take.noteOn(60, 'C4', 0.8, 400.25, at(400.25));
    take.noteOff(60, at(400.5));
    const clip = take.finish(400.5, at(400.5), BPM, { meter });
    assert.ok(clip.startBar + clip.lengthBars <= 401 + 1e-9, `${meter.base.num}/${meter.base.den}: ${clip.startBar}..${clip.startBar + clip.lengthBars}`);
    assert.ok(clip.notes.every((n) => n.startOffset < clip.lengthBars));
    // Quantize doesn't take it past the end either, nor keep a clip that already ran past it
    for (const grid of ['1/16', '1/4', '1']) {
      const q = quantizeTakeClip(clipOf([['C4', clip.notes[0].startOffset]], clip.startBar, clip.lengthBars), grid, true, meter);
      assert.ok(q.startBar + q.lengthBars <= 401 + 1e-9, `${grid}: ${q.startBar}..${q.startBar + q.lengthBars}`);
    }
  }
  const long = quantizeTakeClip(clipOf([['C4', 0.25]], 400, 1.5), '1/16', true, THREE_TWO);
  assert.equal(long.lengthBars, 1);
  // A take earlier in the song keeps its whole measure
  const take = createTake(398.6);
  take.noteOn(60, 'C4', 0.8, 398.75, at(398.75));
  take.noteOff(60, at(399));
  const clip = take.finish(399, at(399), BPM, { meter: THREE_TWO });
  near(clip.startBar, 398.5);
  near(clip.lengthBars, 1.5);
});
