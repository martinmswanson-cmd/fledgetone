// A Tone synth's note started a render block early (src/audio/presets/toneStart.ts): the audio clock moving on
// while its oscillators start (live, a busy main thread) must not leave the note silent at the 0 Hz it's held at,
// nor start some of them (a hat's six FM pairs) out of step with the others.
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
const { pitchAhead, attackAhead } = await import('../src/audio/presets/toneStart.ts');

const SR = 44100;
const BLOCK = 128 / SR;

/** A stand-in for a Tone source: its starts kept as Tone keeps them, moved up to the clock when past (as Tone does). */
function fakeSource(context, onStart = () => {}) {
  const events = [];
  return {
    events,
    _state: { get: (t) => [...events].reverse().find((e) => e.time <= t) ?? null, getLastState: (state, t) => [...events].reverse().find((e) => e.state === state && e.time <= t) },
    start(time) {
      onStart();
      const at = Math.max(time, context.currentTime);
      const last = events[events.length - 1];
      if (last && last.state === 'started' && !(at > last.time + 1e-6)) throw new Error('Start time must be strictly greater than previous start time');
      events.push({ state: 'started', time: at });
    },
    stop(time) {
      events.push({ state: 'stopped', time: Math.max(time, context.currentTime) });
    },
  };
}

/** A stand-in for a Tone FMSynth (so it's started early): its clock, carrier, modulator and pitch. */
function fakeFm({ now = 1, offline = false, stepInStart = 0 } = {}) {
  const context = { currentTime: now, sampleRate: SR, isOffline: offline };
  let step = stepInStart;
  // (The clock moves on inside the first start: a main-thread hold-up)
  const onStart = () => {
    context.currentTime += step;
    step = 0;
  };
  const pitch = [];
  const synth = Object.create(Tone.FMSynth.prototype);
  Object.defineProperties(synth, {
    context: { value: context },
    oscillator: { value: fakeSource(context, onStart) },
    modulation: { value: fakeSource(context, onStart) },
    frequency: { value: { setValueAtTime: (v, t) => pitch.push([v, t]) } },
    toFrequency: { value: (n) => (typeof n === 'number' ? n : 329.63) },
  });
  return { synth, context, pitch };
}

test('a note in time starts its oscillators a block early, held at 0 Hz, and keeps its time', () => {
  const { synth, pitch } = fakeFm();
  const start = 1.005;
  assert.equal(pitchAhead(synth, 'E4', start), start);
  assert.deepEqual(synth.oscillator.events, [{ state: 'started', time: start - BLOCK }]);
  assert.deepEqual(synth.modulation.events, [{ state: 'started', time: start - BLOCK }]);
  assert.equal(pitch[0][0], 0);
});

test('the clock stepping past the note while it starts: both oscillators still start early, and the note comes a callback past the clock as it is then (scan r42)', () => {
  const { synth, context, pitch } = fakeFm({ stepInStart: 0.00871 });
  const start = 1.005;
  const at = pitchAhead(synth, 'E4', start);
  const landed = synth.oscillator.events[0].time;
  assert.ok(landed >= start, 'the early start was moved past the note');
  // (The modulator too, though the clock is past its early start: at 0 Hz its wave waits at its start)
  assert.equal(synth.modulation.events.length, 1);
  assert.ok(Math.abs(at - (context.currentTime + BLOCK + 1 / SR)) < 1e-12, `${at} is a callback past the clock ${context.currentTime}`);
  assert.deepEqual(pitch.slice(1), [[329.63, at]]);
  // Tone's own start at the note's time then goes through on both
  synth.oscillator.start(at);
  synth.modulation.start(at);
});

test('live, a note too near the clock for a block\'s early start still starts its oscillators early, and comes where its attack would go anyway (scan r42)', () => {
  const { synth, pitch } = fakeFm({ now: 1 });
  const start = 1 + BLOCK * 0.5;
  const at = pitchAhead(synth, 'E4', start);
  assert.ok(Math.abs(at - (1 + BLOCK + 1 / SR)) < 1e-12, `${at}`);
  assert.equal(synth.oscillator.events.length, 1);
  assert.equal(synth.modulation.events.length, 1);
  assert.deepEqual(pitch.map(([v]) => v), [0, 329.63]);
  assert.equal(pitch[1][1], at);
});

test('an export\'s note right by its clock: only the pitch is set early, and it keeps its time', () => {
  const { synth, pitch } = fakeFm({ now: 1, offline: true });
  const start = 1 + BLOCK * 0.5;
  assert.equal(pitchAhead(synth, 'E4', start), start);
  assert.equal(synth.oscillator.events.length, 0);
  assert.deepEqual(pitch.map(([v]) => v), [329.63]);
});

test('an export takes the early start right up to its clock (no room kept)', () => {
  const start = 1 + BLOCK + 0.0005;
  const offline = fakeFm({ now: 1, offline: true });
  assert.equal(pitchAhead(offline.synth, 'E4', start), start);
  assert.equal(offline.synth.oscillator.events.length, 1);
  assert.equal(offline.synth.oscillator.events[0].time, start - BLOCK);
});

test('a start Tone refuses is struck again just after every start set, once', () => {
  const { synth, context } = fakeFm();
  const times = [];
  let refuse = true;
  const at = attackAhead(synth, 'E4', 1.005, (t) => {
    times.push(t);
    if (refuse) {
      refuse = false;
      // (As if the clock had moved on onto the early start)
      context.currentTime = synth.oscillator.events[0].time;
      synth.oscillator.start(t - 1);
    }
  });
  assert.equal(times.length, 2);
  assert.equal(at, times[1]);
  assert.ok(at > synth.oscillator.events[0].time && at > context.currentTime);
});

test('refused twice: the pitch is still set (never left at 0 Hz) and the error passes on', () => {
  const { synth, pitch } = fakeFm();
  assert.throws(() => attackAhead(synth, 'E4', 1.005, () => {
    throw new Error('Start time must be strictly greater than previous start time');
  }));
  assert.deepEqual(pitch[pitch.length - 1][0], 329.63);
});

test('the clock stepping between an oscillator and its own inner oscillator: the note comes after the inner start, so nothing is left running (scan r38)', () => {
  const { synth, context } = fakeFm();
  // (An OmniOscillator: its own Oscillator clamps the start to the clock again, after a step)
  const inner = fakeSource(context);
  const outer = synth.oscillator;
  const outerStart = outer.start.bind(outer);
  outer._oscillator = inner;
  outer.start = (time) => {
    outerStart(time);
    context.currentTime += 0.00871;
    inner.start(time);
  };
  const start = 1.005;
  const at = pitchAhead(synth, 'E4', start);
  const innerLanded = inner.events[0].time;
  assert.ok(innerLanded >= start, 'the inner start was moved past the note');
  assert.ok(at > innerLanded, `the note starts after the inner start (${at} vs ${innerLanded})`);
  // Tone's own start at the note's time goes through on the inner one too (no restart that cancels its only start)
  inner.start(at);
});

test('the clock already past the note when its early start is done: it starts now, not in the past (scan r38)', () => {
  const { synth, context } = fakeFm();
  const outer = synth.oscillator;
  const outerStart = outer.start.bind(outer);
  outer.start = (time) => {
    outerStart(time);
    context.currentTime = 1.02;
  };
  const at = pitchAhead(synth, 'E4', 1.005);
  assert.ok(at > context.currentTime, `${at} is after the clock ${context.currentTime}`);
});

test('an export\'s early start also sets the note\'s own pitch at its start, right after the 0 Hz hold (scan r39)', () => {
  // (Tone sets it again later in the note, after its oscillators start)
  const { synth, pitch } = fakeFm({ offline: true });
  const start = 1.005;
  let seen = null;
  const outer = synth.oscillator;
  const outerStart = outer.start.bind(outer);
  outer.start = (time) => {
    seen = pitch.map((p) => [...p]);
    outerStart(time);
  };
  assert.equal(pitchAhead(synth, 'E4', start), start);
  assert.equal(pitch[0][0], 0);
  assert.ok(pitch[0][1] < start - BLOCK, 'held from before the oscillators start');
  assert.deepEqual(seen, [pitch[0], [329.63, start]], 'the pitch at the start is set before any oscillator starts');
  assert.deepEqual(pitch, [pitch[0], [329.63, start]], 'exactly at the start, so the wave still begins there');
});

test('the note moved up past the clock: its pitch is set at the moved-up start only, so no oscillator starts its wave before the others (scan r39, r42)', () => {
  const { synth, context, pitch } = fakeFm();
  const outer = synth.oscillator;
  const outerStart = outer.start.bind(outer);
  outer.start = (time) => {
    outerStart(time);
    context.currentTime = 1.02;
  };
  const at = pitchAhead(synth, 'E4', 1.005);
  assert.ok(at > context.currentTime);
  assert.deepEqual(pitch.slice(1), [[329.63, at]]);
});

/** A stand-in for a Tone MetalSynth (a hat): its six FM pairs, its clock (a render callback of 10 ms), its pitch. The clock steps on by `step` inside the start of pair `stepAt` (0 to 5), or by steps[i] inside pair i's. */
function fakeHat({ now = 1, offline = false, stepAt = -1, step = 0, steps = { [stepAt]: step }, context = { currentTime: now, sampleRate: SR, isOffline: offline, rawContext: { baseLatency: 0.01 } } } = {}) {
  let n = 0;
  const onStart = () => {
    context.currentTime += steps[n++] ?? 0;
  };
  const pitch = [];
  const synth = Object.create(Tone.MetalSynth.prototype);
  Object.defineProperties(synth, {
    context: { value: context },
    _oscillators: { value: Array.from({ length: 6 }, () => fakeSource(context, onStart)) },
    frequency: {
      value: {
        setValueAtTime: (v, t) => pitch.push([v, t]),
        cancelScheduledValues: (t) => pitch.splice(0, pitch.length, ...pitch.filter((p) => p[1] < t)),
      },
    },
    toFrequency: { value: (f) => (typeof f === 'number' ? f : 200) },
  });
  return { synth, context, pitch };
}
/** A live note's room past the clock with that callback: four blocks and a frame (see soundLead.ts). */
const ROOM = (4 * 128 + 1) / SR;

test('live, a hat held up after any number of its six pairs have started: all six start early, and its pitch leaves 0 Hz once, at the note, after the last of them (scan r42)', () => {
  for (let k = 0; k < 6; k++) {
    const { synth, context, pitch } = fakeHat({ stepAt: k, step: 0.0116 });
    // (Played by hand: a callback past the clock at the press)
    const start = 1 + ROOM;
    const at = pitchAhead(synth, 200, start);
    for (const [i, osc] of synth._oscillators.entries()) {
      assert.equal(osc.events.length, 1, `held up after ${k}: pair ${i} started early`);
      assert.ok(osc.events[0].time < at, `held up after ${k}: pair ${i} started before the note`);
    }
    // (Any pitch but 0 before the note would set the pairs started then going before the rest)
    assert.deepEqual(pitch.map(([v]) => v), [0, 200], `held up after ${k}`);
    assert.equal(pitch[1][1], at);
    // Two blocks past the clock as it is now (sooner than its attack would be moved to otherwise)
    assert.ok(Math.abs(at - (context.currentTime + (2 * 128 + 1) / SR)) < 1e-12, `held up after ${k}: ${at} vs the clock ${context.currentTime}`);
  }
});

test('live, a hat not held up keeps its time, every pair started a block early (scan r42)', () => {
  const { synth, pitch } = fakeHat();
  const start = 1 + ROOM;
  assert.equal(pitchAhead(synth, 200, start), start);
  for (const osc of synth._oscillators) assert.deepEqual(osc.events, [{ state: 'started', time: start - BLOCK }]);
  assert.deepEqual(pitch, [[0, start - 2 * BLOCK], [200, start]]);
});

/** fakeHat struck as Tone strikes a MetalSynth (through toneFixes.ts's whole-note strike): its envelope's attack, then its pairs started at the note; what was set when its envelope was reached is kept in `seen`. */
async function fakeStruckHat({ stepBeforeEnvelope = [], ...options } = {}) {
  const { env, context, attacks } = await fakeEnvelope();
  context.rawContext = { baseLatency: 0.01 };
  const hat = fakeHat({ ...options, context });
  const seen = [];
  // (how far the clock steps on just before the envelope, strike by strike: the page held up there)
  const steps = [...stepBeforeEnvelope];
  Object.defineProperties(hat.synth, {
    toSeconds: { value: (t) => t },
    log: { value: () => {} },
    envelope: { value: env },
    setNote: { value: () => {} },
    _triggerEnvelopeAttack: {
      value: (time, velocity) => {
        seen.push({ time, started: hat.synth._oscillators.map((osc) => osc.events.length), pitch: hat.pitch.map((p) => [...p]) });
        context.currentTime += steps.shift() ?? 0;
        env.triggerAttack(time, velocity);
        for (const osc of hat.synth._oscillators) osc.start(time);
      },
    },
  });
  return { ...hat, env, attacks, seen };
}

test('live, a held-up hat is struck where all six pairs begin together: all started, and its pitch set there, before its attack (scan r42)', async () => {
  const { synth, attacks, seen } = await fakeStruckHat({ stepAt: 2, step: 0.0116 });
  const at = attackAhead(synth, 200, 1 + ROOM, (t) => synth.triggerAttack(200, t, 1));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].time, at);
  assert.deepEqual(seen[0].started, [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(seen[0].pitch.slice(1), [[200, at]]);
  assert.deepEqual(attacks, [at]);
});

test('live, a hat whose clock moves on between its last pair\'s start and its strike is struck where it can come, its pitch set there first (scan r42)', async () => {
  const { synth, context, attacks, seen } = await fakeStruckHat();
  const start = 1 + ROOM;
  const at = attackAhead(synth, 200, start, (t) => {
    // (The page held up just before the strike: the clock three blocks on)
    context.currentTime += 3 * BLOCK;
    synth.triggerAttack(200, t, 1);
  });
  assert.ok(Math.abs(at - (1 + 5 * BLOCK + 1 / SR)) < 1e-12, `${at}: two blocks past the clock`);
  assert.deepEqual(seen[0].pitch.slice(1), [[200, at]]);
  assert.deepEqual(attacks, [at]);
});

test('an export\'s hat keeps its time and starts every pair a block early, its clock right by it', () => {
  const start = 1 + BLOCK + 0.0005;
  const { synth, pitch } = fakeHat({ offline: true });
  assert.equal(pitchAhead(synth, 200, start), start);
  for (const osc of synth._oscillators) assert.deepEqual(osc.events, [{ state: 'started', time: start - BLOCK }]);
  assert.deepEqual(pitch.map(([v]) => v), [0, 200]);
});

test('a one-shot start whose gain is set as the clock steps on past it: a later stop or restart leaves that gain alone (scan r39)', async () => {
  await import('../src/audio/toneFixes.ts');
  const proto = Object.getPrototypeOf(Tone.ToneBufferSource.prototype);
  const context = { currentTime: 0.999 };
  const set = [];
  const source = Object.create(proto);
  Object.assign(source, {
    context,
    _startTime: -1,
    _fadeIn: 0,
    toSeconds: (t) => t,
    // (The browser moves a gain set in the past up to the clock: here the clock steps on as it's set)
    _gainNode: { gain: { setValueAtTime: (v, t) => { context.currentTime = 1.01; set.push([v, Math.max(t, context.currentTime)]); } } },
  });
  source._startGain(1);
  // Tone's stop and restart cancel from just after the start it noted: that must come after the gain set
  assert.ok(source._startTime >= set[0][1], `${source._startTime} is at or after the gain set at ${set[0][1]}`);
});

/** A stand-in for a Tone envelope (Tone's own triggerAttack and triggerRelease run on it): its clock and the attacks and releases it sets. */
async function fakeEnvelope({ now = 1, offline = false, stepOnAttack = () => 0 } = {}) {
  await import('../src/audio/toneFixes.ts');
  const context = { currentTime: now, sampleRate: SR, isOffline: offline };
  const attacks = [];
  const releases = [];
  const env = Object.create(Tone.Envelope.prototype);
  const sig = {
    getValueAtTime: () => 0,
    // (an attack: linear; the clock may step on as it's set, the page held up)
    linearRampTo: (v, ramp, t) => {
      attacks.push(t);
      context.currentTime += stepOnAttack(attacks.length);
    },
    exponentialApproachValueAtTime: () => {},
    targetRampTo: (v, ramp, t) => releases.push(t),
  };
  Object.defineProperties(env, {
    context: { value: context },
    toSeconds: { value: (t) => t },
    log: { value: () => {} },
    _sig: { value: sig },
  });
  Object.assign(env, { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05, _attackCurve: 'linear', _decayCurve: 'exponential', _releaseCurve: 'exponential' });
  return { env, context, attacks, releases, sig };
}

test('an envelope attack more than a render block past the clock keeps its time (scan r40)', async () => {
  const { env, attacks } = await fakeEnvelope();
  env.triggerAttack(1 + 2 * BLOCK);
  assert.deepEqual(attacks, [1 + 2 * BLOCK]);
});

test('an envelope attack less than a block past the clock (the sound may already be past it) comes a block past the clock (scan r40)', async () => {
  const { env, attacks } = await fakeEnvelope();
  env.triggerAttack(1.001);
  assert.equal(attacks.length, 1);
  assert.ok(attacks[0] >= 1 + BLOCK && attacks[0] < 1 + BLOCK + 2 / SR, `${attacks[0]}`);
});

test('the clock moving on past an attack while it is set: struck again a block past the clock, and a release that would cut it moves with it (scan r40)', async () => {
  const { env, attacks, releases, sig } = await fakeEnvelope({ stepOnAttack: (n) => (n === 1 ? 0.008 : 0) });
  sig.getValueAtTime = () => 0.5;
  env.triggerAttack(1.005);
  assert.equal(attacks.length, 2);
  assert.equal(attacks[0], 1.005);
  assert.ok(attacks[1] >= 1.008 + BLOCK, `${attacks[1]}`);
  // (A release 2 ms after the time asked, before the attack now is: still 2 ms after it)
  env.triggerRelease(1.007);
  assert.ok(Math.abs(releases[0] - (attacks[1] + 0.002)) < 1e-9, `${releases[0]}`);
  // A release well after the attack (a key let go, a longer note) is left where it is
  env.triggerRelease(1.035);
  assert.equal(releases[1], 1.035);
});

test('an attack struck again at most three times, however long the page is held up (scan r40)', async () => {
  const { env, attacks } = await fakeEnvelope({ stepOnAttack: () => 0.01 });
  env.triggerAttack(1.005);
  assert.equal(attacks.length, 3);
});

test('an export\'s envelope keeps every time it is given, even one at its clock (scan r40)', async () => {
  const { env, attacks, releases } = await fakeEnvelope({ offline: true, stepOnAttack: () => 0.01 });
  env.triggerAttack(1);
  env.triggerRelease(1.03);
  assert.deepEqual(attacks, [1]);
  assert.deepEqual(releases, []);
});

/** A stand-in for a Tone synth (Tone's own triggerAttack runs on it) whose clock can step on between its envelope's attack and its source's start. */
async function fakeStrikeSynth({ offline = false, stepBeforeSource = 0 } = {}) {
  const { env, context, attacks } = await fakeEnvelope({ offline });
  const starts = [];
  // (A drum's source is stopped at the end of its decay as it starts: its last start is still found)
  const source = { _state: { getLastState: (state) => (state === 'started' && starts.length ? { time: starts[starts.length - 1] } : undefined) } };
  // (how far the clock steps on before each source start: one hold-up, or one in each strike)
  const steps = [].concat(stepBeforeSource);
  const synth = Object.create(Tone.Synth.prototype);
  Object.defineProperties(synth, {
    context: { value: context },
    toSeconds: { value: (t) => t },
    log: { value: () => {} },
    envelope: { value: env },
    oscillator: { value: source },
    setNote: { value: () => {} },
    _triggerEnvelopeAttack: {
      value: (time, velocity) => {
        env.triggerAttack(time, velocity);
        // (Tone moves a start that's already past up to the clock)
        context.currentTime += steps.shift() ?? 0;
        starts.push(Math.max(time, context.currentTime));
      },
    },
  });
  return { synth, context, attacks, starts };
}

test('a synth whose source starts in time after its envelope plays once, where it was asked (scan r40)', async () => {
  const { synth, attacks, starts } = await fakeStrikeSynth();
  synth.triggerAttack('C4', 1.01, 1);
  assert.deepEqual(attacks, [1.01]);
  assert.deepEqual(starts, [1.01]);
});

test('a synth whose source started well after its envelope\'s attack (the page held up in between) is struck again whole, a block past the clock (scan r40)', async () => {
  const { synth, context, attacks, starts } = await fakeStrikeSynth({ stepBeforeSource: 0.1 });
  synth.triggerAttack('C4', 1.01, 1);
  assert.equal(attacks.length, 2);
  assert.equal(starts.length, 2);
  assert.ok(attacks[1] >= context.currentTime + BLOCK && starts[1] === attacks[1], `${attacks} ${starts}`);
});

test('an export\'s synth is never struck again (scan r40)', async () => {
  const { synth, attacks } = await fakeStrikeSynth({ offline: true, stepBeforeSource: 0.1 });
  synth.triggerAttack('C4', 1.01, 1);
  assert.equal(attacks.length, 1);
});

test('a synth held up again while it is struck again is struck once more, three strikes at most (scan r40)', async () => {
  const { synth, attacks, starts } = await fakeStrikeSynth({ stepBeforeSource: [0.1, 0.1, 0.1, 0.1] });
  synth.triggerAttack('C4', 1.01, 1);
  assert.equal(attacks.length, 3);
  assert.equal(starts.length, 3);
});

test('the room kept ahead of the clock is a whole render callback, in blocks: 10 ms at 44.1 kHz is four (scan r40)', async () => {
  const { soundLead } = await import('../src/audio/toneFixes.ts');
  assert.equal(soundLead({ sampleRate: SR, rawContext: { baseLatency: 0.01 } }), (4 * 128) / SR);
  assert.equal(soundLead({ sampleRate: 48000, rawContext: { baseLatency: 256 / 48000 } }), 256 / 48000);
  // (None said, or none: a block)
  assert.equal(soundLead({ sampleRate: SR }), BLOCK);
  assert.equal(soundLead({ sampleRate: SR, rawContext: { baseLatency: 0 } }), BLOCK);
  // (Never more than 0.1 s)
  assert.equal(soundLead({ sampleRate: SR, rawContext: { baseLatency: 2 } }), 0.1);
});

test('a synth\'s note struck within a callback of the clock moves up whole, its source with its envelope (scan r40)', async () => {
  const { synth, context, attacks, starts } = await fakeStrikeSynth();
  context.rawContext = { baseLatency: 0.01 };
  synth.triggerAttack('C4', 1.005, 1);
  const room = 1 + (4 * 128 + 1) / SR;
  assert.equal(attacks.length, 1);
  assert.ok(Math.abs(attacks[0] - room) < 1e-12 && starts[0] === attacks[0], `${attacks} ${starts}`);
});

test('live, a hat held up just before its attack is set: nothing of it is set there, its pairs start again for where it has to go, and it is struck there, all six together (scan r42)', async () => {
  const { env, context, attacks } = await fakeEnvelope();
  context.rawContext = { baseLatency: 0.01 };
  const { synth, pitch } = fakeHat({ context });
  const start = 1 + ROOM;
  const tried = [];
  const at = attackAhead(synth, 200, start, (t) => {
    tried.push(t);
    // (The page held up a callback just as the attack is set, the first time)
    if (tried.length === 1) context.currentTime += 0.0116;
    env.triggerAttack(t);
    for (const osc of synth._oscillators) osc.start(t);
  });
  assert.deepEqual(tried, [start, at]);
  assert.ok(Math.abs(at - (1.0116 + ROOM)) < 1e-9, `${at}: a callback past the clock as it is after the hold-up`);
  assert.deepEqual(attacks, [at], 'its envelope set once, where it went');
  for (const osc of synth._oscillators) {
    // (Started early, stopped while silent, started early again for the new time, then Tone's own start at the note)
    assert.deepEqual(osc.events.map((e) => e.state), ['started', 'stopped', 'started', 'started']);
    assert.ok(osc.events[2].time < at && osc.events[2].time > osc.events[1].time);
  }
  // Its pitch leaves 0 Hz only at the note as it went
  assert.deepEqual(pitch.filter(([v]) => v !== 0).map(([, t]) => t), [at]);
  assert.ok(pitch.filter(([v]) => v === 0).some(([, t]) => t >= 1.0116 && t < at - 128 / SR), 'held at 0 Hz again before the new early start');
});

test('a whole strike made exactly that has to move is told where it comes before anything of it is set (scan r42)', async () => {
  const { strikeExactly } = await import('../src/audio/soundLead.ts');
  const { synth, context, attacks, starts } = await fakeStrikeSynth();
  context.rawContext = { baseLatency: 0.01 };
  const settled = [];
  // (Asked for less than a couple of blocks past the clock)
  strikeExactly(() => synth.triggerAttack('C4', 1.001, 1), (at) => settled.push([at, attacks.length, starts.length]));
  const at = 1 + (2 * 128 + 1) / SR;
  assert.ok(Math.abs(settled[0][0] - at) < 1e-12, `${settled[0][0]}`);
  assert.deepEqual(settled[0].slice(1), [0, 0]);
  assert.deepEqual(attacks, [settled[0][0]]);
  assert.deepEqual(starts, [settled[0][0]]);
});

test('a note struck exactly whose clock steps on a block while its envelope is set keeps its attack where its oscillators wait: the clock is still a block short of it (scan r42)', async () => {
  const { strikeExactly } = await import('../src/audio/soundLead.ts');
  const { env, context, attacks } = await fakeEnvelope({ stepOnAttack: (n) => (n === 1 ? BLOCK : 0) });
  context.rawContext = { baseLatency: 0.01 };
  const at = 1 + ROOM;
  strikeExactly(() => env.triggerAttack(at));
  assert.deepEqual(attacks, [at]);
  // Not struck exactly, it's struck again a callback past the clock, as ever
  const plain = await fakeEnvelope({ stepOnAttack: (n) => (n === 1 ? BLOCK : 0) });
  plain.context.rawContext = { baseLatency: 0.01 };
  plain.env.triggerAttack(at);
  assert.equal(plain.attacks.length, 2);
});

test('a note struck exactly whose clock steps on to within a block of its attack while it is set is struck again, as ever (scan r42)', async () => {
  const { strikeExactly } = await import('../src/audio/soundLead.ts');
  const { env, context, attacks } = await fakeEnvelope({ stepOnAttack: (n) => (n === 1 ? 4 * BLOCK : 0) });
  context.rawContext = { baseLatency: 0.01 };
  const at = 1 + ROOM;
  strikeExactly(() => env.triggerAttack(at));
  assert.equal(attacks.length, 2);
  assert.ok(attacks[1] >= context.currentTime + 4 * BLOCK, `${attacks}`);
});

test('a note struck exactly keeps its later envelopes (an FM note\'s modulation) where it asks while the clock is a block short of them (scan r42)', async () => {
  const { strikeExactly } = await import('../src/audio/soundLead.ts');
  const carrier = await fakeEnvelope();
  const modulation = await fakeEnvelope();
  for (const { context } of [carrier, modulation]) context.rawContext = { baseLatency: 0.01 };
  const at = 1 + ROOM;
  strikeExactly(() => {
    carrier.env.triggerAttack(at);
    // (The clock steps on a block between them)
    modulation.context.currentTime += BLOCK;
    modulation.env.triggerAttack(at);
  });
  assert.deepEqual(carrier.attacks, [at]);
  assert.deepEqual(modulation.attacks, [at]);
});

test('live, a hat held up a block while its pairs start keeps its time: the clock is still a block short of it, so every start reached the sound in time (scan r42)', () => {
  const { synth, pitch } = fakeHat({ stepAt: 3, step: BLOCK });
  const start = 1 + ROOM;
  assert.equal(pitchAhead(synth, 200, start), start);
  for (const osc of synth._oscillators) assert.equal(osc.events.length, 1);
  assert.deepEqual(pitch.slice(1), [[200, start]]);
});

test('a whole strike made exactly keeps its time while the clock is a couple of blocks short of it, less than a callback (scan r42)', async () => {
  const { strikeExactly } = await import('../src/audio/soundLead.ts');
  const { synth, context, attacks, starts } = await fakeStrikeSynth();
  context.rawContext = { baseLatency: 0.01 };
  const at = 1 + 3 * BLOCK;
  strikeExactly(() => synth.triggerAttack('C4', at, 1));
  assert.deepEqual(attacks, [at]);
  assert.deepEqual(starts, [at]);
});

test('live, a hat whose clock moves on a block or two while its pairs start keeps its time; three, and it comes two blocks past the clock once they are, sooner than a callback past it (scan r42)', () => {
  const kept = fakeHat({ steps: { 2: BLOCK, 4: BLOCK } });
  assert.equal(pitchAhead(kept.synth, 200, 1 + ROOM), 1 + ROOM);
  const moved = fakeHat({ steps: { 2: 2 * BLOCK, 4: BLOCK } });
  const at = pitchAhead(moved.synth, 200, 1 + ROOM);
  assert.ok(Math.abs(at - (moved.context.currentTime + (2 * 128 + 1) / SR)) < 1e-12, `${at}`);
  for (const osc of moved.synth._oscillators) {
    assert.equal(osc.events.length, 1);
    assert.ok(osc.events[0].time < at);
  }
  assert.deepEqual(moved.pitch.slice(1), [[200, at]]);
});

test('with a render callback of one block, a note struck exactly comes no later than any note\'s attack would: a callback past the clock (scan r42)', () => {
  // (fakeFm's clock says nothing of its callback: a block)
  const { synth, context } = fakeFm({ stepInStart: BLOCK });
  const at = pitchAhead(synth, 'E4', 1 + BLOCK + 1 / SR);
  assert.ok(Math.abs(at - (context.currentTime + BLOCK + 1 / SR)) < 1e-12, `${at}`);
});

test('live, a hat held up just before its attack on each of its first two strikes is struck the third time as any note is, a callback past the clock, its pitch there (scan r42)', async () => {
  const { synth, context, pitch, attacks, seen } = await fakeStruckHat({ stepBeforeEnvelope: [4 * BLOCK, 4 * BLOCK] });
  const at = attackAhead(synth, 200, 1 + ROOM, (t) => synth.triggerAttack(200, t, 1));
  assert.equal(seen.length, 3);
  assert.ok(Math.abs(at - (context.currentTime + ROOM)) < 1e-12, `${at}`);
  assert.deepEqual(attacks, [at]);
  assert.deepEqual(pitch.filter(([v]) => v !== 0).map(([, t]) => t), [at]);
  for (const osc of synth._oscillators) assert.deepEqual(osc.events.map((e) => e.state), ['started', 'stopped', 'started', 'stopped', 'started', 'started']);
});

test('live, a hat whose clock moves on three blocks just before its envelope (a block short of it, but not two) is let go before anything is set and struck where its pairs wait again (scan r42)', async () => {
  const { synth, attacks, pitch, seen } = await fakeStruckHat({ stepBeforeEnvelope: [3 * BLOCK] });
  const at = attackAhead(synth, 200, 1 + ROOM, (t) => synth.triggerAttack(200, t, 1));
  assert.equal(seen.length, 2);
  assert.deepEqual(attacks, [at]);
  assert.ok(at > 1 + 3 * BLOCK + 2 * BLOCK, `${at}`);
  assert.deepEqual(pitch.filter(([v]) => v !== 0).map(([, t]) => t), [at]);
  for (const osc of synth._oscillators) assert.deepEqual(osc.events.map((e) => e.state), ['started', 'stopped', 'started', 'started']);
});
