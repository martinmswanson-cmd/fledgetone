// Live notes of the synths and kits made of plain Web Audio nodes (src/audio/presets/native.ts, monotonic.ts):
// set no sooner than a render callback past the clock, struck again when the page is held up while one
// is built, and exports left exactly as they were. Also the wave normalizers kept ready (KNOWN_NORMALIZERS).
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
// (No browser here: nothing is an OfflineAudioContext)
globalThis.OfflineAudioContext ??= class {};
const { notLate } = await import('../src/audio/presets/monotonic.ts');
const N = await import('../src/audio/presets/native.ts');

const SR = 44100;
const BLOCK = 128 / SR;
/** At a baseLatency of 10 ms: four blocks, and a frame. */
const ROOM = 4 * BLOCK + 1 / SR;

/** A stand-in for a Tone context: its clock (live or an export's). */
function fakeContext({ now = 1, offline = false } = {}) {
  const raw = { currentTime: now, sampleRate: SR, baseLatency: 0.01 };
  return { rawContext: raw, isOffline: offline, sampleRate: SR, get currentTime() { return raw.currentTime; } };
}

test('live, a note asked for now (or a few ms on) comes a render callback past the clock (scan r41)', () => {
  const context = fakeContext();
  assert.equal(notLate(context), 1 + ROOM);
  assert.equal(notLate(context, 1.005), 1 + ROOM);
  // (Further on: where it was asked)
  assert.equal(notLate(context, 1.05), 1.05);
});

test('an export\'s notes keep the few ms they always had: nothing changes offline (scan r41)', () => {
  const context = fakeContext({ offline: true });
  assert.equal(notLate(context), 1 + 0.005);
  assert.equal(notLate(context, 1.002), 1 + 0.005);
  assert.equal(notLate(context, 1.01), 1.01);
});

/** A stand-in for a native voice's nodes: the gain events set on its amp and its sources' stops. */
function fakeVoice(start) {
  const events = [];
  const gain = {
    setValueAtTime: (v, t) => events.push(['set', v, t]),
    setTargetAtTime: (v, t, c) => events.push(['target', v, t, c]),
    cancelAndHoldAtTime: (t) => events.push(['hold', t]),
    cancelScheduledValues: (t) => events.push(['cancel', t]),
  };
  const stops = [];
  const source = { stop: (t) => stops.push(t), onended: null, disconnect() {} };
  return { voice: { start, stopAt: start + 1, sources: [source], nodes: [source], amp: { gain, disconnect() {} } }, events, stops };
}

/** A native instrument's note, built at `start` into a voice set; `hold` (seconds) holds the page up while it's built. */
function fakeInstrument(context, holdUps = []) {
  const set = N.createVoiceSet(context.rawContext);
  const built = [];
  const build = (start) => {
    const made = fakeVoice(start);
    // (The page held up: the clock moves on while the note is set)
    context.rawContext.currentTime += holdUps[built.length] ?? 0;
    set.add(made.voice);
    built.push(made);
    return made.voice;
  };
  return { set, built, build };
}

test('a native note built in time is struck once, a callback past the clock (scan r41)', () => {
  const context = fakeContext();
  const { built, build } = fakeInstrument(context, [0.002]);
  const voice = N.strikeLive(context, 1, build);
  assert.equal(built.length, 1);
  assert.equal(voice.start, 1 + ROOM);
  assert.deepEqual(voice.moved, { asked: 1, at: 1 + ROOM });
});

test('the page held up past the note while it is built: struck again a callback past the clock, the first strike faded from there (scan r41)', () => {
  const context = fakeContext();
  const { built, build } = fakeInstrument(context, [0.02]);
  let putBack = 0;
  const voice = N.strikeLive(context, 1, build, () => putBack++);
  assert.equal(built.length, 2);
  assert.equal(putBack, 1);
  const again = 1.02 + ROOM;
  assert.equal(voice.start, again);
  assert.equal(voice, built[1].voice);
  // The first fades out from where the second begins (no cut), and stops once faded
  const fade = built[0].events.slice(built[0].events.findIndex((e) => e[0] === 'hold'));
  assert.deepEqual(fade[0], ['hold', again]);
  assert.equal(fade[1][0], 'target');
  assert.equal(fade[1][1], 0);
  assert.equal(fade[1][2], again);
  assert.ok(built[0].stops.at(-1) > again && built[0].stops.at(-1) < again + 0.05);
  assert.deepEqual(voice.moved, { asked: 1, at: again });
});

test('a native note is struck three times at most, however long the page is held up (scan r41)', () => {
  const context = fakeContext();
  const { built, build } = fakeInstrument(context, [0.02, 0.02, 0.02, 0.02]);
  N.strikeLive(context, 1, build);
  assert.equal(built.length, 3);
});

test('the clock stepping on a callback (four blocks) while a note is built, short of its start, is not struck again (scan r41)', () => {
  const context = fakeContext();
  const { built, build } = fakeInstrument(context, [4 * BLOCK]);
  N.strikeLive(context, 1, build);
  assert.equal(built.length, 1);
  // A block further, it's past the start: struck again
  const later = fakeContext();
  const again = fakeInstrument(later, [5 * BLOCK]);
  N.strikeLive(later, 1, again.build);
  assert.equal(again.built.length, 2);
});

test('a note whose envelopes begin before its start is struck again once the clock is past them (scan r41)', () => {
  const context = fakeContext();
  const set = N.createVoiceSet(context.rawContext);
  let builds = 0;
  N.strikeLive(context, 1, (start) => {
    builds++;
    const { voice } = fakeVoice(start);
    voice.early = 0.004;
    // (Held up past the envelopes' start, short of the note's)
    if (builds === 1) context.rawContext.currentTime = start - 0.002;
    set.add(voice);
    return voice;
  });
  assert.equal(builds, 2);
});

test('an export\'s native note is built once, where notLate puts it, and not marked moved (scan r41)', () => {
  const context = fakeContext({ offline: true });
  const { built, build } = fakeInstrument(context, [0.5]);
  const voice = N.strikeLive(context, 1.002, build);
  assert.equal(built.length, 1);
  assert.equal(voice.start, 1.005);
  assert.equal(voice.moved, undefined);
});

test('a release that would come before a moved note, or within as long again after it, moves with it; later ones stay (scan r41)', () => {
  const voice = { moved: { asked: 1, at: 1.012 } };
  // A quick tap let go 5 ms after it was struck: still 5 ms after the moved start
  assert.equal(N.movedRelease(voice, 1.005), 1.005 + 0.012);
  assert.equal(N.movedRelease(voice, 1.03), 1.03);
  assert.equal(N.movedRelease({}, 1.005), 1.005);
  assert.equal(N.movedRelease(undefined, 1.005), 1.005);
});

test('the wave normalizers kept ready are exactly what working them out gives (scan r41)', () => {
  const sizes = [2048, 4096, 16384];
  let checked = 0;
  for (const size of sizes) {
    for (const type of ['sine', 'square', 'sawtooth', 'triangle']) {
      const { real, imag } = N.builtinSeries(type, size);
      assert.equal(N.knownNormalizer(`builtin:${type}:${size}`, size), N.waveNormalizer(real, imag, size), `${type} at ${size}`);
      checked++;
    }
    for (let i = 0; i < 7; i++) {
      const phase = (i * 0.618) % 1;
      const { real, imag } = N.phasedSawSeries(phase);
      assert.equal(N.knownNormalizer(`saw@${phase}`, size), N.waveNormalizer(real, imag, size), `saw at ${phase}, ${size}`);
      checked++;
    }
  }
  assert.equal(checked, 33);
});
