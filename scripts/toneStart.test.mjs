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
const { attackAhead } = await import('../src/audio/presets/toneStart.ts');
/** A note set ahead with nothing struck (its strike leaves the rest to Tone): where it starts. */
const pitchAhead = (synth, note, start) => attackAhead(synth, note, start, () => {});

const SR = 44100;
const BLOCK = 128 / SR;

/** A stand-in for a Tone source: its starts kept as Tone keeps them, moved up to the clock when past (as Tone does). */
function fakeSource(context, onStart = () => {}) {
  const events = [];
  return {
    events,
    _state: {
      get: (t) => [...events].reverse().find((e) => e.time <= t) ?? null,
      getLastState: (state, t) => [...events].reverse().find((e) => e.state === state && e.time <= t),
      getValueAtTime: (t) => [...events].reverse().find((e) => e.time <= t)?.state ?? 'stopped',
    },
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

/** A stand-in for a Tone Signal kept as [value, time] pairs: what a note sets on it, cancels and holds. */
function fakePitch(pitch) {
  const valueAt = (t) => {
    let v = 0;
    for (const [pv, pt] of pitch) if (pt <= t) v = pv;
    return v;
  };
  return {
    setValueAtTime: (v, t) => pitch.push([v, t]),
    cancelScheduledValues: (t) => pitch.splice(0, pitch.length, ...pitch.filter((p) => p[1] < t)),
    cancelAndHoldAtTime: (t) => {
      const v = valueAt(t);
      pitch.splice(0, pitch.length, ...pitch.filter((p) => p[1] < t), [v, t]);
    },
    linearRampToValueAtTime: (v, t) => pitch.push([v, t]),
    getValueAtTime: valueAt,
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
    frequency: { value: fakePitch(pitch) },
    toFrequency: { value: (n) => (typeof n === 'number' ? n : 329.63) },
  });
  return { synth, context, pitch };
}

test('a note in time starts its oscillators a block early, held at 0 Hz, and keeps its time', () => {
  const { synth, pitch } = fakeFm();
  const start = 1.02;
  assert.equal(pitchAhead(synth, 'E4', start), start);
  assert.deepEqual(synth.oscillator.events, [{ state: 'started', time: start - BLOCK }]);
  assert.deepEqual(synth.modulation.events, [{ state: 'started', time: start - BLOCK }]);
  assert.equal(pitch[0][0], 0);
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

/** A stand-in for a Tone MetalSynth (a hat): its six FM pairs, its clock (a render callback of 10 ms), its pitch. The clock steps on by `step` inside the start of pair `stepAt` (0 to 5), or by steps[i] inside pair i's. */
function fakeHat({ now = 1, offline = false, stepAt = -1, step = 0, steps = { [stepAt]: step }, context = { currentTime: now, sampleRate: SR, isOffline: offline, rawContext: { baseLatency: 0.01 } } } = {}) {
  let n = 0;
  const onStart = () => {
    const held = steps[n++] ?? 0;
    context.currentTime += held;
  };
  const pitch = [];
  const synth = Object.create(Tone.MetalSynth.prototype);
  Object.defineProperties(synth, {
    context: { value: context },
    _oscillators: { value: Array.from({ length: 6 }, () => fakeSource(context, onStart)) },
    frequency: { value: fakePitch(pitch) },
    toFrequency: { value: (f) => (typeof f === 'number' ? f : 200) },
  });
  return { synth, context, pitch };
}
/** A live note's room past the clock with that callback: four blocks and a frame (see soundLead.ts). */
const ROOM = (4 * 128 + 1) / SR;
/** Where a note struck again goes: two blocks past the clock, and a frame (see soundLead.ts retryRoom). */
const RETRY = (2 * 128 + 1) / SR;

test('live, a hat not held up keeps its time, every pair started a block early (scan r42)', () => {
  const { synth, pitch } = fakeHat();
  const start = 1 + ROOM;
  assert.equal(pitchAhead(synth, 200, start), start);
  for (const osc of synth._oscillators) assert.deepEqual(osc.events, [{ state: 'started', time: start - BLOCK }]);
  assert.deepEqual(pitch, [[0, start - 2 * BLOCK], [200, start]]);
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
async function fakeEnvelope({ now = 1, offline = false, stepOnAttack = () => 0, stepOnDecay = 0 } = {}) {
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
      const held = stepOnAttack(attacks.length);
      context.currentTime += held;
    },
    exponentialApproachValueAtTime: () => {
      context.currentTime += stepOnDecay;
    },
    targetRampTo: (v, ramp, t) => releases.push(t),
    // (a strike found late once heard fades it out: see soundLead.ts strikeWhole)
    fades: [],
    cancelAndHoldAtTime: (t) => sig.fades.push(['hold', t]),
    linearRampToValueAtTime: (v, t) => sig.fades.push(['ramp', v, t]),
    setTargetAtTime: (v, t) => sig.fades.push(['target', v, t]),
    setValueAtTime: () => {},
    cancelScheduledValues: () => {},
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

test('an export\'s envelope keeps every time it is given, even one at its clock (scan r40)', async () => {
  const { env, attacks, releases } = await fakeEnvelope({ offline: true, stepOnAttack: () => 0.01 });
  env.triggerAttack(1);
  env.triggerRelease(1.03);
  assert.deepEqual(attacks, [1]);
  assert.deepEqual(releases, []);
});

/** A stand-in for a Tone synth (Tone's own triggerAttack runs on it) whose clock can step on before its source's start, strike by strike; `order` is what it set, in turn. */
async function fakeStrikeSynth({ offline = false, stepBeforeSource = 0, stepOnAttack, stepOnDecay, setNote } = {}) {
  const { env, context, attacks, releases, sig } = await fakeEnvelope({ offline, stepOnAttack, stepOnDecay });
  context.rawContext = { baseLatency: 0.01 };
  const order = [];
  const linearRampTo = sig.linearRampTo;
  sig.linearRampTo = (...a) => {
    order.push(['attack', a[2]]);
    return linearRampTo(...a);
  };
  const source = fakeSource(context);
  const starts = [];
  const start = source.start.bind(source);
  source.start = (time) => {
    start(time);
    starts.push(source.events.at(-1).time);
    order.push(['start', source.events.at(-1).time]);
  };
  const stop = source.stop.bind(source);
  source.stop = (time) => {
    stop(time);
    order.push(['stop', source.events.at(-1).time]);
  };
  // (how far the clock steps on before each source start: one hold-up, or one in each strike)
  const steps = [].concat(stepBeforeSource);
  const pitch = [];
  const synth = Object.create(Tone.Synth.prototype);
  Object.defineProperties(synth, {
    context: { value: context },
    toSeconds: { value: (t) => t },
    log: { value: () => {} },
    envelope: { value: env },
    oscillator: { value: source },
    frequency: { value: fakePitch(pitch) },
    setNote: { value: (note, t) => (setNote ? setNote(note, t) : pitch.push([note, t])) },
    _triggerEnvelopeAttack: {
      value: (time, velocity) => {
        env.triggerAttack(time, velocity);
        const held = steps.shift() ?? 0;
        context.currentTime += held;
        source.start(time);
      },
    },
  });
  return { synth, context, attacks, releases, starts, order, source, pitch, sig, env };
}

test('an export\'s synth is never struck again (scan r40)', async () => {
  const { synth, attacks } = await fakeStrikeSynth({ offline: true, stepBeforeSource: 0.1 });
  synth.triggerAttack('C4', 1.01, 1);
  assert.equal(attacks.length, 1);
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

test('live, a synth\'s note sets its loudness envelope last, once its pitch and source are set: the strike\'s last step (scan r44)', async () => {
  const { synth, order, pitch } = await fakeStrikeSynth();
  synth.triggerAttack('C4', 1.05, 1);
  assert.deepEqual(order, [['start', 1.05], ['attack', 1.05]]);
  assert.deepEqual(pitch, [['C4', 1.05]]);
});

test('live, the page held up while a synth\'s note is set: nothing of it heard, its source stopped and its pitch taken away, and the whole note struck once two blocks past the clock (scan r44)', async () => {
  const { synth, context, attacks, order, pitch } = await fakeStrikeSynth({ stepBeforeSource: 0.02 });
  synth.triggerAttack('C4', 1.001, 1);
  const at = 1.02 + RETRY;
  // Its envelope set once, where it went; the first try's source stopped before it was ever heard
  assert.equal(attacks.length, 1);
  assert.ok(Math.abs(attacks[0] - at) < 1e-12, `${attacks[0]} vs ${at}`);
  assert.deepEqual(order.map(([what]) => what), ['start', 'stop', 'start', 'attack']);
  // (Moved up to the clock by the hold-up, it's stopped right there: its envelope, never set, kept it silent)
  assert.ok(order[1][1] <= order[0][1] + 1e-12, 'stopped no later than it started');
  // (The pitch before it held where it was, 0 here; the note's own only where it went)
  assert.deepEqual(pitch.filter(([v]) => v !== 0), [['C4', attacks[0]]]);
});

test('live, the clock stepping on while a note\'s envelope is set (its last step), still a block short of it after: never struck again, so it never rises twice (scan r43)', async () => {
  for (const step of [BLOCK, 3 * BLOCK, 0.008]) {
    const { synth, attacks, starts } = await fakeStrikeSynth({ stepOnAttack: (n) => (n === 1 ? step : 0) });
    synth.triggerAttack('C4', 1.001, 1);
    assert.equal(attacks.length, 1, `stepped ${step}`);
    assert.equal(starts.length, 1, `stepped ${step}`);
  }
});

test('live, held up inside its last step past the note (its envelope may have reached the sound late: silent, or a burst): faded out over 3 ms and struck again whole two blocks past the clock (scan r44)', async () => {
  const { synth, context, attacks, starts, sig } = await fakeStrikeSynth({ stepOnAttack: (n) => (n === 1 ? 0.03 : 0) });
  synth.triggerAttack('C4', 1.001, 1);
  assert.equal(attacks.length, 2);
  assert.equal(starts.length, 2);
  // (Faded from where it is at the clock, to nothing 3 ms on)
  assert.deepEqual(sig.fades, [
    ['hold', 1.03],
    ['ramp', 0, 1.03 + 0.003],
  ]);
  assert.ok(Math.abs(attacks[1] - (context.currentTime + RETRY)) < 1e-9, `${attacks[1]}`);
});

test('live, a gliding note struck again: the glide under way is held where the note took it over (at the first try\'s time), not sent back to where it began (scan r44)', async () => {
  let glide;
  const { synth, attacks, pitch } = await fakeStrikeSynth({
    stepBeforeSource: 0.02,
    // (Tone's portamento: the glide held where it is at the note, then on to the note's pitch)
    setNote: (note, t) => {
      glide.cancelAndHoldAtTime(t);
      glide.linearRampToValueAtTime(261.6, t + 0.035);
    },
  });
  glide = synth.frequency;
  // (The last note's glide under way: at 150 by the first try's time, 200 at its end)
  pitch.push([150, 1.005], [200, 1.1]);
  synth.triggerAttack('C4', 1.001, 1);
  assert.equal(attacks.length, 1);
  const first = 1 + ROOM;
  // The first try's own moments gone, the glide held where it was then: 150 from there (not left
  // ending nowhere, as cancelling the hold left it), then the second try's
  assert.deepEqual(pitch.filter(([, t]) => t >= first - 1e-9 && t < attacks[0]), [[150, first]], JSON.stringify(pitch));
  assert.deepEqual(pitch.filter(([, t]) => t >= attacks[0]), [
    [150, attacks[0]],
    [261.6, attacks[0] + 0.035],
  ]);
});

test('live, a note held up at every strike is struck four times at most, the last a callback later still and heard however it went (scan r44)', async () => {
  const { synth, context, attacks, starts } = await fakeStrikeSynth({ stepBeforeSource: [0.02, 0.02, 0.02, 0.02, 0.02] });
  synth.triggerAttack('C4', 1.001, 1);
  assert.equal(starts.length, 4);
  assert.equal(attacks.length, 1);
  assert.ok(attacks[0] >= 1.06 + ROOM - 1 / SR + 4 * BLOCK - 1e-9, `${attacks[0]} (clock ${context.currentTime})`);
});

test('live, a release asked before a note moved later (or within as long again after it) moves with it; a later one stays (scan r40, r44)', async () => {
  const { synth, attacks, releases, sig, env } = await fakeStrikeSynth();
  sig.getValueAtTime = () => 0.5;
  synth.triggerAttack('C4', 1.001, 1);
  env.triggerRelease(1.003);
  assert.ok(Math.abs(releases[0] - (attacks[0] + 0.002)) < 1e-9, `${releases[0]}`);
  env.triggerRelease(1.05);
  assert.equal(releases[1], 1.05);
});

/** fakeHat struck through toneFixes.ts's strike (its envelope's attack, then its pairs started at the note), its pitch with a cancel. */
async function fakeStruckHat(options = {}) {
  const { env, context, attacks } = await fakeEnvelope();
  context.rawContext = { baseLatency: 0.01 };
  const hat = fakeHat({ ...options, context });
  const { synth } = hat;
  let onAttack = () => {};
  Object.defineProperties(synth, {
    toSeconds: { value: (t) => t },
    log: { value: () => {} },
    envelope: { value: env },
    setNote: { value: () => {} },
    _triggerEnvelopeAttack: {
      value: (time, velocity) => {
        env.triggerAttack(time, velocity);
        onAttack();
        for (const osc of synth._oscillators) osc.start(time);
      },
    },
  });
  return { ...hat, env, attacks, holdInStrike: (f) => (onAttack = f) };
}

test('live, a hat held up while any of its six pairs start (readied before its time is decided): all six started once, waiting at 0 Hz, and it is struck where it can come once they are, its pitch leaving 0 Hz only there (scan r42, r44)', async () => {
  for (let k = 0; k < 6; k++) {
    const { synth, context, attacks, pitch } = await fakeStruckHat({ stepAt: k, step: 0.0145 });
    const at = attackAhead(synth, 200, 1 + ROOM, (t) => synth.triggerAttack(200, t, 1));
    assert.ok(Math.abs(at - (context.currentTime + RETRY)) < 1e-9, `held up in pair ${k}: ${at}`);
    assert.deepEqual(attacks, [at], `held up in pair ${k}: its envelope set once, where it went`);
    for (const osc of synth._oscillators) {
      assert.deepEqual(osc.events.map((e) => e.state), ['started', 'started'], `held up in pair ${k}`);
      assert.ok(osc.events[0].time < at && osc.events[1].time === at);
    }
    assert.deepEqual(pitch.filter(([v]) => v !== 0).map(([, t]) => t), [at], `held up in pair ${k}`);
  }
});

test('live, a hat held up inside its strike after its pitch and attack are set (while Tone sets the slow rest: its pairs carried on, their stops): struck once, where it was put, never stopped (scan r44)', async () => {
  const { synth, context, attacks, pitch, holdInStrike } = await fakeStruckHat();
  let held = false;
  holdInStrike(() => {
    if (held) return;
    held = true;
    context.currentTime += 5 * BLOCK;
  });
  const at = attackAhead(synth, 200, 1 + ROOM, (t) => synth.triggerAttack(200, t, 1));
  assert.equal(at, 1 + ROOM);
  assert.deepEqual(attacks, [at]);
  for (const osc of synth._oscillators) assert.deepEqual(osc.events.map((e) => e.state), ['started', 'started']);
  assert.deepEqual(pitch.filter(([v]) => v !== 0).map(([, t]) => t), [at]);
});

test('live, a hat whose clock is found too near before its attack is set (held up after its pitch): nothing of it heard, its pairs stopped and readied afresh, struck once two blocks past the clock (scan r44)', async () => {
  const { synth, context, attacks, pitch, env } = await fakeStruckHat();
  // (The hold-up just before its attack: in the pitch setting, after the readied pitch)
  const triggerAttack = Object.getPrototypeOf(env).triggerAttack;
  let held = false;
  Object.defineProperty(env, 'triggerAttack', {
    value: function (...a) {
      if (!held) {
        held = true;
        context.currentTime += 5 * BLOCK;
      }
      return triggerAttack.apply(this, a);
    },
  });
  const at = attackAhead(synth, 200, 1 + ROOM, (t) => synth.triggerAttack(200, t, 1));
  assert.ok(Math.abs(at - (context.currentTime + RETRY)) < 1e-9, `${at}`);
  assert.deepEqual(attacks, [at]);
  for (const osc of synth._oscillators) {
    assert.deepEqual(osc.events.map((e) => e.state), ['started', 'stopped', 'started', 'started']);
    assert.ok(osc.events[2].time === at - BLOCK && osc.events[3].time === at);
  }
  assert.deepEqual(pitch.filter(([v]) => v !== 0).map(([, t]) => t), [at]);
});

test('live, held up inside its last step only once its attack is set (in its decay): its attack reached the sound in time, so it stays, struck once, its decay taken on from where it is to where it should be by two blocks on (scan r44)', async () => {
  const { synth, context, attacks, starts, sig } = await fakeStrikeSynth({ stepOnDecay: 0.03 });
  synth.triggerAttack('C4', 1.001, 1);
  assert.equal(attacks.length, 1);
  assert.equal(starts.length, 1);
  const now = context.currentTime;
  assert.deepEqual(sig.fades.slice(0, 2), [
    ['hold', now],
    ['ramp', 0, now + RETRY],
  ]);
  assert.ok(sig.fades.some(([what]) => what === 'target'), JSON.stringify(sig.fades));
});
