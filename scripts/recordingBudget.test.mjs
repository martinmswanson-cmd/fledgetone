// Unit tests for keeping the recorded instruments' memory in check (src/audio/samplers/setSizes.ts,
// songSamples.ts) and evening out recordings made at uneven levels (setLevels.ts). Run with `npm test`.
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

const { INSTRUMENTS } = await import('../src/audio/instrumentCatalog.ts');
const { HOSTED_SETS } = await import('../src/audio/hostedSets.ts');
const { setBytes, decodedBytes, fileBytesOf, setDecodedBytes } = await import('../src/audio/samplers/setSizes.ts');
const { RING_MOST } = await import('../src/audio/samplers/recordingMaths.ts');
const { SET_LEVELS, evenLevels, EVEN_MOST_DB } = await import('../src/audio/samplers/setLevels.ts');
const { indexRecordings, quickSamples, SPARSE_QUICK, STRETCH_SEMITONES, chooseExportDecodes, lowMemoryDevice } = await import('../src/audio/samplers/songSamples.ts');

/** The big sets, as samplerManager.ts's BIG_SET_DECODED has them */
const BIG = 160e6;

test("a set's size: a hosted set's files, an ensemble's parts, nothing for one not hosted", () => {
  const grand = INSTRUMENTS.piano.samples;
  assert.ok(Math.abs(setBytes(grand) - HOSTED_SETS['grand-piano'].bytes) < 1e3);
  // The string ensemble plays three sets' files: more than any one of them, less than all three
  const strings = setBytes(INSTRUMENTS.realStrings.samples);
  const parts = ['cello-sustain', 'violas-sustain', 'violins-sustain'].map((f) => HOSTED_SETS[f].bytes);
  assert.ok(strings > Math.max(...parts) && strings < parts.reduce((a, b) => a + b));
  // A soundfont: not hosted
  assert.equal(setBytes(INSTRUMENTS.violin.samples), 0);
  assert.ok(fileBytesOf(INSTRUMENTS.violin.samples, Object.keys(INSTRUMENTS.violin.samples.samples)[0]) > 0);
});

test('the big sets are the pianos and a few others, the Grand Piano among them', () => {
  const big = Object.values(INSTRUMENTS).filter((d) => d.samples && setDecodedBytes(d.samples) > BIG).map((d) => d.key);
  for (const key of ['piano', 'realGrandPiano', 'realDoubleBass', 'realTenorSax', 'realTremolo']) assert.ok(big.includes(key), key);
  for (const key of ['realClarinet', 'realHarpsichord', 'studioKit', 'realFolkHarp']) assert.ok(!big.includes(key), key);
});

test("a set's decoded size is estimated on the safe side (the grand piano measured 1.45 GB whole at 48 kHz)", () => {
  const s = INSTRUMENTS.piano.samples;
  const notes = Object.keys(s.samples);
  const whole = decodedBytes(s, notes, 48000);
  assert.ok(whole >= 1.45e9 && whole < 2e9, String(whole));
  assert.ok(Math.abs(decodedBytes(s, notes, 96000) - 2 * whole) < 1);
});

test("a soundfont's note is reckoned at the length it's rung on or held to as it loads, in stereo (struck ones were 3.1 s, now up to 10)", () => {
  for (const key of ['timpani', 'celesta', 'violin', 'choir']) {
    const s = INSTRUMENTS[key].samples;
    assert.ok(s.ringOn || s.sustain, key);
    const one = decodedBytes(s, [Object.keys(s.samples)[0]], 48000);
    assert.ok(one >= Math.max(RING_MOST, s.sustain?.hold ?? 0) * 48000 * 4 * 2, `${key}: ${one}`);
  }
  // A recording that isn't lengthened keeps the old estimate
  const harp = INSTRUMENTS.harp.samples;
  assert.ok(!harp.ringOn && !harp.sustain);
  assert.equal(decodedBytes(harp, [Object.keys(harp.samples)[0]], 48000), 60e3 * 48);
});

test("a big set's first recordings: a few, every note within stretching distance of one", () => {
  const s = INSTRUMENTS.piano.samples;
  const index = indexRecordings(Object.keys(s.samples), (n) => midiOf(n), s.layers);
  const all = quickSamples(index);
  const few = quickSamples(index, SPARSE_QUICK);
  assert.ok(few.size <= 18 && few.size < all.size / 3, String(few.size));
  const have = [...few].map((n) => midiOf(n.split('|')[0]));
  for (let m = 21; m <= 108; m++) assert.ok(have.some((h) => Math.abs(h - m) <= STRETCH_SEMITONES), `note ${m}`);
  assert.equal(quickSamples(index, 0).size, all.size);
});

test('an export decodes the cheapest instruments at twice the rate, then at the rate, then not at all, within its budget', () => {
  const plan = chooseExportDecodes([['piano', 900], ['flute', 100], ['kit', 50]], 600);
  // kit 2 x 50 = 100, flute 2 x 100 = 200 (300 spent), the piano doesn't fit even once
  assert.deepEqual([...plan].sort(), [['flute', 2], ['kit', 2], ['piano', 0]]);
  assert.equal(chooseExportDecodes([['piano', 400]], 600).get('piano'), 1);
  assert.equal(chooseExportDecodes([['piano', 250]], 600).get('piano'), 2);
  // A render the app plays itself: never twice
  assert.equal(chooseExportDecodes([['flute', 10]], 600, 1).get('flute'), 1);
});

test('a device has little memory at 4 GB or less, or where the browser never says (Safari, Firefox, phones and tablets)', () => {
  assert.equal(lowMemoryDevice({ deviceMemory: 4 }), true);
  assert.equal(lowMemoryDevice({ deviceMemory: 8, maxTouchPoints: 5 }), false);
  const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const firefox = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
  assert.equal(lowMemoryDevice({ userAgent: safari, maxTouchPoints: 0 }), true);
  assert.equal(lowMemoryDevice({ userAgent: iphone, maxTouchPoints: 5 }), true);
  assert.equal(lowMemoryDevice({ userAgent: firefox, maxTouchPoints: 0 }), true);
  // (Chromium leaves it out only on a page that isn't secure)
  assert.equal(lowMemoryDevice({ userAgent: chrome, maxTouchPoints: 0 }), false);
});

test("the grand piano's recordings are evened out: neighbouring notes within 1.5 dB at every loudness, its keyboard's shape kept", () => {
  const { levels } = SET_LEVELS['grand-piano'];
  const gains = evenLevels(levels);
  const rows = new Map();
  for (const [key, db] of Object.entries(levels)) {
    const [m, l, t] = key.split('_').map(Number);
    const row = `${l}_${t}`;
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push([m, db + gains[key], db]);
  }
  let worstBefore = 0;
  for (const points of rows.values()) {
    points.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < points.length; i++) {
      assert.ok(Math.abs(points[i][1] - points[i - 1][1]) <= 1.5, `${points[i][0]}: ${points[i][1] - points[i - 1][1]}`);
      worstBefore = Math.max(worstBefore, Math.abs(points[i][2] - points[i - 1][2]));
    }
    // The top octaves stay quieter than the middle, as a piano is
    const at = (lo, hi) => points.filter(([m]) => m >= lo && m <= hi).reduce((s, p, _, a) => s + p[1] / a.length, 0);
    assert.ok(at(96, 108) < at(55, 72) - 3);
  }
  assert.ok(worstBefore > 6, 'the measured levels jump (they were uneven)');
  for (const g of Object.values(gains)) assert.ok(Math.abs(g) <= EVEN_MOST_DB);
});

test('the Grand Piano and the Concert Grand load evened out and retuned (the set is about 4 cents sharp)', () => {
  const { cents } = SET_LEVELS['grand-piano'];
  assert.ok(cents > 2 && cents < 6, String(cents));
  for (const key of ['piano', 'realGrandPiano']) {
    const s = INSTRUMENTS[key].samples;
    const names = Object.keys(s.samples);
    assert.ok(names.every((n) => s.tune[n] === -cents), key);
    assert.ok(names.filter((n) => s.gains[n]).length > names.length / 2, key);
  }
});

const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midiOf(note) {
  const m = /^([A-G])(#?)(-?\d+)$/.exec(note);
  return 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] ? 1 : 0);
}
