// A long note's own bend on an instrument that bends as a whole, or on a voice of its own, is
// given to the audio as it comes due when playing (src/audio/bendFeed.ts): thousands of bend
// steps given at once froze the page for seconds. An export gets every one at once, as before.
// Also: a note's curves end with the note when a file opens (noteExpression.ts cutNoteLane), a
// take folder's switches between takes are capped (songCaps.ts), and an export that fails while
// preparing a sound says the browser's trouble in plain words (exportFailure.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };
const { createBendFeed, feedFollower, followsNow, FEED_AHEAD, FEED_EVERY } = await import('../src/audio/bendFeed.ts');
const { createBendTimeline } = await import('../src/audio/bendTimeline.ts');
const { cutNoteLane, normalizeNoteExpression, noteValueAt, noteSteps } = await import('../src/store/noteExpression.ts');
const { parseProject, PROJECT_FORMAT, PROJECT_VERSION } = await import('../src/store/project.ts');
const { SONG_CAPS, MAX_SONG_POINTS: SONG_CAPS_POINTS, editPastCaps, overWords } = await import('../src/store/songCaps.ts');
const { exportFailureWords, browserError, causeWords, BROWSER_FAILED } = await import('../src/audio/exportFailure.ts');

/** A context's clock that moves only when told, its timers run by hand. */
const fakeClock = (isOffline = false) => {
  const timers = new Map();
  let id = 0;
  return {
    currentTime: 0,
    isOffline,
    setInterval: (fn, seconds) => (timers.set(++id, { fn, seconds }), id),
    clearInterval: (i) => timers.delete(i),
    tick() {
      for (const t of timers.values()) t.fn();
    },
    timers,
  };
};
/** A detune signal: the events it has, as the Web Audio API keeps them (by time; a later one for the same time replaces). */
const fakeSignal = () => {
  let events = [];
  return {
    calls: 0,
    setTargetAtTime(value, time) {
      this.calls++;
      events = events.filter((e) => e.time !== time);
      events.push({ value, time });
      events.sort((a, b) => a.time - b.time);
    },
    cancelScheduledValues(time) {
      events = events.filter((e) => e.time < time);
    },
    get events() {
      return events;
    },
  };
};

test('live, a long bend is given to the signal only a couple of seconds ahead, the rest as the clock gets there', () => {
  const clock = fakeClock();
  const signal = fakeSignal();
  const feed = createBendFeed(clock, signal);
  // A 60-second curve, a step every 4 ms, sent whole at once
  const steps = Array.from({ length: 15000 }, (_, i) => [Math.sin(i / 50) * 200, 0.1 + i * 0.004]);
  for (const [cents, t] of steps) feed.bend(cents, t);
  assert.ok(signal.calls <= (FEED_AHEAD / 0.004) + 2, `${signal.calls} given at once`);
  assert.ok(signal.events.every((e) => e.time <= FEED_AHEAD + 1e-9));
  // Played through: every step reaches the signal before it's due, each once
  for (let now = 0; now < 62; now += FEED_EVERY) {
    clock.currentTime = now;
    clock.tick();
    const missing = steps.filter(([, t]) => t <= now + FEED_AHEAD - FEED_EVERY && !signal.events.some((e) => e.time === t));
    assert.equal(missing.length, 0, `due by ${now}`);
  }
  assert.equal(signal.calls, steps.length);
  assert.deepEqual(signal.events, steps.map(([value, time]) => ({ value, time })));
  feed.dispose();
  assert.equal(clock.timers.size, 0);
});

test('live and in an export, the signal ends with the same bends: cuts and bends sent for one time again included', () => {
  const sends = [
    [100, 0.5],
    [200, 3],
    [300, 5],
    [400, 9],
    // (the same time again: the later one sent wins)
    [250, 5],
    // a jump at 4: those for 4 and after go
    [0, 4, true],
    [50, 6],
    [60, 2],
  ];
  const run = (offline) => {
    const clock = fakeClock(offline);
    const signal = fakeSignal();
    const feed = createBendFeed(clock, signal);
    for (const [cents, t, cut] of sends) feed.bend(cents, t, cut);
    for (let now = 0; now < 12; now += FEED_EVERY) {
      clock.currentTime = now;
      clock.tick();
    }
    return signal.events;
  };
  const direct = fakeSignal();
  for (const [cents, t, cut] of sends) {
    if (cut) direct.cancelScheduledValues(t);
    direct.setTargetAtTime(cents, t);
  }
  assert.deepEqual(run(true), direct.events);
  assert.deepEqual(run(false), direct.events);
  // (an export has no timer: everything at once)
  const clock = fakeClock(true);
  createBendFeed(clock, fakeSignal());
  assert.equal(clock.timers.size, 0);
});

test("a voice following its instrument's bends is given them up to its end, live a couple of seconds ahead", () => {
  const clock = fakeClock();
  const bends = createBendTimeline(() => clock.currentTime);
  for (let i = 0; i < 5000; i++) bends.set(i % 7, 0.01 * i);
  const given = [];
  const v = { fedTo: 0.5 };
  feedFollower(v, 30, bends, clock, (cents, t) => given.push(t));
  assert.equal(v.fedTo, FEED_AHEAD);
  assert.ok(given.every((t) => t > 0.5 && t <= FEED_AHEAD + 1e-9));
  assert.equal(followsNow(v, 30, 1.5), true);
  assert.equal(followsNow(v, 30, 2.5), false);
  for (let now = 0; now < 40; now += FEED_EVERY) {
    clock.currentTime = now;
    feedFollower(v, 30, bends, clock, (cents, t) => given.push(t));
  }
  const want = bends.after(0.5, 30).map(([t]) => t);
  assert.deepEqual(given, want);
  // An export: all of them at once, as before (none at or after its end)
  const off = { fedTo: 0.5 };
  const all = [];
  feedFollower(off, 30, bends, { currentTime: 0, isOffline: true }, (cents, t) => all.push(t));
  assert.deepEqual(all, want);
  assert.equal(followsNow(off, 30, 29.9), true);
  assert.equal(followsNow(off, 30, 30), false);
});

test("a note's curves end with the note on opening: it plays as it did over the note", () => {
  // A 4-bar note whose zigzag runs on far past its end, and a pressure curve wholly after it
  const bend = Array.from({ length: 256 }, (_, i) => ({ at: i === 255 ? 1e9 : i * 0.05, value: i % 2 ? 2 : -2 }));
  const pressure = [{ at: 9, value: 0.3 }, { at: 12, value: 1 }];
  const cut = normalizeNoteExpression({ bend, pressure }, 4);
  assert.ok(cut.bend.every((p) => p.at <= 4));
  assert.equal(cut.bend[cut.bend.length - 1].at, 4);
  assert.deepEqual(cut.pressure, [{ at: 4, value: 0.3 }]);
  const whole = normalizeNoteExpression({ bend, pressure });
  for (let at = 0; at <= 4; at += 1 / 128) {
    assert.ok(Math.abs(noteValueAt(cut.bend, at, 'bend') - noteValueAt(whole.bend, at, 'bend')) < 1e-9, `bend at ${at}`);
    assert.ok(Math.abs(noteValueAt(cut.pressure, at, 'pressure') - noteValueAt(whole.pressure, at, 'pressure')) < 1e-9, `pressure at ${at}`);
  }
  assert.deepEqual(noteSteps(cut, 4, 1 / 256), noteSteps(whole, 4, 1 / 256));
  // A curve inside the note is kept as it is
  const inside = [{ at: 0, value: 0 }, { at: 1, value: 1 }];
  assert.deepEqual(cutNoteLane(inside, 'bend', 4), inside);
  // Through a file
  const p = parseProject({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: 'x',
    bpm: 120,
    tracks: [{ id: 't', name: 'T', instrumentKey: 'lead' }],
    clips: [{ id: 'c', trackId: 't', startBar: 1, lengthBars: 4, notes: [{ id: 'n', note: 'C4', startOffset: 0, duration: '2m', velocity: 0.8, expr: { bend } }] }],
  });
  const kept = p.clips[0].notes[0].expr.bend;
  assert.equal(kept[kept.length - 1].at, 2);
  assert.ok(kept.length <= 256);
});

const takeSong = (switches) => ({
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  name: 'Takes',
  bpm: 120,
  tracks: [{ id: 't', name: 'T', instrumentKey: 'lead' }],
  clips: [
    {
      id: 'c',
      trackId: 't',
      startBar: 1,
      lengthBars: 400,
      notes: [],
      takes: [
        { id: 'a', name: 'A', notes: [] },
        { id: 'b', name: 'B', notes: [] },
      ],
      comp: Array.from({ length: switches }, (_, i) => ({ at: i * (399 / switches), take: i % 2 })),
    },
  ],
});

test("a take folder's switches between takes are capped on opening, and an edit can't grow past it", () => {
  const p = parseProject(takeSong(SONG_CAPS.comps + 500));
  assert.ok(p.clips[0].comp.length <= SONG_CAPS.comps);
  assert.equal(p.unread?.over?.comps, 500);
  assert.match(overWords({ comps: 500 }), /500 switches between takes over the most a song opens with \(4,096 switches between takes in a clip\)/);
  // A million open quickly
  const t = performance.now();
  parseProject(takeSong(1_000_000));
  assert.ok(performance.now() - t < 3000);
  const small = { tracks: [], clips: [{ notes: [], takes: [{}, {}], comp: new Array(SONG_CAPS.comps).fill(0) }] };
  const more = { tracks: [], clips: [{ notes: [], takes: [{}, {}], comp: new Array(SONG_CAPS.comps + 1).fill(0) }] };
  assert.deepEqual(editPastCaps(small, more), ['comps']);
  assert.deepEqual(editPastCaps(more, small), []);
  assert.equal(parseProject(takeSong(10)).unread?.over?.comps, undefined);
});

test("an export that fails preparing a sound says the browser's trouble plainly, the app's own words as they are", () => {
  let raw;
  try {
    new ArrayBuffer(2 ** 53);
  } catch (e) {
    raw = e;
  }
  assert.ok(raw instanceof RangeError);
  const wrap = (err) => new Error(`couldn't load the sound "my loop" for Mic. ${causeWords(err)}`, { cause: err });
  const words = exportFailureWords(wrap(raw));
  assert.ok(!words.includes(raw.message));
  assert.equal(words, `couldn't load the sound "my loop" for Mic. ${BROWSER_FAILED[0].toUpperCase()}${BROWSER_FAILED.slice(1)}`);
  // The same sent on from the sound-edit Worker as text
  assert.equal(exportFailureWords(browserError('Array buffer allocation failed')), BROWSER_FAILED);
  assert.ok(!exportFailureWords(wrap(browserError('Array buffer allocation failed'))).includes('allocation'));
  // The app's own reason is kept
  assert.equal(exportFailureWords(wrap(new Error('The sound edit failed'))), `couldn't load the sound "my loop" for Mic. The sound edit failed`);
});

// --- The song's bends given as they come due (src/audio/bendWindow.ts) ---

const { FEED_START, GIVE_BURST, GIVE_RATE, bendStamp, createBendWindow, curveAt, fixedCurve, steppedCurve } = await import('../src/audio/bendWindow.ts');
const { noteStepper } = await import('../src/store/noteExpression.ts');

test("a note's steps worked out as they're asked for are the same as all at once", () => {
  const zig = Array.from({ length: 256 }, (_, i) => ({ at: i === 255 ? 400 : (i * 400) / 256, value: i % 2 ? 2 : -2 }));
  const cases = [
    [{ bend: zig }, 400, 0.004],
    [{ bend: [{ at: 0, value: 0 }, { at: 2, value: 1 }], pressure: [{ at: 1, value: 0.3 }, { at: 3, value: 1 }] }, 4, 1 / 64],
    [{ bend: [{ at: 0, value: -1 }, { at: 0.25, value: 0 }] }, 1, 1 / 64],
    [{ pressure: [{ at: 0, value: 0.5 }] }, 2, 1 / 64],
    [{ bend: [{ at: 0, value: 1 }] }, 0, 1 / 64],
  ];
  // (as they were worked out before: each step's value looked up afresh)
  const before = (expr, length, step) => {
    const out = [];
    const end = Math.min(400, length);
    let still = 0;
    for (const p of expr.bend ?? []) still = Math.max(still, p.at);
    for (const p of expr.pressure ?? []) still = Math.max(still, p.at);
    for (let at = 0; at < end - 1e-9; at += step) {
      const cents = noteValueAt(expr.bend, at, 'bend') * 100;
      const pressure = noteValueAt(expr.pressure, at, 'pressure');
      const last = out[out.length - 1];
      if (!last || Math.abs(last.cents - cents) >= 0.5 || Math.abs(last.pressure - pressure) >= 0.005) out.push({ at, cents, pressure });
      if (at >= still) break;
    }
    return out;
  };
  for (const [expr, length, step] of cases) {
    const all = noteSteps(expr, length, step);
    assert.deepEqual(all, before(expr, length, step));
    const s = noteStepper(expr, length, step);
    for (let bar = 0; !s.done; bar += 0.37) s.upTo(bar);
    assert.deepEqual(s.steps, all);
    // A curve of them by time, asked for here and there
    const c = steppedCurve(noteStepper(expr, length, step), 3, 0.75);
    const whole = fixedCurve(all.map((st) => [3 + st.at * 0.75, st.cents]));
    for (const t of [10, 2, 3, 3.001, 50, 4.4, 400, 1000]) assert.equal(curveAt(c, t), curveAt(whole, t), `at ${t}`);
    assert.equal(c.last(), whole.last());
  }
});

/**
 * The scheduler's sends, as they were sent to an instrument all at once (`eager`), against the
 * same through a bend window as the clock runs (`window`): every op is [when it's sent, what].
 */
const runBoth = (ops, endTime) => {
  const clock = { currentTime: 0 };
  // (Instruments keeping every bend: none dropped behind the clock)
  const eager = createBendTimeline(() => -1e9);
  const fed = createBendTimeline(() => -1e9);
  let given = 0;
  let most = 0;
  let cuts = 0;
  const w = createBendWindow(clock, (cents, time, cut) => {
    given++;
    if (cut) cuts++;
    most = Math.max(most, time - clock.currentTime);
    fed.set(cents, time, cut);
  });
  const value = (v) => (typeof v === 'function' ? v() : v);
  // (each sent at its time, ahead of what it sends: the clock there)
  ops = ops.map((op, i) => [op, i]).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]).map(([op]) => op);
  let opAt = 0;
  for (let now = 0; now <= endTime; now = Math.round((now + FEED_EVERY) * 1e6) / 1e6) {
    for (; opAt < ops.length && ops[opAt][0] < now; opAt++) {
      clock.currentTime = Math.max(clock.currentTime, ops[opAt][0]);
      const op = ops[opAt][1];
      if (op.kind === 'send') {
        eager.set(value(op.value), op.time, op.cut);
        w.send(op.value, op.time, op.cut);
      } else if (op.kind === 'unback') op.run(w);
      else if (op.kind === 'note') {
        // A note's steps, its bend sent again over the earlier ones' steps it sounds over, its end
        for (const [t, c] of op.curve.pts) eager.set(c, t);
        for (const u of op.under) for (const [t] of u.pts) if (t > op.start && t < op.end) eager.set(curveAt(op.curve, t), t);
        for (const p of op.points) eager.set(value(p.value), p.time);
        // (and over the song's bend the earlier ones sent for after their release, then its own there)
        if (op.until !== undefined) {
          for (const b of op.backs) if (b.time > op.start && b.time < op.until) eager.set(curveAt(op.curve, b.time), b.time);
          eager.set(op.lane, op.until);
        }
        w.batch(op.start, () => {
          w.steps(op.lazy, op.start, op.end);
          if (op.underLazy.length || op.until !== undefined) w.over(op.lazy, op.start, op.underLazy.length ? op.end : -Infinity, op.until);
          for (const p of op.points) w.send(p.value, p.time);
          if (op.until !== undefined) {
            w.send(op.lane, op.until);
            w.back(op.lazy, op.start, op.end, op.until);
          }
        }, op.underLazy.length > 0);
      }
      // ...and the same with bends sent meanwhile: what plays is as sent all at once
      const at = clock.currentTime;
      for (let t = at; t <= at + FEED_START; t += 0.0137) assert.equal(fed.at(t), eager.at(t), `at ${t}, now ${at}`);
    }
    clock.currentTime = now;
    w.feed();
    // (given ahead by the timer, at least FEED_START...)
    for (let t = now; t <= now + FEED_START; t += 0.0311) assert.equal(fed.at(t), eager.at(t), `at ${t}, now ${now}`);
  }
  return { eager, fed, given, most, cuts };
};

/** A note's curve, both ways: [time, cents] every `step` s from `start` for `seconds`. */
const noteCurve = (start, seconds, step, f) => {
  const expr = { bend: Array.from({ length: 64 }, (_, i) => ({ at: (i * seconds) / 63, value: f(i) })) };
  const s = noteStepper(expr, seconds, step);
  s.upTo(Infinity);
  return { whole: fixedCurve(s.steps.map((st) => [start + st.at, st.cents])), lazy: steppedCurve(noteStepper(expr, seconds, step), start, 1) };
};

test('bends given as they come due play as when every one was sent at once: notes over each other, cuts, ends', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let round = 0; round < 6; round++) {
    const ops = [];
    const notes = [];
    let at = 0.05;
    for (let k = 0; k < 14; k++) {
      at += rand() * 1.5;
      const start = Math.round(at * 1000) / 1000;
      const seconds = 0.5 + rand() * 8;
      const amp = (rand() - 0.5) * 400;
      const { whole, lazy } = noteCurve(start, seconds, rand() < 0.5 ? 0.004 : 0.01, (i) => amp * Math.sin(i / 3 + k));
      const end = start + seconds;
      const under = notes.filter((n) => n.end > start);
      const points = [];
      // An earlier one's end while this one sounds: this one's bend there (worked out when it's given)
      for (const n of under) if (n.end < end) points.push({ time: n.end, value: () => curveAt(lazy, n.end) });
      points.push({ time: end, value: Math.round(rand() * 100) });
      const op = { kind: 'note', start, end, curve: whole, lazy, under: under.map((n) => n.whole), underLazy: under.map((n) => n.lazy), points };
      // (the eager one reads the curve worked out at once, the window its own)
      op.points = points.map((p) => (typeof p.value === 'function' ? { time: p.time, value: () => curveAt(lazy, p.time) } : p));
      ops.push([Math.max(0, start - 0.1), op]);
      notes.push({ end, whole, lazy });
      // A clip's bend or a jump now and then
      if (rand() < 0.3) ops.push([Math.max(0, start - 0.05), { kind: 'send', value: Math.round(rand() * 50), time: start + rand() * 3 }]);
      if (rand() < 0.15) {
        const time = start + 0.1 + rand() * 4;
        ops.push([Math.max(0, start - 0.05), { kind: 'send', value: 0, time, cut: true }]);
      }
    }
    const last = notes.reduce((m, n) => Math.max(m, n.end), 0) + 2;
    const { eager, fed, most } = runBoth(ops, last);
    for (let t = 0; t <= last; t += 0.0071) assert.equal(fed.at(t), eager.at(t), `round ${round} at ${t}`);
    assert.ok(most <= FEED_AHEAD + 1e-9, `given ${most} s ahead`);
  }
});

test("a note's bend sent again where the earlier ones' song's bend after their release was sent: as sent all at once", () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let round = 0; round < 6; round++) {
    const ops = [];
    const notes = [];
    let at = 0.05;
    for (let k = 0; k < 16; k++) {
      at += rand() * 1.2;
      const start = Math.round(at * 1000) / 1000;
      const seconds = 0.2 + rand() * 3;
      const amp = (rand() - 0.5) * 300;
      const { whole, lazy } = noteCurve(start, seconds, 0.01, (i) => amp * Math.cos(i / 4 + k));
      const end = start + seconds;
      const until = end + rand() * 4;
      const under = notes.filter((n) => n.end > start);
      const points = [];
      for (const n of under) if (n.end < end) points.push({ time: n.end, value: () => curveAt(lazy, n.end) });
      const backs = notes.filter((n) => n.back).map((n) => ({ time: n.until }));
      ops.push([Math.max(0, start - 0.1), { kind: 'note', start, end, curve: whole, lazy, under: under.map((n) => n.whole), underLazy: under.map((n) => n.lazy), points, until, backs, lane: Math.round(rand() * 40) }]);
      // (one let go of later, now and then: its song's bend after its release no longer where it was)
      const note = { end, until, whole, lazy, back: true };
      notes.push(note);
      if (rand() < 0.2 && notes.length > 1) {
        const n = notes[Math.floor(rand() * (notes.length - 1))];
        if (n.back) {
          n.back = false;
          ops.push([Math.max(0, start - 0.09), { kind: 'unback', curve: n.lazy }]);
        }
      }
    }
    for (const [, op] of ops) if (op.kind === 'unback') op.run = (w) => w.back(op.curve, 0, 0, undefined);
    const last = notes.reduce((m, n) => Math.max(m, n.until), 0) + 2;
    const { eager, fed } = runBoth(ops, last);
    for (let t = 0; t <= last; t += 0.0071) assert.equal(fed.at(t), eager.at(t), `round ${round} at ${t}`);
  }
});

test('long dense bent notes begun one after another under each other: the same, for much less given', () => {
  const ops = [];
  const notes = [];
  for (let k = 0; k < 12; k++) {
    const start = 0.2 + k * 0.031;
    const { whole, lazy } = noteCurve(start, 20, 0.004, (i) => (i % 2 ? 200 : -200) + k);
    const end = start + 20;
    const under = notes.filter((n) => n.end > start);
    ops.push([0.1, { kind: 'note', start, end, curve: whole, lazy, under: under.map((n) => n.whole), underLazy: under.map((n) => n.lazy), points: [{ time: end, value: 0 }] }]);
    notes.push({ end, whole, lazy });
  }
  const { eager, fed, given, cuts } = runBoth(ops, 24);
  for (let t = 0; t <= 24; t += 0.0071) assert.equal(fed.at(t), eager.at(t), `at ${t}`);
  // (every note's steps sent again over each earlier one's: 12 times as many, sent all at once)
  assert.ok(cuts > 0);
  assert.ok(given < (24 / 0.004) * 3, `${given} given`);
});

/**
 * The processor time `fn` took, in ms (user and system, from process.cpuUsage). The bounds on
 * time below are on this, not the clock: the work is a few tens of ms and grows with the notes
 * (twice the notes, about twice the time), but with the machine busy (npm test runs the files
 * side by side) the clock time came to 5 to 12 times the processor time, past 300 ms, with nothing
 * slower here. Processor time is what this work costs whatever else runs, and a slowdown that
 * grows with the notes squared still takes it far past 300 ms.
 */
const cpuMs = (fn) => {
  const c0 = process.cpuUsage();
  fn();
  const c = process.cpuUsage(c0);
  return (c.user + c.system) / 1000;
};

test('long bent notes over each other: what is given at a time is what plays meanwhile', () => {
  const zig = Array.from({ length: 256 }, (_, i) => ({ at: i === 255 ? 400 : (i * 400) / 256, value: i % 2 ? 2 : -2 }));
  // Twenty begun together (each a step every 4 ms), and a thousand sliding a tone each way: one chord, sent as one
  const slide = [{ at: 0, value: -2 }, { at: 400, value: 2 }];
  for (const [count, bend] of [[20, zig], [1000, slide]]) {
    const clock = { currentTime: 0 };
    let given = 0;
    let ahead = 0;
    const w = createBendWindow(clock, (cents, time) => {
      given++;
      ahead = Math.max(ahead, time - clock.currentTime);
    });
    const curves = [];
    const took = cpuMs(() => w.batch(0.1, () => {
      for (let k = 0; k < count; k++) {
        // 400 bars at 240 bpm
        const c = steppedCurve(noteStepper({ bend }, 400, 0.004), 0.1, 1);
        w.steps(c, 0.1, 400.1);
        if (k) w.over(c, 0.1, 400.1);
        w.send(0, 400.1);
        curves.push(c);
      }
    }, true));
    assert.ok(took < 300, `${count}: ${Math.round(took)} ms (processor time) to start them`);
    assert.ok(given <= FEED_AHEAD / 0.004 + 4, `${count}: ${given} given at once`);
    // Each time round, to a couple of seconds ahead, as many as may be given (the steps all at the same times: a few)
    for (let now = FEED_EVERY; now < 5; now += FEED_EVERY) {
      clock.currentTime = now;
      const before = given;
      const fed = cpuMs(() => w.feed());
      assert.ok(fed < 300, `${count}: ${Math.round(fed)} ms (processor time) at ${now}`);
      assert.ok(given - before <= GIVE_BURST + FEED_START / 0.004 + 4, `${count}: ${given - before} given at ${now}`);
    }
    assert.ok(ahead > FEED_AHEAD - (bend === zig ? FEED_EVERY : 1.1), `${count}: given ${ahead} s ahead`);
    // Each curve worked out only as far as it's played
    assert.ok(curves.every((c) => c.pts.length < 2000));
  }
});

test('a stall shorter than a couple of seconds is not heard: the bends are given that far ahead, a later note over an earlier one too', () => {
  const clock = { currentTime: 0 };
  const fed = createBendTimeline(() => -1e9);
  const eager = createBendTimeline(() => -1e9);
  const w = createBendWindow(clock, (cents, time, cut) => fed.set(cents, time, cut));
  const a = noteCurve(0.1, 8, 0.004, (i) => 150 * Math.sin(i / 2));
  const b = noteCurve(2.1, 4, 0.004, (i) => -100 * Math.cos(i / 3));
  for (const [t, c] of a.whole.pts) eager.set(c, t);
  eager.set(0, 8.1);
  for (const [t, c] of b.whole.pts) eager.set(c, t);
  for (const [t] of a.whole.pts) if (t > 2.1 && t < 6.1) eager.set(curveAt(b.whole, t), t);
  eager.set(curveAt(b.whole, 6.1), 6.1);
  w.batch(0.1, () => {
    w.steps(a.lazy, 0.1, 8.1);
    w.send(0, 8.1);
  });
  for (let now = 0; now <= 2; now = Math.round((now + FEED_EVERY) * 1e6) / 1e6) {
    clock.currentTime = now;
    w.feed();
  }
  // The later one begun at 2.1 (sent a little ahead), then nothing given for 1.7 s
  w.batch(2.1, () => {
    w.steps(b.lazy, 2.1, 6.1);
    w.over(b.lazy, 2.1, 6.1);
    w.send(() => curveAt(b.lazy, 6.1), 6.1);
  }, true);
  for (let t = 2.1; t < 3.8; t += 0.0071) assert.equal(fed.at(t), eager.at(t), `at ${t}`);
});

test("an export's bends sent one by one, then taken over by a window where a note begins over an earlier one: as sent all at once", () => {
  // (an export's clock runs ahead of what it renders: nothing is played until the render gets there)
  const clock = { currentTime: 0 };
  const fed = createBendTimeline(() => -1e9);
  const eager = createBendTimeline(() => -1e9);
  /** The bend sent last for each time (the scheduler's exportSent) */
  const sent = new Map();
  const send = (c, t, cut) => {
    eager.set(c, t, cut);
    fed.set(c, t, cut);
    if (cut) for (const k of [...sent.keys()]) if (k >= t) sent.delete(k);
    sent.set(t, c);
  };
  // Two notes one after the other, each sent whole at its start, the second's song's bend after its release ahead
  const a = noteCurve(0.1, 2, 0.004, (i) => 120 * Math.sin(i / 2));
  for (const [t, c] of a.whole.pts) send(c, t);
  send(0, 2.1);
  const b = noteCurve(2.2, 6, 0.004, (i) => -90 * Math.cos(i / 3));
  for (const [t, c] of b.whole.pts) send(c, t);
  send(0, 8.2);
  send(30, 9);
  // A third begun at 3.1 over the second, the clock there: a window takes over from it
  clock.currentTime = 3.05;
  const w = createBendWindow(clock, (cents, time, cut) => fed.set(cents, time, cut), true);
  const at = [...sent].sort((x, y) => x[0] - y[0]);
  let first = at.length;
  while (first > 0 && at[first - 1][0] >= 3.1) first--;
  w.seed([{ curve: a.whole, start: 0.1, end: 2.1 }, { curve: b.whole, start: 2.2, end: 8.2, back: 9 }], at.slice(first - 1), 3.1);
  const c = noteCurve(3.1, 3, 0.004, (i) => 200 * Math.sin(i / 5));
  for (const [t, v] of c.whole.pts) eager.set(v, t);
  for (const [t] of b.whole.pts) if (t > 3.1 && t < 6.1) eager.set(curveAt(c.whole, t), t);
  eager.set(curveAt(b.whole, 6.1), 6.1);
  w.batch(3.1, () => {
    w.steps(c.whole, 3.1, 6.1);
    w.over(c.whole, 3.1, 6.1, -Infinity);
    w.send(curveAt(b.whole, 6.1), 6.1);
  }, true);
  for (let now = 3.25; now <= 12; now = Math.round((now + FEED_EVERY) * 1e6) / 1e6) {
    clock.currentTime = now;
    w.feed();
  }
  for (let t = 0; t <= 12; t += 0.0037) assert.equal(fed.at(t), eager.at(t), `at ${t}`);
  // (given in time order from the note's start on: the instrument's bends there dropped once)
  assert.equal(fed.after(9).length, 0);
});

test("a sounding note's later steps, given as they come due, say when they were sent", () => {
  const clock = { currentTime: 0 };
  const sentAt = [];
  const w = createBendWindow(clock, (cents, time, cut, sent) => sentAt.push([time, sent]));
  const { lazy } = noteCurve(0.1, 10, 0.004, (i) => 100 * Math.sin(i));
  const before = bendStamp();
  w.batch(0.1, () => w.steps(lazy, 0.1, 10.1));
  // (the player's wheel moved meanwhile)
  const wheel = bendStamp();
  for (let now = 0; now < 9; now += FEED_EVERY) {
    clock.currentTime = now;
    w.feed();
  }
  const late = sentAt.filter(([t]) => t > 3);
  assert.ok(late.length > 100, `${late.length}`);
  assert.ok(late.every(([, sent]) => sent > before), 'sent after before');
  assert.ok(late.every(([, sent]) => sent > before && sent < wheel));
  // One sent after the wheel moved says so
  w.send(50, 9.5);
  assert.ok(sentAt.find(([t]) => t === 9.5)[1] > wheel);
});

test('the bends a window has for later go with a cut, and it forgets what has played', () => {
  const clock = { currentTime: 0 };
  const fed = createBendTimeline(() => -1e9);
  const w = createBendWindow(clock, (cents, time, cut) => fed.set(cents, time, cut));
  const { lazy } = noteCurve(0.1, 20, 0.01, (i) => 100 + i);
  w.batch(0.1, () => w.steps(lazy, 0.1, 20.1));
  w.send(0, 20.1);
  // A jump at 1.5: what it had for after goes, also further ahead than it's given yet
  w.send(-50, 1.5, true);
  for (let now = 0; now < 30; now += FEED_EVERY) {
    clock.currentTime = now;
    w.feed();
  }
  assert.equal(fed.at(1.4), curveAt(lazy, 1.4));
  assert.equal(fed.at(1.5), -50);
  assert.equal(fed.at(25), -50);
  assert.equal(w.alive(), false);
});

test("the notes' own bend and pressure points count toward the most lane points a song has", () => {
  const bend = Array.from({ length: 256 }, (_, i) => ({ at: i / 256, value: i % 2 ? 1 : -1 }));
  const notes = (count) => Array.from({ length: count }, (_, i) => ({ id: `n${i}`, note: 'C4', startOffset: (i % 4) / 4, duration: '4n', velocity: 0.8, expr: { bend } }));
  const song = (count) => ({ format: PROJECT_FORMAT, version: PROJECT_VERSION, name: 'x', bpm: 120, tracks: [{ id: 't', name: 'T', instrumentKey: 'lead' }], clips: [{ id: 'c', trackId: 't', startBar: 1, lengthBars: 1, notes: notes(count) }] });
  // 2,000 notes of 256 points: 12,000 past the 500,000
  const p = parseProject(song(2000));
  assert.equal(p.unread?.over?.points, 2000 * 256 - SONG_CAPS_POINTS);
  assert.match(overWords({ points: 5 }), /5 lane points over the most a song opens with \(50,000 points in a lane, 500,000 in all\)/);
  assert.equal(parseProject(song(100)).unread?.over?.points, undefined);
  // While editing: more notes with curves past it aren't let in
  const small = { tracks: [], clips: [{ notes: notes(1953) }] };
  const more = { tracks: [], clips: [{ notes: notes(1954) }] };
  assert.deepEqual(editPastCaps(small, more), ['points']);
  assert.deepEqual(editPastCaps(more, small), []);
});
