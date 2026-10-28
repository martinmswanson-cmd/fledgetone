// Unit tests for the lush reverb run after an export's render (src/audio/effects/lushAfter.ts):
// the shared reverb's input filters and the lush kernel over the reverb sends, as the live graph
// runs them, so an export never loads the lush worklet into an offline context (which Chromium
// never frees). Run with `npm test`.
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

const { lushReverbOf, lushDecay, LUSH_PRE_DELAY, REVERB_LOW_CUT_HZ, REVERB_DAMP_HZ, REVERB_FILTER_Q } = await import('../src/audio/effects/lushAfter.ts');
const { webAudioLowpass, webAudioHighpass, biquad } = await import('../src/audio/effects/masterAfter.ts');
const { createLushKernel } = await import('../src/audio/effects/lushReverb.ts');
const { ROOM_STYLES } = await import('../src/audio/effects/roomIR.ts');

const SR = 44100;

/** A stereo burst of noise and a tone, then silence: `seconds` long, not a whole number of 128-frame blocks. */
function sends(seconds = 1.5) {
  const n = Math.round(seconds * SR) + 37;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  for (let i = 0; i < SR * 0.3; i++) {
    l[i] = 0.3 * rnd() + 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR);
    r[i] = 0.3 * rnd();
  }
  return [l, r];
}

/** A biquad's gain at `hz`, from its coefficients. */
function gainAt(c, hz) {
  const w = (2 * Math.PI * hz) / SR;
  const re = (k) => Math.cos(-k * w);
  const im = (k) => Math.sin(-k * w);
  const num = [c[0] + c[1] * re(1) + c[2] * re(2), c[1] * im(1) + c[2] * im(2)];
  const den = [1 + c[3] * re(1) + c[4] * re(2), c[3] * im(1) + c[4] * im(2)];
  return Math.hypot(...num) / Math.hypot(...den);
}

test("the low-pass passes the lows and cuts at the top, with Web Audio's Q in dB (the gain at the cutoff)", () => {
  const c = webAudioLowpass(5500, 0, SR);
  assert.ok(Math.abs(gainAt(c, 0) - 1) < 1e-9);
  assert.ok(Math.abs(20 * Math.log10(gainAt(c, 5500))) < 0.05);
  assert.ok(gainAt(c, 20000) < 0.05);
  // Q 1 (dB) peaks a dB at the cutoff, as a BiquadFilterNode does
  assert.ok(Math.abs(20 * Math.log10(gainAt(webAudioLowpass(5500, 1, SR), 5500)) - 1) < 0.05);
});

test('the lush reverb after the render is the filters then the kernel, block by block, as the worklet runs them', () => {
  const [l, r] = sends();
  const decay = 3.3;
  const [outL, outR] = lushReverbOf(l, r, SR, decay);
  assert.equal(outL.length, l.length);
  assert.equal(outR.length, r.length);
  // The same by hand
  const fl = Float32Array.from(l);
  const fr = Float32Array.from(r);
  for (const ch of [fl, fr]) {
    biquad(ch, webAudioHighpass(REVERB_LOW_CUT_HZ, REVERB_FILTER_Q, SR));
    biquad(ch, webAudioLowpass(REVERB_DAMP_HZ, REVERB_FILTER_Q, SR));
  }
  const kernel = createLushKernel(SR, { low: ROOM_STYLES.lush.low, preDelay: LUSH_PRE_DELAY });
  const n = Math.ceil(l.length / 128) * 128;
  const pad = (x) => {
    const y = new Float32Array(n);
    y.set(x);
    return y;
  };
  const [pl, pr, ol, or] = [pad(fl), pad(fr), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i += 128) kernel.process(pl.subarray(i, i + 128), pr.subarray(i, i + 128), ol.subarray(i, i + 128), or.subarray(i, i + 128), 128, Math.fround(lushDecay(decay)), Math.fround(ROOM_STYLES.lush.high), 1, 0);
  assert.deepEqual(outL, ol.subarray(0, l.length));
  assert.deepEqual(outR, or.subarray(0, r.length));
  // It rings, it's finite, and it leaves the sends as they were
  let energy = 0;
  for (let i = Math.round(0.5 * SR); i < outL.length; i++) {
    assert.ok(Number.isFinite(outL[i]) && Number.isFinite(outR[i]));
    energy += outL[i] ** 2;
  }
  assert.ok(energy > 1e-3, 'a tail after the burst');
  assert.equal(l[0], sends()[0][0]);
});

test('silence in, silence out, at any length (no block of its own)', () => {
  for (const n of [0, 1, 127, 128, 129, 1000]) {
    const [outL, outR] = lushReverbOf(new Float32Array(n), new Float32Array(n), SR, 2.4);
    assert.equal(outL.length, n);
    assert.ok(outL.every((v) => v === 0) && outR.every((v) => v === 0));
  }
});

test("each room style damps the highs where its room would, and the makeup keeps the reverb's level", async () => {
  const { dampingMakeup, RECORDED_ROOM_DAMP_HZ } = await import('../src/audio/effects/lushAfter.ts');
  // The lush reverb keeps the damping every style had (it runs at half the sample rate)
  assert.equal(ROOM_STYLES.lush.damp, REVERB_DAMP_HZ);
  assert.equal(dampingMakeup(REVERB_DAMP_HZ), 1);
  // A plate keeps its shine, a church is the darkest
  const damps = Object.values(ROOM_STYLES).map((s) => s.damp);
  assert.equal(Math.max(...damps), ROOM_STYLES.plate.damp);
  assert.ok(ROOM_STYLES.plate.damp >= 10000 && ROOM_STYLES.hall.damp >= 7000 && ROOM_STYLES.hall.damp <= 8000);
  assert.ok(ROOM_STYLES.church.damp < ROOM_STYLES.hall.damp);
  // Music through the low cut, the damping and its makeup is as loud as through the old 5.5 kHz,
  // weighted as loudness is measured: pink noise falling a further 6 dB an octave above 2 kHz, as
  // a mix's highs do (on five starter songs every room's sends landed within 0.06 dB of before; the
  // makeup worked out on plain pink noise had cut a plate's half a dB)
  const { kWeightingFilters } = await import('../src/audio/loudness.ts');
  const music = (n) => {
    const out = new Float32Array(n);
    let s = 1;
    const b = [0, 0, 0];
    let lp = 0;
    const k = 1 - Math.exp((-2 * Math.PI * 2000) / SR);
    for (let i = 0; i < n; i++) {
      s = (s * 16807) % 2147483647;
      const w = s / 1073741823.5 - 1;
      b[0] = 0.99765 * b[0] + w * 0.099;
      b[1] = 0.963 * b[1] + w * 0.2965;
      b[2] = 0.57 * b[2] + w * 1.0527;
      lp += k * ((b[0] + b[1] + b[2] + w * 0.1848) * 0.1 - lp);
      out[i] = lp;
    }
    return out;
  };
  const [shelf] = kWeightingFilters(SR);
  const level = (hz) => {
    const x = music(SR * 4);
    biquad(x, webAudioHighpass(REVERB_LOW_CUT_HZ, REVERB_FILTER_Q, SR));
    biquad(x, webAudioLowpass(hz, REVERB_FILTER_Q, SR));
    biquad(x, Float64Array.from(shelf));
    const g = dampingMakeup(hz);
    return 10 * Math.log10(x.reduce((a, v) => a + v * v * g * g, 0));
  };
  const before = level(REVERB_DAMP_HZ);
  for (const hz of [...damps, RECORDED_ROOM_DAMP_HZ]) {
    // (A lift of a tenth of a dB or so at most: a brighter damping is never a louder room)
    assert.ok(dampingMakeup(hz) >= 1 && dampingMakeup(hz) < 10 ** (0.2 / 20), `${hz}: makeup ${(20 * Math.log10(dampingMakeup(hz))).toFixed(2)} dB`);
    assert.ok(Math.abs(level(hz) - before) < 0.1, `${hz} Hz: ${(level(hz) - before).toFixed(2)} dB`);
  }
});
