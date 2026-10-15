// Where a ring-out export ends (src/audio/ringOutTail.ts): once the mix has fallen under -70 dBFS, plus the end fade; never before the range's end plus a second, nor past the render. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ringOutLength, RING_OUT_FADE_SECONDS, RING_OUT_SHORTEST, RING_OUT_FLOOR_DB } = await import('../src/audio/ringOutTail.ts');
const SR = 48000;

/** A range of loud noise, then a tail falling `dbPerSecond`, in a render `seconds` long (both channels alike). */
function render(rangeSeconds, seconds, dbPerSecond) {
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const ch = Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => {
    const t = i / SR;
    const db = t < rangeSeconds ? -12 : -12 - dbPerSecond * (t - rangeSeconds);
    return noise() * Math.sqrt(3) * 10 ** (db / 20);
  });
  return [ch, ch.slice()];
}

test('a tail falling 20 dB a second ends where it passes -70 dBFS, then the fade', () => {
  const range = 4 * SR;
  const n = ringOutLength(render(4, 12, 20), SR, range);
  // -12 dB to -70 dB: 2.9 s after the range
  const expected = range + 2.9 * SR + RING_OUT_FADE_SECONDS * SR;
  assert.ok(Math.abs(n - expected) < 0.1 * SR, `${(n / SR).toFixed(2)} s, expected ${(expected / SR).toFixed(2)}`);
});

test('the same sound always ends at the same frame', () => {
  const a = render(2, 8, 30);
  assert.equal(ringOutLength(a, SR, 2 * SR), ringOutLength(a.map((c) => c.slice()), SR, 2 * SR));
});

test('a tail still sounding at the end of the render keeps all of it; one that stops at once keeps a second', () => {
  assert.equal(ringOutLength(render(2, 6, 5), SR, 2 * SR), 6 * SR);
  assert.equal(ringOutLength(render(2, 6, 1000), SR, 2 * SR), 2 * SR + RING_OUT_SHORTEST * SR);
});

test('the floor is read at the level the file will have', () => {
  const r = render(2, 10, 20);
  const full = ringOutLength(r, SR, 2 * SR);
  const turnedDown = ringOutLength(r, SR, 2 * SR, 0.1);
  // 20 dB down: the floor is reached a second sooner
  assert.ok(Math.abs(full - turnedDown - SR) < 0.1 * SR, `${(full / SR).toFixed(2)} vs ${(turnedDown / SR).toFixed(2)} s`);
  assert.equal(RING_OUT_FLOOR_DB, -70);
});
