// A song sounds the same at every sample rate: live it plays at the computer's rate (often 48 kHz),
// the default export is 44.1 kHz, a WAV can be 48, 88.2 or 96 kHz and a video is 48 kHz.
// - A driven part beside a clean part of the same sound (src/audio/shaperLag.ts): the browser's
//   oversampled shaper holds its sound back a fixed number of samples, a different time at each
//   rate, so the 808 Bass was 3.4 dB louder at 96 kHz (6 dB on its attack) and Wobble Bass 2.9 dB.
//   The driven part is kept as late as at 44.1 kHz; the note's start never moves.
// - Rooms built from a seeded noise (src/audio/effects/roomIR.ts: the song's reverb, the Reverb
//   insert, a guitar's studio room, a harp's or violin's stage): made sample by sample at each
//   rate, each rate had another room (a note's body up to 6.5 dB off). Each is made at 44.1 kHz
//   (sample for sample as before) and resampled, scaled to keep its level.
// Run with `npm test`; scripts/audio-check/rates.cjs renders the same in the app.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

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

const R = await import('../src/audio/effects/roomIR.ts');

const RATES = [48000, 88200, 96000];
const source = (path) => readFileSync(new URL(`../src/audio/${path}`, import.meta.url), 'utf8');
const hash = (chs) => {
  const h = createHash('sha256');
  for (const c of chs) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
  return h.digest('hex').slice(0, 16);
};
const energy = (chs) => chs.reduce((s, c) => s + c.reduce((t, v) => t + v * v, 0), 0);

test('every shaper is as late at every rate as at 44.1 kHz: its own oversampling from 44.1 kHz up, less below (no less than its floor), and a delay line making up the rest in whole samples', async () => {
  const { SHAPER_FRAMES, VOICED_RATE, heldShaper } = await import('../src/audio/shaperLag.ts');
  assert.equal(VOICED_RATE, 44100);
  assert.deepEqual(SHAPER_FRAMES, { none: 0, '2x': 128, '4x': 192 });
  const rank = { none: 0, '2x': 1, '4x': 2 };
  for (const voiced of ['4x', '2x', 'none']) {
    for (const floor of ['none', '2x', '4x']) {
      for (const count of [1, 2, 3]) {
        // 44.1 kHz: nothing added or changed (44.1 kHz exports unchanged, sample for sample)
        assert.deepEqual(heldShaper(voiced, 44100, count, undefined, floor), { oversample: voiced, frames: 0, seconds: 0, late: 0 });
        for (const rate of [8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000]) {
          const h = heldShaper(voiced, rate, count, undefined, floor);
          const late = (count * SHAPER_FRAMES[h.oversample] + h.frames) / rate;
          const want = (count * SHAPER_FRAMES[voiced]) / 44100;
          const at = `${voiced} x${count} at ${rate}, floor ${floor}`;
          assert.ok(Number.isInteger(h.frames) && h.frames >= 0, at);
          assert.equal(h.seconds, h.frames / rate, at);
          // Never more oversampling than its own, never less than its floor (under 32 kHz, 2x), or its own if that's less
          const least = floor === 'none' && rate < 32000 ? '2x' : floor;
          assert.ok(rank[h.oversample] <= rank[voiced] && rank[h.oversample] >= Math.min(rank[voiced], rank[least]), at);
          if (rate >= 44100) {
            // Every export: its own oversampling, exactly as late as at 44.1 kHz (within half a sample)
            assert.equal(h.oversample, voiced, at);
            assert.ok(Math.abs(late - want) <= 0.5 / rate + 1e-12, `${at}: ${late * 1000} ms, not ${want * 1000}`);
            assert.equal(h.late, 0, at);
          } else if (h.late === 0) {
            // On time below 44.1 kHz: the most oversampling that's no later there
            assert.ok(Math.abs(late - want) <= 0.5 / rate + 1e-12, at);
            const more = Object.keys(rank).find((o) => rank[o] === rank[h.oversample] + 1);
            if (more && rank[more] <= rank[voiced]) assert.ok(SHAPER_FRAMES[more] > (SHAPER_FRAMES[voiced] * rate) / 44100, `${at}: could keep ${more}`);
          } else {
            // Later only where even its floor is later there: nothing held back, late by the rest
            assert.equal(rank[h.oversample], Math.min(rank[voiced], rank[least]), at);
            assert.equal(h.frames, 0, at);
            assert.ok(Math.abs(h.late - (late - want)) < 1e-12 && h.late > 0, at);
          }
        }
      }
    }
  }
  // A 4x shaper: 2.0 ms at 96 kHz made up to 44.1 kHz's 4.35 ms; at 32 kHz 2x (4.0 ms) and 11 samples
  assert.deepEqual(heldShaper('4x', 96000), { oversample: '4x', frames: 226, seconds: 226 / 96000, late: 0 });
  assert.deepEqual(heldShaper('4x', 48000), { oversample: '4x', frames: 17, seconds: 17 / 48000, late: 0 });
  assert.deepEqual(heldShaper('4x', 32000), { oversample: '2x', frames: 11, seconds: 11 / 32000, late: 0 });
  // A bass's (floor none) at 32 kHz: a 2x one goes to none, as late as at 44.1 kHz
  assert.deepEqual(heldShaper('2x', 32000, 1, undefined, 'none'), { oversample: 'none', frames: 93, seconds: 93 / 32000, late: 0 });
  // Under 32 kHz no less than 2x (none folds a sound's top back as fizz, 14 to 20 dB more on a bright bass at 22 kHz): 1.45 ms later
  for (const floor of ['2x', 'none']) {
    assert.equal(heldShaper('4x', 22050, 1, undefined, floor).oversample, '2x');
    assert.ok(Math.abs(heldShaper('4x', 22050, 1, undefined, floor).late - (128 / 22050 - 192 / 44100)) < 1e-12);
  }
  // Kept as it is (a bright Synth Designer note): 1.65 ms later at 32 kHz
  assert.ok(Math.abs(heldShaper('4x', 32000, 1, undefined, '4x').late - (192 / 32000 - 192 / 44100)) < 1e-12);
  // A guitar amp's 2x stages, voiced as late as 4x ones (64 samples each after them at 44.1 kHz, as before)
  for (const stages of [1, 2]) {
    assert.deepEqual(heldShaper('2x', 44100, stages, 192), { oversample: '2x', frames: 64 * stages, seconds: (64 * stages) / 44100, late: 0 });
    assert.deepEqual(heldShaper('2x', 96000, stages, 192).oversample, '2x');
    assert.equal(heldShaper('2x', 96000, stages, 192).frames, Math.round((stages * 192 * 96000) / 44100) - stages * 128);
    assert.equal(heldShaper('2x', 32000, stages, 192).late, 0);
  }
});

/** Every file under src/audio, by path (from src/audio). */
function audioSources() {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(`../src/audio/${dir}`, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}${e.name}/`);
      else if (e.name.endsWith('.ts')) files.push(`${dir}${e.name}`);
    }
  };
  walk('');
  return files;
}

test('every oversampled shaper in the app is held as at 44.1 kHz (or lined up some other way, said here)', () => {
  // The ones lined up otherwise: the Bass Drive insert is delay-compensated in samples (every other
  // track held back as long, delayCompensation.ts: in line at every rate); the 808 Designer starts
  // a note early by its shaper's delay at the rate it plays at (lands on the beat at every rate),
  // holding it as at 44.1 kHz only where there's no room to (below)
  const otherwise = new Set(['effects/bassDrive.ts']);
  const shaping = /createWaveShaper\(|oversample\s*[:=]\s*['"](2x|4x)['"]|oversample: OverSampleType|createDrive\(|new Tone\.Distortion\(/;
  const holding = /heldShaper\(|holdShaper\(|createHeldDrive\(|holdDriven\(/;
  const seen = [];
  for (const f of audioSources()) {
    if (f === 'shaperLag.ts' || otherwise.has(f)) continue;
    const src = source(f);
    if (!shaping.test(src)) continue;
    seen.push(f);
    assert.match(src, holding, `${f} has an oversampled shaper not held as at 44.1 kHz`);
  }
  for (const f of ['presets/synths.ts', 'presets/bass.ts', 'presets/native.ts', 'presets/designer.ts', 'presets/bass808Designer.ts', 'presets/sampleKits.ts', 'effects/lightFx.ts', 'effects/busInserts.ts', 'samplers/samplerManager.ts']) assert.ok(seen.includes(f), `${f} not checked`);
  // The Synth Designer: both shapers held, the envelopes run ahead by 44.1 kHz's seconds, not this rate's samples
  const designer = source('presets/designer.ts');
  const synths = source('presets/synths.ts');
  assert.match(designer, /const lessOf = \(o: OverSampleType\) => \(SHAPER_FRAMES\['4x'\] - SHAPER_FRAMES\[o\]\) \/ VOICED_RATE;/);
  assert.match(designer, /const warm = holdShaper\(raw, createDrive\(raw, 1\.4\), warmOversample, floor \?\? warmOversample\);/);
  assert.match(designer, /createHeldDrive\(raw, 1 \+ p\.drive \* 5, 1 \+ p\.drive \* 3, 1 \/ \(1 \+ p\.drive \* 1\.5\), driveOversample, floor \?\? driveOversample\)/);
  // ...below 44.1 kHz a bass note down to none, a higher one keeping its own and its envelopes as late as it
  assert.match(designer, /const floor = freq < FOLD_SAFE_HZ \? 'none' : null;/);
  assert.match(designer, /const early = filterEarly \+ \(p\.drive > 0 \? lessOf\(driveOversample\) : 0\) - \(driveHeld\?\.late \?\? 0\);/);
  // The basses' shapers may go down to none below 44.1 kHz; the inserts', amps' and pads' to 2x (the default)
  assert.match(synths, /heldShaper\('4x', drive\.context\.sampleRate, 1, undefined, 'none'\)/);
  assert.doesNotMatch(designer, /\.oversample = /);
  // The 808 Designer: held where a note has no room to start early
  assert.match(source('presets/bass808Designer.ts'), /shaper\(raw, [^;]*, lead === 0\)/);
  // Nothing clean is held back (no note starts at another moment at any rate): the 808's and the
  // EDM basses' clean parts play straight on
  assert.match(synths.slice(synths.indexOf('export function create808')), /extra\.push\(\.\.\.holdDriven\(drive\)\);[\s\S]*synth\.connect\(clean\);\s*clean\.connect\(output\);/);
  const edm = source('presets/edmBass.ts');
  assert.doesNotMatch(edm, /createDrive\(|driven:|fixedLate/);
  assert.equal(edm.match(/createHeldDrive\(raw, [0-9.]+, 1, 1, '4x', 'none'\)/g).length, 4);
  // The FX impact's boom (against its noise burst) and the sub drop
  const fx = source('presets/fx.ts');
  assert.doesNotMatch(fx, /createDrive\(/);
  assert.equal(fx.match(/createHeldDrive\(raw, [0-9.]+, 1, 1, '4x', 'none'\)/g).length, 2);
  assert.match(edm, /source\.direct\?\.connect\(amp\);/);
  // The guitar amps: each stage's oversampling and the delay after them from heldShaper
  const sampler = source('samplers/samplerManager.ts');
  assert.match(sampler, /heldShaper\(oversample, raw\.sampleRate, stages, SHAPER_FRAMES\['4x'\]\)/);
  assert.doesNotMatch(sampler, /SHAPER_2X_EARLIER/);
});

test('at 44.1 kHz every room is the one it was, sample for sample (44.1 kHz exports unchanged)', () => {
  assert.equal(R.ROOM_RATE, 44100);
  // Fingerprints of the rooms as made before they were made at 44.1 kHz and resampled
  const before = {
    'studio 0.45': '82bdb77d75b4b5a7',
    'hall 2.4': '7f26efbab15e9e85',
    'church 12': 'f952fa4aec8c5984',
    'plate 1.5 lows 1': 'e0d4d92a2f62a3c6',
    'insert 2.2': '877e95d4207b2ca6',
    stage: '7f204c1714516b9c',
  };
  const now = {
    'studio 0.45': hash(R.roomChannels('studio', 0.45, 44100)),
    'hall 2.4': hash(R.roomChannels('hall', 2.4, 44100)),
    'church 12': hash(R.roomChannels('church', 12, 44100)),
    'plate 1.5 lows 1': hash(R.roomChannels('plate', 1.5, 44100, 1)),
    'insert 2.2': hash(R.insertRoomChannels(2.2, 44100)),
    stage: hash(R.stageChannels(44100)),
  };
  assert.deepEqual(now, before);
});

/**
 * The level of a sound at `hz` with `room` beside it `db` under it, per ear (dB): how a note's
 * partial comes out of the direct sound plus its room.
 */
function withRoom(room, rate, hz, db) {
  const g = 10 ** (db / 20);
  let p = 0;
  for (const x of room) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * hz) / rate;
    for (let i = 0; i < x.length; i++) {
      if (x[i] === 0) continue;
      re += x[i] * Math.cos(w * i);
      im -= x[i] * Math.sin(w * i);
    }
    p += ((1 + g * re) ** 2 + (g * im) ** 2) / room.length;
  }
  return 10 * Math.log10(p);
}

test('every room is the same room at every rate: a note through it comes out as at 44.1 kHz, within 0.1 dB, from 80 Hz to 16 kHz', () => {
  // 30 frequencies, a note's partials anywhere between
  const freqs = Array.from({ length: 30 }, (_, k) => 80 * (16000 / 80) ** (k / 29) * (1 + 0.013 * Math.sin(k)));
  const rooms = [
    // A guitar's studio room (energy 1 over both sides, as samplerManager.ts gives it), 14 dB under
    ['studio room', (rate) => R.roomChannels('studio', 0.45, rate).map((c) => c.map((v) => v * Math.SQRT2)), -14],
    ['stage', (rate) => R.stageChannels(rate), -9],
    ['song reverb (hall)', (rate) => R.roomChannels('hall', 1.2, rate), -6],
    ['Reverb insert', (rate) => R.insertRoomChannels(0.8, rate), -6],
  ];
  for (const [name, at, db] of rooms) {
    const base = at(44100);
    const ref = freqs.map((hz) => withRoom(base, 44100, hz, db));
    for (const rate of [32000, ...RATES]) {
      const room = at(rate);
      let worst = 0;
      freqs.forEach((hz, i) => {
        if (hz < rate * 0.45) worst = Math.max(worst, Math.abs(withRoom(room, rate, hz, db) - ref[i]));
      });
      assert.ok(worst < 0.1, `${name} at ${rate}: ${worst.toFixed(2)} dB off`);
    }
  }
});

test('a room lasts as long and is as loud at every rate: its energy below 16 kHz is 44100/rate of the 44.1 kHz room’s (within 0.05 dB)', async () => {
  const { resampleOnce } = await import('../src/audio/loopResample.ts');
  // Energy below 16 kHz: the room taken to 32 kHz (which keeps its level)
  const below = (chs, rate) => energy(chs.map((c) => resampleOnce(c, rate, 32000)));
  const db = (x) => 10 * Math.log10(x);
  for (const [name, at, seconds] of [
    ['studio room', (rate) => R.roomChannels('studio', 0.45, rate), R.roomSeconds('studio', 0.45)],
    ['hall 2.4', (rate) => R.roomChannels('hall', 2.4, rate), R.roomSeconds('hall', 2.4)],
    ['stage', (rate) => R.stageChannels(rate), 0.9],
    ['Reverb insert 2.2', (rate) => R.insertRoomChannels(2.2, rate), R.roomSeconds(R.INSERT_ROOM, 2.2)],
  ]) {
    const ref = below(at(44100), 44100);
    if (name !== 'stage' && name !== 'Reverb insert 2.2') assert.ok(Math.abs(energy(at(44100)) - 1) < 1e-4, name);
    for (const rate of RATES) {
      const room = at(rate);
      assert.equal(room[0].length, Math.round(seconds * rate), `${name} at ${rate}: length`);
      const off = db((below(room, rate) * (rate / 44100) ** 2) / ref);
      assert.ok(Math.abs(off) < 0.05, `${name} at ${rate}: ${off.toFixed(3)} dB`);
    }
  }
  // The song's reverb, given its 44.1 kHz room's normalized level by hand away from 44.1 kHz:
  // the browser's -58 dB over the 44.1 kHz room's power per sample (its energy 1 over both sides)
  const n = Math.round(R.roomSeconds('church', 12) * 44100);
  assert.ok(Math.abs(R.normalizedLevel('church', 12) - 10 ** (-58 / 20) / Math.sqrt(1 / (2 * n))) < 1e-12);
});

test('a room made while the page plays is the same, sample for sample, and lets the page have turns', async () => {
  let turns = 0;
  let on = true;
  const tick = () => {
    turns++;
    if (on) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  let soon;
  try {
    soon = await R.roomChannelsSoon('church', 6.5, 96000);
  } finally {
    on = false;
  }
  assert.ok(turns >= 2, `${turns} turns`);
  // As roomChannels makes it: the 44.1 kHz room, resampled
  const base = R.roomChannels('church', 6.5, 44100);
  const ref = R.roomAtRate(base.map((c) => c.slice()), 96000, soon[0].length);
  assert.deepEqual(soon, ref);
  // Asked again, the one made
  assert.equal(await R.roomChannelsSoon('church', 6.5, 96000), soon);
  assert.equal(R.roomChannels('church', 6.5, 96000), soon);
  const insert = await R.insertRoomChannelsSoon(3.1, 48000);
  assert.equal(R.insertRoomChannels(3.1, 48000), insert);
});

test('resampleOnce: a sound that does not loop, at another rate, its level kept, on time, nothing wrapped round', async () => {
  const { resampleOnce } = await import('../src/audio/loopResample.ts');
  const n = 4410;
  for (const to of [32000, ...RATES]) {
    for (const hz of [100, 1000, 10000, 14000]) {
      const x = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * hz * i) / 44100));
      const y = resampleOnce(x, 44100, to);
      assert.equal(y.length, Math.round((n * to) / 44100));
      // The middle (away from the ends, where it starts and stops): the same sine at the new rate
      let err = 0;
      for (let i = Math.round(y.length * 0.25); i < y.length * 0.75; i++) err = Math.max(err, Math.abs(y[i] - Math.sin((2 * Math.PI * hz * i) / to)));
      assert.ok(err < 0.002, `${hz} Hz to ${to}: ${err}`);
    }
    // A click at 10 ms lands at 10 ms
    const click = new Float32Array(n);
    click[441] = 1;
    const y = resampleOnce(click, 44100, to);
    let at = 0;
    for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[at])) at = i;
    assert.ok(Math.abs(at - 0.01 * to) <= 0.5, `click at ${at} of ${to}`);
    // A burst at the very end: nothing of it at the start
    const end = new Float32Array(n);
    for (let i = n - 20; i < n; i++) end[i] = 1;
    const z = resampleOnce(end, 44100, to);
    assert.ok(z.slice(0, 200).every((v) => Math.abs(v) < 1e-9), `${to}: wrapped round`);
  }
  const same = new Float32Array([1, 2, 3]);
  assert.deepEqual(resampleOnce(same, 48000, 48000), same);
});

/**
 * The processor time `fn` took, in ms (user and system, from process.cpuUsage): what the work
 * costs whatever else the machine runs (npm test runs the files side by side).
 */
function cpuMs(fn) {
  const c0 = process.cpuUsage();
  fn();
  const c = process.cpuUsage(c0);
  return (c.user + c.system) / 1000;
}
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** The church as rooms were made before (one noise function call a sample): the yardstick for the time it takes. */
function oldChurch(decay, sampleRate) {
  const noise = (seed) => {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 2147483648 - 1;
    };
  };
  const room = R.ROOM_STYLES.church;
  const seconds = R.roomSeconds('church', decay);
  const n = Math.round(seconds * sampleRate);
  const room60 = seconds - room.preDelay - 0.05;
  const t60 = (k) => Math.min(decay * k, room60);
  const out = [new Float32Array(n), new Float32Array(n)];
  const cLow = 1 - Math.exp((-2 * Math.PI * 300) / sampleRate);
  const cHigh = 1 - Math.exp((-2 * Math.PI * 4000) / sampleRate);
  const fall = (t) => Math.exp(-6.908 / (t * sampleRate));
  const [fLow, fMid, fHigh] = [fall(t60(room.low)), fall(t60(1)), fall(t60(room.high))];
  const start = Math.round(room.preDelay * sampleRate);
  const build = Math.round(room.build * sampleRate);
  for (let c = 0; c < 2; c++) {
    const rnd = noise(c === 0 ? 0x1234567 : 0x7654321);
    const data = out[c];
    let [lp, lp2, eLow, eMid, eHigh] = [0, 0, 1, 1, 1];
    for (let i = start; i < n; i++) {
      const x = rnd();
      lp += cLow * (x - lp);
      lp2 += cHigh * (x - lp2);
      const k = i - start;
      const swell = k < build ? (k / build) ** 2 : 1;
      data[i] = swell * (lp * eLow * 1.6 + (lp2 - lp) * eMid + (x - lp2) * eHigh * 0.8);
      eLow *= fLow;
      eMid *= fMid;
      eHigh *= fHigh;
    }
    for (const [time, gain, side] of room.reflections) {
      const at = Math.round((room.preDelay + time) * sampleRate);
      const g = gain * (c === 0 ? 1 - side * 0.5 : 1 + side * 0.5) * 6;
      const width = Math.max(1, Math.round(0.001 * sampleRate));
      for (let j = 0; j < width && at + j < n; j++) data[at + j] += (g * (1 - j / width)) / width;
    }
  }
  const fade = Math.round(0.05 * sampleRate);
  for (const d of out) for (let k = 0; k < fade; k++) d[n - 1 - k] *= 0.5 - 0.5 * Math.cos((Math.PI * k) / fade);
  let energy = 0;
  for (const d of out) for (let i = 0; i < n; i++) energy += d[i] * d[i];
  for (const d of out) for (let i = 0; i < n; i++) d[i] /= Math.sqrt(energy);
  return out;
}

test('a room is made at 44.1 kHz in less time than before (a plain loop: no generator, no call a sample), the same room', () => {
  // (Each a decay not made before here: rooms are kept once made)
  const now = [];
  const before = [];
  for (let k = 0; k < 7; k++) {
    before.push(cpuMs(() => oldChurch(12 - k * 0.01, 44100)));
    now.push(cpuMs(() => R.roomChannels('church', 12 - k * 0.01, 44100)));
  }
  assert.ok(median(now) < median(before), `now ${median(now).toFixed(1)} ms, before ${median(before).toFixed(1)} ms`);
});

test('onceResampler: a room taken to another rate place by place, faster than sample by sample, the same however the work is split', async () => {
  const L = await import('../src/audio/loopResample.ts');
  const n = 441000;
  const make = (seed) => {
    const x = new Float32Array(n);
    let s = seed;
    for (let i = 0; i < n; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      x[i] = ((s >>> 0) / 2147483648 - 1) * Math.exp(-i / 80000);
    }
    return x;
  };
  const chs = [make(3), make(9)];
  for (const to of [32000, 48000, 88200, 96000]) {
    const whole = L.onceResampler(chs, 44100, to, undefined, 12, 44100 / to);
    whole.run(0, whole.length);
    // In pieces of any size, in order: the same, sample for sample
    const parts = L.onceResampler(chs, 44100, to, undefined, 12, 44100 / to);
    let at = 0;
    for (let k = 1; at < parts.length; k++) {
      const next = Math.min(parts.length, at + ((k * 7919) % 20011) + 1);
      parts.run(at, next);
      at = next;
    }
    assert.deepEqual(parts.outs, whole.outs, `${to}`);
    // Each sample as the kernel says (one at a time, the old way), to rounding
    const one = L.resampleOnce(chs[1], 44100, to, undefined, 12);
    let worst = 0;
    for (let i = 0; i < one.length; i += 97) worst = Math.max(worst, Math.abs(one[i] * (44100 / to) - whole.outs[1][i]));
    assert.ok(worst < 1e-6, `${to}: ${worst}`);
  }
  // Faster than working the samples out one by one, each looking its place and kernel up
  const oneByOne = (data, from, to) => {
    const step = 147;
    const exact = to === 48000 ? 160 : 320;
    const half = 12;
    const taps = 2 * half;
    const kernels = new Float64Array((exact + 1) * taps).map((_, i) => Math.sin(i) / taps);
    const length = Math.round((data.length * to) / from);
    const ring = new Float64Array(data.length + 2 * taps);
    for (let m = 0; m < data.length; m++) ring[m + half - 1] = data[m];
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const at = i * step;
      const k = Math.floor(at / exact);
      const base = (at - k * exact) * taps;
      let acc = 0;
      for (let j = 0; j < taps; j++) acc += kernels[base + j] * ring[k + j];
      out[i] = acc;
    }
    return out;
  };
  for (const to of [48000, 96000]) {
    const now = [];
    const before = [];
    for (let k = 0; k < 5; k++) {
      before.push(cpuMs(() => chs.forEach((c) => oneByOne(c, 44100, to))));
      now.push(cpuMs(() => {
        const r = L.onceResampler(chs, 44100, to, undefined, 12, 44100 / to);
        r.run(0, r.length);
      }));
    }
    assert.ok(median(now) < 0.8 * median(before), `${to}: now ${median(now).toFixed(1)} ms, before ${median(before).toFixed(1)} ms`);
  }
});

test("an export's rooms are made beforehand, a little at a time, and kept until its sound is set up, however many others are made", async () => {
  // 96 kHz: the church's longest room and the Reverb insert's are more than the rooms kept at most
  const release = await R.prepareRooms(96000, [{ style: 'church', decay: 11.95 }, { insert: 11.95 }, 'stage', { style: 'studio', decay: R.STUDIO_DECAY }]);
  const church = R.roomChannels('church', 11.95, 96000);
  const insert = R.insertRoomChannels(11.95, 96000);
  for (let k = 0; k < 3; k++) R.roomChannels('hall', 9 + k, 96000);
  assert.equal(R.roomChannels('church', 11.95, 96000), church, 'made again');
  assert.equal(R.insertRoomChannels(11.95, 96000), insert, 'made again');
  release();
  for (let k = 0; k < 3; k++) R.roomChannels('hall', 7 + k, 96000);
  assert.notEqual(R.roomChannels('church', 11.95, 96000), church, 'held on to after the export');
  // At 44.1 kHz there's nothing to make beforehand (made at once, in less time than before)
  const none = await R.prepareRooms(44100, [{ style: 'church', decay: 11.9 }]);
  none();
  assert.equal(R.roomsMaking().length, 0);
});

test('live, no room is made at once: the song reverb, a Reverb insert and the first rooms are made a little at a time, Play waits for them, and an export makes its rooms first', () => {
  const bus = source('effects/busEffects.ts');
  // The only room made at once is an export's (already made by then: prepareRooms)
  assert.equal(bus.match(/roomChannels\(/g).length, 1);
  assert.match(bus, /if \(context\.isOffline\) return playRoom\(roomChannels\(/);
  assert.match(bus, /void roomChannelsSoon\(/);
  // From the lush reverb to a room still being made: the lush plays on until it's ready
  assert.match(bus, /if \(!\(lushOn && !wantsLush\(next\) && roomComing === roomToken\)\) setLush\(wantsLush\(next\)\);/);
  const space = source('effects/spaceFx.ts');
  assert.match(space, /if \(offline\) convolver\.buffer = reverbImpulse\(raw, d\);\s*else\s*void reverbImpulseSoon\(raw, d\)/);
  // ...and its first tail comes in through a gate, not all at once
  assert.match(space, /gate\.gain\.linearRampToValueAtTime\(1, at \+ FIRST_TAIL_FADE\)/);
  assert.match(source('liveTracks.ts'), /roomsMaking\(\)\.length > 0/);
  assert.match(source('engine.ts'), /prepareFirstRooms\(liveContext\.sampleRate, defaultTrackFx\(\)\.reverb\.decay\);/);
  const exp = source('exportWav.ts');
  assert.ok(exp.indexOf('await prepareRooms(sampleRate, roomWishes(tracks, masterFx))') < exp.indexOf('graph = await withContext(context, () => buildGraph(context));'));
  // The pieces give the page its turn by a message, not a timer (which a page out of sight waits a second for)
  assert.match(source('effects/roomIR.ts'), /new MessageChannel\(\)/);
});
