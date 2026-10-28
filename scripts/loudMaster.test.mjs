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
function drop(seconds = 8, gain = 0.6, dense = false, sr = SR, seed = 7) {
  const n = Math.round(seconds * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const beat = 60 / 145;
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
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

test('an export with a Loud master lands within 0.5 LU of Streaming, Loud and Club (a dense drop with some Crunch), peaks at or under -1 dBTP', () => {
  // (A dense drop doesn't reach Club cleanly any more: MAX_DISTORTION_DB stops it before the fizz, Crunch takes it there)
  for (const [id, dense, crunch] of [['streaming', false, 0], ['loud', false, 0], ['club', true, 0.3]]) {
    const [l, r] = drop(8, 0.6, dense);
    const target = L.LOUD_TARGETS[id].lufs;
    const master = loudMaster(id, crunch ? { crunch } : {});
    const stats = masterAfter(l, r, SR, master, 0, -1, [], target);
    const got = lufsOf(l, r);
    assert.ok(Math.abs(got - target) <= 0.5, `${id}: ${got.toFixed(2)} LUFS`);
    assert.ok(Math.abs(stats.loud.lufs - got) < 0.05, 'what it reports is what the file measures');
    assert.ok(dbtp(l, r) <= -1 + 1e-6, `${id}: true peak ${dbtp(l, r).toFixed(2)} dBTP`);
    assert.equal(stats.loud.shortDb, 0);
    assert.ok(stats.loud.distortionDb <= L.loudMaxDistortionDb(master));
  }
});

test('a long song is matched on a sample and checked on the whole: what it reports is what the whole song measures', () => {
  // A song with sections (quiet intro, drops, a breakdown), past MATCH_SAMPLE_FROM, at a low rate to be quick
  const sr = 22050;
  const parts = [
    [8, 0.05, false],
    [40, 0.5, false],
    [10, 0.1, false],
    [35, 0.7, true],
    [5, 0.02, false],
  ].map(([seconds, gain, dense], k) => drop(seconds, gain, dense, sr, k + 3));
  const n = parts.reduce((sum, [a]) => sum + a.length, 0);
  assert.ok(n >= L.MATCH_SAMPLE_FROM * sr);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let at = 0;
  for (const [a, b] of parts) {
    left.set(a, at);
    right.set(b, at);
    at += a.length;
  }
  // Club: it distorts first (the search's long case, where the sample takes over); Loud: on target
  for (const target of [-6, -9]) {
    const m = L.matchPush(left, right, sr, 0, target, L.LOUD_CLIPPER, -1);
    const [l, r] = L.clipAndLimit(left, right, sr, m.push, L.LOUD_CLIPPER, -1);
    const got = L.integratedLufs(l, r, sr);
    assert.ok(Math.abs(got - m.lufs) < 0.03, `${target}: reports ${m.lufs.toFixed(2)}, measures ${got.toFixed(2)}`);
    assert.ok(m.distortionDb <= L.MAX_DISTORTION_DB, `${target}: ${m.distortionDb.toFixed(2)} dB`);
    assert.ok(20 * Math.log10(truePeakOf([l, r])) <= -1 + 1e-6);
    if (target === -9) assert.ok(Math.abs(got + 9) < L.MATCH_TOLERANCE + 0.02 && m.shortDb === 0, JSON.stringify(m));
    else assert.ok(m.capped && m.shortDb > 0 && got > -8.5, JSON.stringify(m));
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

test('Crunch lets the same mix reach Club by clipping on purpose, under the same -1 dBTP ceiling; none is as before', async () => {
  const [l0, r0] = drop(8, 0.6);
  const clean = masterAfter(l0, r0, SR, loudMaster('club'), 0, -1, [], -6);
  const [l, r] = drop(8, 0.6);
  const crunchy = masterAfter(l, r, SR, loudMaster('club', { crunch: 1 }), 0, -1, [], -6);
  // Where the clean master stopped short, full Crunch gets there (or much nearer), with more distortion
  assert.ok(clean.loud.shortDb > 0.3, JSON.stringify(clean.loud));
  assert.ok(crunchy.loud.lufs > clean.loud.lufs + 0.3, `${crunchy.loud.lufs.toFixed(2)} vs ${clean.loud.lufs.toFixed(2)}`);
  assert.ok(crunchy.loud.distortionDb > L.MAX_DISTORTION_DB && crunchy.loud.distortionDb <= L.CRUNCH_MAX_DISTORTION_DB, JSON.stringify(crunchy.loud));
  assert.ok(dbtp(l, r) <= -1 + 1e-6, `true peak ${dbtp(l, r).toFixed(2)} dBTP`);
  // Halfway: the cap halfway; the clipper's knee harder as Crunch goes up (flat at full)
  const half = loudMaster('club', { crunch: 0.5 });
  assert.equal(L.loudMaxDistortionDb(half), (L.MAX_DISTORTION_DB + L.CRUNCH_MAX_DISTORTION_DB) / 2);
  assert.equal(L.loudMaxDistortionDb(loudMaster('club')), L.MAX_DISTORTION_DB);
  assert.equal(L.effectiveClipper(loudMaster('club')), L.LOUD_CLIPPER);
  assert.ok(L.effectiveClipper(half).softness < L.LOUD_CLIPPER.softness && L.effectiveClipper(half).softness > 0);
  assert.equal(L.effectiveClipper(loudMaster('club', { crunch: 1 })).softness, 0);
  // ...is the band kind (its peaks between samples stay near where it clips), and clips a little
  // under the limiter's ceiling, lower with more Crunch, so the limiter after it has next to nothing to do (it doesn't pump)
  assert.equal(L.effectiveClipper(loudMaster('club', { crunch: 1 })).band, true);
  assert.equal(L.effectiveClipper(half).band, true);
  assert.equal(L.effectiveClipper(loudMaster('club', { crunch: 1 })).ceiling, -1 - L.CRUNCH_CLIP_UNDER_DB - L.CRUNCH_CLIP_LOWER_DB);
  // (Under a lower export ceiling, an MP3's, by as much)
  assert.equal(L.effectiveClipper(loudMaster('club', { crunch: 1 }), -3).ceiling, -3 - L.CRUNCH_CLIP_UNDER_DB - L.CRUNCH_CLIP_LOWER_DB);
  assert.equal(L.effectiveClipper(loudMaster('club'), -3), L.LOUD_CLIPPER);
  assert.equal(L.LOUD_CLIPPER.band, undefined);
  // Every format's export is limited at -1 dBTP, Crunch or not (a compressed file is held under it once
  // decoded: encoders.ts), stems too (turned down together: encodeTogether)
  const { exportCeilingDbtp } = await import('../src/audio/effects/limiter.ts');
  for (const f of ['wav', 'mp3', 'ogg', 'mp4']) assert.equal(exportCeilingDbtp(f), -1);
  // (The Clipper insert, when on, plays as set: Crunch only bends the Loud master's own)
  const insert = { on: true, drive: 3, softness: 0.3, ceiling: -1 };
  assert.equal(L.effectiveClipper({ clipper: insert, loud: { ...T.defaultLoud(), on: true, crunch: 1 } }), insert);
  // A Loud master that's off has no Crunch
  assert.equal(L.loudCrunch({ loud: { ...T.defaultLoud(), crunch: 1 } }), 0);
});

test('with Crunch the limiter barely works on a dense, bright drop, so the mix does not pump with the drums', () => {
  // (The plain clipper Crunch had before: its output overshot the limiter by several dB on the
  // hats and the snare, and the limiter pulled the whole mix down after every hit)
  const crunchy = loudMaster('club', { crunch: 0.85 });
  const before = { ...crunchy, clipper: { on: true, drive: 0, softness: 0.075, ceiling: -0.925 } };
  const run = (m) => {
    const [l, r] = drop(6, 0.6, true);
    for (let i = 0; i < l.length; i++) {
      // brighter hats, as a crunchy drop has
      const h = 0.25 * Math.sin(i * 2.7) * Math.exp(-((i / SR) % 0.103) * 80);
      l[i] += h;
      r[i] -= h;
    }
    const stats = masterAfter(l, r, SR, m, 0, -1, [], -6);
    return { stats, lufs: lufsOf(l, r), tp: dbtp(l, r) };
  };
  const now = run(crunchy);
  const old = run(before);
  assert.ok(now.tp <= -1 + 1e-6, `true peak ${now.tp.toFixed(2)}`);
  assert.ok(now.stats.limiterPeakDb < old.stats.limiterPeakDb - 2, `limiter peak ${now.stats.limiterPeakDb.toFixed(2)} vs ${old.stats.limiterPeakDb.toFixed(2)} dB`);
  assert.ok(now.stats.limiterBusyShare < 0.1 && now.stats.limiterBusyShare < old.stats.limiterBusyShare / 3, `busy ${now.stats.limiterBusyShare} vs ${old.stats.limiterBusyShare}`);
  // ...and gets as loud with less push (the limiter isn't throwing the loudness away)
  assert.ok(now.lufs >= old.lufs - 0.2, `${now.lufs.toFixed(2)} vs ${old.lufs.toFixed(2)} LUFS`);
  assert.ok(now.stats.loud.push < old.stats.loud.push, `push ${now.stats.loud.push} vs ${old.stats.loud.push}`);
});

test('Crunch is optional in a project: absent reads as none and stays absent; out of range is clamped; it counts as a change', () => {
  const plain = T.normalizeLoud({ on: true, target: 'club', push: 3, subTilt: 0 });
  assert.equal('crunch' in plain, false);
  assert.equal('crunch' in T.normalizeLoud({ on: true, target: 'club', push: 3, subTilt: 0, crunch: 0 }), false);
  assert.equal(T.normalizeLoud({ on: true, crunch: 7 }).crunch, 1);
  assert.equal('crunch' in T.normalizeLoud({ on: true, crunch: -2 }), false);
  assert.equal(T.normalizeLoud({ on: true, crunch: 'x' }).crunch, undefined);
  const m = T.normalizeMasterSettings({ ...T.defaultMasterSettings(), loud: plain });
  const crunched = T.normalizeMasterSettings({ ...T.defaultMasterSettings(), loud: { ...plain, crunch: 0.4 } });
  assert.equal(crunched.loud.crunch, 0.4);
  assert.equal(T.sameMasterSettings(m, crunched), false);
  assert.equal(T.sameMasterSettings(m, T.normalizeMasterSettings(JSON.parse(JSON.stringify(m)))), true);
});

test('the MP3 ceiling holds the true peak under it with a Loud master too', async () => {
  const { exportCeilingDbtp } = await import('../src/audio/effects/limiter.ts');
  const ceiling = exportCeilingDbtp('mp3');
  const [l, r] = drop(8, 0.6, true);
  masterAfter(l, r, SR, loudMaster('club'), 0, ceiling, [], -6);
  assert.ok(dbtp(l, r) <= ceiling + 1e-6, `${dbtp(l, r).toFixed(2)}`);
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

test('an export keeps its push for live playback only from the whole song, full mix, at the Loud master target, at the live ceiling', async () => {
  const found = { push: 4.2, lufs: -9.1, targetLufs: -9, shortDb: 0, capped: false, distortionDb: -40, passes: 3 };
  const base = { wholeSong: true, fullMix: true, exportTargetLufs: -9, loudTargetLufs: -9, found, currentPush: 1, ceilingDbtp: -1 };
  assert.equal(L.pushToKeep(base), 4.2);
  assert.equal(L.pushToKeep({ ...base, wholeSong: false }), null, 'a loop region is other music');
  assert.equal(L.pushToKeep({ ...base, fullMix: false }), null, 'an underscore or no-drums version');
  assert.equal(L.pushToKeep({ ...base, exportTargetLufs: -14 }), null, 'another loudness target');
  assert.equal(L.pushToKeep({ ...base, found: undefined }), null);
  assert.equal(L.pushToKeep({ ...base, found: { ...found, lufs: -Infinity } }), null, 'silence found nothing');
  assert.equal(L.pushToKeep({ ...base, currentPush: 4.22 }), null, 'no change worth storing');
  // Every format's mixdown is limited at the live ceiling now, so an MP3's push is kept as a WAV's is;
  // a lower ceiling (one asked for specially) would play live hotter than the export
  const { exportCeilingDbtp } = await import('../src/audio/effects/limiter.ts');
  for (const f of ['wav', 'mp3', 'ogg', 'mp4']) assert.equal(L.pushToKeep({ ...base, ceilingDbtp: exportCeilingDbtp(f) }), 4.2, f);
  assert.equal(L.pushToKeep({ ...base, ceilingDbtp: -2 }), null, 'a lower ceiling');
});

test('a Loud match keeps its push only if the Loud master is still the one it rendered (no undo or Crunch press during it)', () => {
  const loud = { on: true, target: 'club', push: 2, crunch: 0 };
  assert.equal(L.sameLoudMatch(loud, { ...loud, push: 3 }), true, 'the push itself may differ');
  assert.equal(L.sameLoudMatch(loud, { ...loud, crunch: L.POCKET_CRUNCH }), false, 'Crunch pressed');
  assert.equal(L.sameLoudMatch(loud, { ...loud, target: 'loud' }), false, 'another target');
  assert.equal(L.sameLoudMatch(loud, { ...loud, on: false }), false, 'switched off (undone)');
  assert.equal(L.sameLoudMatch(loud, undefined), false);
  assert.equal(L.sameLoudMatch({ ...loud, crunch: undefined }, loud), true, 'no Crunch is Crunch 0');
});

// ffmpeg, where it's installed, as the outside reference: its MP3 decoder and its ebur128 true peak
const { execFileSync } = await import('node:child_process');
const fs = await import('node:fs');
const os = await import('node:os');
const pathMod = await import('node:path');
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** A 32-bit float stereo WAV of `l` / `r`. */
function floatWav(l, r) {
  const n = l.length;
  const b = Buffer.alloc(44 + n * 8);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 8, 28);
  b.writeUInt16LE(8, 32);
  b.writeUInt16LE(32, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) {
    b.writeFloatLE(l[i], 44 + i * 8);
    b.writeFloatLE(r[i], 48 + i * 8);
  }
  return b;
}

/** ffmpeg's ebur128 true peak of a file, dBTP (the most of either channel over the whole file). */
function ffmpegTruePeak(file, dir) {
  let most = 0;
  for (const ch of [0, 1]) {
    const out = pathMod.join(dir, `tp${ch}.txt`);
    execFileSync('ffmpeg', ['-v', 'error', '-nostats', '-i', file, '-af', `ebur128=peak=true:metadata=1,ametadata=print:key=lavfi.r128.true_peaks_ch${ch}:file=${out}`, '-f', 'null', '-']);
    for (const line of fs.readFileSync(out, 'utf8').split('\n')) if (line.includes('true_peaks')) most = Math.max(most, Number(line.split('=')[1]));
  }
  return 20 * Math.log10(most);
}

/** Samples of a stereo 32-bit float WAV as ffmpeg writes it (WAVE_FORMAT_EXTENSIBLE or plain). */
function readFloatWav(file) {
  const b = fs.readFileSync(file);
  let p = 12;
  let data;
  while (p < b.length) {
    const id = b.toString('ascii', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  const n = data.length / 8;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = data.readFloatLE(i * 8);
    r[i] = data.readFloatLE(i * 8 + 4);
  }
  return [l, r];
}

test("a Club-loud MP3 export plays back under -1 dBTP: the app's own encoder, decoded by ffmpeg; the meter reads as ffmpeg does", { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const { exportCeilingDbtp } = await import('../src/audio/effects/limiter.ts');
  const { encodeAudio } = await import('../src/audio/encoders.ts');
  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'loud-mp3-'));
  try {
    const [l, r] = drop(8, 0.6, true);
    masterAfter(l, r, SR, loudMaster('club'), 0, exportCeilingDbtp('mp3'), [], -6);
    fs.writeFileSync(pathMod.join(dir, 'master.wav'), floatWav(l, r));
    // The meter here and ffmpeg's agree on the master (BS.1770's 4x example filter read 0.3 dB low)
    const ours = dbtp(l, r);
    const theirs = ffmpegTruePeak(pathMod.join(dir, 'master.wav'), dir);
    assert.ok(Math.abs(ours - theirs) <= 0.2, `meter ${ours.toFixed(2)}, ffmpeg ${theirs.toFixed(2)} dBTP`);
    // As the export makes it: LAME at 320 kb/s, decoded (by ffmpeg here, the browser in the app) and
    // turned down by what it overshot -1 dBTP
    let trim = -1;
    const decode = async (bytes) => {
      fs.writeFileSync(pathMod.join(dir, 'try.mp3'), Buffer.from(bytes));
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', pathMod.join(dir, 'try.mp3'), '-c:a', 'pcm_f32le', pathMod.join(dir, 'try.wav')]);
      return readFloatWav(pathMod.join(dir, 'try.wav'));
    };
    const mp3 = await encodeAudio([l, r], SR, 'mp3', { bitDepth: 16, decode, onHeld: (h) => (trim = h.trimDb) });
    fs.writeFileSync(pathMod.join(dir, 'export.mp3'), Buffer.from(await mp3.arrayBuffer()));
    // (A dense, clipped drop overshoots by up to about a dB: no more than that comes off)
    assert.ok(trim >= 0 && trim < 1.5, `turned down ${trim.toFixed(2)} dB`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', pathMod.join(dir, 'export.mp3'), '-c:a', 'pcm_f32le', pathMod.join(dir, 'decoded.wav')]);
    const decoded = ffmpegTruePeak(pathMod.join(dir, 'decoded.wav'), dir);
    assert.ok(decoded <= -1, `decoded MP3 peaks at ${decoded.toFixed(2)} dBTP`);
    const [dl, dr] = readFloatWav(pathMod.join(dir, 'decoded.wav'));
    assert.ok(dbtp(dl, dr) <= -1, `decoded MP3 by the meter here: ${dbtp(dl, dr).toFixed(2)} dBTP`);
    assert.ok(Math.abs(lufsOf(l, r) + 6) <= 0.5, `the master Club-loud: ${lufsOf(l, r).toFixed(2)} LUFS`);
    assert.ok(lufsOf(dl, dr) > -7.5, `the MP3 still Club-loud: ${lufsOf(dl, dr).toFixed(2)} LUFS`);
    // Decoded to the exact sample (the Info frame: mp3Gapless.ts)
    assert.equal(dl.length, l.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the export's master section in its Worker comes out exactly as run on the page, its match's progress moving on", async () => {
  const { runMasterJob } = await import('../src/audio/effects/masterAfter.ts');
  // The Worker's own script, with `self` standing in for its scope
  const posted = [];
  globalThis.self = { postMessage: (m) => posted.push(m) };
  await import('../src/audio/effects/masterAfterWorker.ts');
  const onmessage = globalThis.self.onmessage;
  delete globalThis.self;
  for (const [seconds, dense, target] of [[12, true, -6], [10, false, -9]]) {
    const [l, r] = drop(seconds, 0.6, dense);
    const master = loudMaster(target === -6 ? 'club' : 'loud');
    const drops = [{ fx: 0, from: SR, to: 2 * SR, sixteenth: Math.round(SR / 9.7) }];
    // On the page
    const a = [l.slice(), r.slice()];
    const progress = [];
    const here = masterAfter(a[0], a[1], SR, master, 0, -1, drops, target, (f) => progress.push(f));
    // As a message to the Worker (copied as postMessage copies it), and back
    posted.length = 0;
    onmessage({ data: structuredClone({ left: l.slice(), right: r.slice(), sampleRate: SR, master, volumeDb: 0, ceilingDbtp: -1, drops, matchLufs: target }) });
    const reply = posted.at(-1);
    assert.equal(reply.error, undefined);
    assert.deepEqual(reply.stats, here);
    for (const [k, ch] of [reply.left, reply.right].entries()) for (let i = 0; i < ch.length; i++) if (!Object.is(ch[i], a[k][i])) assert.fail(`channel ${k}, sample ${i} differs`);
    assert.deepEqual(posted.slice(0, -1).map((m) => m.progress), progress);
    // Progress only goes on, and ends at 1
    assert.ok(progress.length >= 2 && progress.every((f, i) => f >= (progress[i - 1] ?? 0) && f <= 1), JSON.stringify(progress));
    assert.equal(progress.at(-1), 1);
    // One channel: the job without its right is masterAfter over the one array twice
    const m1 = l.slice();
    const m2 = l.slice();
    assert.deepEqual(runMasterJob({ left: m1, sampleRate: SR, master, volumeDb: 0, ceilingDbtp: -1, drops: [], matchLufs: target }), masterAfter(m2, m2, SR, master, 0, -1, [], target));
    assert.deepEqual(m1, m2);
  }
});

test('distortion is measured on each channel: clipping that only changes the difference between them counts', () => {
  const n = SR;
  const x = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 100 * i) / SR));
  const minus = x.map((v) => -v);
  // Left clipped, right clipped the opposite way: their sum (what the old measure heard) is untouched
  const clip = (v) => Math.max(-0.3, Math.min(0.3, v));
  const outL = x.map(clip);
  const outR = minus.map(clip);
  const db = L.distortionDb(x, minus, outL, outR, SR, 0);
  assert.ok(db > -25 && db < -5, `${db} dB`);
  assert.equal(L.distortionDb(x, minus, x, minus, SR, 0), -Infinity);
  // One channel (left and right the same arrays) is measured once, the same as two equal channels
  assert.ok(Math.abs(L.distortionDb(x, x, outL, outL, SR, 0) - L.distortionDb(x, x.slice(), outL, outL.slice(), SR, 0)) < 1e-9);
});

test('a little Crunch still lets a match reach about as far as before the cap moved; none stops before the fizz', () => {
  assert.equal(L.MAX_DISTORTION_DB, -24);
  assert.equal(L.loudMaxDistortionDb(loudMaster('club')), -24);
  assert.ok(Math.abs(L.loudMaxDistortionDb(loudMaster('club', { crunch: 0.4 })) - -17.4) < 1e-9);
  assert.equal(L.loudMaxDistortionDb(loudMaster('club', { crunch: 1 })), L.CRUNCH_MAX_DISTORTION_DB);
});

test('the split or whole-sound kind: the one nearer the target, else the split kind only when clearly cleaner', () => {
  const m = (shortDb, distortionDb) => ({ push: 5, lufs: -9 - shortDb, targetLufs: -9, shortDb, capped: shortDb > 0, distortionDb, passes: 2 });
  assert.equal(L.pickSplit(m(0, -22), m(0, -25)), true);
  assert.equal(L.pickSplit(m(0, -22), m(0, -22.3)), false, 'not by a hair');
  assert.equal(L.pickSplit(m(0, -22), m(1, -30)), false, 'short of the target');
  assert.equal(L.pickSplit(m(1, -22), m(0, -20)), true, 'the other one gets there');
});

test('with Crunch an export tries both kinds of clipper and says which it took; the clipper then plays that kind', () => {
  const [l, r] = drop(8, 0.6);
  const master = loudMaster('loud', { crunch: 0.3 });
  const stats = masterAfter(l, r, SR, master, 0, -1, [], -9);
  assert.equal(typeof stats.loud.split, 'boolean');
  assert.ok(Math.abs(stats.loud.lufs - lufsOf(l, r)) < 0.05, 'what it reports is what the file measures');
  assert.ok(dbtp(l, r) <= -1 + 1e-6);
  const clip = L.effectiveClipper({ ...master, loud: { ...master.loud, split: true } });
  assert.equal(clip.split, true);
  assert.equal(clip.band, true);
  // Without Crunch there's one kind, and nothing to choose
  const [a, b] = drop(8, 0.6);
  assert.equal(masterAfter(a, b, SR, loudMaster('loud'), 0, -1, [], -9).loud.split, undefined);
  assert.equal(L.effectiveClipper({ ...loudMaster('loud'), loud: { ...loudMaster('loud').loud, split: true } }).split, undefined, 'the split kind is a Crunch one');
});

test('an export keeps the kind it found for live playback, with its push, under the same conditions', () => {
  const found = { push: 4.2, lufs: -9, targetLufs: -9, shortDb: 0, capped: false, distortionDb: -25, passes: 2, split: true };
  const base = { wholeSong: true, fullMix: true, exportTargetLufs: -9, loudTargetLufs: -9, found, currentPush: 0, ceilingDbtp: -1 };
  assert.deepEqual(L.loudToKeep(base), { push: 4.2, split: true });
  assert.deepEqual(L.loudToKeep({ ...base, currentPush: 4.2 }), { split: true }, 'the kind alone changed');
  assert.equal(L.loudToKeep({ ...base, currentPush: 4.2, currentSplit: true }), null);
  assert.deepEqual(L.loudToKeep({ ...base, found: { ...found, split: false }, currentSplit: true }), { push: 4.2, split: false });
  assert.equal(L.loudToKeep({ ...base, wholeSong: false }), null);
  assert.deepEqual(L.loudToKeep({ ...base, found: { ...found, split: undefined } }), { push: 4.2 }, 'no Crunch: the push alone');
  // Stored and read back with the project; it changes how the master sounds
  assert.equal(T.normalizeLoud({ on: true, split: true }).split, true);
  assert.equal('split' in T.normalizeLoud({ on: true, split: 'yes' }), false);
  const a = loudMaster('loud', { crunch: 0.3 });
  assert.equal(T.sameMasterSettings(a, { ...a, loud: { ...a.loud, split: true } }), false);
});
