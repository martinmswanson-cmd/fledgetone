// A recorded note's brightness for its velocity, played expressively (src/audio/samplers/velocityTone.ts): open when played hard, darker as it gets softer, never under the floor that keeps a low note defined.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { expressiveCutoff, FULL_TONE, OPEN_CUTOFF, FLOOR } = await import('../src/audio/samplers/velocityTone.ts');
const E1 = 41.2, C4 = 261.63, C7 = 2093;

test('played hard, a note is the recording as made: no darkening from FULL_TONE up, whatever its pitch', () => {
  for (const hz of [E1, C4, C7]) for (const v of [FULL_TONE, 0.95, 1]) assert.equal(expressiveCutoff(v, 2.5, hz), OPEN_CUTOFF);
  // (an E1 bass played at full velocity was cut at its 48th harmonic, under 2 kHz)
  assert.ok(expressiveCutoff(1, 2, E1) > 48 * E1 * 5);
});

test('softer notes darken smoothly, never under the floor', () => {
  for (const hz of [E1, C4, C7]) {
    let last = OPEN_CUTOFF;
    for (let v = FULL_TONE; v >= 0; v -= 0.05) {
      const c = expressiveCutoff(v, 2.5, hz);
      assert.ok(c <= last + 1e-9, `${hz} Hz at ${v.toFixed(2)}`);
      // smooth: no step of more than a fifth of an octave per 0.05 of velocity
      assert.ok(Math.log2(last / c) < 0.2, `${hz} Hz at ${v.toFixed(2)}: ${last} -> ${c}`);
      assert.ok(c >= Math.max(FLOOR, 3 * hz) - 1e-9);
      last = c;
    }
  }
  // The softest notes are clearly darker than full ones, low and high
  assert.equal(expressiveCutoff(0, 2.5, E1), FLOOR);
  assert.equal(expressiveCutoff(0, 2.5, C4), FLOOR);
  assert.ok(expressiveCutoff(0.5, 2.5, C4) < 12000);
  assert.ok(expressiveCutoff(0, 2.5, C7) >= 3 * C7);
  // A set recorded at several loudnesses darkens less (a smaller depth)
  assert.ok(expressiveCutoff(0.5, 1, C7) > expressiveCutoff(0.5, 2.5, C7));
});
