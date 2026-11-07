// The Tone noise at every sample rate (src/audio/seededNoise.ts toneNoiseLoop, src/audio/loopResample.ts):
// at 44.1 kHz Tone's own samples; at any other rate the same noise resampled, so below 20 kHz a burst
// has the same level, band for band and hit for hit, live and exported at 44.1, 48, 88.2 or 96 kHz.
// (Made sample by sample at 96 kHz, white noise spread up to 48 kHz: a 96 kHz export's snare noise was
// 3 dB duller below 20 kHz than at 44.1 kHz.) Run with `npm test`.
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

const { TONE_NOISE_RATE, toneNoiseChannel, toneNoiseLoop } = await import('../src/audio/seededNoise.ts');
const { resampleLoop } = await import('../src/audio/loopResample.ts');

const RATES = [48000, 88200, 96000];
const SEED = 0x70e;
const db = (x) => 10 * Math.log10(x);
const energy = (x) => x.reduce((s, v) => s + v * v, 0);

/** `x` (one turn of a loop at `rate`) with nothing above `hz` left, at twice `hz`: the same filter whatever `rate` was. */
const below = (x, rate, hz) => resampleLoop(x, rate, 2 * hz);

test('at 44.1 kHz the noise is the one Tone makes, sample for sample (44.1 kHz exports unchanged)', () => {
  assert.equal(TONE_NOISE_RATE, 44100);
  for (const colour of ['white', 'pink', 'brown']) assert.deepEqual(toneNoiseLoop(colour, 1, 44100, SEED), toneNoiseChannel(colour, 44100, SEED));
});

test('at every other rate it lasts as long, and is the same noise below 20 kHz, band for band', () => {
  for (const colour of ['white', 'pink', 'brown']) {
    const ref = toneNoiseLoop(colour, 1, 44100, SEED);
    for (const rate of [...RATES, 32000, 192000]) {
      const x = toneNoiseLoop(colour, 1, rate, SEED);
      assert.equal(x.length, rate, `${colour} ${rate}`);
      // Energy below each octave's top (to 16 kHz) and below 18 kHz (the band up to 20 kHz but the filter's own edge), per second
      for (const hz of [18000, 16000, 8000, 4000, 2000, 1000, 500, 250, 125, 62.5]) {
        if (hz > rate * 0.45) continue;
        const a = below(ref, 44100, hz);
        const b = below(x, rate, hz);
        const off = db(energy(b) / energy(a));
        assert.ok(Math.abs(off) < 0.01, `${colour} at ${rate} Hz, below ${hz} Hz: ${off.toFixed(4)} dB`);
        // The same noise, not just as loud: what's left differs from it by 40 dB or more
        const diff = b.map((v, i) => v - a[i]);
        assert.ok(db(energy(diff) / energy(a)) < -40, `${colour} at ${rate} Hz, below ${hz} Hz: not the same noise`);
      }
    }
  }
});

test('made sample by sample at the higher rate instead, the white noise is 3 dB down below 18 kHz (what this guards against)', () => {
  const ref = toneNoiseLoop('white', 1, 44100, SEED);
  for (const [rate, expected] of [[88200, -3.01], [96000, -3.38]]) {
    const off = db(energy(below(toneNoiseChannel('white', rate, SEED), rate, 18000)) / energy(below(ref, 44100, 18000)));
    assert.ok(Math.abs(off - expected) < 0.25, `${rate}: ${off.toFixed(2)} dB`);
  }
});

test('the resampler keeps every frequency up to 20 kHz within 0.01 dB, adds nothing audible, and loops without a seam', () => {
  const size = 44100;
  for (const rate of RATES) {
    for (const hz of [20, 1000, 8000, 16000, 19000, 20000]) {
      const x = Float32Array.from({ length: size }, (_, i) => Math.sin((2 * Math.PI * hz * i) / 44100));
      const y = resampleLoop(x, 44100, rate);
      assert.equal(y.length, rate);
      // Against the same sine at the new rate, all the way round the loop (its seam included)
      let err = 0;
      let amp = 0;
      for (let i = 0; i < y.length; i++) {
        const want = Math.sin((2 * Math.PI * hz * i) / rate);
        err = Math.max(err, Math.abs(y[i] - want));
        amp += y[i] * want;
      }
      const gain = db(((2 * amp) / y.length) ** 2);
      assert.ok(Math.abs(gain) < 0.01, `${hz} Hz at ${rate}: ${gain.toFixed(4)} dB`);
      assert.ok(err < 0.01, `${hz} Hz at ${rate}: off by ${err} somewhere`);
    }
  }
  // At twice the rate every other sample is the old one, as it was
  const x = toneNoiseLoop('white', 1, 44100, SEED);
  const y = resampleLoop(x, 44100, 88200);
  for (let i = 0; i < x.length; i++) assert.equal(y[2 * i], x[i]);
});
