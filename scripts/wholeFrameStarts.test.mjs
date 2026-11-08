// Buffers start on whole frames (src/audio/wholeFrameStarts.ts): Chromium reads a buffer started
// between two frames between its samples, which took 2.4 dB off an exported noise burst (every
// export's notes fall 0.3 of a frame past one) while the same hit played by hand, on a frame, kept
// it: the Groove Drum Kit's snare was 1.1 dB quieter exported than heard. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A stand-in for the browser's AudioBufferSourceNode, made before the module patches it: its starts as the browser gets them
class FakeSource {
  constructor(context) {
    this.context = context;
    this.starts = [];
  }
  start(...args) {
    this.starts.push(args);
  }
}
globalThis.AudioBufferSourceNode = FakeSource;
const { bufferStartTime } = await import('../src/audio/wholeFrameStarts.ts');

const SR = 44100;

test('a buffer asked to start between frames starts on the next one', () => {
  // An export's note: 0.3 of a frame past one (planRender)
  assert.equal(bufferStartTime((11025 + 0.3) / SR, SR), 11026 / SR);
  assert.equal(bufferStartTime((11025 + 0.5) / SR, SR), 11026 / SR);
  assert.equal(bufferStartTime((11025 + 0.99) / SR, SR), 11026 / SR);
  assert.equal(bufferStartTime((48000 * 3 + 0.3) / 48000, 48000), (48000 * 3 + 1) / 48000);
});

test('a start on a frame (or within a float hair of one) is left exactly as it is', () => {
  for (const t of [11025 / SR, 0.25, 1.5, (11025 + 1e-4) / SR, (11025 - 1e-4) / SR, (123456 + 1e-9) / SR]) assert.ok(Object.is(bufferStartTime(t, SR), t), String(t));
});

test('every buffer source started at a time gets it on a whole frame; its offset and length pass through', () => {
  const src = new FakeSource({ sampleRate: SR });
  src.start((22050 + 0.3) / SR, 1.2345, 0.5);
  src.start(22050 / SR, 0.1);
  src.start(0);
  src.start();
  assert.deepEqual(src.starts, [[22051 / SR, 1.2345, 0.5], [22050 / SR, 0.1], [0], []]);
});

test('loaded where the sounds are made, before any buffer is started', () => {
  for (const file of ['../src/audio/engine.ts', '../src/audio/instruments.ts']) {
    assert.match(readFileSync(new URL(file, import.meta.url), 'utf8'), /^import '\.\/wholeFrameStarts';$/m, file);
  }
});
