// Unit tests for re-pitched copies of recordings: the windowed-sinc resampler's quality (images,
// flatness to 20 kHz, timing), loops moved onto whole frames, the copy cache (least recently used
// first out, pins, a recording's copies going with it), and which pitches a song plays each
// recording at (src/audio/samplers/resampler.ts, copyCache.ts, songSamples.ts). Run with `npm test`.
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

const R = await import('../src/audio/samplers/resampler.ts');
const { CopyCache } = await import('../src/audio/samplers/copyCache.ts');
const S = await import('../src/audio/samplers/songSamples.ts');

const db = (x) => 10 * Math.log10(Math.max(x, 1e-30));
const sine = (hz, rate, n, phase = 0) => {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * hz * i) / rate + phase);
  return x;
};

/**
 * A copy of a sine at `hz` (of the source) `semis` semitones up, against the ideal sine at that
 * position: the error under the signal (dB), in the middle of the copy.
 */
function errorOf(hz, semis, inRate, outRate, playRate, band) {
  const ratio = 2 ** (semis / 12);
  const n = 12000;
  const x = sine(hz, inRate, n);
  const plan = R.planCopy(ratio, inRate, outRate, n);
  const [y] = R.resample([x], plan, R.copyKernel(ratio, inRate, outRate, playRate, band));
  let e = 0;
  let s = 0;
  for (let m = 1500; m < plan.length - 1500; m++) {
    const ideal = Math.sin((2 * Math.PI * hz * (plan.start + m * plan.step)) / inRate);
    e += (y[m] - ideal) ** 2;
    s += ideal * ideal;
  }
  return db(e / s);
}

/** What comes out of a copy for a sine at `hz` of the source that should have been filtered away: its level (dB under the input). */
function leakOf(hz, semis, inRate, outRate, playRate, band) {
  const ratio = 2 ** (semis / 12);
  const n = 12000;
  const x = sine(hz, inRate, n);
  const plan = R.planCopy(ratio, inRate, outRate, n);
  const [y] = R.resample([x], plan, R.copyKernel(ratio, inRate, outRate, playRate, band));
  let e = 0;
  for (let m = 1500; m < plan.length - 1500; m++) e += y[m] * y[m];
  return db(e / (plan.length - 3000) / 0.5);
}

test('a copy is the recording at the new pitch to within -80 dB, flat to 20 kHz (44.1 and 48 kHz, decoded at twice the rate and at it)', () => {
  for (const play of [44100, 48000]) {
    for (const [inRate, outRate, band] of [
      [2 * play, 2 * play, 24000],
      [play, play, play / 2],
    ]) {
      for (const semis of [-6, -3, -1, 1, 3, 6]) {
        const ratio = 2 ** (semis / 12);
        for (const out of [1000, 5000, 10000, 15000, 18000, 20000]) {
          const hz = out / ratio;
          // (only what the source can hold)
          if (hz > Math.min(band, 0.49 * inRate)) continue;
          const err = errorOf(hz, semis, inRate, outRate, play, band);
          assert.ok(err < -80, `${play} Hz, from ${inRate} Hz, ${semis} semitones, ${out} Hz out: ${err.toFixed(1)} dB`);
        }
      }
    }
  }
});

test('what would fold back below 20 kHz is at least 80 dB down', () => {
  // Pitched up, a source's top goes past the context's Nyquist: an oversampled copy is read every
  // other frame there with no filter, so it must already be clean
  for (const play of [44100, 48000]) {
    for (const semis of [1, 3, 6]) {
      const ratio = 2 ** (semis / 12);
      // A source tone that lands above play - 20 kHz once pitched (it would fold to under 20 kHz)
      const hz = Math.min(23900, (play - 20000 + 600) / ratio);
      if (hz * ratio < play - 20000) continue;
      const leak = leakOf(hz, semis, 2 * play, 2 * play, play, 24000);
      assert.ok(leak < -80, `${play}, ${semis} st, a ${hz.toFixed(0)} Hz source tone: ${leak.toFixed(1)} dB`);
    }
  }
});

test('a copy keeps its timing: an impulse lands where the ratio says, and the level of a steady signal is exact', () => {
  const inRate = 96000;
  const x = new Float32Array(9600);
  x[4800] = 1;
  for (const semis of [-3, 2, 7]) {
    const ratio = 2 ** (semis / 12);
    const plan = R.planCopy(ratio, inRate, inRate, x.length);
    const [y] = R.resample([x], plan, R.copyKernel(ratio, inRate, inRate, 48000, 24000));
    let at = 0;
    for (let i = 1; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[at])) at = i;
    assert.ok(Math.abs(at - 4800 / ratio) <= 1, `${semis}: peak at ${at}, expected ${4800 / ratio}`);
  }
  const dc = new Float32Array(4000).fill(0.5);
  const plan = R.planCopy(2 ** (5 / 12), inRate, inRate, dc.length);
  const [y] = R.resample([dc], plan, R.copyKernel(2 ** (5 / 12), inRate, inRate, 48000, 24000));
  for (let i = 400; i < plan.length - 400; i++) assert.ok(Math.abs(y[i] - 0.5) < 1e-5);
});

test('stereo copies are each channel copied alike', () => {
  const a = sine(3000, 96000, 6000);
  const b = sine(7000, 96000, 6000, 1);
  const plan = R.planCopy(1.1, 96000, 96000, 6000);
  const k = R.copyKernel(1.1, 96000, 96000, 48000, 24000);
  const [l, r] = R.resample([a, b], plan, k);
  const [l1] = R.resample([a], plan, k);
  const [r1] = R.resample([b], plan, k);
  assert.deepEqual(l, l1);
  assert.deepEqual(r, r1);
});

test('a loop moves with the copy, onto whole frames, the ratio a hair off at most', () => {
  for (const [semis, loop] of [
    [1, [0.4123, 0.9876]],
    [-3, [1.25, 1.31]],
    [6, [0.05, 2.5]],
  ]) {
    const ratio = 2 ** (semis / 12);
    const inRate = 96000;
    const plan = R.planCopy(ratio, inRate, inRate, 3 * inRate, loop);
    const [s, e] = plan.loop;
    // Whole frames of the copy
    assert.ok(Math.abs(s * inRate - Math.round(s * inRate)) < 1e-6);
    assert.ok(Math.abs(e * inRate - Math.round(e * inRate)) < 1e-6);
    // Its start reads the source's loop start exactly, its end the source's loop end
    const k0 = Math.round(s * inRate);
    const k1 = Math.round(e * inRate);
    assert.ok(Math.abs(plan.start + k0 * plan.step - loop[0] * inRate) < 1e-6);
    assert.ok(Math.abs(plan.start + k1 * plan.step - loop[1] * inRate) < 1e-6);
    // The copy starts no more than a frame early
    assert.ok(plan.start <= 0 && plan.start > -plan.step);
    // Scaled by the ratio (to within half a frame), and the pitch off by under half a cent
    assert.ok(Math.abs((e - s) - (loop[1] - loop[0]) / ratio) <= 0.5 / inRate + 1e-9);
    assert.ok(Math.abs(1200 * Math.log2(plan.ratio / ratio)) < 0.5, `${semis}: ${plan.ratio / ratio}`);
  }
  // A copy at the context's rate from a recording decoded at twice it: its loop on the copy's whole frames
  const half = R.planCopy(2 ** (2 / 12), 96000, 48000, 3 * 96000, [0.4123, 0.9876]);
  const [hs, he] = half.loop;
  assert.ok(Math.abs(hs * 48000 - Math.round(hs * 48000)) < 1e-6 && Math.abs(he * 48000 - Math.round(he * 48000)) < 1e-6);
  assert.ok(Math.abs(half.start + Math.round(hs * 48000) * half.step - 0.4123 * 96000) < 1e-6);
  assert.ok(Math.abs(1200 * Math.log2(half.ratio / 2 ** (2 / 12))) < 0.5);
  // No loop: the copy reads from the start, at the ratio asked for
  const plain = R.planCopy(2 ** (2 / 12), 48000, 48000, 48000);
  assert.equal(plain.start, 0);
  assert.equal(plain.ratio, 2 ** (2 / 12));
  assert.equal(plain.length, Math.ceil(48000 / 2 ** (2 / 12)));
  // A slice: only its stretch, from its first frame
  const slice = R.planCopy(0.5, 48000, 48000, 48000, undefined, [0.25, 0.5]);
  assert.equal(slice.start, 12000);
  assert.equal(slice.length, 24000);
});

test('a looped copy loops seamlessly: across the loop it is the source read on', () => {
  // A source that's periodic over its loop: what the copy plays after its loop end is what it played after its loop start
  const inRate = 96000;
  const period = 96000 / 440;
  const loop = [0.5, 0.5 + (40 * period) / inRate];
  const x = sine(440, inRate, inRate * 2);
  const ratio = 2 ** (3 / 12);
  const plan = R.planCopy(ratio, inRate, inRate, x.length, loop);
  const [y] = R.resample([x], plan, R.copyKernel(ratio, inRate, inRate, 48000, 24000));
  const k0 = Math.round(plan.loop[0] * inRate);
  const k1 = Math.round(plan.loop[1] * inRate);
  for (let i = 0; i < 50; i++) assert.ok(Math.abs(y[k0 + i] - y[k1 + i]) < 1e-3, `${i}: ${y[k0 + i]} vs ${y[k1 + i]}`);
});

test('a copy is long enough for the whole recording at its speed', () => {
  const plan = R.planCopy(2 ** (-5 / 12), 96000, 96000, 96000);
  assert.ok(Math.abs(plan.length - 96000 / 2 ** (-5 / 12)) < 1.01);
  // A copy at the context's rate from one decoded at twice it: half the frames
  const half = R.planCopy(1, 96000, 48000, 96000);
  assert.equal(half.length, 48000);
  assert.equal(half.step, 2);
});

test('a level outline is stretched to the copy, never quieter', () => {
  const o = new Float32Array([1, 0.5, 0.25, 0.125, 0.0625, 0.03]);
  assert.deepEqual([...R.stretchOutline(o, 2)], [1, 0.25, 0.0625]);
  const slow = R.stretchOutline(o, 0.5);
  assert.equal(slow.length, 12);
  assert.equal(slow[1], 1);
  assert.equal(slow[3], 0.5);
});

test('the copy cache keeps the most recently used within its cap, and what is pinned', () => {
  const c = new CopyCache(100);
  const a = {};
  const b = {};
  c.set(a, '1', 'a1', 40);
  c.set(a, '2', 'a2', 40);
  c.set(b, '1', 'b1', 40); // over the cap: a1, the least recently used, goes
  assert.equal(c.get(a, '1'), undefined);
  assert.equal(c.get(a, '2'), 'a2');
  assert.equal(c.bytes, 80);
  // a2 was used last: b1 goes next
  c.set(b, '2', 'b2', 40);
  assert.equal(c.has(b, '1'), false);
  assert.equal(c.has(a, '2'), true);
  // Pinned, a copy stays whatever the cap; unpinned, the cache trims back to its cap
  assert.ok(c.pin(a, '2'));
  c.set(b, '3', 'b3', 60);
  c.set(b, '4', 'b4', 60);
  assert.equal(c.has(a, '2'), true);
  assert.ok(c.bytes <= 100 + 40);
  c.unpin(a, '2');
  assert.ok(c.bytes <= 100);
  // Replacing a copy counts it once
  const d = {};
  c.cap = 1000;
  c.set(d, 'x', 'd1', 10);
  const before = c.bytes;
  c.set(d, 'x', 'd2', 10);
  assert.equal(c.bytes, before);
  assert.equal(c.get(d, 'x'), 'd2');
  assert.deepEqual(c.keys(d), ['x']);
  // Clear lets go of all but the pinned
  c.pin(d, 'x');
  c.clear();
  assert.equal(c.size, 1);
  assert.equal(c.bytes, 10);
});

const midiOf = (n) => {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(n);
  return 'C D EF G A B'.indexOf(m[1]) + (m[2] ? 1 : 0) + 12 * (Number(m[3]) + 1);
};

test('which pitches a song plays each recording at: the nearest recording of every slot in reach, its release sound', () => {
  // Recordings every three semitones, two takes, and release sounds
  const names = ['C4', 'D#4', 'F#4', 'A4'].flatMap((n) => [`${n}|0|0`, `${n}|0|1`]);
  const index = S.indexRecordings([...names, 'rel|C4|0', 'rel|A4|0'], midiOf);
  const pitches = S.neededPitches(index, [
    { midi: 60, velocity: 0.8, loudest: 0.8 }, // on its recording: nothing
    { midi: 61, velocity: 0.8, loudest: 0.8 }, // a semitone over C4
    { midi: 62, velocity: 0.8, loudest: 0.8 }, // a semitone under D#4
    { midi: 70, velocity: 0.8, loudest: 0.8 }, // A4 + 1
  ]);
  assert.deepEqual([...(pitches.get('C4|0|0') ?? [])], [1]);
  assert.deepEqual([...(pitches.get('C4|0|1') ?? [])], [1]);
  assert.deepEqual([...(pitches.get('D#4|0|0') ?? [])], [-1]);
  assert.deepEqual([...(pitches.get('A4|0|0') ?? [])], [1]);
  // The release sounds' nearest, at the note's pitch
  assert.deepEqual([...(pitches.get('rel|C4|0') ?? [])].sort(), [1, 2]);
  assert.ok(!pitches.has('F#4|0|0'));
  // Loudnesses: only those a note's velocity reaches
  const layered = S.indexRecordings(['C4|0|0', 'C4|1|0', 'G4|0|0', 'G4|1|0'], midiOf, [0.5, 1]);
  const soft = S.neededPitches(layered, [{ midi: 62, velocity: 0.2, loudest: 0.2 }]);
  assert.deepEqual([...soft.keys()], ['C4|0|0']);
  const loud = S.neededPitches(layered, [{ midi: 62, velocity: 0.2, loudest: 0.9 }]);
  assert.deepEqual([...loud.keys()].sort(), ['C4|0|0', 'C4|1|0']);
});

test('a track plan: every note with its chord loudest and its Human drift, and the wheel lanes', () => {
  const plan = S.trackPlan({ id: 't', fx: { human: { on: true, timing: 0.5, dynamics: 0.5, pitch: 0.5 } } }, [
    { trackId: 't', notes: [{ note: 'C4', startOffset: 0, velocity: 0.4 }, { note: 'E4', startOffset: 0, velocity: 0.9 }], expression: { mod: [{ at: 0, value: 0.3 }, { at: 1, value: 0.7 }] } },
    { trackId: 'other', notes: [{ note: 'G4', startOffset: 0, velocity: 1 }] },
  ]);
  assert.equal(plan.notes.length, 2);
  assert.equal(plan.notes[0].loudest, 0.9);
  assert.ok(plan.notes[0].drift > 0);
  assert.deepEqual(plan.wheel, [0.3, 0.7]);
});
