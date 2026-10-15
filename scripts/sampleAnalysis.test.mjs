// Unit tests for hearing a sample's tempo and key (src/audio/sampleAnalysis.ts) and re-pitching it
// (src/audio/pitchShift.ts), on material synthesised with known answers (scripts/flip-material.mjs):
// soul-style chord loops in every key, major and minor, with drums and noise, and drum loops at
// tempos from 70 to 160. Run with `npm test`. The accuracy it measures is printed, and must stay
// over the floors below.
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
const A = await import('../src/audio/sampleAnalysis.ts');
const { keyOf } = await import('../src/store/songKey.ts');
const { pitchShiftChannels } = await import('../src/audio/pitchShift.ts');
const M = await import('./flip-material.mjs');

const SR = 22050;
const octaveOff = (got, want) => Math.min(...[0.5, 1, 2].map((k) => Math.abs(got - want * k) / (want * k)));

test('key: chord loops in 6 keys x 2 modes x 7 progressions, starting on the home chord and not', () => {
  // Set A starts each loop on its home chord; set B starts elsewhere (iv, IV, VI, vi), with no
  // sevenths, no drums or more noise, and other tunings
  const others = { minor: [[0, 4, 5, 3], [3, 0, 6, 0], [5, 6, 0, 0]], major: [[0, 2, 3, 4], [3, 4, 0, 5], [5, 3, 0, 4]] };
  let right = 0;
  let n = 0;
  let tuningError = 0;
  const sure = { right: [], wrong: [] };
  for (const mode of ['minor', 'major'])
    for (let root = 1; root < 12; root += 2) {
      const loops = [
        ...M.PROGRESSIONS[mode].map((progression, p) => ({ progression, bpm: [84, 92, 96, 75][p], seed: root * 7 + p, cents: ((root % 3) - 1) * 15 })),
        ...others[mode].map((progression, p) => ({ progression, bpm: 80 + root * 3, seed: 100 + root * 3 + p, sevenths: root % 4 === 1, drums: p !== 1, noise: 0.03, cents: ((root * 7) % 41) - 20 })),
      ];
      for (const loop of loops) {
        const k = A.detectAudioKey(M.chordLoop({ root, mode, ...loop }), SR);
        const ok = k.key.root === root && k.key.mode === mode;
        n++;
        if (ok) right++;
        (ok ? sure.right : sure.wrong).push(k.confidence);
        tuningError = Math.max(tuningError, Math.abs(k.cents - loop.cents));
      }
    }
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  console.log(`  key: ${right}/${n} right (${Math.round((100 * right) / n)}%); confidence when right ${mean(sure.right).toFixed(2)}, when wrong ${mean(sure.wrong).toFixed(2)}; tuning within ${tuningError} cents`);
  assert.ok(right / n >= 0.85, `only ${right}/${n} keys right`);
  assert.ok(tuningError <= 3, `tuning off by ${tuningError} cents`);
  if (sure.wrong.length) assert.ok(mean(sure.wrong) < mean(sure.right), 'a wrong key should be less sure than a right one');
});

test('tempo: drum loops (boom bap, trap, four on the floor) at 70 to 160 BPM, chord loops, and cut-off stretches', () => {
  let exact = 0;
  let octave = 0;
  let n = 0;
  let worst = 0;
  const check = (bpm, x, loop) => {
    const t = A.detectTempo(x, SR);
    assert.ok(t, `no tempo found at ${bpm}`);
    n++;
    if (Math.abs(t.bpm - bpm) / bpm < 0.02) exact++;
    const off = octaveOff(t.bpm, bpm);
    if (off < 0.02) octave++;
    worst = Math.max(worst, off);
    if (loop) assert.equal(t.loop, true, `${bpm}: a whole number of bars should read as a loop`);
    assert.ok(t.confidence >= 0.3, `${bpm}: confidence ${t.confidence}`);
  };
  for (const style of ['boombap', 'trap', 'four']) for (const bpm of [70, 78, 86, 90, 95, 100, 120, 130, 140, 150, 160]) check(bpm, M.drumLoop({ bpm, style, seed: bpm }), true);
  for (const bpm of [72, 84, 92, 98, 110]) check(bpm, M.chordLoop({ root: 2, mode: 'minor', progression: [0, 5, 2, 6], bpm }), true);
  // Not loops: a lead-in cut off and an end mid-bar, so the length gives nothing away
  for (const bpm of [76, 88, 94, 132, 145]) {
    const x = M.drumLoop({ bpm, style: 'boombap', bars: 5, seed: bpm + 1 });
    check(bpm, x.subarray(Math.round(0.137 * SR), Math.round(x.length * 0.83)), false);
  }
  console.log(`  tempo: ${exact}/${n} at the tempo (within 2%), ${octave}/${n} allowing half or double; worst ${(worst * 100).toFixed(2)}% off`);
  assert.equal(octave, n, 'every tempo found, allowing half or double');
  assert.ok(exact / n >= 0.75, `only ${exact}/${n} at the tempo itself`);
  assert.ok(worst < 0.005, `${(worst * 100).toFixed(2)}% off`);
});

test('tempo: no beat in noise, a held chord or silence', () => {
  const random = M.rng(5);
  const noise = new Float32Array(SR * 6).map(() => (random() * 2 - 1) * 0.3);
  const t = A.detectTempo(noise, SR);
  assert.ok(!t || t.confidence < 0.35, `noise read as ${t?.bpm} at ${t?.confidence}`);
  const pad = new Float32Array(SR * 6);
  for (let i = 0; i < pad.length; i++) pad[i] = 0.2 * (Math.sin((2 * Math.PI * 220 * i) / SR) + Math.sin((2 * Math.PI * 261.63 * i) / SR) + Math.sin((2 * Math.PI * 329.63 * i) / SR));
  const p = A.detectTempo(pad, SR);
  assert.ok(!p || p.confidence < 0.25, `a held chord read as ${p?.bpm} at ${p?.confidence}`);
  // ...but its key is plain: A minor (A C E)
  assert.equal(A.detectAudioKey(pad, SR).key.name, 'A minor');
  assert.equal(A.detectTempo(new Float32Array(SR * 4), SR), null);
  assert.equal(A.detectAudioKey(new Float32Array(SR * 4), SR), null);
});

test('keyShift: the nearest way into the song key, relative major or minor, tuning taken off', () => {
  assert.equal(A.keyShift(keyOf(9, 'minor'), keyOf(0, 'minor')), 3); // A minor up to C minor
  assert.equal(A.keyShift(keyOf(0, 'minor'), keyOf(9, 'minor')), -3);
  assert.equal(A.keyShift(keyOf(0, 'major'), keyOf(6, 'major')), -6);
  assert.equal(A.keyShift(keyOf(0, 'major'), keyOf(5, 'major')), 5);
  // A minor sample in a C major song: already there (its relative minor)
  assert.equal(A.keyShift(keyOf(9, 'minor'), keyOf(0, 'major')), 0);
  // C major sample in an A minor song: there too; in D minor: up 5 to F major, its relative major
  assert.equal(A.keyShift(keyOf(0, 'major'), keyOf(9, 'minor')), 0);
  assert.equal(A.keyShift(keyOf(0, 'major'), keyOf(2, 'minor')), 5);
  // 20 cents sharp: 20 cents less
  assert.equal(A.keyShift(keyOf(9, 'minor'), keyOf(0, 'minor'), 20), 2.8);
});

test('forAnalysis: mixes to mono and brings 48 kHz to the analysis rate', () => {
  const sr = 48000;
  const left = new Float32Array(sr).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / sr));
  const right = new Float32Array(sr);
  const x = A.forAnalysis([left, right], sr);
  assert.ok(Math.abs(x.length - A.ANALYSIS_RATE) <= 1);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak > 0.45 && peak <= 0.5, `peak ${peak}`);
  assert.equal(A.detectAudioKey(x, A.ANALYSIS_RATE).chroma[9], 1, 'still an A');
});

/** The frequency of a steady tone by counting rising zero crossings. */
function frequencyOf(x, sr) {
  let crossings = 0;
  let first = -1;
  let last = -1;
  for (let i = 1; i < x.length; i++)
    if (x[i - 1] < 0 && x[i] >= 0) {
      const at = i - x[i] / (x[i] - x[i - 1]);
      if (first < 0) first = at;
      last = at;
      crossings++;
    }
  return ((crossings - 1) * sr) / (last - first);
}

test('pitchShiftChannels: moves the pitch, keeps the length and the level', () => {
  const sr = 44100;
  const tone = new Float32Array(sr * 2).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr));
  for (const st of [-5, -1, 0.3, 3, 7]) {
    const [out] = pitchShiftChannels([tone], st, sr);
    assert.equal(out.length, tone.length);
    const mid = out.subarray(sr * 0.25, sr * 1.75);
    const hz = frequencyOf(mid, sr);
    const want = 220 * 2 ** (st / 12);
    const cents = 1200 * Math.log2(hz / want);
    assert.ok(Math.abs(cents) < 5, `${st} st: ${hz.toFixed(2)} Hz, ${cents.toFixed(1)} cents off`);
    let rms = 0;
    for (const v of mid) rms += v * v;
    rms = Math.sqrt(rms / mid.length);
    assert.ok(Math.abs(20 * Math.log10(rms / (0.5 / Math.SQRT2))) < 1.5, `${st} st: level ${rms}`);
  }
  // A drum loop moved keeps its hits where they were (the timing doesn't move)
  const loop = M.drumLoop({ bpm: 90, sr, bars: 1, seed: 2 });
  const [moved] = pitchShiftChannels([loop], 4, sr);
  const hits = (x) => A.onsetTimes(A.onsetStrength(Float32Array.from(x.filter((_, i) => i % 2 === 0)), sr / 2).strength, sr / 2);
  const before = hits(loop);
  const after = hits(moved);
  for (const t of before.slice(0, 4)) assert.ok(after.some((u) => Math.abs(u - t) < 0.02), `hit at ${t.toFixed(3)} moved`);
});
