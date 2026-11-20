// Pigeons video (src/audio/pigeonLooks.ts): the backgrounds and camera angles, and when a video
// changes from one to the next.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { PIGEON_BACKGROUNDS, PIGEON_CAMERAS, BACKGROUND_FADE, DEFAULT_PIGEON_CHOICES, cleanLook, everyBars, turnAt, backgroundAt, cameraAt, readPigeonChoices, lookFor } = await import('../src/audio/pigeonLooks.ts');

test('every background and camera angle has its own id, a name and a blurb, and colours that are colours', () => {
  for (const list of [PIGEON_BACKGROUNDS, PIGEON_CAMERAS]) {
    assert.equal(new Set(list.map((x) => x.id)).size, list.length);
    for (const x of list) assert.ok(x.name && x.blurb, x.id);
  }
  for (const b of PIGEON_BACKGROUNDS) for (const c of [b.floor, b.sky, b.bounce, b.sun]) assert.match(c, /^#[0-9a-f]{6}$/, b.id);
  // A dark floor is marked dark (the export's text goes light over it), and a pale one isn't
  const light = (hex) => (0.2126 * parseInt(hex.slice(1, 3), 16) + 0.7152 * parseInt(hex.slice(3, 5), 16) + 0.0722 * parseInt(hex.slice(5, 7), 16)) / 255;
  for (const b of PIGEON_BACKGROUNDS) assert.equal(b.dark, light(b.floor) < 0.4, `${b.id}: ${light(b.floor).toFixed(2)}`);
  // An angle never looks along the floor or lies the keyboard flat on its side
  for (const c of PIGEON_CAMERAS) assert.ok(c.pitch > 0.3 && c.pitch < Math.PI / 2 && c.furthest > 0 && c.furthest <= 1, c.id);
});

test('every so many bars: the bar lines after the first, by time', () => {
  const bars = [0, 2, 4, 6, 8, 10, 12];
  assert.deepEqual(everyBars(bars, 2), [4, 8, 12]);
  assert.deepEqual(everyBars(bars, 4), [8]);
  assert.deepEqual(everyBars(bars, 1), [2, 4, 6, 8, 10, 12]);
  assert.deepEqual(everyBars(bars, 8), []);
  for (const bad of [0, -3, NaN, 0.4]) assert.deepEqual(everyBars(bars, bad), []);
});

test('how many changes have passed, and how long since the last', () => {
  assert.deepEqual(turnAt([], 5), { turns: 0, since: Infinity });
  assert.deepEqual(turnAt([4, 8], 3.9), { turns: 0, since: Infinity });
  assert.deepEqual(turnAt([4, 8], 4), { turns: 1, since: 0 });
  assert.deepEqual(turnAt([4, 8], 9.5), { turns: 2, since: 1.5 });
});

test('backgrounds go round in the order chosen, each fading in; cameras cut', () => {
  const look = cleanLook({ backgrounds: ['night', 'space', 'park'], backgroundAt: [10, 20, 30, 40], cameras: ['low', 'above'], cameraAt: [5, 15] });
  assert.deepEqual(backgroundAt(look, 0), { now: 'night', from: 'night', mix: 1 });
  assert.deepEqual(backgroundAt(look, 9.99), { now: 'night', from: 'night', mix: 1 });
  // The fade: from the last one, halfway at half its length, done at its end
  assert.deepEqual(backgroundAt(look, 10), { now: 'space', from: 'night', mix: 0 });
  const half = backgroundAt(look, 10 + BACKGROUND_FADE / 2);
  assert.ok(Math.abs(half.mix - 0.5) < 1e-9);
  assert.equal(backgroundAt(look, 10 + BACKGROUND_FADE).mix, 1);
  assert.equal(backgroundAt(look, 25).now, 'park');
  // Round again
  assert.deepEqual(backgroundAt(look, 31), { now: 'night', from: 'park', mix: 1 });
  assert.equal(backgroundAt(look, 45).now, 'space');
  assert.deepEqual([0, 4.9, 5, 14, 15, 99].map((t) => cameraAt(look, t)), ['low', 'low', 'above', 'above', 'low', 'low']);
});

test('a look is made safe: unknown ids dropped, at least one of each, times in order and after the start', () => {
  assert.deepEqual(cleanLook(), { backgrounds: ['plaza'], backgroundAt: [], cameras: ['diagonal'], cameraAt: [] });
  assert.deepEqual(cleanLook({ backgrounds: ['moon', 'snow', 'snow', 7], backgroundAt: [9, 'x', 3, 0, -1, NaN], cameras: [], cameraAt: null }), { backgrounds: ['snow'], backgroundAt: [3, 9], cameras: ['diagonal'], cameraAt: [] });
  // (the order given is kept: it's the order they appear in)
  assert.deepEqual(cleanLook({ backgrounds: ['beach', 'plaza'] }).backgrounds, ['beach', 'plaza']);
});

test("the dialog's choices: read back safely, and made into a look from the song's bars and sections", () => {
  assert.deepEqual(readPigeonChoices(null), DEFAULT_PIGEON_CHOICES);
  assert.deepEqual(readPigeonChoices({ backgrounds: ['space', 'nope', 'plaza'], backgroundWhen: 'weekly', backgroundBars: 900, cameras: 'low', cameraWhen: 'none', cameraBars: 2.6 }), {
    // (in the list's order, as the dialog shows them)
    backgrounds: ['plaza', 'space'],
    backgroundWhen: 'sections',
    backgroundBars: 64,
    cameras: ['diagonal'],
    cameraWhen: 'none',
    cameraBars: 3,
  });
  const bars = [0, 2, 4, 6, 8, 10];
  const sections = [0, 4, 8];
  const choices = { backgrounds: ['plaza', 'night'], backgroundWhen: 'sections', backgroundBars: 8, cameras: ['diagonal', 'above', 'close'], cameraWhen: 'bars', cameraBars: 2 };
  // (the section at the very start isn't a change)
  assert.deepEqual(lookFor(choices, bars, sections), { backgrounds: ['plaza', 'night'], backgroundAt: [4, 8], cameras: ['diagonal', 'above', 'close'], cameraAt: [4, 8] });
  assert.deepEqual(lookFor({ ...choices, backgroundWhen: 'none', cameraWhen: 'sections' }, bars, sections).backgroundAt, []);
  // One ticked: nothing to change to
  assert.deepEqual(lookFor({ ...choices, backgrounds: ['night'], cameras: ['low'] }, bars, sections), { backgrounds: ['night'], backgroundAt: [], cameras: ['low'], cameraAt: [] });
});
