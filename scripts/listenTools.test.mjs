// The tuner's and the spectrum analyser's maths (src/audio/tunerMath.ts, analyserMath.ts). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const T = await import('../src/audio/tunerMath.ts');
const A = await import('../src/audio/analyserMath.ts');

const SR = 48000;
const N = 4096;
const cents = (a, b) => 1200 * Math.log2(a / b);
/** A note of `harmonics` (their levels, the 1st first) at `hz`. */
const tone = (hz, harmonics = [1], rate = SR, n = N, phase = 0.3) => Float32Array.from({ length: n }, (_, i) => harmonics.reduce((s, g, h) => s + g * Math.sin((2 * Math.PI * hz * (h + 1) * i) / rate + phase * (h + 1)), 0) * 0.2);

test('a note is found to within a couple of cents, from a bass\'s low B to a high voice', () => {
  for (const hz of [30.87, 41.2, 82.41, 110, 196, 246.94, 329.63, 440, 523.25, 880, 1318.5]) {
    for (const shape of [[1], [1, 0.5, 0.33, 0.25, 0.2], [1, 0, 0.33, 0, 0.2]]) {
      const found = T.tunerPitch(tone(hz, shape), SR);
      assert.ok(found, `${hz} Hz was heard`);
      assert.ok(Math.abs(cents(found.hz, hz)) < 3, `${hz} Hz read as ${found.hz} (${cents(found.hz, hz).toFixed(1)} cents)`);
      assert.ok(found.clarity > 0.85 && found.clarity <= 1);
    }
  }
  // At another sample rate too
  assert.ok(Math.abs(cents(T.tunerPitch(tone(146.83, [1, 0.6, 0.3], 44100), 44100).hz, 146.83)) < 3);
});

test('an overtone louder than the note itself does not fool it, nor does an offset', () => {
  // A plucked string's 2nd harmonic is often the loudest; a mic can add a steady offset
  for (const hz of [82.41, 110, 196]) {
    const x = tone(hz, [0.4, 1, 0.5, 0.3]).map((v) => v + 0.1);
    const found = T.tunerPitch(x, SR);
    assert.ok(found && Math.abs(cents(found.hz, hz)) < 3, `${hz} Hz read as ${found?.hz}`);
  }
  // A few cents flat or sharp reads as that
  for (const off of [-20, -4, 7, 35]) {
    const hz = 440 * 2 ** (off / 1200);
    assert.ok(Math.abs(T.tunerNote(T.tunerPitch(tone(hz, [1, 0.4]), SR).hz).cents - off) < 2, `${off} cents`);
  }
});

test('silence, noise and too little sound give no note', () => {
  assert.equal(T.tunerPitch(new Float32Array(N), SR), null);
  assert.equal(T.tunerPitch(tone(220).map((v) => v * 0.005), SR), null);
  let seed = 7;
  const noise = Float32Array.from({ length: N }, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31 - 1) * 0.3);
  assert.equal(T.tunerPitch(noise, SR), null);
  assert.equal(T.tunerPitch(new Float32Array(8).fill(0.5), SR), null);
  assert.equal(T.tunerPitch(Float32Array.from({ length: N }, () => NaN), SR), null);
});

test('the note nearest a pitch, and how far off', () => {
  assert.deepEqual({ ...T.tunerNote(440), cents: 0 }, { name: 'A', octave: 4, midi: 69, cents: 0, hz: 440 });
  const c = T.tunerNote(261.63);
  assert.equal(`${c.name}${c.octave}`, 'C4');
  assert.ok(Math.abs(c.cents) < 0.1);
  const e = T.tunerNote(82.41);
  assert.equal(`${e.name}${e.octave}`, 'E2');
  const sharp = T.tunerNote(466.16);
  assert.equal(`${sharp.name}${sharp.octave}`, 'A♯4');
  // 30 cents sharp of A; halfway to the next note it turns to that note, flat
  assert.ok(Math.abs(T.tunerNote(440 * 2 ** (30 / 1200)).cents - 30) < 0.01);
  const over = T.tunerNote(440 * 2 ** (60 / 1200));
  assert.equal(over.name, 'A♯');
  assert.ok(Math.abs(over.cents + 40) < 0.01);
  // With A4 at 442 Hz, 442 is A and in tune
  assert.ok(Math.abs(T.tunerNote(442, 442).cents) < 1e-9);
  assert.ok(T.tunerNote(440, 442).cents < -7);
  assert.equal(T.tunerNote(16.35).octave, 0);
});

test('one wrong reading among a few does not show', () => {
  assert.equal(T.steadyHz([]), null);
  assert.equal(T.steadyHz([110]), 110);
  assert.equal(T.steadyHz([110, 110.2, 220, 109.9, 110.1]), 110.1);
});

test('the analyser\'s axis runs from 20 Hz to 20 kHz, each octave as wide as the next', () => {
  assert.ok(Math.abs(A.analyserX(20, 600)) < 1e-9 && Math.abs(A.analyserX(20000, 600) - 600) < 1e-9);
  assert.ok(Math.abs(A.analyserX(200, 600) - A.analyserX(100, 600) - (A.analyserX(8000, 600) - A.analyserX(4000, 600))) < 1e-9);
  for (const hz of [20, 55, 1000, 15000]) assert.ok(Math.abs(A.analyserHz(A.analyserX(hz, 600), 600) / hz - 1) < 1e-9);
  assert.equal(A.analyserY(0, 240), 0);
  assert.equal(A.analyserY(A.ANALYSER_FLOOR_DB, 240), 240);
  assert.equal(A.analyserY(-200, 240), 240);
  assert.equal(A.analyserY(12, 240), 0);
  assert.equal(A.hzText(440), '440 Hz');
  assert.equal(A.hzText(1250), '1.25 kHz');
  assert.equal(A.hzText(12500), '12.5 kHz');
});

test('a peak lands in the column of its frequency, however narrow it is', () => {
  const count = 2048;
  const perBin = SR / 2 / count;
  for (const hz of [60, 440, 3000, 15000]) {
    const bins = new Float32Array(count).fill(-90);
    const k = Math.round(hz / perBin);
    bins[k] = -10;
    const cols = new Float32Array(560);
    A.spectrumColumns(bins, count, SR, cols);
    const top = A.loudestColumn(cols);
    assert.ok(Math.abs(cols.reduce((m, v) => Math.max(m, v), -200) + 10) < 0.5, `${hz} Hz keeps its level`);
    // (Down low a bin is several columns wide: the peak is somewhere within it)
    assert.ok(Math.abs(cents(top.hz, k * perBin)) < (hz < 100 ? 200 : 40), `${hz} Hz drawn at ${top.hz}`);
  }
});

test('silence, a resting track and levels off the scale are the floor', () => {
  const cols = new Float32Array(100);
  A.spectrumColumns(new Float32Array(2048).fill(-Infinity), 2048, SR, cols);
  assert.ok(cols.every((v) => v === A.ANALYSER_FLOOR_DB));
  assert.equal(A.loudestColumn(cols), null);
  A.spectrumColumns(new Float32Array(2048).fill(NaN), 2048, SR, cols);
  assert.ok(cols.every((v) => v === A.ANALYSER_FLOOR_DB));
  A.spectrumColumns(new Float32Array(2048).fill(-300), 2048, SR, cols);
  assert.ok(cols.every((v) => v === A.ANALYSER_FLOOR_DB));
  // Between two bins down low, the level runs in a line from one to the other
  const ramp = Float32Array.from({ length: 2048 }, (_, k) => -80 + k);
  const wide = new Float32Array(2000);
  A.spectrumColumns(ramp, 2048, SR, wide);
  for (let x = 1; x < 200; x++) assert.ok(wide[x] >= wide[x - 1] - 1e-4);
});
