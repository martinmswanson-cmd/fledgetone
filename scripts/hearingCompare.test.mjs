// Unit tests for comparing two sound reports and taking a stretch of a saved one
// (src/audio/hearing/compareSound.ts), on made signals. Run with `npm test`.
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
const { compareSound, stretchOf } = await import('../src/audio/hearing/compareSound.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);
/** Asserts every number anywhere in `x` is finite, naming the path of the first that is not. */
const finite = (x, path = 'x') => {
  if (typeof x === 'number') assert.ok(Number.isFinite(x), `${path} is ${x}`);
  else if (x && typeof x === 'object') for (const k of Object.keys(x)) finite(x[k], `${path}.${k}`);
};
const hear = (ch, sr = 48000) => hearSound(ch, sr, { engine: 'test' });

test('the finite helper fails on a number that is not', () => {
  assert.throws(() => finite({ a: [NaN] }), /x\.a\.0 is NaN/);
  finite({ a: [1, { b: 0 }], c: null });
});

test('the same sound has no differences', () => {
  const r = hear([S.pink(6, -18, 1)]);
  assert.deepEqual(compareSound(r, r).differences, []);
});

test('louder only: loudness differs, tone does not', () => {
  const c = compareSound(hear([S.pink(6, -24, 1)]), hear([S.pink(6, -18, 1)]));
  near(c.levelDb, 6, 0.2);
  assert.deepEqual(c.differences.map((d) => d.measure), ['loudness']);
  assert.ok(c.spectrum.changeDb.every((v) => Math.abs(v) < 0.5));
  assert.equal(c.notes[0], 'Read as the second against the first.');
  finite(c);
});

test('brighter: tone leads the list', () => {
  const dull = S.pink(6, -18, 1);
  const bright = S.mix(dull, S.band(S.pink(6, -18, 2), 5000, 16000));
  const c = compareSound(hear([dull]), hear([bright]));
  assert.equal(c.differences[0].group, 'tone');
  assert.ok(c.differences.some((d) => d.measure === 'centre' && d.change > 0));
  finite(c);
});

test('grittier: roughness shows', () => {
  const c = compareSound(hear([S.sine(55, 6, -6)]), hear([S.saw(55, 6, -6)]));
  assert.ok(c.differences.some((d) => d.measure === 'roughness' && d.change > 0));
});

test('a group measured by another version is skipped, and said', () => {
  const a = hear([S.pink(6, -18, 1)]);
  const old = { ...a, versions: { ...a.versions, texture: 0 } };
  const c = compareSound(old, a);
  assert.deepEqual(c.skipped, ['texture']);
  assert.ok(c.notes.some((n) => /texture can't be compared: one of these was measured by an older version/.test(n)));
});

test('unequal lengths are said first of the cautions', () => {
  const c = compareSound(hear([S.pink(4, -18, 1)]), hear([S.pink(20, -18, 1)]));
  assert.match(c.notes[1], /different lengths \(0:04 against 0:20\)/);
});

test('a stretch of a saved report', () => {
  const x = S.at(20, [[0, S.band(S.pink(10, -18, 1), 40, 400)], [10, S.band(S.pink(10, -18, 2), 2000, 12000)]]);
  const saved = JSON.parse(JSON.stringify(hear([x])));
  const low = stretchOf(saved, 0, 10), high = stretchOf(saved, 10, 20);
  assert.ok(high.tone.centreHz > 4 * low.tone.centreHz);
  assert.equal(low.texture, undefined);
  assert.equal(low.settings.stretch.fromSaved, true);
  assert.deepEqual(low.peaks ?? low.tone.peaks, []);
  assert.deepEqual(low.versions, saved.versions);
  assert.ok(compareSound(low, high).notes.some((n) => /saved measurements of a stretch/.test(n)));
  assert.throws(() => stretchOf(saved, 30, 40), RangeError);
  assert.throws(() => stretchOf(saved, 30, 40), /that stretch holds nothing/);
  finite(low);
  finite(compareSound(low, high));
});

test('a stretch of a mono report has no stereo; of a stereo one, width and low side only', () => {
  const mono = hear([S.pink(6, -18, 1)]);
  assert.equal(stretchOf(mono, 0, 3).stereo, undefined);
  const st = hear([S.pink(6, -18, 1), S.pink(6, -18, 2)]);
  const s = stretchOf(st, 2, 4);
  assert.equal(s.stereo.width.length, st.stereo.width.length);
  assert.equal(typeof s.stereo.lowSideDb, 'number');
  assert.equal(s.stereo.correlation, undefined);
  finite(s);
});

test('a stretch takes the rows that start inside the range', () => {
  const r = hear([S.pink(6, -18, 1)]);
  const a = stretchOf(r, 1, 3);
  assert.equal(a.along.mid.length, 2);
  assert.equal(stretchOf(r, 4.5, 100).along.mid.length, 1);
  assert.throws(() => stretchOf(r, 2, 2), RangeError);
});

test('a stretch of a whole sound reads like the whole sound when it covers it all', () => {
  const r = hear([S.pink(6, -18, 1)]);
  const s = stretchOf(r, 0, 6);
  near(s.dynamics.lufs, r.dynamics.lufs, 0.3);
  near(s.tone.centreHz, r.tone.centreHz, r.tone.centreHz * 0.2);
  for (const reg of r.tone.regions) near(s.tone.regions.find((x) => x.name === reg.name).db, reg.db, 0.6, reg.name);
});

test('comparing the other way round negates each change and keeps its size', () => {
  const dull = S.pink(6, -18, 1);
  const bright = S.mix(S.gain(dull, 3), S.band(S.pink(6, -18, 2), 5000, 16000));
  const a = hear([dull, dull]), b = hear([bright, S.gain(bright, -6)]);
  const ab = compareSound(a, b), ba = compareSound(b, a);
  assert.ok(ab.differences.length > 2);
  assert.deepEqual(ba.differences.map((d) => d.measure), ab.differences.map((d) => d.measure));
  ab.differences.forEach((d, i) => {
    const e = ba.differences[i];
    assert.equal(e.change, d.change === 0 ? 0 : -d.change, d.measure);
    assert.equal(e.size, d.size, d.measure);
    assert.equal(e.a, d.b);
    assert.equal(e.b, d.a);
  });
  assert.equal(ba.levelDb, -ab.levelDb);
  finite(ab);
});

test('reports of different sample rates compare on the frequencies both have', () => {
  const a = hear([S.pink(5, -18, 1, 22050)], 22050), b = hear([S.pink(5, -18, 1)]);
  const c = compareSound(a, b);
  assert.ok(c.spectrum.freqs.length > 10);
  assert.ok(c.spectrum.freqs.length < b.tone.spectrum.freqs.length);
  assert.equal(c.spectrum.freqs.length, c.spectrum.changeDb.length);
  assert.ok(Math.max(...c.spectrum.freqs) <= 11025);
  finite(c);
  finite(compareSound(b, a));
});

test('mono against stereo: stereo is skipped, and said', () => {
  const m = hear([S.pink(6, -18, 1)]), s = hear([S.pink(6, -18, 1), S.pink(6, -18, 2)]);
  const c = compareSound(m, s);
  assert.deepEqual(c.skipped, ['stereo']);
  assert.ok(c.notes.some((n) => /stereo can't be compared: only one of these has it\./.test(n)));
  finite(c);
});

test('a short sound against a full one: the groups it lacks are skipped', () => {
  const short = hear([S.pink(0.3, -18, 1)]), full = hear([S.pink(6, -18, 1)]);
  const c = compareSound(short, full);
  for (const g of ['tone', 'texture', 'movement']) assert.ok(c.skipped.includes(g), g);
  assert.ok(!c.skipped.includes('dynamics'));
  assert.ok(c.notes.some((n) => /tone can't be compared: only one of these has it\./.test(n)));
  assert.deepEqual(c.spectrum, { freqs: [], changeDb: [] });
  finite(c);
});

test('a silent one has no differences, and says so', () => {
  const c = compareSound(hear([new Float32Array(48000 * 2)]), hear([S.pink(6, -18, 1)]));
  assert.deepEqual(c.differences, []);
  assert.ok(c.notes.includes('One of these is silent.'));
  assert.equal(c.levelDb, null);
  finite(c);
});

test('none against busy onsets is a large difference; none against none is none', () => {
  const none = hear([S.sine(220, 4, -12)]);
  const busy = hear([S.every(8, 4, () => S.burst(0.1, 20, 1, -6, 1))]);
  const c = compareSound(none, busy);
  const d = c.differences.find((x) => x.measure === 'onsets a second');
  assert.ok(d && d.change > 1);
  assert.equal(compareSound(none, none).differences.find((x) => x.measure === 'onsets a second'), undefined);
  finite(c);
});

test('the words say it plainly and never judge', () => {
  const dull = S.pink(6, -18, 1);
  const c = compareSound(hear([dull]), hear([S.mix(S.gain(dull, 6), S.band(S.pink(6, -18, 2), 5000, 16000))]), { a: 'the demo', b: 'the master' });
  assert.equal(c.notes[0], 'Read as the master against the demo.');
  const loud = c.differences.find((d) => d.measure === 'loudness');
  assert.match(loud.words, /^Loudness: -?\d+\.\d LUFS against -?\d+\.\d LUFS \(\+\d+\.\d LU\)\.$/);
  for (const d of c.differences) {
    assert.ok(!/\b(good|bad|too|should|better|worse)\b/i.test(d.words), d.words);
    assert.ok(/^[A-Z]/.test(d.words), d.words);
  }
  assert.ok(c.differences.every((d, i, l) => i === 0 || l[i - 1].size >= d.size));
});
