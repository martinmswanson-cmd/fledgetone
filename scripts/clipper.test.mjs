// Unit tests for the master clipper (src/audio/effects/clipper.ts) and its place in the export's
// master section (masterAfter.ts). Run with `npm test`.
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

const { createClipperKernel, clipChannels, clipperParams, normalizeClipper, defaultClipper, CLIPPER_WORKLET_SOURCE } = await import('../src/audio/effects/clipper.ts');
const { masterAfter } = await import('../src/audio/effects/masterAfter.ts');
const { defaultMasterSettings, normalizeMasterSettings, sameMasterSettings } = await import('../src/store/timelineTypes.ts');

const SR = 44100;
const sine = (f, amp, n = SR) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
const peak = (x) => x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);

function dft(x, f) {
  let re = 0;
  let im = 0;
  for (let i = 0; i < x.length; i++) {
    const a = (2 * Math.PI * f * i) / SR;
    re += x[i] * Math.cos(a);
    im -= x[i] * Math.sin(a);
  }
  return (Math.hypot(re, im) / x.length) * 2;
}

test('sound under the knee passes through untouched, lined up with the input', () => {
  const x = sine(220, 0.3);
  const l = x.slice();
  const r = x.slice();
  const reading = clipChannels(l, r, SR, { on: true, drive: 0, softness: 0.5, ceiling: -1 });
  assert.deepEqual(Array.from(l), Array.from(x));
  assert.equal(reading.peakDb, 0);
  assert.equal(reading.share, 0);
});

test('drive turns the sound up by its dB where nothing clips', () => {
  const x = sine(220, 0.1);
  const l = x.slice();
  clipChannels(l, l, SR, { on: true, drive: 6, softness: 0, ceiling: 0 });
  const g = clipperParams({ on: true, drive: 6, softness: 0, ceiling: 0 }).drive;
  for (let i = 0; i < x.length; i += 97) assert.ok(Math.abs(l[i] - x[i] * g) < 1e-6);
});

test('a hard clip holds a loud sine near the ceiling, and reports what it took off', () => {
  const x = sine(110, 0.9);
  const l = x.slice();
  const r = x.slice();
  const reading = clipChannels(l, r, SR, { on: true, drive: 12, softness: 0, ceiling: -3 });
  const ceiling = 10 ** (-3 / 20);
  // The oversampled clip rings a little over the ceiling (the filter), never far
  assert.ok(peak(l) < ceiling * 1.12, `peak ${peak(l)}`);
  assert.ok(peak(l) > ceiling * 0.95);
  assert.ok(reading.peakDb > 13 && reading.peakDb < 15, `took off ${reading.peakDb} dB`);
  assert.ok(reading.share > 0.5);
});

test('a loud high sine is held near the ceiling too: the residual lines up with the sound at every frequency', () => {
  // (It once read three quarters of a sample early: a clipped 5 kHz came out 13 dB over the ceiling)
  for (const [hz, most] of [[200, 0.05], [1000, 0.5], [5000, 1.6]]) {
    const x = sine(hz, 0.9);
    const l = x.slice();
    clipChannels(l, l, SR, { on: true, drive: 18, softness: 0.5, ceiling: -0.5 });
    const over = 20 * Math.log10(peak(l.subarray(2000, l.length - 2000))) + 0.5;
    assert.ok(over < most, `${hz} Hz: ${over.toFixed(2)} dB over the ceiling`);
  }
});

test('soft clipping bends earlier than hard', () => {
  const x = sine(110, 0.6);
  const hard = x.slice();
  const soft = x.slice();
  const h = clipChannels(hard, hard, SR, { on: true, drive: 0, softness: 0, ceiling: -3 });
  const s = clipChannels(soft, soft, SR, { on: true, drive: 0, softness: 1, ceiling: -3 });
  assert.equal(h.share, 0);
  assert.ok(s.share > 0.1);
});

test('oversampling keeps aliasing far under a naive clip', () => {
  const f0 = 7001;
  const x = sine(f0, 0.9);
  const over = x.slice();
  clipChannels(over, over, SR, { on: true, drive: 12, softness: 0, ceiling: -1 });
  const naive = x.map((v) => Math.max(-0.891, Math.min(0.891, v * 3.98)));
  const alias = (a) => {
    const w = a.subarray(4410, 4410 + 17640).map((v, i, arr) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / arr.length)));
    const fund = dft(w, f0);
    let sum = 0;
    for (let k = 5; k < 40; k += 2) {
      let fa = (k * f0) % SR;
      if (fa > SR / 2) fa = SR - fa;
      if (fa > 20 && fa < 20000) sum += dft(w, fa) ** 2;
    }
    return 10 * Math.log10(sum / fund ** 2);
  };
  const o = alias(over);
  const q = alias(naive);
  assert.ok(o < -45, `oversampled aliases ${o.toFixed(1)} dB`);
  assert.ok(o < q - 30, `oversampled ${o.toFixed(1)} dB vs naive ${q.toFixed(1)} dB`);
});

test('the kernel in blocks of 128 (the worklet) gives what the export gives, delayed by its latency', () => {
  const x = Float32Array.from({ length: 20000 }, (_, i) => 0.8 * Math.sin(i * 0.05) + 0.4 * Math.sin(i * 0.9));
  const settings = { on: true, drive: 6, softness: 0.4, ceiling: -2 };
  const whole = x.slice();
  clipChannels(whole, whole, SR, settings);
  const k = createClipperKernel(SR);
  const p = clipperParams(settings);
  const live = new Float32Array(x.length + k.latency);
  const padded = new Float32Array(x.length + k.latency);
  padded.set(x);
  for (let at = 0; at < padded.length; at += 128) {
    const end = Math.min(padded.length, at + 128);
    const inp = padded.slice(at, end);
    const out = new Float32Array(end - at);
    k.process(inp, inp, out, out.slice(), end - at, p.drive, p.ceiling, p.softness);
    live.set(out, at);
  }
  for (let i = 0; i < x.length; i++) assert.equal(live[i + k.latency], whole[i]);
});

test('the worklet runs: registers, clips a block, and posts readings', () => {
  let Processor = null;
  const posted = [];
  const run = new Function('sampleRate', 'registerProcessor', 'class AudioWorkletProcessor { constructor() { this.port = { postMessage: (m) => posted.push(m) }; } }\n' + CLIPPER_WORKLET_SOURCE.replace('registerProcessor(', 'return registerProcessor('));
  run(SR, (name, cls) => (Processor = cls));
  assert.ok(Processor);
  const proc = new Processor();
  proc.port.postMessage = (m) => posted.push(m);
  const p = clipperParams({ on: true, drive: 12, softness: 0, ceiling: -1 });
  const params = { drive: [p.drive], ceiling: [p.ceiling], softness: [p.softness] };
  let out = 0;
  for (let b = 0; b < 40; b++) {
    const inp = Float32Array.from({ length: 128 }, (_, i) => 0.9 * Math.sin(((b * 128 + i) * 2 * Math.PI * 100) / SR));
    const o = [new Float32Array(128), new Float32Array(128)];
    assert.equal(proc.process([[inp, inp]], [o], params), true);
    out = Math.max(out, peak(o[0]));
  }
  assert.ok(out < 1 && out > 0.85, `peak ${out}`);
  assert.ok(posted.length >= 1 && posted[0].peakDb > 6);
});

test('the band kind (Crunch) passes sound under the knee flat to 18 kHz, lined up with the input', () => {
  const settings = { on: true, drive: 0, softness: 0.5, ceiling: -1, band: true };
  for (const hz of [40, 1000, 8000, 16000, 18000]) {
    const x = sine(hz, 0.3);
    const l = x.slice();
    const reading = clipChannels(l, l.slice(), SR, settings);
    assert.equal(reading.share, 0);
    const mid = (a) => a.subarray(4000, SR - 4000);
    const gain = 20 * Math.log10(peak(mid(l)) / peak(mid(x)));
    assert.ok(Math.abs(gain) < (hz > 16000 ? 0.1 : 0.01), `${hz} Hz: ${gain.toFixed(3)} dB`);
    if (hz === 1000) for (let i = 4000; i < SR - 4000; i++) assert.ok(Math.abs(l[i] - x[i]) < 1e-4, `sample ${i}`);
  }
});

test('the band kind holds a hard-driven bright sound near the ceiling between samples, where the plain one overshoots', async () => {
  const { truePeakOf } = await import('../src/audio/loudness.ts');
  let seed = 5;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  // A crunchy drop's top: a saw, hats (noise bursts) and a high whine, driven 12 dB into a hard knee
  const x = Float32Array.from({ length: SR }, (_, i) => {
    const t = i / SR;
    return 0.4 * (((t * 98) % 1) * 2 - 1) + 0.3 * rnd() * Math.exp(-(t % 0.15) * 40) + 0.2 * Math.sin(2 * Math.PI * 9000 * t);
  });
  const over = (band) => {
    const l = x.slice();
    const r = x.slice();
    clipChannels(l, r, SR, { on: true, drive: 12, softness: 0, ceiling: -3, band });
    return 20 * Math.log10(truePeakOf([l.subarray(2000, SR - 2000)])) + 3;
  };
  const plain = over(false);
  const band = over(true);
  assert.ok(band < 1.5, `band: ${band.toFixed(2)} dB over the ceiling`);
  assert.ok(band < plain - 1.5, `band ${band.toFixed(2)} vs plain ${plain.toFixed(2)} dB over the ceiling`);
});

test('the band kind in blocks of 128 (the worklet, asked for with processorOptions) gives what the export gives', () => {
  const x = Float32Array.from({ length: 12000 }, (_, i) => 1.2 * Math.sin(i * 0.05) + 0.5 * Math.sin(i * 1.3));
  const settings = { on: true, drive: 3, softness: 0.2, ceiling: -2, band: true };
  const whole = x.slice();
  clipChannels(whole, whole.slice(), SR, settings);
  let Processor = null;
  const run = new Function('sampleRate', 'registerProcessor', 'class AudioWorkletProcessor { constructor() { this.port = {}; } }\n' + CLIPPER_WORKLET_SOURCE.replace('registerProcessor(', 'return registerProcessor('));
  run(SR, (name, cls) => (Processor = cls));
  const proc = new Processor({ processorOptions: { band: true } });
  proc.port.postMessage = () => {};
  const lat = createClipperKernel(SR, true).latency;
  assert.ok(lat > createClipperKernel(SR).latency);
  const p = clipperParams(settings);
  const params = { drive: [p.drive], ceiling: [p.ceiling], softness: [p.softness] };
  const padded = new Float32Array(x.length + lat + 128);
  padded.set(x);
  const live = new Float32Array(padded.length);
  for (let at = 0; at + 128 <= padded.length; at += 128) {
    const inp = padded.slice(at, at + 128);
    const o = [new Float32Array(128), new Float32Array(128)];
    proc.process([[inp, inp]], [o], params);
    live.set(o[0], at);
  }
  for (let i = 0; i < x.length; i++) assert.equal(live[i + lat], whole[i]);
});

test('settings are repaired, and an absent clipper means off', () => {
  assert.deepEqual(normalizeClipper({ on: true, drive: 99, softness: -1, ceiling: 5 }), { on: true, drive: 18, softness: 0, ceiling: 0 });
  assert.deepEqual(normalizeClipper(null), defaultClipper());
  const m = normalizeMasterSettings({});
  assert.equal(m.clipper, undefined);
  const withClip = normalizeMasterSettings({ clipper: { on: true } });
  assert.equal(withClip.clipper.on, true);
  assert.equal(sameMasterSettings(m, withClip), false);
  assert.equal(sameMasterSettings(withClip, normalizeMasterSettings(withClip)), true);
});

test('the export master section clips before the limiter and says how hard each worked', () => {
  const l = sine(80, 0.95, SR * 2);
  const r = l.slice();
  const master = { ...defaultMasterSettings(), level: 6, clipper: { on: true, drive: 3, softness: 0.2, ceiling: -1 } };
  const stats = masterAfter(l, r, SR, master);
  assert.ok(stats.clipper && stats.clipper.peakDb > 6);
  // The clipper took the peaks down to about its ceiling, so the limiter had little left to do
  assert.ok(stats.limiterInPeakDb < 0, `into the limiter at ${stats.limiterInPeakDb}`);
  const off = masterAfter(sine(80, 0.95, SR * 2), sine(80, 0.95, SR * 2), SR, { ...master, clipper: { ...master.clipper, on: false } });
  assert.equal(off.clipper, undefined);
  assert.ok(off.limiterPeakDb > 6);
});

// The clipper as it was first written: every oversampled point and every tap worked out, every
// sample. The kernel skips what can't matter (points a bound keeps under the knee, the zeros of
// the residual) and must come out the same, sample for sample.
function referenceKernel(_sampleRate        )                {
    const FACTOR = 4;
    const LENGTH = 97;
    // The low-pass at the oversampled rate: a Kaiser-windowed sinc (beta 8, about 80 dB down),
    // centred a little under the original Nyquist, so what clipping makes above it is gone before
    // the sound is taken back down (and folds, if at all, above about 19 kHz)
    const cutoff = 0.46 / FACTOR;
    const bessel0 = (x        ) => {
      let sum = 1;
      let term = 1;
      for (let k = 1; k < 40; k++) {
        term *= (x / (2 * k)) * (x / (2 * k));
        sum += term;
      }
      return sum;
    };
    const beta = 8;
    const h = new Float64Array(LENGTH);
    const mid = (LENGTH - 1) / 2;
    let dc = 0;
    for (let j = 0; j < LENGTH; j++) {
      const t = j - mid;
      const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
      const w = bessel0(beta * Math.sqrt(1 - (t / mid) * (t / mid))) / bessel0(beta);
      h[j] = sinc * w;
      dc += h[j];
    }
    for (let j = 0; j < LENGTH; j++) h[j] /= dc;
    // Upsampling by zero-stuffing then filtering is four filters (phases) over the input: phase p
    // takes taps p, p + 4, p + 8... times 4 (the zeros' lost energy)
    const phaseTaps = Math.ceil(LENGTH / FACTOR);
    const phases = new Float64Array(FACTOR * phaseTaps);
    let reach = 0;
    for (let p = 0; p < FACTOR; p++) {
      let sum = 0;
      for (let k = 0; k < phaseTaps; k++) {
        const j = p + FACTOR * k;
        const v = j < LENGTH ? FACTOR * h[j] : 0;
        phases[p * phaseTaps + k] = v;
        sum += Math.abs(v);
      }
      if (sum > reach) reach = sum;
    }
    // Through both filters the sound is (LENGTH - 1) oversampled points late: a whole number of samples
    const latency = (LENGTH - 1) / FACTOR;
    // Each sample's four oversampled points are worked out before it's taken back down, so the
    // newest is the last phase's, (FACTOR - 1) points after the first; the residual is read that
    // much further back, so it lines up with the driven sound exactly (read at the newest point, it
    // was three quarters of a sample early: at 5 kHz it no longer cancelled the peaks it clipped,
    // which came out far over the ceiling)
    const ALIGN = FACTOR - 1;
    const RES = LENGTH + ALIGN;
  
    // Per channel: the last phaseTaps driven input samples (a ring written twice over, so the
    // newest always lie in one run), the residual at the oversampled rate (likewise), and the
    // driven input delayed by `latency`
    const makeChannel = () => ({
      hist: new Float64Array(2 * phaseTaps),
      res: new Float64Array(2 * RES),
      delay: new Float64Array(latency + 1),
    });
    const chans = [makeChannel(), makeChannel()];
    let histAt = 0;
    let resAt = 0;
    let delayAt = 0;
    let n = 0;
    // When a sample last came near the knee, and when the residual was last non-zero (os points)
    let lastLoud = -1e9;
    let lastResidual = -1e9;
    let osIndex = 0;
    let peakReduction = 1;
    let touched = 0;
    let counted = 0;
  
    /** The clip curve at |v| (v >= 0): straight to the knee, then a tanh bend that never passes the ceiling. */
    const bend = (v        , knee        , ceiling        ) => {
      if (v <= knee) return v;
      const room = ceiling - knee;
      if (room <= 0) return ceiling;
      return knee + room * Math.tanh((v - knee) / room);
    };
  
    const process = (inL              , inR              , outL              , outR              , frames        , drive        , ceiling        , softness        ) => {
      const knee = ceiling * Math.pow(10, (-6 * Math.max(0, Math.min(1, softness))) / 20);
      // Below this, no oversampled point can reach the knee
      const quiet = knee / reach;
      const L = chans[0];
      const R = chans[1];
      for (let i = 0; i < frames; i++) {
        // (NaN or infinity counts as silence)
        const l = inL[i] - inL[i] === 0 ? inL[i] * drive : 0;
        const r = inR[i] - inR[i] === 0 ? inR[i] * drive : 0;
        histAt = histAt + 1 === phaseTaps ? 0 : histAt + 1;
        L.hist[histAt] = L.hist[histAt + phaseTaps] = l;
        R.hist[histAt] = R.hist[histAt + phaseTaps] = r;
        if (l > quiet || l < -quiet || r > quiet || r < -quiet) lastLoud = n;
        let clippedHere = false;
        // Four oversampled points per sample, each through the curve: the residual is what it took off
        for (let p = 0; p < FACTOR; p++) {
          resAt = resAt + 1 === RES ? 0 : resAt + 1;
          let rl = 0;
          let rr = 0;
          if (n - lastLoud < phaseTaps) {
            const newest = histAt + phaseTaps;
            const base = p * phaseTaps;
            let ul = 0;
            let ur = 0;
            for (let k = 0; k < phaseTaps; k++) {
              const c = phases[base + k];
              ul += c * L.hist[newest - k];
              ur += c * R.hist[newest - k];
            }
            const al = ul < 0 ? -ul : ul;
            const ar = ur < 0 ? -ur : ur;
            if (al > knee) {
              const b = bend(al, knee, ceiling);
              rl = (ul < 0 ? -b : b) - ul;
              if (b / al < peakReduction) peakReduction = b / al;
              clippedHere = true;
            }
            if (ar > knee) {
              const b = bend(ar, knee, ceiling);
              rr = (ur < 0 ? -b : b) - ur;
              if (b / ar < peakReduction) peakReduction = b / ar;
              clippedHere = true;
            }
          }
          L.res[resAt] = L.res[resAt + RES] = rl;
          R.res[resAt] = R.res[resAt + RES] = rr;
          if (rl !== 0 || rr !== 0) lastResidual = osIndex;
          osIndex++;
        }
        if (clippedHere) touched++;
        counted++;
        // The residual filtered back down (only near where there is one), at this sample's phase
        let dl = 0;
        let dr = 0;
        if (osIndex - 1 - lastResidual < RES) {
          const newest = resAt + RES - ALIGN;
          for (let j = 0; j < LENGTH; j++) {
            const c = h[j];
            dl += c * L.res[newest - j];
            dr += c * R.res[newest - j];
          }
        }
        // The driven sound from `latency` samples ago, plus what the curve did to it
        const read = delayAt + 1 === latency + 1 ? 0 : delayAt + 1;
        outL[i] = L.delay[read] + dl;
        outR[i] = R.delay[read] + dr;
        L.delay[delayAt] = l;
        R.delay[delayAt] = r;
        delayAt = read;
        n++;
      }
    };
  
    const read = ()                 => {
      const reading = { peakDb: peakReduction < 1 ? -20 * Math.log10(peakReduction) : 0, share: counted ? touched / counted : 0 };
      peakReduction = 1;
      touched = 0;
      counted = 0;
      return reading;
    };
  
    return { process, latency, read };
}
test('the kernel comes out exactly as working out every point and every tap does, in any block size', () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const n = SR * 2;
  const signals = [];
  // A drop-like mix (a sub, a kick, a bright saw, hats) at three levels into the knee
  for (const g of [0.5, 1.6, 4]) {
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const kick = (t % 0.4) < 0.1 ? Math.sin(2 * Math.PI * 55 * t) * (1 - (t % 0.4) / 0.1) : 0;
      const saw = ((t * 220) % 1) * 2 - 1;
      l[i] = g * (0.4 * Math.sin(2 * Math.PI * 45 * t) + 0.5 * kick + 0.2 * saw + 0.05 * rnd());
      r[i] = g * (0.4 * Math.sin(2 * Math.PI * 45 * t) + 0.5 * kick - 0.2 * saw + (i % 900 === 0 ? 0.8 : 0.05 * rnd()));
    }
    signals.push([l, r]);
  }
  // Noise far over the ceiling, and silence with a lone click, a NaN and an infinity
  signals.push([Float32Array.from({ length: n }, () => 3 * rnd()), Float32Array.from({ length: n }, () => rnd())]);
  const quiet = new Float32Array(n);
  const click = new Float32Array(n);
  click[5000] = 2;
  click[7000] = NaN;
  quiet[9000] = Infinity;
  signals.push([quiet, click]);
  const settings = [{ on: true, drive: 0, softness: 0.5, ceiling: -0.5 }, { on: true, drive: 6, softness: 0, ceiling: -3 }, { on: true, drive: 12, softness: 1, ceiling: -12 }];
  for (const [si, [l, r]] of signals.entries()) {
    for (const s of settings) {
      const p = clipperParams(s);
      for (const block of [128, 4096, 1000]) {
        const a = createClipperKernel(SR);
        const b = referenceKernel(SR);
        const oa = [new Float32Array(block), new Float32Array(block)];
        const ob = [new Float32Array(block), new Float32Array(block)];
        for (let at = 0; at + block <= n; at += block) {
          const il = l.subarray(at, at + block);
          const ir = r.subarray(at, at + block);
          a.process(il, ir, oa[0], oa[1], block, p.drive, p.ceiling, p.softness);
          b.process(il, ir, ob[0], ob[1], block, p.drive, p.ceiling, p.softness);
          for (let i = 0; i < block; i++) {
            if (!Object.is(oa[0][i], ob[0][i]) || !Object.is(oa[1][i], ob[1][i])) assert.fail(`signal ${si}, ${JSON.stringify(s)}, blocks of ${block}: sample ${at + i} differs`);
          }
        }
        assert.deepEqual(a.read(), b.read());
      }
    }
  }
});
