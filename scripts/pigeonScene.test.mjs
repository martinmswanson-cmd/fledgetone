// Pigeons video (src/audio/pigeonScene.ts): no two pigeons ever touch, every frame, and each bird's
// footprint really holds its model (so footprints apart means birds apart).
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

const T = await import('three');
const { planPigeons, posedAt, overlapOf, makePigeon, applyPose, BIRD_SHAPE, keyBoxes, bedBox, KEY_PRESS, birdsOnKeys, keyDown, keyAt, KEY_TRAVEL, peckAt, padKey } = await import('../src/audio/pigeonScene.ts');
const { stageFor, isFastPart, drumKind, bankShape, padSpot, PAD_W, PAD_D, PAD_GAP } = await import('../src/audio/pigeonStage.ts');

const note = (start, len, midi, track = 0) => ({ start, end: start + len, midi, color: '#888', track, drum: false });
const data = (notes) => ({ notes: notes.sort((a, b) => a.start - b.start), tracks: [], bars: [] });

/** Chords, a bass and a melody with a fast run, at 140 BPM */
function tune() {
  const beat = 60 / 140;
  const notes = [];
  const chords = [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]];
  for (let bar = 0; bar < 8; bar++) {
    const c = chords[bar % 4];
    for (const m of c) notes.push(note(bar * 4 * beat, 4 * beat - 0.05, m, 1));
    for (let q = 0; q < 4; q++) notes.push(note((bar * 4 + q) * beat, beat * 0.8, c[0] - 12, 2));
  }
  const melody = [74, 77, 81, 79, 77, 76, 74, 72, 74, 77, 81, 84, 82, 81, 79, 77, 76, 77, 79, 81, 82, 84, 86, 84, 81, 0, 79, 0, 77, 76, 74, 0];
  for (let rep = 0; rep < 2; rep++) melody.forEach((m, i) => m && notes.push(note(rep * 16 * beat + (i * beat) / 2, (beat / 2) * 0.9, m)));
  return data(notes);
}

/** The hard cases: semitone clusters, a chromatic run in 16ths, leaps across the keyboard, a note repeated fast, moving clusters */
function stress() {
  const b = 60 / 160;
  const notes = [];
  for (let i = 0; i < 8; i++) for (let m = 60; m <= 66; m++) notes.push(note(i * b * 2, b * 1.5, m + (i % 2) * 3, 0));
  for (let i = 0; i < 64; i++) notes.push(note(16 * b + (i * b) / 4, (b / 4) * 0.95, 48 + (i < 32 ? i : 64 - i), 1));
  for (let i = 0; i < 32; i++) notes.push(note(16 * b + (i * b) / 2, (b / 2) * 0.9, i % 2 ? 84 : 36, 2));
  for (let i = 0; i < 48; i++) notes.push(note(32 * b + (i * b) / 6, (b / 6) * 0.9, 67, 3));
  for (let i = 0; i < 16; i++) for (const m of [55, 56, 58, 59, 61]) notes.push(note(32 * b + (i * b) / 2, (b / 2) * 0.9, m + (i % 3), 4));
  return data(notes);
}

/** Random notes, many at once (the same every run) */
function random() {
  let s = 7;
  const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const notes = [];
  for (let i = 0; i < 400; i++) notes.push(note(r() * 30, 0.05 + r() * 1.5, 36 + Math.floor(r() * 50), i % 5));
  return data(notes);
}

for (const [name, song] of [['a tune', tune()], ['the hard cases', stress()], ['random notes', random()]]) {
  test(`no two pigeons touch, at any frame (60 a second): ${name}`, () => {
    const plan = planPigeons(song);
    const end = Math.max(...song.notes.map((n) => n.end)) + 3;
    let worst = -Infinity;
    let where = '';
    let flutters = 0;
    for (let t = -0.5; t < end; t += 1 / 60) {
      const posed = posedAt(plan, t);
      if (posed.some((b) => b.flutter)) flutters++;
      for (let i = 0; i < posed.length; i++) {
        for (let j = i + 1; j < posed.length; j++) {
          const { depth } = overlapOf(posed[i], posed[j]);
          if (depth > worst) {
            worst = depth;
            where = `t ${t.toFixed(3)}: birds ${i} (${posed[i].leg.kind}) and ${j} (${posed[j].leg.kind})`;
          }
        }
      }
    }
    // (depth counts a small gap kept between birds: up to it, they're still apart)
    assert.ok(worst < 0.019, `birds touch, ${worst.toFixed(4)} deep, at ${where}`);
    // and none had to be lifted over another (a jump): they all found room on the ground
    assert.equal(flutters, 0);
  });
}

test("a bird's footprint holds its whole model, in every pose", () => {
  const plan = planPigeons(stress());
  const geo = new T.CircleGeometry(0.5, 8);
  const mat = new T.MeshBasicMaterial();
  const v = new T.Vector3();
  let worst = -Infinity;
  for (let t = 0; t < 17; t += 0.031) {
    const posed = posedAt(plan, t);
    plan.pigeons.forEach((p, i) => {
      const model = makePigeon(p.seed, p.size, geo, mat);
      applyPose(model, posed[i], t, p.seed);
      model.root.updateMatrixWorld(true);
      const inv = model.root.matrixWorld.clone().invert();
      model.root.traverse((o) => {
        if (!(o instanceof T.Mesh) || o === model.shadow) return;
        const pos = o.geometry.getAttribute('position');
        for (let k = 0; k < pos.count; k++) {
          // In the bird's own units (its footprint is given in them)
          v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
          const along = Math.min(BIRD_SHAPE.HEAD, Math.max(BIRD_SHAPE.TAIL, v.x));
          // (the feet may dip a little into the floor: that's not another bird)
          worst = Math.max(worst, Math.hypot(v.x - along, v.z) - posed[i].reach, v.y - BIRD_SHAPE.HEIGHT, -v.y - 0.15);
        }
      });
    });
  }
  assert.ok(worst <= 1e-6, `part of a bird is ${worst.toFixed(4)} outside its footprint`);
});

test('birds on neighbouring keys fit side by side, and a white key and the black key beside it', () => {
  // A chromatic cluster of a whole octave, held: every bird stands on its key, untouched
  const notes = [];
  for (let m = 60; m < 72; m++) notes.push(note(1, 2, m));
  const plan = planPigeons(data(notes));
  const posed = posedAt(plan, 2);
  const playing = posed.filter((b) => b.leg.kind === 'press');
  assert.equal(playing.length, 12);
  for (const b of playing) assert.ok(Math.hypot(b.pos.x - b.leg.from.x, b.pos.z - b.leg.from.z) < 1e-9, 'a bird playing was moved off its spot');
});

test('a bird playing the same key again hops on the spot to strike it afresh', () => {
  // The same note four times, with a gap, back to back, and fast
  const notes = [note(1, 0.5, 60), note(2, 0.5, 60), note(2.5, 0.5, 60), note(3, 0.1, 60), note(3.1, 0.1, 60)];
  const plan = planPigeons(data(notes));
  const bird = plan.pigeons.find((p) => p.legs.some((l) => l.kind === 'press'));
  const presses = bird.legs.filter((l) => l.kind === 'press');
  assert.equal(presses.length, 5, 'one bird plays all five');
  const hops = bird.legs.filter((l) => l.kind === 'hop' && l.from.distanceTo(l.to) < 1e-6);
  assert.equal(hops.length, 4, 'a hop on the spot before each repeat');
  for (const hop of hops) {
    // It lands as the note it's for starts, and is off the key in the middle of the hop
    const next = presses.find((p) => p.t0 >= hop.t1 - 1e-9);
    assert.ok(next && Math.abs(next.note.start - hop.t1) < 1e-6);
    const mid = posedAt(plan, (hop.t0 + hop.t1) / 2)[plan.pigeons.indexOf(bird)];
    assert.ok(mid.lift > 0.1, `it only rose ${mid.lift.toFixed(3)}`);
  }
});

test('a long jump is flown with the wings out; a side-step to the next key is not', () => {
  const wingsOut = (notes) => {
    const plan = planPigeons(data(notes));
    let most = 0;
    let far = 0;
    for (let t = 0; t < 4; t += 1 / 120) {
      for (const b of posedAt(plan, t)) {
        if (b.leg.kind !== 'hop' && b.leg.kind !== 'fly') continue;
        // (only jumps between keys: the birds' first hops up from the floor are flown anyway)
        if (!(b.leg.from.y > 0 && b.leg.to.y > 0)) continue;
        most = Math.max(most, b.reach);
        far = Math.max(far, Math.hypot(b.leg.to.x - b.leg.from.x, b.leg.to.z - b.leg.from.z));
      }
    }
    return { most, far };
  };
  // C then D, a key apart: a hop, wings folded
  const step = wingsOut([note(1, 0.3, 60), note(2, 0.3, 62)]);
  assert.ok(step.far > 0.9 && step.far < 1.4);
  assert.equal(step.most, BIRD_SHAPE.RADIUS);
  // C then the G above, a few keys along: flown, wings right out
  const jump = wingsOut([note(1, 0.3, 60), note(2, 0.3, 67)]);
  assert.ok(jump.far >= 1.4);
  assert.ok(jump.most > BIRD_SHAPE.SPAN - 0.01, `its wings only reached ${jump.most.toFixed(3)}`);
});

test('wings open only as far as there is room: in a crowd they stay off the neighbours', () => {
  // Two birds side-step past... no: two birds fly to neighbouring keys at once, between birds holding the keys either side
  const notes = [note(0.5, 4, 60), note(0.5, 4, 67), note(0.5, 0.3, 48), note(0.5, 0.3, 84), note(2, 0.5, 62), note(2, 0.5, 65)];
  const plan = planPigeons(data(notes));
  let spread = 0;
  for (let t = 0; t < 5; t += 1 / 120) {
    const posed = posedAt(plan, t);
    for (let i = 0; i < posed.length; i++) {
      spread = Math.max(spread, posed[i].reach);
      for (let j = i + 1; j < posed.length; j++) assert.ok(overlapOf(posed[i], posed[j]).depth < 0.019, `wings touch at ${t.toFixed(3)}`);
    }
  }
  assert.ok(spread > BIRD_SHAPE.RADIUS + 0.3, 'and they did open');
});

test('no piano key shares space with another, pressed or not, and none comes out of the key bed', () => {
  const low = 36;
  const high = 96;
  const keys = keyBoxes(low, high);
  const bed = bedBox(low, high);
  assert.equal(keys.length, high - low + 1);
  const down = (b, by) => ({ ...b, y0: b.y0 - by, y1: b.y1 - by });
  const meet = (a, b) => a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.y0 < b.y1 - 1e-9 && b.y0 < a.y1 - 1e-9 && a.z0 < b.z1 - 1e-9 && b.z0 < a.z1 - 1e-9;
  for (const key of keys) {
    for (const by of [0, KEY_PRESS / 2, KEY_PRESS]) {
      for (const box of key.boxes.map((b) => down(b, by))) {
        // Its underside stays down inside the bed and above the floor; its top stays up out of the bed; it's within the bed's edges
        assert.ok(box.y0 > 0 && box.y0 < bed.y1, `key ${key.midi}, down ${by}: its underside is at ${box.y0.toFixed(2)}`);
        assert.ok(box.y1 > bed.y1 + 0.1, `key ${key.midi}, down ${by}: its top is at ${box.y1.toFixed(2)}`);
        assert.ok(box.x0 > bed.x0 && box.x1 < bed.x1 && box.z0 > bed.z0 && box.z1 < bed.z1, `key ${key.midi} is within the bed`);
      }
    }
  }
  // Every pair of neighbours (a key only comes near the two keys either side of it, and the white keys beyond those), each at rest or right down
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < Math.min(keys.length, i + 4); j++) {
      for (const pi of [0, KEY_PRESS]) for (const pj of [0, KEY_PRESS]) for (const a of keys[i].boxes) for (const b of keys[j].boxes) assert.ok(!meet(down(a, pi), down(b, pj)), `keys ${keys[i].midi} and ${keys[j].midi} share space`);
    }
  }
  // A black key stands in the cuts of the white keys beside it, with a gap; a pressed black key still stands proud of them
  const cSharp = keys.find((k) => k.midi === 61).boxes[0];
  const c = keys.find((k) => k.midi === 60).boxes;
  assert.ok(c[1].x1 < cSharp.x0 && c[1].x1 > cSharp.x0 - 0.1, 'the white key is cut back to just clear the black one');
  assert.ok(c[0].x1 > cSharp.x0, "and its head, in front of the black key, is the key's full width");
  assert.ok(cSharp.y1 - KEY_PRESS > c[0].y1);
  // A white key with no black key on a side (E to F) isn't cut on that side
  const e = keys.find((k) => k.midi === 64).boxes;
  assert.ok(Math.abs(e[1].x1 - e[0].x1) < 1e-9 && e[1].x0 > e[0].x0);
});

test('the count of pigeons on the keys is the birds you can see on them, playing or not', () => {
  // Three notes held together, then nothing: the birds stand on their keys a moment after, then get down
  const plan = planPigeons(data([note(2, 1, 60), note(2, 1, 64), note(2, 1, 67)]));
  assert.equal(birdsOnKeys(plan, 0), 0, 'none before they hop up');
  assert.equal(birdsOnKeys(plan, 2.5), 3, 'three playing');
  assert.equal(birdsOnKeys(plan, 3.1), 3, 'still on their keys just after the notes end');
  assert.equal(birdsOnKeys(plan, 12), 0, 'down again in the end');
  // The same key again and again: the one bird stays counted through its hops on the spot
  const again = planPigeons(data([0, 1, 2, 3].map((k) => note(1 + k * 0.5, 0.5, 60))));
  for (let t = 1; t < 3; t += 1 / 60) assert.equal(birdsOnKeys(again, t), 1, `at ${t.toFixed(2)}`);
  // On a whole tune, at every frame: it's exactly the birds whose feet are at a key's height (on a key
  // or just over it in a small hop) and not flying; and every one counted is over the keyboard
  const song = tune();
  const p = planPigeons(song);
  const [low, high] = [p.low, p.high];
  const bed = bedBox(low, high);
  let most = 0;
  for (let t = -0.5; t < 16; t += 1 / 30) {
    const posed = posedAt(p, t);
    const seen = posed.filter((b) => b.leg.kind !== 'fly' && b.leg.from.y > 0 && b.leg.to.y > 0);
    assert.equal(birdsOnKeys(p, t), seen.length);
    for (const b of seen) {
      assert.ok(b.pos.y > 0.5 && b.lift < 0.7, `a counted bird is at a key's height at ${t.toFixed(2)}`);
      assert.ok(b.pos.x > bed.x0 && b.pos.x < bed.x1 && b.pos.z > bed.z0 && b.pos.z < bed.z1, `and over the keyboard at ${t.toFixed(2)}`);
    }
    // And none standing still on a key is left out
    for (const b of posed) if ((b.leg.kind === 'stand' || b.leg.kind === 'press') && b.pos.y > 0.5) assert.ok(seen.includes(b));
    most = Math.max(most, seen.length);
    // (it's never fewer than the birds playing, which is all the old count had)
    assert.ok(seen.length >= posed.filter((b) => b.leg.kind === 'press').length);
  }
  assert.ok(most >= 4);
});

test('a key goes down as its note starts, never before: the press is seen when the note is heard', () => {
  const n = note(2, 1, 60);
  // Up until the note starts (a frame before, at 60 a second, it hasn't moved), right down within two frames, held, up after it ends
  assert.equal(keyDown(n, 2 - 1 / 60), 0);
  assert.equal(keyDown(n, 2), 0);
  assert.ok(keyDown(n, 2 + 1 / 60) > KEY_PRESS * 0.5);
  assert.ok(Math.abs(keyDown(n, 2 + KEY_TRAVEL) - KEY_PRESS) < 1e-9);
  assert.ok(KEY_TRAVEL <= 2 / 60 + 1e-9);
  assert.ok(Math.abs(keyDown(n, 2.9) - KEY_PRESS) < 1e-9);
  assert.equal(keyDown(n, 3.2), 0);
  // And the bird: no bird is ever on a key, playing it, before its note starts; each lands as it starts
  for (const song of [tune(), stress()]) {
    const plan = planPigeons(song);
    let landings = 0;
    for (const p of plan.pigeons) {
      for (const leg of p.legs) {
        if (leg.kind !== 'press') continue;
        assert.ok(leg.t0 >= leg.note.start - 1e-9, `a bird starts playing ${(leg.note.start - leg.t0).toFixed(3)} s before its note`);
        if (Math.abs(leg.t0 - leg.note.start) < 1e-9) landings++;
      }
    }
    assert.ok(landings > 20);
  }
});

test('every note is seen played: one that starts on a key already held is struck afresh', () => {
  // A chord note held for three seconds (one part), and a tune that plays the same key three times inside it (another part)
  const held = { ...note(1, 3, 60, 0), color: '#111111' };
  const again = [1.5, 2.25, 3].map((t) => ({ ...note(t, 0.4, 60, 1), color: '#eeeeee' }));
  const plan = planPigeons(data([held, ...again]));
  const bird = plan.pigeons.find((p) => p.legs.some((l) => l.kind === 'press'));
  assert.equal(plan.pigeons.filter((p) => p.legs.some((l) => l.kind === 'press')).length, 1, 'one bird, on the one key');
  // It lands as each note starts: four strikes, a hop on the spot before each of the last three
  const presses = bird.legs.filter((l) => l.kind === 'press');
  assert.deepEqual(presses.map((l) => l.t0), [1, 1.5, 2.25, 3]);
  assert.equal(bird.legs.filter((l) => l.kind === 'hop' && l.from.distanceTo(l.to) < 1e-6).length, 3);
  assert.ok(presses[presses.length - 1].t1 >= 4 - 1e-9, 'and it stays on while the held note lasts');
  const notes = plan.byKey.get(60);
  for (const n of again) {
    // The key: right down well before; part of the way up just before the strike; down again within its travel; showing the new note
    assert.ok(Math.abs(keyAt(notes, n.start - 0.3).down - KEY_PRESS) < 1e-9);
    const before = keyAt(notes, n.start - 0.005).down;
    assert.ok(before < KEY_PRESS * 0.6 && before > KEY_PRESS * 0.3, `just before the strike it is ${(before / KEY_PRESS).toFixed(2)} of the way down`);
    assert.ok(Math.abs(keyAt(notes, n.start + KEY_TRAVEL + 0.001).down - KEY_PRESS) < 1e-6);
    assert.equal(keyAt(notes, n.start + 0.1).lit, n);
    // and the bird is off the key in the middle of its hop
    const mid = posedAt(plan, n.start - 0.08)[plan.pigeons.indexOf(bird)];
    assert.ok(mid.leg.kind === 'hop' && mid.lift > 0.15);
  }
  // Between the tune's notes the key shows the held note again, and after everything it's up
  assert.equal(keyAt(notes, 2.05).lit, held);
  assert.equal(keyAt(notes, 4.5).down, 0);
  // Two parts starting the same note together: one strike, no hop
  const together = planPigeons(data([note(1, 1, 64, 0), note(1, 2, 64, 1)]));
  const b2 = together.pigeons.find((p) => p.legs.some((l) => l.kind === 'press'));
  assert.equal(b2.legs.filter((l) => l.kind === 'press').length, 1);
  assert.ok(b2.legs.find((l) => l.kind === 'press').t1 >= 3 - 1e-9);

  // And in whole songs: every note has a bird landing on its key as it starts (but one starting together with another on the same key)
  for (const song of [tune(), stress()]) {
    const p = planPigeons(song);
    const strikes = p.pigeons.flatMap((b) => b.legs.filter((l) => l.kind === 'press'));
    let seen = 0;
    for (const n of p.notes) {
      const struck = strikes.some((l) => l.key === n.midi && Math.abs(l.t0 - n.start) < 1e-6);
      const together = p.notes.some((o) => o !== n && o.midi === n.midi && Math.abs(o.start - n.start) < 0.04);
      const tight = p.notes.some((o) => o !== n && o.midi === n.midi && o.start < n.start && n.start - o.start < 0.1);
      if (struck) seen++;
      else assert.ok(together || tight, `nothing is seen for ${n.midi} at ${n.start.toFixed(3)}`);
    }
    assert.ok(seen > p.notes.length * 0.9);
  }
});

// ---------------------------------------------------------------------------------------------
// A fast song's stage (src/audio/pigeonStage.ts): fast parts on banks of pads, the drums on drum pads

/** A busy song: slow chords, a fast arpeggio on eight pitches (16ths at 150 BPM), a fast bass on three, a lead, and drums */
function fastSong() {
  const notes = [];
  const step = 0.1;
  const arp = [60, 63, 67, 70, 72, 75, 79, 82];
  let seed = 11;
  const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 300; i++) {
    notes.push(note(i * step, 0.08, arp[Math.floor(r() * arp.length)], 1));
    if (i % 2 === 0) notes.push(note(i * step, 0.15, [36, 39, 43][Math.floor(r() * 3)], 2));
    if (i % 3 === 0) notes.push(note(i * step, 0.09, arp[Math.floor(r() * arp.length)], 1));
  }
  for (let b = 0; b < 8; b++) for (const m of [48, 55, 60, 63]) notes.push(note(b * 3.75, 3.6, m, 0));
  for (let i = 0; i < 40; i++) notes.push(note(i * 0.75, 0.6, 72 + Math.floor(r() * 8), 3));
  const hit = (t, midi, kick) => ({ start: t, end: t + 0.1, midi, color: '#888', track: 4, drum: true, ...(kick ? { kick: true } : {}) });
  for (let i = 0; i < 300; i++) {
    notes.push(hit(i * step, 30));
    if (i % 4 === 0) notes.push(hit(i * step, 24, true));
    if (i % 8 === 4) notes.push(hit(i * step, 26));
  }
  const d = data(notes);
  d.tracks = ['Chords', 'Arp', 'Bass', 'Lead', 'Drums'].map((name, i) => ({ name, color: ['#a855f7', '#3b82f6', '#22c55e', '#ec4899', '#888888'][i] }));
  return d;
}

test('a stage sorts a song: fast parts to banks of pads, the drums to drum pads, the rest to the keyboard', () => {
  const song = fastSong();
  assert.equal(isFastPart(song.notes.filter((n) => n.track === 1)), true);
  assert.equal(isFastPart(song.notes.filter((n) => n.track === 0)), false, 'slow chords stay on the keys');
  assert.equal(isFastPart(song.notes.filter((n) => n.track === 3)), false, 'and a tune of longer notes');
  // (too many pitches for a bank of pads: a fast run over three octaves stays on the keys)
  assert.equal(isFastPart(Array.from({ length: 80 }, (_, i) => note(i * 0.1, 0.08, 40 + (i % 36)))), false);
  const stage = stageFor(song, true, () => 0);
  assert.deepEqual(stage.banks.map((b) => b.name), ['Bass', 'Arp'], 'lowest part at the left');
  assert.deepEqual(stage.banks[1].pitches, [60, 63, 67, 70, 72, 75, 79, 82]);
  assert.deepEqual(stage.drums.map((d) => d.kind), ['kick', 'snare', 'hat']);
  assert.deepEqual([...new Set(stage.keys.map((n) => n.track))].sort(), [0, 3]);
  assert.equal(stage.keys.length + stage.banks.reduce((a, b) => a + b.notes.length, 0), song.notes.filter((n) => !n.drum).length, 'every pitched note is somewhere');
  // The pads of a bank: one a pitch, none sharing floor with another, and no bank with another
  for (const b of stage.banks) {
    const spots = b.pitches.map((m) => padSpot(b, m));
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.abs(spots[i].x - spots[j].x) >= PAD_W + PAD_GAP - 1e-9 || Math.abs(spots[i].z - spots[j].z) >= PAD_D + PAD_GAP - 1e-9);
  }
  assert.ok(stage.banks[0].x + (bankShape(3).cols * (PAD_W + PAD_GAP)) / 2 < stage.banks[1].x - (bankShape(8).cols * (PAD_W + PAD_GAP)) / 2);
  // Off, it's as it was: everything pitched on the keyboard, no drums
  const plain = stageFor(song, false, () => 0);
  assert.deepEqual([plain.banks.length, plain.drums.length, plain.keys.length], [0, 0, song.notes.filter((n) => !n.drum).length]);
  // A song of nothing but fast parts keeps one for the keyboard
  const allFast = data([...Array.from({ length: 40 }, (_, i) => note(i * 0.1, 0.08, 60 + (i % 4), 0)), ...Array.from({ length: 60 }, (_, i) => note(i * 0.1, 0.08, 72 + (i % 5), 1))]);
  const one = stageFor(allFast, true, () => 0);
  assert.equal(one.banks.length, 1);
  assert.ok(one.keys.length > 0);
  // Which drum a hit is
  assert.deepEqual([{ midi: 24 }, { midi: 60, kick: true }, { midi: 38 }, { midi: 42 }, { midi: 50 }].map(drumKind), ['kick', 'kick', 'snare', 'hat', 'other']);
});

test('on a stage no two pigeons touch, at any frame, and none has to be lifted over another', () => {
  const song = fastSong();
  const plan = planPigeons(song, { pads: true });
  assert.deepEqual([plan.pigeons.filter((p) => p.role === 'kick').length, plan.pigeons.filter((p) => p.role === 'drum').length], [1, 2]);
  assert.ok(plan.pigeons.filter((p) => p.role === 'pad').length >= 4);
  const end = Math.max(...song.notes.map((n) => n.end)) + 3;
  let worst = -Infinity;
  let where = '';
  let flutters = 0;
  for (let t = -0.5; t < end; t += 1 / 60) {
    const posed = posedAt(plan, t);
    if (posed.some((b) => b.flutter)) flutters++;
    for (let i = 0; i < posed.length; i++) {
      for (let j = i + 1; j < posed.length; j++) {
        const { depth } = overlapOf(posed[i], posed[j]);
        if (depth > worst) {
          worst = depth;
          where = `t ${t.toFixed(3)}: birds ${i} (${plan.pigeons[i].role ?? 'keys'}) and ${j} (${plan.pigeons[j].role ?? 'keys'})`;
        }
      }
    }
  }
  assert.ok(worst < 0.019, `birds touch, ${worst.toFixed(4)} deep, at ${where}`);
  assert.equal(flutters, 0);
});

test('every fast note is seen struck on its pad as it starts, by a bird that is on that pad', () => {
  const song = fastSong();
  const plan = planPigeons(song, { pads: true });
  plan.stage.banks.forEach((bank, bi) => {
    const birds = plan.pigeons.filter((p) => p.role === 'pad' && p.legs.some((l) => l.note && l.note.track === bank.track));
    assert.ok(birds.length >= 2 && birds.length <= 4);
    for (const n of bank.notes) {
      const spot = padSpot(bank, n.midi);
      // A bird is standing on the note's pad as it starts (landed for it, or on it still from the same note a moment before)
      const on = birds.some((b) => b.legs.some((l) => l.kind === 'press' && l.t0 <= n.start + 1e-6 && l.t1 > n.start && Math.abs(l.to.x - spot.x) < 1e-6 && Math.abs(l.to.z - spot.z) < 1e-6));
      assert.ok(on, `no bird on the pad for ${n.midi} at ${n.start.toFixed(2)} (${bank.name})`);
      // and the pad lights for it
      assert.ok(keyAt(plan.byPad.get(padKey(bi, n.midi)), n.start + KEY_TRAVEL + 0.001).down > 0);
    }
    // No bird leaves its bank: every leg of it starts and ends on one of its pads
    const spots = bank.pitches.map((m) => padSpot(bank, m));
    for (const b of birds) for (const l of b.legs) assert.ok(spots.some((s) => Math.abs(l.to.x - s.x) < 1e-6 && Math.abs(l.to.z - s.z) < 1e-6));
  });
  // The keyboard is only as long as the slow parts need, and its birds play only those
  assert.ok(plan.low <= 48 && plan.high >= 79 && plan.high - plan.low <= 48);
  for (const p of plan.pigeons.filter((x) => !x.role)) for (const l of p.legs) if (l.note) assert.ok([0, 3].includes(l.note.track));
});

test('a drum bird pecks as each hit lands, and the kick bird stomps its pad', () => {
  const hits = [1, 1.1, 2];
  assert.equal(peckAt(hits, 0.5), 0);
  assert.ok(Math.abs(peckAt(hits, 1) - 1) < 1e-9, 'beak on the drum as the hit sounds');
  assert.ok(peckAt(hits, 1.05) > 0.2 && peckAt(hits, 1.05) < 1, 'between quick hits it only comes part of the way up');
  assert.ok(Math.abs(peckAt(hits, 1.1) - 1) < 1e-9);
  assert.equal(peckAt(hits, 1.5), 0);
  const song = fastSong();
  const plan = planPigeons(song, { pads: true });
  const kick = plan.pigeons.find((p) => p.role === 'kick');
  const stomps = kick.legs.filter((l) => l.kind === 'press').map((l) => +l.t0.toFixed(4));
  assert.deepEqual(stomps, plan.stage.drums[0].hits.map((t) => +t.toFixed(4)));
  for (const p of plan.pigeons.filter((x) => x.role === 'drum')) assert.ok(p.pecks.length > 0);
  // The count of pigeons on the keys is of the keyboard's birds: the pads' and drums' aren't in it
  let most = 0;
  for (let t = 0; t < 30; t += 0.25) most = Math.max(most, birdsOnKeys(plan, t));
  assert.ok(most >= 4 && most <= plan.pigeons.filter((p) => !p.role).length);
});
