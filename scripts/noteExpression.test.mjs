// Unit tests for controller lanes (ccLanes.ts) and per-note expression (noteExpression.ts, recording). Run with `npm test`.
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
const { controllerLanes, withControllerLanes, ccTarget, controllerMemo } = await import('../src/store/ccLanes.ts');
const { noteValueAt, noteSteps, isExpressive, normalizeNoteExpression } = await import('../src/store/noteExpression.ts');
const { createTake } = await import('../src/store/recording.ts');
const { normalizeExpression, laneCc, lanesOf } = await import('../src/store/expression.ts');

const track = (extra = {}) => ({ id: 't', name: 'Lead', instrumentKey: 'lead', volume: -6, pan: 0, fx: {}, ...extra });
const clip = (startBar, expression) => ({ id: `c${startBar}`, trackId: 't', name: 'c', startBar, lengthBars: 1, notes: [], expression });

test('controller lanes are read from files and named by number', () => {
  const e = normalizeExpression({ cc74: [{ at: 0, value: 0.5 }], cc200: [{ at: 0, value: 1 }], bend: [{ at: 0, value: 1 }] });
  assert.deepEqual(Object.keys(e).sort(), ['bend', 'cc74']);
  assert.equal(laneCc('cc74'), 74);
  assert.equal(laneCc('mod'), null);
  assert.deepEqual(lanesOf(e).sort(), ['bend', 'cc74']);
});

test("a clip's controller lane becomes its track's automation of the setting it's mapped to", () => {
  assert.equal(ccTarget(track(), 74), 'filterCutoff');
  assert.equal(ccTarget(track({ midiMap: [{ cc: 74, param: 'fx:reverb.mix' }] }), 74), 'fx:reverb.mix');
  assert.equal(ccTarget(track(), 20), undefined);
  const clips = [clip(3, { cc7: [{ at: 0, value: 0.2 }, { at: 0.5, value: 0.8 }] }), clip(1, { cc7: [{ at: 0, value: 1 }] })];
  const lanes = controllerLanes(track(), clips);
  // (From the clip at bar 1 on; held from its end until the clip at bar 3 starts, then a step)
  assert.deepEqual(lanes, [{ param: 'volume', points: [{ bar: 1, value: 10 ** (-12 / 80) }, { bar: 1, value: 1 }, { bar: 3, value: 1 }, { bar: 3, value: 0.2 }, { bar: 3.5, value: 0.8 }] }]);
  // The track's own lane for the setting wins
  assert.deepEqual(controllerLanes(track({ automation: [{ param: 'volume', points: [{ bar: 1, value: 0.5 }] }] }), clips), []);
  // A frozen track's view keeps only its live settings' lanes; the copy rendered into the freeze the others
  assert.equal(controllerLanes(track({ frozenFrom: 'lead' }), [clip(1, { cc74: [{ at: 0, value: 1 }] })]).length, 0);
  assert.equal(controllerLanes(track({ freezing: true }), clips).length, 0);
  // Unchanged: the same tracks back
  const memo = controllerMemo();
  const tracks = [track()];
  const a = withControllerLanes(tracks, clips, memo);
  const b = withControllerLanes(tracks, clips, memo);
  assert.equal(a, b);
  assert.notEqual(a[0], tracks[0]);
  assert.equal(withControllerLanes(tracks, [clip(1, { bend: [{ at: 0, value: 1 }] })]), tracks);
});

test("before a track's first controller lane its own setting plays, and between clips the value holds", async () => {
  const { laneValueAt } = await import('../src/audio/automation.ts');
  // A swell (CC 11) in bars 3 and 6: bars 1-2 at the track's own volume, not the swell's first value
  const clips = [clip(3, { cc11: [{ at: 0.25, value: 0.3 }, { at: 1, value: 0.9 }] }), clip(6, { cc11: [{ at: 0, value: 0.1 }, { at: 1, value: 0.5 }] })];
  const [lane] = controllerLanes(track(), clips);
  const own = 10 ** (-12 / 80);
  for (const bar of [1, 1.5, 2, 2.99]) assert.equal(laneValueAt(lane.points, bar), own, `bar ${bar}`);
  // From the clip's start, its first point's value (as its MIDI)
  assert.equal(laneValueAt(lane.points, 3), 0.3);
  assert.equal(laneValueAt(lane.points, 3.2), 0.3);
  // Between the clips: held at what the first left (no glide down to the next one's start), then a step
  for (const bar of [4, 4.5, 5, 5.99]) assert.equal(laneValueAt(lane.points, bar), 0.9, `bar ${bar}`);
  assert.equal(laneValueAt(lane.points, 6), 0.1);
  assert.ok(Math.abs(laneValueAt(lane.points, 6.5) - 0.3) < 1e-9);
  assert.equal(laneValueAt(lane.points, 9), 0.5);
  // Pan: the track's own pan first
  const [pan] = controllerLanes(track({ pan: -0.5 }), [clip(2, { cc10: [{ at: 0, value: 1 }] })]);
  assert.equal(pan.param, 'pan');
  assert.ok(Math.abs(laneValueAt(pan.points, 1.5) - 0.25) < 1e-9, String(laneValueAt(pan.points, 1.5)));
  assert.equal(laneValueAt(pan.points, 2), 1);
});

test('a note bends and swells on its own', () => {
  const expr = normalizeNoteExpression({ bend: [{ at: 0.25, value: 2 }, { at: 0, value: 0 }], pressure: [{ at: 0, value: 0.5 }, { at: 0.5, value: 1 }] });
  assert.ok(isExpressive(expr));
  assert.equal(noteValueAt(expr.bend, 0.125, 'bend'), 1);
  assert.equal(noteValueAt(undefined, 0.3, 'pressure'), 1);
  assert.equal(noteValueAt(expr.pressure, 0.25, 'pressure'), 0.75);
  const steps = noteSteps(expr, 0.5, 1 / 16);
  assert.equal(steps[0].cents, 0);
  assert.equal(steps.find((s) => s.at === 0.25).cents, 200);
  assert.ok(!isExpressive({ bend: [{ at: 0, value: 0 }], pressure: [{ at: 0, value: 1 }] }));
});

test("an MPE keyboard's per-note bend and pressure are recorded into the notes", () => {
  const take = createTake(1);
  take.noteOn(60, 'C4', 0.8, 1, 0);
  take.noteOn(64, 'E4', 0.8, 1, 0);
  take.noteControl(64, 'bend', 0, 1);
  take.noteControl(64, 'bend', 2, 1.25);
  take.noteControl(60, 'pressure', 0.4, 1.125);
  take.noteOff(60, 1);
  take.noteOff(64, 1);
  const clipOut = take.finish(2, 2, 120);
  const c4 = clipOut.notes.find((n) => n.note === 'C4');
  const e4 = clipOut.notes.find((n) => n.note === 'E4');
  assert.deepEqual(e4.expr.bend, [{ at: 0, value: 0 }, { at: 0.25, value: 2 }]);
  assert.deepEqual(c4.expr, { pressure: [{ at: 0.125, value: 0.4 }] });
});
