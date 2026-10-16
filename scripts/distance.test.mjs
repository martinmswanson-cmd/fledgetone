// A track set back on the stage (src/audio/effects/distance.ts): its extra reverb send adds to the send, the track's own or an automation lane's.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { roomSendLevel, DISTANCE_SEND } = await import('../src/audio/effects/distance.ts');

test('distance adds to the send, whatever writes it, and stays within 0..3 (300%)', () => {
  assert.equal(roomSendLevel(0.2, 0), 0.2);
  assert.ok(Math.abs(roomSendLevel(0.2, 1) - (0.2 + DISTANCE_SEND)) < 1e-12);
  // A lane's values along a sweep: each one gets the same extra
  for (const lane of [0, 0.1, 0.3, 0.5]) assert.ok(Math.abs(roomSendLevel(lane, 0.6) - lane - DISTANCE_SEND * 0.6) < 1e-12, `lane at ${lane}`);
  assert.ok(Math.abs(roomSendLevel(0.9, 1) - (0.9 + DISTANCE_SEND)) < 1e-12);
  assert.equal(roomSendLevel(2.9, 1), 3);
  assert.equal(roomSendLevel(0, -1), 0);
  assert.equal(roomSendLevel(0.4, 2), roomSendLevel(0.4, 1));
});
