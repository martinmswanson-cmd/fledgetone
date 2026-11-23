// Unit tests for the hearing sound report (src/audio/hearing/hearSound.ts) and its plain-word lines
// (words.ts): the whole report on made signals, and the words of every row on hand-made reports.
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

const { hearSound } = await import('../src/audio/hearing/hearSound.ts');
const { placeText, soundWords } = await import('../src/audio/hearing/words.ts');
const { HEARING_VERSIONS } = await import('../src/audio/hearing/types.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const hear = (ch, o = {}, sr = 48000) => hearSound(ch, sr, { engine: 'test', ...o });
/** Asserts every number anywhere in `x` is finite, naming the path of the first that is not. */
const finite = (x, path = 'report') => {
  if (typeof x === 'number') assert.ok(Number.isFinite(x), `${path} is ${x}`);
  else if (x && typeof x === 'object') for (const k of Object.keys(x)) finite(x[k], `${path}.${k}`);
};

test('the finite helper fails on a number that is not', () => {
  assert.throws(() => finite({ a: NaN }), /report\.a is NaN/);
  assert.throws(() => finite({ a: [Infinity] }), /report\.a\.0 is Infinity/);
  assert.throws(() => finite({ a: { b: -Infinity } }), /report\.a\.b is -Infinity/);
  finite({ a: [1, { b: 0 }], c: null, d: 'x' });
});

test('a stereo sound gets every group, and words that match its numbers', () => {
  const l = S.gate(S.saw(110, 8, -6), 4, -12);
  const r = hear([l, l], { tempoBpm: 120 });
  for (const g of ['tone', 'texture', 'movement', 'dynamics', 'attack', 'stereo', 'pitch']) assert.ok(r[g], g);
  assert.deepEqual(r.versions, HEARING_VERSIONS);
  assert.equal(r.along.mid.length, 8);
  assert.equal(r.along.stepSeconds, 1);
  assert.ok(r.words.some((w) => /low band .* moves at 4\.0 Hz \(1\/8 notes\)/.test(w)));
  assert.ok(r.words.some((w) => /^Nearly mono/.test(w)));
  assert.equal('shortTerm' in r.dynamics, false);
  assert.equal(r.engine, 'test');
  assert.deepEqual(r.settings, { sampleRate: 48000 });
  finite(r);
});

test('no word judges', () => {
  const r = hear([S.clip(S.saw(55, 6, 0), 0.5), S.pink(6, -12, 1)]);
  assert.ok(r.words.every((w) => !/\b(good|bad|too|should)\b/i.test(w)));
});

test('a fault is placed in words', () => {
  const x = S.mix(S.sine(110, 4, -12), S.sine(440, 4, -18));
  x[96000] += 0.5;
  const r = hear([x], { place: (s) => ({ seconds: s, bar: 9, beat: 3 }) });
  assert.ok(r.words.some((w) => /click.* at bar 9, beat 3/i.test(w)));
  assert.deepEqual(r.faults[0].at, { seconds: r.faults[0].seconds, bar: 9, beat: 3 });
});

test('a known key is kept out of the words, and the estimate stays in the report', () => {
  const l = S.saw(110, 3, -6);
  const guessed = hear([l, l]);
  const known = hear([l, l], { key: 'D minor' });
  assert.ok(guessed.pitch.key);
  assert.deepEqual(known.pitch.key, guessed.pitch.key);
  assert.equal(known.settings.knownKey, 'D minor');
  assert.ok(!known.words.some((w) => w.startsWith('Sounds in')));
});

test('a fault without a place function is placed by its seconds', () => {
  const x = S.mix(S.sine(110, 4, -12), S.sine(440, 4, -18));
  x[96000] += 0.5;
  const r = hear([x]);
  assert.deepEqual(r.faults[0].at, { seconds: r.faults[0].seconds });
  assert.ok(r.words.some((w) => /click.* at 0:02\.00\.$/i.test(w)));
});

test('a mono file has no stereo group (Review Focus 1)', () => {
  const r = hear([S.pink(4, -12, 1)]);
  assert.equal(r.stereo, undefined);
  assert.equal(r.channels, 1);
  assert.ok(r.along.side.every((row) => row.length === 0));
  finite(r);
});

test('an 80 ms hit (Review Focus 2)', () => {
  const r = hear([S.at(0.08, [[0.005, S.burst(0.07, 15, 0, -6, 1)]])]);
  assert.ok(r.attack.single);
  for (const k of ['riseMs', 'fall20Ms', 'peakDb']) assert.ok(Number.isFinite(r.attack.single[k]), k);
  assert.equal(r.tone, undefined);
  assert.equal(r.movement, undefined);
  assert.ok(r.dynamics);
  assert.equal(r.dynamics.lufs, null);
  finite(r);
});

test('silence and nothing (Review Focus 3)', () => {
  for (const ch of [[new Float32Array(48000)], [new Float32Array(0)], [], [new Float32Array(4800), new Float32Array(4800)]]) {
    const r = hear(ch);
    assert.equal(r.silent, true);
    assert.deepEqual(r.words, ['It is silent.']);
    assert.deepEqual(r.faults, []);
    assert.equal(r.tone, undefined);
    assert.equal(r.attack, undefined);
    assert.deepEqual([r.along.mid, r.along.side, r.along.lufs, r.along.chroma], [[], [], [], []]);
    finite(r);
  }
});

test('along has one row per whole or part second, in every grid', () => {
  const l = S.pink(2.5, -14, 3);
  const mono = hear([l]);
  for (const k of ['mid', 'lufs', 'chroma']) assert.equal(mono.along[k].length, 3, k);
  assert.equal(mono.along.side.length, 3);
  const st = hear([l, S.pink(2.5, -14, 4)]);
  for (const k of ['mid', 'side', 'lufs', 'chroma']) assert.equal(st.along[k].length, 3, k);
  assert.ok(st.along.side.every((row) => row.length === st.along.freqs.length));
  assert.ok(st.along.mid.every((row) => row.length === st.along.freqs.length));
  assert.ok(Number.isFinite(st.along.lufs[0]) && Number.isFinite(st.along.lufs[2]));
  const short = hear([S.pink(2.3, -14, 3)]);
  assert.equal(short.along.lufs.length, 3);
  assert.equal(short.along.lufs[2], null, 'under 0.4 s is too short to measure');
  finite(short);
  finite(st);
});

test('edge cases give a finite report', () => {
  const ten = S.sine(440, 1, -12);
  const dc = (n, v) => new Float32Array(n).fill(v);
  const spike = new Float32Array(48000);
  spike[24000] = 1;
  const square = Float32Array.from({ length: 96000 }, (_, i) => (Math.floor(i / 54) % 2 ? 0.99 : -0.99));
  const cases = {
    '0.3 s': [S.pink(0.3, -12, 1)],
    'exactly 0.4 s': [S.pink(0.4, -12, 1)],
    'DC mono': [dc(48000, 0.3)],
    'DC stereo': [dc(48000, 0.3), dc(48000, -0.3)],
    'one spike in silence': [spike],
    'one sample': [Float32Array.of(0.5)],
    'one silent channel': [ten, new Float32Array(48000)],
    'full-scale square': [square],
  };
  for (const [name, ch] of Object.entries(cases)) {
    const r = hear(ch);
    finite(r, name);
    assert.ok(r.words.length >= 0 && r.words.every((w) => typeof w === 'string' && !/NaN|Infinity|undefined/.test(w)), name);
  }
  const hi = hear([S.pink(2, -14, 7, 96000), S.pink(2, -14, 8, 96000)], {}, 96000);
  finite(hi, '96000 Hz');
  assert.ok(hi.tone);
});

test('other sample rates give every group and no band above half the rate', () => {
  for (const sr of [44100, 22050]) {
    const l = S.pink(2, -14, 5, sr);
    const r = hear([l, S.pink(2, -14, 6, sr)], {}, sr);
    for (const g of ['tone', 'texture', 'movement', 'dynamics', 'attack', 'stereo', 'pitch']) assert.ok(r[g], `${g} at ${sr}`);
    assert.equal(r.settings.sampleRate, sr);
    assert.ok(r.along.freqs.length > 0);
    assert.ok(Math.max(...r.along.freqs) <= sr / 2, 'no band above half the rate');
    assert.ok(r.along.mid.every((row) => row.length === r.along.freqs.length));
    finite(r);
  }
});

test('bad samples are measured as zeros and the input is left alone', () => {
  const x = S.sine(440, 2, -12);
  x[1000] = NaN;
  x[2000] = Infinity;
  x[3000] = -Infinity;
  const y = Float32Array.from(x);
  const r = hear([x]);
  finite(r);
  assert.ok(Number.isNaN(x[1000]) && x[2000] === Infinity && x[3000] === -Infinity, 'the caller array is unchanged');
  assert.equal(x.length, y.length);
  assert.equal(r.silent, false);
  assert.ok(r.tone);
});

test('a sound of only bad samples reads as silent', () => {
  const x = new Float32Array(48000).fill(NaN);
  const r = hear([x]);
  assert.equal(r.silent, true);
  finite(r);
});

test('place text', () => {
  // a moment in a file: minutes, seconds and hundredths, wherever one is written
  assert.equal(placeText({ seconds: 12.5 }), '0:12.50');
  assert.equal(placeText({ seconds: 3, bar: 9, beat: 3 }), 'bar 9, beat 3');
  assert.equal(placeText({ seconds: 65 }), '1:05.00');
  assert.equal(placeText({ seconds: 3 }), '0:03.00');
  assert.equal(placeText({ seconds: 720 }), '12:00.00');
  assert.equal(placeText({ seconds: 12.5, bar: 4 }), 'bar 4');
  assert.equal(placeText({ seconds: 59.97 }), '0:59.97');
  assert.equal(placeText({ seconds: 59.996 }), '1:00.00');
  assert.equal(placeText({ seconds: 26.53 }), '0:26.53');
  assert.notEqual(placeText({ seconds: 26.53 }), placeText({ seconds: 26.58 }));
});

// Words, on hand-made reports

const base = {
  versions: { ...HEARING_VERSIONS },
  engine: 'test',
  settings: { sampleRate: 48000 },
  seconds: 10,
  channels: 2,
  silent: false,
  faults: [],
  along: { stepSeconds: 1, freqs: [], mid: [], side: [], lufs: [], chroma: [] },
};
const tone = (o = {}) => ({ spectrum: { freqs: [], mid: [], side: [] }, regions: [], centreHz: 1500, tiltDbPerOctave: -2, rolloffHz: 10000, subVsBassDb: 0, peaks: [], ...o });
const texture = (o = {}) => ({ flatness: 0.1, roughness: 0.2, percussiveShare: 0.3, flatTops: null, ...o });
const dyn = (o = {}) => ({ lufs: -14, shortTermMaxLufs: -12, truePeakDbtp: -1, crestDb: 10, rangeLu: 6, ...o });
const atk = (o = {}) => ({ onsetsPerSecond: 4, riseMs: 20, single: null, ...o });
const ster = (o = {}) => ({ correlation: 0.6, balanceDb: 0, monoLossDb: -1, width: [], lowSideDb: -20, ...o });
const pit = (o = {}) => ({ tempo: null, tempoKnown: false, key: null, tuningCents: null, chroma: [], ...o });
const words = (o) => soundWords({ ...base, ...o });

test('words: a plain sound has no lines', () => {
  assert.deepEqual(words({ tone: tone(), texture: texture(), movement: { changeDb: 2, modulations: [] }, dynamics: dyn(), attack: atk(), stereo: ster(), pitch: pit() }), []);
});

test('words: a frequency rounds before it picks its unit', () => {
  const at = (hz) => words({ tone: tone({ centreHz: hz }) })[0];
  assert.equal(at(999.4), undefined, 'neither dark nor bright, no line');
  const peak = (hz) => words({ tone: tone({ peaks: [{ hz, overDb: 5 }] }) })[0];
  assert.match(peak(999.4), /at 999 Hz /);
  assert.match(peak(999.6), /at 1\.0 kHz /);
  assert.match(peak(1000), /at 1\.0 kHz /);
  assert.match(peak(1049), /at 1\.0 kHz /);
  assert.match(peak(1050), /at 1\.1 kHz /);
});

test('words: tone', () => {
  assert.deepEqual(words({ tone: tone({ centreHz: 3100 }) }), ['The spectral centre sits at 3.1 kHz: bright.']);
  assert.deepEqual(words({ tone: tone({ centreHz: 3000 }) }), []);
  assert.deepEqual(words({ tone: tone({ centreHz: 3001 }) }), ['The spectral centre sits at 3.0 kHz: bright.']);
  assert.deepEqual(words({ tone: tone({ centreHz: 650 }) }), ['The spectral centre sits at 650 Hz: dark.']);
  assert.deepEqual(words({ tone: tone({ centreHz: 700 }) }), []);
  assert.deepEqual(words({ tone: tone({ tiltDbPerOctave: 1.4 }) }), ['Its weight is toward the top (+1.4 dB an octave).']);
  assert.deepEqual(words({ tone: tone({ tiltDbPerOctave: 1 }) }), []);
  assert.deepEqual(words({ tone: tone({ tiltDbPerOctave: -3.6 }) }), ['Its weight is toward the bottom (-3.6 dB an octave).']);
  assert.deepEqual(words({ tone: tone({ tiltDbPerOctave: -3 }) }), []);
  assert.deepEqual(words({ tone: tone({ subVsBassDb: 4.2 }) }), ['Sub bass stands 4.2 dB over the bass.']);
  assert.deepEqual(words({ tone: tone({ subVsBassDb: 3 }) }), []);
  assert.deepEqual(words({ tone: tone({ subVsBassDb: -14 }) }), ['There is little sub bass (14.0 dB under the bass).']);
  assert.deepEqual(words({ tone: tone({ subVsBassDb: -12 }) }), []);
  assert.deepEqual(words({ tone: tone({ peaks: [{ hz: 3000, overDb: 11.8 }, { hz: 440, overDb: 7 }] }) }), [
    'A narrow peak at 3.0 kHz stands 11.8 dB over its surroundings (a resonance, or a held note).',
    'A narrow peak at 440 Hz stands 7.0 dB over its surroundings (a resonance, or a held note).',
  ]);
});

test('words: at most three narrow peaks, then one line for the rest', () => {
  const peaks = (n) => Array.from({ length: n }, (_, i) => ({ hz: [3000, 440, 1200, 473, 595][i], overDb: [12, 7, 9, 5, 6][i] }));
  const peakWords = (n) => words({ tone: tone({ peaks: peaks(n) }) });
  const five = peakWords(5);
  assert.deepEqual(five, [
    'A narrow peak at 3.0 kHz stands 12.0 dB over its surroundings (a resonance, or a held note).',
    'A narrow peak at 1.2 kHz stands 9.0 dB over its surroundings (a resonance, or a held note).',
    'A narrow peak at 440 Hz stands 7.0 dB over its surroundings (a resonance, or a held note).',
    '2 more narrow peaks: 595 Hz, 473 Hz.',
  ]);
  assert.deepEqual(peakWords(4).slice(3), ['1 more narrow peak: 473 Hz.']);
  assert.equal(peakWords(4).length, 4);
  assert.equal(peakWords(3).length, 3);
  assert.ok(peakWords(3).every((w) => w.startsWith('A narrow peak')));
  assert.deepEqual(peakWords(0), []);
});

test('words: a known key gives no key line, a guessed one does', () => {
  const key = { name: 'G maj', confidence: 0.9, runnerUp: 'C maj' };
  assert.deepEqual(words({ pitch: pit({ key }) }), ['Sounds in G major (or C major).']);
  assert.deepEqual(words({ pitch: pit({ key }), settings: { sampleRate: 48000, knownKey: 'D minor' } }), []);
});

test('words: texture', () => {
  assert.deepEqual(words({ texture: texture({ flatness: 0.41 }) }), ['Noisy (flatness 0.41).']);
  assert.deepEqual(words({ texture: texture({ flatness: 0.3 }) }), []);
  assert.deepEqual(words({ texture: texture({ flatness: 0.01 }) }), ['Tonal (flatness 0.01).']);
  assert.deepEqual(words({ texture: texture({ flatness: 0.02 }) }), []);
  assert.deepEqual(words({ texture: texture({ roughness: 0.52 }) }), ['Rough: fast beating inside its bands (roughness 0.52); distortion, notes close together and noise all read this way.']);
  assert.deepEqual(words({ texture: texture({ roughness: 0.48 }) }), ['Rough: fast beating inside its bands (roughness 0.48); distortion, notes close together and noise all read this way.']);
  assert.deepEqual(words({ texture: texture({ roughness: 0.2 }) }), []);
  assert.deepEqual(words({ texture: texture({ roughness: 0.35 }) }), []);
  assert.deepEqual(words({ texture: texture({ roughness: 0.03 }) }), ['Smooth (roughness 0.03).']);
  assert.deepEqual(words({ texture: texture({ roughness: 0.08 }) }), []);
  assert.deepEqual(words({ texture: texture({ percussiveShare: 0.72 }) }), ['Mostly hits (72% percussive).']);
  assert.deepEqual(words({ texture: texture({ percussiveShare: 0.6 }) }), []);
  assert.deepEqual(words({ texture: texture({ percussiveShare: 0.09 }) }), ['Mostly held sound (9% percussive).']);
  assert.deepEqual(words({ texture: texture({ percussiveShare: 0.15 }) }), []);
  assert.deepEqual(words({ texture: texture({ flatTops: { share: 0.22, levelDb: -6 } }) }), [
    'Flat-topped peaks at -6.0 dBFS on 22% of it: clipped or hard-limited before this point.',
  ]);
});

test('words: movement', () => {
  const m = (modulations, changeDb = 2) => ({ movement: { changeDb, modulations } });
  assert.deepEqual(words(m([{ band: 'low', hz: 4, depthDb: 12, note: '1/8' }])), ['The low band (40-250 Hz) moves at 4.0 Hz (1/8 notes), 12.0 dB deep.']);
  assert.deepEqual(words(m([{ band: 'high', hz: 0.5, depthDb: 3.5 }])), ['The high band (4-16 kHz) moves at 0.5 Hz, 3.5 dB deep.']);
  assert.deepEqual(words(m([{ band: 'mid', hz: 2, depthDb: 6, note: '1/4' }])), [
    'The mid band (250 Hz-4 kHz) moves at 2.0 Hz (1/4 notes), 6.0 dB deep.',
    'The mid band dips and returns on the beat (6.0 dB): sidechain pumping and parts played on the beat both read this way.',
  ]);
  assert.equal(words(m([{ band: 'mid', hz: 2, depthDb: 3, note: '1/4' }])).length, 2);
  assert.equal(words(m([{ band: 'mid', hz: 2, depthDb: 2.9, note: '1/4' }])).length, 1);
  assert.equal(words(m([{ band: 'mid', hz: 2, depthDb: 6, note: '1/8' }])).length, 1);
  assert.equal(words(m([{ band: 'low', hz: 2, depthDb: 6, note: '1/4' }])).length, 1);
  assert.deepEqual(words(m([], 0.29)), ['Static: its spectrum barely changes.']);
  assert.deepEqual(words(m([], 0.3)), []);
  assert.deepEqual(words(m([{ band: 'low', hz: 1, depthDb: 4 }], 0)).length, 1);
});

test('words: dynamics', () => {
  assert.deepEqual(words({ dynamics: dyn({ crestDb: 4.8 }) }), ['Squashed (crest 4.8 dB).']);
  assert.deepEqual(words({ dynamics: dyn({ crestDb: 6 }) }), []);
  assert.deepEqual(words({ dynamics: dyn({ crestDb: 15.2 }) }), ['Open (crest 15.2 dB).']);
  assert.deepEqual(words({ dynamics: dyn({ crestDb: 14 }) }), []);
  assert.deepEqual(words({ dynamics: dyn({ rangeLu: 1.2 }) }), ['One level throughout (range 1.2 LU).']);
  assert.deepEqual(words({ dynamics: dyn({ rangeLu: 3 }) }), []);
  assert.deepEqual(words({ dynamics: dyn({ rangeLu: 11.4 }) }), ['Wide swings in level (range 11.4 LU).']);
  assert.deepEqual(words({ dynamics: dyn({ rangeLu: 10 }) }), []);
  assert.deepEqual(words({ dynamics: dyn({ crestDb: null, rangeLu: null }) }), []);
});

test('words: attack', () => {
  assert.deepEqual(words({ attack: atk({ riseMs: 1.2 }) }), ['Sharp attacks (1.2 ms).']);
  assert.deepEqual(words({ attack: atk({ riseMs: 5 }) }), []);
  assert.deepEqual(words({ attack: atk({ riseMs: 64 }) }), ['Soft attacks (64.0 ms).']);
  assert.deepEqual(words({ attack: atk({ riseMs: 40 }) }), []);
  assert.deepEqual(words({ attack: atk({ riseMs: null }) }), []);
  assert.deepEqual(words({ attack: atk({ onsetsPerSecond: 9.5 }) }), ['Busy (9.5 onsets a second).']);
  assert.deepEqual(words({ attack: atk({ onsetsPerSecond: 8 }) }), []);
  assert.deepEqual(words({ attack: atk({ onsetsPerSecond: 0.6 }) }), ['Sparse (0.6 onsets a second).']);
  assert.deepEqual(words({ attack: atk({ onsetsPerSecond: 1 }) }), []);
  // a sound under 2 seconds is neither busy nor sparse: one hit in 80 ms is not 12.5 hits a second of anything
  assert.deepEqual(words({ seconds: 1.99, attack: atk({ onsetsPerSecond: 12.5 }) }), []);
  assert.deepEqual(words({ seconds: 1.99, attack: atk({ onsetsPerSecond: 0.5 }) }), []);
  assert.deepEqual(words({ seconds: 2, attack: atk({ onsetsPerSecond: 12.5 }) }), ['Busy (12.5 onsets a second).']);
  // a single hit has its own line, with what was measured of it
  const single = { riseMs: 1.2, fall20Ms: 64, peakDb: -6 };
  assert.deepEqual(words({ seconds: 0.08, attack: atk({ onsetsPerSecond: 12.5, riseMs: 1.2, single }) }), ['A single hit: rises in 1.2 ms, falls 20 dB in 64.0 ms, its loudest 10 ms reads -6.0 dB.']);
  assert.deepEqual(words({ seconds: 0.08, attack: atk({ onsetsPerSecond: 12.5, riseMs: 1.2, single: { ...single, fall20Ms: NaN } }) }), ['A single hit: rises in 1.2 ms, its loudest 10 ms reads -6.0 dB.']);
});

test('words: onsets heard only in the highs', () => {
  // (the reading check's busy.wav: hats on every 1/16 over a pad read 7.8 onsets a second, which no line said, and a
  // fresh reader took them for the pad's beating; the line says where they are heard)
  assert.deepEqual(words({ attack: atk({ onsetsPerSecond: 7.8, highShare: 0.75 }) }), ['75% of its onsets (7.8 a second in all) are heard only above 5 kHz: hats, shakers and other short high hits read this way.']);
  assert.deepEqual(words({ attack: atk({ onsetsPerSecond: 7.8, highShare: 0.5 }) }), ['50% of its onsets (7.8 a second in all) are heard only above 5 kHz: hats, shakers and other short high hits read this way.']);
  assert.deepEqual(words({ attack: atk({ onsetsPerSecond: 7.8, highShare: 0.49 }) }), []);
  assert.deepEqual(words({ attack: atk({ onsetsPerSecond: 9.5, highShare: 1 }) }), ['Busy (9.5 onsets a second).', '100% of its onsets (9.5 a second in all) are heard only above 5 kHz: hats, shakers and other short high hits read this way.']);
  // under one onset a second, under 2 seconds, or from a hearing saved before the share was measured: no line
  assert.deepEqual(words({ attack: atk({ onsetsPerSecond: 0.9, highShare: 1 }) }), ['Sparse (0.9 onsets a second).']);
  assert.deepEqual(words({ seconds: 1.99, attack: atk({ onsetsPerSecond: 8, highShare: 1 }) }), []);
  assert.deepEqual(words({ attack: atk({ onsetsPerSecond: 7.8 }) }), []);
});

test('an 80 ms hit reads as a single hit, not as busy', () => {
  const r = hear([S.at(0.08, [[0.005, S.burst(0.07, 15, 0, -6, 1)]])]);
  assert.ok(r.attack.single);
  assert.ok(r.words.some((w) => /^A single hit: rises in \d+\.\d ms, falls 20 dB in \d+\.\d ms, its loudest 10 ms reads -?\d+\.\d dB\.$/.test(w)), r.words.join('\n'));
  assert.ok(!r.words.some((w) => /^(Busy|Sparse|Sharp attacks|Soft attacks)/.test(w)), r.words.join('\n'));
});

test('noise gets no key and no tuning line, and uncorrelated noise is very wide, not out of phase', () => {
  for (const [name, ch] of [['white', [S.white(8, -18, 1)]], ['pink', [S.pink(8, -18, 1)]], ['white, a channel each', [S.white(4, -18, 1), S.white(4, -18, 2)]], ['pink, a channel each', [S.pink(4, -18, 3), S.pink(4, -18, 4)]]]) {
    const r = hear(ch);
    assert.ok(!r.words.some((w) => /^(Sounds in|Tuned)/.test(w)), `${name}: ${r.words.filter((w) => /^(Sounds in|Tuned)/.test(w)).join(' ')}`);
    assert.ok(!r.words.some((w) => /out of phase/.test(w)), `${name}: ${r.words.join(' | ')}`);
    if (ch.length === 2) assert.ok(r.words.some((w) => /^Very wide \(correlation -?0\.0\d\)\.$/.test(w)), `${name}: ${r.words.join(' | ')}`);
  }
  // a pitched sound still gets both
  const sharp = hear([S.saw(110 * 2 ** (30 / 1200), 4, -6)]);
  assert.ok(sharp.words.some((w) => /^Sounds in A /.test(w)), sharp.words.join('\n'));
  assert.ok(sharp.words.some((w) => /^Tuned (2\d|3\d) cents sharp of A440\.$/.test(w)), sharp.words.join('\n'));
});

test('words: the key and the tuning need a sure key and a pitched sound, and both give way to a known key', () => {
  const key = { name: 'A maj', confidence: 0.8, runnerUp: 'A min' };
  const both = ['Sounds in A major (or A minor).', 'Tuned 22 cents flat of A440.'];
  const lines = (o, settings = { sampleRate: 48000 }) => words({ settings, pitch: pit({ key, tuningCents: -22, ...o.pitch }), ...(o.flatness === undefined ? {} : { texture: texture({ flatness: o.flatness }) }) }).filter((w) => /^(Sounds in|Tuned)/.test(w));
  assert.deepEqual(lines({ flatness: 0.15 }), both);
  assert.deepEqual(lines({ flatness: 0.16 }), [], 'too noisy to have a key or a tuning');
  assert.deepEqual(lines({ flatness: 0.05, pitch: { key: { ...key, confidence: 0.49 } } }), [], 'not sure enough of the key to say its tuning either');
  assert.deepEqual(lines({ flatness: 0.05, pitch: { key: { ...key, confidence: 0.5 } } }), both);
  assert.deepEqual(lines({ flatness: 0.05 }, { sampleRate: 48000, knownKey: 'A major' }), [], 'a known key: neither is guessed');
});

test('a steady offset alone (no sound in the range heard) gets no tone or texture words, and finite numbers (M3)', () => {
  for (const [name, ch] of [['mono', [new Float32Array(96000).fill(0.25)]], ['stereo', [new Float32Array(96000).fill(0.25), new Float32Array(96000).fill(-0.25)]]]) {
    const r = hear(ch);
    finite(r, name);
    assert.ok(r.texture.flatness >= 0 && r.texture.flatness <= 1, `${name}: flatness ${r.texture.flatness}`);
    assert.ok(!r.words.some((w) => /spectral centre|Sub bass|sub bass|weight is toward|Noisy|narrow peak/.test(w)), `${name}: ${r.words.join(' | ')}`);
    assert.deepEqual([r.tone.centreHz, r.tone.subVsBassDb, r.tone.tiltDbPerOctave, r.tone.peaks], [0, 0, 0, []], name);
    assert.ok(r.words.some((w) => /^A DC offset of -12\.0 dBFS/.test(w)), r.words.join(' | '));
  }
  // flatness stays between 0 and 1 for sound that repeats exactly, and for noise
  const square = Float32Array.from({ length: 96000 }, (_, i) => (Math.floor(i / 54) % 2 ? 0.99 : -0.99));
  for (const x of [square, S.white(2, -12, 1), S.sine(1000, 2, -6)]) { const f = hear([x]).texture.flatness; assert.ok(f >= 0 && f <= 1, `flatness ${f}`); }
  // an offset under a real sound leaves the sound its words
  const under = hear([S.pink(2, -18, 1).map((v) => v + 0.25)]);
  assert.ok(under.tone.centreHz > 500 && under.words.some((w) => /^Noisy/.test(w)), under.words.join(' | '));
});

test('words: stereo', () => {
  assert.deepEqual(words({ stereo: ster({ correlation: 0.98 }) }), ['Nearly mono (correlation 0.98).']);
  assert.deepEqual(words({ stereo: ster({ correlation: 0.95 }) }), []);
  assert.deepEqual(words({ stereo: ster({ correlation: 0.21 }) }), ['Very wide (correlation 0.21).']);
  assert.deepEqual(words({ stereo: ster({ correlation: 0.3 }) }), []);
  assert.deepEqual(words({ stereo: ster({ correlation: -0.32 }) }), ['More out of phase than in (correlation -0.32).']);
  assert.deepEqual(words({ stereo: ster({ correlation: 0 }) }), ['Very wide (correlation 0.00).']);
  // uncorrelated channels wander a little either side of 0: out of phase is said from -0.1 down
  assert.deepEqual(words({ stereo: ster({ correlation: -0.02 }) }), ['Very wide (correlation -0.02).']);
  assert.deepEqual(words({ stereo: ster({ correlation: -0.1 }) }), ['Very wide (correlation -0.10).']);
  assert.deepEqual(words({ stereo: ster({ correlation: -0.11 }) }), ['More out of phase than in (correlation -0.11).']);
  assert.deepEqual(words({ stereo: ster({ monoLossDb: -4.1 }) }), ['Folding to mono loses 4.1 dB.']);
  assert.deepEqual(words({ stereo: ster({ monoLossDb: -3 }) }), []);
  assert.deepEqual(words({ stereo: ster({ lowSideDb: -8.2 }) }), ['The low end is wide (sides 8.2 dB under the middle below 120 Hz).']);
  assert.deepEqual(words({ stereo: ster({ lowSideDb: -10.5 }) }), []);
  assert.deepEqual(words({ stereo: ster({ balanceDb: 6 }) }), ['Left is 6.0 dB louder than right.']);
  assert.deepEqual(words({ stereo: ster({ balanceDb: -6 }) }), ['Right is 6.0 dB louder than left.']);
  assert.deepEqual(words({ stereo: ster({ balanceDb: 1.5 }) }), []);
  assert.deepEqual(words({ stereo: ster({ balanceDb: -1.6 }) }), ['Right is 1.6 dB louder than left.']);
});

test('words: pitch', () => {
  assert.deepEqual(words({ pitch: pit({ tempo: { bpm: 128, confidence: 0.8, alternative: 64 } }) }), ['About 128 bpm (or 64).']);
  assert.deepEqual(words({ pitch: pit({ tempo: { bpm: 128, confidence: 0.8, alternative: 128 } }) }), ['About 128 bpm.']);
  assert.deepEqual(words({ pitch: pit({ tempo: { bpm: 120, confidence: 1, alternative: 60 }, tempoKnown: true }) }), []);
  assert.deepEqual(words({ pitch: pit({ key: { name: 'C maj', confidence: 0.5, runnerUp: 'A min' } }) }), ['Sounds in C major (or A minor).']);
  assert.deepEqual(words({ pitch: pit({ key: { name: 'F# min', confidence: 0.49, runnerUp: 'A maj' } }) }), []);
  assert.deepEqual(words({ pitch: pit({ tuningCents: 23 }) }), ['Tuned 23 cents sharp of A440.']);
  assert.deepEqual(words({ pitch: pit({ tuningCents: -23 }) }), ['Tuned 23 cents flat of A440.']);
  assert.deepEqual(words({ pitch: pit({ tuningCents: 10 }) }), []);
  assert.deepEqual(words({ pitch: pit({ tuningCents: -11 }) }), ['Tuned 11 cents flat of A440.']);
});

test('words: faults come last, with a place when they have one', () => {
  const f = [
    { kind: 'click', seconds: 2, detail: 'A click', at: { seconds: 2, bar: 9, beat: 3 } },
    { kind: 'click', seconds: 12.5, detail: 'A click', at: { seconds: 12.5 } },
    { kind: 'dc', seconds: null, detail: 'A steady offset' },
  ];
  assert.deepEqual(words({ attack: atk({ riseMs: 1.2 }), faults: f }), ['Sharp attacks (1.2 ms).', 'A click at bar 9, beat 3.', 'A click at 0:12.50.', 'A steady offset.']);
});

test('words: a fault line ends with a full stop; clipping says where it first is, silence where it ends or how long it lasts', () => {
  const line = (f) => words({ faults: [f] })[0];
  assert.equal(line({ kind: 'clipping', seconds: 0, count: 11910, value: 0, detail: 'Clipping at full scale (peaks of 0.0 dBFS) in 11910 places', at: { seconds: 0 } }), 'Clipping at full scale (peaks of 0.0 dBFS) in 11910 places, first at 0:00.00.');
  assert.equal(line({ kind: 'clipping', seconds: 1, count: 1, value: 0, detail: 'Clipping at full scale (peaks of 0.0 dBFS) in 1 place', at: { seconds: 1 } }), 'Clipping at full scale (peaks of 0.0 dBFS) in 1 place, at 0:01.00.');
  assert.equal(line({ kind: 'clipping', seconds: 4, count: 30, value: -0.1, detail: 'Clipping at full scale (peaks of -0.1 dBFS) in 30 places', at: { seconds: 4, bar: 3, beat: 1 } }), 'Clipping at full scale (peaks of -0.1 dBFS) in 30 places, first at bar 3, beat 1.');
  assert.equal(line({ kind: 'silence', seconds: 1, endSeconds: 1.2, detail: 'Digital silence', at: { seconds: 1 } }), 'Digital silence from 0:01.00 to 0:01.20.');
  assert.equal(line({ kind: 'silence', seconds: 1, endSeconds: 1.2, detail: 'Digital silence', at: { seconds: 1, bar: 2, beat: 1 } }), 'Digital silence for 200 ms from bar 2, beat 1.');
  assert.equal(line({ kind: 'silence', seconds: null, count: 3, detail: '3 more stretches of digital silence' }), '3 more stretches of digital silence.');
  assert.equal(line({ kind: 'hum', seconds: null, value: 60, detail: 'Hum at 60 Hz' }), 'Hum at 60 Hz.');
});

test('faults in a real report: each detail gives its value with its unit, and each line ends with one full stop', () => {
  const l = S.mix(S.clip(S.sine(200, 6, 6), 1.0), S.sine(60, 6, -20), S.sine(120, 6, -26)).map((v) => v + 0.02);
  const r = S.gain(l, -20);
  r[3 * 48000] += 0.2; l.fill(0, 4 * 48000, 4.1 * 48000); r.fill(0, 4 * 48000, 4.1 * 48000);
  const report = hear([l, r]);
  const of = (kind) => report.faults.find((f) => f.kind === kind);
  const click = of('click');
  assert.equal(click.detail, `A click in the right channel, a jump of ${click.value.toFixed(1)} dBFS`);
  assert.match(of('clipping').detail, /^Clipping at full scale \(peaks of -?\d+\.\d dBFS\) in \d+ places$/);
  assert.equal(of('clipping').detail.includes(`${of('clipping').value.toFixed(1)} dBFS`), true);
  assert.equal(of('dc').detail, `A DC offset of ${of('dc').value.toFixed(1)} dBFS in the left channel`, 'the right, 20 dB down, has none to speak of');
  assert.equal(of('channel').detail, `The right channel is ${of('channel').value.toFixed(1)} dB under the left`);
  assert.equal(of('silence').detail, 'Digital silence');
  const lines = report.words.slice(-report.faults.length);
  assert.equal(lines.length, report.faults.length);
  for (const w of lines) assert.match(w, /[^.]\.$/, w);
  assert.ok(lines.some((w) => /^A click in the right channel, a jump of -?\d+\.\d dBFS, at 0:03\.00\.$/.test(w)), lines.join('\n'));
  assert.ok(lines.some((w) => /^Clipping at full scale \(peaks of -?\d+\.\d dBFS\) in \d+ places, first at 0:00\.0\d\.$/.test(w)), lines.join('\n'));
  assert.ok(lines.includes('Digital silence from 0:04.00 to 0:04.10.'), lines.join('\n'));
});

test('words: the order is tone, texture, movement, dynamics, attack, stereo, pitch', () => {
  const w = words({
    tone: tone({ centreHz: 4000 }),
    texture: texture({ flatness: 0.01 }), // (tonal: a noisy sound, flatness over 0.15, gets no tuning line)
    movement: { changeDb: 0, modulations: [] },
    dynamics: dyn({ crestDb: 3 }),
    attack: atk({ riseMs: 1 }),
    stereo: ster({ correlation: 0.99 }),
    pitch: pit({ tuningCents: 20 }),
  });
  assert.deepEqual(w.map((x) => x.split(' ')[0]), ['The', 'Tonal', 'Static:', 'Squashed', 'Sharp', 'Nearly', 'Tuned']);
});

test('words never judge', () => {
  const all = words({
    tone: tone({ centreHz: 4000, tiltDbPerOctave: 2, subVsBassDb: -20, peaks: [{ hz: 100, overDb: 9 }] }),
    texture: texture({ flatness: 0.01, roughness: 0.5, percussiveShare: 0.9, flatTops: { share: 0.3, levelDb: -1 } }),
    movement: { changeDb: 0, modulations: [{ band: 'mid', hz: 2, depthDb: 5, note: '1/4' }] },
    dynamics: dyn({ crestDb: 3, rangeLu: 12 }),
    attack: atk({ riseMs: 1, onsetsPerSecond: 12 }),
    stereo: ster({ correlation: -0.5, monoLossDb: -5, lowSideDb: -5, balanceDb: 3 }),
    pitch: pit({ tempo: { bpm: 100, confidence: 1, alternative: 50 }, key: { name: 'C maj', confidence: 1, runnerUp: 'A min' }, tuningCents: 30 }),
  });
  assert.ok(all.length > 15);
  assert.ok(all.some((w) => w.startsWith('Sounds in')) && all.some((w) => w.startsWith('Tuned')) && all.some((w) => w.startsWith('The mid band dips')), 'the key, tuning and beat lines are among them');
  const more = [
    ...words({ texture: texture({ flatness: 0.5 }), attack: atk({ riseMs: 1, single: { riseMs: 1, fall20Ms: 30, peakDb: -9 } }), stereo: ster({ correlation: 0.1 }) }),
    ...words({ faults: [{ kind: 'click', seconds: 1, value: -3, detail: 'A click, a jump of -3.0 dBFS', at: { seconds: 1 } }, { kind: 'silence', seconds: 1, endSeconds: 2, detail: 'Digital silence', at: { seconds: 1 } }] }),
  ];
  assert.ok(more.length >= 5);
  assert.ok([...all, ...more].every((w) => !/\b(good|bad|too|should)\b/i.test(w) && !/—/.test(w)));
});

test("a place where the musician's ruler counts otherwise names the ruler's measure and beat too", () => {
  assert.equal(placeText({ seconds: 20, bar: 9, beat: 3, ruler: { measure: 12, beat: 1 } }), 'bar 9, beat 3 (measure 12, beat 1 on the ruler)');
  assert.equal(placeText({ seconds: 20, bar: 9, beat: 3 }), 'bar 9, beat 3');
});
