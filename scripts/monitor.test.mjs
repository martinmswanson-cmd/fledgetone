// The listening path (src/audio/monitor.ts): level matching that never rises faster than its limit,
// falls fast when a loud part arrives, holds in silence; the volume; the safety limiter. And that
// exports leave the listening volume out (src/audio/exportWav.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

// monitor.ts imports Tone for the worklet's install only; the kernel is plain maths
const M = await import('../src/audio/monitor.ts');
const { kWeightingFilters, createLoudnessAnalyser } = await import('../src/audio/loudness.ts');

const SR = 48000;
const [shelf, highpass] = kWeightingFilters(SR);
const kernel = () => M.createMonitorKernel(SR, shelf, highpass, M.MONITOR_CONSTANTS);

/** A 1 kHz-ish band of noise at `lufs` (about), `seconds` long, and silence for a negative level. */
function part(seconds, amp) {
  const n = Math.round(seconds * SR);
  const x = new Float32Array(n);
  let s = 3;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    x[i] = amp * (Math.sin((2 * Math.PI * 997 * i) / SR) * 0.7 + ((s / 2 ** 32) * 2 - 1) * 0.3);
  }
  return x;
}

/** Run the kernel over `x` (both sides) in 128-sample blocks; returns the output and the gain read every 100 ms. */
function run(k, x, params = { match: 1, volume: 1, target: M.MONITOR_TARGET_LUFS }) {
  const out = new Float32Array(x.length);
  const outR = new Float32Array(x.length);
  const gains = [];
  const every = SR / 10;
  for (let at = 0; at < x.length; at += 128) {
    const n = Math.min(128, x.length - at);
    k.process(x.subarray(at, at + n), x.subarray(at, at + n), out.subarray(at, at + n), outR.subarray(at, at + n), n, params);
    if (Math.floor((at + n) / every) > Math.floor(at / every)) gains.push(k.read().gainDb);
  }
  return { out, gains };
}

const lufsOf = (x) => {
  const a = createLoudnessAnalyser(SR, undefined, undefined, false);
  a.feed(x, x, x.length);
  return a.read().integrated;
};

test('the matching gain never rises faster than its limit, however quiet the song gets', () => {
  const k = kernel();
  // Loud, then very quiet for a long time
  const x = new Float32Array(SR * 30);
  x.set(part(6, 0.7), 0);
  x.set(part(24, 0.01), SR * 6);
  const { gains } = run(k, x);
  for (let i = 1; i < gains.length; i++) {
    const rise = (gains[i] - gains[i - 1]) / 0.1;
    assert.ok(rise <= M.MONITOR_RISE_DB_PER_S + 0.15, `rose ${rise.toFixed(2)} dB/s at ${(i / 10).toFixed(1)} s`);
  }
  assert.ok(gains[gains.length - 1] <= M.MONITOR_MAX_DB + 1e-9);
});

test('a song is heard at about the target loudness, a loud master turned down fast, a quiet one up slowly', () => {
  for (const amp of [0.9, 0.05]) {
    const k = kernel();
    const { out, gains } = run(k, part(25, amp));
    const tail = out.subarray(out.length - SR * 5);
    const heard = lufsOf(tail);
    const dry = lufsOf(part(5, amp));
    const want = Math.min(M.MONITOR_TARGET_LUFS, dry + M.MONITOR_MAX_DB);
    assert.ok(Math.abs(heard - want) < 1, `amp ${amp}: heard ${heard.toFixed(1)} LUFS (dry ${dry.toFixed(1)})`);
    if (amp > 0.5) {
      // Down by most of the way within 2 s (it starts at -6 dB and falls at up to 30 dB/s)
      assert.ok(gains[20] < M.MONITOR_TARGET_LUFS - dry + 2, `gain after 2 s ${gains[20]}`);
    }
  }
});

test('a loud drop after a quiet intro is caught at once (50 ms), then held near the target; the gain never jumps up', () => {
  const k = kernel();
  const x = new Float32Array(SR * 20);
  x.set(part(12, 0.03), 0);
  x.set(part(8, 1), SR * 12);
  const { out, gains } = run(k, x);
  const lufsOver = (from, seconds) => lufsOf(out.subarray(Math.round(from * SR), Math.round((from + seconds) * SR)));
  // Past its first 60 ms, no 50 ms of the drop is more than the fast headroom over the target...
  for (let t = 12.06; t < 13; t += 0.05) assert.ok(lufsOver(t, 0.05) <= M.MONITOR_TARGET_LUFS + M.MONITOR_FAST_HEADROOM + 1, `${t.toFixed(2)} s: ${lufsOver(t, 0.05).toFixed(1)}`);
  // ...and from half a second in, no 400 ms is more than the momentary headroom over it
  for (let t = 12.5; t < 19.5; t += 0.1) assert.ok(lufsOver(t, 0.4) <= M.MONITOR_TARGET_LUFS + M.MONITOR_MOMENTARY_HEADROOM + 0.5, `${t.toFixed(2)} s: ${lufsOver(t, 0.4).toFixed(1)}`);
  for (let i = 1; i < gains.length; i++) assert.ok(gains[i] - gains[i - 1] <= M.MONITOR_RISE_DB_PER_S * 0.1 + 0.015);
});

test("a loud, punchy beat is matched steadily: the kicks don't make the listening level pump", () => {
  const k = kernel();
  const n = SR * 20;
  const x = new Float32Array(n);
  const beat = 60 / 140;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const b = t % beat;
    x[i] = 0.9 * Math.exp(-b * 25) * Math.sin(2 * Math.PI * (55 + 100 * Math.exp(-b * 40)) * b) + 0.25 * Math.sin(2 * Math.PI * 220 * t) * (1 - Math.exp(-b * 8));
  }
  const { gains } = run(k, x);
  const settled = gains.slice(100);
  const spread = Math.max(...settled) - Math.min(...settled);
  assert.ok(spread < 1, `the gain moved ${spread.toFixed(2)} dB once settled`);
});

test('silence holds the gain where it was (no creeping up between songs)', () => {
  const k = kernel();
  const x = new Float32Array(SR * 16);
  x.set(part(6, 0.8), 0);
  const { gains } = run(k, x);
  const at6 = gains[60];
  assert.ok(Math.abs(gains[gains.length - 1] - at6) < 0.2, `${at6} -> ${gains[gains.length - 1]}`);
});

test('level matching off: the gain goes back to 0 dB, no faster than it may rise', () => {
  const k = kernel();
  run(k, part(5, 0.9));
  const { gains } = run(k, part(20, 0.9), { match: 0, volume: 1, target: M.MONITOR_TARGET_LUFS });
  for (let i = 1; i < gains.length; i++) assert.ok(gains[i] - gains[i - 1] <= M.MONITOR_RISE_DB_PER_S * 0.1 + 0.015);
  assert.ok(Math.abs(gains[gains.length - 1]) < 0.01);
});

test('the safety limiter holds every sample under its ceiling, whatever the volume', () => {
  const k = kernel();
  const x = part(3, 1);
  // Matching off, +12 dB of volume: far over full scale before the limiter
  const { out } = run(k, x, { match: 0, volume: 4, target: -15 });
  const ceiling = 10 ** (M.MONITOR_CEILING_DB / 20);
  for (let i = 0; i < out.length; i++) assert.ok(Math.abs(out[i]) <= ceiling + 1e-7, `sample ${i}: ${out[i]}`);
});

test('exports leave the listening volume out: the render never reads it', () => {
  const src = readFileSync(new URL('../src/audio/exportWav.ts', import.meta.url), 'utf8');
  assert.ok(!/getMasterVolume|listeningVolume/.test(src), 'exportWav.ts reads the listening volume');
  assert.ok(/const masterDb = 0;/.test(src));
  for (const f of ['../src/pocket/pocketExport.ts', '../src/audio/mixStudio.ts', '../src/audio/effects/masterAfter.ts']) {
    assert.ok(!/getMasterVolume|listeningVolume/.test(readFileSync(new URL(f, import.meta.url), 'utf8')), f);
  }
});

test('level-matched is only reported once the listening path is in; a failed install says so and keeps the Loud push out of live playback', async () => {
  assert.equal(M.isMatched(true, 'on'), true);
  assert.equal(M.isMatched(true, 'pending'), false);
  assert.equal(M.isMatched(true, 'off'), false);
  assert.equal(M.isMatched(false, 'on'), false);
  const seen = [];
  const stop = M.onMonitorReading((st) => seen.push(st));
  assert.equal(seen[0].status, 'pending');
  assert.equal(seen[0].matched, false);
  // A context without AudioWorklet (a plain-http address): the install fails and the listeners hear it
  const volumes = [];
  await M.installMonitor({ rawContext: {}, sampleRate: SR }, {}, {}, (db) => volumes.push(db));
  stop();
  const last = seen[seen.length - 1];
  assert.equal(last.status, 'off');
  assert.equal(last.matched, false);
  assert.equal(M.monitorStatus(), 'off');
  const { livePushDb, pushDb } = await import('../src/audio/effects/loudMaster.ts');
  const m = { loud: { on: true, target: 'club', push: 7, subTilt: 0 } };
  assert.equal(livePushDb(m, true), 7);
  assert.equal(livePushDb(m, false), 0, 'never louder without the safety limiter');
  assert.equal(livePushDb({ loud: { ...m.loud, push: -2 } }, false), -2);
  assert.equal(pushDb(m), 7, 'the export keeps the push');
});
