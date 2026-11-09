// Play waits before it starts the Transport (for instruments' sounds still downloading, then for recorded
// takes a change left out of date). Presses during that wait are not lost: Space or the button cancels it,
// a Play after a Pause or Stop still plays, and two Plays start the Transport once. The store's own
// play / pause / togglePlay / stop are run here on stand-ins for the audio side. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const store = readFileSync(new URL('../src/store/timelineStore.ts', import.meta.url), 'utf8');
const between = (from, to) => {
  const a = store.indexOf(from);
  const b = store.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `${from} … ${to} in timelineStore.ts`);
  return store.slice(a, b);
};
const decls = between('let waitingToPlay', '/** How often, while playing');
const methods = between('    play: async (startAt) => {', '    seek: (bar, reveal');
const source = stripTypeScriptTypes(`const api = (() => {\n${decls}\nreturn {\n${methods}\n};\n})();`) + '\nreturn api;';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A store with the transport methods as written, a song whose sounds or takes are still pending */
function makeStore({ sounds = false, takes = false } = {}) {
  let state = { isPlaying: false, loadingToPlay: false, isRecording: false, playheadPosition: 1, tracks: [], recordOptions: {}, loopRegion: { inBar: 1 } };
  const w = { starts: 0, sounds: sounds ? deferred() : null, takes: takes ? deferred() : null };
  const deps = {
    get: () => state,
    set: (p) => (state = { ...state, ...(typeof p === 'function' ? p(state) : p) }),
    initAudio: async () => {},
    liveSoundsLoading: () => !!w.sounds,
    liveSoundsReady: () => w.sounds.promise.then(() => (w.sounds = null)),
    liveTakesReady: () => (w.takes ? w.takes.promise.then(() => (w.takes = null)) : null),
    meterAt: () => ({ num: 4, den: 4 }),
    songMeterOf: () => null,
    tempoAt: () => 120,
    songTempo: () => null,
    liveMix: { bus: { context: { now: () => 0 } } },
    startTransportAt: () => w.starts++,
    countInClicks: () => () => {},
    startTake: () => {},
    endTake: () => {},
    stopFrameLoop: () => {},
    frame: () => {},
    requestAnimationFrame: () => 1,
    getAudibleMoment: () => ({ bar: 1, at: 0 }),
    pauseTransport: () => {},
    stopTransport: () => {},
    releaseAllVoices: () => {},
    clampBar: (b) => b,
    transportStartsAt: () => null,
    seekTransport: () => {},
    stopCountIn: null,
    rafId: 0,
  };
  const names = Object.keys(deps);
  const api = new Function(...names, source)(...names.map((n) => deps[n]));
  w.api = api;
  state = { ...state, ...api };
  w.state = () => state;
  return w;
}

/** Runs presses (each a store call), the first starting the wait; the others land inside it. Then the wait ends */
async function run(kind, presses) {
  const w = makeStore({ [kind]: true });
  const pending = [];
  for (const p of presses) {
    pending.push(Promise.resolve(w.api[p]()));
    await tick();
    assert.equal(w.state().isPlaying, false, 'still waiting');
  }
  w[kind].resolve();
  await Promise.all(pending);
  await tick();
  return { playing: w.state().isPlaying, starts: w.starts, loading: w.state().loadingToPlay };
}

for (const kind of ['takes', 'sounds']) {
  const what = kind === 'takes' ? 'the takes are worked out' : 'the sounds are in';
  test(`while ${what}: Space, Space cancels the Play`, async () => {
    assert.deepEqual(await run(kind, ['togglePlay', 'togglePlay']), { playing: false, starts: 0, loading: false });
  });
  test(`while ${what}: Space, Space, Space plays, once`, async () => {
    assert.deepEqual(await run(kind, ['togglePlay', 'togglePlay', 'togglePlay']), { playing: true, starts: 1, loading: false });
  });
  test(`while ${what}: Play, Pause, Play plays, once`, async () => {
    assert.deepEqual(await run(kind, ['play', 'pause', 'play']), { playing: true, starts: 1, loading: false });
  });
  test(`while ${what}: Play, Stop, Play plays, once`, async () => {
    assert.deepEqual(await run(kind, ['play', 'stop', 'play']), { playing: true, starts: 1, loading: false });
  });
  test(`while ${what}: Play, Play starts the Transport once`, async () => {
    assert.deepEqual(await run(kind, ['play', 'play']), { playing: true, starts: 1, loading: false });
  });
  test(`while ${what}: Play, Pause, Play, Play starts the Transport once`, async () => {
    assert.deepEqual(await run(kind, ['play', 'pause', 'play', 'play']), { playing: true, starts: 1, loading: false });
  });
  test(`while ${what}: Play, Pause stays stopped, and the button shows Play again`, async () => {
    const w = makeStore({ [kind]: true });
    const p = w.api.play();
    await tick();
    assert.equal(w.state().loadingToPlay, true);
    w.api.pause();
    assert.equal(w.state().loadingToPlay, false);
    w[kind].resolve();
    await p;
    assert.deepEqual([w.state().isPlaying, w.starts], [false, 0]);
  });
}

test('sounds then takes: a Pause in the sounds wait skips the takes; a Play after it waits for both', async () => {
  const w = makeStore({ sounds: true, takes: true });
  const p = w.api.play();
  await tick();
  w.api.pause();
  const q = w.api.play();
  w.sounds.resolve();
  await tick();
  assert.equal(w.state().isPlaying, false, 'still waiting for the takes');
  assert.equal(w.state().loadingToPlay, true);
  w.takes.resolve();
  await Promise.all([p, q]);
  assert.deepEqual([w.state().isPlaying, w.starts, w.state().loadingToPlay], [true, 1, false]);
});

test('nothing to wait for: Play starts at once, and a second Play does nothing', async () => {
  const w = makeStore();
  await w.api.play();
  await w.api.play();
  assert.deepEqual([w.state().isPlaying, w.starts, w.state().loadingToPlay], [true, 1, false]);
});
