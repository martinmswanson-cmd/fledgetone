// Unit tests for ParamWriter (src/audio/effects/paramWriter.ts) against a stand-in AudioParam that
// keeps the events it's given, like Chrome's timeline. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createParamWriter } = await import('../src/audio/effects/paramWriter.ts');

const SR = 48000;
const GAP = 1 / SR;

/** A stand-in AudioParam: a timeline of jumps (setValueAtTime) and ramp ends (linearRampToValueAtTime). */
function fakeParam() {
  let events = [];
  const finite = (...xs) => {
    if (!xs.every(Number.isFinite)) throw new TypeError('non-finite');
  };
  return {
    get events() {
      return events;
    },
    setValueAtTime(value, time) {
      finite(value, time);
      events.push({ type: 'set', time, value });
    },
    linearRampToValueAtTime(value, time) {
      finite(value, time);
      events.push({ type: 'ramp', time, value });
    },
    setValueCurveAtTime() {
      // Never used: Chrome can crash the page on curves it moves (see paramWriter.ts)
      throw new Error('setValueCurveAtTime used');
    },
    cancelScheduledValues(time) {
      events = events.filter((e) => e.time < time);
    },
    /** The value the timeline gives at `t` (jumps hold, ramps run from the previous event). */
    valueAt(t) {
      const sorted = [...events].sort((a, b) => a.time - b.time);
      let value = 0;
      let prev = null;
      for (const e of sorted) {
        if (e.time > t) {
          if (e.type === 'ramp' && prev) return prev.value + ((e.value - prev.value) * (t - prev.time)) / (e.time - prev.time);
          return value;
        }
        value = e.value;
        prev = e;
      }
      return value;
    },
  };
}

function setup() {
  const clock = { now: 1 };
  const param = fakeParam();
  const raw = {
    sampleRate: SR,
    get currentTime() {
      return clock.now;
    },
  };
  const writer = createParamWriter(param, { raw, now: () => clock.now + 0.1, initial: 0 });
  return { clock, param, writer };
}

const ramp = (a, b) => new Float32Array([a, b]);

test('pieces follow one another, never too close to the clock', () => {
  const { clock, param, writer } = setup();
  writer.jump(0.5, 0); // a fresh param: at once
  assert.equal(param.events[0].time, 0);
  // Asked for too close to the clock: moved to the clock + margin
  let end = writer.curve(ramp(0.5, 1), 1.0, 0.05);
  assert.ok(param.events[1].time >= clock.now + 0.02 - 1e-9);
  const first = param.events[1].time;
  end = writer.curve(ramp(1, 0.2), end, 0.05);
  // The second carries straight on (a sample after the first ends): no jump, just its ramp
  assert.deepEqual(
    param.events.map((e) => e.type),
    ['set', 'set', 'ramp', 'ramp']
  );
  assert.ok(Math.abs(param.events[3].time - (first + 0.1 + GAP)) < 1e-9);
  assert.ok(Math.abs(writer.valueAt(end - 0.025) - 0.6) < 1e-6);
  // One that doesn't start where the last ended gets its jump
  writer.curve(ramp(0.7, 0.1), end + 0.2, 0.05);
  assert.equal(param.events.at(-2).type, 'set');
});

test('a curve is a jump then evenly spaced ramps, as setValueCurveAtTime would play it', () => {
  const { param, writer } = setup();
  writer.jump(0, 0);
  const values = new Float32Array([0.1, 0.4, 0.2, 0.9]);
  const end = writer.curve(values, 2, 0.3);
  assert.equal(end, 2.3);
  assert.deepEqual(
    param.events.slice(1).map((e) => [e.type, +e.time.toFixed(9), +e.value.toFixed(6)]),
    [
      ['set', 2, 0.1],
      ['ramp', 2.1, 0.4],
      ['ramp', 2.2, 0.2],
      ['ramp', 2.3, 0.9],
    ]
  );
  // The writer's idea of the value matches the timeline's, through the piece
  for (const t of [2, 2.05, 2.1, 2.17, 2.29, 2.3, 2.5]) assert.ok(Math.abs(writer.valueAt(t) - param.valueAt(t)) < 1e-6, `at ${t}`);
});

test('a write refused for a bad value is skipped without throwing', () => {
  const { param, writer } = setup();
  writer.jump(0, 0);
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => writer.curve(new Float32Array([0, NaN]), 1.1, 0.05));
    assert.doesNotThrow(() => writer.jump(NaN, 1.2));
  } finally {
    console.warn = warn;
  }
  // Nothing half-written
  assert.equal(param.events.length, 1);
  // Still usable afterwards
  writer.curve(ramp(0, 1), 1.3, 0.05);
  assert.equal(param.events.length, 3);
});

test('cut keeps the running piece and drops the ones not started', () => {
  const { clock, param, writer } = setup();
  writer.jump(0, 0);
  let t = writer.curve(ramp(0, 1), 1.08, 0.2);
  t = writer.curve(ramp(1, 0.5), t, 0.2);
  writer.curve(ramp(0.5, 0), t, 0.2);
  // Cut where the first curve plays: it plays out, the other two go
  clock.now = 1.1;
  const from = writer.cut(1.15);
  assert.ok(from >= 1.28 && from < 1.28 + 2 * GAP);
  assert.deepEqual(
    param.events.map((e) => e.type),
    ['set', 'set', 'ramp']
  );
  assert.equal(writer.valueAt(from), 1);
  assert.equal(param.valueAt(1.18), writer.valueAt(1.18));
});

test('random writes and cuts never throw and keep the timeline in step with the writer', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const { clock, param, writer } = setup();
  writer.jump(0, 0);
  let until = 1;
  for (let i = 0; i < 3000; i++) {
    clock.now += rnd() < 0.05 ? rnd() * 0.3 : rnd() * 0.01;
    const r = rnd();
    assert.doesNotThrow(() => {
      if (r < 0.6) until = writer.curve(Float32Array.from({ length: 2 + Math.floor(rnd() * 5) }, rnd), Math.max(until, clock.now + rnd() * 0.1), 0.004 + rnd() * 0.05);
      else if (r < 0.75) until = writer.jump(rnd(), Math.max(until, clock.now));
      else if (r < 0.9) until = writer.cut(clock.now + rnd() * 0.1);
      else writer.set(rnd(), rnd() < 0.5 ? 0 : 0.03);
    });
    // Events go in time order: a new piece never starts before what's already there
    const times = param.events.map((e) => e.time);
    for (let k = 1; k < times.length; k++) assert.ok(times[k] >= times[k - 1], 'events out of order');
    // What the writer believes is what the param will play, from the clock on (a piece that
    // carries straight on starts its first ramp a sample early, hence the tolerance)
    const at = clock.now + 0.02 + rnd() * 0.3;
    assert.ok(Math.abs(writer.valueAt(at) - param.valueAt(at)) < 0.01, `value at ${at}`);
  }
});
