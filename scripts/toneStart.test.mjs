// A Tone synth's note started a render block early (src/audio/presets/toneStart.ts): the audio clock moving on
// while its oscillators start (live, a busy main thread) must not leave the note silent at the 0 Hz it's held at.
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
    _state: { get: (t) => [...events].reverse().find((e) => e.time <= t) ?? null },
    start(time) {
      onStart();
      const at = Math.max(time, context.currentTime);
      const last = events[events.length - 1];
      if (last && last.state === 'started' && !(at > last.time + 1e-6)) throw new Error('Start time must be strictly greater than previous start time');
      events.push({ state: 'started', time: at });
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

test('the clock stepping past the note while it starts: the note comes just after where Tone put the start', () => {
  const { synth } = fakeFm({ stepInStart: 0.00871 });
  const start = 1.005;
  const at = pitchAhead(synth, 'E4', start);
  const landed = synth.oscillator.events[0].time;
  assert.ok(landed >= start, 'the early start was moved past the note');
  assert.ok(at > landed && at - landed < 0.0001, `the note starts just after it (${at} vs ${landed})`);
  // (The modulator, the clock now past its early start, starts with the note instead)
  assert.equal(synth.modulation.events.length, 0);
  // Tone's own start at the note's time then goes through
  synth.oscillator.start(at);
  synth.modulation.start(at);
});

test('the clock already past the early start: only the pitch is set early', () => {
  const { synth, pitch } = fakeFm({ now: 1 });
  const start = 1 + BLOCK * 0.5;
  assert.equal(pitchAhead(synth, 'E4', start), start);
  assert.equal(synth.oscillator.events.length, 0);
  assert.deepEqual(pitch.map(([v]) => v), [329.63]);
});

test('an export takes the early start right up to its clock (no room kept)', () => {
  const start = 1 + BLOCK + 0.0005;
  const live = fakeFm({ now: 1 });
  const offline = fakeFm({ now: 1, offline: true });
  pitchAhead(live.synth, 'E4', start);
  pitchAhead(offline.synth, 'E4', start);
  assert.equal(live.synth.oscillator.events.length, 0);
  assert.equal(offline.synth.oscillator.events.length, 1);
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

test('an early start also sets the note\'s own pitch at its start, right after the 0 Hz hold (scan r39)', () => {
  // (Tone sets it again later in the note, after its oscillators start: should the clock move on
  // before that, what's already rendered must not be left at 0 Hz)
  const { synth, pitch } = fakeFm();
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

test('the note moved up past the clock: its pitch is set at the moved-up start too (scan r39)', () => {
  const { synth, context, pitch } = fakeFm();
  const outer = synth.oscillator;
  const outerStart = outer.start.bind(outer);
  outer.start = (time) => {
    outerStart(time);
    context.currentTime = 1.02;
  };
  const at = pitchAhead(synth, 'E4', 1.005);
  assert.ok(at > context.currentTime);
  assert.deepEqual(pitch.slice(1), [[329.63, 1.005], [329.63, at]]);
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
