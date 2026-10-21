// Unit tests for the Drop pad's effects (src/audio/effects/dropFx.ts). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createDropKernel, DROP_EFFECTS, DROP_WORKLET_SOURCE } = await import('../src/audio/effects/dropFx.ts');

const SR = 48000;
/** A 16th at 140 BPM, in samples */
const SIX = (60 / 140 / 4) * SR;
const FX = Object.fromEntries(DROP_EFFECTS.map((name, i) => [name, i]));

function sine(hz, seconds, amp = 0.5) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

/** Run a signal (both sides the same) through a kernel in 128-frame blocks, `setup` scheduling its moves. */
function run(input, setup) {
  const k = createDropKernel(SR);
  setup?.(k);
  const L = new Float32Array(input.length);
  const R = new Float32Array(input.length);
  for (let at = 0; at < input.length; at += 128) {
    const n = Math.min(128, input.length - at);
    k.process(input.subarray(at, at + n), input.subarray(at, at + n), L.subarray(at, at + n), R.subarray(at, at + n), n, at);
  }
  return { L, R, k };
}

const rms = (x, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};
const peak = (x, from = 0, to = x.length) => {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
};
/** The biggest jump from one sample to the next. */
const biggestStep = (x, from = 1, to = x.length) => {
  let m = 0;
  for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  return m;
};

test('with nothing held the sound passes untouched', () => {
  const x = sine(440, 0.5);
  const { L, R, k } = run(x);
  assert.deepEqual(L, x);
  assert.deepEqual(R, x);
  assert.equal(k.busy(), false);
});

test('Stutter plays the 16th from the press, then repeats it', () => {
  // A rising ramp: each sample different, so a repeat is easy to see
  const n = Math.round(SIX * 8);
  const x = new Float32Array(n).map((_, i) => ((i % 9973) / 9973) * 0.5);
  const press = 1000;
  const { L } = run(x, (k) => k.on(FX.stutter, press, SIX));
  const len = Math.round(SIX);
  // The first 16th plays as it was
  for (let i = press; i < press + len - 400; i += 50) assert.equal(L[i], x[i]);
  // Later 16ths are that 16th again (away from the short fades at the seams)
  for (let rep = 2; rep < 6; rep++) {
    for (let j = 400; j < len - 400; j += 97) assert.ok(Math.abs(L[press + rep * len + j] - x[press + j]) < 1e-6, `repeat ${rep} at ${j}`);
  }
});

test('Tape stop slows to silence within a beat, and the sound comes back on letting go', () => {
  const x = sine(220, 2);
  const press = 4800;
  const release = press + Math.round(SIX * 8);
  const { L } = run(x, (k) => {
    k.on(FX.tape, press, SIX);
    k.off(FX.tape, release);
  });
  // A beat after the press it has stopped
  const stopped = press + Math.round(SIX * 4.5);
  assert.ok(peak(L, stopped, release - 10) < 1e-3, `still sounding: ${peak(L, stopped, release - 10)}`);
  // Back to the input once let go (after the short crossfade)
  const after = release + 2000;
  for (let i = after; i < after + 500; i++) assert.ok(Math.abs(L[i] - x[i]) < 1e-6);
});

test('Filter takes the highs out over a bar, then opens again', () => {
  const x = sine(6000, 3);
  const press = 4800;
  const bar = Math.round(SIX * 16);
  const release = press + bar + Math.round(SIX * 4);
  const { L } = run(x, (k) => {
    k.on(FX.filter, press, SIX);
    k.off(FX.filter, release);
  });
  const before = rms(L, 0, press);
  const swept = rms(L, press + bar, release);
  assert.ok(swept < before * 0.02, `6 kHz at ${swept} vs ${before}`);
  // Two 16ths after letting go it's fully open and back to the input
  const open = release + Math.round(SIX * 2) + 1000;
  assert.ok(Math.abs(rms(L, open, open + 4800) - rms(x, open, open + 4800)) < 1e-4);
});

test('Gate lets half of each 16th through', () => {
  const x = sine(300, 2);
  const press = Math.round(SIX * 4);
  const { L } = run(x, (k) => k.on(FX.gate, press, SIX));
  const from = press + Math.round(SIX * 2);
  const to = from + Math.round(SIX * 8);
  const share = rms(L, from, to) ** 2 / rms(x, from, to) ** 2;
  assert.ok(share > 0.4 && share < 0.55, `energy share ${share}`);
});

test('Crush makes it coarse but no louder', () => {
  const x = sine(500, 1);
  const { L } = run(x, (k) => k.on(FX.crush, 0, SIX));
  assert.ok(peak(L, 1000) <= peak(x) * 1.0, `peak ${peak(L, 1000)}`);
  // Held samples: long runs of the same value
  let same = 0;
  for (let i = 1001; i < 5000; i++) if (L[i] === L[i - 1]) same++;
  assert.ok(same > 3000, `${same} repeats`);
});

test('Echo rings on after letting go, then dies away', () => {
  // A short burst, then silence
  const x = new Float32Array(SR * 6);
  x.set(sine(400, 0.1), 0);
  const { L, k } = run(x, (k) => {
    k.on(FX.echo, 0, SIX);
    k.off(FX.echo, Math.round(0.2 * SR));
  });
  const echoAt = Math.round(3 * SIX);
  assert.ok(peak(L, echoAt, echoAt + 0.1 * SR) > 0.1, 'the first echo');
  assert.ok(peak(L, echoAt + 0.1 * SR) < peak(L, 0, 0.1 * SR), 'echoes quieter than the sound');
  assert.ok(peak(L, 5 * SR) < 1e-3, 'rung out');
  assert.equal(k.busy(), false);
});

test('no effect clicks as it starts or stops', () => {
  // A low sine: its own steps are tiny, so a jump stands out
  const x = sine(110, 3, 0.5);
  const own = biggestStep(x);
  for (const name of DROP_EFFECTS) {
    if (name === 'stutter' || name === 'gate') continue; // they chop on purpose (with short fades)
    const press = 7001;
    const release = press + Math.round(SIX * 6) + 13;
    const { L } = run(x, (k) => {
      k.on(FX[name], press, SIX);
      k.off(FX[name], release);
    });
    const step = biggestStep(L);
    assert.ok(step < own * 12, `${name}: a jump of ${step} (the sine's own ${own})`);
  }
  // The stutter's and gate's chops glide over a few ms rather than jumping
  for (const name of ['stutter', 'gate']) {
    const { L } = run(x, (k) => k.on(FX[name], 7001, SIX));
    assert.ok(biggestStep(L) < 0.05, `${name}: a jump of ${biggestStep(L)}`);
  }
});

test('cancel lets go of everything at once and drops what was due', () => {
  const x = sine(300, 1);
  const { L } = run(x, (k) => {
    k.on(FX.crush, 1000, SIX);
    k.on(FX.gate, 30000, SIX);
    k.cancel(5000);
  });
  // After the cancel's crossfade the sound is the input again, and the later gate never starts
  for (let i = 6000; i < x.length; i += 37) assert.ok(Math.abs(L[i] - x[i]) < 1e-6, `at ${i}`);
});

test('the worklet source parses and names its processor', () => {
  assert.ok(DROP_WORKLET_SOURCE.includes("registerProcessor('bbx-drop'"));
  // Parses as a script (registerProcessor and AudioWorkletProcessor stubbed)
  new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentFrame', DROP_WORKLET_SOURCE)(class {}, () => {}, SR, 0);
});

test('pressed again while it still sounds, Stutter and Tape stop start over without a click', () => {
  const x = sine(110, 2, 0.5);
  const own = biggestStep(x);
  for (const name of ['stutter', 'tape']) {
    const at = 1000 + Math.round(4 * SIX);
    const cases = {
      'back to back': (k) => (k.on(FX[name], 1000, SIX), k.off(FX[name], at), k.on(FX[name], at, SIX)),
      'again while held': (k) => (k.on(FX[name], 1000, SIX), k.on(FX[name], 1000 + Math.round(3 * SIX) + 333, SIX)),
      'again while letting go': (k) => (k.on(FX[name], 1000, SIX), k.off(FX[name], at), k.on(FX[name], at + 100, SIX)),
    };
    for (const [what, setup] of Object.entries(cases)) {
      const { L } = run(x, setup);
      assert.ok(biggestStep(L) < Math.max(0.05, own * 12), `${name}, ${what}: a jump of ${biggestStep(L)}`);
    }
  }
});

test('a move whose start and end land on the same sample still lets go', () => {
  const { k } = run(sine(200, 1), (k) => {
    k.on(FX.gate, 2000, SIX);
    k.off(FX.gate, 2000);
  });
  assert.equal(k.busy(), false);
});

test('the same moves sound the same in any block size (live 128, export 8192)', () => {
  const x = sine(3000, 16, 0.4);
  const moves = [[3, 243995, 276253], [3, 579663, 669277], [1, 369536, 409928], [1, 478903, 563939], [0, 100000, 130000]];
  const render = (block) => {
    const k = createDropKernel(SR);
    for (const [fx, from, to] of moves) {
      k.on(fx, from, 200);
      k.off(fx, to);
    }
    const L = new Float32Array(x.length);
    const R = new Float32Array(x.length);
    for (let at = 0; at < x.length; at += block) {
      const n = Math.min(block, x.length - at);
      k.process(x.subarray(at, at + n), x.subarray(at, at + n), L.subarray(at, at + n), R.subarray(at, at + n), n, at);
    }
    return L;
  };
  const a = render(128);
  const b = render(8192);
  let most = 0;
  for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i] - b[i]));
  assert.ok(most < 1e-6, `differs by ${most}`);
});
