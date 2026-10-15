// Unit tests for the master clipper (src/audio/effects/clipper.ts) and its place in the export's
// master section (masterAfter.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
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

const { createClipperKernel, clipChannels, clipperParams, normalizeClipper, defaultClipper, CLIPPER_WORKLET_SOURCE } = await import('../src/audio/effects/clipper.ts');
const { masterAfter } = await import('../src/audio/effects/masterAfter.ts');
const { defaultMasterSettings, normalizeMasterSettings, sameMasterSettings } = await import('../src/store/timelineTypes.ts');

const SR = 44100;
const sine = (f, amp, n = SR) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
const peak = (x) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);

function dft(x, f) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    const a = (2 * Math.PI * f * i) / SR;
    re += x[i] * Math.cos(a);
    im -= x[i] * Math.sin(a);
  }
  return (Math.hypot(re, im) / x.length) * 2;
}

test('sound under the knee passes through untouched, lined up with the input', () => {
  const x = sine(220, 0.3);
  const l = x.slice();
  const r = x.slice();
  const reading = clipChannels(l, r, SR, { on: true, drive: 0, softness: 0.5, ceiling: -1 });
  assert.deepEqual(Array.from(l), Array.from(x));
  assert.equal(reading.peakDb, 0);
  assert.equal(reading.share, 0);
});

test('drive turns the sound up by its dB where nothing clips', () => {
  const x = sine(220, 0.1);
  const l = x.slice();
  clipChannels(l, l, SR, { on: true, drive: 6, softness: 0, ceiling: 0 });
  const g = clipperParams({ on: true, drive: 6, softness: 0, ceiling: 0 }).drive;
  for (let i = 0; i < x.length; i += 97) assert.ok(Math.abs(l[i] - x[i] * g) < 1e-6);
});

test('a hard clip holds a loud sine near the ceiling, and reports what it took off', () => {
  const x = sine(110, 0.9);
  const l = x.slice();
  const r = x.slice();
  const reading = clipChannels(l, r, SR, { on: true, drive: 12, softness: 0, ceiling: -3 });
  const ceiling = 10 ** (-3 / 20);
  // The oversampled clip rings a little over the ceiling (the filter), never far
  assert.ok(peak(l) < ceiling * 1.12, `peak ${peak(l)}`);
  assert.ok(peak(l) > ceiling * 0.95);
  assert.ok(reading.peakDb > 13 && reading.peakDb < 15, `took off ${reading.peakDb} dB`);
  assert.ok(reading.share > 0.5);
});

test('soft clipping bends earlier than hard', () => {
  const x = sine(110, 0.6);
  const hard = x.slice();
  const soft = x.slice();
  const h = clipChannels(hard, hard, SR, { on: true, drive: 0, softness: 0, ceiling: -3 });
  const s = clipChannels(soft, soft, SR, { on: true, drive: 0, softness: 1, ceiling: -3 });
  assert.equal(h.share, 0);
  assert.ok(s.share > 0.1);
});

test('oversampling keeps aliasing far under a naive clip', () => {
  const f0 = 7001;
  const x = sine(f0, 0.9);
  const over = x.slice();
  clipChannels(over, over, SR, { on: true, drive: 12, softness: 0, ceiling: -1 });
  const naive = x.map((v) => Math.max(-0.891, Math.min(0.891, v * 3.98)));
  const alias = (a) => {
    const w = a.subarray(4410, 4410 + 17640).map((v, i, arr) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / arr.length)));
    const fund = dft(w, f0);
    let sum = 0;
    for (let k = 5; k < 40; k += 2) {
      let fa = (k * f0) % SR;
      if (fa > SR / 2) fa = SR - fa;
      if (fa > 20 && fa < 20000) sum += dft(w, fa) ** 2;
    }
    return 10 * Math.log10(sum / fund ** 2);
  };
  const o = alias(over);
  const q = alias(naive);
  assert.ok(o < -45, `oversampled aliases ${o.toFixed(1)} dB`);
  assert.ok(o < q - 30, `oversampled ${o.toFixed(1)} dB vs naive ${q.toFixed(1)} dB`);
});

test('the kernel in blocks of 128 (the worklet) gives what the export gives, delayed by its latency', () => {
  const x = Float32Array.from({ length: 20000 }, (_, i) => 0.8 * Math.sin(i * 0.05) + 0.4 * Math.sin(i * 0.9));
  const settings = { on: true, drive: 6, softness: 0.4, ceiling: -2 };
  const whole = x.slice();
  clipChannels(whole, whole, SR, settings);
  const k = createClipperKernel(SR);
  const p = clipperParams(settings);
  const live = new Float32Array(x.length + k.latency);
  const padded = new Float32Array(x.length + k.latency);
  padded.set(x);
  for (let at = 0; at < padded.length; at += 128) {
    const end = Math.min(padded.length, at + 128);
    const inp = padded.slice(at, end);
    const out = new Float32Array(end - at);
    k.process(inp, inp, out, out.slice(), end - at, p.drive, p.ceiling, p.softness);
    live.set(out, at);
  }
  for (let i = 0; i < x.length; i++) assert.equal(live[i + k.latency], whole[i]);
});

test('the worklet runs: registers, clips a block, and posts readings', () => {
  let Processor = null;
  const posted = [];
  const run = new Function('sampleRate', 'registerProcessor', 'class AudioWorkletProcessor { constructor() { this.port = { postMessage: (m) => posted.push(m) }; } }\n' + CLIPPER_WORKLET_SOURCE.replace('registerProcessor(', 'return registerProcessor('));
  run(SR, (name, cls) => (Processor = cls));
  assert.ok(Processor);
  const proc = new Processor();
  proc.port.postMessage = (m) => posted.push(m);
  const p = clipperParams({ on: true, drive: 12, softness: 0, ceiling: -1 });
  const params = { drive: [p.drive], ceiling: [p.ceiling], softness: [p.softness] };
  let out = 0;
  for (let b = 0; b < 40; b++) {
    const inp = Float32Array.from({ length: 128 }, (_, i) => 0.9 * Math.sin(((b * 128 + i) * 2 * Math.PI * 100) / SR));
    const o = [new Float32Array(128), new Float32Array(128)];
    assert.equal(proc.process([[inp, inp]], [o], params), true);
    out = Math.max(out, peak(o[0]));
  }
  assert.ok(out < 1 && out > 0.85, `peak ${out}`);
  assert.ok(posted.length >= 1 && posted[0].peakDb > 6);
});

test('settings are repaired, and an absent clipper means off', () => {
  assert.deepEqual(normalizeClipper({ on: true, drive: 99, softness: -1, ceiling: 5 }), { on: true, drive: 18, softness: 0, ceiling: 0 });
  assert.deepEqual(normalizeClipper(null), defaultClipper());
  const m = normalizeMasterSettings({});
  assert.equal(m.clipper, undefined);
  const withClip = normalizeMasterSettings({ clipper: { on: true } });
  assert.equal(withClip.clipper.on, true);
  assert.equal(sameMasterSettings(m, withClip), false);
  assert.equal(sameMasterSettings(withClip, normalizeMasterSettings(withClip)), true);
});

test('the export master section clips before the limiter and says how hard each worked', () => {
  const l = sine(80, 0.95, SR * 2);
  const r = l.slice();
  const master = { ...defaultMasterSettings(), level: 6, clipper: { on: true, drive: 3, softness: 0.2, ceiling: -1 } };
  const stats = masterAfter(l, r, SR, master);
  assert.ok(stats.clipper && stats.clipper.peakDb > 6);
  // The clipper took the peaks down to about its ceiling, so the limiter had little left to do
  assert.ok(stats.limiterInPeakDb < 0, `into the limiter at ${stats.limiterInPeakDb}`);
  const off = masterAfter(sine(80, 0.95, SR * 2), sine(80, 0.95, SR * 2), SR, { ...master, clipper: { ...master.clipper, on: false } });
  assert.equal(off.clipper, undefined);
  assert.ok(off.limiterPeakDb > 6);
});
