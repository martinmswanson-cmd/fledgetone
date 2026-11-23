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
  assert.deepEqual(words({ echo: { ms: 250, repeats: 4, note: '1/8' } }), ['An echo every 250 ms (1/8 notes), 4 repeats standing out.']);
  assert.deepEqual(words({ echo: { ms: 375, repeats: 3 } }), ['An echo every 375 ms, 3 repeats standing out.']);
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
  const x = reverbed.get(3);
  const report = hearSound([x, x], SR, { engine: 'test', tempoBpm: 120, along: false });
  assert.deepEqual(report.space, spaces.get(3));
  assert.ok(report.space.decayMs > 1000, JSON.stringify(report.space));
  assert.ok(report.words.includes(`Long tails: sounds ring on, falling 20 dB in ${(report.space.decayMs / 1000).toFixed(1)} s.`), report.words.join(' / '));
  assert.equal(hearSound([x.subarray(0, Math.round(0.3 * SR))], SR, { engine: 'test' }).space, undefined, 'under 0.4 s there is no space group');
});
