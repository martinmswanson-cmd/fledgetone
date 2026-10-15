// Unit tests for lengthening a recording that stops dead and looping it for a note held longer
// still (src/audio/samplers/recordingMaths.ts: lengthenSustain, sustainLoop). A drone or an
// ambience written as one long note (rain under a whole song) went silent after the lengthened
// recording's 10 s. Run with `npm test`.
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

const { lengthenSustain, sustainLoop } = await import('../src/audio/samplers/recordingMaths.ts');

const SR = 8000;
/** A 3 s recording: a tone whose pitch and level wander, so no two stretches of it are alike. */
function recording() {
  const n = 3 * SR;
  const x = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * (220 + 30 * Math.sin(i / 900))) / SR;
    x[i] = (0.4 + 0.2 * Math.sin(i / 1300)) * Math.sin(phase);
  }
  return x;
}

test('the second repeat of a lengthened sustain loops without a seam', () => {
  const data = recording();
  const [start, end, xf, fade] = [Math.round(1.2 * SR), 3 * SR, Math.round(0.12 * SR), Math.round(0.3 * SR)];
  const out = new Float32Array(10 * SR);
  lengthenSustain(out, data, start, end, xf, fade);
  const loop = sustainLoop(start, end, xf, out.length, fade);
  assert.ok(loop, 'a loop fits in 10 s');
  const [a, b] = loop;
  // Played over and over, the loop is the lengthened sound itself: the next repeat is the same
  for (let j = 0; j < b - a; j++) assert.equal(out[b + j], out[a + j], `sample ${j} of the next repeat`);
  // So the wrap from its last sample to its first is a step like any other in the sound
  let most = 0;
  for (let i = a + 1; i < b; i++) most = Math.max(most, Math.abs(out[i] - out[i - 1]));
  assert.ok(Math.abs(out[a] - out[b - 1]) <= most);
  // ...and it's all before the fade out
  assert.ok(b <= out.length - fade);
  // Up to the end of the recording, the recording itself
  for (let i = 0; i < end - xf; i++) assert.equal(out[i], data[i]);
  assert.equal(Math.abs(out[out.length - 1]), 0);
});

test('no loop when the lengthened recording is too short to hold one before its fade', () => {
  assert.equal(sustainLoop(1000, 2000, 100, 2500, 300), null);
  assert.equal(sustainLoop(1000, 1050, 100, 50000, 300), null);
  assert.deepEqual(sustainLoop(1000, 2000, 100, 6000, 300), [2800, 3700]);
});
