// The master limiter (src/audio/effects/limiter.ts): true peaks stay under the ceiling, quiet sound passes untouched, and it delays by its stated latency. Also the export's loudness targets (loudnessTarget.ts), which use it.
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

const { createLimiterKernel, limitChannels, LIMITER_CEILING_DBTP, LIMITER_WORKLET_SOURCE, LOSSY_CEILING_DBTP, exportCeilingDbtp } = await import('../src/audio/effects/limiter.ts');
const { truePeakOf, measureLoudness } = await import('../src/audio/loudness.ts');
const { reachTarget, targetById, MAX_LIMITING_DB } = await import('../src/audio/loudnessTarget.ts');
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

// Bright, dense material whose peaks between samples a cubic estimate misses: a drum hit starting
// mid-cycle, a tone near the top of hearing, a square wave and noise
const BRIGHT = [
  (i) => (i % 11025 < 300 ? 0.9 * Math.sin(i * 0.3) * Math.exp(-(i % 11025) / 60) : 0) + 0.02 * Math.sin((2 * Math.PI * 110 * i) / SR),
  (i) => 0.9 * Math.sin((2 * Math.PI * 15000 * i) / SR + 0.3),
  (i) => (i % 100 < 50 ? 0.9 : -0.9),
  (i) => ((Math.sin(i * 12.9898) * 43758.5453) % 1),
];

test('true peaks stay under the ceiling as a true-peak meter (BS.1770, as the export reports) reads them', () => {
  const ceiling = 10 ** (-1 / 20);
  for (const make of BRIGHT) {
    for (const gainDb of [0, 8]) {
      const g = 10 ** (gainDb / 20);
      const x = Float32Array.from({ length: SR }, (_, i) => make(i) * g);
      const [y, z] = run(createLimiterKernel(SR), x, x, ceiling);
      assert.ok(truePeakOf([y, z]) <= ceiling * 1.001, `${make} at +${gainDb} dB: ${(20 * Math.log10(truePeakOf([y, z]))).toFixed(2)} dBTP`);
    }
  }
});

test('NaN and infinity in come out as silence, and the sound after them is untouched', () => {
  const k = createLimiterKernel(SR);
  const x = Float32Array.from({ length: 4800 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR));
  x[1000] = NaN;
  x[2000] = Infinity;
  const [y] = run(k, x, x);
  assert.ok(y.every(Number.isFinite));
  for (let i = 2100 + k.latency; i < x.length; i++) assert.ok(Math.abs(y[i] - x[i - k.latency]) < 1e-6);
});

test('a loudness target is reached with peaks under -1 dBTP, and the report says what was done', async () => {
  const ceiling = 10 ** (-1 / 20);
  for (const make of BRIGHT) {
    for (const id of ['streaming', 'loud']) {
      const l = Float32Array.from({ length: SR * 4 }, (_, i) => 0.3 * make(i));
      const r = l.slice();
      const reading = await measureLoudness([l, r], SR);
      const target = targetById(id);
      const got = await reachTarget([l, r], SR, reading, target);
      const after = await measureLoudness([l, r], SR);
      assert.ok(truePeakOf([l, r]) <= ceiling * 1.001, `${id}: ${after.truePeakMax.toFixed(2)} dBTP`);
      assert.ok(Math.abs(after.integrated - got.reading.integrated) < 0.05, 'the reading is the file\u2019s');
      assert.ok(got.limitedDb <= MAX_LIMITING_DB + 1e-9);
      // Short of the target only when the limiting it would take is more than allowed
      if (got.shortDb > 0.3) assert.ok(got.capped, `${id}: ${got.shortDb.toFixed(2)} dB short with ${got.limitedDb.toFixed(1)} dB of limiting`);
      else assert.ok(Math.abs(after.integrated - target.lufs) < 0.35, `${id}: ${after.integrated.toFixed(2)} LUFS`);
    }
  }
});

test("an export's limiting after the render matches the worklet's: delayed by its latency, and the meter never reads over the ceiling", () => {
  // Dense, bright and loud: a chord of saws, 6 dB over full scale
  const n = SR * 2;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (const f of [110, 277, 415, 1661, 7040]) v += ((i * f) / SR) % 1 - 0.5;
    l[i] = v * 0.8;
    r[i] = -v * 0.75;
  }
  const kernel = createLimiterKernel(SR);
  const [wl] = run(kernel, l, r, 10 ** ((LIMITER_CEILING_DBTP - 0.05) / 20));
  const al = l.slice();
  const ar = r.slice();
  limitChannels(al, ar, SR);
  for (let i = 0; i < n; i += 997) assert.ok(Math.abs(al[i] - wl[i]) < 1e-6, `sample ${i}`);
  const tp = 20 * Math.log10(truePeakOf([al, ar]));
  assert.ok(tp <= LIMITER_CEILING_DBTP - 0.02, `true peak ${tp.toFixed(3)} dBTP`);
});

test('MP3, Ogg and video exports aim lower than WAV (encoding overshoots), on a target and after the render alike', async () => {
  assert.equal(exportCeilingDbtp('wav'), LIMITER_CEILING_DBTP);
  for (const f of ['mp3', 'ogg', 'mp4']) assert.equal(exportCeilingDbtp(f), LOSSY_CEILING_DBTP);
  // Measured: decoded MP3 / Ogg files peaked up to 0.2 dB over what they were given
  assert.ok(LOSSY_CEILING_DBTP <= LIMITER_CEILING_DBTP - 0.3);
  const lossy = 10 ** (LOSSY_CEILING_DBTP / 20);
  for (const make of BRIGHT) {
    const l = Float32Array.from({ length: SR * 4 }, (_, i) => 0.3 * make(i));
    const r = l.slice();
    const reading = await measureLoudness([l, r], SR);
    const got = await reachTarget([l, r], SR, reading, targetById('loud'), undefined, LOSSY_CEILING_DBTP);
    assert.ok(truePeakOf([l, r]) <= lossy * 1.001, `target: ${got.reading.truePeakMax.toFixed(2)} dBTP`);
    const al = Float32Array.from({ length: SR * 2 }, (_, i) => 3 * make(i));
    const ar = al.slice();
    limitChannels(al, ar, SR, LOSSY_CEILING_DBTP);
    assert.ok(truePeakOf([al, ar]) <= lossy, `after the render: ${(20 * Math.log10(truePeakOf([al, ar]))).toFixed(2)} dBTP`);
  }
});
