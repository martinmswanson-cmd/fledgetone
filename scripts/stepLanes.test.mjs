// Unit tests for step lanes (src/store/stepLanes.ts), their timed plugin events
// (src/audio/controlEvents.ts) and note slides (src/store/slides.ts). Run with `npm test`.
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
const S = await import('../src/store/stepLanes.ts');
const { planControlEvents, controlRun, CONTROL_GRID } = await import('../src/audio/controlEvents.ts');
const { rememberParamNames } = await import('../src/audio/plugins/paramNames.ts');
const { parseProject, serializeProject } = await import('../src/store/project.ts');
const { syncPatterns } = await import('../src/store/patterns.ts');
const { laneValueAt } = await import('../src/audio/automation.ts');
const { createAutomationSchedule } = await import('../src/audio/automationSchedule.ts');
const { createParamWriter } = await import('../src/audio/effects/paramWriter.ts');
const { withSlide, withDive, slideOf, diveNotes, bendSupport } = await import('../src/store/slides.ts');
const { noteSteps } = await import('../src/store/noteExpression.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');
// (Node has no audio context: the Transport's ticks per quarter note, as in the browser)
const { liveTransport } = await import('../src/audio/liveContext.ts');
if (!liveTransport.PPQ) liveTransport.PPQ = 192;

const FLEDGE = 'builtin:fledge/Fledge Synth';
const note = (startOffset, n = 'C2', duration = '16n') => ({ id: `n${startOffset}`, note: n, startOffset, duration, velocity: 0.8 });
const lane = (steps, extra = {}) => ({ id: 'l1', target: 'inst:Macro 1', grid: 6, steps, ...extra });
const clip = (id, startBar, lengthBars, stepLanes, notes = []) => ({ id, trackId: 't', name: id, startBar, lengthBars, notes, isSelected: false, ...(stepLanes ? { stepLanes } : {}) });
const track = (extra = {}) => ({
  id: 't',
  name: 'Bass',
  instrumentKey: 'plugin',
  color: '#fff',
  volume: 0,
  pan: 0,
  muted: false,
  solo: false,
  reverbSend: 0,
  delaySend: 0,
  eq: { low: 0, mid: 0, high: 0 },
  fx: defaultTrackFx(),
  plugin: { id: 'p1', url: FLEDGE, name: 'Fledge Synth', state: { builtin: 1, values: [0.1, 0.25, 0.9] } },
  ...extra,
});
rememberParamNames(FLEDGE, ['Volume', 'Macro 1', 'Macro 2']);
const BPM = 140;
/** 3 ms in bars at 140 BPM */
const SMOOTH = (S.STEP_SMOOTH * BPM) / 240;

test('steps read and write on the grid; cleared steps hold; hidden ones are kept', () => {
  let l = lane([]);
  l = S.paintSteps(l, 1, 0, 3, 0.5);
  assert.deepEqual(S.stepValues(l, 1).slice(0, 5), [0.5, 0.5, 0.5, 0.5, null]);
  l = S.paintSteps(l, 1, 2, 2, null);
  assert.deepEqual(S.stepValues(l, 1).slice(0, 4), [0.5, 0.5, null, 0.5]);
  assert.equal(S.stepCount(l, 1), 16);
  assert.equal(S.stepCount({ grid: 4 }, 1), 24);
  // A trimmed start hides the first steps; trimming back brings them back
  const moved = S.moveStepLanes([l], -0.125)[0];
  assert.deepEqual(S.stepValues(moved, 0.875).slice(0, 2), [null, 0.5]);
  const back = S.moveStepLanes([S.paintSteps(moved, 0.875, 5, 5, 1)], 0.125)[0];
  assert.deepEqual(S.stepValues(back, 1).slice(0, 4), [0.5, 0.5, null, 0.5]);
});

test('tools: randomise is seeded and in range, repeat copies the first steps, rotate wraps', () => {
  const l = lane([]);
  const a = S.randomiseSteps(l, 1, 42, 0.2, 0.6);
  const b = S.randomiseSteps(l, 1, 42, 0.2, 0.6);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, S.randomiseSteps(l, 1, 43, 0.2, 0.6));
  for (const v of S.stepValues(a, 1)) assert.ok(v >= 0.2 && v <= 0.6, String(v));
  const sparse = S.stepValues(S.randomiseSteps(l, 1, 7, 0, 1, 0.5), 1);
  assert.ok(sparse[0] !== null && sparse.some((v) => v === null));
  const four = S.withStepValues(l, 2, [0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(S.stepValues(S.repeatSteps(four, 2, 4), 2), Array.from({ length: 32 }, (_, i) => [0.1, 0.2, 0.3, 0.4][i % 4]));
  assert.deepEqual(S.stepValues(S.rotateSteps(four, 2, 1), 2).slice(0, 5), [null, 0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(S.stepValues(S.rotateSteps(four, 2, -1), 2).slice(0, 3), [0.2, 0.3, 0.4]);
  // A 1/16 lane on 1/32: each value on the first of its two new steps
  assert.deepEqual(S.stepValues(S.regridSteps(four, 2, 3), 2).slice(0, 5), [0.1, null, 0.2, null, 0.3]);
});

test('lanes are validated from files and survive save and open', () => {
  assert.equal(S.normalizeStepLanes('x'), undefined);
  const lanes = S.normalizeStepLanes([
    { id: 'a', target: 'inst:Macro 2', grid: 3, steps: [{ at: 0.5, value: 2 }, { at: 0, value: 0.4 }, { at: 'x', value: 1 }], perNote: true },
    { id: 'b', target: 'send:t9', grid: 6, steps: [] },
    { target: 'filterCutoff', grid: 7, steps: [{ at: 0, value: 0.3 }] },
    { target: 'fx:nope.x', grid: 6, steps: [] },
  ]);
  assert.deepEqual(lanes, [
    { id: 'a', target: 'inst:Macro 2', grid: 3, steps: [{ at: 0, value: 0.4 }, { at: 0.5, value: 1 }], perNote: true },
    { id: 'steps2', target: 'filterCutoff', grid: 6, steps: [{ at: 0, value: 0.3 }] },
  ]);
  const project = {
    format: 'fledgetone-project',
    version: 1,
    name: 'x',
    bpm: BPM,
    tracks: [track()],
    clips: [clip('c', 1, 1, [lane([{ at: 0, value: 0.2 }, { at: 0.25, value: 0.8 }])], [note(0)])],
    markers: [],
  };
  const back = parseProject(JSON.parse(JSON.stringify(serializeProject(parseProject(project)))));
  assert.deepEqual(back.clips[0].stepLanes, project.clips[0].stepLanes);
  // An old file without them opens without them
  assert.equal(parseProject({ ...project, clips: [clip('c', 1, 1, undefined, [note(0)])] }).clips[0].stepLanes, undefined);
});

test('a share link carries step lanes', async (t) => {
  if (typeof CompressionStream === 'undefined') return t.skip('no CompressionStream');
  const { songLink, projectFromHash } = await import('../src/store/shareLink.ts');
  const lanes = [lane([{ at: 0, value: 0.2 }, { at: 0.5, value: 0.7 }], { perNote: true })];
  const project = parseProject({ format: 'fledgetone-project', version: 1, name: 'x', bpm: BPM, tracks: [track()], clips: [clip('c', 1, 1, lanes, [note(0)])], markers: [] });
  const link = await songLink(project, 'https://x/');
  const back = await projectFromHash(link.slice(link.indexOf('#')));
  assert.deepEqual(back.clips[0].stepLanes, lanes);
});

test('linked clips share their step lanes; a split divides them', () => {
  const a = { ...clip('a', 1, 1, [lane([{ at: 0, value: 0.2 }])]), pattern: 'p' };
  const b = { ...clip('b', 3, 1, a.stepLanes), pattern: 'p' };
  const edited = { ...a, stepLanes: [lane([{ at: 0, value: 0.9 }])] };
  const synced = syncPatterns([a, b], [edited, b]);
  assert.deepEqual(synced.find((c) => c.id === 'b').stepLanes, edited.stepLanes);
  const [left, right] = S.splitStepLanes([lane([{ at: 0, value: 0.1 }, { at: 0.5, value: 0.6 }, { at: 0.75, value: 0.7 }])], 0.5);
  assert.deepEqual(left[0].steps, [{ at: 0, value: 0.1 }]);
  assert.deepEqual(right[0].steps, [{ at: 0, value: 0.6 }, { at: 0.25, value: 0.7 }]);
});

test('per note: the value changes at each note that starts in a set step, not at the step', () => {
  const l = lane([{ at: 0, value: 0.2 }, { at: 0.25, value: 0.6 }, { at: 0.5, value: 0.9 }], { perNote: true });
  // Notes at 1/32 into the first step, on the 3rd 8th, and in the 3rd quarter's 2nd step (not set: holds)
  const c = clip('c', 1, 1, [l], [note(1 / 32), note(0.25 + 1 / 32), note(0.5625)]);
  assert.deepEqual(S.stepChanges(c, l), [
    { at: 1 / 32, value: 0.2 },
    { at: 0.25 + 1 / 32, value: 0.6 },
  ]);
  // Step mode: at the steps' starts
  assert.deepEqual(S.stepChanges(c, { ...l, perNote: false }).map((x) => x.at), [0, 0.25, 0.5]);
  // As automation: each change glides for 3 ms and is there when its note starts
  const [auto] = S.stepAutomation(track(), [c], BPM);
  assert.equal(auto.param, 'plugin:p1:#Macro 1');
  for (const at of [1 + 1 / 32, 1.25 + 1 / 32]) {
    const arrived = laneValueAt(auto.points, at);
    assert.ok(Math.abs(arrived - S.stepChanges(c, l).find((x) => Math.abs(1 + x.at - at) < 1e-9).value) < 1e-9);
    // 3 ms before, still the value before
    const ramp = auto.points.filter((p) => p.bar > at - SMOOTH - 1e-9 && p.bar < at + 1e-9);
    assert.ok(Math.abs(ramp[0].bar - (at - SMOOTH)) < 1e-9, JSON.stringify(ramp));
  }
});

test('smoothing: every change is a ramp of 3 ms (never a jump), arriving on its step', () => {
  const steps = Array.from({ length: 16 }, (_, i) => ({ at: i / 16, value: (i * 7) % 10 / 10 }));
  const c = clip('c', 5, 1, [lane(steps)], [note(0)]);
  for (const bpm of [70, 140, 174]) {
    const [auto] = S.stepAutomation(track(), [c], bpm);
    const sm = (S.STEP_SMOOTH * bpm) / 240;
    for (let i = 1; i < auto.points.length; i++) {
      const [a, b] = [auto.points[i - 1], auto.points[i]];
      if (a.value === b.value) continue;
      assert.ok(Math.abs(b.bar - a.bar - sm) < 1e-9, `a ramp of ${((b.bar - a.bar) * 240) / bpm} s at ${bpm} BPM`);
    }
    for (const s of steps) assert.ok(Math.abs(laneValueAt(auto.points, 5 + s.at) - s.value) < 1e-9);
  }
  // Between the ramps' ends and the next change, the value holds
  const [auto] = S.stepAutomation(track(), [c], BPM);
  assert.ok(Math.abs(laneValueAt(auto.points, 5 + 1 / 32) - steps[0].value) < 1e-9);
});

test("outside its clips a lane gives way: to the track's own lane, else the track's own setting", () => {
  const c = clip('c', 3, 1, [lane([{ at: 0.25, value: 0.8 }])]);
  // No lane: Macro 1's saved setting (0.25) before, before the first step and after the clip
  const [plain] = S.stepAutomation(track(), [c], BPM);
  assert.equal(laneValueAt(plain.points, 1), 0.25);
  assert.equal(laneValueAt(plain.points, 3.1), 0.25);
  assert.equal(laneValueAt(plain.points, 3.5), 0.8);
  assert.equal(laneValueAt(plain.points, 4.5), 0.25);
  // A track lane for the same setting plays between clips; within the clip the steps win
  const own = { param: 'plugin:p1:#Macro 1', points: [{ bar: 1, value: 0 }, { bar: 9, value: 1 }] };
  const t = track({ automation: [own] });
  const [mixed] = S.stepAutomation(t, [c], BPM);
  assert.ok(Math.abs(laneValueAt(mixed.points, 2) - 0.125) < 1e-9);
  assert.ok(Math.abs(laneValueAt(mixed.points, 3.1) - laneValueAt(own.points, 3)) < 1e-9);
  assert.equal(laneValueAt(mixed.points, 3.6), 0.8);
  assert.ok(Math.abs(laneValueAt(mixed.points, 6) - 0.625) < 1e-9);
  // withStepLanes puts it in place of the track's lane, and leaves tracks without lanes alone
  const other = { ...track(), id: 'u' };
  const memo = S.stepMemo();
  const out = S.withStepLanes([t, other], [c], BPM, memo);
  assert.equal(out[1], other);
  assert.equal(out[0].automation.length, 1);
  assert.equal(out[0].automation[0].points, mixed.points.length ? out[0].automation[0].points : null);
  // The same objects while nothing changes
  assert.equal(S.withStepLanes([t, other], [{ ...c, isSelected: true }], BPM, memo), out);
  // Built-in settings: the Filter's cutoff from the track's own setting
  const cut = clip('k', 1, 1, [{ id: 'k', target: 'filterCutoff', grid: 6, steps: [{ at: 0, value: 1 }] }]);
  const [f] = S.stepAutomation(track(), [cut], BPM);
  assert.equal(f.param, 'filterCutoff');
  assert.ok(laneValueAt(f.points, 2.5) < 1);
});

test('clips back to back: the value carries on, and a later clip takes over an overlap', () => {
  const a = clip('a', 1, 1, [lane([{ at: 0, value: 0.6 }])]);
  const b = clip('b', 2, 1, [lane([{ at: 0.5, value: 0.9 }])]);
  const [auto] = S.stepAutomation(track(), [a, b], BPM);
  assert.equal(laneValueAt(auto.points, 2.25), 0.6);
  assert.equal(laneValueAt(auto.points, 2.75), 0.9);
  assert.equal(laneValueAt(auto.points, 3.5), 0.25);
  const c = clip('c', 1.5, 1, [lane([{ at: 0, value: 0.1 }])]);
  const [over] = S.stepAutomation(track(), [a, c], BPM);
  assert.equal(laneValueAt(over.points, 1.25), 0.6);
  assert.equal(laneValueAt(over.points, 2), 0.1);
});

test('plugin lanes become timed events on a fine grid: live and export alike', () => {
  const sr = 48000;
  // A lane value: 0.2, then a 3 ms ramp to 0.8 at 0.1 s, then a slow ramp from 0.3 s
  const valueAt = (t) => (t < 0.097 ? 0.2 : t < 0.1 ? 0.2 + (0.6 * (t - 0.097)) / 0.003 : t < 0.3 ? 0.8 : Math.max(0.3, 0.8 - (t - 0.3)));
  const run = (ticks, lead) => {
    const r = controlRun();
    const out = [];
    for (const t of ticks) planControlEvents(r, valueAt, t, t + lead, sr, (time, v) => out.push([time, v]) > 0);
    return out;
  };
  const exportTicks = Array.from({ length: Math.ceil(1 * sr / 128) }, (_, i) => (i * 128) / sr);
  // Live: ticks about 20 a second, some late
  const liveTicks = [];
  for (let t = 0, k = 0; t < 1; k++) {
    liveTicks.push(t);
    t += 0.05 + ((k * 37) % 11) * 0.002;
  }
  const off = run(exportTicks, (2 * 128) / sr);
  const live = run(liveTicks, 0.12);
  const upTo = (list, t) => list.filter(([time]) => time <= t);
  assert.deepEqual(upTo(live, 0.9), upTo(off, 0.9));
  // On the grid, the ramp in about a dozen steps, and the first event the start value
  for (const [time] of off) assert.ok(Math.abs(Math.round((time * sr) / CONTROL_GRID) - (time * sr) / CONTROL_GRID) < 1e-6);
  assert.deepEqual(off[0], [0, 0.2]);
  const ramp = off.filter(([t]) => t > 0.096 && t <= 0.1001);
  assert.ok(ramp.length >= 8 && ramp.length <= 10, String(ramp.length));
  assert.equal(ramp[ramp.length - 1][1], 0.8);
  // A failed send (the plugin not loaded yet) is tried again
  const r = controlRun();
  const got = [];
  planControlEvents(r, valueAt, 0, 0.01, sr, () => false);
  planControlEvents(r, valueAt, 0, 0.01, sr, (time, v) => got.push([time, v]) > 0);
  assert.deepEqual(got[0], [0, 0.2]);
});

/** Plays `lanePoints` through the automation scheduler and a strip control, as live (`live`) or an export, and returns the plugin's events relative to the start. */
function playThrough(lanePoints, { live, start, seconds }) {
  const sr = 48000;
  const raw = { sampleRate: sr, currentTime: 0 };
  const listeners = new Map();
  const on = (map) => (name, fn) => map.set(name, [...(map.get(name) ?? []), fn]);
  const off = (map) => (name, fn) => map.set(name, (map.get(name) ?? []).filter((f) => f !== fn));
  const ctxListeners = new Map();
  const context = { rawContext: raw, get currentTime() { return raw.currentTime; }, now: () => raw.currentTime + (live ? 0.1 : 0), on: on(ctxListeners), off: off(ctxListeners) };
  const transport = { context, loop: false, bpm: { getValueAtTime: () => BPM }, getTicksAtTime: () => 0, on: on(listeners), off: off(listeners) };
  const noParam = { setValueAtTime: () => noParam, linearRampToValueAtTime: () => noParam, cancelScheduledValues: () => noParam };
  const writer = createParamWriter(noParam, { raw, now: context.now, initial: 0.5 });
  const strip = { automationVersion: () => 0, automationTargets: () => [{ writer, map: (x) => x }], duckTarget: () => null };
  const schedule = createAutomationSchedule(transport, () => strip, { tempo: () => BPM });
  schedule.update([{ ...track(), automation: [{ param: 'plugin:p1:#Macro 1', points: lanePoints }] }]);
  const run = controlRun();
  const events = [];
  const lead = live ? 0.12 : (2 * 128) / sr;
  const tick = () => {
    for (const fn of ctxListeners.get('tick') ?? []) fn();
    planControlEvents(run, writer.valueAt, raw.currentTime, raw.currentTime + lead, sr, (t, v) => events.push([Math.round((t - start) * sr), v]) > 0);
  };
  raw.currentTime = Math.max(0, start - (live ? 0.1 : 0));
  for (const fn of listeners.get('start')) fn(start);
  for (let k = 0; raw.currentTime < start + seconds; k++) {
    tick();
    raw.currentTime += live ? 0.05 + ((k * 13) % 7) * 0.003 : 128 / sr;
  }
  schedule.dispose();
  return events.filter(([frame]) => frame < (seconds - 0.2) * sr);
}

/** What the plugin holds at each grid frame from the start, given its events. */
const heldOn = (events, frames) => {
  const out = [];
  let k = 0;
  let v = null;
  for (let f = 0; f < frames; f += CONTROL_GRID) {
    while (k < events.length && events[k][0] <= f) v = events[k++][1];
    out.push(v);
  }
  return out;
};

test('scheduler: a step lane plays the same events live as in an export, and two exports alike', () => {
  const steps = Array.from({ length: 16 }, (_, i) => ({ at: i / 16, value: ((i * 5) % 8) / 8 }));
  const c = clip('c', 1, 1, [lane(steps)], [note(0)]);
  const [auto] = S.stepAutomation(track(), [c], BPM);
  const once = playThrough(auto.points, { live: false, start: 0, seconds: 2 });
  const twice = playThrough(auto.points, { live: false, start: 0, seconds: 2 });
  assert.deepEqual(once, twice);
  // Live, started on a grid line some way into the clock (so the grid lines up with the export's)
  const live = playThrough(auto.points, { live: true, start: (CONTROL_GRID * 9000) / 48000, seconds: 2 });
  assert.ok(once.length > 16 * 4, String(once.length));
  // The same value on every grid step (to the rounding of the 32-bit values the writer keeps)
  const frames = 1.7 * 48000;
  const [a, b] = [heldOn(live, frames), heldOn(once, frames)];
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-6, `frame ${i * CONTROL_GRID}: ${v} live, ${b[i]} export`));
  // ...and events at the same moments
  assert.deepEqual(live.filter(([f]) => f >= 0).map(([f]) => f), once.filter(([f]) => f > 0).map(([f]) => f));
  // Each step's value is there by its start (to within one grid step of 16 samples)
  const spb = 240 / BPM;
  for (const s of steps.slice(1)) {
    const frame = Math.round(s.at * spb * 48000);
    const before = once.filter(([f]) => f <= frame + CONTROL_GRID).pop();
    assert.ok(Math.abs(before[1] - s.value) < 1e-6, `step at ${s.at}: ${before[1]} for ${s.value}`);
  }
});

test('slides and dives live in the note bend, and read back', () => {
  const n = note(0, 'C2', '8n');
  const slid = withSlide(n, 7, 0.5);
  assert.deepEqual(slid.expr.bend, [{ at: 0.0625, value: 0 }, { at: 0.125, value: 7 }]);
  assert.deepEqual(slideOf(slid), { kind: 'slide', semis: 7, from: 0.5 });
  assert.equal(withSlide(slid, 0).expr, undefined);
  const dived = withDive(n);
  assert.deepEqual(dived.expr.bend, [{ at: 0, value: 12 }, { at: 0.0625, value: 0 }]);
  assert.deepEqual(slideOf(dived), { kind: 'dive', semis: 12, bars: 0.0625 });
  // A dive on a note shorter than a 16th falls over the note
  assert.deepEqual(withDive(note(0, 'C2', '32n')).expr.bend, [{ at: 0, value: 12 }, { at: 0.03125, value: 0 }]);
  // Pressure stays
  const pressed = { ...n, expr: { pressure: [{ at: 0, value: 0.5 }] } };
  assert.deepEqual(withDive(pressed).expr.pressure, pressed.expr.pressure);
  assert.equal(diveNotes([n, n]).length, 2);
  // Played every 4 ms where it moves: a dive over a 16th at 140 BPM is a glide of ~27 steps, not 4
  const spb = 240 / BPM;
  const steps = noteSteps(dived.expr, 0.125, Math.min(1 / 64, 0.004 / spb));
  assert.ok(steps.length > 20, String(steps.length));
  assert.equal(steps[0].cents, 1200);
  assert.equal(steps[steps.length - 1].cents, 0);
});

test('which instruments bend', () => {
  assert.equal(bendSupport({ instrumentKey: 'plugin', plugin: { url: FLEDGE } }, 'plugin'), 'yes');
  assert.equal(bendSupport({ instrumentKey: 'plugin', plugin: { url: 'https://x/index.js' } }, 'plugin'), 'maybe');
  for (const k of ['bass', 'subBass', 'bass808', 'lead', 'growlBass', 'wobbleBass', 'reeseBass']) assert.equal(bendSupport({ instrumentKey: k }, 'synth'), 'yes', k);
  assert.equal(bendSupport({ instrumentKey: 'supersaw' }, 'synth'), 'no');
  assert.equal(bendSupport({ instrumentKey: 'drums' }, 'drums'), 'no');
});
