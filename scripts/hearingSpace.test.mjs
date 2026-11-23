// Unit tests for the hearing report's space (src/audio/hearing/space.ts): how long sounds ring on after
// they end, how much of the sound is tail, a clear echo and whether the tails are wider than the direct
// sound, measured on the made test signals of scripts/fixtures/hearingSignals.mjs, and its lines in the
// words (words.ts). Run with `npm test`.
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

const { spaceOf } = await import('../src/audio/hearing/space.ts');
const { soundWords } = await import('../src/audio/hearing/words.ts');
const { hearSound } = await import('../src/audio/hearing/hearSound.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const SR = 48000;
const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);
const within = (x, lo, hi, what = '') => assert.ok(x >= lo && x <= hi, `${what} ${x} is not within ${lo} to ${hi}`);
/** Asserts every number anywhere in `x` is finite, naming the path of the first that is not (as in scripts/hearingReport.test.mjs). */
const finite = (x, path = 'space') => {
  if (typeof x === 'number') assert.ok(Number.isFinite(x), `${path} is ${x}`);
  else if (x && typeof x === 'object') for (const k of Object.keys(x)) finite(x[k], `${path}.${k}`);
};
/** The equal-tempered note `semitones` from C4. */
const fromC4 = (semitones) => 261.6256 * 2 ** (semitones / 12);

// The dry pluck sound: 8 short notes 0.25 s long, one every 0.75 s, then room for the tails (8 s in all)
const NOTES = [0, 4, 7, 12, 9, 5, 2, -1];
const pluck = S.melody(NOTES.map((s, i) => [fromC4(s), i * 0.75, 0.25]), 8, -6);
const reverbed = new Map([0.3, 1, 3].map((rt) => [rt, S.reverb(pluck, rt, 0.5)]));
const spaces = new Map([...reverbed].map(([rt, x]) => [rt, spaceOf([x, x], SR)]));
/** `x` scaled so its RMS is `db` from `y`'s. */
const rmsOf = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
const under = (x, y, db) => S.gain(x, 20 * Math.log10(rmsOf(y) / rmsOf(x)) + db);
/** A held pad of C3, E3 and G3 saws, `seconds` long. */
const padOf = (seconds) => S.mix(S.saw(fromC4(-12), seconds, -6), S.saw(fromC4(-8), seconds, -6), S.saw(fromC4(-5), seconds, -6));
const base = { versions: {}, engine: 'test', settings: { sampleRate: SR }, seconds: 8, channels: 1, silent: false, faults: [] };

test('longer reverb reads longer', () => {
  const [short, one, long] = [0.3, 1, 3].map((rt) => spaces.get(rt));
  for (const s of [short, one, long]) assert.ok(s.decayMs !== null && s.wetShare !== null, JSON.stringify(s));
  assert.ok(short.decayMs < one.decayMs && one.decayMs < long.decayMs, `decays ${short.decayMs}, ${one.decayMs}, ${long.decayMs}`);
  within(one.decayMs, 250, 450, 'the 1 s reverb falls 20 dB in');
  within(long.decayMs, 700, 1300, 'the 3 s reverb falls 20 dB in');
  assert.ok(short.wetShare < one.wetShare && one.wetShare < long.wetShare, `wet shares ${short.wetShare}, ${one.wetShare}, ${long.wetShare}`);
});

test('a dry sound has short decays and no echo', () => {
  const s = spaceOf([pluck], SR);
  assert.ok(s.decayMs !== null && s.decayMs < 120, `decayMs ${s.decayMs}`);
  assert.ok(s.wetShare !== null && s.wetShare < 0.15, `wetShare ${s.wetShare}`);
  assert.equal(s.echo, null);
});

test('an 1/8-note delay at 120 bpm', () => {
  const s = spaceOf([S.delay(pluck, 0.25, 0.5, 6)], SR, 120);
  assert.ok(s.echo, JSON.stringify(s));
  near(s.echo.ms, 250, 10, 'echo ms');
  assert.equal(s.echo.note, '1/8');
  assert.ok(s.echo.repeats >= 3, `repeats ${s.echo.repeats}`);
});

test('a riff is not an echo (Review Focus 3)', () => {
  const riff = S.melody(Array.from({ length: 16 }, (_, i) => [fromC4(-12), i * 0.25, 0.25]), 4, -6);
  assert.equal(spaceOf([riff], SR, 120).echo, null);
});

test('a held pad has nothing that ends (Review Focus 2)', () => {
  const pad = S.mix(S.saw(fromC4(-12), 4, -6), S.saw(fromC4(-8), 4, -6), S.saw(fromC4(-5), 4, -6));
  const s = spaceOf([pad, pad], SR);
  assert.equal(s.decayMs, null);
  assert.equal(s.wetShare, null);
  assert.equal(s.tailWiderDb, null);
});

test('wide tails', () => {
  const wide = spaceOf([S.reverb(pluck, 1, 0.5, 1), S.reverb(pluck, 1, 0.5, 2)], SR);
  assert.ok(wide.tailWiderDb !== null && wide.tailWiderDb > 6, `decorrelated tails: ${wide.tailWiderDb}`);
  const same = spaceOf([reverbed.get(1), reverbed.get(1)], SR);
  assert.ok(same.tailWiderDb !== null && same.tailWiderDb < 1, `the same tail in both: ${same.tailWiderDb}`);
  // (Fix round 4: with a dB to spare; it reads 8.0)
  assert.ok(wide.tailWiderDb >= 7, `decorrelated tails, with a margin: ${wide.tailWiderDb}`);
});

test('mono, silence and short', () => {
  const mono = spaceOf([reverbed.get(1)], SR);
  assert.equal(mono.tailWiderDb, null);
  assert.ok(Number.isFinite(mono.decayMs) && Number.isFinite(mono.wetShare), JSON.stringify(mono));
  finite(mono);
  const none = { decayMs: null, wetShare: null, echo: null, tailWiderDb: null };
  for (const ch of [[new Float32Array(4 * SR)], [new Float32Array(4 * SR), new Float32Array(4 * SR)], [new Float32Array(0)], []]) {
    assert.deepEqual(spaceOf(ch, SR), none);
  }
  for (const seconds of [0.01, 0.3, 0.45]) {
    const short = spaceOf([reverbed.get(1).subarray(0, Math.round(seconds * SR))], SR, 120);
    finite(short, `${seconds} s`);
  }
});

test('space does not change with level', () => {
  const loud = spaces.get(1);
  for (const db of [-6, -20]) {
    const x = S.gain(reverbed.get(1), db);
    const quiet = spaceOf([x, x], SR);
    assert.ok(quiet.decayMs !== null && Math.abs(quiet.decayMs / loud.decayMs - 1) <= 0.1, `decayMs at ${db} dB: ${quiet.decayMs} against ${loud.decayMs}`);
    near(quiet.wetShare, loud.wetShare, 0.05, `wetShare at ${db} dB:`);
  }
});

test('space words', () => {
  const base = { versions: {}, engine: 'test', settings: { sampleRate: SR }, seconds: 8, channels: 2, silent: false, faults: [] };
  const space = (o) => ({ decayMs: null, wetShare: null, echo: null, tailWiderDb: null, ...o });
  const words = (o) => soundWords({ ...base, space: space(o) });
  assert.deepEqual(words({ decayMs: 80 }), ['Dry: sounds stop almost at once (they fall 20 dB in 80 ms).']);
  assert.deepEqual(words({ decayMs: 1200 }), ['Long tails: sounds ring on, falling 20 dB in 1.2 s.']);
  assert.deepEqual(words({ decayMs: 6 }), ['Dry: sounds stop almost at once (they fall 20 dB in under 10 ms).']);
  for (const ms of [150, 400, 1000]) assert.deepEqual(words({ decayMs: ms }), [], `${ms} ms`);
  assert.deepEqual(words({ wetShare: 0.55 }), ['Much of it is tail rather than direct sound (wet share 0.55).']);
  assert.deepEqual(words({ echo: { ms: 250, repeats: 4, note: '1/8' } }), ['Repeats every 250 ms (1/8 notes), 4 standing out, each a step quieter: an echo, or a note played again more quietly.']);
  assert.deepEqual(words({ echo: { ms: 375, repeats: 3 } }), ['Repeats every 375 ms, 3 standing out, each a step quieter: an echo, or a note played again more quietly.']);
  assert.deepEqual(words({ tailWiderDb: 4.5 }), ['The tails are wider than the direct sound (+4.5 dB).']);
  assert.deepEqual(words({}), []);
  assert.deepEqual(soundWords(base), []);
  // After the movement lines, before the dynamics lines
  const lines = soundWords({ ...base, movement: { changeDb: 0, modulations: [] }, space: space({ decayMs: 80 }), dynamics: { lufs: -14, shortTermMaxLufs: -12, truePeakDbtp: -1, crestDb: 4, rangeLu: 5 } });
  assert.deepEqual(lines, ['Static: its spectrum barely changes.', 'Dry: sounds stop almost at once (they fall 20 dB in 80 ms).', 'Squashed (crest 4.0 dB).']);
  const all = words({ decayMs: 1200, wetShare: 0.55, echo: { ms: 250, repeats: 4, note: '1/8' }, tailWiderDb: 4.5 });
  assert.equal(all.length, 4);
  assert.ok(all.every((w) => !/\b(good|bad|too|should)\b/i.test(w) && !w.includes('—')), all.join(' / '));
});

test('the report carries space, and its words', () => {
  // (a 4 s reverb: its tails fall 20 dB in about 1.3 s)
  const x = S.reverb(pluck, 4, 0.5);
  const report = hearSound([x, x], SR, { engine: 'test', tempoBpm: 120, along: false });
  assert.deepEqual(report.space, spaceOf([x, x], SR, 120));
  assert.ok(report.space.decayMs > 1000, JSON.stringify(report.space));
  assert.ok(report.words.includes(`Long tails: sounds ring on, falling 20 dB in ${(report.space.decayMs / 1000).toFixed(1)} s.`), report.words.join(' / '));
  assert.equal(hearSound([x.subarray(0, Math.round(0.3 * SR))], SR, { engine: 'test' }).space, undefined, 'under 0.4 s there is no space group');
});

test('wetter reads at least as wet, and as long (Fix round 1)', () => {
  for (const rt of [1, 1.5, 3]) {
    let before = null;
    for (const wet of [0.2, 0.5, 0.8]) {
      const x = S.reverb(pluck, rt, wet);
      const s = spaceOf([x, x], SR);
      const what = `RT ${rt} s, wet ${wet}: ${JSON.stringify(s)}`;
      assert.ok(s.decayMs !== null && s.wetShare !== null, what);
      assert.ok(Math.abs(s.decayMs / ((rt * 1000) / 3) - 1) <= 0.35, what);
      if (before !== null) assert.ok(s.wetShare >= before - 0.02, `${what}, after ${before}`);
      before = s.wetShare;
    }
  }
});

test('a quiet held layer is not a long tail (Fix round 1)', () => {
  const dry = S.melody(NOTES.map((s, i) => [fromC4(s), i * 0.75, 0.25]), 8, -6);
  // (made once: a saw's every partial up to 24 kHz takes a while)
  const pad = padOf(8);
  for (const db of [-20, -26]) {
    const s = spaceOf([S.mix(dry, under(pad, dry, db))], SR);
    assert.ok(s.decayMs === null || s.decayMs < 150, `a pad ${db} dB under: ${JSON.stringify(s)}`);
    assert.ok(!soundWords({ ...base, space: s }).some((w) => w.startsWith('Long tails')), `${db} dB`);
  }
  const drums = S.every(2, 8, (i) => S.burst(0.3, 40, 1, -6, i + 1));
  const s = spaceOf([S.mix(drums, under(pad, drums, -16))], SR);
  assert.ok(!soundWords({ ...base, space: s }).some((w) => w.startsWith('Long tails')), `drums over a pad: ${JSON.stringify(s)}`);
  for (const db of [-20, -30]) {
    const x = reverbed.get(1);
    const noisy = spaceOf([S.mix(x, under(S.pink(8, -20, 3), x, db))], SR);
    assert.ok(noisy.decayMs === null || Math.abs(noisy.decayMs / 335 - 1) <= 0.35, `pink noise ${db} dB under: ${JSON.stringify(noisy)}`);
  }
});

test('a fading riff is said as either reading (Fix round 1)', () => {
  const riff = S.at(4, Array.from({ length: 16 }, (_, i) => [i * 0.25, S.gain(S.melody([[fromC4(-12), 0, 0.25]], 0.25, -6), -3 * i)]));
  const s = spaceOf([riff], SR, 120);
  assert.ok(s.echo, `a riff fading 3 dB a note: ${JSON.stringify(s)}`);
  const lines = soundWords({ ...base, space: s });
  const note = s.echo.note ? ` (${s.echo.note} notes)` : '';
  assert.ok(lines.includes(`Repeats every ${s.echo.ms} ms${note}, ${s.echo.repeats} standing out, each a step quieter: an echo, or a note played again more quietly.`), lines.join(' / '));
});

test('a long reverb is timed though the next note comes first (Fix round 2)', () => {
  const longPlucks = S.melody([0, 5, 9, 4].map((s, i) => [fromC4(s), i * 2, 1.5]), 8, -6);
  const bursts = S.every(1.5, 8, (i) => S.burst(0.5, 100, 2, -6, i + 1));
  for (const [name, x] of [['long plucks', longPlucks], ['noise bursts', bursts]]) {
    const s = spaceOf([S.reverb(x, 2, 0.5)], SR);
    assert.ok(s.decayMs !== null && Math.abs(s.decayMs / 667 - 1) <= 0.35, `${name} through a 2 s reverb: ${JSON.stringify(s)}`);
  }
});

// (the full grids, every seed, are in scripts/audio-check/hearing/space-grid.mjs. Fix round 3's test that
// nearly dry reverbs, RT 0.1 to 0.4 s at wet 0.1 to 0.3, read dry or near RT/3 is there alone since
// Task 3, to keep this file under 30 s: it was that family's first seed, cell for cell)

test('wetter never reads much drier, on a grid of wet mixes (Fix round 3)', () => {
  for (const rt of [1, 2, 3]) {
    let before = null;
    for (const wet of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const x = S.reverb(pluck, rt, wet, 2);
      const s = spaceOf([x, x], SR);
      const what = `RT ${rt} s, wet ${wet}: ${JSON.stringify(s)}`;
      assert.ok(s.decayMs !== null && s.wetShare !== null, what);
      assert.ok(Math.abs(s.decayMs / ((rt * 1000) / 3) - 1) <= 0.35, what);
      // (0.04 a step since round 5; it was 0.05)
      if (before !== null) assert.ok(s.wetShare >= before - 0.04 - 1e-9, `${what}, after ${before}`);
      before = s.wetShare;
    }
  }
});

test('known limit: a 4 s reverb mixed 0.7 wet or more reads nothing (Fix round 3; as it was again since round 5)', () => {
  // Over a reverb this loud the notes' starts and ends barely move the level. Pinned as it reads, so
  // a change shows: at wet 0.6 it is still timed; from 0.7 up, nothing (round 4 timed 0.7, on ends
  // most of which were found for no note; since round 5 that says nothing).
  const at = (wet) => {
    const x = S.reverb(pluck, 4, wet);
    return spaceOf([x, x], SR);
  };
  const timed = at(0.6);
  assert.ok(timed.decayMs !== null && Math.abs(timed.decayMs / 1333 - 1) <= 0.35, JSON.stringify(timed));
  for (const wet of [0.7, 0.8, 0.9]) assert.deepEqual(at(wet), { decayMs: null, wetShare: null, echo: null, tailWiderDb: null }, `wet ${wet}`);
});

test('wet share does not fall as the mix gets wetter, on other noise seeds (Fix round 4)', () => {
  // (a row that fell furthest before, RT 2 s on seed 6, from 0.25 to 0.13, over the wetter mixes, where it fell. Seeds 1 to 6 in full: space-grid.mjs)
  for (const [rt, seed, step] of [[2, 6, 0.05]]) {
    let before = null;
    for (const wet of [0.5, 0.6, 0.7, 0.8, 0.9]) {
      const x = S.reverb(pluck, rt, wet, seed);
      const s = spaceOf([x, x], SR);
      const what = `RT ${rt} s, seed ${seed}, wet ${wet}: ${JSON.stringify(s)}`;
      assert.ok(s.decayMs !== null && Math.abs(s.decayMs / ((rt * 1000) / 3) - 1) <= 0.35, what);
      if (before !== null) assert.ok(s.wetShare >= before - step - 1e-9, `${what}, after ${before}`);
      before = s.wetShare;
    }
  }
});

// Drum beats (S.beat): a kick and a snare in turn, with or without a hat twice as often. The full grid,
// both kits at both rates with and without the hat through 6 reverbs on 3 seeds, is in space-grid.mjs.
const beats = new Map();
const beatOf = (kickMs, snareMs, snareSeconds, rate, hat) => {
  const key = [kickMs, snareMs, snareSeconds, rate, hat].join('/');
  if (!beats.has(key)) beats.set(key, S.beat(kickMs, snareMs, snareSeconds, rate, hat, 8));
  return beats.get(key);
};

test('drum beats, dry and through reverbs (Fix round 4)', () => {
  let cells = 0;
  let nulls = 0;
  for (const [kit, rate, hat, reverbs] of [
    [[80, 60, 0.3], 2, false, [[1.5, 0.5]]],
    [[80, 60, 0.3], 4, true, [[0.8, 0.5]]],
    [[150, 100, 0.4], 2, true, [[1.5, 0.5]]],
  ]) {
    const x = beatOf(...kit, rate, hat);
    const name = `kick ${kit[0]}, snare ${kit[1]}, ${rate} a second${hat ? ', hat' : ''}`;
    const dry = spaceOf([x], SR);
    // A dry beat is not said to be mostly tail, and its hits' own ring is its decay
    assert.ok(dry.decayMs !== null && dry.wetShare < 0.3, `${name}, dry: ${JSON.stringify(dry)}`);
    assert.ok(!soundWords({ ...base, space: dry }).some((w) => w.startsWith('Much of it is tail')), name);
    assert.ok(Math.abs(dry.decayMs / (kit[1] * 2.3) - 1) <= 0.2, `${name}, dry, against the snare's own fall: ${dry.decayMs}`);
    const read = [];
    for (const [rt, wet] of reverbs) {
      const s = spaceOf([S.reverb(x, rt, wet)], SR);
      const what = `${name}, RT ${rt} s, wet ${wet}: ${JSON.stringify(s)}, dry ${dry.decayMs}`;
      cells++;
      if (s.decayMs === null) nulls++;
      else {
        // (the yardstick: the reverb's own fall, or the dry beat's ring when that is longer)
        assert.ok(Math.abs(s.decayMs / Math.max((rt * 1000) / 3, dry.decayMs) - 1) <= 0.35, what);
        assert.ok(s.decayMs >= dry.decayMs, what);
        for (const [rt2, wet2, other] of read) {
          if (other.wetShare !== null && rt2 <= rt && wet2 <= wet) assert.ok(s.wetShare >= other.wetShare - 0.05 - 1e-9, `${what}, after ${other.wetShare} at ${rt2}/${wet2}`);
        }
      }
      read.push([rt, wet, s]);
    }
  }
  assert.ok(nulls <= cells / 4, `${nulls} of ${cells} reverbed beats read nothing`);
});

test('known limit: a hat over a hit that falls fast into a quiet long reverb reads short (Fix round 4)', () => {
  // Snares four a second with hats every 125 ms, through a 1.5 s reverb mixed 0.3: a snare's own fall
  // takes it 17 dB down before its reverb shows, and the reverb is then seen only in the 80 ms between
  // hats. Pinned as it reads (275 ms; the reverb alone falls 20 dB in 500 ms, and the same beat
  // without the hat reads 454 ms), so a change shows.
  const s = spaceOf([S.reverb(beatOf(80, 60, 0.3, 4, true), 1.5, 0.3)], SR);
  assert.ok(s.decayMs !== null && s.decayMs >= 250 && s.decayMs < 325, JSON.stringify(s));
});

test('known limit: hats over hits that ring longer than the reverb read under the dry beat (Fix round 4)', () => {
  // A snare that rings on for 230 ms of its own, with hats, through a 0.5 s reverb (which falls 20 dB
  // in 167 ms): each hat's own short reverb tail lies over the snare's ring and falls faster than
  // it, so the stretches between the hats fall faster than the ring alone. Pinned as it reads (196 ms
  // against 235 ms dry, 16.6% under; on the grid's seeds 196 to 234 ms), so a change shows.
  const x = beatOf(150, 100, 0.4, 2, true);
  const dry = spaceOf([x], SR);
  const s = spaceOf([S.reverb(x, 0.5, 0.5)], SR);
  assert.ok(dry.decayMs !== null && Math.abs(dry.decayMs / 230 - 1) <= 0.05, JSON.stringify(dry));
  assert.ok(s.decayMs !== null && s.decayMs < dry.decayMs && s.decayMs >= 0.8 * dry.decayMs, `${JSON.stringify(s)} against ${dry.decayMs} dry`);
});

// Fix round 5 (ruling S4: when in doubt the group says less). The families in full: space-grid.mjs.
const none = { decayMs: null, wetShare: null, echo: null, tailWiderDb: null };
const linesOf = (space) => soundWords({ ...base, space });
const says = (space, start) => linesOf(space).some((w) => w.startsWith(start));

test('beside an echo nothing is called dry, and no width is given (Fix round 5)', () => {
  for (const [name, channels] of [
    ['a 375 ms delay', [S.delay(pluck, 0.375, 0.5, 8)]],
    ['a 500 ms delay', [S.delay(pluck, 0.5, 0.3, 8)]],
    ['a 375 ms ping-pong', S.pingPong(pluck, 0.375, 0.5, 8)],
  ]) {
    const s = spaceOf(channels, SR, 120);
    assert.ok(s.echo, `${name}: ${JSON.stringify(s)}`);
    assert.ok(!says(s, 'Dry') && !says(s, 'The tails are wider'), `${name}: ${linesOf(s).join(' / ')}`);
    assert.equal(s.tailWiderDb, null, name);
  }
  assert.deepEqual(linesOf({ ...none, decayMs: 6, echo: { ms: 375, repeats: 6 } }), ['Repeats every 375 ms, 6 standing out, each a step quieter: an echo, or a note played again more quietly.']);
});

test('different notes, each a step quieter, are not an echo (Fix round 5)', () => {
  // (six rising notes 250 ms apart, each 4 dB under the last, four times; the fading riff of one note keeps its line, above)
  const phrase = S.at(6.5, [0, 1, 2].flatMap((g) => [0, 4, 7, 12, 16, 19].map((m, k) => [g * 2 + k * 0.25, S.gain(S.melody([[fromC4(m + (g % 2) * 2), 0, 0.2]], 0.2, -6), -4 * k)])));
  assert.equal(spaceOf([phrase], SR, 120).echo, null);
});

test('a slow attack is not an end (Fix round 5)', () => {
  // Notes drawn in straight lines of gain: up over 50 ms, down to a held level, and let go over 200 ms, a fall of 20 dB in about 180 ms
  // (the 80 and 120 ms attacks: space-grid.mjs)
  for (const [attack, release, truth] of [[0.05, 0.2, 180]]) {
    const x = S.at(5, Array.from({ length: 6 }, (_, i) => [i * 0.75, S.shapedNote(fromC4([0, 4, 7, 12, 9][i % 5]), 0.4, attack, 0.1, -6, release)]));
    const s = spaceOf([x], SR);
    assert.ok(s.decayMs === null || Math.abs(s.decayMs / truth - 1) <= 0.35, `attack ${attack} s: ${JSON.stringify(s)}`);
    assert.ok(!says(s, 'Dry'), `attack ${attack} s`);
  }
});

test('digital silence between the notes has no width (Fix round 5)', () => {
  const s = spaceOf([pluck, pluck], SR);
  assert.equal(s.tailWiderDb, null);
  assert.ok(!says(s, 'The tails are wider'));
});

test('dry notes, then the same notes drowned in a reverb, are not called dry (Fix round 5)', () => {
  const notes = NOTES.map((n, i) => [fromC4(n), i * 0.75, 0.25]);
  const x = S.mix(S.melody(notes, 6.5, -6), S.at(14.5, [[6.5, S.reverb(S.melody(notes, 8, -6), 1.5, 0.5)]]));
  const s = spaceOf([x], SR);
  assert.ok(!says(s, 'Dry'), JSON.stringify(s));
  assert.equal(s.decayMs, null);
});

test('a tail of one partial is not cut into short sounds (Fix round 5)', () => {
  // Sine toms: one partial in a reverb swells and sags as it falls. A fill of four, then a rest, through a long quiet reverb read "Long tails ... 4.4 s"; one tom a second read "Dry"
  const fill = S.at(8, [0, 1, 2, 3].flatMap((b) => [220, 160, 120, 85].map((hz, i) => [b * 2 + i * 0.25, S.tom(hz)])));
  const long = spaceOf([S.reverb(fill, 2.5, 0.3)], SR, 120);
  assert.ok(long.decayMs === null || long.decayMs <= 1.5 * 833, JSON.stringify(long));
  assert.equal(long.echo, null);
  const one = spaceOf([S.reverb(S.every(1, 8, () => S.tom(120)), 1.5, 0.3, 3)], SR);
  assert.ok(!says(one, 'Dry'), JSON.stringify(one));
});

test('a beat with accented 16th hats through a quiet reverb reads near it or nothing (Fix round 5)', () => {
  // (through 2.5 s it can read short, a known limit: space-grid.mjs)
  const s = spaceOf([S.reverb(S.accentedBeat(8), 1.5, 0.3)], SR, 120);
  assert.ok(s.decayMs === null || Math.abs(s.decayMs / 500 - 1) <= 0.35, JSON.stringify(s));
  assert.equal(s.echo, null);
});

test('known limit: struck chords held on read as long tails or as dry (Fix round 5)', () => {
  // A struck string rings down on its own while the keys are held: the bend where its upper partials
  // have gone is taken for the end, and the ring after it for a tail. No reverb here at all. Pinned as
  // it reads: "Long tails" (1211 ms, wet share 0.27). At another ring and hold it reads "Dry" (39 ms: space-grid.mjs).
  const chords = (bpm, hold, ring) => {
    const b = 60 / bpm;
    const pieces = [[9, 12, 16, 19], [2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11]].flatMap((c, k) => [[0, 1.5], [2, 1.2]].flatMap(([beat, beats]) => c.map((m) => [k * 4 * b + beat * b + (m % 3) * 0.012, S.gain(S.struck(fromC4(m - 12), beats * b * hold, ring), -12)])));
    return S.at(16 * b + 1.5, pieces);
  };
  const long = spaceOf([chords(80, 1, 1.6)], SR);
  assert.ok(long.decayMs > 1000 && long.decayMs < 1500 && says(long, 'Long tails'), JSON.stringify(long));
});

test('known limit: the wet share of drums does not follow the mix (Fix round 5)', () => {
  // A hit has no end to find but a point on its fall (10 dB under its peak), so the share after it stays
  // about 0.1 however much of the sound is reverb: here half the energy is, and it reads 0.09. The
  // "Much of it is tail" line is not written for drums.
  const s = spaceOf([S.reverb(beatOf(150, 100, 0.4, 2, true), 1.5, 0.5)], SR);
  assert.ok(s.wetShare !== null && s.wetShare >= 0.04 && s.wetShare <= 0.16, JSON.stringify(s));
});

test('known limit: dense beats read nothing (Fix round 5)', () => {
  // Toms on every 16th at 120 bpm leave no hit room to end: nothing is said, dry or through a reverb
  const toms = S.every(8, 8, (i) => S.tom([220, 160, 120, 85][Math.floor(i / 4) % 4], 150));
  assert.deepEqual(spaceOf([toms], SR), none);
});

test('known limit: a gated reverb reads as dry (Fix round 5)', () => {
  // A snare a second with a 2.5 s reverb let through for 150 ms and then shut in 10 ms: the gate's edge
  // is a real stop, and that is what is timed (20 ms, a "Dry" line), not the reverb behind it.
  const snares = S.every(1, 8, (i) => S.burst(0.3, 60, 1, -6, i + 1));
  const wet = S.reverb(snares, 2.5, 1);
  const x = Float32Array.from(snares, (v, i) => {
    const u = (i / SR) % 1;
    return v + 3 * wet[i] * (u < 0.15 ? 1 : Math.max(0, 1 - (u - 0.15) / 0.01));
  });
  const s = spaceOf([x], SR);
  assert.ok(s.decayMs !== null && s.decayMs < 60 && says(s, 'Dry'), JSON.stringify(s));
});

// Carried into Task 3 from Task 2's last review (N1, N7, N8)
test('an echo reads alike at any sample rate (N1)', () => {
  // The likeness of a repeat to what it repeats is read over the same stretch of time at every rate, and
  // the repeat's window starts at its exact sample: at 88.2 and 96 kHz a 375 ms delay at feedback 0.7
  // lost its echo and read "Dry", and noise bursts through 375 and 625 ms delays read twice their lag
  for (const rate of [88200, 96000]) {
    const notes = S.melody(NOTES.map((s, i) => [fromC4(s), i * 0.75, 0.25]), 8, -6, rate);
    for (const [name, channels] of [['a 375 ms delay', [S.delay(notes, 0.375, 0.7, 8, rate)]], ['a 375 ms ping-pong', S.pingPong(notes, 0.375, 0.7, 8, rate)]]) {
      const s = spaceOf(channels, rate, 120);
      const what = `${name} at ${rate} Hz: ${JSON.stringify(s)}`;
      assert.ok(s.echo && Math.abs(s.echo.ms - 375) <= 5, what);
      assert.ok(!says(s, 'Dry'), what);
    }
  }
  const rate = 96000;
  for (const [name, make] of [['snares', (i) => S.burst(0.3, 40, 1, -6, i + 1, rate)], ['hats', (i) => S.burst(0.1, 10, 0.5, -10, i + 1, rate)]]) {
    const hits = S.every(1, 8, make, rate);
    for (const ms of [375, 625]) {
      const s = spaceOf([S.delay(hits, ms / 1000, 0.5, 8, rate)], rate);
      assert.ok(s.echo && Math.abs(s.echo.ms - ms) <= 5, `${name} once a second through a ${ms} ms delay at 96 kHz: ${JSON.stringify(s)}`);
    }
  }
});

test('sounds that stop at once have no tail width (N7)', () => {
  // A dry pluck the same in both channels, with a little noise of its own in each (a noise floor, or
  // dither): the "tails" are that noise, and read 40 dB wider. A sound called dry has no tail to be wide
  for (const db of [-120, -90]) {
    const s = spaceOf([S.mix(pluck, S.white(8, db, 1)), S.mix(pluck, S.white(8, db, 2))], SR);
    const what = `noise at ${db} dBFS: ${JSON.stringify(s)}`;
    assert.ok(s.decayMs !== null && s.decayMs < 150 && says(s, 'Dry'), what);
    assert.equal(s.tailWiderDb, null, what);
    assert.ok(!says(s, 'The tails are wider'), what);
  }
});

test('beside an echo, a decay under 150 ms is not given, nor its wet share (N8)', () => {
  // (the notes stop at once under repeats that ring on: what an agent reads in the data matches the words, which call nothing dry here)
  for (const [name, channels] of [['a 375 ms delay', [S.delay(pluck, 0.375, 0.5, 8)]], ['a 375 ms ping-pong', S.pingPong(pluck, 0.375, 0.7, 8)]]) {
    const s = spaceOf(channels, SR, 120);
    assert.ok(s.echo, `${name}: ${JSON.stringify(s)}`);
    assert.deepEqual({ decayMs: s.decayMs, wetShare: s.wetShare, tailWiderDb: s.tailWiderDb }, { decayMs: null, wetShare: null, tailWiderDb: null }, name);
  }
  // A decay of 150 ms or more beside an echo is still given
  const eighth = spaceOf([S.delay(pluck, 0.25, 0.5, 6)], SR, 120);
  assert.ok(eighth.echo && eighth.decayMs >= 150 && eighth.wetShare !== null, JSON.stringify(eighth));
});
