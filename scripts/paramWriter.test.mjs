// Unit tests for ParamWriter against a stand-in AudioParam that behaves like Chrome's: overlapping
// writes are refused, and a write whose start has passed when the audio thread gets it is moved to
// that moment. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createParamWriter } = await import('../src/audio/effects/paramWriter.ts');

const SR = 48000;

/** The audio clock: `page` is what currentTime shows; the audio thread can be ahead of it. */
function makeClock() {
  return { page: 1, audio: 1 };
}

/** A stand-in AudioParam with Chrome's rules for curves (see paramWriter.ts). */
function fakeParam(clock) {
  /** Events as the audio thread has them: { time, duration (0 for a jump), pending } */
  let events = [];
  /** 'ok' or 'refused' for each write, in order */
  const log = [];
  const inside = (t, e) => e.duration > 0 && t >= e.time && t < e.time + e.duration;
  /** Called as each write starts (a test can stall the page there) */
  let onWrite = () => {};
  const refuse = (what) => {
    log.push('refused');
    const err = new Error(`${what} overlaps`);
    err.name = 'NotSupportedError';
    throw err;
  };
  return {
    get events() {
      return events;
    },
    log,
    set onWrite(fn) {
      onWrite = fn;
    },
    /** The audio thread picks up new events: one whose time has passed moves to now. */
    deliver() {
      for (const e of events) {
        if (e.pending && e.time < clock.audio) e.time = clock.audio;
        e.pending = false;
      }
    },
    setValueAtTime(value, time) {
      onWrite();
      if (!Number.isFinite(value) || !Number.isFinite(time)) throw new TypeError('non-finite');
      if (events.some((e) => inside(time, e))) refuse('setValueAtTime');
      events.push({ time, duration: 0, pending: true });
      log.push('ok');
    },
    setValueCurveAtTime(values, time, duration) {
      onWrite();
      if (![...values].every(Number.isFinite)) throw new TypeError('non-finite');
      const end = time + duration;
      if (events.some((e) => inside(time, e) || (e.time >= time && e.time < end))) refuse('setValueCurveAtTime');
      events.push({ time, duration, pending: true });
      log.push('ok');
    },
    cancelScheduledValues(time) {
      // (A curve running at `time` goes too: that's the click the writer avoids)
      events = events.filter((e) => e.time < time && !inside(time, e));
    },
  };
}

function setup() {
  const clock = makeClock();
  const param = fakeParam(clock);
  const raw = {
    sampleRate: SR,
    get currentTime() {
      return clock.page;
    },
  };
  const writer = createParamWriter(param, { raw, now: () => clock.page + 0.1, initial: 0 });
  return { clock, param, writer };
}

const ramp = (a, b) => new Float32Array([a, b]);

test('pieces follow one another and never start too close to the clock', () => {
  const { clock, param, writer } = setup();
  writer.jump(0.5, 0); // a fresh param: at once
  let end = writer.curve(ramp(0.5, 1), 1.0, 0.05); // asked for in the past: moved to the clock + margin
  assert.ok(param.events[1].time >= clock.page + 0.02 - 1e-9);
  end = writer.curve(ramp(1, 0.2), end, 0.05);
  assert.equal(param.events.length, 3);
  assert.ok(param.events[2].time > param.events[1].time + 0.05);
  assert.ok(Math.abs(writer.valueAt(end - 0.025) - 0.6) < 1e-6);
});

test('a curve Chrome moved later does not make the next write throw', () => {
  const { clock, param, writer } = setup();
  writer.jump(0, 0);
  param.deliver();
  // Written just ahead of the clock...
  const end = writer.curve(ramp(0, 1), 1.03, 0.05);
  // ...but the page stalls and the audio thread gets it 270 ms late: moved to 1.3
  clock.audio = 1.3;
  param.deliver();
  clock.page = 1.3;
  assert.equal(param.events[1].time, 1.3);
  let next;
  assert.doesNotThrow(() => {
    next = writer.curve(ramp(1, 0.5), end, 0.05);
  });
  // Placed after the latest the moved curve can end, and it really went in
  assert.equal(param.events.length, 3);
  assert.ok(param.events[2].time >= 1.35);
  assert.ok(next >= 1.4);
  // ...and jumps too
  clock.audio = 1.6;
  param.deliver();
  assert.doesNotThrow(() => writer.jump(0.3, next));
});

test('curves written back to back and all moved late: the next write still goes in', () => {
  const { clock, param, writer } = setup();
  writer.jump(0, 0);
  param.deliver();
  let t = writer.curve(ramp(0, 1), 1.03, 0.05);
  t = writer.curve(ramp(1, 0), t, 0.05);
  // Both reach the audio thread after a 200 ms stall: both moved to 1.2, on top of each other
  clock.audio = clock.page = 1.2;
  param.deliver();
  assert.doesNotThrow(() => writer.curve(ramp(0, 0.5), t, 0.05));
  assert.deepEqual(param.log.slice(-2), ['refused', 'ok']);
  assert.ok(param.events.at(-1).time >= 1.25);
});

test('a write refused for another reason is skipped without throwing', () => {
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
  assert.equal(param.events.length, 1);
  // Still usable afterwards
  writer.curve(ramp(0, 1), 1.3, 0.05);
  assert.equal(param.events.length, 2);
});

test('cut keeps the running piece and drops the ones not started', () => {
  const { clock, param, writer } = setup();
  writer.jump(0, 0);
  let t = writer.curve(ramp(0, 1), 1.05, 0.05);
  t = writer.curve(ramp(1, 0.5), t, 0.05);
  writer.curve(ramp(0.5, 0), t, 0.05);
  param.deliver();
  // The clock is inside the first curve: it plays out, the other two go
  clock.page = clock.audio = 1.06;
  const from = writer.cut(1.07);
  assert.ok(from >= 1.1 && from < 1.1 + 2 / SR);
  assert.equal(param.events.length, 2);
  assert.equal(writer.valueAt(from), 1);
});

test('random writes under random stalls never throw', () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const { clock, param, writer } = setup();
  writer.jump(0, 0);
  let until = 1;
  const warn = console.warn;
  console.warn = () => {};
  try {
    // Now and then the page stalls between working out a write and making it: the audio thread
    // runs on and takes what it has (the clock the page reads is never more than a render block behind)
    const deliver = () => {
      param.deliver();
      clock.page = clock.audio - (rnd() * 128) / SR;
    };
    param.onWrite = () => {
      if (rnd() < 0.05) {
        clock.audio += rnd() * 0.3;
        deliver();
      }
    };
    for (let i = 0; i < 3000; i++) {
      clock.audio += rnd() < 0.05 ? rnd() * 0.3 : rnd() * 0.01;
      if (rnd() < 0.7) deliver();
      else clock.page = clock.audio - (rnd() * 128) / SR;
      const r = rnd();
      assert.doesNotThrow(() => {
        if (r < 0.6) until = writer.curve(ramp(rnd(), rnd()), Math.max(until, clock.page + rnd() * 0.05), 0.004 + rnd() * 0.05);
        else if (r < 0.75) until = writer.jump(rnd(), Math.max(until, clock.page));
        else if (r < 0.9) until = writer.cut(clock.page + rnd() * 0.1);
        else writer.set(rnd(), rnd() < 0.5 ? 0 : 0.03);
      });
    }
  } finally {
    console.warn = warn;
  }
  // A refused write is retried once where it fits: none is dropped (refused twice in a row)
  const refused = param.log.filter((x) => x === 'refused').length;
  const dropped = param.log.filter((x, i) => x === 'refused' && param.log[i + 1] === 'refused').length;
  assert.ok(refused > 10, `the stalls should cause some refusals (${refused})`);
  assert.equal(dropped, 0);
});
