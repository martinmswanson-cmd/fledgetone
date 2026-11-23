// Unit tests for the hearing report's register (src/audio/hearing/register.ts): where the pitched parts of a
// sound sit, measured on the made test signals of scripts/fixtures/hearingSignals.mjs, and its lines in
// the words (words.ts). Run with `npm test`.
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

const { registerOf } = await import('../src/audio/hearing/register.ts');
const { noteName, soundWords } = await import('../src/audio/hearing/words.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const SR = 48000;
const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);
const within = (x, lo, hi, what = '') => assert.ok(x >= lo && x <= hi, `${what} ${x} is not within ${lo} to ${hi}`);
/** The equal-tempered note `semitones` from C4. */
const fromC4 = (semitones) => 261.6256 * 2 ** (semitones / 12);
/** `x` scaled so its RMS is `rmsDb` full scale. */
const atRms = (x, rmsDb) => {
  let sum = 0;
  for (const v of x) sum += v * v;
  return S.gain(x, rmsDb - 10 * Math.log10(sum / x.length));
};

// The 8-note scale from C4 to C5, half a second a note, and the same an octave up
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12];
const scale = (octave) => S.melody(SCALE.map((s, i) => [fromC4(s + 12 * octave), i * 0.5, 0.5]), 4, -6);

// A pad of held saws C3, E3 and G3 under a lead C5, D5, E5, F5, G5 (0.8 s a note), the pad and the lead
// at the same level (the same RMS over the 4 s)
const padAndLead = (() => {
  const pad = S.mix(S.saw(fromC4(-12), 4, -6), S.saw(fromC4(-8), 4, -6), S.saw(fromC4(-5), 4, -6));
  const lead = S.melody([12, 14, 16, 17, 19].map((s, i) => [fromC4(s), i * 0.8, 0.8]), 4, -6);
  return S.mix(atRms(pad, -20), atRms(lead, -20));
})();
const padAndLeadRegister = registerOf([padAndLead], SR);

test('a melody an octave higher reads an octave higher', () => {
  const low = registerOf([scale(0)], SR);
  const high = registerOf([scale(1)], SR);
  assert.ok(low && high);
  near(Math.log2(high.centreHz / low.centreHz), 1, 0.1, 'centre, octaves apart:');
  near(Math.log2(high.topHz / low.topHz), 1, 0.1, 'top, octaves apart:');
});

test('a pad under a lead reads both', () => {
  const r = padAndLeadRegister;
  assert.ok(r);
  within(r.lowHz, 130, 165, 'lowHz');
  within(r.highHz, 700, 800, 'highHz');
  within(r.topHz, 500, 800, 'topHz');
  assert.equal(r.octaves.length, 8);
  near(r.octaves.reduce((a, b) => a + b, 0), 1, 0.001, 'the octave shares add to');
  assert.ok(r.octaves[2] > 0.2, `octave 3 holds ${r.octaves[2]}`);
  assert.ok(r.octaves[4] > 0.2, `octave 5 holds ${r.octaves[4]}`);
});

test('drums, noise and silence have no register', () => {
  assert.equal(registerOf([S.every(4, 4, () => S.burst(0.12, 40, 1, -6, 1))], SR), null, 'drums');
  assert.equal(registerOf([S.pink(4, -18, 1)], SR), null, 'pink noise');
  assert.equal(registerOf([new Float32Array(4 * SR)], SR), null, 'silence');
});

test('register does not change with level', () => {
  const loud = padAndLeadRegister;
  for (const db of [-6, -20]) {
    const quiet = registerOf([S.gain(padAndLead, db)], SR);
    assert.ok(quiet, `${db} dB`);
    for (const k of ['lowHz', 'highHz', 'centreHz', 'topHz']) assert.ok(Math.abs(quiet[k] / loud[k] - 1) <= 0.015, `${k} at ${db} dB: ${quiet[k]} against ${loud[k]}`);
    loud.octaves.forEach((share, i) => near(quiet.octaves[i], share, 0.05, `octave ${i + 1} at ${db} dB:`));
  }
});

test('register words', () => {
  const r = padAndLeadRegister;
  const base = { versions: {}, engine: 'test', settings: { sampleRate: SR }, seconds: 4, channels: 1, silent: false, faults: [] };
  const lines = soundWords({ ...base, register: r });
  const sit = lines.filter((w) => w.startsWith('Its pitched parts sit between '));
  assert.equal(sit.length, 1, lines.join(' / '));
  assert.ok(sit[0].includes(noteName(r.lowHz)) && sit[0].includes(noteName(r.highHz)), sit[0]);
  assert.ok(sit[0].includes(`centred near ${noteName(r.centreHz)}`), sit[0]);
  assert.ok(r.topHz !== null);
  assert.deepEqual(lines.filter((w) => w.startsWith('The top line')), [`The top line sits around ${noteName(r.topHz)}.`]);
  assert.ok(lines.every((w) => !/\b(good|bad|too|should)\b/i.test(w) && !w.includes('—')), lines.join(' / '));
  const without = soundWords({ ...base, register: { ...r, topHz: null } });
  assert.equal(without.filter((w) => w.startsWith('The top line')).length, 0);
  assert.equal(without.filter((w) => w.startsWith('Its pitched parts sit between ')).length, 1);
  const none = soundWords(base);
  assert.ok(!none.some((w) => w.startsWith('Its pitched parts') || w.startsWith('The top line')), none.join(' / '));
});

test('noteName', () => {
  assert.equal(noteName(440), 'A4');
  assert.equal(noteName(261.63), 'C4');
  assert.equal(noteName(277.18), 'C#4');
  assert.equal(noteName(55), 'A1');
});

// A held C4 saw, the space tests' pluck (C4 E4 G4 C5 A4 F4 D4 B3, 0.25 s every 0.75 s), and the rooms
// they go through: RT 0.3 and 1 s, wet 0.5 and 0.8, seeds 1 to 3 (12 rooms; the pluck the 6 at wet 0.8)
const heldC4 = S.saw(fromC4(0), 4, -6);
const pluck = S.melody([0, 4, 7, 12, 9, 5, 2, -1].map((s, i) => [fromC4(s), i * 0.75, 0.25]), 8, -6);
const ROOMS = [0.3, 1].flatMap((rt) => [0.5, 0.8].flatMap((wet) => [1, 2, 3].map((seed) => ({ rt, wet, seed }))));
/** Octaves from `a` to `b`. */
const octavesApart = (a, b) => Math.log2(b / a);
/** The worst shift, octaves, of each of `keys` over the rooms, from the dry reading of `x` (with `up`, the largest rise). */
const worstThroughRooms = (x, keys, up = false, rooms = ROOMS) => {
  const dry = registerOf([x], SR);
  assert.ok(dry);
  const worst = Object.fromEntries(keys.map((k) => [k, { shift: 0, room: '' }]));
  for (const { rt, wet, seed } of rooms) {
    const r = registerOf([S.reverb(x, rt, wet, seed)], SR);
    assert.ok(r, `RT ${rt} s wet ${wet} seed ${seed} reads no register`);
    for (const k of keys) {
      const shift = octavesApart(dry[k], r[k]);
      if (up ? shift > worst[k].shift : Math.abs(shift) > Math.abs(worst[k].shift)) worst[k] = { shift, room: `RT ${rt} s wet ${wet} seed ${seed}: ${dry[k]} to ${r[k]}` };
    }
  }
  return worst;
};
/** An open "ah" on `hz`: harmonics at 1/k times three resonances (730, 1090 and 2440 Hz) over a little floor, 3 s, peak -6 dB. */
const ah = (hz) => {
  const gain = (f) => 0.05 + [[730, 90, 1], [1090, 110, 0.5], [2440, 170, 0.25]].reduce((g, [c, bw, a]) => g + a / Math.sqrt(1 + ((f - c) / (bw / 2)) ** 2), 0);
  const x = S.mix(...Array.from({ length: Math.floor(8000 / hz) }, (_, i) => S.gain(S.sine((i + 1) * hz, 3, 0), 20 * Math.log10(gain((i + 1) * hz) / (i + 1)))));
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  return S.gain(x, -6 - 20 * Math.log10(peak));
};

test('a reverb does not lift a held note into its overtones', () => {
  const worst = worstThroughRooms(heldC4, ['centreHz', 'highHz', 'topHz']);
  for (const [k, w] of Object.entries(worst)) assert.ok(Math.abs(w.shift) < 0.25, `${k} moves ${w.shift.toFixed(2)} octaves (${w.room})`);
});

test('a reverb does not lift a plucked melody\'s high or top line', () => {
  const worst = worstThroughRooms(pluck, ['centreHz', 'highHz', 'topHz'], true, ROOMS.filter((room) => room.wet === 0.8));
  for (const [k, w] of Object.entries(worst)) assert.ok(w.shift < 0.25, `${k} rises ${w.shift.toFixed(2)} octaves (${w.room})`);
});

test('a note an octave or a twelfth over another still reads as a part', () => {
  const saws = new Map([-12, 0, 7, 12].map((s) => [s, S.saw(fromC4(s), 4, -6)]));
  const pair = (low, high, db = 0) => S.mix(saws.get(low), S.gain(saws.get(high), db));
  const equal = registerOf([pair(0, 12)], SR);
  near(equal.lowHz, fromC4(0), 0.03 * fromC4(0), 'C4+C5 lowHz');
  near(equal.highHz, fromC4(12), 0.03 * fromC4(12), 'C4+C5 highHz');
  near(registerOf([pair(0, 12, -6)], SR).highHz, fromC4(12), 0.03 * fromC4(12), 'C4 with C5 6 dB under it, highHz');
  near(registerOf([pair(-12, 7)], SR).highHz, fromC4(7), 0.03 * fromC4(7), 'C3+G4 highHz');
  near(registerOf([S.reverb(pair(0, 12), 1, 0.5, 1)], SR).highHz, fromC4(12), 0.03 * fromC4(12), 'C4+C5 through a room, highHz');
});

test('a vowel\'s formant is not read as a part', () => {
  const r = registerOf([ah(220)], SR);
  assert.ok(r);
  for (const k of ['highHz', 'topHz']) assert.ok(Math.abs(12 * octavesApart(220, r[k])) <= 1, `${k} ${r[k]} is not within a semitone of A3`);
});

/** An additive tone on `hz`, 5 ms edges: harmonic k (up to 20 kHz) at amplitude amp(k), each from a phase drawn from `seed` (0: all from sine phase). */
const tone = (hz, seconds, amp, seed = 0) => {
  let state = seed >>> 0;
  const draw = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  for (let k = 1; k * hz < 20000; k++) {
    const a = amp(k);
    const phase = seed ? 2 * Math.PI * draw() : 0;
    if (!a) continue;
    const w = (2 * Math.PI * k * hz) / SR;
    for (let i = 0; i < n; i++) x[i] += a * Math.sin(w * i + phase);
  }
  const edge = Math.round(0.005 * SR);
  for (let i = 0; i < Math.min(edge, n); i++) {
    x[i] *= i / edge;
    x[n - 1 - i] *= i / edge;
  }
  return x;
};
const sawAmp = (k) => 1 / k;
const triangleAmp = (k) => (k % 2 ? 1 / (k * k) : 0);

test('a root, its fifth and its octave read centred on the fifth, the octave not folded into the root', () => {
  for (const [name, root] of [['C3 G3 C4', -12], ['E2 B2 E3', -20]]) {
    const fifth = fromC4(root + 7);
    // Equal saws, the octave starting half a millisecond late
    const late = S.at(3.5, [[0, S.saw(fromC4(root), 3, -12)], [0, S.saw(fifth, 3, -12)], [0.0005, S.saw(fromC4(root + 12), 3, -12)]]);
    near(registerOf([late], SR).centreHz, fifth, 0.03 * fifth, `${name}, the octave 0.5 ms late: centreHz`);
    // Equal saws whose harmonics start from random phases
    for (const seed of [1, 2, 3]) {
      const x = S.at(3.5, [0, 7, 12].map((s, j) => [0, tone(fromC4(root + s), 3, sawAmp, 10 * seed + j + 1)]));
      near(registerOf([x], SR).centreHz, fifth, 0.03 * fifth, `${name}, harmonic phases from seed ${seed}: centreHz`);
    }
  }
});

test('a melody of odd harmonics on a drone\'s overtones reads as a part', () => {
  // A held C3 saw drone; over it a held G4 (its 3rd harmonic), and a melody G4 C5 E5 G5 E5 C5 G4 C5 (0.5 s a note), triangles, 6 dB under, level with and 6 dB over it (RMS)
  const drone = atRms(tone(fromC4(-12), 4, sawAmp), -20);
  const g4 = tone(fromC4(7), 4, triangleAmp);
  const melody = S.at(4, [7, 12, 16, 19, 16, 12, 7, 12].map((s, i) => [0.5 * i, tone(fromC4(s), 0.5, triangleAmp)]));
  for (const db of [-6, 0, 6]) {
    const held = registerOf([S.mix(drone, atRms(g4, -20 + db))], SR);
    near(held.highHz, fromC4(7), 0.03 * fromC4(7), `held G4 at ${db} dB: highHz`);
    near(held.topHz, fromC4(7), 0.03 * fromC4(7), `held G4 at ${db} dB: topHz`);
    near(registerOf([S.mix(drone, atRms(melody, -20 + db))], SR).topHz, fromC4(12), 0.03 * fromC4(12), `the melody at ${db} dB: topHz`);
  }
});
