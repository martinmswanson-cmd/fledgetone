// Unit tests for where a game's intro runs into its loop (src/audio/introSeam.ts): the intro's end
// crossfades into the loop's end, so intro then loop has no step at the join. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { leadIntoLoop, INTRO_SEAM_SECONDS } = await import('../src/audio/introSeam.ts');

const SR = 44100;

/** A seamless loop of a sine with a whole number of cycles (its last sample leads into its first). */
function loop(freq, amp, frames) {
  const cycles = Math.round((freq * frames) / SR);
  return [0, 1].map((c) => Float32Array.from({ length: frames }, (_, i) => amp * Math.sin((2 * Math.PI * cycles * i) / frames + c)));
}

/** The largest sample-to-sample step in `a` then `b`, and the one at the join. */
function steps(a, b) {
  const all = Float32Array.from([...a, ...b]);
  let most = 0;
  for (let i = 1; i < all.length; i++) if (i !== a.length) most = Math.max(most, Math.abs(all[i] - all[i - 1]));
  return { join: Math.abs(b[0] - a[a.length - 1]), most };
}

test('the intro leads into the loop without a step, whatever it ended on', () => {
  const l = loop(110, 0.5, SR);
  // An intro of another sound, ending far from where the loop starts
  const intro = [0, 1].map((c) => Float32Array.from({ length: 30000 }, (_, i) => 0.6 * Math.sin((2 * Math.PI * 330 * i) / SR + 1 + c)));
  const before = steps(intro[0], l[0]);
  assert.ok(before.join > 0.05, 'the test intro starts out with a step at the join');
  leadIntoLoop(intro, l, SR);
  for (let c = 0; c < 2; c++) {
    const after = steps(intro[c], l[c]);
    assert.ok(after.join <= after.most * 1.01, `channel ${c}: the join is no bigger than the sound's own steps (${after.join} vs ${after.most})`);
    // The intro's last sample is the loop's last, which leads into the loop's first
    assert.equal(intro[c][intro[c].length - 1], l[c][l[c].length - 1]);
  }
});

test('only the last few milliseconds change, and the loop not at all', () => {
  const l = loop(220, 0.3, 20000);
  const loopCopy = l.map((c) => c.slice());
  const intro = [new Float32Array(5000).fill(0.25), new Float32Array(5000).fill(-0.25)];
  leadIntoLoop(intro, l, SR);
  const fade = Math.round(INTRO_SEAM_SECONDS * SR);
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < 5000 - fade; i++) assert.equal(intro[c][i], c ? -0.25 : 0.25);
    assert.deepEqual(l[c], loopCopy[c]);
  }
});

test('an intro or loop shorter than the crossfade, or empty, is handled', () => {
  const l = loop(220, 0.3, 100);
  const intro = [new Float32Array(50).fill(1), new Float32Array(50).fill(1)];
  leadIntoLoop(intro, l, SR);
  assert.equal(intro[0][49], l[0][99]);
  leadIntoLoop([new Float32Array(0), new Float32Array(0)], l, SR);
  leadIntoLoop(intro, [new Float32Array(0), new Float32Array(0)], SR);
});
