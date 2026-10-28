// Unit tests for vocal tuning (src/audio/vocalTune.ts). Run with `npm test`.
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
const { detectPitch, nearestNote, corrections, tuneChannels, psola, pitchMarks, hzToMidi, CHROMATIC } = await import('../src/audio/vocalTune.ts');
const { inharmonic, saw } = await import('./audio-check/fidelity.mjs');

const SR = 44100;
/** A voice-like tone: a few harmonics falling off, at `hz` (or a function of time). */
function voice(hzAt, seconds, amp = 0.4) {
  const x = new Float32Array(Math.round(seconds * SR));
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    phase += (2 * Math.PI * hzAt(i / SR)) / SR;
    x[i] = amp * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase) + 0.12 * Math.sin(4 * phase)) / 1.9;
  }
  return x;
}
const median = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
const CMAJ = { root: 0, steps: [0, 2, 4, 5, 7, 9, 11] };

test('the pitch of a steady voice is found within a few cents', () => {
  for (const hz of [110, 220, 452, 700]) {
    const frames = detectPitch(voice(() => hz, 0.5), SR).filter((f) => f.hz > 0);
    assert.ok(frames.length > 30);
    const cents = 1200 * Math.log2(median(frames.map((f) => f.hz)) / hz);
    assert.ok(Math.abs(cents) < 5, `${hz} Hz read ${cents.toFixed(1)} cents off`);
  }
  // Silence is unpitched
  assert.ok(detectPitch(new Float32Array(SR / 2), SR).every((f) => f.hz === 0));
});

test('nearest notes of a key, and corrections eased in by speed', () => {
  assert.equal(nearestNote(69.4, 0, CMAJ.steps), 69); // A
  assert.equal(nearestNote(70.4, 0, CMAJ.steps), 71); // A# is not in C major: B
  assert.equal(nearestNote(70.4, 0, CHROMATIC), 70);
  const frames = Array.from({ length: 50 }, (_, i) => ({ time: i * 0.01, hz: 452 }));
  const snap = corrections(frames, { ...CMAJ, strength: 1, speed: 0 });
  assert.ok(Math.abs(snap[10] - (69 - hzToMidi(452))) < 1e-9);
  const half = corrections(frames, { ...CMAJ, strength: 0.5, speed: 0 });
  assert.ok(Math.abs(half[10] - snap[10] / 2) < 1e-9);
  // A slow speed starts from the full correction at the phrase start, then holds (steady pitch)
  const slow = corrections(frames, { ...CMAJ, strength: 1, speed: 200 });
  assert.ok(Math.abs(slow[40] - snap[40]) < 1e-9);
});

test('a sharp note is pulled onto the key, keeping its length', () => {
  const x = voice(() => 452, 1); // A4 + 47 cents
  const { channels } = tuneChannels([x], SR, { ...CMAJ, strength: 1, speed: 0 });
  assert.equal(channels[0].length, x.length);
  const hz = median(detectPitch(channels[0], SR).filter((f) => f.hz > 0).map((f) => f.hz));
  assert.ok(Math.abs(1200 * Math.log2(hz / 440)) < 8, `tuned to ${hz.toFixed(1)} Hz`);
  // Level kept within a dB
  const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  assert.ok(Math.abs(20 * Math.log10(rms(channels[0]) / rms(x))) < 1, 'level');
});

test('a gliding voice snaps to the notes of the scale with speed 0', () => {
  // A slow glide from A4 up to C5 over a second
  const x = voice((t) => 440 * 2 ** ((3 * t) / 12), 1);
  const { channels } = tuneChannels([x], SR, { ...CMAJ, strength: 1, speed: 0 });
  const tuned = detectPitch(channels[0], SR).filter((f) => f.hz > 0 && f.time > 0.05 && f.time < 0.95);
  // Most frames sit on A, B or C (within 15 cents)
  const onNote = tuned.filter((f) => {
    const m = hzToMidi(f.hz);
    return [69, 71, 72].some((n) => Math.abs(m - n) < 0.15);
  }).length;
  assert.ok(onNote / tuned.length > 0.8, `${onNote} of ${tuned.length} frames on a note`);
});

test('the cycles are found to a fraction of a sample, one true period apart', () => {
  const hz = 220 * 2 ** (2 / 12);
  const x = saw([hz], 1.5, SR);
  const marks = pitchMarks(x, SR, detectPitch(x, SR)).filter((m) => m.voiced);
  assert.ok(marks.length > 200);
  const period = SR / hz;
  const errors = marks.slice(20, -20).map((m) => Math.abs(m.period - period));
  assert.ok(Math.max(...errors) < 0.1, `periods up to ${Math.max(...errors).toFixed(3)} samples off`);
  assert.ok(errors.reduce((a, b) => a + b, 0) / errors.length < 0.02, 'periods off on average');
});

test('tuning keeps the sound clean: nothing new between the harmonics, the highs as clean as the lows', () => {
  // A saw sung 30 cents flat, pulled onto A3, and saws moved 2 semitones up and down
  const flat = saw([220 * 2 ** (-0.3 / 12)], 3, SR);
  const { channels } = tuneChannels([flat], SR, { root: 9, steps: [0, 2, 4, 5, 7, 9, 11], strength: 1, speed: 0 });
  const tuned = inharmonic(channels[0], SR, [220]);
  assert.ok(tuned.all < -40, `30 cents: ${tuned.all.toFixed(1)} dB between the harmonics`);
  assert.ok(tuned.noise48 < tuned.harm48 - 30 && tuned.noise816 < tuned.harm816 - 30, `30 cents, highs: 4-8 kHz ${tuned.noise48.toFixed(1)} / ${tuned.harm48.toFixed(1)}, 8-16 kHz ${tuned.noise816.toFixed(1)} / ${tuned.harm816.toFixed(1)}`);
  for (const st of [2, -2]) {
    const x = saw([220 * 2 ** (-st / 12)], 3, SR);
    const frames = detectPitch(x, SR);
    const out = psola(x, SR, frames, frames.map((f) => (f.hz > 0 ? st : 0)));
    const m = inharmonic(out, SR, [220]);
    assert.ok(m.all < -40, `${st} st: ${m.all.toFixed(1)} dB`);
    assert.ok(m.noise816 < m.harm816 - 30, `${st} st, 8-16 kHz: ${m.noise816.toFixed(1)} / ${m.harm816.toFixed(1)}`);
    assert.equal(out.length, x.length);
  }
});
