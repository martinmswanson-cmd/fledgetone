// Pigeons video (src/audio/pigeonLooks.ts): the backgrounds and camera angles, and when a video
// changes from one to the next.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { PIGEON_BACKGROUNDS, PIGEON_CAMERAS, BACKGROUND_FADE, DEFAULT_PIGEON_CHOICES, MOTIONS, SENSE_STEP, cleanLook, everyBars, turnAt, backgroundAt, cameraAt, readPigeonChoices, lookFor, senseMusic, pulseAt, energyAt, travelAt, flaresAt, uprightRoll } = await import('../src/audio/pigeonLooks.ts');

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
  assert.deepEqual(cleanLook(), { backgrounds: ['plaza'], backgroundAt: [], cameras: ['diagonal'], cameraAt: [], motion: 1, pads: true, whole: false });
  assert.deepEqual(cleanLook({ backgrounds: ['moon', 'snow', 'snow', 7], backgroundAt: [9, 'x', 3, 0, -1, NaN], cameras: [], cameraAt: null }), { backgrounds: ['snow'], backgroundAt: [3, 9], cameras: ['diagonal'], cameraAt: [], motion: 1, pads: true, whole: false });
  assert.deepEqual([cleanLook({ motion: 0.3 }).motion, cleanLook({ motion: 7 }).motion, cleanLook({ motion: -1 }).motion, cleanLook({ motion: 'lots' }).motion], [0.3, 1, 0, 1]);
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
    motion: 'music',
    pads: true,
    whole: false,
  });
  assert.equal(readPigeonChoices({ whole: true }).whole, true);
  assert.equal(readPigeonChoices({ pads: false }).pads, false);
  assert.equal(readPigeonChoices({ motion: 'still' }).motion, 'still');
  const bars = [0, 2, 4, 6, 8, 10];
  const sections = [0, 4, 8];
  const choices = { backgrounds: ['plaza', 'night'], backgroundWhen: 'sections', backgroundBars: 8, cameras: ['diagonal', 'above', 'close'], cameraWhen: 'bars', cameraBars: 2, motion: 'calm', pads: true, whole: false };
  // (the section at the very start isn't a change)
  assert.deepEqual(lookFor(choices, bars, sections), { backgrounds: ['plaza', 'night'], backgroundAt: [4, 8], cameras: ['diagonal', 'above', 'close'], cameraAt: [4, 8], motion: 0.5, pads: true, whole: false });
  assert.deepEqual(lookFor({ ...choices, backgroundWhen: 'none', cameraWhen: 'sections' }, bars, sections).backgroundAt, []);
  // One ticked: nothing to change to
  assert.deepEqual(lookFor({ ...choices, backgrounds: ['night'], cameras: ['low'] }, bars, sections), { backgrounds: ['night'], backgroundAt: [], cameras: ['low'], cameraAt: [], motion: 0.5, pads: true, whole: false });
  assert.deepEqual(MOTIONS.map((m) => [m.id, m.amount]), [['music', 1], ['calm', 0.5], ['still', 0]]);
});

// --- What the backgrounds hear of the music ---

const note = (start, len, midi, extra = {}) => ({ start, end: start + len, midi, ...extra });
/** 32 s: a quiet first half (a note a second), a busy second half (eight a second), a kick on every half second throughout */
function song() {
  const notes = [];
  for (let t = 0; t < 16; t += 1) notes.push(note(t, 0.4, 60));
  for (let t = 16; t < 32; t += 0.125) notes.push(note(t, 0.1, 60 + (Math.round(t * 8) % 12)));
  for (let t = 0; t < 32; t += 0.5) notes.push(note(t, 0.05, 36, { drum: true, kick: true }));
  return notes;
}

test('the beat is the kicks, or the bar lines of a song with none; a jump rises at once and dies away', () => {
  const sense = senseMusic(song(), [0, 2, 4]);
  assert.equal(sense.beats.length, 64);
  assert.deepEqual(sense.beats.slice(0, 3), [0, 0.5, 1]);
  // No kicks: the bar lines
  assert.deepEqual(senseMusic([note(0, 1, 60), note(1, 1, 62)], [0, 2, 4]).beats, [0, 2, 4]);
  // Two hits at once are one beat
  assert.equal(senseMusic([0, 0.01, 1, 2, 3].map((t) => note(t, 0.1, 36, { kick: true })), []).beats.length, 4);
  assert.equal(pulseAt(sense, -1), 0);
  assert.equal(pulseAt(sense, 4), 0, 'on the beat itself it has yet to rise');
  assert.ok(pulseAt(sense, 4.02) > 0.9, 'a fiftieth of a second later it is right up');
  assert.ok(pulseAt(sense, 4.25) < 0.4 && pulseAt(sense, 4.25) > 0.2);
  assert.ok(pulseAt(sense, 4.49) < 0.15);
  // And it's never out of range
  for (let t = -2; t < 40; t += 0.013) assert.ok(pulseAt(sense, t) >= 0 && pulseAt(sense, t) <= 1);
});

test('how busy the music is: low in the quiet half, high in the busy half, changing smoothly, always 0 to 1', () => {
  const sense = senseMusic(song(), []);
  assert.ok(energyAt(sense, 8) < 0.45, `quiet: ${energyAt(sense, 8).toFixed(2)}`);
  assert.ok(energyAt(sense, 24) > 0.9, `busy: ${energyAt(sense, 24).toFixed(2)}`);
  let last = energyAt(sense, -1);
  for (let t = -1; t < 40; t += 1 / 60) {
    const e = energyAt(sense, t);
    assert.ok(e >= 0 && e <= 1);
    assert.ok(Math.abs(e - last) < 0.03, `no jump between frames at ${t.toFixed(2)}: ${last.toFixed(3)} to ${e.toFixed(3)}`);
    last = e;
  }
  // A song with no notes is still (and nothing breaks)
  const empty = senseMusic([], []);
  assert.equal(energyAt(empty, 3), 0);
  assert.equal(pulseAt(empty, 3), 0);
  assert.deepEqual(flaresAt(empty, 3).map((f) => f.glow), [0, 0, 0, 0]);
});

test('drifting things only ever go forward, between two fifths of full speed and full speed: faster in busy passages', () => {
  const sense = senseMusic(song(), []);
  let last = travelAt(sense, -2);
  for (let t = -2 + 1 / 60; t < 45; t += 1 / 60) {
    const now = travelAt(sense, t);
    const speed = (now - last) * 60;
    assert.ok(speed > 0.39 && speed < 1.001, `speed ${speed.toFixed(3)} at ${t.toFixed(2)}`);
    last = now;
  }
  const quiet = travelAt(sense, 12) - travelAt(sense, 4);
  const busy = travelAt(sense, 28) - travelAt(sense, 20);
  assert.ok(busy > quiet * 1.4, `quiet ${quiet.toFixed(2)}, busy ${busy.toFixed(2)}`);
  assert.equal(sense.travel.length, sense.energy.length);
  assert.ok(Math.abs(sense.travel.length * SENSE_STEP - 34) < 1);
});

test('the calm backgrounds stay calm: the clouds, the plaza, the beach and the sunset drift slowly, whatever the music does', () => {
  const by = Object.fromEntries(PIGEON_BACKGROUNDS.map((b) => [b.id, b]));
  for (const b of PIGEON_BACKGROUNDS) assert.ok(b.lively >= 0 && b.lively <= 1 && b.drift >= 0, b.id);
  for (const id of ['clouds', 'plaza', 'beach', 'sunset']) assert.ok(by[id].lively <= 0.3, `${id} is calm`);
  assert.ok(by.neon.lively > by.clouds.lively * 3, 'and the future city is not');
  // How fast a background's drifting things cross the floor, in white keys' widths a second, as the scene works it out (pigeonScene.ts, dress):
  // its drift speed times a pace that's part steady and part the music's (which runs at 0.4 to 1)
  const sense = senseMusic(song(), []);
  const speedAt = (b, t) => b.drift * ((1 - b.lively) * 0.7 + b.lively * (travelAt(sense, t + 1 / 60) - travelAt(sense, t)) * 60);
  let slowest = Infinity;
  let fastest = 0;
  for (let t = 0; t < 32; t += 0.1) {
    const v = speedAt(by.clouds, t);
    slowest = Math.min(slowest, v);
    fastest = Math.max(fastest, v);
  }
  // The clouds: never more than a key's width in six seconds, and nearly the same pace in the quiet half and the busy one
  assert.ok(fastest <= 1 / 6, `the clouds reach ${fastest.toFixed(3)} keys a second`);
  assert.ok(fastest / slowest < 1.25, `their pace changes by ${(fastest / slowest).toFixed(2)} times`);
  // No background's drifting things ever outrun its drift speed, and none drifts faster than a key's width a second
  for (const b of PIGEON_BACKGROUNDS) {
    for (let t = 0; t < 32; t += 0.5) assert.ok(speedAt(b, t) <= b.drift + 1e-9, b.id);
    assert.ok(b.drift <= 1, b.id);
  }
});

test('struck notes light the details in turn: the newest brightest, fading, and a different group each time', () => {
  const sense = senseMusic([0, 1, 2, 3, 4].map((t) => note(t, 0.5, 60 + t)), []);
  assert.deepEqual(flaresAt(sense, -1).map((f) => f.group), [-1, -1, -1, -1]);
  const at = flaresAt(sense, 3.1);
  assert.ok(at[0].glow > at[1].glow && at[1].glow > at[2].glow && at[2].glow > at[3].glow);
  assert.ok(at[0].glow > 0.8 && at[3].glow < 0.01);
  assert.equal(new Set(at.map((f) => f.group)).size, 4);
  for (const f of at) assert.ok(f.group >= 0 && f.group < 8);
});

test('every camera angle is the right way up, with the keyboard at its slope; low notes on the left from the front, on the right from behind', async () => {
  const T = await import('three');
  // The keys run along x, rising with pitch, their fronts toward +z (pigeonScene.ts); the camera is aimed as the scene aims it
  const at = (cam, tall, v) => {
    const c = new T.OrthographicCamera(-10, 10, 10, -10, -400, 600);
    c.position.set(Math.sin(cam.yaw) * Math.cos(cam.pitch) * 120, Math.sin(cam.pitch) * 120, Math.cos(cam.yaw) * Math.cos(cam.pitch) * 120);
    c.lookAt(new T.Vector3(0, 0, 0));
    c.updateMatrixWorld();
    const e = c.matrixWorld.elements;
    c.rotateZ(uprightRoll(e[0], e[4], tall ? cam.slope.tall : cam.slope.wide));
    c.updateMatrixWorld();
    return new T.Vector3(...v).project(c);
  };
  for (const cam of PIGEON_CAMERAS) {
    for (const tall of [true, false]) {
      const where = `${cam.id}, ${tall ? 'tall' : 'wide'}`;
      // Up is up: a point above the keys is higher on screen (a bird stands on its feet)
      assert.ok(at(cam, tall, [0, 3, 0]).y > at(cam, tall, [0, 0, 0]).y + 0.01, `${where}: upside down`);
      // The keyboard runs at the angle's slope (either way along it)
      const low = at(cam, tall, [-7, 0, 0]);
      const high = at(cam, tall, [7, 0, 0]);
      const slope = Math.atan2(high.y - low.y, high.x - low.x);
      const want = tall ? cam.slope.tall : cam.slope.wide;
      const off = Math.abs(Math.atan2(Math.sin(slope - want), Math.cos(slope - want)));
      assert.ok(Math.min(off, Math.PI - off) < 1e-6, `${where}: the keyboard runs at ${slope.toFixed(3)}, not ${want}`);
      // From in front (the player's side) the low notes are on the left and the white keys' fronts nearest (lowest on screen); from behind, the other way round
      const behind = Math.cos(cam.yaw) < 0;
      assert.equal(low.x < high.x, !behind, `${where}: low notes on the ${low.x < high.x ? 'left' : 'right'}`);
      if (cam.pitch < 1.4) assert.equal(at(cam, tall, [0, 0, 3]).y < at(cam, tall, [0, 0, -3]).y, !behind, `${where}: which edge of the keys is nearest`);
    }
  }
  // The roll is never more than a quarter turn, whatever it's asked
  for (let a = -3.1; a < 3.14; a += 0.37) for (const slope of [-1, -0.3, 0, 0.3, 1]) assert.ok(Math.abs(uprightRoll(Math.cos(a), Math.sin(a), slope)) <= Math.PI / 2 + 1e-9);
});
