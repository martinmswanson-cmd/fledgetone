// Unit tests for the mix measurements (src/audio/mixAnalysis.ts), the Mix check's rules
// (src/audio/mixCheck.ts) and the bus presets (src/store/busPresets.ts). Run with `npm test`.
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

const A = await import('../src/audio/mixAnalysis.ts');
const { checkMix, mixMetrics, trackRole } = await import('../src/audio/mixCheck.ts');
const { busPresetFx, busPresetMembers, BUS_PRESETS } = await import('../src/store/busPresets.ts');
const { defaultTrackFx, normalizeTrackFx } = await import('../src/store/timelineTypes.ts');
const { saturationCurve } = await import('../src/audio/effects/busInserts.ts').catch(() => ({}));

const SR = 44100;

/** Seeded noise, so the tests repeat */
function noise(n, seed = 1) {
  let s = seed;
  return Float32Array.from({ length: n }, () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 31 - 1;
  });
}

/** Pink noise (about -3 dB per octave) */
function pink(n, seed = 1) {
  // Paul Kellet's economy pink filter over seeded white noise: -3 dB per octave
  const w = noise(n, seed);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    b0 = 0.99765 * b0 + w[i] * 0.099046;
    b1 = 0.963 * b1 + w[i] * 0.2965164;
    b2 = 0.57 * b2 + w[i] * 1.0526913;
    out[i] = (b0 + b1 + b2 + w[i] * 0.1848) * 0.08;
  }
  return out;
}

const sine = (f, amp, n) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / SR));
const add = (...xs) => xs[0].map((_, i) => xs.reduce((s, x) => s + x[i], 0));

test('the FFT finds a sine where it is', () => {
  const n = 1024;
  const re = Float64Array.from(sine((SR * 64) / n, 1, n));
  const im = new Float64Array(n);
  A.fft(re, im);
  const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
  assert.equal(mags.indexOf(Math.max(...mags)), 64);
});

test('a band spectrum puts a tone in its band, at about its power', () => {
  const x = sine(1000, 0.5, SR * 2);
  const s = A.bandSpectrum([x, x], SR);
  const i = s.mid.indexOf(Math.max(...s.mid));
  assert.ok(Math.abs(Math.log2(s.freqs[i] / 1000)) < 1 / 12, `peak at ${s.freqs[i]}`);
  // Mean square of a 0.5 sine is 0.125: -9 dB
  assert.ok(Math.abs(A.sumDb(s.mid) - 10 * Math.log10(0.125)) < 1, `${A.sumDb(s.mid)}`);
  // Same on both sides: no side at all
  assert.ok(A.sumDb(s.side) < -100);
});

test('the low end out of the middle shows as side energy below 120 Hz', () => {
  const n = SR * 2;
  const bass = sine(60, 0.4, n);
  const top = pink(n, 3);
  const centred = mixMetrics({ lufs: -14, truePeakDb: -1, spectrum: A.bandSpectrum([add(bass, top), add(bass, top)], SR) }, []);
  const wide = mixMetrics({ lufs: -14, truePeakDb: -1, spectrum: A.bandSpectrum([add(bass, top), top], SR) }, []);
  assert.ok(centred.lowSideDb < -60);
  assert.ok(wide.lowSideDb > -10, `${wide.lowSideDb}`);
});

/** A track measure from mono samples */
function measure(id, name, role, x, ducked = false) {
  return { id, name, role, spectrum: A.bandSpectrum([x, x], SR), lowEnv: A.bandEnvelope([x, x], SR, 40, 140), env: A.bandEnvelope([x, x], SR, 0, SR / 2), ducked };
}

/** A kick: a 55 Hz thump every half second */
function kick(n, amp = 0.8) {
  const out = new Float32Array(n);
  for (let at = 0; at < n; at += SR / 2) for (let i = 0; i < SR * 0.15 && at + i < n; i++) out[at + i] = amp * Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp(-i / (SR * 0.05));
  return out;
}

test('the kick and a bass on the same low notes at the same level fight; a ducked bass does not', () => {
  const n = SR * 4;
  const k = kick(n);
  const b = sine(55, 0.5, n);
  const mixSpec = A.bandSpectrum([add(k, b), add(k, b)], SR);
  const mix = { lufs: -14, truePeakDb: -1, spectrum: mixSpec };
  const target = { lufs: -14, name: 'streaming' };
  const fight = checkMix(mix, [measure('k', 'Drums', 'drums', k), measure('b', 'Bass', 'bass', b)], target);
  assert.ok(fight.some((f) => f.id === 'kickBass' && f.trackIds[0] === 'b'), JSON.stringify(fight.map((f) => f.id)));
  const ducked = checkMix(mix, [measure('k', 'Drums', 'drums', k), measure('b', 'Bass', 'bass', b, true)], target);
  assert.ok(!ducked.some((f) => f.id === 'kickBass'));
});

test('two parts in the same range at the same level are said to cover each other', () => {
  const n = SR * 2;
  const a = pink(n, 21);
  const b = pink(n, 22);
  const m = mixMetrics({ lufs: -14, truePeakDb: -1, spectrum: A.bandSpectrum([add(a, b), add(a, b)], SR) }, [measure('a', 'Keys', 'music', a), measure('b', 'Pad', 'music', b)]);
  assert.ok(m.masking.length && m.masking[0].bands >= 4, JSON.stringify(m.masking));
});

test('a bump at 300 Hz reads as mud, and one at 3 kHz as harsh; a smooth slope as neither', () => {
  const n = SR * 3;
  const base = pink(n, 7);
  const smooth = mixMetrics({ lufs: -14, truePeakDb: -1, spectrum: A.bandSpectrum([base, base], SR) }, []);
  assert.ok(Math.abs(smooth.mudDb) < 2.5 && Math.abs(smooth.harshDb) < 2.5, `${smooth.mudDb} ${smooth.harshDb}`);
  // Narrow noise bands added at 300 Hz and at 3 kHz
  const band = (f, seed, amp, r) => {
    const w = noise(n, seed);
    const out = new Float32Array(n);
    // A resonant two-pole filter
    const c = 2 * r * Math.cos((2 * Math.PI * f) / SR);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < n; i++) {
      const y = w[i] * amp + c * y1 - r * r * y2;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    return out;
  };
  const muddy = add(base, band(300, 11, 0.004, 0.995));
  const harsh = add(base, band(3000, 12, 0.03, 0.97));
  const mm = mixMetrics({ lufs: -14, truePeakDb: -1, spectrum: A.bandSpectrum([muddy, muddy], SR) }, []);
  const hm = mixMetrics({ lufs: -14, truePeakDb: -1, spectrum: A.bandSpectrum([harsh, harsh], SR) }, []);
  assert.ok(mm.mudDb > smooth.mudDb + 3, `mud ${mm.mudDb}`);
  assert.ok(hm.harshDb > smooth.harshDb + 3, `harsh ${hm.harshDb}`);
});

test('level against the target: too quiet, too loud, or fine', () => {
  const spectrum = A.bandSpectrum([pink(SR, 2), pink(SR, 2)], SR);
  const target = { lufs: -14, name: 'streaming' };
  assert.ok(checkMix({ lufs: -20, truePeakDb: -3, spectrum }, [], target).some((f) => f.id === 'quiet' && f.level === 'note'));
  assert.ok(checkMix({ lufs: -22, truePeakDb: -0.5, spectrum }, [], target).some((f) => f.id === 'quiet' && f.level === 'problem'));
  assert.ok(checkMix({ lufs: -9, truePeakDb: -1, spectrum }, [], target).some((f) => f.id === 'loud' && f.level === 'problem'));
  assert.ok(!checkMix({ lufs: -13.5, truePeakDb: -1, spectrum }, [], target).some((f) => f.id === 'quiet' || f.id === 'loud'));
});

test('a limiter or clipper working hard is flagged', () => {
  const spectrum = A.bandSpectrum([pink(SR, 2), pink(SR, 2)], SR);
  const target = { lufs: -14, name: 'streaming' };
  const stats = { inPeakDb: 3, limiterInPeakDb: 9, limiterPeakDb: 10, limiterBusyShare: 0.6, clipper: { peakDb: 7, share: 0.1 } };
  const f = checkMix({ lufs: -14, truePeakDb: -1, spectrum, stats }, [], target);
  assert.ok(f.some((x) => x.id === 'limiter' && x.level === 'problem'));
  assert.ok(f.some((x) => x.id === 'clipper' && x.level === 'problem'));
  const calm = checkMix({ lufs: -14, truePeakDb: -1, spectrum, stats: { inPeakDb: -3, limiterInPeakDb: 1, limiterPeakDb: 2, limiterBusyShare: 0.02 } }, [], target);
  assert.ok(!calm.some((x) => x.id === 'limiter' || x.id === 'clipper'));
});

test('the reference comparison finds where the balance differs, whatever the level', () => {
  const n = SR * 2;
  const base = pink(n, 5);
  const bright = add(base, Float32Array.from(noise(n, 9), (v) => v * 0.1));
  const a = A.bandSpectrum([base, base], SR);
  const b = A.bandSpectrum([bright, bright], SR);
  const same = A.compareSpectra(a, a, 6);
  assert.equal(same.regions.length, 0);
  const diff = A.compareSpectra(a, b, 0);
  // The reference has more top (white noise added): the mix has less air
  assert.ok(diff.regions.some((r) => r.name.startsWith('air') && r.db < 0), JSON.stringify(diff.regions));
});

test('track roles come from the instrument, the name and the notes', () => {
  assert.equal(trackRole({ id: '1', name: 'Beat', instrumentKey: 'drums' }), 'drums');
  assert.equal(trackRole({ id: '1', name: '808', instrumentKey: 'bass808' }), 'bass');
  assert.equal(trackRole({ id: '1', name: 'Lead vocal', instrumentKey: 'audio' }), 'vocal');
  assert.equal(trackRole({ id: '1', name: 'Keys', instrumentKey: 'piano' }), 'music');
  const low = [{ trackId: '2', notes: ['C1', 'E1', 'G1', 'C2'].map((note) => ({ note })) }];
  assert.equal(trackRole({ id: '2', name: 'Synth', instrumentKey: 'synthDesigner' }, low), 'bass');
});

test('bus presets set their inserts and leave the rest alone', () => {
  const base = { ...defaultTrackFx(), reverb: { ...defaultTrackFx().reverb, on: true } };
  for (const p of BUS_PRESETS) {
    const fx = busPresetFx(p.id, base);
    assert.equal(fx.reverb.on, true, p.id);
    // What it sets survives the project's repair (so it saves and reopens)
    assert.deepEqual(normalizeTrackFx(fx), fx, p.id);
  }
  assert.equal(busPresetFx('bass').monoLow.on, true);
  assert.equal(busPresetFx('drums').compressor.on, true);
  const v = busPresetFx('vocals');
  assert.equal(v.mbc.bands[2].bypass, undefined);
  assert.ok(v.mbc.highFreq >= 5000 && v.mbc.bands[0].bypass && v.mbc.bands[1].bypass);
});

test('bus preset members: the tracks doing its job that play straight to the master', () => {
  const tracks = [
    { id: 'd', name: 'Drums', instrumentKey: 'drums' },
    { id: 'b', name: '808', instrumentKey: 'bass808' },
    { id: 'k', name: 'Keys', instrumentKey: 'piano' },
    { id: 'p', name: 'Pad', instrumentKey: 'piano', output: 'bus1' },
    { id: 'bus1', name: 'Bus', instrumentKey: 'bus' },
  ];
  const isMix = (t) => t.instrumentKey === 'bus';
  assert.deepEqual(busPresetMembers('drums', tracks, [], isMix).map((t) => t.id), ['d']);
  assert.deepEqual(busPresetMembers('bass', tracks, [], isMix).map((t) => t.id), ['b']);
  assert.deepEqual(busPresetMembers('music', tracks, [], isMix).map((t) => t.id), ['k']);
});

test('the saturation curve leaves quiet sound alone and rounds peaks', { skip: !saturationCurve }, () => {
  const c = saturationCurve(0.5, 1, 8193);
  const at = (x) => c[Math.round(((x / 8 + 1) / 2) * 8192)];
  assert.ok(Math.abs(at(0.01) - 0.01) < 0.001);
  assert.ok(at(1) < 0.5);
  const dry = saturationCurve(0.5, 0, 8193);
  assert.ok(Math.abs(dry[6000] - ((6000 / 8192) * 2 - 1) * 8) < 1e-5);
});
