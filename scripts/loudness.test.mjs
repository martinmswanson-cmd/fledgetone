// Unit tests for the loudness meter maths (src/audio/loudness.ts): K-weighting, gating, true peak
// and the normalize gain, against the test signals of ITU-R BS.1770 / EBU Tech 3341. Run with `npm test`.
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

const { createLoudnessAnalyser, normalizeGainDb, truePeakOf, LOUDNESS_WORKLET_SOURCE, LOUDNESS_WORKER_SOURCE, formatLufs, formatDbtp } = await import('../src/audio/loudness.ts');

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
  // (Faded in and out over 50 ms: a sine that starts at once rings over its amplitude there)
  const fade = 2400;
  const signal = sine(sr, sr / 4, -6, 2, Math.PI / 4).map((v, i, all) => v * Math.min(1, Math.min(i, all.length - i) / fade));
  let samplePeak = 0;
  for (const v of signal) samplePeak = Math.max(samplePeak, Math.abs(v));
  near(20 * Math.log10(samplePeak), -9, 0.05, 'sample peak');
  const r = measure(sr, signal);
  // +3.01 dB over the samples (BS.1770's own 4x example filter read 0.22 dB over the wave)
  near(r.truePeakMax - 20 * Math.log10(samplePeak), 3.01, 0.03, 'true peak over the sample peak');
  near(r.truePeakMax, -6, 0.03, 'true peak');
  near(r.truePeak, -6, 0.03, 'recent true peak');
  near(20 * Math.log10(truePeakOf([signal])), -6, 0.03, 'truePeakOf');
});

test('true peak of sines up to 20 kHz: within 0.08 dB of the wave, never over (at 44.1 and 48 kHz)', () => {
  for (const sr of [44100, 48000]) {
    for (let hz = 500; hz <= 20000; hz += 500) {
      for (const phase of [0, 0.4, Math.PI / 4, 1.2]) {
        // Faded in and out, so the start and end don't ring
        const n = 2400;
        const edge = (i) => Math.min(i, n - i);
        const x = sine(sr, hz, -6, n / sr, phase).map((v, i) => (edge(i) < 800 ? v * Math.sin((Math.PI * edge(i)) / 1600) ** 2 : v));
        const tp = 20 * Math.log10(truePeakOf([x]));
        assert.ok(tp <= -6 + 0.01 && tp >= -6 - 0.08, `${hz} Hz at ${sr}, phase ${phase}: ${tp.toFixed(3)} dBTP`);
        near(measure(sr, x).truePeakMax, tp, 1e-6, `the analyser agrees at ${hz} Hz`);
      }
    }
  }
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

test('the meter worklet and the export Worker run their own copy of the analyser', () => {
  // Their source is the analyser's text plus the constants it's given (in a minified build, its
  // module's own names don't exist there, so nothing may be left for it to find outside)
  const sr = 48000;
  const x = new Float32Array(sr * 3);
  for (let i = 0; i < x.length; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / sr);
  const direct = createLoudnessAnalyser(sr);
  direct.feed(x, x, x.length);
  const want = direct.read().integrated;

  let workerReading;
  const self = { postMessage: (m) => (workerReading = m) };
  new Function('self', LOUDNESS_WORKER_SOURCE)(self);
  self.onmessage({ data: { channels: [x, x], sampleRate: sr } });
  assert.ok(Math.abs(workerReading.integrated - want) < 1e-6);

  let Proc;
  let posted;
  const AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => (posted = m) }; } };
  new Function('sampleRate', 'AudioWorkletProcessor', 'registerProcessor', LOUDNESS_WORKLET_SOURCE)(sr, AudioWorkletProcessor, (_, c) => (Proc = c));
  const p = new Proc();
  for (let at = 0; at < x.length; at += 128) p.process([[x.subarray(at, at + 128), x.subarray(at, at + 128)]]);
  assert.ok(Math.abs(posted.integrated - want) < 0.01);
});

test('the peak finder skips work only where no point could pass: the same peaks as running the whole filter, on random and adversarial signals', async () => {
  const { TRUE_PEAK_PHASES, TRUE_PEAK_PLAN, createPeakFinder } = await import('../src/audio/truePeakFilter.ts');
  const taps = TRUE_PEAK_PHASES[0].length;
  const half = taps / 2;
  // Every point between the samples half - 1 and half back, worked out in full
  const exactAt = (x, i) => {
    let m = Math.max(Math.abs(x[i - half + 1] ?? 0), Math.abs(x[i - half] ?? 0));
    for (const h of TRUE_PEAK_PHASES) {
      let acc = 0;
      for (let k = 0; k < taps; k++) acc += h[k] * (x[i - k] ?? 0);
      m = Math.max(m, Math.abs(acc));
    }
    return m;
  };
  let s = 99;
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const kinds = [
    (n) => Float32Array.from({ length: n }, () => rnd() * 2 - 1),
    (n) => Float32Array.from({ length: n }, () => (rnd() < 0.5 ? -1 : 1)),
    // Alternating full-scale samples (the most a point can pass the samples by), with holes
    (n) => Float32Array.from({ length: n }, (_, i) => (i % 2 ? 1 : -1) * (rnd() < 0.9 ? 1 : 0)),
    (n) => {
      const f = rnd() * 0.5;
      const ph = rnd() * 6.3;
      return Float32Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * i + ph));
    },
    (n) => Float32Array.from({ length: n }, () => (rnd() < 0.05 ? (rnd() < 0.5 ? -1 : 1) : 0)),
    (n) => {
      let y = 0;
      return Float32Array.from({ length: n }, () => (y = Math.max(-1, Math.min(1, y + (rnd() - 0.5) * 0.3))));
    },
    // Square-ish near Nyquist, the levels jumping about
    (n) => {
      const f = 0.45 + rnd() * 0.05;
      return Float32Array.from({ length: n }, (_, i) => Math.sign(Math.sin(2 * Math.PI * f * i)) * (0.5 + 0.5 * rnd()));
    },
  ];
  let checks = 0;
  for (let trial = 0; trial < 700; trial++) {
    const x = kinds[trial % kinds.length](160);
    const finder = createPeakFinder(TRUE_PEAK_PLAN);
    for (let i = 0; i < x.length; i++) {
      finder.push(x[i]);
      const exact = exactAt(x, i);
      // Thresholds just under, at and over the true answer, and anywhere
      for (const over of [exact * 0.9, exact * 0.9999, exact * (1 - 1e-9), exact, exact * 1.001, rnd() * 1.5]) {
        const got = finder.peak(over);
        checks++;
        if (exact > over) assert.ok(Math.abs(got - exact) <= 1e-12 * Math.max(1, exact), `trial ${trial} sample ${i}: ${got} for ${exact} over ${over}`);
        else assert.ok(got <= over * (1 + 1e-12) && got >= Math.max(Math.abs(x[i - half + 1] ?? 0), Math.abs(x[i - half] ?? 0)) - 1e-12, `trial ${trial} sample ${i}: ${got} for ${exact} under ${over}`);
      }
    }
  }
  assert.ok(checks > 600000);
  // And the meter reads what the whole filter reads, on a bright, loud signal near its peak all the time
  const sr = 44100;
  const x = Float32Array.from({ length: sr }, (_, i) => 0.9 * Math.sin(i * 1.9) * (0.7 + 0.3 * rnd()));
  let want = 0;
  for (let i = 0; i < x.length; i++) want = Math.max(want, Math.abs(x[i]), exactAt(x, i));
  near(20 * Math.log10(truePeakOf([x])), 20 * Math.log10(want), 1e-9, 'truePeakOf');
  near(measure(sr, x).truePeakMax, 20 * Math.log10(want), 1e-9, 'the analyser');
});

test('a seamless loop is limited round its seam: its end leads into its start without a jump in gain', async () => {
  const { reachTarget, targetById } = await import('../src/audio/loudnessTarget.ts');
  const { measureLoudness } = await import('../src/audio/loudness.ts');
  // 2 s loop: a kick every half second over a quiet pad, far under the Loud target (so the limiter works)
  const sr = 44100;
  const n = 2 * sr;
  const make = () => Float32Array.from({ length: n }, (_, i) => {
    const t = (i % (sr / 2)) / sr;
    return 0.6 * Math.exp(-t * 8) * Math.sin(2 * Math.PI * 60 * t) + 0.05 * Math.sin((2 * Math.PI * 220 * i) / sr);
  });
  const orig = make();
  // The gain (dB) over the 200 samples before `end`: the pad just before a kick
  const gainBefore = (ch, end) => {
    let num = 0;
    let den = 0;
    for (let i = end - 200; i < end; i++) {
      num += ch[i] * orig[i];
      den += orig[i] * orig[i];
    }
    return 20 * Math.log10(num / den);
  };
  for (const loop of [false, true]) {
    const ch = [make(), make()];
    const reading = await measureLoudness(ch, sr);
    await reachTarget(ch, sr, reading, targetById('loud'), undefined, undefined, loop);
    // Before the kick that comes round at the seam, as before any other kick
    const step = Math.abs(gainBefore(ch[0], n) - gainBefore(ch[0], sr / 2));
    if (loop) assert.ok(step < 0.1, `the gain steps ${step.toFixed(2)} dB at the seam`);
    else assert.ok(step > 1, 'limited from silence to silence, the end runs hotter (the case this guards against)');
  }
});
