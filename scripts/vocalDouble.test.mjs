// Unit tests for doubling a vocal take (src/audio/vocalDouble.ts). Run with `npm test`.
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
const { doubleTake, planDouble, offsetCurve, shiftByCurve, doubleSeed, DOUBLE_DEFAULTS } = await import('../src/audio/vocalDouble.ts');
const { detectPitch } = await import('../src/audio/vocalTune.ts');
const { testVoice } = await import('./audio-check/testVoice.mjs');

const SR = 44100;
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const median = (a) => [...a].sort((p, q) => p - q)[a.length >> 1];

test('a double is the same every time for the same take, and different for another', () => {
  const v = testVoice({ style: 'rap' }).samples;
  const a = doubleTake([v], SR, { seed: doubleSeed('clip-1') });
  const b = doubleTake([v], SR, { seed: doubleSeed('clip-1') });
  const c = doubleTake([v], SR, { seed: doubleSeed('clip-2') });
  assert.deepEqual(a.channels[0], b.channels[0]);
  assert.deepEqual(a.channels[1], b.channels[1]);
  assert.notDeepEqual(a.channels[0], c.channels[0]);
  // Two sides, each as long as the take and about as loud (within 1.5 dB)
  for (const ch of a.channels) {
    assert.equal(ch.length, v.length);
    assert.ok(Math.abs(20 * Math.log10(rms(ch) / rms(v))) < 1.5);
  }
  // The rap has many phrases, each with its own offset
  assert.ok(a.plans[0].phrases.length >= 8, `${a.plans[0].phrases.length} phrases`);
});

test('every phrase is a little early or late and a few cents off, the sides opposite in pitch', () => {
  const phrases = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + 0.8 }));
  for (const seed of [1, 2, 3, 99]) {
    const [l, r] = [planDouble(phrases, 0, { seed }), planDouble(phrases, 1, { seed })];
    for (const p of [...l.phrases, ...r.phrases]) {
      assert.ok(Math.abs(p.ms) >= DOUBLE_DEFAULTS.minMs && Math.abs(p.ms) <= DOUBLE_DEFAULTS.maxMs);
      assert.ok(Math.abs(p.cents) >= DOUBLE_DEFAULTS.minCents && Math.abs(p.cents) <= DOUBLE_DEFAULTS.maxCents);
    }
    // Mostly opposite ways: one side sharp, the other flat
    const sharp = (plan) => plan.phrases.filter((p) => p.cents > 0).length / plan.phrases.length;
    assert.ok(Math.abs(sharp(l) - sharp(r)) > 0.5, `seed ${seed}`);
  }
});

test('the timing moves quickly in pauses and barely bends the pitch inside a phrase', () => {
  const plan = { phrases: [{ start: 0, end: 1, ms: 15, cents: 0 }, { start: 1.1, end: 2, ms: -15, cents: 0 }] };
  const sounding = (i) => i / SR < 1 || i / SR >= 1.1;
  const curve = offsetCurve(2 * SR, SR, plan, sounding);
  // On target through the first phrase, and by the second's start (30 ms moved in the 100 ms pause)
  assert.ok(Math.abs(curve[Math.round(0.5 * SR)] - 0.015 * SR) < 1);
  assert.ok(Math.abs(curve[Math.round(1.1 * SR)] + 0.015 * SR) < 1);
  // Never further than the most a phrase is offset
  assert.ok(curve.every((v) => Math.abs(v) <= (DOUBLE_DEFAULTS.maxMs / 1000) * SR + 1e-6));
  // Inside phrases it moves at most 0.0015 samples per sample (2.6 cents)
  for (let i = 1; i < curve.length; i++) if (sounding(i)) assert.ok(Math.abs(curve[i] - curve[i - 1]) <= 0.0015 + 1e-9);
  // shiftByCurve delays by the curve: an impulse at 0.5 s comes out 15 ms later
  const x = new Float32Array(2 * SR);
  x[Math.round(0.5 * SR)] = 1;
  const y = shiftByCurve(x, curve);
  const at = y.indexOf(Math.max(...y));
  assert.ok(Math.abs(at - Math.round(0.515 * SR)) <= 1, `${at}`);
});

test('a held note doubles a few cents sharp on one side and flat on the other', () => {
  // A steady sung note with gaps (three phrases)
  const x = new Float32Array(3 * SR);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (t % 1 > 0.85) continue;
    const p = 2 * Math.PI * 196 * t;
    x[i] = 0.3 * Math.min(1, (t % 1) / 0.02, (0.85 - (t % 1)) / 0.02) * (Math.sin(p) + 0.5 * Math.sin(2 * p) + 0.3 * Math.sin(3 * p));
  }
  const { channels, plans } = doubleTake([x], SR, { seed: 5 });
  const cents = (y) => {
    const f = detectPitch(y, SR).filter((q) => q.hz > 0 && q.time % 1 > 0.2 && q.time % 1 < 0.7);
    return 1200 * Math.log2(median(f.map((q) => q.hz)) / 196);
  };
  const want = (plan) => median(plan.phrases.map((p) => p.cents));
  for (const side of [0, 1]) {
    const got = cents(channels[side]);
    assert.ok(Math.abs(got - want(plans[side])) < 2.5, `side ${side}: ${got.toFixed(1)} cents, planned ${want(plans[side]).toFixed(1)}`);
    assert.ok(Math.abs(got) >= 2 && Math.abs(got) <= 10);
  }
});
