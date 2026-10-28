// Unit tests for lengthening a recording that stops dead and looping it for a note held longer
// still, and for ringing on a recording cut off while it sounds (src/audio/samplers/recordingMaths.ts:
// planSustain, lengthenSustain, planRingOn, ringOn). A drone or an ambience written as one long note
// (rain under a whole song) went silent after the lengthened recording's 10 s; a held note's loop
// (the steady stretch over and over) came round every 1.7 s; a soundfont dulcimer or crystal note
// held past 3.1 s stopped dead. Run with `npm test`.
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

const { lengthenSustain, planSustain, planRingOn, ringOn, RING_CUT_DB } = await import('../src/audio/samplers/recordingMaths.ts');

const SR = 8000;
/** A 3 s recording: a tone whose pitch and level wander, so no two stretches of it are alike. */
function recording() {
  const n = 3 * SR;
  const x = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (2 * Math.PI * (220 + 30 * Math.sin(i / 900))) / SR;
    x[i] = (0.4 + 0.2 * Math.sin(i / 1300)) * Math.sin(phase);
  }
  return x;
}
const [START, END, XF, FADE] = [Math.round(1.2 * SR), 3 * SR, Math.round(0.12 * SR), Math.round(0.3 * SR)];

test('a lengthened sustain loops without a seam', () => {
  const data = recording();
  const out = new Float32Array(10 * SR);
  const plan = planSustain(data, START, END, XF, out.length, FADE, Math.round(SR / 220));
  lengthenSustain(out, data, END, plan, XF, FADE);
  assert.ok(plan.loop, 'a loop fits in 10 s');
  const [a, b] = plan.loop;
  // Played over and over, the loop is the lengthened sound itself: lengthened further by the same
  // plan, what follows the loop is the loop again
  const longer = new Float32Array(20 * SR);
  lengthenSustain(longer, data, END, plan, XF, FADE);
  for (let j = 0; j < b - a; j++) assert.equal(longer[b + j], longer[a + j], `sample ${j} after the loop`);
  for (let i = 0; i < out.length - FADE; i++) assert.equal(out[i], longer[i]);
  // So the wrap from its last sample to its first is a step like any other in the sound
  let most = 0;
  for (let i = a + 1; i < b; i++) most = Math.max(most, Math.abs(out[i] - out[i - 1]));
  assert.ok(Math.abs(out[a] - out[b - 1]) <= most);
  // ...and it's all before the fade out
  assert.ok(b <= out.length - FADE);
  // Up to the end of the recording, the recording itself
  for (let i = 0; i < END - XF; i++) assert.equal(out[i], data[i]);
  assert.equal(Math.abs(out[out.length - 1]), 0);
});

test('the loop is far longer than the steady stretch, made of pieces of different lengths from different places', () => {
  const data = recording();
  const plan = planSustain(data, START, END, XF, 10 * SR, FADE, Math.round(SR / 220));
  const [a, b] = plan.loop;
  // The old way looped the stretch itself: 1.68 s
  assert.ok(b - a > 5 * SR, `a ${(b - a) / SR} s loop`);
  assert.ok(plan.pieces.length >= 4);
  assert.equal(new Set(plan.pieces.map((p) => p.to - p.from)).size, plan.pieces.length, 'every piece a different length');
  assert.equal(new Set(plan.pieces.map((p) => p.from)).size, plan.pieces.length, 'every piece from its own place');
  for (const p of plan.pieces) assert.ok(p.from >= START && p.to <= END && p.to - p.from >= XF * 3);
  // The last ends where the recording does (so the cycle's last join is its first)
  assert.equal(plan.pieces.at(-1).to, END);
});

test('the joins keep the level', () => {
  const data = recording();
  const out = new Float32Array(10 * SR);
  const plan = planSustain(data, START, END, XF, out.length, FADE, Math.round(SR / 220));
  lengthenSustain(out, data, END, plan, XF, FADE);
  // 50 ms RMS, in the lengthened part, against the recording's own range over its steady stretch
  const rms = (x, i) => Math.sqrt(x.subarray(i, i + 400).reduce((s, v) => s + v * v, 0) / 400);
  let lo = Infinity, hi = 0;
  for (let i = START; i + 400 <= END; i += 200) [lo, hi] = [Math.min(lo, rms(data, i)), Math.max(hi, rms(data, i))];
  for (let i = END; i + 400 <= out.length - FADE; i += 200) {
    const r = rms(out, i);
    assert.ok(r > lo * 0.85 && r < hi * 1.15, `${(i / SR).toFixed(2)} s: ${r.toFixed(3)} outside ${lo.toFixed(3)}..${hi.toFixed(3)}`);
  }
});

test('with room for one piece, one piece; with no room for that, the stretch repeats, unlooped', () => {
  const data = recording();
  const short = planSustain(data, START, END, XF, END + Math.round(1.9 * SR), FADE, 30);
  assert.equal(short.pieces.length, 1);
  assert.equal(short.pieces[0].to, END);
  assert.ok(short.loop);
  const none = planSustain(data, START, END, XF, END + SR, FADE, 30);
  assert.deepEqual(none.pieces.map((p) => [p.from, p.to]), [[START, END]]);
  assert.equal(none.loop, null);
});

/** A plucked note: a decaying tone, cut off at `cut` seconds. */
function plucked(cut, dbPerS = -12) {
  const n = Math.round(cut * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.8 * 10 ** ((dbPerS * i) / SR / 20) * Math.sin((2 * Math.PI * 330 * i) / SR) * Math.min(1, i / 40);
  return x;
}

test('a note cut off while it sounds rings on at the rate it was dying away, to 60 dB down', () => {
  const data = plucked(3.1);
  const plan = planRingOn(data, SR, 330, 10 * SR);
  assert.ok(plan, 'cut off');
  assert.ok(Math.abs(plan.rate + 12) < 1, `rate ${plan.rate}`);
  // (it was 37 dB down at the cut: 23 more at 12 dB a second)
  assert.ok(Math.abs(plan.length / SR - (3.07 + 23 / 12)) < 0.2, `${plan.length / SR} s`);
  const out = new Float32Array(plan.length);
  ringOn(out, data, plan, SR, 330);
  // (up to the first repeat's crossfade, 40 ms before the cut)
  for (let i = 0; i < plan.at - 0.04 * SR; i++) assert.equal(out[i], data[i]);
  // Its level carries straight on down: 100 ms RMS against the line, until the end's fade
  const rmsDb = (i) => 10 * Math.log10(out.subarray(i, i + 800).reduce((s, v) => s + v * v, 0) / 800);
  const ref = rmsDb(plan.at - 1000);
  for (let i = plan.at - 1000; i + 800 < plan.length - 1.5 * SR; i += 400) {
    const want = ref - 12 * ((i - (plan.at - 1000)) / SR);
    assert.ok(Math.abs(rmsDb(i) - want) < 1.5, `${(i / SR).toFixed(2)} s: ${rmsDb(i).toFixed(1)} dB, want ${want.toFixed(1)}`);
  }
  assert.equal(Math.abs(out[out.length - 1]), 0);
});

test('a note that died away by itself, or was faded out, is left alone; a sound that stopped falling still dies away', () => {
  assert.equal(planRingOn(plucked(3.1, -RING_CUT_DB / 2), SR, 330, 10 * SR), null);
  const faded = plucked(3.1);
  for (let i = 0; i < SR; i++) faded[faded.length - 1 - i] *= (i / SR) ** 3;
  assert.equal(planRingOn(faded, SR, 330, 10 * SR), null);
  const steady = planRingOn(plucked(3.1, 0), SR, 330, 10 * SR);
  assert.ok(steady && steady.rate <= -4 && steady.length === 10 * SR);
});
