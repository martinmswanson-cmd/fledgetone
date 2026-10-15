// The lush reverb (src/audio/effects/lushReverb.ts): its tail dies at the asked decay, stays finite (frozen too), differs left and right, rests in silence, and is as loud as the hall it stands beside.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createLushKernel, LUSH_WORKLET_SOURCE } = await import('../src/audio/effects/lushReverb.ts');
const { roomChannels, ROOM_STYLES } = await import('../src/audio/effects/roomIR.ts');
const SR = 48000;
const { low, high } = ROOM_STYLES.lush;

/** The kernel's answer to `input` (both sides), in blocks of 128 like a worklet. */
function run(kernel, input, seconds, { decay = 2.4, hi = high, size = 1, freeze = () => 0 } = {}) {
  const n = Math.round(seconds * SR);
  const inp = new Float32Array(n);
  inp.set(input.subarray(0, Math.min(n, input.length)));
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i += 128) {
    const m = Math.min(128, n - i);
    const d = typeof decay === 'function' ? decay(i / SR) : decay;
    const s = typeof size === 'function' ? size(i / SR) : size;
    kernel.process(inp.subarray(i, i + m), inp.subarray(i, i + m), L.subarray(i, i + m), R.subarray(i, i + m), m, d, hi, s, freeze(i / SR));
  }
  return [L, R];
}
const impulse = new Float32Array([1]);
const impulseResponse = (decay, seconds, opts = {}, hi = high) => run(createLushKernel(SR, { low, ...opts }), impulse, seconds, { decay, hi });
const energy = (x, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return s;
};

/** Reverberation time from the backward-integrated energy's fall from -5 to -35 dB (T30). */
function t30(x) {
  const edc = new Float64Array(x.length);
  let s = 0;
  for (let i = x.length - 1; i >= 0; i--) edc[i] = s += x[i] * x[i];
  let a = -1;
  for (let i = 0; i < x.length; i++) {
    const db = 10 * Math.log10(edc[i] / edc[0]);
    if (a < 0 && db < -5) a = i;
    if (db < -35) return ((i - a) / SR) * 2;
  }
  return Infinity;
}

/** A band-pass (RBJ, constant peak gain) at `f` Hz. */
function bandpass(x, f, q = 1.4) {
  const w = (2 * Math.PI * f) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const [b0, b2, a1, a2] = [alpha / a0, -alpha / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0];
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * How loud the reverb of a mix is: the impulse response's energy, through an FFT, for a sound
 * with a mix's spectrum (pink: equal energy per octave), after the filters every send goes
 * through on its way into the master reverb (busEffects.ts: 180 Hz high-pass, 5.5 kHz low-pass,
 * both 12 dB per octave with a Q of 1), weighted by the A curve.
 */
function aEnergy(x) {
  let n = 1;
  while (n < x.length) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const k = i + j + len / 2;
        const vr = re[k] * cr - im[k] * ci;
        const vi = re[k] * ci + im[k] * cr;
        re[k] = re[i + j] - vr;
        im[k] = im[i + j] - vi;
        re[i + j] += vr;
        im[i + j] += vi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  const weight = (f) => {
    const f2 = f * f;
    return (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  };
  const lowPass = (f, fc) => 1 / ((1 - (f / fc) ** 2) ** 2 + (f / fc) ** 2);
  const highPass = (f, fc) => (f / fc) ** 4 / ((1 - (f / fc) ** 2) ** 2 + (f / fc) ** 2);
  let e = 0;
  for (let k = 1; k < n / 2; k++) {
    const f = (k * SR) / n;
    e += (2 * (re[k] ** 2 + im[k] ** 2) * weight(f) ** 2 * lowPass(f, 5500) * highPass(f, 180)) / f;
  }
  return e / n;
}

test('the tail dies at the asked decay', () => {
  for (const decay of [1, 2.4, 6]) {
    // All bands alike: the whole tail
    const [flat] = impulseResponse(decay, decay * 1.5 + 0.5, { low: 1 }, 1);
    const t = t30(flat);
    assert.ok(Math.abs(t / decay - 1) < 0.15, `flat, decay ${decay}: T30 ${t.toFixed(2)}`);
    // As used: the middle band (1 kHz) at the decay, the highs sooner, the lows later
    const [l] = impulseResponse(decay, decay * 1.8 + 0.5);
    const mid = t30(bandpass(l, 1000));
    assert.ok(Math.abs(mid / decay - 1) < 0.15, `1 kHz, decay ${decay}: T30 ${mid.toFixed(2)}`);
    assert.ok(t30(bandpass(l, 8000)) < mid * 0.8, `decay ${decay}: highs die first`);
    assert.ok(t30(bandpass(l, 120)) > mid * 1.05, `decay ${decay}: lows ring on`);
  }
});

test('left and right are decorrelated', () => {
  const [l, r] = impulseResponse(2.4, 3);
  let lr = 0;
  for (let i = 0; i < l.length; i++) lr += l[i] * r[i];
  assert.ok(Math.abs(lr) / Math.sqrt(energy(l) * energy(r)) < 0.1);
  // And not merely each other turned over: their short stretches differ too
  let diff = 0;
  for (let i = 0; i < l.length; i += 7) diff += Math.abs(l[i] - r[i]) + Math.abs(l[i] + r[i]);
  assert.ok(diff > 1e-3);
});

test('as loud as the hall at the same decay (A-weighted, within 1 dB)', () => {
  for (const decay of [0.8, 2.4, 8, 12]) {
    // The convolver's normalization: the hall's impulse response (total energy 1) scaled by
    // 10^(-58/20) x sqrt(2 x length) x 44100 / sampleRate
    const [hl, hr] = roomChannels('hall', decay, SR);
    const k = (44100 / SR) * 10 ** (-58 / 20) * Math.sqrt(2 * hl.length);
    const hall = (aEnergy(hl) + aEnergy(hr)) * k * k;
    const [l, r] = impulseResponse(decay, Math.min(16, decay * 1.6 + 1));
    const db = 10 * Math.log10((aEnergy(l) + aEnergy(r)) / hall);
    assert.ok(Math.abs(db) < 1, `decay ${decay}: ${db.toFixed(2)} dB from the hall`);
  }
});

test('stays finite and steady frozen, at endless decay, and through changes while playing', () => {
  // Noise in for a second, then frozen for ten: the tail holds (no growth, no loss to speak of)
  const noise = new Float32Array(SR);
  let s = 12345;
  for (let i = 0; i < noise.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    noise[i] = (s / 2 ** 32 - 0.5) * 0.5;
  }
  const kernel = createLushKernel(SR, { low });
  const [l] = run(kernel, noise, 12, { decay: 3, freeze: (t) => (t >= 1.2 ? 1 : 0) });
  const second = (t) => energy(l, Math.round(t * SR), Math.round((t + 1) * SR));
  assert.ok(l.every(Number.isFinite));
  const held = second(2);
  assert.ok(held > 0);
  assert.ok(second(10.5) / held > 10 ** (-1.5 / 10) && second(10.5) / held < 10 ** (1.5 / 10), `frozen: ${(10 * Math.log10(second(10.5) / held)).toFixed(2)} dB`);

  // Endless decay, highs undamped, the size swept: never louder than the energy put in allows
  const [l2, r2] = run(createLushKernel(SR, { low: 3 }), noise, 10, { decay: (t) => (t < 4 ? 1e9 : 0.5 + (t % 1) * 20), hi: 1, size: (t) => 1 + 0.9 * Math.sin(t * 3) });
  let peak = 0;
  for (let i = 0; i < l2.length; i++) peak = Math.max(peak, Math.abs(l2[i]), Math.abs(r2[i]));
  assert.ok(l2.every(Number.isFinite) && r2.every(Number.isFinite));
  assert.ok(peak < 10, `peak ${peak}`);
});

test('changing the decay while it plays makes no click', () => {
  // A held tone through the reverb, its decay jumping from 1 s to 8 s and back: the output's
  // sample-to-sample steps stay as small as they were before the jump
  const tone = new Float32Array(SR * 3);
  for (let i = 0; i < tone.length; i++) tone[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR);
  const [l] = run(createLushKernel(SR, { low }), tone, 3, { decay: (t) => (t < 1.5 ? 1 : t < 2.2 ? 8 : 1) });
  const step = (a, b) => {
    let m = 0;
    for (let i = Math.round(a * SR) + 1; i < Math.round(b * SR); i++) m = Math.max(m, Math.abs(l[i] - l[i - 1]));
    return m;
  };
  const before = step(1, 1.5);
  assert.ok(step(1.5, 1.6) < before * 2.5 && step(2.2, 2.3) < before * 2.5);
});

test('rests in silence, and wakes for the next sound', () => {
  const kernel = createLushKernel(SR, { low });
  run(kernel, impulse, 15, { decay: 1 });
  assert.ok(kernel.idle(), 'rests once the tail has gone');
  const [l] = run(kernel, impulse, 0.5, { decay: 1 });
  assert.ok(!kernel.idle() && energy(l) > 0, 'wakes');
});

test('the worklet source is valid JavaScript with the kernel in it', () => {
  assert.match(LUSH_WORKLET_SOURCE, /registerProcessor\('bbx-lush-reverb'/);
  const make = new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', LUSH_WORKLET_SOURCE);
  let made;
  make(class {
    constructor() {
      this.port = {};
    }
  }, (name, cls) => (made = cls), SR);
  const node = new made({ processorOptions: { low } });
  const out = [new Float32Array(128), new Float32Array(128)];
  const inp = new Float32Array(128);
  inp[0] = 1;
  for (let i = 0; i < 20; i++) node.process([[i ? new Float32Array(128) : inp]], [out], { decay: [2.4], high: [0.5], size: [1], freeze: [0] });
  assert.ok(out[0].some((v) => v !== 0));
});
