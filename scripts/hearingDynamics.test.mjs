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
