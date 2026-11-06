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
