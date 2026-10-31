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
const { SONG_CAPS, editPastCaps, overWords } = await import('../src/store/songCaps.ts');
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
