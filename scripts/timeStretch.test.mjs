// Unit tests for time-stretching (src/audio/timeStretch.ts). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { stretchChannels } = await import('../src/audio/timeStretch.ts');

const SR = 44100;
const sine = (hz, seconds, amp = 0.5) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
/** Frequency from rising zero crossings over the middle of the signal. */
function pitch(x) {
  const a = Math.floor(x.length * 0.2);
  const b = Math.floor(x.length * 0.8);
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = a + 1; i < b; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      if (first < 0) first = i;
      last = i;
      count++;
    }
  }
  return ((count - 1) * SR) / (last - first);
}
const rms = (x, a, b) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / (b - a));

test('stretching changes the length, not the pitch', () => {
  const input = sine(440, 2);
  for (const ratio of [0.8, 1.25, 1.5]) {
    const [out] = stretchChannels([input], ratio, SR);
    assert.equal(out.length, Math.round(input.length / ratio));
    const hz = pitch(out);
    assert.ok(Math.abs(hz - 440) < 2, `ratio ${ratio}: ${hz} Hz`);
    // The level holds (no beating at the joins)
    const level = rms(out, Math.floor(out.length * 0.1), Math.floor(out.length * 0.9));
    assert.ok(Math.abs(20 * Math.log10(level / (0.5 / Math.SQRT2))) < 0.5, `ratio ${ratio}: level ${level}`);
  }
});

test('channels stay together and ratio 1 is a copy', () => {
  const l = sine(220, 1);
  const r = sine(330, 1, 0.25);
  const [a, b] = stretchChannels([l, r], 1.2, SR);
  assert.equal(a.length, b.length);
  assert.ok(Math.abs(pitch(b) - 330) < 2);
  const [same] = stretchChannels([l], 1, SR);
  assert.deepEqual(same, l);
  assert.notEqual(same, l);
});

test('a beat stays on the beat: a click every 0.5 s lands every 0.4 s at ratio 1.25', () => {
  const x = new Float32Array(SR * 4);
  for (let k = 0; k < 8; k++) for (let i = 0; i < 200; i++) x[Math.round(k * 0.5 * SR) + i] = Math.exp(-i / 40) * (i % 2 ? 1 : -1);
  const [out] = stretchChannels([x], 1.25, SR);
  for (let k = 1; k < 7; k++) {
    const expect = Math.round(k * 0.4 * SR);
    let peakAt = 0;
    let peak = 0;
    for (let i = expect - 1500; i < expect + 1500; i++) if (Math.abs(out[i]) > peak) { peak = Math.abs(out[i]); peakAt = i; }
    assert.ok(Math.abs(peakAt - expect) < 0.003 * SR, `click ${k} at ${(peakAt / SR).toFixed(3)} s, expected ${(expect / SR).toFixed(3)}`);
    // ...with its punch (a click caught at a window's edge would come out much quieter)
    assert.ok(peak > 0.9, `click ${k} peak ${peak.toFixed(2)}`);
  }
  // Slower, too: every 0.625 s at ratio 0.8
  const [slow] = stretchChannels([x], 0.8, SR);
  for (let k = 1; k < 7; k++) {
    const expect = Math.round(k * 0.625 * SR);
    let peakAt = 0;
    let peak = 0;
    for (let i = expect - 1500; i < expect + 1500; i++) if (Math.abs(slow[i]) > peak) { peak = Math.abs(slow[i]); peakAt = i; }
    assert.ok(Math.abs(peakAt - expect) < 0.003 * SR && peak > 0.9, `slow click ${k} at ${(peakAt / SR).toFixed(3)} s, peak ${peak.toFixed(2)}`);
  }
});
