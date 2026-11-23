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
