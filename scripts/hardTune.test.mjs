// Unit tests for hard tune (src/audio/hardTune.ts), on a synthesised sung voice. Run with `npm test`.
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
const { speedToMs, msToSpeed, heldNote, hardCorrections, hardTuneChannels, centsOffScale, TUNE_SCALES, TUNE_SCALE_NAMES, NATURAL_MS } = await import('../src/audio/hardTune.ts');
const { corrections, detectPitch, midiToHz } = await import('../src/audio/vocalTune.ts');
const { testVoice } = await import('./audio-check/testVoice.mjs');

const SR = 44100;
const A_MINOR = { root: 9, steps: TUNE_SCALES.minor };

test('Speed runs from natural (slow glide) to instant, and back', () => {
  assert.equal(speedToMs(0), NATURAL_MS);
  assert.equal(speedToMs(100), 0);
  for (let s = 1; s <= 100; s++) assert.ok(speedToMs(s) <= speedToMs(s - 1));
  for (const s of [0, 20, 55, 80, 100]) assert.ok(Math.abs(msToSpeed(speedToMs(s)) - s) <= 1, `speed ${s}`);
});

test('the scales are in order from the root, and named', () => {
  for (const [name, steps] of Object.entries(TUNE_SCALES)) {
    assert.equal(steps[0], 0, name);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i] > steps[i - 1] && steps[i] < 12, name);
    assert.ok(TUNE_SCALE_NAMES[name]);
  }
});

test('a fast tune holds its note while the voice hovers half-way to the next', () => {
  // Chromatic: A (69) and A# (70); a voice wobbling around 69.5
  const chrom = TUNE_SCALES.chromatic;
  let held = null;
  const notes = [];
  for (let i = 0; i < 40; i++) {
    held = heldNote(69.5 + (i % 2 ? 0.12 : -0.12), held, 0, chrom, 0.2);
    notes.push(held);
  }
  assert.equal(new Set(notes).size, 1, 'no flipping');
  // Without the hold it flips every frame
  const flips = Array.from({ length: 40 }, (_, i) => heldNote(69.5 + (i % 2 ? 0.12 : -0.12), null, 0, chrom, 0));
  assert.equal(new Set(flips).size, 2);
  // Clearly nearer the next note: it moves
  assert.equal(heldNote(69.8, 69, 0, chrom, 0.2), 70);
  // A held note out of the scale is let go
  assert.equal(heldNote(70.2, 70, 9, TUNE_SCALES.minor, 0.2), 71);
});

test('at natural speed the corrections are the vocal tuner\'s own', () => {
  const frames = Array.from({ length: 60 }, (_, i) => ({ time: i * 0.01, hz: i < 30 ? 452 : 0 }));
  const s = { ...A_MINOR, strength: 0.8, speed: 0 };
  assert.deepEqual(hardCorrections(frames, s), corrections(frames, { ...A_MINOR, strength: 0.8, speed: NATURAL_MS }));
});

test('hard tune puts a sung voice on the notes of its key, keeping its length and level', () => {
  const v = testVoice({ style: 'sung' });
  const before = centsOffScale(detectPitch(v.samples, SR), 9, A_MINOR.steps);
  const hard = hardTuneChannels([v.samples], SR, { ...A_MINOR, strength: 1, speed: 100 });
  const slow = hardTuneChannels([v.samples], SR, { ...A_MINOR, strength: 1, speed: 50 });
  const after = centsOffScale(detectPitch(hard.channels[0], SR), 9, A_MINOR.steps);
  const afterSlow = centsOffScale(detectPitch(slow.channels[0], SR), 9, A_MINOR.steps);
  // Sung up to 35 cents off: about 24 cents on average. Instant: within a few cents
  assert.ok(before.mean > 15, `before ${before.mean.toFixed(1)}`);
  assert.ok(after.mean < 6 && after.within10 > 0.85, `instant: ${after.mean.toFixed(1)} cents, ${(after.within10 * 100).toFixed(0)}% within 10`);
  assert.ok(afterSlow.mean > after.mean && afterSlow.mean < before.mean, `slow ${afterSlow.mean.toFixed(1)}`);
  assert.equal(hard.channels[0].length, v.samples.length);
  const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
  assert.ok(Math.abs(20 * Math.log10(rms(hard.channels[0]) / rms(v.samples))) < 1, 'level within 1 dB');
  // The same every time (it's a processing step: what's applied is what exports play)
  assert.deepEqual(hardTuneChannels([v.samples], SR, { ...A_MINOR, strength: 1, speed: 100 }).channels[0], hard.channels[0]);
});

test('a note held in tune is left alone', () => {
  const x = new Float32Array(SR);
  const hz = midiToHz(57);
  for (let i = 0; i < x.length; i++) {
    const p = (2 * Math.PI * hz * i) / SR;
    x[i] = 0.3 * (Math.sin(p) + 0.5 * Math.sin(2 * p) + 0.25 * Math.sin(3 * p));
  }
  const frames = detectPitch(x, SR);
  const shift = hardCorrections(frames, { ...A_MINOR, strength: 1, speed: 100 });
  assert.ok(shift.every((s) => Math.abs(s) < 0.03), 'under 3 cents');
});
