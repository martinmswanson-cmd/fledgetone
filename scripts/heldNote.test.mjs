// Living notes (src/audio/samplers/heldNote.ts): how a held note of a bowed or blown instrument
// moves once its track's Living notes is on: its level through the note, its pitch, and when its
// vibrato comes in. Measured against real playing (a held note's level moves 5 to 6 dB, its pitch
// drifts 9 to 31 cents, its vibrato is there from the start); set gentler than that. Tracks without
// it play as they did. Run with `npm test`.
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

const H = await import('../src/audio/samplers/heldNote.ts');

/** A note's own "random" numbers, -1 to 1 by salt, as noteJitter gives them (here from a seed). */
const jitterOf = (seed) => (salt) => Math.sin(seed * 12.9898 + salt * 78.233) * 0.999;
const db = (g) => 20 * Math.log10(g);
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

test('a held note is never louder than it was: its level tops out at exactly its own', () => {
  for (const seed of SEEDS)
    for (const seconds of [0.3, 0.6, 1.4, 4, 20]) {
      const c = H.levelCurve(seconds, jitterOf(seed));
      assert.ok(Math.max(...c) <= 1 + 1e-6, `seed ${seed}, ${seconds} s: ${Math.max(...c)}`);
      assert.ok(Math.max(...c) > 0.999, `seed ${seed}, ${seconds} s tops out at ${db(Math.max(...c)).toFixed(2)} dB`);
    }
});

test('a long note comes up to its loudest between a quarter and just over half way, then eases off by 1.5 to 4 dB', () => {
  for (const seed of SEEDS) {
    const c = Array.from(H.levelCurve(2, jitterOf(seed)));
    const top = c.indexOf(Math.max(...c)) / (c.length - 1);
    assert.ok(top >= 0.25 && top <= 0.58, `seed ${seed}: loudest ${Math.round(top * 100)}% of the way`);
    assert.ok(db(c[0]) <= -0.8 + 1e-6 && db(c[0]) >= -2 - 1e-6, `seed ${seed}: starts at ${db(c[0]).toFixed(2)} dB`);
    const end = db(c[c.length - 1]);
    assert.ok(end <= -1.5 + 1e-6 && end >= -4 - 1e-6, `seed ${seed}: ends at ${end.toFixed(2)} dB`);
    // No step between neighbouring points anyone could hear as a jump
    for (let i = 1; i < c.length; i++) assert.ok(Math.abs(db(c[i]) - db(c[i - 1])) < 0.6, `seed ${seed}: a step of ${Math.abs(db(c[i]) - db(c[i - 1])).toFixed(2)} dB`);
  }
});

test('a short note eases off less: one of half a second by half as much as one of a second or more', () => {
  for (const seed of SEEDS) {
    const long = Array.from(H.levelCurve(1.5, jitterOf(seed)));
    const short = Array.from(H.levelCurve(0.5, jitterOf(seed)));
    assert.ok(Math.abs(db(short[short.length - 1]) - db(long[long.length - 1]) / 2) < 0.01, `seed ${seed}: ${db(short[short.length - 1]).toFixed(2)} against ${db(long[long.length - 1]).toFixed(2)}`);
  }
});

test('no two notes are shaped alike, and the same note is shaped the same every time (an export repeats)', () => {
  const a = Array.from(H.levelCurve(2, jitterOf(1)));
  const b = Array.from(H.levelCurve(2, jitterOf(2)));
  assert.notDeepEqual(a, b);
  assert.deepEqual(Array.from(H.levelCurve(2, jitterOf(1))), a);
  const p = Array.from(H.pitchCurve(2, true, jitterOf(1)));
  assert.notDeepEqual(Array.from(H.pitchCurve(2, true, jitterOf(2))), p);
  assert.deepEqual(Array.from(H.pitchCurve(2, true, jitterOf(1))), p);
});

test("a soloist's pitch sits up to 3.5 cents off true and drifts slowly, never more than 9 cents from the note", () => {
  const offs = [];
  for (const seed of SEEDS) {
    const c = Array.from(H.pitchCurve(3, true, jitterOf(seed)));
    assert.ok(Math.max(...c.map(Math.abs)) <= 9, `seed ${seed}: ${Math.max(...c.map(Math.abs)).toFixed(1)} cents`);
    // It moves: at least 3 cents between its lowest and highest over three seconds
    assert.ok(Math.max(...c) - Math.min(...c) >= 3, `seed ${seed}: moves ${(Math.max(...c) - Math.min(...c)).toFixed(1)} cents`);
    // Slowly: under 2 cents from one point to the next (25 points a second)
    for (let i = 1; i < c.length; i++) assert.ok(Math.abs(c[i] - c[i - 1]) < 2, `seed ${seed}: jumps ${Math.abs(c[i] - c[i - 1]).toFixed(2)} cents`);
    offs.push(H.pitchOffset(true, jitterOf(seed)));
  }
  assert.ok(Math.max(...offs.map(Math.abs)) <= 3.5);
  assert.ok(Math.max(...offs) - Math.min(...offs) > 2, 'notes differ in tuning');
});

test("a section's pitch stays true on average (a chord of them mustn't turn sour) and drifts half as far", () => {
  for (const seed of SEEDS) {
    assert.equal(H.pitchOffset(false, jitterOf(seed)), 0);
    const c = Array.from(H.pitchCurve(3, false, jitterOf(seed)));
    assert.ok(Math.max(...c.map(Math.abs)) <= 2.8 + 1e-9, `seed ${seed}: ${Math.max(...c.map(Math.abs)).toFixed(2)} cents`);
  }
});

test('a pitch curve has 25 points a second and at least 8, so a short note still moves smoothly', () => {
  assert.equal(H.pitchCurve(2, true, jitterOf(1)).length, 50);
  assert.equal(H.pitchCurve(0.1, true, jitterOf(1)).length, 8);
});

test('vibrato on a living note is all there within a quarter second and starts near its speed; without it, as it always was', () => {
  for (const j of [-1, 0, 1]) {
    const live = H.vibratoOnset(false, true, j);
    assert.ok(live.delay >= 0.02 && live.delay + live.ramp <= 0.25, `${live.delay} + ${live.ramp}`);
    assert.ok(live.from >= 0.9);
    // As before Living notes: a fifth of a second or so in, growing over half a second, from 82% of its speed over 0.9 s
    assert.deepEqual(H.vibratoOnset(false, false, j), { delay: 0.2 + 0.06 * j, ramp: 0.5, from: 0.82, settle: 0.9, first: 1 });
    assert.deepEqual(H.vibratoOnset(true, false, j), { delay: 0.03, ramp: 0.25, from: 0.95, settle: 0.3, first: 0.8 });
  }
  // A legato change keeps the hand going either way
  assert.ok(H.vibratoOnset(true, true, 0).delay <= 0.03);
});

test('which instruments it is for: bowed strings and the sustained winds and brass, not pianos, guitars or kits', async () => {
  const { livesWhenHeld } = await import('../src/audio/instrumentCatalog.ts');
  for (const key of ['realViolin', 'realSoloCello', 'realViolins', 'realStrings', 'realHorn', 'realTrumpet', 'realBrass', 'realOboe', 'realClarinet']) assert.equal(livesWhenHeld(key), true, key);
  for (const key of ['realGrandPiano', 'realNylonGuitar', 'studioKit', 'supersaw', 'realViolinsShort', 'realPizzicato', 'realHarp']) assert.equal(livesWhenHeld(key), false, key);
});

test('the solo strings play a quicker vibrato when living, and their own when not', async () => {
  const { INSTRUMENTS } = await import('../src/audio/instrumentCatalog.ts');
  for (const key of ['realViolin', 'realViola', 'realSoloCello', 'realContrabass']) {
    const v = INSTRUMENTS[key].vibrato;
    assert.ok(v.living.hz > v.hz && v.living.hz <= 7, `${key}: ${v.living.hz} Hz against ${v.hz}`);
    assert.ok(v.living.cents >= 10 && v.living.cents <= 20, `${key}: ${v.living.cents} cents`);
  }
  // (as they were before Living notes: a song without it must not change)
  assert.deepEqual([INSTRUMENTS.realViolin.vibrato.cents, INSTRUMENTS.realViolin.vibrato.hz], [15, 5.6]);
  assert.deepEqual([INSTRUMENTS.realSoloCello.vibrato.cents, INSTRUMENTS.realSoloCello.vibrato.hz], [13, 5.2]);
});

test('a new track has Living notes; a track saved without it opens without it, and keeps it once saved with it', async () => {
  const { makeTrack } = await import('../src/store/trackFactory.ts');
  assert.equal(makeTrack('realViolin', []).living, true);
  const { parseProject, serializeProject } = await import('../src/store/project.ts');
  const { createStarter } = await import('../src/store/starters.ts');
  const song = createStarter('celtic');
  assert.ok(song.tracks.every((t) => t.living === undefined), 'a starter is as it was mixed');
  const file = JSON.parse(JSON.stringify(serializeProject(song)));
  assert.ok(parseProject(file).tracks.every((t) => t.living === undefined));
  file.tracks[0].living = true;
  file.tracks[1].living = 'yes';
  const opened = parseProject(file);
  assert.equal(opened.tracks[0].living, true);
  assert.equal(opened.tracks[1].living, undefined);
  assert.equal(JSON.parse(JSON.stringify(serializeProject(opened))).tracks[0].living, true);
});
