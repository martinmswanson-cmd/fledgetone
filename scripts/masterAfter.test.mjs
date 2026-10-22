// Unit tests for the export's master section after the compressor (src/audio/effects/masterAfter.ts):
// the OTT, width, Level and limiter run over a finished render. Run with `npm test`.
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

const { masterAfter, widthChannels, ottChannels, webAudioHighpass, MONO_BASS_HZ, MONO_BASS_Q } = await import('../src/audio/effects/masterAfter.ts');
const { createOttKernel } = await import('../src/audio/effects/ott.ts');
const { defaultMasterSettings } = await import('../src/store/timelineTypes.ts');

const SR = 44100;

/** A few seconds of a stereo mix-like signal: a kick-ish thump, a bass, a bright part, different on each side. */
function mix(seconds = 3) {
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let s = 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const beat = t % 0.5;
    const kick = Math.exp(-beat * 18) * Math.sin(2 * Math.PI * 55 * beat) * 0.6;
    const bass = 0.25 * Math.sin(2 * Math.PI * 82 * t);
    const hat = 0.08 * rnd() * Math.exp(-((t + 0.25) % 0.5) * 40);
    l[i] = kick + bass + hat + 0.1 * Math.sin(2 * Math.PI * 660 * t);
    r[i] = kick + 0.8 * bass - hat + 0.1 * Math.sin(2 * Math.PI * 990 * t);
  }
  return [l, r];
}

const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

test('a trim on the OTT Out gain and the same trim on the Level sound the same', () => {
  const d = defaultMasterSettings();
  for (const width of [d.width, { on: true, amount: 1.4, monoBass: true }, { on: true, amount: 0.6, monoBass: false }]) {
    const [l1, r1] = mix();
    const [l2, r2] = mix();
    masterAfter(l1, r1, SR, { ...d, ott: { on: true, depth: 0.4, time: 0.3, inGain: 0, outGain: -2.5 + 1.5 }, width, level: 0 });
    masterAfter(l2, r2, SR, { ...d, ott: { on: true, depth: 0.4, time: 0.3, inGain: 0, outGain: 1.5 }, width, level: -2.5 });
    assert.ok(maxDiff(l1, l2) < 1e-5 && maxDiff(r1, r2) < 1e-5, `differ by ${maxDiff(l1, l2)}`);
  }
});

test('the OTT run over a whole render is the worklet run block by block', () => {
  const [l, r] = mix(1);
  const [bl, br] = [l.slice(), r.slice()];
  const ott = { on: true, depth: 0.7, time: 0.4, inGain: 3, outGain: -1 };
  ottChannels(l, r, SR, ott);
  // The worklet: 128 frames at a time, its params as single-precision AudioParams
  const kernel = createOttKernel(SR);
  const params = { depth: Math.fround(0.7), time: Math.fround(0.4), inGain: Math.fround(10 ** (3 / 20)), outGain: Math.fround(10 ** (-1 / 20)) };
  for (let i = 0; i < bl.length; i += 128) {
    const e = Math.min(bl.length, i + 128);
    kernel.process(bl.subarray(i, e), br.subarray(i, e), bl.subarray(i, e), br.subarray(i, e), e - i, params);
  }
  assert.equal(maxDiff(l, bl), 0);
  assert.equal(maxDiff(r, br), 0);
});

test('width: 100% leaves the sound alone, 0% is mono, and the bass stays in the middle', () => {
  const [l, r] = mix(1);
  const [l0, r0] = [l.slice(), r.slice()];
  widthChannels(l, r, SR, { on: true, amount: 1, monoBass: false });
  assert.ok(maxDiff(l, l0) < 1e-6 && maxDiff(r, r0) < 1e-6);
  widthChannels(l, r, SR, { on: true, amount: 0, monoBass: false });
  assert.equal(maxDiff(l, r), 0);
  // A 40 Hz side signal is kept in the middle (mostly gone from the difference) with mono bass on
  const n = SR;
  const sl = new Float32Array(n);
  const sr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sl[i] = 0.5 * Math.sin((2 * Math.PI * 40 * i) / SR);
    sr[i] = -sl[i];
  }
  widthChannels(sl, sr, SR, { on: true, amount: 2, monoBass: true });
  let side = 0;
  for (let i = n / 2; i < n; i++) side = Math.max(side, Math.abs(sl[i] - sr[i]) / 2);
  assert.ok(side < 0.15, `side ${side}`);
});

test("the mono bass high-pass is Web Audio's, whose Q for a high-pass is in dB", () => {
  const c = webAudioHighpass(MONO_BASS_HZ, MONO_BASS_Q, SR);
  // |H| at the cutoff is the linear Q: 10^(Q/20)
  const w = (2 * Math.PI * MONO_BASS_HZ) / SR;
  const re = (z) => [Math.cos(z), -Math.sin(z)];
  const [c1, s1] = re(w);
  const [c2, s2] = re(2 * w);
  const num = [c[0] + c[1] * c1 + c[2] * c2, c[1] * s1 + c[2] * s2];
  const den = [1 + c[3] * c1 + c[4] * c2, c[3] * s1 + c[4] * s2];
  const mag = Math.hypot(...num) / Math.hypot(...den);
  assert.ok(Math.abs(mag - 10 ** (Math.fround(MONO_BASS_Q) / 20)) < 1e-6, `|H| ${mag}`);
});

test('the mono bass high-pass never lifts the side signal (Butterworth: no bump over its cutoff)', () => {
  const c = webAudioHighpass(MONO_BASS_HZ, MONO_BASS_Q, SR);
  for (let hz = 20; hz < 20000; hz *= 1.05) {
    const w = (2 * Math.PI * hz) / SR;
    const num = [c[0] + c[1] * Math.cos(w) + c[2] * Math.cos(2 * w), -c[1] * Math.sin(w) - c[2] * Math.sin(2 * w)];
    const den = [1 + c[3] * Math.cos(w) + c[4] * Math.cos(2 * w), -c[3] * Math.sin(w) - c[4] * Math.sin(2 * w)];
    const db = 20 * Math.log10(Math.hypot(...num) / Math.hypot(...den));
    assert.ok(db <= 1e-3, `${hz.toFixed(0)} Hz: ${db.toFixed(2)} dB`);
  }
});

test('the Level turns the mix up into the limiter, which still holds the peaks', () => {
  const d = defaultMasterSettings();
  const [l, r] = mix(2);
  const [lq, rq] = [l.slice(), r.slice()];
  masterAfter(l, r, SR, { ...d, level: 9 });
  masterAfter(lq, rq, SR, d);
  const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
  assert.ok(rms(l) > rms(lq) * 1.5, 'louder');
  const peak = [...l, ...r].reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak < 10 ** (-0.9 / 20), `held under the ceiling: ${peak}`);
});
