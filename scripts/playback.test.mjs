// Unit tests for playback timing: swing, and whole Transport ticks.
// Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
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
const Tone = await import('tone');
const { swingDelay } = await import('../src/audio/transport.ts');

/** The delay Tone's own swing (16n subdivision) gives a note on `tick`. */
function toneSwing(tick, swing, bpm, ppq = 192) {
  const swingTicks = ppq / 4;
  if (!(swing > 0) || tick % ppq === 0 || tick % (swingTicks * 2) === 0) return 0;
  const progress = (tick % (swingTicks * 2)) / (swingTicks * 2);
  return ((swingTicks * 2) / 3 / ppq) * (60 / bpm) * (Math.sin(progress * Math.PI) * swing);
}

test('swing delays off-beat 16ths exactly as Tone did', () => {
  for (const bpm of [60, 97.3, 140, 174, 240]) {
    for (const swing of [0.05, 0.2, 0.5]) {
      for (let tick = 48; tick < 768 * 4; tick += 96) {
        assert.equal(swingDelay(tick, swing, bpm), toneSwing(tick, swing, bpm), `tick ${tick} at ${bpm} BPM, swing ${swing}`);
        assert.ok(swingDelay(tick, swing, bpm) > 0);
      }
    }
  }
  // 32 ticks (a third of an 8th) at the most swing: 16 ticks at 120 BPM is 41.7 ms
  assert.ok(Math.abs(swingDelay(48, 0.5, 120) - 16 * (60 / 120 / 192)) < 1e-15);
});

test('swing leaves downbeats, 8ths, triplets and 1/32 notes alone', () => {
  for (let tick = 0; tick < 768 * 2; tick++) {
    const onOffBeat16th = tick % 96 === 48;
    const onGrid = tick % 48 === 0 || tick % 32 === 0 || tick % 24 === 0;
    if (onGrid && !onOffBeat16th) assert.equal(swingDelay(tick, 0.3, 128), 0, `tick ${tick}`);
  }
});

test('a note nudged off an off-beat 16th swings while it is nearer to it than to a triplet line', () => {
  const full = swingDelay(48, 0.2, 120);
  for (let d = -7; d <= 7; d++) assert.equal(swingDelay(48 + 96 * 3 + d, 0.2, 120), full, `${d} ticks off`);
  for (const d of [-8, 8, -16, 16]) assert.equal(swingDelay(48 + d, 0.2, 120), 0, `${d} ticks off`);
});

test('no swing, no delay', () => {
  for (let tick = 0; tick < 768; tick += 12) {
    assert.equal(swingDelay(tick, 0, 140), 0);
    assert.equal(swingDelay(tick, -0.1, 140), 0);
    assert.equal(swingDelay(tick, Number.NaN, 140), 0);
  }
});

test('Transport positions in whole ticks come back whole at every tempo (toneFixes)', async () => {
  /** A Transport time as Tone works it out, against a context at `bpm` (only the tempo and PPQ are read). */
  const ticksAt = (bpm, time) => new Tone.TransportTimeClass({ transport: { bpm: { value: bpm }, PPQ: 192 } }, time).toTicks();
  // Without the fix about one in ten come back a hair off, these two among them
  await import('../src/audio/toneFixes.ts');
  assert.equal(ticksAt(130, '768i'), 768);
  assert.equal(ticksAt(150, '1536i'), 1536);
  let checked = 0;
  for (let hundredths = 4000; hundredths <= 24000; hundredths += 7) {
    const bpm = hundredths / 100;
    for (let tick = 0; tick <= 400 * 768; tick += 4801) {
      for (const t of [tick - (tick % 24), tick - (tick % 32), tick - (tick % 48)]) {
        assert.equal(ticksAt(bpm, `${t}i`), t, `${t}i at ${bpm} BPM`);
        checked++;
      }
    }
  }
  assert.ok(checked > 500000);
  // Positions between ticks are left as they are
  assert.ok(Math.abs(ticksAt(120, 0.001) - 0.384) < 1e-9);
});
