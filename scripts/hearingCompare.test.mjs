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
const heard = new WeakMap();
/** The report of `ch`, measured once for each array of samples. */
const hear = (ch, sr = 48000) => {
  if (!heard.has(ch[0])) heard.set(ch[0], hearSound(ch, sr, { engine: 'test' }));
  return heard.get(ch[0]);
};

const pinks = new Map();
/** The report of 2.5 s of pink noise, measured once for each level and seed. */
const pinkReport = (db, seed) => {
  const key = `${db}/${seed}`;
  if (!pinks.has(key)) pinks.set(key, hear([S.pink(2.5, db, seed)]));
  return pinks.get(key);
};

test('the finite helper fails on a number that is not', () => {
  assert.throws(() => finite({ a: [NaN] }), /x\.a\.0 is NaN/);
  finite({ a: [1, { b: 0 }], c: null });
});

test('the same sound has no differences', () => {
  const r = pinkReport(-18, 1);
  assert.deepEqual(compareSound(r, r).differences, []);
});

test('louder only: loudness differs, tone does not', () => {
  const c = compareSound(hear([S.pink(2.5, -24, 1)]), pinkReport(-18, 1));
  near(c.levelDb, 6, 0.2);
  assert.deepEqual(c.differences.map((d) => d.measure), ['loudness']);
  assert.ok(c.spectrum.changeDb.every((v) => Math.abs(v) < 0.5));
  assert.equal(c.notes[0], 'Read as the second against the first.');
  finite(c);
});

test('brighter: tone leads the list', () => {
  const dull = S.pink(2.5, -18, 1);
  const bright = S.mix(dull, S.band(S.pink(2.5, -18, 2), 5000, 16000));
  const c = compareSound(hear([dull]), hear([bright]));
  assert.equal(c.differences[0].group, 'tone');
  assert.ok(c.differences.some((d) => d.measure === 'centre' && d.change > 0));
  finite(c);
});

test('grittier: roughness shows', () => {
  const c = compareSound(hear([S.sine(55, 3, -6)]), hear([S.saw(55, 3, -6)]));
  assert.ok(c.differences.some((d) => d.measure === 'roughness' && d.change > 0));
});

test('a group measured by another version is skipped, and said', () => {
  const a = pinkReport(-18, 1);
  const old = { ...a, versions: { ...a.versions, texture: 0 } };
  const c = compareSound(old, a);
  assert.deepEqual(c.skipped, ['texture']);
  assert.ok(c.notes.some((n) => /texture can't be compared: one of these was measured by an older version/.test(n)));
});

test('unequal lengths are said first of the cautions', () => {
  const c = compareSound(hear([S.pink(2, -18, 1)]), hear([S.pink(4, -18, 1)]));
  // (the lengths in the order of the names: "Read as the second against the first", so the second's first)
  assert.match(c.notes[1], /different lengths \(0:04 against 0:02\)/);
  const named = compareSound(hear([S.pink(4, -18, 1)]), hear([S.pink(2, -18, 1)]), { a: 'clean.wav', b: 'bright.wav' });
  assert.equal(named.notes[0], 'Read as bright.wav against clean.wav.');
  assert.match(named.notes[1], /different lengths \(0:02 against 0:04\)/);
});

test('a stretch of a saved report', () => {
  const x = S.at(8, [[0, S.band(S.pink(4, -18, 1), 40, 400)], [4, S.band(S.pink(4, -18, 2), 2000, 12000)]]);
  const saved = JSON.parse(JSON.stringify(hear([x])));
  const low = stretchOf(saved, 0, 4), high = stretchOf(saved, 4, 8);
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
  const mono = pinkReport(-18, 1);
  assert.equal(stretchOf(mono, 0, 3).stereo, undefined);
  const st = hear([S.pink(2.5, -18, 1), S.pink(2.5, -18, 2)]);
  const s = stretchOf(st, 2, 4);
  assert.equal(s.stereo.width.length, st.stereo.width.length);
  assert.equal(typeof s.stereo.lowSideDb, 'number');
  assert.equal(s.stereo.correlation, undefined);
  finite(s);
});

test('a stretch takes the rows that start inside the range', () => {
  const r = pinkReport(-18, 1);
  const a = stretchOf(r, 1, 3);
  assert.equal(a.along.mid.length, 2);
  assert.equal(stretchOf(r, 2, 100).along.mid.length, 1);
  assert.throws(() => stretchOf(r, 2, 2), RangeError);
});

test('a stretch of a whole sound reads like the whole sound when it covers it all', () => {
  const r = pinkReport(-18, 1);
  const s = stretchOf(r, 0, 6);
  near(s.dynamics.lufs, r.dynamics.lufs, 0.3);
  near(s.tone.centreHz, r.tone.centreHz, r.tone.centreHz * 0.2);
  for (const reg of r.tone.regions) near(s.tone.regions.find((x) => x.name === reg.name).db, reg.db, 0.6, reg.name);
});

test('comparing the other way round negates each change and keeps its size', () => {
  const dull = S.pink(2.5, -18, 1);
  const bright = S.mix(S.gain(dull, 3), S.band(S.pink(2.5, -18, 2), 5000, 16000));
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
  const a = hear([S.pink(2.5, -18, 1, 22050)], 22050), b = pinkReport(-18, 1);
  const c = compareSound(a, b);
  assert.ok(c.spectrum.freqs.length > 10);
  assert.ok(c.spectrum.freqs.length < b.tone.spectrum.freqs.length);
  assert.equal(c.spectrum.freqs.length, c.spectrum.changeDb.length);
  assert.ok(Math.max(...c.spectrum.freqs) <= 11025);
  finite(c);
  finite(compareSound(b, a));
});

test('mono against stereo: stereo is skipped, and said', () => {
  const m = pinkReport(-18, 1), s = hear([S.pink(2.5, -18, 1), S.pink(2.5, -18, 2)]);
  const c = compareSound(m, s);
  assert.deepEqual(c.skipped, ['stereo']);
  assert.ok(c.notes.some((n) => /stereo can't be compared: only one of these has it\./.test(n)));
  finite(c);
});

test('a short sound against a full one: the groups it lacks are skipped', () => {
  const short = hear([S.pink(0.3, -18, 1)]), full = pinkReport(-18, 1);
  const c = compareSound(short, full);
  for (const g of ['tone', 'texture', 'movement']) assert.ok(c.skipped.includes(g), g);
  assert.ok(!c.skipped.includes('dynamics'));
  assert.ok(c.notes.some((n) => /tone can't be compared: only one of these has it\./.test(n)));
  assert.deepEqual(c.spectrum, { freqs: [], changeDb: [] });
  finite(c);
});

test('a silent one has no differences, and says so', () => {
  const c = compareSound(hear([new Float32Array(48000 * 2)]), pinkReport(-18, 1));
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
  const dull = S.pink(2.5, -18, 1);
  const c = compareSound(hear([dull]), hear([S.mix(S.gain(dull, 6), S.band(S.pink(2.5, -18, 2), 5000, 16000))]), { a: 'the demo', b: 'the master' });
  assert.equal(c.notes[0], 'Read as the master against the demo.');
  const loud = c.differences.find((d) => d.measure === 'loudness');
  assert.match(loud.words, /^Loudness: -?\d+\.\d LUFS against -?\d+\.\d LUFS \(\+\d+\.\d LU\)\.$/);
  for (const d of c.differences) {
    assert.ok(!/\b(good|bad|too|should|better|worse)\b/i.test(d.words), d.words);
    assert.ok(/^[A-Z]/.test(d.words), d.words);
  }
  assert.ok(c.differences.every((d, i, l) => i === 0 || l[i - 1].size >= d.size));
});

test('a silent stretch has the silent report shape', () => {
  const saved = hear([S.at(4, [[0, S.pink(2, -18, 1)]])]);
  const s = stretchOf(saved, 2, 4);
  assert.equal(s.silent, true);
  assert.equal(s.tone, undefined);
  assert.equal(s.stereo, undefined);
  assert.deepEqual(s.words, ['It is silent.']);
  assert.equal(s.settings.stretch.fromSaved, true);
  assert.ok(compareSound(s, saved).notes.includes('One of these is silent.'));
  finite(s);
});

test('a stretch clamps its range, writes no minus zero, and refuses nonsense', () => {
  const r = pinkReport(-18, 1);
  const s = stretchOf(r, -5, 100);
  assert.deepEqual(s.settings.stretch, { fromSeconds: 0, toSeconds: r.seconds, fromSaved: true });
  assert.equal(s.along.mid.length, r.along.mid.length);
  assert.throws(() => stretchOf(r, -Infinity, 2), RangeError);
  assert.throws(() => stretchOf(r, NaN, 2), RangeError);
  assert.throws(() => stretchOf(r, 1, NaN), RangeError);
  assert.throws(() => stretchOf(r, 3, 1), RangeError);
  const noMinusZero = (x) => {
    if (typeof x === 'number') assert.ok(!Object.is(x, -0));
    else if (x && typeof x === 'object') Object.values(x).forEach(noMinusZero);
  };
  noMinusZero(s);
});

/** The equal-tempered note `semitones` from C4. */
const fromC4 = (semitones) => 261.6256 * 2 ** (semitones / 12);
// The pluck sound of scripts/hearingSpace.test.mjs (8 short notes, one every 0.75 s, 8 s in all), dry
// and through a 1 s reverb mixed 0.7 wet (at 0.5 wet its wet share is 0.10 against the dry 0.02: under a step)
let plucks;
const dryPluck = () => (plucks ??= S.melody([0, 4, 7, 12, 9, 5, 2, -1].map((n, i) => [fromC4(n), i * 0.75, 0.25]), 8, -6));
let reverbed;
const reverbPluck = () => (reverbed ??= S.reverb(dryPluck(), 1, 0.7));

const sounds = {};
/** The made sound called `name`, built once so its report is measured once. */
const made = (name) => (sounds[name] ??= levelSounds[name]());
const levelSounds = {
  'pink noise': () => [S.pink(2, -6, 1)],
  'a saw bass': () => [S.saw(55, 2, -3)],
  'a drum pattern': () => [S.every(4, 2, () => S.burst(0.12, 40, 1, -6, 1))],
  'a wobble bass': () => [S.wobble(55, 100, 1500, 2, 2, -3)],
  'kick and hat over a saw bass': () => [S.mix(S.every(2, 2, () => S.burst(0.2, 80, 1, -6, 1)), S.band(S.every(4, 2, () => S.burst(0.05, 10, 1, -9, 2)), 6000, 16000), S.saw(55, 2, -12))],
  'a pure sine': () => [S.sine(220, 2, -3)],
  'a stereo sound': () => [S.mix(S.saw(110, 2, -6), S.pink(2, -14, 3)), S.mix(S.saw(165, 2, -6), S.pink(2, -14, 4))],
  'the 1 s reverb pluck sound': () => [reverbPluck()],
};

/**
 * Sounds that read differently 40 dB down, for a reason outside this task (see the known limits test;
 * the reverb pluck sound's loudness reads 39.7 dB down there: much of it is silence between the notes,
 * and loudness gates out what is under -70 LUFS).
 */
const KNOWN_LIMIT_AT_40 = new Set(['a drum pattern', 'a pure sine', 'the 1 s reverb pluck sound']);

for (const name of Object.keys(levelSounds)) {
  test(`level: ${name} turned down differs only in loudness`, () => {
    const x = made(name);
    const whole = hear(x);
    for (const down of KNOWN_LIMIT_AT_40.has(name) ? [6, 20] : [6, 20, 40]) {
      const c = compareSound(whole, hear(x.map((ch) => S.gain(ch, -down))));
      near(c.levelDb, -down, 0.2, 'level');
      assert.deepEqual(c.differences.map((d) => d.measure), ['loudness'], `${down} dB down`);
    }
  });
}

test('known limits at 40 dB down, from absolute floors in other modules', () => {
  // Measured: a drum pattern reads roughness 0.62 then 0 (texture.ts's absolute gate) and movement change
  // 12.2 then 14.0 (frames.ts floors band levels at -120 dB, so the 60 dB range no longer fits); a pure 220 Hz
  // sine reads tilt -15.4 then -14.4 dB an octave (its empty bands sit at the spectrum's own noise floor).
  const drum = compareSound(hear(made('a drum pattern')), hear(made('a drum pattern').map((ch) => S.gain(ch, -40))));
  assert.deepEqual(drum.differences.map((d) => d.measure).sort(), ['loudness', 'roughness', 'spectral movement']);
  const sine = compareSound(hear(made('a pure sine')), hear(made('a pure sine').map((ch) => S.gain(ch, -40))));
  assert.deepEqual(sine.differences.map((d) => d.measure).sort(), ['loudness', 'tilt']);
});

// The final review's findings on the comparison (I3, I4, M9)

const bedOf = (sec, seed = 3) => S.mix(S.sine(110, sec, -12), S.sine(440, sec, -18), S.band(S.pink(sec, -30, seed), 100, 4000));

test("a band's movement that only one of the two has is said once, with its rate and depth, and never compared as 0 dB (I3)", () => {
  const noise = S.pink(6, -34, 1);
  const steady = hear([S.mix(S.saw(55, 6, -6), noise)]);
  const gated = hear([S.mix(S.gate(S.saw(55, 6, -6), 4, -30), noise)]);
  const low = (r) => r.movement.modulations.find((m) => m.band === 'low');
  assert.equal(low(steady), undefined, 'the steady one has no low band movement');
  assert.ok(low(gated) && Math.abs(low(gated).hz - 4) < 0.2 && low(gated).depthDb > 12, JSON.stringify(gated.movement.modulations));
  const c = compareSound(steady, gated);
  const d = c.differences.find((x) => x.measure === 'low band movement');
  assert.ok(d, c.differences.map((x) => x.words).join('\n'));
  assert.equal(d.a, null);
  near(d.b, low(gated).depthDb, 0.05, 'its depth');
  assert.ok(d.size <= 3 && d.size > 0, `its size is ${d.size}: no more than 3 steps, so it does not lead by itself`);
  assert.match(d.words, /^Low band movement: only in the second \(4\.0 Hz, \d+\.\d dB deep\)\.$/);
  assert.equal(c.differences.find((x) => /band depth$/.test(x.measure) && (x.a === 0 || x.b === 0)), undefined, 'no depth against 0.0 dB');
  assert.ok(!c.differences.some((x) => x.group === 'movement' && / 0\.0 dB/.test(x.words)), c.differences.map((x) => x.words).join('\n'));
  // the other way round: only in the first, the change negated, the size kept
  const back = compareSound(gated, steady).differences.find((x) => x.measure === 'low band movement');
  assert.match(back.words, /^Low band movement: only in the first \(4\.0 Hz, /);
  assert.deepEqual([back.a, back.b, back.change, back.size], [d.b, null, -d.change, d.size]);
  // named as the two are named
  assert.match(compareSound(steady, gated, { a: 'clean.wav', b: 'wobble.wav' }).differences.find((x) => x.measure === 'low band movement').words, /only in wobble\.wav \(/);
  assert.match(compareSound(steady, gated, { a: 'before', b: 'after' }).differences.find((x) => x.measure === 'low band movement').words, /only after \(/);
  // both have it: the depths are compared as numbers
  const shallow = hear([S.mix(S.gate(S.saw(55, 6, -6), 4, -8), noise)]);
  assert.ok(low(shallow), 'the shallow one moves too');
  const both = compareSound(shallow, gated).differences.find((x) => x.measure === 'low band depth');
  assert.ok(both && both.a !== null && both.b !== null && both.change > 2, JSON.stringify(both));
  assert.match(both.words, /^Low band depth: \d+\.\d dB against \d+\.\d dB \(\+\d+\.\d dB\)\.$/);
});

test('a width is compared only where a side level stands above 50 dB under the whole, and is read at that floor where it is under it (I3)', () => {
  const mid = S.pink(4, -18, 1);
  const sub = S.band(S.pink(4, -18, 2), 20, 60);
  /** The middle with `side` in the sides only: left is their sum, right their difference. */
  const wide = (side) => [S.mix(mid, side), S.mix(mid, Float32Array.from(side, (v) => -v))];
  const mono = hear([mid, mid.slice()]);
  // a trace in the sides of the sub bass, far under the sound: as an MP3 of the same bars leaves
  const trace = hear(wide(S.gain(sub, -50)));
  const width = (r) => r.stereo.width.find((w) => w.name.startsWith('sub bass')).db;
  assert.ok(width(trace) > -58 && width(trace) < -40, `the trace reads ${width(trace)} dB`);
  assert.equal(width(mono), -60);
  const c = compareSound(mono, trace);
  assert.deepEqual(c.differences.filter((d) => d.group === 'stereo').map((d) => d.words), [], 'nothing of the floor is compared');
  // sides that stand well over the floor are compared, the other read at the floor: 50 dB under its whole, not -60
  const real = hear(wide(S.gain(sub, -12)));
  const d = compareSound(mono, real).differences.find((x) => x.measure.startsWith('width: sub bass'));
  assert.ok(d, 'a real width is compared');
  near(d.b, width(real), 0.05, 'the real one, as its report gives it');
  const spectrum = mono.tone.spectrum;
  const whole = 10 * Math.log10(spectrum.mid.reduce((p, v, i) => p + 10 ** (v / 10) + 10 ** (spectrum.side[i] / 10), 0));
  const midThere = 10 * Math.log10(spectrum.freqs.reduce((p, f, i) => (f >= 20 && f < 60 ? p + 10 ** (spectrum.mid[i] / 10) : p), 0)) - whole;
  near(d.a, -50 - midThere, 0.2, 'the one with no sides, at the floor');
  assert.ok(d.a > -60);
  // and the low end's width the same way
  assert.ok(compareSound(mono, real).differences.some((x) => x.measure === 'low end width'));
  assert.equal(compareSound(mono, trace).differences.find((x) => x.measure === 'low end width'), undefined);
});

test('faults are compared: one line for each kind the two do not have the same number of, placed where it is in the newer one (I4)', () => {
  const clean = bedOf(4);
  const clicked = clean.slice(); clicked[2.5 * 48000] += 0.4;
  const a = hear([clean]), b = hear([clicked]);
  const c = compareSound(a, b);
  assert.deepEqual(c.faults, ['Clicks: 1 in the second (at 0:02.50), none in the first.']);
  assert.ok(!c.notes.includes('Nothing differs by more than a step.'));
  assert.deepEqual(compareSound(b, a).faults, ['Clicks: none in the second, 1 in the first.']);
  assert.deepEqual(compareSound(a, b, { a: 'clean.wav', b: 'click.wav' }).faults, ['Clicks: 1 in click.wav (at 0:02.50), none in clean.wav.']);
  assert.deepEqual(compareSound(a, b, { a: 'before', b: 'after' }).faults, ['Clicks: 1 after (at 0:02.50), none before.']);
  // the same faults on both sides: no line
  assert.deepEqual(compareSound(b, b).faults, []);
  // two clicks against one: the first of them placed
  const twice = clicked.slice(); twice[3.2 * 48000] -= 0.4;
  assert.deepEqual(compareSound(b, hear([twice])).faults, ['Clicks: 2 in the second (first at 0:02.50), 1 in the first.']);
  // placed in bars and beats where the newer report is of a song
  const inSong = hearSound([clicked], 48000, { engine: 'test', place: (s) => ({ seconds: s, bar: 3, beat: 2 }) });
  assert.deepEqual(compareSound(a, inSong, { a: 'before', b: 'after' }).faults, ['Clicks: 1 after (at bar 3, beat 2), none before.']);
  // the other kinds
  const tone = S.sine(200, 6, -6);
  const broken = S.mix(S.clip(S.sine(200, 6, 6), 1.0), S.sine(60, 6, -20), S.sine(120, 6, -26)).map((v) => v + 0.02);
  broken.fill(0, 4 * 48000, 4.1 * 48000);
  const lines = compareSound(hear([tone, tone.slice()]), hear([broken, S.gain(broken, -20)])).faults;
  assert.match(lines[0], /^Clipping: \d+ places in the second \(first at 0:00\.\d\d\), none in the first\.$/);
  assert.equal(lines[1], 'Digital silence: 1 stretch in the second (at 0:04.00), none in the first.');
  assert.equal(lines[2], 'Hum: at 60 Hz in the second, none in the first.');
  assert.equal(lines[3], 'A DC offset: in the second, not in the first.');
  assert.equal(lines[4], 'A quiet or silent channel: in the second, not in the first.');
  assert.equal(lines.length, 5);
  for (const l of lines) assert.doesNotMatch(l, /\b(good|bad|too|should)\b/i);
});

test('a comparison in which nothing differs says so; a stretch of a saved hearing says nothing about faults (I4)', () => {
  const r = pinkReport(-18, 1);
  const same = compareSound(r, r);
  assert.deepEqual([same.differences, same.faults], [[], []]);
  assert.equal(same.notes.at(-1), 'Nothing differs by more than a step.');
  assert.deepEqual(same.notes, ['Read as the second against the first.', 'Nothing differs by more than a step.']);
  // a click in the audio; its saved hearing's stretch has no faults to compare
  const clicked = bedOf(4); clicked[2.5 * 48000] += 0.4;
  const full = hear([clicked]);
  assert.equal(full.faults.length, 1);
  const stretch = stretchOf(JSON.parse(JSON.stringify(full)), 0, 4);
  const c = compareSound(stretch, hear([bedOf(4)]));
  assert.deepEqual(c.faults, []);
  assert.ok(!c.notes.some((n) => /click|fault/i.test(n)), c.notes.join('\n'));
  // silence: not "nothing differs"
  assert.ok(!compareSound(hear([new Float32Array(96000)]), r).notes.includes('Nothing differs by more than a step.'));
});

test('when no measure differs but one narrow band does, the notes say that, not that nothing differs', () => {
  // a sixth of an octave raised 4 dB: under every measure's step (its region moves about half a dB), plain in the spectrum
  const x = S.pink(4, -18, 1);
  const raised = S.mix(x, S.gain(S.band(x, 1070, 1210), -4.3));
  const c = compareSound(hear([x]), hear([raised]));
  assert.deepEqual([c.differences, c.faults], [[], []], c.differences.map((d) => d.words).join('\n'));
  const largest = c.spectrum.changeDb.reduce((best, v, i) => (Math.abs(v) > Math.abs(c.spectrum.changeDb[best]) ? i : best), 0);
  assert.ok(c.spectrum.changeDb[largest] > 2.5 && Math.abs(Math.log2(c.spectrum.freqs[largest] / 1140)) < 1 / 6, `${c.spectrum.changeDb[largest]} dB at ${c.spectrum.freqs[largest]} Hz`);
  assert.ok(!c.notes.includes('Nothing differs by more than a step.'));
  assert.match(c.notes.at(-1), /^No measure differs by more than a step; the largest change in one sixth of an octave is \+\d\.\d dB, at 1\.1 kHz\.$/);
  assert.ok(c.notes.at(-1).includes(`+${c.spectrum.changeDb[largest].toFixed(1)} dB`));
  // the other way round, the band is down
  assert.match(compareSound(hear([raised]), hear([x])).notes.at(-1), /the largest change in one sixth of an octave is -\d\.\d dB, at 1\.1 kHz\.$/);
  // a change of level alone leaves the spectrum as it was: loudness is the one difference, and no such note
  const quieter = compareSound(hear([x]), hear([S.gain(x, -6)]));
  assert.ok(!quieter.notes.some((n) => /^(Nothing|No measure) differs/.test(n)));
});

test('a stretch of a saved hearing gives one note of what cannot be compared, listing the groups (M9)', () => {
  const full = hear([bedOf(4)]);
  const stretch = stretchOf(JSON.parse(JSON.stringify(full)), 0, 4);
  const c = compareSound(stretch, full);
  // (space and register since Task 3 of the space and register work: a stretch has neither)
  assert.deepEqual(c.skipped, ['texture', 'movement', 'space', 'attack', 'register']);
  const said = c.notes.filter((n) => /can't be compared/.test(n));
  assert.deepEqual(said, ["Compared from saved measurements of a stretch: tone, width and loudness only (texture, movement, space, attack and register can't be compared)."]);
});

test('rise time and onsets are given as a plain ratio, and the change of the spectrum over time is named for what it is (M9)', () => {
  const hits = (rate, rampMs) => hear([S.every(rate, 4, (i) => S.burst(0.1, 20, rampMs, -6, i + 1))]);
  const sharp = hits(2, 0), soft = hits(8, 40);
  const c = compareSound(sharp, soft);
  const rise = c.differences.find((d) => d.measure === 'rise');
  assert.ok(rise, c.differences.map((d) => d.words).join('\n'));
  assert.match(rise.words, /^Rise: \d+\.\d ms against \d+\.\d ms \(\d+(\.\d)? times as long\)\.$/);
  const [, to, from, times] = /^Rise: (\S+) ms against (\S+) ms \((\S+) times/.exec(rise.words);
  near(Number(times), Number(to) / Number(from), 0.06 * Number(times) + 0.06, 'the ratio said');
  const onsets = c.differences.find((d) => d.measure === 'onsets a second');
  assert.match(onsets.words, /^Onsets a second: \d+\.\d against \d+\.\d \(\d+(\.\d)? times as many\)\.$/);
  // the other way round: a share
  const back = compareSound(soft, sharp);
  assert.match(back.differences.find((d) => d.measure === 'rise').words, /\(\d+% as long\)\.$/);
  assert.match(back.differences.find((d) => d.measure === 'onsets a second').words, /\(\d+% as many\)\.$/);
  // none against some
  const none = hear([S.sine(220, 4, -12)]);
  assert.match(compareSound(none, soft).differences.find((d) => d.measure === 'onsets a second').words, /against 0\.0 \(from none\)\.$/);
  assert.match(compareSound(soft, none).differences.find((d) => d.measure === 'onsets a second').words, /^Onsets a second: 0\.0 against \d+\.\d \(to none\)\.$/);
  for (const d of [...c.differences, ...back.differences]) assert.doesNotMatch(d.words, /octaves\)\.$/.test(d.words) && d.group === 'attack' ? /./ : /^$/, d.words);
  // the numbers keep their sense: a doubling is a change of 1
  assert.ok(rise.change > 0 && onsets.change > 1.5);
  // "Change" is "Spectral movement"
  const drum = made('a drum pattern');
  const moved = compareSound(hear(drum), hear(drum.map((ch) => S.gain(ch, -40))));
  assert.ok(moved.differences.some((d) => /^Spectral movement: /.test(d.words)));
  assert.ok(![...moved.differences, ...c.differences].some((d) => /^Change: /.test(d.words)));
});

// Space and register (Task 3 of the space and register work)

test('wetter and longer reads as space', () => {
  const c = compareSound(hear([dryPluck()]), hear([reverbPluck()]));
  const decay = c.differences.find((d) => d.measure === 'decay');
  const wet = c.differences.find((d) => d.measure === 'wet share');
  assert.ok(decay && decay.change > 0 && decay.group === 'space', c.differences.map((d) => d.words).join('\n'));
  assert.ok(wet && wet.change > 0 && wet.group === 'space', c.differences.map((d) => d.words).join('\n'));
  assert.match(decay.words, /^Decay: \d+ ms against (\d+ ms|under 10 ms) \((more than )?\d+(\.\d)? times as long\)\.$/);
  assert.match(wet.words, /^Wet share: \d\.\d\d against \d\.\d\d \(\+\d\.\d\d\)\.$/);
  finite(c);
});

test('a decay under 10 ms is said as the sound\'s words say it, and the words\' ratio is the change\'s', () => {
  const now = hear([reverbPluck()]);
  const decay = (a, b) => compareSound({ ...now, space: { ...now.space, decayMs: a } }, { ...now, space: { ...now.space, decayMs: b } }).differences.find((d) => d.measure === 'decay');
  // (decays are read on 10 ms frames: under that, the change takes 10 ms, and the words say so)
  const up = decay(6, 705);
  assert.equal(up.words, 'Decay: 705 ms against under 10 ms (more than 70 times as long).');
  near(up.change, Math.log2(70.5), 0.005, 'the change, octaves');
  const down = decay(705, 6);
  assert.equal(down.words, 'Decay: under 10 ms against 705 ms (less than 2% as long).');
  near(down.change, -Math.log2(70.5), 0.005, 'the change, octaves');
  const plain = decay(40, 320);
  assert.equal(plain.words, 'Decay: 320 ms against 40 ms (8 times as long).');
  near(plain.change, 3, 1e-9, 'the change, octaves');
  assert.equal(decay(8, 9), undefined, 'two decays under 10 ms do not differ');
});

test('an octave higher reads as register', () => {
  const SCALE = [0, 2, 4, 5, 7, 9, 11, 12];
  const scale = (octave) => S.melody(SCALE.map((n, i) => [fromC4(n + 12 * octave), i * 0.5, 0.5]), 4, -6);
  const c = compareSound(hear([scale(0)]), hear([scale(1)]));
  for (const measure of ['register centre', 'top line']) {
    const d = c.differences.find((x) => x.measure === measure);
    assert.ok(d && d.group === 'register', `${measure}: ${c.differences.map((x) => x.words).join('\n')}`);
    near(d.change, 1, 0.1, measure);
    assert.match(d.words, /^[A-Z][a-z ]+: [A-G]#?\d against [A-G]#?\d \(\+\d\.\d\d octaves\)\.$/, d.words);
  }
  finite(c);
});

test('an old saved hearing has neither group (Review Focus 4)', () => {
  const now = hear([reverbPluck()]);
  assert.ok(now.space && now.register, 'the new hearing has both groups');
  const old = JSON.parse(JSON.stringify(now));
  delete old.space;
  delete old.register;
  delete old.versions.space;
  delete old.versions.register;
  for (const [a, b] of [[old, now], [now, old]]) {
    const c = compareSound(a, b);
    for (const group of ['space', 'register']) {
      assert.ok(c.skipped.includes(group), `${group}: ${c.skipped}`);
      assert.ok(c.notes.includes(`${group} can't be compared: only one of these has it.`), c.notes.join('\n'));
    }
    assert.ok(!c.differences.some((d) => d.group === 'space' || d.group === 'register'));
    finite(c);
  }
});

test('a measure of space is compared only when both have a number; null groups do not throw', () => {
  const now = hear([reverbPluck()]);
  const space = (o) => ({ ...now, space: { decayMs: null, wetShare: null, echo: null, tailWiderDb: null, ...o } });
  // A null on one side is not a difference
  const c = compareSound(space({ decayMs: 300, wetShare: 0.2, tailWiderDb: 4 }), space({}));
  assert.deepEqual(c.differences.filter((d) => d.group === 'space'), []);
  // An echo in one only: one line saying so, its size at most 3
  const echo = compareSound(space({}), space({ echo: { ms: 250, repeats: 6, note: '1/8' } }));
  const d = echo.differences.find((x) => x.measure === 'echo');
  assert.equal(d.words, 'Echo: only in the second (250 ms, 1/8 notes).');
  assert.ok(d.size > 0 && d.size <= 3, `size ${d.size}`);
  assert.equal(compareSound(space({ echo: { ms: 375, repeats: 2 } }), space({}), { a: 'before', b: 'after' }).differences.find((x) => x.measure === 'echo').words, 'Echo: only before (375 ms).');
  // Both: their times, in octaves
  const both = compareSound(space({ echo: { ms: 250, repeats: 4 } }), space({ echo: { ms: 500, repeats: 4 } })).differences.find((x) => x.measure === 'echo');
  near(both.change, 1, 1e-9, 'echo');
  // Tail width, in dB
  const width = compareSound(space({ decayMs: 300, tailWiderDb: 1 }), space({ decayMs: 300, tailWiderDb: 6 })).differences.find((x) => x.measure === 'tail width');
  near(width.change, 5, 1e-9, 'tail width');
  // Null groups (a short sound, no pitched part) on either side
  for (const o of [{ space: null }, { register: null }, { space: null, register: null }]) {
    finite(compareSound({ ...now, ...o }, now));
    finite(compareSound(now, { ...now, ...o }));
  }
  finite(compareSound(now, { ...now, register: { ...now.register, topHz: null } }));
});
