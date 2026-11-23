// Unit tests for the hearing report's dynamics and attack groups (src/audio/hearing/dynamics.ts and
// attack.ts), measured on the made test signals of scripts/fixtures/hearingSignals.mjs. Run with `npm test`.
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

const { dynamicsOf } = await import('../src/audio/hearing/dynamics.ts');
const { attackOf } = await import('../src/audio/hearing/attack.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

test('a stereo sine at -20 dBFS reads -20 LUFS, crest 3 dB, no range', () => {
  const s = S.sine(1000, 20, -20); const d = dynamicsOf([s, s], 48000);
  near(d.lufs, -20.0, 0.1); near(d.crestDb, 3.0, 0.1); assert.ok(d.rangeLu <= 0.2); assert.equal(d.shortTerm.length, 18);
});
test('two levels 10 LU apart give a range of about 10', () => {
  const s = S.at(40, [[0, S.sine(1000, 20, -20)], [20, S.sine(1000, 20, -30)]]);
  near(dynamicsOf([s, s], 48000).rangeLu, 10, 1);
});
test('short audio has no range or short-term maximum', () => {
  const d = dynamicsOf([S.sine(1000, 2, -20)], 48000);
  assert.equal(d.rangeLu, null); assert.equal(d.shortTermMaxLufs, null);
});
test('silent and empty audio give nulls, never NaN', () => {
  for (const c of [[], [new Float32Array(0)], [new Float32Array(48000 * 4)]]) {
    const d = dynamicsOf(c, 48000);
    assert.deepEqual([d.lufs, d.shortTermMaxLufs, d.truePeakDbtp, d.crestDb, d.rangeLu], [null, null, null, null, null]);
    assert.ok(d.shortTerm.every((v) => v === null));
  }
  assert.deepEqual(attackOf([], 48000), { onsetsPerSecond: 0, riseMs: null, single: null });
  assert.deepEqual(attackOf([new Float32Array(48000)], 48000), { onsetsPerSecond: 0, riseMs: null, single: null });
  assert.deepEqual(attackOf([new Float32Array(48000), new Float32Array(48000)], 48000), { onsetsPerSecond: 0, riseMs: null, single: null });
});
test('onsets and sharp attacks', () => {
  const hits = S.at(4, Array.from({ length: 16 }, (_, i) => [i / 4, S.burst(0.2, 50, 0, -6, i)]));
  const a = attackOf([hits], 48000);
  near(a.onsetsPerSecond, 4, 0.5); assert.ok(a.riseMs < 3); assert.equal(a.single, null);
});
test('soft attacks read slow', () => {
  const swells = S.at(4, Array.from({ length: 8 }, (_, i) => [i / 2, S.burst(0.4, 200, 80, -6, i)]));
  const r = attackOf([swells], 48000).riseMs; assert.ok(r > 40 && r < 110);
});
test('a single hit is measured as one', () => {
  const a = attackOf([S.at(1, [[0.1, S.burst(0.6, 50, 0, -6, 1)]])], 48000);
  near(a.single.fall20Ms, 115, 35); assert.ok(a.single.riseMs < 3); assert.ok(a.single.peakDb > -30, 'the loudness is read at the hit, not in the lead-in silence');
});
test('sharp hits on a sustained bed still read sharp', () => {
  const bed = S.sine(220, 4, -20);
  const hits = S.at(4, Array.from({ length: 4 }, (_, i) => [i + 0.2, S.burst(0.2, 50, 0, -8, i)]));
  assert.ok(attackOf([S.mix(bed, hits)], 48000).riseMs < 5);
});
test('soft swells on a sustained bed still read slow', () => {
  const bed = S.sine(220, 4, -20);
  const swells = S.at(4, Array.from({ length: 4 }, (_, i) => [i + 0.2, S.burst(0.4, 200, 80, -8, i)]));
  const r = attackOf([S.mix(bed, swells)], 48000).riseMs; assert.ok(r > 40 && r < 110, `${r}`);
});
test('a steady sine has no rise', () => {
  const a = attackOf([S.sine(220, 4, -20)], 48000);
  assert.equal(a.riseMs, null); assert.equal(a.single, null); assert.ok(Number.isFinite(a.onsetsPerSecond));
});
test('stereo input gives finite attack values', () => {
  const l = S.at(4, Array.from({ length: 8 }, (_, i) => [i / 2, S.burst(0.2, 50, 0, -6, i)]));
  const r = S.at(4, Array.from({ length: 8 }, (_, i) => [i / 2 + 0.25, S.burst(0.2, 50, 0, -6, i + 9)]));
  const a = attackOf([l, r], 48000);
  assert.ok(Number.isFinite(a.onsetsPerSecond) && Number.isFinite(a.riseMs));
});

// The onset grid. Hits come n a second over 4 s, the first at 0 s (the sound is read as if silence came before it, so a
// hit there is heard; on a bed that starts with it, it may not be, hence the tolerances).
const SECONDS = 4;
const saws = new Map();
/** A 4 s saw, made once per pitch (the low ones have hundreds of harmonics). */
const saw = (hz, db) => {
  if (!saws.has(hz)) saws.set(hz, S.saw(hz, SECONDS, 0));
  return S.gain(saws.get(hz), db);
};
/** Noise bursts n a second, short enough not to run into each other. */
const hits = (n, db) => S.every(n, SECONDS, (i) => S.burst(Math.min(0.2, 0.9 / n), Math.min(50, 300 / n), 0, db, i));
/** Struck notes n a second: `make(hz, seconds, peakDb)` (S.sine or S.saw) fading with a time constant of `decayMs`. */
const notes = (make, hz, decayMs, db, n) => S.every(n, SECONDS, () => S.decay(make(hz, 0.6, db), decayMs));
const rate = (x) => attackOf([x], 48000).onsetsPerSecond;

test('wobble opens and closes a saw at the LFO rate, and tremolo swings its level', () => {
  const x = S.wobble(55, 150, 3000, 2, 1, -6);
  assert.equal(x.length, 48000);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  near(20 * Math.log10(peak), -6, 0.01);
  // high harmonics (above 1.5 kHz) are strong where the cutoff is high (0.125 s) and weak where it is low (0.375 s)
  const highs = S.band(x, 1500, 20000);
  const hiss = (from) => highs.subarray(from, from + 2400).reduce((s, v) => s + v * v, 0);
  assert.ok(10 * Math.log10(hiss(4800) / hiss(16800)) > 30);
  const t = S.tremolo(new Float32Array(48000).fill(1), 4, 0.5);
  near(t[0], 1 / 1.5, 1e-6); near(t[3000], 1, 1e-6); near(t[9000], 0.5 / 1.5, 1e-6);
});
test('decay fades a sound from its start with the given time constant', () => {
  const x = S.decay(new Float32Array(48000).fill(1), 100);
  near(x[0], 1, 1e-6); near(x[4800], Math.exp(-1), 1e-4); near(x[9600], Math.exp(-2), 1e-4);
});
test('every places n pieces a second, the first at 0 s', () => {
  const x = S.every(4, 2, (i) => Float32Array.of(i + 1));
  assert.equal(x.length, 96000);
  assert.deepEqual([0, 12000, 24000, 84000].map((i) => x[i]), [1, 2, 3, 8]);
  assert.equal(x.reduce((s, v) => s + v, 0), 36);
});

test('steady saws of any pitch from 25 Hz up and at any level read no onsets', () => {
  for (const hz of [25, 30, 35, 41.2, 45, 49, 55, 110, 440, 2000]) for (const db of [-6, -20, -40]) {
    const a = attackOf([saw(hz, db)], 48000);
    assert.deepEqual([a.onsetsPerSecond, a.riseMs], [0, null], `${hz} Hz at ${db} dB`);
  }
});
test('steady sines, a chord and slowly beating saws read no onsets', () => {
  const chord = S.mix(S.saw(261.6, SECONDS, -24), S.saw(329.6, SECONDS, -24), S.saw(392, SECONDS, -24));
  const beating = S.mix(saw(110, -20), S.saw(110.5, SECONDS, -20));
  const cases = [...[30, 55, 220, 1000].map((hz) => [`sine ${hz}`, S.sine(hz, SECONDS, -20)]), ['chord', chord], ['beating', beating]];
  for (const [name, x] of cases) {
    const a = attackOf([x], 48000);
    assert.deepEqual([a.onsetsPerSecond, a.riseMs], [0, null], name);
  }
});
test('a tremolo of 3 or 6 a second is not a run of onsets', () => {
  for (const r of [3, 6]) assert.ok(rate(S.am(440, r, 0.5, SECONDS, -6)) < 1, `${r} a second`);
});
test('steady pink and white noise read under one onset a second at any level and seed', () => {
  for (const db of [-18, -40, -60]) for (const make of [S.pink, S.white]) for (let seed = 1; seed <= 8; seed++) {
    assert.ok(rate(make(SECONDS, db, seed)) < 1, `${make.name} ${db} dB seed ${seed}`);
  }
});

test('noise bursts in silence are counted from 2 to 16 a second, all sharp', () => {
  for (const n of [2, 4, 6, 8, 12, 16]) {
    const a = attackOf([hits(n, -6)], 48000);
    near(a.onsetsPerSecond, n, n * 0.15, `${n} a second`); assert.ok(a.riseMs < 5, `${n} a second: rise ${a.riseMs}`);
  }
});
test('noise bursts on a tone bed are counted whatever the levels', () => {
  for (const [bed, level] of [[-20, -8], [-20, -12], [-14, -6], [-30, -8]]) for (const n of [2, 4, 8, 12]) {
    near(rate(S.mix(S.sine(220, SECONDS, bed), hits(n, level))), n, n * 0.2, `bed ${bed} hits ${level} at ${n} a second`);
  }
});
test('noise bursts on a low saw bed and on a pink-noise bed are counted', () => {
  for (const n of [4, 8]) {
    near(rate(S.mix(saw(55, -20), hits(n, -8))), n, n * 0.2, `saw bed, ${n} a second`);
    near(rate(S.mix(S.pink(SECONDS, -30, 1), hits(n, -8))), n, n * 0.2, `pink bed, ${n} a second`);
  }
});
test('struck notes in silence are counted', () => {
  for (const n of [2, 4, 8]) for (const [name, x] of [['440 Hz sine', notes(S.sine, 440, 100, -6, n)], ['220 Hz saw', notes(S.saw, 220, 100, -6, n)], ['1 kHz sine', notes(S.sine, 1000, 100, -6, n)]]) {
    near(rate(x), n, n * 0.2, `${name}, ${n} a second`);
  }
});
test('struck notes on a held saw are counted, never more than a quarter over', () => {
  for (const n of [2, 4, 8]) {
    const cases = [
      ['300 Hz on a 110 Hz saw', S.mix(saw(110, -20), notes(S.sine, 300, 80, -10, n))],
      ['300 Hz on a 220 Hz saw', S.mix(saw(220, -20), notes(S.sine, 300, 80, -10, n))],
      ['300 Hz on a 55 Hz saw', S.mix(saw(55, -20), notes(S.sine, 300, 80, -10, n))],
      ['600 Hz on a 55 Hz saw', S.mix(saw(55, -20), notes(S.sine, 600, 60, -10, n))],
      ['440 Hz saw on a 55 Hz saw', S.mix(saw(55, -20), notes(S.saw, 440, 100, -10, n))],
    ];
    for (const [name, x] of cases) {
      const r = rate(x);
      near(r, n, n * 0.25, `${name}, ${n} a second`); assert.ok(r <= n * 1.25, `${name}, ${n} a second: ${r}`);
    }
  }
});
test('a kick-like thump is counted alone and on a held tone', () => {
  for (const n of [2, 4]) {
    const thumps = notes(S.sine, 55, 150, -6, n);
    near(rate(thumps), n, n * 0.25, `alone, ${n} a second`);
    near(rate(S.mix(S.sine(110, SECONDS, -14), thumps)), n, n * 0.25, `on a 110 Hz sine, ${n} a second`);
  }
});
test('quiet hits in silence are still counted', () => {
  for (const db of [-30, -50, -60, -90]) near(rate(hits(4, db)), 4, 0.8, `${db} dB`);
});
test('soft swells at 2 a second are counted and read slow', () => {
  const a = attackOf([S.every(2, SECONDS, (i) => S.burst(0.4, 200, 80, -6, i))], 48000);
  near(a.onsetsPerSecond, 2, 0.5); assert.ok(a.riseMs > 40 && a.riseMs < 110, `${a.riseMs}`);
});
test('a wobble bass reads at most one soft onset per LFO cycle', () => {
  const cases = [[55, 150, 3000, [2, 4, 8]], [55, 100, 6000, [4]], [55, 200, 2000, [2, 4]], [55, 300, 1200, [4]], [55, 400, 800, [4]], [41.2, 100, 2500, [2, 4]], [110, 200, 2000, [4]]];
  for (const [hz, lo, hi, rates] of cases) for (const r of rates) {
    const a = attackOf([S.wobble(hz, lo, hi, r, SECONDS, -6)], 48000);
    const name = `${hz} Hz saw, ${lo} to ${hi} Hz at ${r} Hz: ${a.onsetsPerSecond} a second, rise ${a.riseMs}`;
    assert.ok(a.onsetsPerSecond <= 1.35 * r, name); assert.ok(a.riseMs === null || a.riseMs >= 15, name);
  }
  for (const depth of [0.8, 0.5]) for (const r of [4, 6, 8]) {
    const a = attackOf([S.tremolo(saw(55, -6), r, depth)], 48000);
    const name = `level wobble ${depth} at ${r} Hz: ${a.onsetsPerSecond} a second, rise ${a.riseMs}`;
    assert.ok(a.onsetsPerSecond <= 1.35 * r, name); assert.ok(a.riseMs === null || a.riseMs >= 15, name);
  }
});
/** A hi-hat: a short burst of noise above 5 kHz. */
const hat = (i) => S.band(S.burst(0.06, 12, 0, -14, 100 + i), 5000, 20000);
const kicks = () => notes(S.sine, 55, 150, -6, 2);
test('a kick and hats are counted at the hats\' rate, alone and over a bass, a sub or a pad', () => {
  const pad = S.mix(S.saw(261.6, SECONDS, -24), S.saw(329.6, SECONDS, -24), S.saw(392, SECONDS, -24));
  const groove = S.mix(kicks(), S.every(8, SECONDS, hat));
  for (const [name, bed] of [['alone', null], ['on a 55 Hz saw', saw(55, -14)], ['on a 41.2 Hz sub', S.sine(41.2, SECONDS, -10)], ['on a pad', pad]]) {
    const a = attackOf([bed ? S.mix(bed, groove) : groove], 48000);
    near(a.onsetsPerSecond, 8, 8 * 0.15, name); assert.ok(a.riseMs < 5, `${name}: rise ${a.riseMs}`);
  }
  const offbeats = S.at(SECONDS, Array.from({ length: 8 }, (_, i) => [i / 2 + 0.25, hat(i)]));
  near(rate(S.mix(kicks(), offbeats)), 4, 4 * 0.15, 'kick and offbeat hats');
  const a = attackOf([S.mix(S.wobble(55, 150, 3000, 4, SECONDS, -10), groove)], 48000);
  near(a.onsetsPerSecond, 8, 8 * 0.25, 'over a wobble bass'); assert.ok(a.riseMs < 5, `over a wobble bass: rise ${a.riseMs}`);
});
test('hats are told as heard only in the highs; kicks, noise bursts and struck notes are not', () => {
  const pad = S.mix(S.saw(130.8, SECONDS, -12), S.saw(164.8, SECONDS, -12), S.saw(196, SECONDS, -12));
  const hats = S.every(8, SECONDS, hat);
  const share = (x) => attackOf([x], 48000).highShare;
  for (const [name, x] of [['hats alone', hats], ['hats over a pad', S.mix(pad, hats)], ['hats over a pad, 20 dB quieter', S.gain(S.mix(pad, hats), -20)]])
    assert.ok(share(x) >= 0.9, `${name}: ${share(x)}`);
  // (a kick on every second hat: the other three in four are hats alone)
  near(share(S.mix(pad, kicks(), hats)), 0.75, 0.1, 'kick and hats over a pad');
  for (const [name, x] of [['noise bursts', hits(4, -6)], ['struck notes on a held saw', S.mix(saw(110, -20), notes(S.saw, 440, 120, -10, 4))], ['kicks', kicks()]])
    assert.ok(share(x) <= 0.1, `${name}: ${share(x)}`);
});
test('a rate that rounds to nothing has no rise', () => {
  for (const [rate, x] of [[0.04, S.at(25, [[10, S.burst(0.2, 50, 0, -6, 1)]])]]) {
    const a = attackOf([x], 48000);
    assert.equal(a.onsetsPerSecond, 0, `${rate}`); assert.equal(a.riseMs, null);
  }
});
test('four minutes of stereo are measured in under ten seconds', () => {
  const l = S.mix(S.white(240, -30, 1), S.every(8, 240, (i) => S.burst(0.1, 30, 0, -8, i % 50)));
  const r = S.mix(S.pink(240, -30, 2), S.sine(110, 240, -20));
  const t = performance.now();
  const a = attackOf([l, r], 48000);
  assert.ok(performance.now() - t < 10000, `${Math.round(performance.now() - t)} ms`);
  near(a.onsetsPerSecond, 8, 0.5);
});
// What the method can't do, with the values it reads, so a change to them is seen. Not targets.
test('known limits', () => {
  // Hits faster than about 22 a second repeat within the 45 ms hold, as a 25 Hz buzz does, and are mostly not counted
  assert.ok(rate(hits(24, -6)) < 6, 'bursts at 24 a second');
  // Struck notes whose tail is still within 5 dB of their peak 45 ms on are not seen to stand out: 300 Hz, 80 ms, 12 a second
  assert.ok(rate(S.mix(saw(110, -20), notes(S.sine, 300, 80, -10, 12))) < 1, 'struck notes at 12 a second');
  // Struck 523 Hz notes (80 ms) on a chord pad at 8 a second read 15% under
  const pad = S.mix(S.saw(261.6, SECONDS, -24), S.saw(329.6, SECONDS, -24), S.saw(392, SECONDS, -24));
  near(rate(S.mix(pad, notes(S.sine, 523.3, 80, -10, 8))), 6.8, 0.3, 'plucks on a pad at 8 a second');
  // A four-note saw arpeggio on a seven-voice supersaw pad (voices in phase) reads over at 2 a second; the pad alone
  // (its voices drifting in and out of phase) reads 2 slow onsets a second, and a phase-aligned C3-E3-G3 saw chord 0.3
  const supersaw = S.mix(...[-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3].map((d) => S.saw(220 * 2 ** (d / 12), SECONDS, -28)));
  const arp = [261.6, 329.6, 392, 523.3];
  near(rate(S.mix(supersaw, S.every(2, SECONDS, (i) => S.decay(S.saw(arp[i % 4], 0.6, -12), 120)))), 3.3, 0.3, 'arpeggio on a supersaw');
  const pads = attackOf([supersaw], 48000);
  near(pads.onsetsPerSecond, 2, 0.3, 'supersaw alone'); assert.ok(pads.riseMs > 40, 'supersaw alone reads slow');
  near(rate(S.mix(S.saw(130.8, SECONDS, -22), S.saw(164.8, SECONDS, -22), S.saw(196, SECONDS, -22))), 0.3, 0.05, 'C3-E3-G3 chord');
  // A hit on the first sample of a bed that starts with it counts only when the whole sound falls 6 dB after it
  near(rate(S.mix(S.sine(220, SECONDS, -20), hits(2, -8))), 1.8, 0.05, 'bursts at 2 a second on a bed starting with the first');
});
test('a hit at or near the first sample is heard and measured as a single hit', () => {
  const short = attackOf([S.at(0.08, [[0.005, S.burst(0.07, 15, 0, -6, 1)]])], 48000);
  assert.notEqual(short.single, null); assert.ok(short.single.riseMs < 3, `${short.single.riseMs}`); assert.ok(short.onsetsPerSecond > 0);
  const atZero = attackOf([S.at(1, [[0, S.burst(0.6, 50, 0, -6, 1)]])], 48000);
  assert.notEqual(atZero.single, null); assert.ok(atZero.single.riseMs < 3);
  near(rate(S.every(4, SECONDS, (i) => S.burst(0.2, 50, 0, -6, i))), 4, 0.3, 'bursts at 4 a second from 0 s');
});
test('a held sound starting abruptly on its first sample is not an onset', () => {
  for (const [name, x] of [['220 Hz sine', S.sine(220, SECONDS, -20)], ['55 Hz saw', saw(55, -20)], ['pink noise', S.pink(SECONDS, -18, 1)]]) {
    const a = attackOf([x], 48000);
    assert.ok(a.onsetsPerSecond <= 0.25, `${name}: ${a.onsetsPerSecond}`); assert.equal(a.onsetsPerSecond, 0, name);
  }
});
