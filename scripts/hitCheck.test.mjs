// Unit tests for "Does it hit?" (src/audio/hitCheck.ts, src/audio/hitTargets.ts): its FFT and
// filters, synthetic signals that must read as a wobble, a moving bass, gaps, a mono sub, a
// pump; and, when HIT_REFS names a folder of reference drops (WAVs and a refs.json of where
// their drops, kicks and snares are and what the original analysis measured; not part of the
// repository), that the measurements reproduce. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// (Importing the script registers the .ts resolver and gives its WAV reader)
const { readWav } = await import('./audio-check/hit-check.mjs');
const H = await import('../src/audio/hitCheck.ts');
const T = await import('../src/audio/hitTargets.ts');

const SR = 44100;

function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A saw through a resonant state-variable low-pass whose cutoff follows `cutoff(t)` (Hz). */
function filteredSaw(seconds, f0, cutoff, sr = SR) {
  const n = Math.round(seconds * sr);
  const y = new Float32Array(n);
  let lp = 0;
  let bp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const saw = 2 * ((t * f0) % 1) - 1 + 0.5 * (2 * ((t * f0 * 1.005) % 1) - 1);
    const F = 2 * Math.sin((Math.PI * Math.min(cutoff(t), sr / 6)) / sr);
    const hp = saw - lp - 0.3 * bp;
    bp += F * hp;
    lp += F * bp;
    y[i] = 0.3 * lp;
  }
  return y;
}

const sine = (seconds, f, amp = 0.3, phase = 0) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => amp * Math.sin(2 * Math.PI * f * (i / SR) + phase));
const mix = (...xs) => {
  const out = new Float32Array(Math.max(...xs.map((x) => x.length)));
  for (const x of xs) for (let i = 0; i < x.length; i++) out[i] += x[i];
  return out;
};

test('the FFT matches a plain DFT', () => {
  const n = 64;
  const r = rng(3);
  const x = Array.from({ length: n }, () => r() - 0.5);
  const re = Float64Array.from(x);
  const im = new Float64Array(n);
  H.createFft(n)(re, im);
  for (const k of [0, 1, 5, 31, 32, 63]) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      a += x[i] * Math.cos((2 * Math.PI * k * i) / n);
      b -= x[i] * Math.sin((2 * Math.PI * k * i) / n);
    }
    assert.ok(Math.abs(re[k] - a) < 1e-9 && Math.abs(im[k] - b) < 1e-9, `bin ${k}`);
  }
});

test('the band-pass is a Butterworth: -3 dB at its edges, unity in the middle, run both ways', () => {
  const gain = (f) => {
    const x = sine(2, f, 1);
    const y = H.bandpass(x, SR, 30, 60);
    let a = 0;
    let b = 0;
    for (let i = SR / 2; i < (3 * SR) / 2; i++) {
      a += x[i] ** 2;
      b += y[i] ** 2;
    }
    return 10 * Math.log10(b / a);
  };
  assert.ok(Math.abs(gain(42.43)) < 0.05);
  // (Both ways: twice the filter's -3 dB)
  assert.ok(Math.abs(gain(30) + 6.02) < 0.1);
  assert.ok(Math.abs(gain(60) + 6.02) < 0.1);
});

test('a constant-rate LFO wobble reads as a wobble, and the targets say so', () => {
  const bpm = 140;
  const beat = 60 / bpm;
  const seconds = 16 * beat;
  // A 1/8-note LFO sweeping the cutoff 120 Hz to 2 kHz, over a mono sub
  const wob = filteredSaw(seconds, 43.65, (t) => 120 * (2000 / 120) ** (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / (beat / 2))));
  const sub = sine(seconds, 43.65, 0.25);
  const m = mix(wob, sub);
  const r = H.hitCheck({ channels: [m, m], sampleRate: SR, bpm, gridStart: 0 });
  assert.equal(r.movement.kind, 'wobble');
  assert.ok(r.movement.topRateShare > 45, `top rate ${r.movement.topRateShare}`);
  assert.ok(Math.abs(r.movement.topRateCyclesPerBeat - 2) < 0.1, `rate ${r.movement.topRateCyclesPerBeat}`);
  assert.ok(r.movement.ac8 > 0.8, `ac8 ${r.movement.ac8}`);
  const j = new Map(T.judgeHits(r, 'dubstep').map((x) => [x.id, x]));
  assert.equal(j.get('oneRate').status, 'high');
  const bass = T.headlines(r, 'dubstep').find((h) => h.id === 'bass');
  assert.equal(bass.ok, false);
  assert.match(bass.title, /one steady rate/);
});

test('a bass that switches timbre every 16th reads as moving', () => {
  const bpm = 140;
  const six = 60 / bpm / 4;
  const seconds = 64 * six;
  const r0 = rng(7);
  const cutoffs = [150, 300, 700, 1500, 3000];
  const steps = Array.from({ length: 64 }, () => cutoffs[Math.floor(r0() * cutoffs.length)]);
  // (Each step a fresh choice: no steady rate; a bar's pattern repeats, as basslines do)
  for (let i = 16; i < 64; i++) steps[i] = steps[i % 16];
  const x = filteredSaw(seconds, 55, (t) => steps[Math.min(63, Math.floor(t / six))]);
  const r = H.hitCheck({ channels: [x, x], sampleRate: SR, bpm, gridStart: 0 });
  assert.equal(r.movement.kind, 'moving');
  assert.ok(r.movement.over025 >= 50, `over 0.25 oct ${r.movement.over025}`);
  assert.ok(r.movement.acBar > 0.5, `1-bar repeat ${r.movement.acBar}`);
  assert.equal(T.headlines(r, 'dubstep').find((h) => h.id === 'bass').ok, true);
});

test('drum hits with silence between them fail the sustain check; a held pad under them passes', () => {
  const bpm = 128;
  const beat = 60 / bpm;
  const seconds = 16 * beat;
  const n = Math.round(seconds * SR);
  const r0 = rng(11);
  const hits = new Float32Array(n);
  // A decaying noise burst on every 8th, gone within 40 ms
  for (let h = 0; h < seconds / (beat / 2); h++) {
    const at = Math.round(h * (beat / 2) * SR);
    for (let i = 0; i < 0.06 * SR && at + i < n; i++) hits[at + i] = 0.8 * (r0() * 2 - 1) * Math.exp(-i / (0.008 * SR));
  }
  const gapped = H.hitCheck({ channels: [hits, hits], sampleRate: SR, bpm, gridStart: 0 });
  assert.ok(gapped.sustain.below12 > 20, `gaps ${gapped.sustain.below12}%`);
  const j = new Map(T.judgeHits(gapped, 'dubstep').map((x) => [x.id, x]));
  assert.equal(j.get('gaps').status, 'high');
  assert.match(j.get('gaps').advice, /Hold chords longer, add a pad/);
  assert.equal(T.headlines(gapped, 'dubstep').find((h) => h.id === 'gaps').ok, false);
  const pad = mix(
    hits.map((v) => v * 0.4),
    sine(seconds, 220, 0.12),
    sine(seconds, 277.2, 0.1),
    sine(seconds, 329.6, 0.1),
  );
  const held = H.hitCheck({ channels: [pad, pad], sampleRate: SR, bpm, gridStart: 0 });
  assert.ok(held.sustain.below12 < 1.5, `gaps ${held.sustain.below12}%`);
  assert.equal(new Map(T.judgeHits(held, 'dubstep').map((x) => [x.id, x])).get('gaps').status, 'ok');
});

test('a mono sub passes; a sub that differs left and right does not', () => {
  const seconds = 8;
  const r0 = rng(5);
  // Wide mids: different noise in each channel, band-limited to the mids
  const nl = H.bandpass(
    Float32Array.from({ length: seconds * SR }, () => 0.2 * (r0() - 0.5)),
    SR,
    300,
    3000,
  );
  const nr = H.bandpass(
    Float32Array.from({ length: seconds * SR }, () => 0.2 * (r0() - 0.5)),
    SR,
    300,
    3000,
  );
  const sub = sine(seconds, 45, 0.3);
  const L = mix(sub, Float32Array.from(nl));
  const R = mix(sub, Float32Array.from(nr));
  const mono = H.hitCheck({ channels: [L, R], sampleRate: SR, bpm: 140, gridStart: 0 });
  const subBand = mono.bands.find((b) => b.id === 'sub');
  assert.ok(subBand.corr > 0.99 && subBand.sideToMid < -25, `sub corr ${subBand.corr}, S/M ${subBand.sideToMid}`);
  assert.ok(mono.bands.find((b) => b.id === 'lowMid').corr < 0.2, 'the mids are wide');
  assert.equal(new Map(T.judgeHits(mono, 'dubstep').map((x) => [x.id, x])).get('subMono').status, 'ok');
  // The same sub a quarter-cycle apart left and right
  const wide = H.hitCheck({ channels: [mix(sub, Float32Array.from(nl)), mix(sine(seconds, 45, 0.3, Math.PI / 2), Float32Array.from(nr))], sampleRate: SR, bpm: 140, gridStart: 0 });
  const j = new Map(T.judgeHits(wide, 'dubstep').map((x) => [x.id, x]));
  assert.equal(j.get('subMono').status, 'low');
  assert.match(T.headlines(wide, 'dubstep').find((h) => h.id === 'sub').title, /middle/);
});

test('mids ducked after each kick show as a pump and a sidechain dip; drum peaks are measured from the onsets', () => {
  const bpm = 128;
  const beat = 60 / bpm;
  const seconds = 16 * beat;
  const n = Math.round(seconds * SR);
  const chord = mix(sine(seconds, 440, 0.15), sine(seconds, 554, 0.12), sine(seconds, 659, 0.12));
  const kicks = [];
  const out = new Float32Array(n);
  for (let b = 0; b < 16; b++) kicks.push(b * beat);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const since = t % beat;
    // Down 7 dB at the kick, back over 150 ms
    const duck = since < 0.15 ? 10 ** ((-7 * (1 - since / 0.15)) / 20) : 1;
    out[i] = chord[i] * duck;
    // A kick: a falling sine, 120 ms
    if (since < 0.12) out[i] += 0.6 * Math.sin(2 * Math.PI * (50 * since + 60 * 0.03 * (1 - Math.exp(-since / 0.03)))) * Math.exp(-since / 0.05);
  }
  const r = H.hitCheck({ channels: [out, out], sampleRate: SR, bpm, gridStart: 0, kicks, snares: [] });
  assert.ok(r.pump.dip < -5, `pump ${r.pump.dip}`);
  assert.ok(r.pump.atMs < 60, `deepest at ${r.pump.atMs} ms`);
  assert.ok(r.drums.sidechain < -4, `sidechain ${r.drums.sidechain}`);
  assert.ok(Number.isFinite(r.drums.kickPeak) && r.drums.kickOverMix > 0, `kick over the mix ${r.drums.kickOverMix}`);
  assert.equal(new Map(T.judgeHits(r, 'darksynth').map((x) => [x.id, x])).get('pump').status, 'ok');
  // Without the duck: no pump
  const flat = mix(chord);
  const r2 = H.hitCheck({ channels: [flat, flat], sampleRate: SR, bpm, gridStart: 0 });
  assert.ok(r2.pump.dip > -1, `flat pump ${r2.pump.dip}`);
  assert.equal(new Map(T.judgeHits(r2, 'darksynth').map((x) => [x.id, x])).get('pump').status, 'high');
});

test('every style has a target for every metric, low to high, and advice for each way out', () => {
  for (const m of T.HIT_METRICS) {
    for (const s of T.HIT_STYLES) {
      const [lo, hi] = m.target[s.id];
      assert.ok(lo < hi, `${m.id} ${s.id}`);
    }
    // (A metric whose range ends at its scale's end needs no advice that way)
    assert.ok(m.low || m.high, m.id);
  }
});

// ---------- The reference drops (only where HIT_REFS points to them) ----------

const refsDir = process.env.HIT_REFS;
const refsFile = refsDir && path.join(refsDir, 'refs.json');
const haveRefs = !!refsFile && fs.existsSync(refsFile);

test('the reference drops measure as the original analysis did', { skip: haveRefs ? false : 'set HIT_REFS to a folder of reference drops to run this' }, () => {
  const refs = JSON.parse(fs.readFileSync(refsFile, 'utf8'));
  const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(3)} vs ${b} (within ${tol})`);
  for (const [name, ref] of Object.entries(refs)) {
    const wav = path.join(refsDir, `${name}.wav`);
    if (!fs.existsSync(wav)) continue;
    const { channels, sampleRate } = readWav(wav);
    const r = H.hitCheck({ channels, sampleRate, bpm: ref.bpm, start: ref.start, end: ref.end, gridStart: ref.gridStart, kicks: ref.kicks, snares: ref.snares });
    const e = ref.expected;
    const w = (what) => `${name} ${what}`;
    near(r.loudness.integrated, e.integrated, 0.15, w('LUFS'));
    near(r.loudness.crest, e.crest, 0.15, w('crest'));
    r.bands.forEach((b, i) => {
      near(b.db, e.bands[i].db, 0.4, w(`${b.id} level`));
      near(b.corr, e.bands[i].corr, 0.03, w(`${b.id} corr`));
      // (The original's floor for a mono band is about -39 dB of sides; ours reads lower)
      if (e.bands[i].sideToMid > -30) near(b.sideToMid, e.bands[i].sideToMid, 1.5, w(`${b.id} S/M`));
    });
    near(r.sustain.below6, e.below6, 0.3, w('under -6'));
    near(r.sustain.below12, e.below12, 0.2, w('under -12'));
    near(r.sustain.swing16, e.swing16, 0.15, w('swing per 16th'));
    near(r.sustain.swingBeat, e.swingBeat, 0.15, w('swing per beat'));
    near(r.sustain.quietFloor, e.quietFloor, 0.15, w('quiet floor'));
    near(r.movement.jump, e.jump, 0.02, w('centroid jump'));
    near(r.movement.over025, e.over025, 1.5, w('over 0.25 oct'));
    near(r.movement.over05, e.over05, 1.5, w('over 0.5 oct'));
    near(r.movement.topRateShare, e.topRateShare, 1.5, w('top rate share'));
    for (const k of ['ac16', 'ac8', 'acBeat', 'acHalfBar', 'acBar', 'ac2Bar']) near(r.movement[k], e[k], 0.03, w(k));
    near(r.pump.depth, Math.min(...e.pump), 0.15, w('pump'));
    near(r.drums.kickPeak, e.kickPeak, 0.15, w('kick peak'));
    near(r.drums.snarePeak, e.snarePeak, 0.15, w('snare peak'));
    H.CURVE_OFFSETS_MS.forEach((ms, i) => {
      near(r.drums.curves['kick 250-1k'][i], e.kick250[i], 0.25, w(`kick 250-1k at ${ms}`));
      near(r.drums.curves['kick 1-4k'][i], e.kick1k[i], 0.25, w(`kick 1-4k at ${ms}`));
      near(r.drums.curves['snare sub 30-60'][i], e.snareSub[i], 0.25, w(`snare sub at ${ms}`));
    });
  }
});

test('the kicks and snares come from the drum notes, in seconds from the stretch', async () => {
  const { drumOnsets } = await import('../src/audio/hitOnsets.ts');
  const tracks = [
    { id: 'd', instrumentKey: 'designedKit' },
    { id: 'b', instrumentKey: 'subBass' },
  ];
  const note = (n, at) => ({ note: n, startOffset: at, duration: '16n', velocity: 1 });
  const clips = [
    // Bars 1-2 at 120 BPM (a bar is 2 s): kick on 1 and 3, snare on 2 and 4 with a clap on the second
    { id: 'c1', trackId: 'd', startBar: 1, lengthBars: 2, notes: [note('C1', 0), note('D1', 0.25), note('C1', 0.5), note('D1', 0.75), note('D#1', 0.75), note('C1', 1), note('F#1', 1.125)] },
    { id: 'c2', trackId: 'b', startBar: 1, lengthBars: 2, notes: [note('C1', 0)] },
  ];
  const { kicks, snares } = drumOnsets(tracks, clips, 120, 1, 2);
  assert.deepEqual(kicks, [0, 1]);
  // (The snare and the clap together are one hit)
  assert.deepEqual(snares, [0.5, 1.5]);
  // From bar 2 on: the kick at bar 2 is at 0 s
  assert.deepEqual(drumOnsets(tracks, clips, 120, 2, 3).kicks, [0]);
});

test('without drum notes the drum targets are left out, not failed', () => {
  const x = sine(4, 220, 0.2);
  const r = H.hitCheck({ channels: [x, x], sampleRate: SR, bpm: 120, gridStart: 0 });
  assert.equal(r.drums, undefined);
  const j = new Map(T.judgeHits(r, 'dubstep').map((v) => [v.id, v]));
  for (const id of ['kick', 'snare', 'subDuck']) assert.equal(j.get(id).status, 'na');
});

test('four on the floor: snares on kicks are left out of the sub-under-the-snare measure, which is then not measured, with no advice', () => {
  // 120 BPM, 8 s: a kick every beat with a pumped 45 Hz sub (ducked after each kick), snares on 2 and 4 (on kicks)
  const n = 8 * SR;
  const x = new Float32Array(n);
  const beat = 0.5;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const since = t % beat;
    const duck = since < 0.15 ? 0.1 + 0.9 * (since / 0.15) : 1;
    x[i] = 0.3 * duck * Math.sin(2 * Math.PI * 45 * t) + (since < 0.03 ? 0.4 * Math.sin(2 * Math.PI * 1500 * t) * (1 - since / 0.03) : 0);
  }
  const kicks = Array.from({ length: 16 }, (_, i) => i * beat);
  const snares = kicks.filter((_, i) => i % 2 === 1).map((t) => t + 0.005);
  assert.deepEqual(H.loneSnares(kicks, snares), []);
  assert.deepEqual(H.loneSnares(kicks, [0.25, 0.51, 1.75]), [0.25, 1.75]);
  const r = H.hitCheck({ channels: [x, x], sampleRate: SR, bpm: 120, gridStart: 0, kicks, snares });
  assert.equal(r.drums.loneSnares, 0);
  assert.ok(Number.isNaN(r.drums.subDuck), `subDuck ${r.drums.subDuck}`);
  const j = new Map(T.judgeHits(r, 'dubstep').map((v) => [v.id, v]));
  assert.equal(j.get('subDuck').status, 'na');
  assert.equal(j.get('subDuck').advice, '');
  assert.match(j.get('subDuck').unmeasured, /snares land on kicks/);
  // Lone snares (off the kicks: half a beat later) are measured as before
  const off = kicks.filter((_, i) => i % 2 === 1).map((t) => t + 0.25);
  const r2 = H.hitCheck({ channels: [x, x], sampleRate: SR, bpm: 120, gridStart: 0, kicks, snares: off });
  assert.equal(r2.drums.loneSnares, 8);
  assert.ok(Number.isFinite(r2.drums.subDuck));
  assert.equal(new Map(T.judgeHits(r2, 'dubstep').map((v) => [v.id, v])).get('subDuck').unmeasured, undefined);
});

test("the bass alone is rendered with the drums silent, not muted: their hits still duck the bass's Pump, as in the mix", () => {
  const studio = fs.readFileSync(new URL('../src/audio/mixStudio.ts', import.meta.url), 'utf8');
  const run = studio.slice(studio.indexOf('export function runHitCheck'));
  const bassPart = run.slice(run.indexOf('Rendering the bass alone'), run.indexOf("progress(0.75, 'Measuring')"));
  assert.match(bassPart, /soundOnly:/, 'the bass render plays only the bass');
  assert.doesNotMatch(bassPart, /isMuted: true/, 'muting the drums would stop their hits reaching the Pump');
  // The render plays only those tracks, while the Pumps hear every drum kit that sounds (opts.tracks)
  const exp = fs.readFileSync(new URL('../src/audio/exportWav.ts', import.meta.url), 'utf8');
  assert.match(exp, /opts\.soundOnly/);
  assert.match(exp, /const kickTracks = audibleTracks\(opts\.tracks\)/);
});
