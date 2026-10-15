// Delay compensation's glides (src/audio/delayGlide.ts): a delay changes length by gliding slowly, so a held low note neither dips (as a crossfade to the new length made it) nor audibly bends.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { planGlide, glideAt, GLIDE_RATE, GLIDE_MAX } = await import('../src/audio/delayGlide.ts');

const SR = 48000;
const cents = (ratio) => Math.abs(1200 * Math.log2(ratio));

/** A sine of `hz` at time `t`, held back by `delay` seconds. */
const delayed = (hz, t, delay) => Math.sin(2 * Math.PI * hz * (t - delay));

/** The tone's lowest amplitude over [from, to) seconds, in dB (exact for a sine: sqrt(x^2 + (dx / 2 sin w)^2)). */
function lowest(signal, hz, from, to) {
  const w = (2 * Math.PI * hz) / SR;
  let lo = Infinity;
  for (let n = Math.round(from * SR); n < to * SR; n++) {
    const x = signal(n / SR);
    const q = (signal((n + 1) / SR) - signal((n - 1) / SR)) / (2 * Math.sin(w));
    lo = Math.min(lo, Math.hypot(x, q));
  }
  return 20 * Math.log10(lo);
}

test('a compressor-sized change glides with a bend under 9 cents, and big changes still finish in time', () => {
  const g = planGlide(0, 0.006, 1);
  assert.ok(cents(1 + (g.to - g.from) / (g.end - g.start)) < 9, 'bend');
  assert.ok(Math.abs(g.end - g.start - 0.006 / GLIDE_RATE) < 1e-9);
  const big = planGlide(0.05, 0, 0);
  assert.ok(big.end - big.start <= GLIDE_MAX + 1e-9);
  assert.equal(glideAt(g, 0), 0);
  assert.equal(glideAt(g, 99), 0.006);
});

test('a new glide starts where the last one is, so changing course mid-glide never jumps', () => {
  const a = planGlide(0, 0.006, 0);
  const at = 0.7;
  const b = planGlide(glideAt(a, at), 0.002, at);
  assert.ok(Math.abs(glideAt(b, at) - glideAt(a, at)) < 1e-12);
  assert.ok(glideAt(b, at) > 0 && glideAt(b, at) < 0.006);
});

test('on held 49 and 78 Hz tones, crossfading to a 6 ms longer delay dips; handing over at the same delay and gliding does not', () => {
  for (const hz of [49, 77.8]) {
    // The old way: a 10 ms linear crossfade from no delay to 6 ms
    const fade = (t) => Math.min(1, Math.max(0, (t - 0.1) / 0.01));
    const crossfade = (t) => (1 - fade(t)) * delayed(hz, t, 0) + fade(t) * delayed(hz, t, 0.006);
    // Now: the crossfade is between two paths at the same delay, then the new one glides
    const g = planGlide(0, 0.006, 0.11);
    const glided = (t) => (1 - fade(t)) * delayed(hz, t, 0) + fade(t) * delayed(hz, t, glideAt(g, t));
    const before = lowest(crossfade, hz, 0.09, 0.13);
    const after = lowest(glided, hz, 0.09, g.end + 0.05);
    assert.ok(before < -3, `${hz} Hz crossfade: ${before.toFixed(1)} dB`);
    assert.ok(after > -0.05, `${hz} Hz glide: ${after.toFixed(2)} dB`);
  }
});
