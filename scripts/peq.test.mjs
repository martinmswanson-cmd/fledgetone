// Unit tests for the parametric EQ's curves (src/audio/peq.ts). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { bandDb, peqDb, biquadQ, logFrequencies } = await import('../src/audio/peq.ts');

const near = (a, b, tol = 0.05) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const band = (type, freq, gain = 0, q = 1) => ({ on: true, type, freq, gain, q });

test('a bell lifts its own frequency by its gain and leaves the rest alone', () => {
  near(bandDb(band('bell', 1000, 6), 1000), 6);
  near(bandDb(band('bell', 1000, -9), 1000), -9);
  near(bandDb(band('bell', 1000, 6), 20), 0, 0.1);
  near(bandDb(band('bell', 1000, 6), 18000), 0, 0.2);
  // Wider (lower Q) reaches further
  assert.ok(bandDb(band('bell', 1000, 6, 0.5), 2000) > bandDb(band('bell', 1000, 6, 4), 2000));
});

test('shelves lift everything below (low) or above (high), half way at the corner', () => {
  near(bandDb(band('lowshelf', 200, 6), 30), 6, 0.2);
  near(bandDb(band('lowshelf', 200, 6), 200), 3, 0.1);
  near(bandDb(band('lowshelf', 200, 6), 8000), 0, 0.1);
  near(bandDb(band('highshelf', 4000, -6), 18000), -6, 0.3);
  near(bandDb(band('highshelf', 4000, -6), 100), 0, 0.1);
});

test('cuts are -3 dB at the corner with a Butterworth Q, and notches carve out their frequency', () => {
  near(bandDb(band('lowcut', 100, 0, Math.SQRT1_2), 100), -3.01, 0.05);
  assert.ok(bandDb(band('lowcut', 100, 0, Math.SQRT1_2), 25) < -20);
  near(bandDb(band('highcut', 5000, 0, Math.SQRT1_2), 5000), -3.01, 0.05);
  assert.ok(bandDb(band('notch', 1000, 0, 5), 1000) < -60);
  // Bands switched off do nothing; in series they add up
  assert.equal(bandDb({ ...band('bell', 1000, 6), on: false }, 1000), 0);
  near(peqDb([band('bell', 1000, 6), band('bell', 1000, 3)], 1000), 9);
  // Web Audio reads a cut's Q in dB
  near(biquadQ(band('lowcut', 100, 0, Math.SQRT1_2)), -3.01, 0.01);
  assert.equal(biquadQ(band('bell', 100, 0, 2)), 2);
  const f = logFrequencies(4);
  near(f[0], 20, 1e-9);
  near(f[3], 20000, 1e-6);
});
