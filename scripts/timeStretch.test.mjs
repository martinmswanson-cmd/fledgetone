// Unit tests for time-stretching (src/audio/timeStretch.ts, the phase vocoder in
// src/audio/phaseVocoder.ts and the harmonic-percussive split it works on). Run with `npm test`.
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
const { stretchChannels, wsolaChannels, warpChannels, analyseForStretch, PERCUSSIVE_SHARE } = await import('../src/audio/timeStretch.ts');
const { vocode, vocoderSize } = await import('../src/audio/phaseVocoder.ts');
const { inharmonic, saw, AMAJ } = await import('./audio-check/fidelity.mjs');
const { testVoice } = await import('./audio-check/testVoice.mjs');

const SR = 44100;
const sine = (hz, seconds, amp = 0.5) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
/** Frequency from rising zero crossings over the middle of the signal. */
function pitch(x) {
  const a = Math.floor(x.length * 0.2);
  const b = Math.floor(x.length * 0.8);
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = a + 1; i < b; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      if (first < 0) first = i;
      last = i;
      count++;
    }
  }
  return ((count - 1) * SR) / (last - first);
}
const rms = (x, a, b) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));

/** A drum loop: kicks, snares (noise and a tone) and hats, 120 BPM. Seeded. */
function drums(seconds) {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  const beat = 0.5 * SR;
  const add = (at, fn, len) => {
    for (let i = 0; i < len && at + i < n; i++) x[at + i] += fn(i);
  };
  for (let b = 0; b * beat < n; b++) {
    const at = Math.round(b * beat);
    if (b % 2 === 0) {
      let ph = 0;
      add(at, (i) => {
        const t = i / SR;
        ph += (2 * Math.PI * (50 + 120 * Math.exp(-t * 30))) / SR;
        return 0.8 * Math.sin(ph) * Math.exp(-t * 8);
      }, Math.round(0.4 * SR));
    } else add(at, (i) => 0.5 * rnd() * Math.exp((-i / SR) * 25) + 0.3 * Math.sin((2 * Math.PI * 190 * i) / SR) * Math.exp((-i / SR) * 20), Math.round(0.3 * SR));
    for (const h of [0, 0.5]) add(Math.round(at + h * beat), (i) => 0.25 * rnd() * Math.exp((-i / SR) * 60), Math.round(0.08 * SR));
  }
  return x;
}

/** Plucked chords (sharp attacks, decaying), every half second. */
function plucks(seconds) {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let k = 0; k * 0.5 < seconds - 0.5; k++) {
    const c = saw(k % 2 ? [261.63, 329.63, 392] : AMAJ, 0.5, SR);
    const at = Math.round(k * 0.5 * SR);
    for (let i = 0; i < c.length && at + i < x.length; i++) x[at + i] += c[i] * Math.exp((-i / SR) * 6) * (i < 30 ? i / 30 : 1);
  }
  return x;
}

test('stretching changes the length, not the pitch', () => {
  const input = sine(440, 2);
  for (const ratio of [0.8, 1.25, 1.5]) {
    const [out] = stretchChannels([input], ratio, SR);
    assert.equal(out.length, Math.round(input.length / ratio));
    const hz = pitch(out);
    assert.ok(Math.abs(hz - 440) < 2, `ratio ${ratio}: ${hz} Hz`);
    // The level holds (no beating at the joins)
    const level = rms(out, Math.floor(out.length * 0.1), Math.floor(out.length * 0.9));
    assert.ok(Math.abs(20 * Math.log10(level / (0.5 / Math.SQRT2))) < 0.5, `ratio ${ratio}: level ${level}`);
  }
});

test('channels stay together and ratio 1 is a copy', () => {
  const l = sine(220, 1);
  const r = sine(330, 1, 0.25);
  const [a, b] = stretchChannels([l, r], 1.2, SR);
  assert.equal(a.length, b.length);
  assert.ok(Math.abs(pitch(b) - 330) < 2);
  assert.ok(Math.abs(pitch(a) - 220) < 2);
  const [same] = stretchChannels([l], 1, SR);
  assert.deepEqual(same, l);
  assert.notEqual(same, l);
  // A stereo image stays put: a sound only on the left stays only on the left
  const [left, right] = stretchChannels([saw(AMAJ, 1.5, SR), new Float32Array(Math.round(1.5 * SR))], 0.8, SR);
  assert.ok(rms(right, 0, right.length) < 1e-4 * rms(left, 0, left.length));
});

test('a beat stays on the beat: a click every 0.5 s lands every 0.4 s at ratio 1.25', () => {
  const x = new Float32Array(SR * 4);
  for (let k = 0; k < 8; k++) for (let i = 0; i < 200; i++) x[Math.round(k * 0.5 * SR) + i] = Math.exp(-i / 40) * (i % 2 ? 1 : -1);
  const [out] = stretchChannels([x], 1.25, SR);
  for (let k = 1; k < 7; k++) {
    const expect = Math.round(k * 0.4 * SR);
    let peakAt = 0;
    let peak = 0;
    for (let i = expect - 1500; i < expect + 1500; i++) if (Math.abs(out[i]) > peak) { peak = Math.abs(out[i]); peakAt = i; }
    assert.ok(Math.abs(peakAt - expect) < 0.003 * SR, `click ${k} at ${(peakAt / SR).toFixed(3)} s, expected ${(expect / SR).toFixed(3)}`);
    // ...with its punch (a click caught at a window's edge would come out much quieter)
    assert.ok(peak > 0.9, `click ${k} peak ${peak.toFixed(2)}`);
  }
  // Slower, too: every 0.625 s at ratio 0.8
  const [slow] = stretchChannels([x], 0.8, SR);
  for (let k = 1; k < 7; k++) {
    const expect = Math.round(k * 0.625 * SR);
    let peakAt = 0;
    let peak = 0;
    for (let i = expect - 1500; i < expect + 1500; i++) if (Math.abs(slow[i]) > peak) { peak = Math.abs(slow[i]); peakAt = i; }
    assert.ok(Math.abs(peakAt - expect) < 0.003 * SR && peak > 0.9, `slow click ${k} at ${(peakAt / SR).toFixed(3)} s, peak ${peak.toFixed(2)}`);
  }
});

test('drums are heard as drums and stretched exactly as before (WSOLA); tonal sound goes to the phase vocoder', () => {
  const loop = drums(3);
  const heard = analyseForStretch([loop], SR);
  assert.equal(heard.engine, 'wsola');
  assert.ok(heard.percussive >= PERCUSSIVE_SHARE, `drums percussive ${heard.percussive}`);
  for (const ratio of [0.8, 1.25]) assert.deepEqual(stretchChannels([loop], ratio, SR), wsolaChannels([loop], ratio, SR));
  const { samples: voice } = testVoice({ style: 'sung' });
  for (const [name, x] of [['chord', saw(AMAJ, 2, SR)], ['plucks', plucks(2)], ['sung voice', voice.subarray(0, 4 * SR)]]) {
    const a = analyseForStretch([x], SR);
    assert.equal(a.engine, 'vocoder', name);
    assert.ok(a.percussive < 0.4, `${name} percussive ${a.percussive}`);
  }
  // Held chords get the long window (their close partials come apart); a voice's vibrato a short one
  assert.equal(analyseForStretch([saw(AMAJ, 2, SR)], SR).size, 4 * vocoderSize(SR));
  const vibrato = saw([220], 2, SR, 0.3, (t, f0) => f0 * 2 ** ((40 / 1200) * Math.sin(2 * Math.PI * 5.5 * t)));
  assert.ok(analyseForStretch([vibrato], SR).size <= vocoderSize(SR));
});

test('a stretched chord stays a clean chord: nothing between its partials', () => {
  const chord = saw(AMAJ, 3, SR);
  for (const ratio of [0.8, 1.25, 1.5]) {
    const [out] = stretchChannels([chord], ratio, SR);
    const m = inharmonic(out, SR, AMAJ);
    assert.ok(m.all < -45, `ratio ${ratio}: ${m.all.toFixed(1)} dB between the partials`);
    assert.ok(m.noise816 < m.harm816 - 30, `ratio ${ratio}: 8-16 kHz noise ${m.noise816.toFixed(1)} dB, partials ${m.harm816.toFixed(1)}`);
  }
  // A single tone, too, and its level holds steady (no ripple at the window rate)
  const [tone] = stretchChannels([saw([220], 3, SR)], 1.25, SR);
  assert.ok(inharmonic(tone, SR, [220]).all < -60);
  // (Blocks of whole periods, so a steady tone reads steady)
  const blocks = [];
  for (let i = Math.floor(tone.length * 0.25); i < tone.length * 0.75; i += 441) blocks.push(20 * Math.log10(rms(tone, i, i + 5 * 200.45)));
  assert.ok(Math.max(...blocks) - Math.min(...blocks) < 0.3, `level ripple ${(Math.max(...blocks) - Math.min(...blocks)).toFixed(2)} dB`);
});

test('the attacks in a tonal sound stay on time, sharp, with no echo before them', () => {
  const x = plucks(3);
  for (const ratio of [0.8, 1.25]) {
    const [out] = stretchChannels([x], ratio, SR);
    for (let k = 1; k < 5; k++) {
      const expect = Math.round((k * 0.5 * SR) / ratio);
      const onset = k * 0.5 * SR;
      // The attack: its peak, and when it first reaches half of it (the envelope over 1 ms)
      const attack = (y, from) => {
        const env = [];
        for (let i = from - 0.003 * SR; i < from + 0.012 * SR; i += 22) env.push(rms(y, Math.round(i), Math.round(i + 44)));
        const peak = Math.max(...env);
        return { peak, at: env.findIndex((v) => v >= peak / 2) * 22 };
      };
      const got = attack(out, expect);
      const src = attack(x, onset);
      assert.ok(got.peak > 0.6 * src.peak, `ratio ${ratio}, attack ${k}: peak ${got.peak.toFixed(2)} of ${src.peak.toFixed(2)}`);
      assert.ok(Math.abs(got.at - src.at) < 0.002 * SR, `ratio ${ratio}, attack ${k}: ${(((got.at - src.at) / SR) * 1000).toFixed(1)} ms off`);
      // Before the attack: only the last chord's tail (no echo of the new one smeared ahead of it)
      const before = rms(out, expect - Math.round(0.03 * SR), expect - Math.round(0.003 * SR));
      const srcBefore = rms(x, Math.round(k * 0.5 * SR - 0.03 * SR), Math.round(k * 0.5 * SR - 0.003 * SR));
      assert.ok(before < 2 * srcBefore + 0.003, `ratio ${ratio}, attack ${k}: ${before.toFixed(4)} before it (source ${srcBefore.toFixed(4)})`);
    }
  }
});

test('warping: pieces end to end, each to its length, and the phase vocoder gives the sound back at speed 1', () => {
  const chord = saw(AMAJ, 5, SR);
  const pieces = [
    { from: 0, to: 88200, outFrom: 0, outTo: 110250 },
    { from: 88200, to: 176400, outFrom: 110250, outTo: 180810 },
    { from: 176400, to: chord.length, outFrom: 180810, outTo: 180810 + chord.length - 176400 },
  ];
  const [out] = warpChannels([chord], pieces, SR);
  assert.equal(out.length, 180810 + chord.length - 176400);
  // Each piece clean, the slow one and the fast one (one pass along them all: no seams)
  assert.ok(inharmonic(out.subarray(0, 110250), SR, AMAJ).all < -45);
  assert.ok(inharmonic(out.subarray(110250, 180810), SR, AMAJ).all < -45);
  assert.ok(inharmonic(out.subarray(70000, 150000), SR, AMAJ).all < -45, 'across the seam');
  const drumsOut = warpChannels([drums(4)], pieces.slice(0, 2), SR);
  assert.equal(drumsOut[0].length, 180810);
  // Speed 1 through the vocoder is (all but) the input itself
  const [same] = vocode([chord], chord.length, { out: [0, chord.length], in: [0, chord.length] }, SR, { size: 16384 });
  let err = 0;
  for (let i = 0; i < chord.length; i++) err = Math.max(err, Math.abs(same[i] - chord[i]));
  assert.ok(err < 1e-3, `speed 1 differs by ${err}`);
});

// --- Level safety and attacks (regressions) ---

const peakOf = (chs) => Math.max(...chs.map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
const { pitchShiftChannels } = await import('../src/audio/pitchShift.ts');
const { runDspJob } = await import('../src/audio/dspJobs.ts');

test('sound next to digital silence is never turned up (a gated vocal, chord bursts)', () => {
  // A noise-gated voice: 0.6 s on, 0.4 s of exact silence
  const v = new Float32Array(SR * 4);
  let ph = 0;
  for (let i = 0; i < v.length; i++) {
    const t = i / SR;
    const f = 200 * (1 + 0.02 * Math.sin(2 * Math.PI * 5 * t));
    ph += (2 * Math.PI * f) / SR;
    if (t % 1 >= 0.6) continue;
    let s = 0;
    for (let h = 1; h < 20; h++) s += Math.sin(ph * h) * Math.exp(-Math.abs(f * h - 700) / 600);
    v[i] = 0.08 * s;
  }
  const p = peakOf([v]);
  for (const r of [0.8, 0.9, 1.1, 1.25]) assert.ok(peakOf(stretchChannels([v], r, SR)) < p * 1.1, `gated voice at ${r}`);
  for (const st of [-2, 1, 3]) assert.ok(peakOf(pitchShiftChannels([v], st, SR)) < p * 1.1, `gated voice moved ${st} st`);
  // Chord bursts with silence between
  const b = new Float32Array(SR * 3);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    if ((t > 0.5 && t < 1.2) || (t > 1.6 && t < 2.4)) b[i] = (0.9 * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 277 * t) + 0.4 * Math.sin(2 * Math.PI * 330 * t))) / 1.9;
  }
  for (const r of [0.5, 0.7, 1.5, 2]) assert.ok(peakOf(stretchChannels([b], r, SR)) < peakOf([b]) * 1.07, `bursts at ${r}`);
});

test('left and right out of phase is stretched, not silenced', () => {
  const pad = saw(AMAJ, 2, SR);
  const neg = pad.map((v) => -v);
  for (const out of [stretchChannels([pad, neg], 0.8, SR), pitchShiftChannels([pad, neg], 3, SR)]) {
    assert.ok(rms(out[0], 0, out[0].length) > 0.9 * rms(pad, 0, pad.length));
    assert.ok(rms(out[1], 0, out[1].length) > 0.9 * rms(pad, 0, pad.length));
  }
  const loop = drums(3);
  assert.equal(analyseForStretch([loop, loop.map((v) => -v)], SR).engine, 'wsola');
});

test('attacks keep their level, slowed down, sped up or moved an octave', () => {
  // A piano-like one-shot from silence
  const x = new Float32Array(Math.round(SR * 1.5));
  for (let i = 0; i < SR; i++) {
    const t = i / SR;
    let s = 0;
    for (let h = 1; h < 10; h++) s += (Math.sin(2 * Math.PI * 261.6 * h * t) * Math.exp(-t * (2 + h))) / h;
    x[i] = 0.6 * s * Math.min(1, i / 30);
  }
  const p = peakOf([x]);
  for (const r of [0.5, 0.75, 1.5, 2]) {
    const q = peakOf(stretchChannels([x], r, SR));
    assert.ok(Math.abs(20 * Math.log10(q / p)) < 0.5, `one-shot at ${r}: ${(20 * Math.log10(q / p)).toFixed(2)} dB`);
  }
  for (const st of [-12, 12]) assert.ok(peakOf(pitchShiftChannels([x], st, SR)) < p * 1.06, `one-shot moved ${st} st`);
  // A mix of drums, bass and a pad (the phase vocoder's, not WSOLA's): each hit's own energy (the
  // 25 ms after it, less the 25 ms before) within half a dB of the source's
  const beat = 0.5 * SR;
  const loop = drums(3);
  const pad = saw(AMAJ, 3, SR, 0.08);
  const mix = loop.map((v, i) => v + pad[i] + 0.3 * Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp(-((i % beat) / SR) * 2));
  assert.equal(analyseForStretch([mix], SR).engine, 'vocoder');
  const E = (y, a, b) => {
    let s = 0;
    for (let i = Math.max(0, a); i < Math.min(y.length, b); i++) s += y[i] * y[i];
    return s;
  };
  const w = Math.round(0.025 * SR);
  const hit = (y, at) => 10 * Math.log10(E(y, at - 100, at + w) - E(y, at - 100 - w, at - 100));
  for (const r of [0.8, 1.25, 2]) {
    const [out] = stretchChannels([mix], r, SR);
    for (let k = 1; k < 5; k++) {
      const d = hit(out, Math.round((k * beat) / r)) - hit(mix, k * beat);
      if (process.env.SHOW) console.log(r, k, d.toFixed(2));
      else assert.ok(Math.abs(d) < 0.7, `mix at ${r}, hit ${k}: ${d.toFixed(2)} dB`);
    }
  }
});

test('a sound heard once is kept for its next speed, and gives the same stretch', () => {
  const chord = saw(AMAJ, 1.5, SR);
  const once = runDspJob({ kind: 'stretch', ratio: 0.8 }, [chord.slice()], SR).channels[0];
  const kept = runDspJob({ kind: 'stretch', ratio: 0.8, key: 'chord|44100' }, [chord.slice()], SR).channels[0];
  const again = runDspJob({ kind: 'stretch', ratio: 0.8, key: 'chord|44100' }, [chord.slice()], SR).channels[0];
  assert.deepEqual(kept, once);
  assert.deepEqual(again, once);
  // The quick stand-in is WSOLA at the same length
  const quick = runDspJob({ kind: 'stretch', ratio: 0.8, quick: true }, [chord.slice()], SR).channels[0];
  assert.equal(quick.length, once.length);
  assert.deepEqual(quick, wsolaChannels([chord], 0.8, SR)[0]);
});
