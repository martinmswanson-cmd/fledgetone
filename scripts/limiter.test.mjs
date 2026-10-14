// The master limiter (src/audio/effects/limiter.ts): true peaks stay under the ceiling, quiet sound passes untouched, and it delays by its stated latency.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createLimiterKernel, LIMITER_WORKLET_SOURCE } = await import('../src/audio/effects/limiter.ts');
const SR = 48000;

function run(kernel, l, r, ceiling = 10 ** (-1 / 20), release = 0.06) {
  const outL = new Float32Array(l.length);
  const outR = new Float32Array(r.length);
  for (let i = 0; i < l.length; i += 128) {
    const n = Math.min(128, l.length - i);
    kernel.process(l.subarray(i, i + n), r.subarray(i, i + n), outL.subarray(i, i + n), outR.subarray(i, i + n), n, ceiling, release);
  }
  return [outL, outR];
}

// The highest value on the 8x-upsampled signal (a fine estimate of the true peak)
function truePeak(x) {
  let p = 0;
  for (let i = 1; i + 2 < x.length; i++) {
    for (let k = 0; k < 8; k++) {
      const t = k / 8;
      const [a, b, c, d] = [x[i - 1], x[i], x[i + 1], x[i + 2]];
      const v = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      p = Math.max(p, Math.abs(v));
    }
  }
  return p;
}

test('a quiet signal passes unchanged, only delayed', () => {
  const k = createLimiterKernel(SR);
  const x = Float32Array.from({ length: 4800 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR));
  const [y] = run(k, x, x);
  for (let i = k.latency; i < x.length; i++) assert.ok(Math.abs(y[i] - x[i - k.latency]) < 1e-6);
});

test('loud sines, clicks and a near-Nyquist tone stay under the ceiling, true peaks included', () => {
  const ceiling = 10 ** (-1 / 20);
  for (const make of [
    (i) => 2.5 * Math.sin((2 * Math.PI * 100 * i) / SR),
    (i) => (i % 9000 === 4000 ? 4 : 0.2 * Math.sin((2 * Math.PI * 300 * i) / SR)),
    (i) => 1.6 * Math.sin((2 * Math.PI * 11025 * i) / SR + 0.785),
    (i) => (Math.sin(i * 12.9898) * 43758.5453) % 1 * 3,
  ]) {
    const x = Float32Array.from({ length: 48000 }, (_, i) => make(i));
    const [y] = run(createLimiterKernel(SR), x, x, ceiling);
    assert.ok(y.every((v) => Math.abs(v) <= ceiling + 1e-6), 'sample peaks');
    assert.ok(truePeak(y) <= ceiling * 1.02, `true peak ${truePeak(y)}`);
  }
});

test('the gain comes down smoothly before a peak, not as a step', () => {
  const x = new Float32Array(9600);
  for (let i = 0; i < x.length; i++) x[i] = (i >= 4800 ? 2 : 0.5) * Math.sin((2 * Math.PI * 50 * i) / SR);
  const k = createLimiterKernel(SR);
  const [y] = run(k, x, x);
  // Before the loud part plays, the quiet one has started fading: the limiter saw it coming
  const at = 4800 + k.latency;
  const ratio = (i) => Math.abs(y[i]) / Math.max(1e-9, Math.abs(x[i - k.latency]));
  const before = [];
  for (let i = at - k.latency; i < at; i++) if (Math.abs(x[i - k.latency]) > 0.2) before.push(ratio(i));
  assert.ok(before.some((g) => g < 0.99), 'it starts turning down ahead of the peak');
  for (let i = 1; i < before.length; i++) assert.ok(Math.abs(before[i] - before[i - 1]) < 0.2, 'no jump');
});

test('the worklet module embeds the kernel', () => {
  assert.match(LIMITER_WORKLET_SOURCE, /registerProcessor\('bbx-limiter'/);
  assert.doesNotThrow(() => new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', LIMITER_WORKLET_SOURCE)(class {}, () => {}, 48000));
});
