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
import { readFileSync } from 'node:fs';

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

test('a driven part is as late against its clean part at every rate as at 44.1 kHz, and the clean part (the note) never moves from 44.1 kHz up', async () => {
  const { SHAPER_4X_FRAMES, VOICED_RATE, shaperLag } = await import('../src/audio/shaperLag.ts');
  assert.equal(VOICED_RATE, 44100);
  for (const frames of [SHAPER_4X_FRAMES, 2 * SHAPER_4X_FRAMES]) {
    assert.deepEqual(shaperLag(frames, 44100), { driven: 0, clean: 0 });
    for (const rate of [8000, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000]) {
      const { driven, clean } = shaperLag(frames, rate);
      assert.ok(driven >= 0 && clean >= 0 && (driven === 0 || clean === 0), `${frames} at ${rate}`);
      // How late the driven part reaches the ear against the clean one
      assert.ok(Math.abs(frames / rate + driven - clean - frames / 44100) < 1e-12, `${frames} at ${rate}`);
      if (rate >= 44100) assert.equal(clean, 0, `${frames} at ${rate}: the note's start stays`);
    }
  }
  // 96 kHz: the 4x shaper's 2.0 ms made up to 44.1 kHz's 4.35 ms
  assert.ok(Math.abs(shaperLag(192, 96000).driven - (192 / 44100 - 0.002)) < 1e-12);
});

test('every driven part summed with a clean part of the same sound is held as at 44.1 kHz (the 808, Wobble, Growl, Reese and Slap Bass)', () => {
  const synths = source('presets/synths.ts');
  const create808 = synths.slice(synths.indexOf('export function create808'));
  assert.match(create808, /const lag = shaperLag\(SHAPER_4X_FRAMES, drive\.context\.sampleRate\);\s*extra\.push\(\.\.\.holdDriven\(drive, lag\.driven, modern \? 0 : lag\.clean\)\);/);
  // The Expressive voice's clean sub, held back below 44.1 kHz
  assert.match(create808, /if \(lag\.clean > 0\) \{\s*const late = new Tone\.Delay\(lag\.clean, lag\.clean\);\s*clean\.chain\(late, output\);/);
  // The Slap Bass's drive, so the Sub enhancer's sine under it meets it as at 44.1 kHz
  assert.match(source('presets/bass.ts'), /holdDriven\(distortion, shaperLag\(SHAPER_4X_FRAMES, distortion\.context\.sampleRate\)\.driven\)/);
  // The EDM basses: no shaper but a held one, every patch saying how late its shapers make it,
  // and the clean sub held back by the rest below 44.1 kHz
  const edm = source('presets/edmBass.ts');
  assert.doesNotMatch(edm, /createDrive\(/);
  assert.equal(edm.match(/createHeldDrive\(raw/g).length, 4);
  assert.equal(edm.match(/^ {4}driven: /gm).length, 3);
  assert.match(edm, /driven: 2 \* SHAPER_4X_FRAMES/);
  assert.match(edm, /const late = shaperLag\(patch\.driven, raw\.sampleRate\)\.clean;/);
  assert.doesNotMatch(edm, /source\.direct\?\.connect\(amp\)/);
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
