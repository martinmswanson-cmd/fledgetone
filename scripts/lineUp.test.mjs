// Unit tests for lining up recording (src/audio/lineUp.ts): finding the round trip of a click train
// in synthetic recordings (delayed, quieter, filtered, noisy, with a hum and an echo), refusing
// recordings without the clicks, the setup key and the Bluetooth hint. Run with `npm test`.
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
const { clickTrain, findRoundTrip, lineUpKey, likelyBluetooth, CLICK_LEVEL, MAX_ROUND_TRIP } = await import('../src/audio/lineUp.ts');

const RATE = 48000;

/** A seeded noise source, so the tests are the same every run. */
function noise(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  };
}

/** The train as a microphone would record it: `lead` samples of room before it was played, then `delay` s late, scaled, with options. */
function record({ lead = 4800, delay, gain = 0.3, noiseLevel = 0, hum = 0, echo = 0, smear = false, seed = 1 }) {
  const train = clickTrain(RATE);
  const out = new Float32Array(lead + Math.round((MAX_ROUND_TRIP + 2.6) * RATE));
  const d = lead + Math.round(delay * RATE);
  for (let i = 0; i < train.length; i++) {
    if (d + i < out.length) out[d + i] += gain * train[i];
    const e = d + i + Math.round(0.023 * RATE);
    if (echo && e < out.length) out[e] += echo * gain * train[i];
  }
  if (smear) {
    // A small speaker and microphone: a gentle low-pass
    let y = 0;
    for (let i = 0; i < out.length; i++) out[i] = y += 0.35 * (out[i] - y);
  }
  const rnd = noise(seed);
  for (let i = 0; i < out.length; i++) out[i] += noiseLevel * rnd() + hum * Math.sin((2 * Math.PI * 50 * i) / RATE);
  return { out, lead };
}

test('the click train is soft and has no hard edges', () => {
  const train = clickTrain(RATE);
  const peak = train.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak <= CLICK_LEVEL + 1e-9 && peak > CLICK_LEVEL * 0.9, `peak ${peak}`);
  assert.equal(train[0], 0);
  assert.ok(Math.abs(train[train.length - 1]) < 1e-6);
});

test('finds the delay of a clean recording to the sample', () => {
  for (const delay of [0, 0.012, 0.087, 0.2501, 0.48]) {
    const { out, lead } = record({ delay });
    const trip = findRoundTrip(out, RATE, lead);
    assert.ok(trip, `delay ${delay}`);
    assert.ok(Math.abs(trip.seconds - delay) <= 1 / RATE + 1e-9, `delay ${delay}: found ${trip.seconds}`);
    assert.ok(trip.match > 0.9);
  }
});

test('finds it through noise, a hum, an echo and a dull speaker (within half a millisecond)', () => {
  const delay = 0.143;
  const { out, lead } = record({ delay, gain: 0.08, noiseLevel: 0.01, hum: 0.05, echo: 0.5, smear: true, seed: 7 });
  const trip = findRoundTrip(out, RATE, lead);
  assert.ok(trip);
  assert.ok(Math.abs(trip.seconds - delay) < 0.0005, `found ${trip.seconds}`);
  assert.ok(trip.spread < 0.002);
});

test('a recording without the clicks, or with only noise, gives no answer', () => {
  const silent = new Float32Array(RATE * 3);
  assert.equal(findRoundTrip(silent, RATE, 4800), null);
  const { out } = record({ delay: 0.1, gain: 0, noiseLevel: 0.2, seed: 3 });
  assert.equal(findRoundTrip(out, RATE, 4800), null);
});

test('clicks buried in loud noise give no answer rather than a wrong one', () => {
  const delay = 0.2;
  const { out, lead } = record({ delay, gain: 0.002, noiseLevel: 0.3, seed: 11 });
  const trip = findRoundTrip(out, RATE, lead);
  assert.ok(trip === null || Math.abs(trip.seconds - delay) < 0.001);
});

test('a delay beyond the longest looked for is not mistaken for a short one', () => {
  const { out, lead } = record({ delay: MAX_ROUND_TRIP + 0.3 });
  const trip = findRoundTrip(out, RATE, lead);
  assert.ok(trip === null || trip.match < 0.5);
});

test('the setup key tells microphones and slow outputs apart', () => {
  const a = lineUpKey({ sampleRate: 48000, inputLabel: 'Built-in  Microphone', outputLatency: 0.04 });
  assert.equal(a, lineUpKey({ sampleRate: 48000, inputLabel: 'built-in microphone', outputLatency: 0.06 }));
  assert.notEqual(a, lineUpKey({ sampleRate: 48000, inputLabel: 'Built-in Microphone', outputLatency: 0.22 }));
  assert.notEqual(a, lineUpKey({ sampleRate: 44100, inputLabel: 'Built-in Microphone', outputLatency: 0.04 }));
  assert.equal(lineUpKey({ sampleRate: 48000, outputLatency: 0 }), '48000|default|quick');
});

test('Bluetooth is suspected from a slow output or the microphone name', () => {
  assert.equal(likelyBluetooth(0.03, 'Built-in Microphone'), false);
  assert.equal(likelyBluetooth(0.18), true);
  assert.equal(likelyBluetooth(0.02, 'Galaxy Buds2 Pro'), true);
  assert.equal(likelyBluetooth(0.02, 'Bluetooth headset'), true);
  assert.equal(likelyBluetooth(0.02, 'Headset microphone'), false);
});
