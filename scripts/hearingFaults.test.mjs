// Unit tests for the hearing report's faults (src/audio/hearing/faults.ts): clicks, clipping, DC, hum,
// digital silence and a missing channel, measured on the made test signals of
// scripts/fixtures/hearingSignals.mjs. Healthy sound of every kind the app makes must read no fault.
// Run with `npm test`.
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

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

const bed = (sec) => S.mix(S.sine(110, sec, -12), S.sine(440, sec, -18), S.band(S.pink(sec, -30, 3), 100, 4000));
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
  for (const x of [bed(4), S.white(10, -12, 1), drums, S.clip(S.saw(55, 4, 0), 0.5), S.gate(S.saw(110, 4, -6), 8, -60)])
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
  const hz = [25, 27.5, 30, 35.4, 41.2, 50, 55, 61.74, 70.7, 100, 110, 141, 200, 283, 400, 566, 800, 1131, 1600, 2000];
  for (const f of hz) {
    const saw = S.saw(f, 1, 0);
    noClicks(saw, `saw ${f} Hz`);
    noClicks(S.clip(saw, 0.5), `saw ${f} Hz clipped at 0.5`);
    noClicks(S.clip(saw, 0.25), `saw ${f} Hz clipped at 0.25`);
  }
});
test('no clicks in wobble and tremolo basses, plain or clipped', () => {
  for (const [hz, rate] of [[55, 2], [41.2, 4], [73.4, 8], [55, 1.5]]) {
    const w = S.wobble(hz, 80, 3000, rate, 4, -3);
    noClicks(w, `wobble ${hz} Hz at ${rate} Hz`);
    noClicks(S.clip(S.gain(w, 12), 0.7), `clipped wobble ${hz} Hz at ${rate} Hz`);
  }
  for (const [hz, rate] of [[55, 4], [41.2, 2], [110, 8]]) {
    noClicks(S.tremolo(S.saw(hz, 4, -3), rate, 1), `tremolo saw ${hz} Hz at ${rate} Hz`);
    noClicks(S.tremolo(S.clip(S.saw(hz, 4, 0), 0.5), rate, 1), `tremolo clipped saw ${hz} Hz at ${rate} Hz`);
  }
});
test('no clicks in kick and hats over a clipped saw bass', () => {
  const kicks = S.every(2, 4, () => S.decay(S.sine(55, 0.45, -3), 40));
  const hats = S.every(8, 4, (i) => S.burst(0.05, 8, 0, -14, i + 1));
  noClicks(S.mix(kicks, hats, S.clip(S.saw(41.2, 4, -3), 0.35)), 'kick, hats and bass');
  noClicks(S.mix(kicks, hats, S.clip(S.saw(55, 4, 0), 0.25)), 'kick, hats and a harder bass');
  noClicks(S.mix(kicks, hats), 'kick and hats alone');
});
test('no clicks in a square wave at 110 Hz', () => {
  const naive = Float32Array.from({ length: 4 * 48000 }, (_, i) => ((i * 110) / 48000) % 1 < 0.5 ? 0.5 : -0.5);
  const limited = S.mix(...[1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29].map((k) => S.gain(S.sine(110 * k, 4, -6), -20 * Math.log10(k))));
  noClicks(naive, 'a square'); noClicks(limited, 'a band-limited square');
});
test('no clicks in white and pink noise, quiet to loud', () => {
  for (const db of [-6, -18, -40])
    for (let seed = 1; seed <= 8; seed++) {
      noClicks(S.white(30, db, seed), `white ${db} dB seed ${seed}`);
      noClicks(S.pink(30, db, seed), `pink ${db} dB seed ${seed}`);
    }
});
test('the file edges are not clicks', () => {
  const cosine = Float32Array.from({ length: 2 * 48000 }, (_, i) => 0.5 * Math.cos((2 * Math.PI * 440 * i) / 48000));
  noClicks(cosine, 'a sound at full level on its first sample');
  noClicks(cosine.reverse(), 'a sound at full level on its last sample');
  noClicks(S.clip(S.saw(55, 2, 0), 0.5).subarray(1234, 80000), 'a clipped saw cut at both ends');
  noClicks(S.white(2, -12, 3), 'noise from the first sample to the last');
});
test('a note cut off cleanly at a zero crossing is not a click', () => {
  noClicks(S.at(2, [[0.5, S.sine(440, 1, -6)]]), '440 Hz, whole cycles');
  noClicks(S.at(2, [[0.5, S.sine(110, 1, -6)]]), '110 Hz, whole cycles');
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
  const x = S.clip(S.saw(55, 4, 0), 0.5);
  for (const t of [1.2051, 2.3333, 3.1]) {
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
  const x = bed(4);
  for (let k = 0; k < 25; k++) { const i = Math.round((0.2 + k * 0.13) * 48000); x[i] += 4 * rmsAround(x, i); }
  const clicks = clicksOf([x]);
  assert.equal(clicks.length, 21);
  assert.deepEqual([clicks[20].seconds, clicks[20].count], [null, 5]);
  near(clicks[19].seconds, 0.2 + 19 * 0.13, 0.001);
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
    assert.match(x.detail, /^[A-Z0-9][^.]*$/, x.detail);
    assert.doesNotMatch(x.detail, /\b(good|bad|too|should)\b|second|\d ?s\b/i, x.detail);
  }
  const channel = f.find((x) => x.kind === 'channel'); assert.equal(channel.channel, 'right'); near(channel.value, 20, 0.5);
});
test('a kick pattern is not a DC offset; a quiet offset under -50 dBFS is not either', () => {
  const kicks = S.every(2, 6, () => S.decay(S.sine(55, 0.45, 0), 60));
  assert.equal(faultsOf([kicks], 48000).find((f) => f.kind === 'dc'), undefined);
  assert.equal(faultsOf([bed(2).map((v) => v + 0.002)], 48000).find((f) => f.kind === 'dc'), undefined);
});
test('a held bass and a wobble are not hum; hum at 50 Hz is', () => {
  for (const x of [S.mix(S.pink(10, -24, 2), S.saw(61.74, 10, -6)), S.mix(S.pink(10, -24, 2), S.wobble(49, 80, 1500, 2, 10, -6)), S.clip(S.saw(55, 10, 0), 0.5)])
    assert.equal(faultsOf([x], 48000).find((f) => f.kind === 'hum'), undefined);
  const hum = S.mix(S.pink(8, -18, 4), S.sine(50, 8, -24), S.sine(150, 8, -30));
  const f = faultsOf([hum], 48000).find((x) => x.kind === 'hum'); assert.equal(f.value, 50); assert.equal(f.seconds, null);
  assert.equal(faultsOf([S.mix(S.pink(3, -18, 4), S.sine(50, 3, -24), S.sine(150, 3, -30))], 48000).find((x) => x.kind === 'hum'), undefined);
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
});
