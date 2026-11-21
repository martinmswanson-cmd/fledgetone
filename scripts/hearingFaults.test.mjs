// Unit tests for the hearing report's faults (src/audio/hearing/faults.ts): clicks, clipping, DC, hum,
// digital silence and a missing channel, measured on the made test signals of scripts/fixtures/. Healthy
// sound of every kind the app makes must read no fault; this is a slice of each family, and the wide grids
// are in scripts/audio-check/hearing/faults-grid.mjs. Run with `npm test`.
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

const { faultsOf } = await import('../src/audio/hearing/faults.ts');
const S = await import('./fixtures/hearingSignals.mjs');
const G = await import('./fixtures/hearingFaultSignals.mjs');

/** S.saw, made once per set of arguments (it is slow at low pitches) and handed out as a copy. */
const saws = new Map();
const saw = (...args) => { const key = args.join(); if (!saws.has(key)) saws.set(key, S.saw(...args)); return saws.get(key).slice(); };
/** A bass note: its first six harmonics, falling as 1/k, peaking near `db`. */
const tone = (hz, sec, db) => S.mix(...[1, 2, 3, 4, 5, 6].map((k) => S.sine(hz * k, sec, db - 20 * Math.log10(k) - 7)));
/** A made signal kept by name and length, handed out as a copy. */
const kept = new Map();
const once = (name, make) => (sec) => { const key = `${name} ${sec}`; if (!kept.has(key)) kept.set(key, make(sec)); return kept.get(key).slice(); };
const drums = once('drums', G.drums);
const hum60 = once('hum60', G.hum60);
const hum50 = once('hum50', G.hum50);
const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

const beds = new Map();
/** The bed, made once per length (its band-pass is slow) and handed out as a copy. */
const bed = (sec) => { if (!beds.has(sec)) beds.set(sec, S.mix(S.sine(110, sec, -12), S.sine(440, sec, -18), S.band(S.pink(sec, -30, 3), 100, 4000))); return beds.get(sec).slice(); };
const rmsAround = (x, i, sr = 48000) => { const a = x.subarray(i - sr * 0.025, i + sr * 0.025); return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length); };
const clicksOf = (channels) => faultsOf(channels, 48000).filter((f) => f.kind === 'click');
const rmsOf = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
const toRms = (x, db) => S.gain(x, db - 20 * Math.log10(rmsOf(x)));
const noClicks = (x, what) => assert.deepEqual(clicksOf([x]), [], what);

test('a one-sample jump 12 dB over the level around it is found, to the millisecond', () => {
  const x = bed(4); const i = 2 * 48000; x[i] += 4 * rmsAround(x, i);
  const clicks = faultsOf([x], 48000).filter((f) => f.kind === 'click');
  assert.equal(clicks.length, 1); near(clicks[0].seconds, 2.0, 0.001);
});
test('no clicks in clean sound, noise, drums or distortion', () => {
  const drums = S.at(4, Array.from({ length: 16 }, (_, i) => [i / 4, S.burst(0.2, 40, 0, -3, i)]));
  for (const x of [bed(4), S.white(10, -12, 1), drums, S.clip(saw(55, 4, 0), 0.5), S.gate(saw(110, 4, -6), 8, -60)])
    assert.deepEqual(faultsOf([x], 48000).filter((f) => f.kind === 'click'), []);
});
test('clipping at full scale is a fault; flat tops below it are not', () => {
  const full = faultsOf([S.clip(S.sine(200, 2, 6), 1.0)], 48000).find((f) => f.kind === 'clipping'); assert.ok(full.count >= 10);
  assert.equal(faultsOf([S.clip(S.sine(200, 2, 0), 0.5)], 48000).find((f) => f.kind === 'clipping'), undefined);
});
test('DC offset', () => { near(faultsOf([bed(2).map((v) => v + 0.01)], 48000).find((f) => f.kind === 'dc').value, -40, 0.5); });
test('hum is found; a bass note is not hum', () => {
  const hum = S.mix(S.pink(10, -18, 1), S.sine(60, 10, -27), S.sine(120, 10, -33));
  assert.equal(faultsOf([hum], 48000).find((f) => f.kind === 'hum').value, 60);
  const note = S.mix(S.pink(10, -18, 1), S.at(10, [[3, S.sine(61.74, 2, -12)]]));
  assert.equal(faultsOf([note], 48000).find((f) => f.kind === 'hum'), undefined);
  assert.equal(faultsOf([S.pink(10, -18, 1)], 48000).find((f) => f.kind === 'hum'), undefined);
});
test('digital silence in the middle, not at the ends', () => {
  const gap = S.at(2.2, [[0, S.sine(440, 1, -6)], [1.2, S.sine(440, 1, -6)]]);
  const f = faultsOf([gap], 48000).find((x) => x.kind === 'silence'); near(f.seconds, 1.0, 0.01); near(f.endSeconds, 1.2, 0.01);
  assert.equal(faultsOf([S.at(3, [[1, S.sine(440, 1, -6)]])], 48000).find((x) => x.kind === 'silence'), undefined);
});
test('a missing channel', () => {
  const l = bed(2); assert.equal(faultsOf([l, new Float32Array(l.length)], 48000).find((f) => f.kind === 'channel').channel, 'right');
  assert.equal(faultsOf([l, l], 48000).find((f) => f.kind === 'channel'), undefined);
});
test('nothing false in a clean stereo sound', () => assert.deepEqual(faultsOf([bed(6), bed(6)], 48000), []));
test('a four-minute stereo sound takes under 10 seconds', () => {
  const x = S.pink(240, -18, 1);
  const start = performance.now();
  faultsOf([x, x], 48000);
  const took = (performance.now() - start) / 1000;
  assert.ok(took < 10, `took ${took.toFixed(1)} s`);
});

// More healthy sound: none of it is a click

test('no clicks in steady saws from 25 Hz to 2 kHz, plain or hard-clipped', () => {
  for (const f of [25, 110, 2000]) {
    const wave = saw(f, f < 50 ? 0.5 : 1, 0);
    noClicks(wave, `saw ${f} Hz`);
    noClicks(S.clip(wave, 0.5), `saw ${f} Hz clipped at 0.5`);
    noClicks(S.clip(wave, 0.25), `saw ${f} Hz clipped at 0.25`);
  }
});
test('no clicks in wobble and tremolo basses, plain or clipped', () => {
  const w = S.wobble(73.4, 80, 3000, 8, 1, -3);
  noClicks(S.clip(S.gain(w, 12), 0.7), 'clipped wobble');
  noClicks(S.tremolo(S.clip(saw(55, 2, 0), 0.5), 4, 1).subarray(0, 48000), 'tremolo clipped saw');
  noClicks(S.gate(saw(25, 0.5, 0), 8, -60), 'a 25 Hz saw gated at 8 Hz');
});
test('no clicks in hard-clipped and square basses under kick, hats and snare', () => {
  const beat = drums(2);
  noClicks(S.mix(beat, S.clip(S.gain(saw(55, 2, 0), 12), 0.2)), 'saw 55 Hz +12 dB clipped at 0.2');
  noClicks(S.mix(beat, G.square(41.2, 2, 0.1)), 'square 41.2 Hz at 0.1');
  noClicks(S.mix(beat.subarray(0, 48000), G.limitedSquare(73.4, 1, 0.1)), 'band-limited square 73.4 Hz at 0.1');
});
test('a click planted away from the corners of that material is found', () => {
  const beat = drums(2);
  for (const [name, x, t] of [['saw 55 Hz clipped at 0.2', S.mix(beat, S.clip(S.gain(saw(55, 2, 0), 12), 0.2)), 1.1], ['square 55 Hz at 0.2', S.mix(beat, G.square(55, 2, 0.2)), 1.3], ['saw 110 Hz clipped at 0.1', S.mix(beat, S.clip(S.gain(saw(110, 2, 0), 12), 0.1)), 1.7]]) {
    const { x: y, at } = G.plantAwayFromCorners(x, t);
    const clicks = clicksOf([y]);
    assert.equal(clicks.length, 1, name); near(clicks[0].seconds, at / 48000, 0.001, name);
  }
});
test('no clicks in a square wave at 110 Hz', () => {
  noClicks(G.square(110, 1, 0.5), 'a square'); noClicks(G.limitedSquare(110, 1, 0.5), 'a band-limited square');
});
test('no clicks in white and pink noise, quiet to loud', () => {
  for (const db of [-6, -18, -40]) { noClicks(S.white(5, db, 1), `white ${db} dB`); noClicks(S.pink(5, db, 1), `pink ${db} dB`); }
});
test('the file edges are not clicks', () => {
  const cosine = Float32Array.from({ length: 2 * 48000 }, (_, i) => 0.5 * Math.cos((2 * Math.PI * 440 * i) / 48000));
  noClicks(cosine, 'a sound at full level on its first sample');
  noClicks(cosine.reverse(), 'a sound at full level on its last sample');
  noClicks(S.clip(saw(55, 2, 0), 0.5).subarray(1234, 80000), 'a clipped saw cut at both ends');
  noClicks(S.white(2, -12, 3), 'noise from the first sample to the last');
});
test('a note cut off cleanly at a zero crossing is not a click', () => {
  noClicks(S.at(2, [[0.5, S.sine(440, 1, -6)]]), '440 Hz, whole cycles');
  noClicks(S.at(2, [[0.5, S.sine(1000, 0.5, -3)]]), '1 kHz, whole cycles');
  // a period that is not a whole number of samples: cut at the last sample before the wave crosses zero
  for (const hz of [441, 97.3, 1733]) {
    const x = S.sine(hz, 1.3, -3);
    let end = Math.round(48000 * 1.2);
    while (!(x[end] >= 0 && x[end + 1] < 0)) end++;
    noClicks(S.at(2, [[0.3, x.subarray(0, end + 1)]]), `${hz} Hz cut at sample ${end}`);
  }
});

// Real faults: each is found, and where

test('the same click on a quiet bed and on a loud one', () => {
  for (const db of [-40, -6]) {
    const x = toRms(bed(4), db); const i = Math.round(1.537 * 48000); x[i] += 4 * rmsAround(x, i);
    const clicks = clicksOf([x]);
    assert.equal(clicks.length, 1, `bed at ${db} dB`); near(clicks[0].seconds, 1.537, 0.001);
  }
});
test('a click in one channel only names that channel', () => {
  const l = bed(3); const r = bed(3); const i = Math.round(2.25 * 48000); r[i] -= 4 * rmsAround(r, i);
  const clicks = clicksOf([l, r]);
  assert.equal(clicks.length, 1); assert.equal(clicks[0].channel, 'right'); near(clicks[0].seconds, 2.25, 0.001);
  const both = bed(3); both[i] -= 4 * rmsAround(both, i);
  assert.equal(clicksOf([both, both])[0].channel, undefined);
});
test('two clicks 200 ms apart are two faults', () => {
  const x = bed(4);
  for (const t of [1.5, 1.7]) { const i = t * 48000; x[i] += 4 * rmsAround(x, i); }
  const clicks = clicksOf([x]);
  assert.equal(clicks.length, 2); near(clicks[0].seconds, 1.5, 0.001); near(clicks[1].seconds, 1.7, 0.001);
});
test('a click during a held clipped saw bass', () => {
  const x = S.clip(saw(55, 4, 0), 0.5);
  for (const t of [1.2051, 3.1]) {
    const y = x.slice(); const i = Math.round(t * 48000); y[i] += 4 * rmsAround(y, i);
    const clicks = clicksOf([y]);
    assert.equal(clicks.length, 1, `click at ${t} s`); near(clicks[0].seconds, t, 0.001);
  }
});
test('a 5 ms dropout that cuts mid-wave reads as a click at its place', () => {
  for (const x of [S.sine(220, 3, -6), bed(3)]) {
    const from = Math.round(1.4013 * 48000); const to = from + 240;
    x.fill(0, from, to);
    const clicks = clicksOf([x]);
    assert.ok(clicks.length >= 1 && clicks.length <= 2);
    for (const c of clicks) assert.ok(c.seconds >= 1.4013 - 0.001 && c.seconds <= to / 48000 + 0.001, `click at ${c.seconds}`);
  }
});
test('more than twenty clicks: the first twenty, then how many more', () => {
  const x = bed(5);
  for (let k = 0; k < 25; k++) { const i = Math.round((0.2 + k * 0.17) * 48000); x[i] += (k % 2 ? 4 : -4) * rmsAround(x, i); }
  const clicks = clicksOf([x]);
  assert.equal(clicks.length, 21);
  assert.deepEqual([clicks[20].seconds, clicks[20].count], [null, 5]);
  near(clicks[19].seconds, 0.2 + 19 * 0.17, 0.001);
});

// The other faults, more closely

test('faults are in time order, those without a time last, each with a plain detail', () => {
  const l = S.mix(S.clip(S.sine(200, 6, 6), 1.0), S.sine(60, 6, -20), S.sine(120, 6, -26)).map((v) => v + 0.02);
  l[3 * 48000] += 0.5; l.fill(0, 4 * 48000, 4.1 * 48000);
  const f = faultsOf([l, S.gain(l, -20)], 48000);
  const timed = f.filter((x) => x.seconds !== null);
  assert.deepEqual(timed.map((x) => x.seconds), [...timed.map((x) => x.seconds)].sort((a, b) => a - b));
  assert.ok(f.findIndex((x) => x.seconds === null) >= timed.length);
  for (const x of f) {
    assert.match(x.detail, /^[A-Z0-9].*[^.]$/, x.detail); // (no full stop at its end: the words add it; a value has a decimal point)
    assert.doesNotMatch(x.detail, /\b(good|bad|too|should)\b|second|\d ?s\b/i, x.detail);
  }
  const channel = f.find((x) => x.kind === 'channel'); assert.equal(channel.channel, 'right'); near(channel.value, 20, 0.5);
});
test('a kick loop is not a DC offset; an offset is, through the kicks; one under -50 dBFS is not', () => {
  for (const [rate, options] of [[8, { decayMs: 250 }], [8, { hz: 110, toHz: 45, decayMs: 250 }], [4.33, { decayMs: 100 }], [5, { decayMs: 250, cosine: true }], [2, { decayMs: 250 }]])
    assert.equal(faultsOf([G.kickLoop(rate, 6, { hz: 55, peak: 0.8, ...options })], 48000).find((f) => f.kind === 'dc'), undefined, `${rate} a second ${JSON.stringify(options)}`);
  near(faultsOf([S.mix(bed(8), G.kickLoop(2, 8, { hz: 55, decayMs: 150, peak: 0.8 })).map((v) => v + 0.01)], 48000).find((f) => f.kind === 'dc').value, -40, 0.5);
  near(faultsOf([bed(2).map((v) => v - 0.01)], 48000).find((f) => f.kind === 'dc').value, -40, 0.5);
  const pink = S.pink(8, -40, 1).map((v) => v + 0.005); // pink's own slow wander adds to so small an offset: the value is the signal's mean
  near(faultsOf([pink], 48000).find((f) => f.kind === 'dc').value, 20 * Math.log10(pink.reduce((a, v) => a + v, 0) / pink.length), 0.5);
  assert.equal(faultsOf([bed(2).map((v) => v + 0.002)], 48000).find((f) => f.kind === 'dc'), undefined);
});
test('a held bass, a sub that stops, a walking bassline and a tempo-locked kick are not hum; hum is, under a held note too', () => {
  const hum = (x) => faultsOf([x], 48000).filter((f) => f.kind === 'hum').map((f) => f.value);
  for (const [name, x] of [['held bass 61.74 Hz', S.mix(S.pink(5, -24, 2), tone(61.74, 5, -6))], ['held bass 49 Hz', S.mix(S.pink(5, -24, 2), tone(49, 5, -6))],
    ['sub at 50 Hz for 3 of 6 s', S.at(6, [[1.5, G.fade(tone(50, 3, -6))]])], ['kicks 10 a second', G.kickLoop(10, 5, { hz: 55, decayMs: 150, peak: 0.8 })],
    ['kicks dropping 110 to 45 Hz, 6 a second', G.kickLoop(6, 5, { hz: 110, toHz: 45, decayMs: 150, peak: 0.8 })], ['kicks 12 a second', G.kickLoop(12, 5, { hz: 55, decayMs: 150, peak: 0.8 })]])
    assert.deepEqual(hum(x), [], name);
  assert.deepEqual(hum(hum50(5)), [50]);
  assert.deepEqual(hum(S.mix(hum60(10), S.sine(55, 10, -12))), [60], 'under a held 55 Hz note');
  assert.deepEqual(hum(S.mix(hum60(10), tone(49, 10, -20))), [60], 'under a held 49 Hz note');
  assert.deepEqual(hum(S.mix(hum50(10), tone(73.4, 10, -12))), [50], 'under a held 73.4 Hz note');
  const walk = S.at(10, Array.from({ length: 10 }, (_, i) => [i, G.fade(tone([49, 55, 61.74, 55][i % 4], 1, -8))]));
  assert.deepEqual(hum(S.mix(S.pink(10, -30, 3), walk)), [], 'a walking bassline on G1, A1 and B1');
  assert.deepEqual(hum(S.mix(hum60(10), G.kickAndHats(10))), [60]);
  assert.deepEqual(hum(S.mix(S.pink(3, -18, 4), S.sine(50, 3, -24), S.sine(150, 3, -30))), [], 'under 4 seconds');
  assert.equal(faultsOf([hum50(5)], 48000).find((f) => f.kind === 'hum').seconds, null);
});
test('silence: only exact zeros, and at least 50 ms of them', () => {
  const quiet = S.at(2.2, [[0, S.sine(440, 1, -6)], [1.2, S.sine(440, 1, -6)]]); for (let i = 48000; i < 57600; i++) quiet[i] = 1e-7;
  assert.equal(faultsOf([quiet], 48000).find((x) => x.kind === 'silence'), undefined);
  const short = S.at(2.04, [[0, S.sine(440, 1, -6)], [1.04, S.sine(440, 1, -6)]]);
  assert.equal(faultsOf([short], 48000).find((x) => x.kind === 'silence'), undefined);
  const gap = S.at(2.2, [[0, S.sine(440, 1, -6)], [1.2, S.sine(440, 1, -6)]]);
  assert.equal(faultsOf([gap, S.sine(440, 2.2, -6)], 48000).find((x) => x.kind === 'silence'), undefined);
});
test('a quieter channel, and nothing at all from silence', () => {
  const l = bed(2); const f = faultsOf([S.gain(l, -14), l], 48000).find((x) => x.kind === 'channel');
  assert.equal(f.channel, 'left'); near(f.value, 14, 0.2);
  assert.equal(faultsOf([S.gain(l, -8), l], 48000).find((x) => x.kind === 'channel'), undefined);
  assert.deepEqual(faultsOf([new Float32Array(48000), new Float32Array(48000)], 48000), []);
  assert.deepEqual(faultsOf([new Float32Array(0)], 48000), []);
  const broken = bed(1); broken[20000] = NaN; broken[30000] = Infinity;
  assert.ok(Array.isArray(faultsOf([broken], 48000)), 'a sample that is not a number does not stop it');
});

// Known limits, measured: what the rules cannot tell apart, kept here so a change that moves them shows

test('known limit: clicks closer than 150 ms, of any size, read as a wave repeating its corners', () => {
  const total = (x) => clicksOf([x]).reduce((a, f) => a + (f.seconds === null ? f.count : 1), 0);
  const close = bed(3); [4, 6, 3, 8].forEach((k, j) => { const i = Math.round((1 + j * 0.1) * 48000); close[i] += k * rmsAround(close, i); });
  assert.equal(total(close), 0, '4, 6, 3 and 8 times the RMS, 100 ms apart');
  // crackle: clicks of 2 to 8 times the RMS at random places in 10 s of the bed. The count found does not
  // track the count made: measured 16 made, 12 found; 40, 25; 160, 13; 400, 2
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const found = [16, 160].map((n) => {
    const x = bed(10);
    for (let k = 0; k < n; k++) { const i = 2400 + Math.floor(rnd() * (x.length - 4800)); x[i] += (rnd() < 0.5 ? -1 : 1) * (2 + 6 * rnd()) * rmsAround(x, i); }
    return total(x);
  });
  assert.ok(found[0] >= 8 && found[0] <= 16, `16 made, ${found[0]} found`);
  assert.ok(found[1] <= 40, `160 made, ${found[1]} found`);
});
test('known limit: a click within a few samples of a clipped bass corner merges with it', () => {
  // measured: 16 of 20 found (clicks of 4 times the RMS, 189 ms apart, on a 55 Hz saw clipped at 0.5)
  const x = S.clip(saw(55, 4, 0), 0.5); const at = [];
  for (let k = 0; k < 20; k++) { const i = Math.round((0.2 + k * 0.1891) * 48000); at.push(i); x[i] += (k % 2 ? 1 : -1) * 4 * rmsAround(x, i); }
  const clicks = clicksOf([x]);
  const found = at.filter((i) => clicks.some((c) => Math.abs(c.seconds - i / 48000) <= 0.001)).length;
  assert.ok(found >= 14, `${found} of 20 found`); assert.equal(clicks.length, found, 'nothing else reported');
});
test('known limit: hum under a kick that has as much energy at 60 Hz is not heard', () => {
  // a 55 Hz kick peaking at 0.5 puts -33 dB in each 1 Hz bin near 60 Hz: the -27 dB hum stands 7 dB over that, not 12
  assert.equal(faultsOf([S.mix(hum60(10), G.kickAndHats(10, 0.5))], 48000).find((f) => f.kind === 'hum'), undefined);
});
test('known limit: a bass held at exactly 50 Hz for the whole sound cannot be told from hum', () => {
  assert.equal(faultsOf([S.mix(S.pink(5, -30, 2), tone(50, 5, -12))], 48000).find((f) => f.kind === 'hum').value, 50);
});
test('known limit: a real offset on noise that wanders as far is not always reported', () => {
  // 0.005 on pink at -40 dB: found for 10 of seeds 1 to 12 (seed 12 holds its sign only 88% of the time)
  assert.equal(faultsOf([S.pink(8, -40, 12).map((v) => v + 0.005)], 48000).find((f) => f.kind === 'dc'), undefined);
});
test('known limit: hum within a hertz or two of a loud held note is not heard', () => {
  // measured: 60 Hz hum under a held 61.74 or 58.27 Hz note, and 50 Hz under 49 or 51.91 Hz, is missed with
  // the note at -12 and -20 dB and found at -30 and -40 dB (the note's skirt covers the mains bin)
  const hum = (x) => faultsOf([x], 48000).some((f) => f.kind === 'hum');
  assert.equal(hum(S.mix(hum60(10), S.sine(61.74, 10, -12))), false);
  assert.equal(hum(S.mix(hum60(10), S.sine(61.74, 10, -30))), true);
});
test('known limit: a roll of 10 or more kicks a second, each leaning one way, reads as a DC offset', () => {
  // measured with a 250 ms 55 Hz kick starting on the rise: -32.5 dB at 10 a second, -30.4 at 12, -28.9 at 16; it is the
  // sound's real mean, and its trend no longer returns to zero between hits; at 8 a second it does, and no offset is read
  const dc = (rate) => faultsOf([G.kickLoop(rate, 4, { hz: 55, decayMs: 250, peak: 0.8 })], 48000).find((f) => f.kind === 'dc');
  const at10 = dc(10); assert.ok(at10 && at10.value > -36 && at10.value < -29, `10 a second: ${at10?.value}`);
  assert.equal(dc(8), undefined);
});
