// Unit tests for playback timing (swing, whole Transport ticks) and the clip note marks' paths.
// Run with `npm test`.
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
const Tone = await import('tone');
const { swingDelay, swungNotes } = await import('../src/audio/transport.ts');
const { shadeNotes } = await import('../src/components/timeline/noteShades.ts');

/** The delay Tone's own swing (16n subdivision) gives a note on `tick`. */
function toneSwing(tick, swing, bpm, ppq = 192) {
  const swingTicks = ppq / 4;
  if (!(swing > 0) || tick % ppq === 0 || tick % (swingTicks * 2) === 0) return 0;
  const progress = (tick % (swingTicks * 2)) / (swingTicks * 2);
  return ((swingTicks * 2) / 3 / ppq) * (60 / bpm) * (Math.sin(progress * Math.PI) * swing);
}

/** What swing does to each of these ticks in one clip starting on `clipStart`: true = played late. */
const swungAt = (ticks, clipStart = 0) => Object.fromEntries(swungNotes(ticks, clipStart).map((swung, i) => [ticks[i], swung]));

test('swing delays off-beat 16ths exactly as Tone did', () => {
  for (const bpm of [60, 97.3, 140, 174, 240]) {
    for (const swing of [0.05, 0.2, 0.5]) {
      for (let tick = 48; tick < 768 * 4; tick += 96) {
        assert.equal(swingDelay(swing, bpm), toneSwing(tick, swing, bpm), `tick ${tick} at ${bpm} BPM, swing ${swing}`);
        assert.ok(swingDelay(swing, bpm) > 0);
      }
    }
  }
  // swing x 32 ticks (a third of an 8th): 16 ticks at 50%, the 1/8-triplet line; 41.7 ms at 120 BPM
  assert.ok(Math.abs(swingDelay(0.5, 120) - 16 * (60 / 120 / 192)) < 1e-15);
});

test('swing picks out the off-beat 16ths of a 16th or 8th groove, and nothing else', () => {
  const sixteenths = Array.from({ length: 32 }, (_, i) => 48 * i);
  swungNotes(sixteenths, 0).forEach((swung, i) => assert.equal(swung, i % 2 === 1, `16th ${i}`));
  // Downbeats, 8ths and triplet lines on their own never swing
  for (let tick = 0; tick < 768 * 2; tick++) {
    if (tick % 96 === 48) continue;
    if (tick % 48 === 0 || tick % 32 === 0) assert.equal(swungNotes([tick], 0)[0], false, `tick ${tick}`);
  }
});

test('an 8th with notes between its 16ths plays straight, so 1/32 rolls and triplet runs stay even', () => {
  // A 16th groove with a 1/32 roll over the second beat: that beat's off-beat 16ths go straight, the rest swing
  const groove = [0, 48, 96, 144, 192, 216, 240, 264, 288, 312, 336, 360, 384, 432, 480, 528];
  assert.deepEqual(
    groove.filter((t, i) => swungNotes(groove, 0)[i]),
    [48, 144, 432, 528]
  );
  // 1/32 triplets (16 ticks) and 1/16 triplets (32) around an off-beat 16th
  assert.deepEqual(swungAt([0, 16, 32, 48, 64, 80]), { 0: false, 16: false, 32: false, 48: false, 64: false, 80: false });
  assert.deepEqual(swungAt([0, 48, 64]), { 0: false, 48: false, 64: false });
  // A 1/32 pickup into the next 8th straightens the 8th it sits in only
  assert.deepEqual(swungAt([0, 48, 72, 96, 144]), { 0: false, 48: false, 72: false, 96: false, 144: true });
  // Notes nudged a little off the 16ths (flams, a loose hand) are not a run
  assert.deepEqual(swungAt([3, 45, 52, 93, 146]), { 3: false, 45: true, 52: true, 93: false, 146: true });
  // Each clip judges its own notes: a clip with only the off-beat 16th swings it
  assert.deepEqual(swungAt([48]), { 48: true });
});

test('a note nudged off an off-beat 16th swings while it is nearer to it than to a triplet line', () => {
  for (let d = -7; d <= 7; d++) assert.equal(swungNotes([48 + 96 * 3 + d], 0)[0], true, `${d} ticks off`);
  for (const d of [-8, 8, -16, 16]) assert.equal(swungNotes([48 + d], 0)[0], false, `${d} ticks off`);
});

test('a clip placed off the 16th grid swings on its own grid', () => {
  const clipGroove = [0, 48, 96, 144];
  for (const start of [5, 20, 24, 768 + 11, 768 * 7 + 24]) {
    const ticks = clipGroove.map((t) => start + t);
    assert.deepEqual(swungNotes(ticks, start), [false, true, false, true], `clip on tick ${start}`);
  }
  // Nearer the next 16th line, it counts from that one: a clip starting just before an off-beat
  // 16th is a pickup, so its first note swings
  for (const start of [25, 40, 47]) {
    const ticks = clipGroove.map((t) => start + t);
    assert.deepEqual(swungNotes(ticks, start), [true, false, true, false], `clip on tick ${start}`);
  }
  // On the grid, the song's 16ths decide (a clip may start on an off-beat 16th)
  assert.deepEqual(swungNotes([48, 96, 144], 48), [true, false, true]);
});

test('a clip split or trimmed off the grid swings its notes as before the cut', () => {
  const sixteenths = Array.from({ length: 16 }, (_, i) => 768 + 48 * i);
  const whole = swungNotes(sixteenths, 0);
  // The razor with Snap off or Frame snap, a start trim, Shift Insert bars: the piece starts 8 to
  // 24 ticks past a 16th line, its notes stay on the song's 16ths
  for (const cut of [762, 768 + 8, 768 + 12, 768 + 17, 768 + 24, 768 + 36]) {
    const piece = sixteenths.filter((t) => t >= cut);
    assert.deepEqual(swungNotes(piece, cut), whole.slice(sixteenths.length - piece.length), `cut at tick ${cut}`);
  }
  // A clip moved off the grid and then split: its notes keep the moved grid
  const moved = sixteenths.map((t) => t + 20);
  for (const cut of [768 + 5, 768 + 120]) {
    const piece = moved.filter((t) => t >= cut);
    assert.deepEqual(swungNotes(piece, cut), swungNotes(moved, 788).slice(moved.length - piece.length), `moved clip cut at tick ${cut}`);
  }
  // Loose timing still counts as on the clip's grid, cut or not
  const loose = [3, 45, 52, 93, 146, 189, 245];
  assert.deepEqual(swungNotes(loose, 12), swungNotes(loose, 0));
  // A lone note between the 16ths says nothing about the grid: a 1/32 pickup stays straight
  assert.deepEqual(swungNotes([72], 0), [false]);
  // Rolls and triplet runs stay straight wherever the clip was cut
  assert.deepEqual(swungNotes([24, 48, 72, 96], 20), [false, false, false, false]);
  assert.deepEqual(swungNotes([32, 64, 96, 128], 30), [false, false, false, false]);
});

test('no swing, no delay', () => {
  assert.equal(swingDelay(0, 140), 0);
  assert.equal(swingDelay(-0.1, 140), 0);
  assert.equal(swingDelay(Number.NaN, 140), 0);
  assert.deepEqual(swungNotes([], 0), []);
});

test('Transport positions in whole ticks come back whole at every tempo (toneFixes)', async () => {
  /** A Transport time as Tone works it out, against a context at `bpm` (only the tempo and PPQ are read). */
  const ticksAt = (bpm, time) => new Tone.TransportTimeClass({ transport: { bpm: { value: bpm }, PPQ: 192 } }, time).toTicks();
  // Without the fix about one in ten come back a hair off, these two among them
  await import('../src/audio/toneFixes.ts');
  assert.equal(ticksAt(130, '768i'), 768);
  assert.equal(ticksAt(150, '1536i'), 1536);
  let checked = 0;
  for (let hundredths = 4000; hundredths <= 24000; hundredths += 7) {
    const bpm = hundredths / 100;
    for (let tick = 0; tick <= 400 * 768; tick += 4801) {
      for (const t of [tick - (tick % 24), tick - (tick % 32), tick - (tick % 48)]) {
        assert.equal(ticksAt(bpm, `${t}i`), t, `${t}i at ${bpm} BPM`);
        checked++;
      }
    }
  }
  assert.ok(checked > 500000);
  // Positions between ticks are left as they are
  assert.ok(Math.abs(ticksAt(120, 0.001) - 0.384) < 1e-9);
});

test('clip note marks: one path per shade, each note a rectangle on whole pixels', () => {
  const shades = shadeNotes([
    { left: 0, width: 9, top: 18, height: 4.4, opacity: 0.89 },
    { left: 10, width: 9, top: 22.4, height: 4.4, opacity: 0.891 },
    { left: 20.4, width: 0.3, top: 30.6, height: 0.2, opacity: 1 },
  ]);
  assert.equal(shades.length, 2);
  assert.deepEqual(shades[0], { opacity: 0.89, d: 'M0 18H9V22H0zM10 22H19V27H10z' });
  // Never thinner than a pixel
  assert.deepEqual(shades[1], { opacity: 1, d: 'M20 31H21V32H20z' });
  assert.deepEqual(shadeNotes([]), []);
});
