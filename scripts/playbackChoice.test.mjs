// The playback mode setting (src/audio/playbackChoice.ts): the app switches itself to Stable only when nobody chose a mode, never over a choice made on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { readPlaybackChoice, shouldSwitchToStable, AUTO_STABLE } = await import('../src/audio/playbackChoice.ts');

test('a stored choice reads as chosen; nothing stored, or the app\'s own switch, does not', () => {
  assert.deepEqual(readPlaybackChoice(null), { mode: 'responsive', chosen: false });
  assert.deepEqual(readPlaybackChoice('responsive'), { mode: 'responsive', chosen: true });
  assert.deepEqual(readPlaybackChoice('stable'), { mode: 'stable', chosen: true });
  assert.deepEqual(readPlaybackChoice(AUTO_STABLE), { mode: 'stable', chosen: false });
  assert.deepEqual(readPlaybackChoice('nonsense'), { mode: 'responsive', chosen: false });
});

test('lagging twice switches to Stable only when nobody chose Responsive', () => {
  assert.equal(shouldSwitchToStable(2, 'responsive', null), true);
  assert.equal(shouldSwitchToStable(1, 'responsive', null), false);
  // Chosen on purpose: kept
  assert.equal(shouldSwitchToStable(5, 'responsive', 'responsive'), false);
  // Already switching (or switched) to Stable: once is enough
  assert.equal(shouldSwitchToStable(3, 'responsive', AUTO_STABLE), false);
  assert.equal(shouldSwitchToStable(3, 'responsive', 'stable'), false);
  assert.equal(shouldSwitchToStable(3, 'stable', null), false);
});
