// Unit tests for the OTT multiband compressor maths (src/audio/effects/ott.ts). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createOttKernel, OTT_WORKLET_SOURCE } = await import('../src/audio/effects/ott.ts');

const SR = 48000;
const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);
const db = (v) => 20 * Math.log10(v);

function sine(hz, dbfs, seconds, sampleRate = SR) {
  const n = Math.round(seconds * sampleRate);
  const a = Math.pow(10, dbfs / 20);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

/** RMS of the last `seconds` of a signal (once the compressor has settled). */
function rmsTail(x, seconds, sampleRate = SR) {
  const n = Math.round(seconds * sampleRate);
  let s = 0;
  for (let i = x.length - n; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / n);
}

/** Run a stereo signal through a fresh kernel in 128-frame blocks. */
function run(left, right, params, sampleRate = SR) {
  const kernel = createOttKernel(sampleRate);
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);
  for (let at = 0; at < left.length; at += 128) {
    const n = Math.min(128, left.length - at);
    kernel.process(left.subarray(at, at + n), right.subarray(at, at + n), outL.subarray(at, at + n), outR.subarray(at, at + n), n, params);
  }
  return { outL, outR, kernel };
}

const FLAT = { depth: 0, time: 0.3, inGain: 1, outGain: 1 };
const FULL = { depth: 1, time: 0.3, inGain: 1, outGain: 1 };

test('at depth 0 the crossovers sum back flat: sines across the range come out at their level', () => {
  for (const sr of [44100, 48000]) {
    for (const hz of [40, 120, 300, 1000, 2500, 6000, 12000]) {
      const x = sine(hz, -12, 1, sr);
      const { outL, outR } = run(x, x, FLAT, sr);
      near(db(rmsTail(outL, 0.5, sr)), db(rmsTail(x, 0.5, sr)), 0.25, `${hz} Hz at ${sr}`);
      near(db(rmsTail(outR, 0.5, sr)), db(rmsTail(x, 0.5, sr)), 0.25, `${hz} Hz right at ${sr}`);
    }
  }
});

test('at full depth loud and quiet bands are pulled together, in every band', () => {
  for (const hz of [60, 800, 6000]) {
    const loud = sine(hz, 0, 2);
    const loudIn = db(rmsTail(loud, 0.5));
    const loudOut = db(rmsTail(run(loud, loud, FULL).outL, 0.5));
    assert.ok(loudOut < loudIn - 3, `${hz} Hz at 0 dBFS came out at ${loudOut.toFixed(1)} dB: not turned down enough`);
    // 26 dB apart going in, about half that coming out
    const soft = sine(hz, -26, 2);
    const softOut = db(rmsTail(run(soft, soft, FULL).outL, 0.5));
    assert.ok(loudOut - softOut < 15, `${hz} Hz: 0 and -26 dBFS came out ${(loudOut - softOut).toFixed(1)} dB apart`);
    // Makeup: a band peaking at -10 dB comes out about where it went in
    const ref = sine(hz, -10, 2);
    near(db(rmsTail(run(ref, ref, FULL).outL, 0.5)), db(rmsTail(ref, 0.5)), 2.5, `${hz} Hz at the makeup level:`);
    const quiet = sine(hz, -50, 2);
    const quietOut = db(rmsTail(run(quiet, quiet, FULL).outL, 0.5));
    assert.ok(quietOut > -50 + 8, `${hz} Hz at -50 dBFS came out at ${quietOut.toFixed(1)} dB: not turned up enough`);
    // The boost is capped: very quiet stays quiet
    const faint = sine(hz, -100, 2);
    const faintOut = db(rmsTail(run(faint, faint, FULL).outL, 0.5));
    assert.ok(faintOut < -100 + 25 && faintOut > -100 + 20, `${hz} Hz at -100 dBFS came out at ${faintOut.toFixed(1)} dB`);
  }
});

test('depth scales the gain in dB: half depth is half the change', () => {
  const x = sine(800, -50, 2);
  const level = db(rmsTail(x, 0.5));
  const full = db(rmsTail(run(x, x, FULL).outL, 0.5)) - level;
  const half = db(rmsTail(run(x, x, { ...FULL, depth: 0.5 }).outL, 0.5)) - level;
  assert.ok(full > 10, `full depth change ${full.toFixed(2)} dB`);
  near(half, full / 2, 0.3);
});

test('silence stays silent, and digital silence makes no NaN', () => {
  const zero = new Float32Array(SR);
  const { outL, outR } = run(zero, zero, FULL);
  assert.ok(outL.every((v) => v === 0) && outR.every((v) => v === 0));
});

test('bands are independent: a loud bass does not duck the highs', () => {
  const highOnly = sine(6000, -20, 2);
  const alone = db(rmsTail(run(highOnly, highOnly, FULL).outL, 0.5));
  const bass = sine(60, -3, 2);
  const both = new Float32Array(highOnly.length);
  for (let i = 0; i < both.length; i++) both[i] = highOnly[i] + bass[i];
  const { outL } = run(both, both, FULL);
  // Take the high band back out of the mix with a crude high-pass (difference of neighbours)
  // and compare its level with the high band alone
  const hp = (x) => {
    const y = new Float32Array(x.length);
    for (let i = 1; i < x.length; i++) y[i] = x[i] - x[i - 1];
    return y;
  };
  near(db(rmsTail(hp(outL), 0.5)), db(rmsTail(hp(run(highOnly, highOnly, FULL).outL), 0.5)), 1.5, `highs with a bass under them (alone: ${alone.toFixed(1)})`);
});

test('the channels are linked: the louder side sets the gain, so the image does not shift', () => {
  const loud = sine(800, -6, 2);
  const quiet = sine(800, -26, 2);
  const { outL, outR } = run(loud, quiet, FULL);
  // Both sides get the same gain, so their difference stays 20 dB
  near(db(rmsTail(outL, 0.5)) - db(rmsTail(outR, 0.5)), 20, 0.2);
});

test('Time: faster settings react sooner', () => {
  const kernelTimes = createOttKernel(SR).times;
  const fast = kernelTimes(0);
  const slow = kernelTimes(1);
  assert.ok(fast[1].attack < slow[1].attack && fast[1].release < slow[1].release);
  // Low band slower than mid, high faster
  assert.ok(slow[0].release > slow[1].release && slow[2].release < slow[1].release);
  // A jump from quiet to loud mid-sound: how long until the gain has come most of the way down
  const settle = (time) => {
    const quiet = sine(800, -40, 0.5);
    const loud = sine(800, 0, 1);
    const x = new Float32Array(quiet.length + loud.length);
    x.set(quiet);
    x.set(loud, quiet.length);
    const kernel = createOttKernel(SR);
    const out = new Float32Array(128);
    for (let at = 0; at < x.length; at += 128) {
      kernel.process(x.subarray(at, at + 128), x.subarray(at, at + 128), out, out, 128, { ...FULL, time });
      if (at >= quiet.length && kernel.bandGainsDb()[1] < -6) return (at - quiet.length) / SR;
    }
    return Infinity;
  };
  assert.ok(settle(0) < settle(1), `fast ${settle(0)} slow ${settle(1)}`);
  assert.ok(settle(1) < 0.3, `slow attack settles within 300 ms (${settle(1)})`);
});

test('In gain drives the bands harder; Out gain is a plain gain after', () => {
  const x = sine(800, -30, 2);
  const plain = db(rmsTail(run(x, x, FULL).outL, 0.5));
  // 12 dB more in: the band sits where a -18 dBFS one would (just at the downward threshold)
  const driven = db(rmsTail(run(x, x, { ...FULL, inGain: 4 }).outL, 0.5));
  assert.ok(driven > plain && driven - plain < 12, `in gain ${plain.toFixed(1)} -> ${driven.toFixed(1)}`);
  const louder = db(rmsTail(run(x, x, { ...FULL, outGain: 2 }).outL, 0.5));
  near(louder, plain + 6.02, 0.05);
});

test('the worklet source is self-contained: it runs with only the worklet globals', () => {
  const registered = {};
  const globals = {
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = {};
      }
    },
    registerProcessor: (name, cls) => (registered[name] = cls),
  };
  new Function(...Object.keys(globals), OTT_WORKLET_SOURCE)(...Object.values(globals));
  const Processor = registered['bbx-ott'];
  assert.ok(Processor, 'registered');
  assert.deepEqual(
    Processor.parameterDescriptors.map((d) => d.name),
    ['depth', 'time', 'inGain', 'outGain']
  );
  const p = new Processor();
  const params = { depth: [1], time: [0.3], inGain: [1], outGain: [1] };
  const x = sine(800, 0, 0.5);
  const out = [new Float32Array(128), new Float32Array(128)];
  let alive;
  for (let at = 0; at + 128 <= x.length; at += 128) alive = p.process([[x.subarray(at, at + 128), x.subarray(at, at + 128)]], [out], params);
  assert.equal(alive, true);
  assert.ok(db(rmsTail(out[0], 128 / 48000)) < -3 - 5, 'compressed');
  // No input connected: silence out (once the filters have rung out), still alive
  for (let i = 0; i < 400; i++) assert.equal(p.process([[]], [out], params), true);
  assert.ok(out[0].every((v) => Math.abs(v) < 1e-4));
  p.port.onmessage({ data: 'dispose' });
  assert.equal(p.process([[]], [out], params), false);
});

test('switching on while sound plays does not burst: the first sound sets the level at once', () => {
  const x = sine(800, -6, 0.3);
  const { outL } = run(x, x, FULL);
  const steady = db(rmsTail(outL, 0.1));
  // The first 20 ms come out no louder than the settled sound
  let s = 0;
  const n = Math.round(0.02 * SR);
  for (let i = 0; i < n; i++) s += outL[i] * outL[i];
  const first = db(Math.sqrt(s / n));
  assert.ok(first < steady + 1.5, `first 20 ms ${first.toFixed(1)} dB, settled ${steady.toFixed(1)} dB`);
});
