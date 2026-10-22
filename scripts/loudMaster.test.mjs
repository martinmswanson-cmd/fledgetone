// The Loud master (src/audio/effects/loudMaster.ts) as the export runs it (masterAfter.ts): the push
// into the clipper and limiter found by measuring, the loudness targets, the true-peak ceiling,
// mono lows whatever the Width, and old projects' masters left as they were. Run with `npm test`.
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

const L = await import('../src/audio/effects/loudMaster.ts');
const { masterAfter } = await import('../src/audio/effects/masterAfter.ts');
const { truePeakOf } = await import('../src/audio/loudness.ts');
const T = await import('../src/store/timelineTypes.ts');

const SR = 44100;

/**
 * A drop-like stereo mix at 145 BPM: a kick on every beat, a snare on 3, a sub, a filtered growl
 * (a saw stack, or `dense`: saturated almost square, as a loud bass-music growl is), noise and hats.
 * About 12 dB of peaks over the body as it is; `gain` scales it all.
 */
function drop(seconds = 8, gain = 0.6, dense = false) {
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const beat = 60 / 145;
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const b = t % beat;
    const bar = t % (4 * beat);
    const kick = Math.exp(-b * 30) * Math.sin(2 * Math.PI * (50 + 120 * Math.exp(-b * 40)) * b) * 0.5;
    const sn = bar >= 2 * beat && bar < 2 * beat + 0.2 ? Math.exp(-(bar - 2 * beat) * 30) * rnd() * 0.4 : 0;
    const sub = 0.12 * Math.sin(2 * Math.PI * 43.65 * t);
    let saw = 0;
    for (let k = 0; k < 5; k++) saw += ((t * (87.3 * (1 + (k - 2) * 0.004)) + k * 0.31) % 1) * 2 - 1;
    lp1 += 0.25 * (saw * 0.08 - lp1);
    lp2 += 0.25 * (lp1 - lp2);
    const body = dense ? Math.tanh(lp2 * 12) * 0.3 : lp2 * 3;
    const noise = rnd() * 0.05;
    const hat = 0.05 * rnd() * Math.exp(-((t + beat / 2) % (beat / 2)) * 60);
    l[i] = gain * (kick + sn + sub + body + noise + hat);
    r[i] = gain * (kick + sn * 0.9 + sub + body * 0.87 - noise - hat);
  }
  return [l, r];
}

const lufsOf = (l, r) => L.integratedLufs(l, r, SR);
const dbtp = (l, r) => 20 * Math.log10(truePeakOf([l, r]));
const loudMaster = (target, extra = {}) => ({ ...T.defaultMasterSettings(), loud: { ...T.defaultLoud(), on: true, target, ...extra } });

test('an export with a Loud master lands within 0.5 LU of Streaming, Loud and Club, peaks at or under -1 dBTP', () => {
  for (const [id, dense] of [['streaming', false], ['loud', false], ['club', true]]) {
    const [l, r] = drop(8, 0.6, dense);
    const target = L.LOUD_TARGETS[id].lufs;
    const stats = masterAfter(l, r, SR, loudMaster(id), 0, -1, [], target);
    const got = lufsOf(l, r);
    assert.ok(Math.abs(got - target) <= 0.5, `${id}: ${got.toFixed(2)} LUFS`);
    assert.ok(Math.abs(stats.loud.lufs - got) < 0.05, 'what it reports is what the file measures');
    assert.ok(dbtp(l, r) <= -1 + 1e-6, `${id}: true peak ${dbtp(l, r).toFixed(2)} dBTP`);
    assert.equal(stats.loud.shortDb, 0);
    assert.ok(stats.loud.distortionDb <= L.MAX_DISTORTION_DB);
  }
});

test('a mix that would distort before Club stops short (cleanly) and says so', () => {
  const [l, r] = drop(8, 0.6);
  const stats = masterAfter(l, r, SR, loudMaster('club'), 0, -1, [], -6);
  assert.ok(stats.loud.capped && stats.loud.shortDb > 0.3, JSON.stringify(stats.loud));
  assert.ok(stats.loud.distortionDb <= L.MAX_DISTORTION_DB);
  assert.ok(stats.loud.distortionDb > L.MAX_DISTORTION_DB - 2, 'as loud as it can be cleanly');
  assert.ok(lufsOf(l, r) > -9, 'still louder than Loud');
});

test('the MP3 ceiling holds the true peak at -1.5 dBTP with a Loud master too', () => {
  const [l, r] = drop(8, 0.6, true);
  masterAfter(l, r, SR, loudMaster('club'), 0, -1.5, [], -6);
  assert.ok(dbtp(l, r) <= -1.5 + 1e-6, `${dbtp(l, r).toFixed(2)}`);
  assert.ok(Math.abs(lufsOf(l, r) + 6) <= 0.5);
});

test('a loud mix is turned down to Streaming, a quiet one up, both through the same path', () => {
  for (const gain of [0.15, 1.5]) {
    const [l, r] = drop(6, gain);
    const stats = masterAfter(l, r, SR, loudMaster('streaming'), 0, -1, [], -14);
    assert.ok(Math.abs(lufsOf(l, r) + 14) <= 0.5, `gain ${gain}: ${lufsOf(l, r).toFixed(2)}`);
    assert.ok(gain > 1 ? stats.loud.push < 0 : stats.loud.push > 0);
  }
});

test('without a match, a Loud master plays the push it was given (as live playback does)', () => {
  const [a, b] = drop(4, 0.6, true);
  const found = masterAfter(a, b, SR, loudMaster('club'), 0, -1, [], -6).loud.push;
  const [l, r] = drop(4, 0.6, true);
  const stats = masterAfter(l, r, SR, loudMaster('club', { push: found }));
  assert.equal(stats.loud, undefined);
  for (let i = 0; i < l.length; i += 997) assert.ok(Math.abs(l[i] - a[i]) < 1e-6, `sample ${i}`);
});

test('a song that cannot get there cleanly stops at the most push, and says so', () => {
  const [l, r] = drop(4, 0.01);
  const stats = masterAfter(l, r, SR, loudMaster('club'), 0, -1, [], -6);
  assert.equal(stats.loud.push, T.LOUD_PUSH_MAX);
  assert.ok(stats.loud.shortDb > 1 && stats.loud.capped);
});

test('mono lows: under 120 Hz in the middle with the Width off, and with a Width that kept them wide', () => {
  const n = SR * 2;
  const make = () => {
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const lo = 0.3 * Math.sin((2 * Math.PI * 50 * i) / SR);
      const hi = 0.2 * Math.sin((2 * Math.PI * 2000 * i) / SR);
      l[i] = lo + hi;
      r[i] = -lo + hi * 0.5;
    }
    return [l, r];
  };
  const sideLow = (l, r) => {
    // 50 Hz in the side signal over the last second
    let re = 0;
    let im = 0;
    for (let i = n / 2; i < n; i++) {
      const sd = (l[i] - r[i]) / 2;
      re += sd * Math.cos((2 * Math.PI * 50 * i) / SR);
      im += sd * Math.sin((2 * Math.PI * 50 * i) / SR);
    }
    return Math.hypot(re, im) / (n / 2);
  };
  const [l0, r0] = make();
  const before = sideLow(l0, r0);
  for (const master of [
    { ...T.defaultMasterSettings(), monoLow: true },
    { ...T.defaultMasterSettings(), monoLow: true, width: { on: true, amount: 1.5, monoBass: false } },
    { ...T.defaultMasterSettings(), loud: { ...T.defaultLoud(), on: true } },
  ]) {
    const [l, r] = make();
    masterAfter(l, r, SR, master);
    assert.ok(sideLow(l, r) < before * 0.1, `side 50 Hz ${sideLow(l, r)} of ${before}`);
  }
  // Off (an old project): the low side stays
  const [l, r] = make();
  masterAfter(l, r, SR, T.defaultMasterSettings());
  assert.ok(sideLow(l, r) > before * 0.9);
});

test('the sub tilt is a 90 Hz low shelf: its gain at the bottom, nothing at the top', () => {
  const c = L.webAudioLowshelf(90, 3, SR);
  const at = (hz) => {
    const w = (2 * Math.PI * hz) / SR;
    const re = (k) => Math.cos(-k * w);
    const im = (k) => Math.sin(-k * w);
    const num = [c[0] + c[1] * re(1) + c[2] * re(2), c[1] * im(1) + c[2] * im(2)];
    const den = [1 + c[3] * re(1) + c[4] * re(2), c[3] * im(1) + c[4] * im(2)];
    return 20 * Math.log10(Math.hypot(...num) / Math.hypot(...den));
  };
  assert.ok(Math.abs(at(10) - 3) < 0.1);
  assert.ok(Math.abs(at(90) - 1.5) < 0.2, `${at(90)}`);
  assert.ok(Math.abs(at(5000)) < 0.05);
});

test('old masters (no Loud, no mono lows) sound as before; new songs get mono lows, a Loud master is opt-in', () => {
  const old = T.normalizeMasterSettings({ glue: 'tight', level: 2, width: { on: false, amount: 1.3, monoBass: true } });
  assert.equal(old.monoLow, undefined);
  assert.equal(old.loud, undefined);
  assert.equal(L.effectiveWidth(old), null);
  assert.equal(L.effectiveClipper(old), undefined);
  assert.equal(L.pushDb(old), 0);
  const kept = T.normalizeMasterSettings({ monoLow: true, loud: { on: true, target: 'club', push: 99, subTilt: -9 } });
  assert.equal(kept.monoLow, true);
  assert.deepEqual(kept.loud, { on: true, target: 'club', push: T.LOUD_PUSH_MAX, subTilt: T.LOUD_TILT_MIN });
  assert.equal(T.sameMasterSettings(old, { ...old, loud: { ...T.defaultLoud(), on: false } }), true, 'a Loud master switched off is no change');
  assert.equal(T.sameMasterSettings(old, { ...old, monoLow: true }), false);
  // The Clipper insert's settings win over the Loud master's own
  const own = { on: true, drive: 6, softness: 1, ceiling: -3 };
  assert.deepEqual(L.effectiveClipper({ clipper: own, loud: { on: true } }), own);
  assert.deepEqual(L.effectiveClipper({ loud: { on: true } }), L.LOUD_CLIPPER);
  assert.equal(L.styleLoudTarget('futurebass'), 'loud');
  assert.equal(L.styleLoudTarget('dubstep'), 'club');
});
