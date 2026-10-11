// Unit tests for the loudness meter maths (src/audio/loudness.ts): K-weighting, gating, true peak
// and the normalize gain, against the test signals of ITU-R BS.1770 / EBU Tech 3341. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createLoudnessAnalyser, normalizeGainDb, LOUDNESS_WORKLET_SOURCE, formatLufs, formatDbtp } = await import('../src/audio/loudness.ts');

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

/** A stereo sine (the same in both channels) of `seconds` at `dbfs` peak. */
function sine(sampleRate, hz, dbfs, seconds, phase = 0) {
  const n = Math.round(seconds * sampleRate);
  const a = Math.pow(10, dbfs / 20);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a * Math.sin((2 * Math.PI * hz * i) / sampleRate + phase);
  return out;
}

const measure = (sampleRate, left, right = left) => {
  const analyser = createLoudnessAnalyser(sampleRate);
  analyser.feed(left, right, left.length);
  return analyser.read();
};

test('a 1 kHz stereo sine at -23 dBFS reads -23 LUFS (EBU Tech 3341 case 1), at 44.1 and 48 kHz', () => {
  for (const sr of [44100, 48000]) {
    const r = measure(sr, sine(sr, 1000, -23, 20));
    near(r.integrated, -23, 0.1, `integrated at ${sr}`);
    near(r.momentary, -23, 0.1, `momentary at ${sr}`);
    near(r.shortTerm, -23, 0.1, `short-term at ${sr}`);
    near(r.truePeakMax, -23, 0.15, `true peak at ${sr}`);
    near(r.seconds, 20, 1e-9);
  }
});

test('K-weighting: lows count for less and highs for more, as the standard intends', () => {
  const sr = 48000;
  const low = measure(sr, sine(sr, 60, -23, 10)).integrated;
  const mid = measure(sr, sine(sr, 1000, -23, 10)).integrated;
  const high = measure(sr, sine(sr, 8000, -23, 10)).integrated;
  assert.ok(low < mid - 2, `60 Hz (${low}) should read well under 1 kHz (${mid})`);
  // The shelf gives +4 dB at the top but is already up 0.7 dB at 1 kHz
  near(high, mid + 3.3, 0.3, '8 kHz sits on the +4 dB shelf');
});

test('silence reads -inf everywhere; a mono signal in one channel is 3 dB quieter than in both', () => {
  const sr = 48000;
  const quiet = measure(sr, new Float32Array(sr * 2));
  assert.equal(quiet.integrated, -Infinity);
  assert.equal(quiet.momentary, -Infinity);
  assert.equal(quiet.truePeakMax, -Infinity);
  const one = measure(sr, sine(sr, 1000, -23, 10), new Float32Array(sr * 10));
  near(one.integrated, -26, 0.1, 'one channel');
});

test('gating: a quiet stretch 17 dB under the loud one is left out of the integrated loudness', () => {
  const sr = 48000;
  const loud = sine(sr, 1000, -23, 20);
  const quiet = sine(sr, 1000, -40, 20);
  const both = new Float32Array(loud.length + quiet.length);
  both.set(loud);
  both.set(quiet, loud.length);
  const r = measure(sr, both);
  // Without the relative gate the mix would read about -26; with it only the loud part counts
  near(r.integrated, -23, 0.1, 'gated');
  // Short-term is over the last 3 s only, so it reads the quiet part
  near(r.shortTerm, -40, 0.1, 'short-term');
  // ...and anything under -70 LUFS is gated absolutely
  const floor = sine(sr, 1000, -80, 20);
  const withFloor = new Float32Array(loud.length + floor.length);
  withFloor.set(loud);
  withFloor.set(floor, loud.length);
  near(measure(sr, withFloor).integrated, -23, 0.1, 'absolute gate');
});

test('true peak finds peaks between samples: a sine at a quarter of the sample rate, 45 degrees off', () => {
  const sr = 48000;
  // Every sample sits at +-0.707 of the amplitude; the wave itself reaches the full amplitude
  const signal = sine(sr, sr / 4, -6, 2, Math.PI / 4);
  let samplePeak = 0;
  for (const v of signal) samplePeak = Math.max(samplePeak, Math.abs(v));
  near(20 * Math.log10(samplePeak), -9, 0.05, 'sample peak');
  const r = measure(sr, signal);
  near(r.truePeakMax, -6, 0.3, 'true peak');
  near(r.truePeak, -6, 0.3, 'recent true peak');
});

test('reset forgets everything, and readings before the first full block are partial, not wrong', () => {
  const sr = 48000;
  const analyser = createLoudnessAnalyser(sr);
  analyser.feed(sine(sr, 1000, -23, 5), sine(sr, 1000, -23, 5), sr * 5);
  near(analyser.read().integrated, -23, 0.1);
  analyser.reset();
  const empty = analyser.read();
  assert.equal(empty.integrated, -Infinity);
  assert.equal(empty.seconds, 0);
  // 50 ms in: no block banked yet
  analyser.feed(sine(sr, 1000, -23, 0.05), sine(sr, 1000, -23, 0.05), Math.round(sr * 0.05));
  assert.equal(analyser.read().momentary, -Infinity);
  // Half a second in: momentary reads, integrated too (one gating block)
  analyser.feed(sine(sr, 1000, -23, 0.45), sine(sr, 1000, -23, 0.45), Math.round(sr * 0.45));
  near(analyser.read().momentary, -23, 0.2);
  assert.ok(Number.isFinite(analyser.read().integrated));
});

test('feeding in blocks of 128 gives the same reading as all at once', () => {
  const sr = 44100;
  const left = sine(sr, 440, -12, 3);
  const right = sine(sr, 660, -18, 3, 1);
  const whole = measure(sr, left, right);
  const analyser = createLoudnessAnalyser(sr);
  for (let at = 0; at < left.length; at += 128) {
    const n = Math.min(128, left.length - at);
    analyser.feed(left.subarray(at, at + n), right.subarray(at, at + n), n);
  }
  const blocks = analyser.read();
  near(blocks.integrated, whole.integrated, 1e-9);
  near(blocks.truePeakMax, whole.truePeakMax, 1e-9);
  near(blocks.shortTerm, whole.shortTerm, 1e-9);
});

test('the normalize gain reaches -14 LUFS unless the -1 dBTP ceiling holds it back', () => {
  assert.deepEqual(normalizeGainDb({ integrated: -18, truePeakMax: -6 }), { gainDb: 4, limited: false });
  assert.deepEqual(normalizeGainDb({ integrated: -18, truePeakMax: -3 }), { gainDb: 2, limited: true });
  assert.deepEqual(normalizeGainDb({ integrated: -8, truePeakMax: -0.5 }), { gainDb: -6, limited: false });
  assert.deepEqual(normalizeGainDb({ integrated: -Infinity, truePeakMax: -Infinity }), { gainDb: 0, limited: false });
  assert.deepEqual(normalizeGainDb({ integrated: -20, truePeakMax: -10 }, -16, -2), { gainDb: 4, limited: false });
  assert.equal(formatLufs(-14.04), '-14.0 LUFS');
  assert.equal(formatLufs(-Infinity), '-inf LUFS');
  assert.equal(formatDbtp(-0.96), '-1.0 dBTP');
});

test('the worklet source is self-contained: it runs with only the worklet globals', () => {
  const registered = {};
  const globals = {
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = { postMessage: (m) => this.port.posted.push(m), posted: [] };
      }
    },
    registerProcessor: (name, cls) => (registered[name] = cls),
  };
  new Function(...Object.keys(globals), LOUDNESS_WORKLET_SOURCE)(...Object.values(globals));
  const Processor = registered['bbx-loudness'];
  assert.ok(Processor, 'registered');
  const p = new Processor();
  const left = sine(48000, 1000, -23, 1);
  for (let at = 0; at < left.length; at += 128) assert.equal(p.process([[left.subarray(at, at + 128), left.subarray(at, at + 128)]]), true);
  // About ten readings a second
  assert.ok(p.port.posted.length >= 9 && p.port.posted.length <= 11, `posted ${p.port.posted.length}`);
  near(p.port.posted.at(-1).momentary, -23, 0.1);
  p.port.onmessage({ data: 'reset' });
  assert.equal(p.process([[]]), true);
  p.port.onmessage({ data: 'dispose' });
  assert.equal(p.process([[]]), false);
});
