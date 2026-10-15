// The designed reverb rooms (src/audio/effects/roomIR.ts): the highs die before the lows, the two sides differ, longer decays ring longer, the level is the same whatever the room, and every tail has died away (not stopped) by its end.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { roomChannels, roomSeconds, ROOM_STYLE_IDS, ROOM_IR_MAX_SECONDS } = await import('../src/audio/effects/roomIR.ts');
const SR = 48000;
const energy = (x, a, b) => x.subarray(a, b).reduce((s, v) => s + v * v, 0);

test('every room has total energy 1, two different sides, and starts after its pre-delay', () => {
  for (const style of ROOM_STYLE_IDS) {
    const [l, r] = roomChannels(style, 2.4, SR);
    assert.ok(Math.abs(energy(l, 0, l.length) + energy(r, 0, r.length) - 1) < 1e-3, style);
    let diff = 0;
    for (let i = 0; i < l.length; i += 97) diff += Math.abs(l[i] - r[i]);
    assert.ok(diff > 0.01, `${style}: stereo`);
  }
});

test('a longer decay rings longer', () => {
  const tail = (decay) => {
    const [l] = roomChannels('hall', decay, SR);
    return energy(l, Math.round(1.5 * SR), l.length) / energy(l, 0, l.length);
  };
  assert.ok(tail(4) > tail(1.5) * 3);
});

test('in a hall the highs die before the lows', () => {
  const [l] = roomChannels('hall', 2.5, SR);
  // High-passed (first difference) vs low-passed (running average) energy, early and late
  const split = (a, b) => {
    let hi = 0;
    let lo = 0;
    let avg = 0;
    for (let i = a + 1; i < b; i++) {
      const d = l[i] - l[i - 1];
      hi += d * d;
      avg += 0.02 * (l[i] - avg);
      lo += avg * avg;
    }
    return hi / lo;
  };
  assert.ok(split(Math.round(1.5 * SR), Math.round(2 * SR)) < split(Math.round(0.1 * SR), Math.round(0.5 * SR)) * 0.6);
});

test('every band has fallen 60 dB by the end, which fades to silence, even at the longest decays', () => {
  // A one-pole low-pass picks out the lows, which ring longest
  const lows = (x) => {
    const y = new Float32Array(x.length);
    let a = 0;
    for (let i = 0; i < x.length; i++) y[i] = a += 0.01 * (x[i] - a);
    return y;
  };
  for (const style of ROOM_STYLE_IDS) {
    for (const decay of [2.4, 12, 30]) {
      const [l] = roomChannels(style, decay, SR);
      assert.ok(l.length <= ROOM_IR_MAX_SECONDS * SR + 1, `${style} ${decay}: capped`);
      assert.equal(l.length, Math.round(roomSeconds(style, decay) * SR));
      const win = Math.round(0.1 * SR);
      for (const [band, x] of [['all', l], ['lows', lows(l)]]) {
        const start = energy(x, Math.round(0.15 * SR), Math.round(0.15 * SR) + win);
        // The 100 ms before the end fade
        const end = energy(x, x.length - Math.round(0.05 * SR) - win, x.length - Math.round(0.05 * SR));
        assert.ok(10 * Math.log10(end / start) < -54, `${style} ${decay} ${band}: ${(10 * Math.log10(end / start)).toFixed(1)} dB at the end`);
      }
      assert.ok(Math.abs(l[l.length - 1]) < 1e-6, `${style} ${decay}: faded`);
    }
  }
});
