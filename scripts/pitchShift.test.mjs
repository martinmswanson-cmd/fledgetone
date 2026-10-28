// Unit tests for how cleanly sound is re-pitched and re-shaped: Move to key (src/audio/pitchShift.ts,
// through the phase vocoder and the band-limited resampler, src/audio/resample.ts) and the formant
// shift (src/audio/formantShift.ts), on synthesised chords and voices with known partials. Run with
// `npm test`.
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
const { pitchShiftChannels } = await import('../src/audio/pitchShift.ts');
const { resample } = await import('../src/audio/resample.ts');
const { formantShiftChannels } = await import('../src/audio/formantShift.ts');
const { inharmonic, saw, AMAJ } = await import('./audio-check/fidelity.mjs');

const SR = 44100;

test('a chord moved into another key stays a clean chord, as long as it was', () => {
  const chord = saw(AMAJ, 3, SR);
  for (const [st, limit] of [[1, -50], [-3, -50], [3, -45], [7, -40], [12, -30]]) {
    const [out] = pitchShiftChannels([chord], st, SR);
    assert.equal(out.length, chord.length);
    const m = inharmonic(out, SR, AMAJ.map((f) => f * 2 ** (st / 12)));
    assert.ok(m.all < limit, `${st} st: ${m.all.toFixed(1)} dB between the partials`);
  }
});

test('reading faster takes off what would fold back down (no aliasing)', () => {
  // A 15 kHz tone read twice as fast would fold to 14.1 kHz: it must go, a 3 kHz tone must stay
  const n = SR;
  const x = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 15000 * i) / SR) + 0.5 * Math.sin((2 * Math.PI * 3000 * i) / SR));
  const y = resample(x, 2, n / 2);
  // Level of what's left at 6 kHz (the 3 kHz tone, read twice as fast) against the rest
  const tone = (f) => {
    let re = 0;
    let im = 0;
    for (let i = 1000; i < y.length - 1000; i++) {
      re += y[i] * Math.cos((2 * Math.PI * f * i) / SR);
      im += y[i] * Math.sin((2 * Math.PI * f * i) / SR);
    }
    return Math.hypot(re, im) / ((y.length - 2000) / 2);
  };
  assert.ok(Math.abs(tone(6000) - 0.5) < 0.01, `kept tone ${tone(6000)}`);
  assert.ok(tone(44100 - 30000) < 0.5 * 10 ** (-60 / 20), `aliased tone ${tone(14100)}`);
});

test('a formant shift moves the voice, not its pitch: nothing new between the harmonics', () => {
  const f0 = 231.3;
  const voice = saw([f0], 3, SR, 0.3);
  for (const st of [2, -2, -4]) {
    const [out] = formantShiftChannels([voice], st, SR, SR / f0);
    assert.equal(out.length, voice.length);
    const m = inharmonic(out, SR, [f0]);
    assert.ok(m.all < -40, `${st} st: ${m.all.toFixed(1)} dB between the harmonics`);
  }
  // It does move the outline: a resonance at 1 kHz moves up a major third
  const r = Math.exp((-Math.PI * 120) / SR);
  const th = (2 * Math.PI * 1000) / SR;
  const vowel = new Float32Array(voice.length);
  for (let i = 2; i < voice.length; i++) vowel[i] = (1 - r) * voice[i] + 2 * r * Math.cos(th) * vowel[i - 1] - r * r * vowel[i - 2];
  const level = (x, hz) => {
    let re = 0;
    let im = 0;
    for (let i = SR; i < 2 * SR; i++) {
      re += x[i] * Math.cos((2 * Math.PI * hz * i) / SR);
      im += x[i] * Math.sin((2 * Math.PI * hz * i) / SR);
    }
    return Math.hypot(re, im);
  };
  const [up] = formantShiftChannels([vowel], 4, SR, SR / f0);
  // The harmonics nearest the old resonance (925 Hz) and the new one (1157 Hz, after 1260)
  const before = level(vowel, 4 * f0) / level(vowel, 5 * f0);
  const after = level(up, 4 * f0) / level(up, 5 * f0);
  assert.ok(after < before / 1.2, `formants up: the 5th harmonic should gain on the 4th (${before.toFixed(2)} -> ${after.toFixed(2)})`);
});
