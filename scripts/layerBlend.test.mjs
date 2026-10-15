// Blending two of a note's loudnesses (src/audio/samplers/layerBlend.ts): it runs from one to the other, the level stays within about a decibel for lined-up recordings, and exactly level where how alike they are is known.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { layerBlend, blendFor, correlationOf } = await import('../src/audio/samplers/layerBlend.ts');

test('from the softer to the louder recording, each fading the other way', () => {
  assert.deepEqual(layerBlend(0).map((v) => +v.toFixed(9)), [1, 0]);
  assert.deepEqual(layerBlend(1).map((v) => +v.toFixed(9)), [0, 1]);
  let last = layerBlend(0);
  for (let x = 0.05; x <= 1.0001; x += 0.05) {
    const now = layerBlend(x);
    assert.ok(now[0] <= last[0] && now[1] >= last[1]);
    last = now;
  }
});

test('the blend stays within about a decibel of either end for lined-up recordings', () => {
  // The level of two equally loud recordings that move together `rho` of the time
  const db = (x, rho) => {
    const [a, b] = layerBlend(x);
    return 10 * Math.log10(a * a + b * b + 2 * rho * a * b);
  };
  for (const rho of [0.25, 0.5, 0.75, 1]) {
    for (let x = 0; x <= 1.0001; x += 0.05) assert.ok(Math.abs(db(x, rho)) < 1.3, `rho ${rho}, x ${x.toFixed(2)}: ${db(x, rho).toFixed(2)} dB`);
  }
  // Equal power, the old way, rose 3 dB in the middle for recordings in step
  assert.ok(Math.abs(db(0.5, 0.5)) < 0.01);
});

test('knowing how alike two recordings are, the blend is exactly as loud as either alone', () => {
  const SR = 48000;
  const n = SR / 2;
  const tone = (phase) => [new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 220 * i) / SR + phase))];
  const a = tone(0);
  for (const phase of [0, 1, 2, Math.PI]) {
    const b = tone(phase);
    const rho = correlationOf(a, b, SR);
    assert.ok(Math.abs(rho - Math.cos(phase)) < 0.01, `phase ${phase}: ${rho}`);
    for (let x = 0; x <= 1.0001; x += 0.1) {
      const [ga, gb] = blendFor(x, rho);
      let e = 0;
      for (let i = 0; i < n; i++) e += (ga * a[0][i] + gb * b[0][i]) ** 2;
      const db = 10 * Math.log10(e / (n / 2));
      // (two recordings in opposite phase can't be brought back in the middle: at most twice as loud)
      if (phase < 3) assert.ok(Math.abs(db) < 0.05, `phase ${phase}, x ${x.toFixed(1)}: ${db.toFixed(2)} dB`);
    }
  }
});
