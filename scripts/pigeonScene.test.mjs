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
const { planPigeons, posedAt, overlapOf, makePigeon, applyPose, BIRD_SHAPE } = await import('../src/audio/pigeonScene.ts');

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
    // It lands just before the note it's for, and is off the key in the middle of the hop
    const next = presses.find((p) => p.t0 >= hop.t1 - 1e-9);
    assert.ok(next && Math.abs(next.note.start - 0.05 - hop.t1) < 1e-6);
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
