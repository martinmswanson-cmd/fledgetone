// Live notes of the synths and kits made of plain Web Audio nodes (src/audio/presets/native.ts, monotonic.ts):
// set no sooner than a render callback past the clock, struck again whole when the page is held up while one
// is built (the clock no longer a callback short of it: never heard), and exports left exactly as they were.
// Also the wave normalizers kept ready (KNOWN_NORMALIZERS).
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
/** Where a note struck again goes: three blocks past the clock, and a frame (see soundLead.ts retryRoom). */
const RETRY = (3 * 128 + 1) / SR;

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
    linearRampToValueAtTime: (v, t) => events.push(['ramp', v, t]),
  };
  const stops = [];
  const out = [];
  const made = { events, stops, out, disconnected: false };
  const source = { stop: (t) => stops.push(t), onended: null, disconnect() {} };
  // (Its output: what it was connected to)
  const node = { connect: (to) => out.push(to), disconnect: () => (made.disconnected = true) };
  made.node = node;
  made.voice = { start, stopAt: start + 1, sources: [source], nodes: [source, node], amp: { gain, disconnect() {} } };
  return made;
}

/** A native instrument's note, built at `start` into a voice set; `hold` (seconds) holds the page up while it's built. */
function fakeInstrument(context, holdUps = []) {
  const set = N.createVoiceSet(context.rawContext);
  const built = [];
  const build = (start) => {
    const made = fakeVoice(start);
    N.connectOut(made.node, 'bus');
    // (The page held up: the clock moves on while the note is set)
    const held = holdUps[built.length] ?? 0;
    context.rawContext.currentTime += held;
    set.add(made.voice);
    built.push(made);
    return made.voice;
  };
  return { set, built, build };
}

test('the page held up past the note while it is built: struck again two blocks past the clock, the first strike never heard (scan r41, r42)', () => {
  const context = fakeContext();
  const { built, build } = fakeInstrument(context, [0.02]);
  let putBack = 0;
  const voice = N.strikeLive(context, 1, build, () => putBack++);
  assert.equal(built.length, 2);
  assert.equal(putBack, 1);
  const again = 1.02 + RETRY;
  assert.equal(voice.start, again);
  assert.equal(voice, built[1].voice);
  // The first was never connected to where it sounds (its envelopes, set late, would jump to the
  // peak: a burst and a click), and its sources were stopped at once; the second was connected
  assert.deepEqual(built[0].out, []);
  assert.deepEqual(built[0].stops.at(-1), undefined);
  assert.equal(built[0].stops.length, 2);
  assert.ok(built[0].disconnected);
  assert.deepEqual(built[1].out, ['bus']);
  assert.deepEqual(voice.moved, { asked: 1, at: again });
});

test('a strike is connected only once it is found in time, never while it is built; an export connects at once (scan r42)', () => {
  const context = fakeContext();
  const set = N.createVoiceSet(context.rawContext);
  let during;
  const made = fakeVoice(0);
  N.strikeLive(context, 1, (start) => {
    made.voice.start = start;
    N.connectOut(made.node, 'bus');
    set.add(made.voice);
    during = [...made.out];
    return made.voice;
  });
  assert.deepEqual(during, []);
  assert.deepEqual(made.out, ['bus']);
  // Offline: connected as it is built (the export is built exactly as before)
  const offline = fakeContext({ offline: true });
  const off = fakeVoice(0);
  N.strikeLive(offline, 1, () => {
    N.connectOut(off.node, 'bus');
    during = [...off.out];
  });
  assert.deepEqual(during, ['bus']);
});

test('what a note does to others (the note before giving way) waits until it is found in time, and is not done by a strike let go (scan r42)', () => {
  const context = fakeContext();
  const set = N.createVoiceSet(context.rawContext);
  const gaveWay = [];
  let builds = 0;
  N.strikeLive(context, 1, (start) => {
    builds++;
    const { voice } = fakeVoice(start);
    N.onceStruck(() => gaveWay.push(start));
    if (builds === 1) {
      context.rawContext.currentTime += 0.02;
    }
    set.add(voice);
    return voice;
  });
  assert.equal(builds, 2);
  assert.deepEqual(gaveWay, [1.02 + RETRY]);
  // Outside a strike: at once
  let now = 0;
  N.onceStruck(() => now++);
  assert.equal(now, 1);
});

test('a note whose envelopes begin before its start is struck again once the clock is within a block of them (scan r41, r44)', () => {
  const context = fakeContext();
  const set = N.createVoiceSet(context.rawContext);
  let builds = 0;
  N.strikeLive(context, 1.05, (start) => {
    builds++;
    const { voice } = fakeVoice(start);
    // (Ahead only with room for it, as the 808 Designer's and the Synth Designer's are: see roomAhead)
    voice.early = N.roomAhead(context, start, 0.004) ? 0.004 : 0;
    // (Held up to within a callback of the envelopes' start, short of the note's)
    if (builds === 1) {
      context.rawContext.currentTime = start - 0.004 - BLOCK / 2;
    }
    set.add(voice);
    return voice;
  });
  assert.equal(builds, 2);
});

test('live, envelopes run ahead of a note (for a shaper\'s delay) only from a render callback past the clock; an export runs them ahead from the clock (scan r42)', () => {
  const context = fakeContext();
  const shaper = 192 / SR;
  // A note played now (the 808 Designer's, the Synth Designer's): no room, its envelope would be set
  // inside the callback already playing
  assert.equal(N.roomAhead(context, notLate(context), shaper), false);
  assert.equal(N.roomAhead(context, 1 + ROOM + shaper - 1e-6, shaper), false);
  // One asked for that much later has room (a song's notes, set well ahead)
  assert.equal(N.roomAhead(context, 1 + ROOM + shaper + 1e-9, shaper), true);
  assert.equal(N.roomAhead(context, 1.1, shaper), true);
  // Nothing ahead: always
  assert.equal(N.roomAhead(context, notLate(context), 0), true);
  // An export: as before, from the clock (its notes 5 ms on have room)
  const offline = fakeContext({ offline: true });
  assert.equal(N.roomAhead(offline, notLate(offline), shaper), true);
  assert.equal(N.roomAhead(offline, 1 + shaper, shaper), true);
  assert.equal(N.roomAhead(offline, 1 + shaper - 1e-6, shaper), false);
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

test('a native note built with the clock standing still is struck once, a callback past the clock, connected as its last step (scan r41, r44)', () => {
  const context = fakeContext();
  const { built, build } = fakeInstrument(context);
  const voice = N.strikeLive(context, 1, build);
  assert.equal(built.length, 1);
  assert.equal(voice.start, 1 + ROOM);
  assert.deepEqual(built[0].out, ['bus']);
  assert.deepEqual(voice.moved, { asked: 1, at: 1 + ROOM });
});

test('the clock stepping on to within a block of a note while it is built: let go unheard and struck again two blocks past the clock (scan r44)', () => {
  for (const step of [5 * BLOCK, 0.02]) {
    const context = fakeContext();
    const { built, build } = fakeInstrument(context, [step]);
    const voice = N.strikeLive(context, 1, build);
    assert.equal(built.length, 2, `stepped ${step}`);
    assert.deepEqual(built[0].out, [], `stepped ${step}: the first never connected`);
    assert.ok(built[0].disconnected);
    assert.ok(Math.abs(voice.start - (1 + step + RETRY)) < 1e-12, `stepped ${step}: ${voice.start}`);
  }
});

test('a native note held up at every strike is struck four times at most; the last, a callback later still, is heard however it went: never lost (scan r44)', () => {
  const context = fakeContext();
  const { built, build } = fakeInstrument(context, [0.02, 0.02, 0.02, 0.03]);
  const before = { ...N.strikeCounts };
  const voice = N.strikeLive(context, 1, build);
  assert.equal(built.length, 4);
  assert.deepEqual(built.map((b) => b.out.length), [0, 0, 0, 1]);
  assert.ok(Math.abs(voice.start - (1.06 + ROOM + 4 * BLOCK)) < 1e-12, `${voice.start}`);
  // (Held up past it once more: heard all the same, and counted)
  assert.equal(N.strikeCounts.again - before.again, 3);
  assert.equal(N.strikeCounts.late - before.late, 1);
});

test('an 808 Designer note, its envelope a shaper\'s delay ahead of its start, survives a page as busy as three render blocks while it is built only when it was set with room for that (scan r42, r44)', () => {
  const build = (ahead) => {
    const context = fakeContext();
    const set = N.createVoiceSet(context.rawContext);
    let builds = 0;
    N.strikeLive(context, 1, (start) => {
      builds++;
      const { voice } = fakeVoice(start);
      voice.start = start - (N.roomAhead(context, start, ahead) ? ahead : 0);
      set.add(voice);
      return voice;
    });
    return builds;
  };
  assert.equal(build(192 / SR), 1);
});

test('a native note whose connection is made with the page held up past its start: played on, late, never faded out or struck again (scan r44)', () => {
  const context = fakeContext();
  const set = N.createVoiceSet(context.rawContext);
  const made = [];
  N.strikeLive(context, 1, (start) => {
    const v = fakeVoice(start);
    made.push(v);
    // (The connection held up: the clock past the note by the time it's made)
    v.node.connect = (to) => {
      v.out.push(to);
      context.rawContext.currentTime += 5 * BLOCK;
    };
    N.connectOut(v.node, 'bus');
    set.add(v.voice);
    return v.voice;
  });
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].out, ['bus']);
  assert.ok(!made[0].events.some(([what]) => what === 'hold'), JSON.stringify(made[0].events));
  assert.ok(made[0].stops.every((t) => t > 1.1), JSON.stringify(made[0].stops));
});
