// Unit tests for the nodes that must always pass two channels on (src/audio/effects/delayLink.ts,
// src/audio/nativeNodes.ts). In Chromium a DelayNode, a filter or a shaper whose input goes from
// one channel to two or back starts over with its memory cleared: on a delay-compensated track, or
// after a recorded instrument's tone filters, that was a click each time a note kept in one channel
// (recordingMaths.ts) started or stopped beside a two-channel one. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
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

const { fixedDelay } = await import('../src/audio/effects/delayLink.ts');
const { alwaysStereo } = await import('../src/audio/nativeNodes.ts');

/** A stand-in for a context's createDelay: a node with Web Audio's defaults (it follows its input's channels). */
const fakeContext = () => ({
  createDelay: (max) => ({ max, channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers', delayTime: { value: 0, automationRate: 'a-rate' } }),
});

test("delay compensation's delay lines always take two channels, so a mono note starting or stopping never resets them", () => {
  const node = fixedDelay(fakeContext(), 0.006);
  assert.equal(node.channelCountMode, 'explicit');
  assert.equal(node.channelCount, 2);
  assert.equal(node.channelInterpretation, 'speakers');
  assert.equal(node.delayTime.value, 0.006);
  assert.equal(node.delayTime.automationRate, 'k-rate');
  assert.ok(node.max >= 0.012);
});

test("alwaysStereo fixes a node's input at two channels, a mono sound spread to both", () => {
  const node = { channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers' };
  alwaysStereo(node);
  assert.deepEqual(node, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
});
