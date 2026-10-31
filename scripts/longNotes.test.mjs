// No note is longer than the whole timeline (TOTAL_BARS): a file, a stored song, a shared link or
// a stinger can say any length, and every note is stepped through (its bend and pressure) and rung
// out (Export) over its length. Lengths are brought to the timeline on open and read no longer
// than it everywhere; a note's expression steps stop where its curves do, the same steps as
// before. A failed export says so in plain words. Run with `npm test`.
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
const { TOTAL_BARS, durationToBars, barsToDuration, readNoteDuration } = await import('../src/store/timelineTypes.ts');
const { parseProject, serializeProject } = await import('../src/store/project.ts');
const { noteSteps, noteValueAt } = await import('../src/store/noteExpression.ts');
const { exportFailureWords, BROWSER_FAILED } = await import('../src/audio/exportFailure.ts');
const { createStarter, STARTERS } = await import('../src/store/starters.ts');

const LONG = ['1000000m', '5000000m', '401m', '400.5m', '1000000:0:0', '0:99999999:0', '0:0:9999999', '999999999i', `${'9'.repeat(400)}m`];

test('a length past the whole timeline reads as the whole timeline; shorter ones as before', () => {
  for (const d of LONG) {
    assert.equal(durationToBars(d), TOTAL_BARS, d);
    assert.equal(readNoteDuration(d), barsToDuration(TOTAL_BARS), d);
    assert.equal(durationToBars(readNoteDuration(d)), TOTAL_BARS, d);
  }
  for (const [d, bars] of [['16n', 1 / 16], ['8n.', 0.1875], ['8t', 1 / 12], ['2m', 2], ['400m', 400], ['1:2:3', 1.6875], ['80i', 80 / 768], ['400:0:0', 400]]) {
    assert.equal(durationToBars(d), bars, d);
    assert.equal(readNoteDuration(d), d, d);
  }
  // Unreadable or not text: a 16th, as before
  for (const d of ['', 'long', '1e9m', '-5m', 5, null]) assert.equal(readNoteDuration(d), '16n');
  // Made by an edit: never past the timeline either
  assert.equal(barsToDuration(1e9), barsToDuration(TOTAL_BARS));
  assert.equal(barsToDuration(TOTAL_BARS), '400:0:0');
  assert.equal(barsToDuration(2), '2:0:0');
});

test('a song opens with every note no longer than the timeline: clips, takes, launcher slots, stingers', () => {
  const note = (id, duration) => ({ id, note: 'C4', startOffset: 0, duration, velocity: 0.8 });
  const file = {
    format: 'fledgetone-project',
    version: 1,
    name: 'Long',
    bpm: 120,
    tracks: [
      {
        id: 't1',
        name: 'Keys',
        instrumentKey: 'keys',
        color: '#888',
        slots: [{ scene: 0, clip: { name: 'S', lengthBars: 1, notes: [note('s1', '1000000m'), note('s2', '4n')] } }],
      },
    ],
    clips: [
      {
        id: 'c1',
        trackId: 't1',
        name: 'C',
        startBar: 1,
        lengthBars: 1,
        notes: [note('n1', '1000000m'), note('n2', '0:99999999:0'), note('n3', '8n')],
        takes: [
          { id: 'k1', notes: [note('k1', '5000000m')] },
          { id: 'k2', notes: [note('k2', '2n')] },
        ],
        comp: [{ at: 0, take: 0 }],
      },
    ],
    stingers: [{ id: 'st', name: 'Hit', kind: 'victory', instrumentKey: 'keys', variation: 0, lengthBars: 2, notes: [note('x1', '1000000m'), note('x2', '4n'), note('x3', 'not a length')] }],
  };
  const p = parseProject(JSON.parse(JSON.stringify(file)));
  const whole = barsToDuration(TOTAL_BARS);
  assert.deepEqual(p.clips[0].notes.map((n) => n.duration), [whole, whole, '8n']);
  assert.deepEqual(p.clips[0].takes.map((t) => t.notes[0].duration), [whole, '2n']);
  assert.deepEqual(p.tracks[0].slots[0].clip.notes.map((n) => n.duration), [whole, '4n']);
  assert.deepEqual(p.stingers[0].notes.map((n) => n.duration), [whole, '4n', '16n']);
  // ...and saves and opens again as it is
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(serializeProject(p)))).clips[0].notes.map((n) => n.duration), [whole, whole, '8n']);
});

test('every starter opens with its note lengths as written', () => {
  for (const { id } of STARTERS) {
    const song = createStarter(id);
    const opened = parseProject(JSON.parse(JSON.stringify(serializeProject(song))));
    assert.deepEqual(
      opened.clips.flatMap((c) => c.notes.map((n) => n.duration)),
      song.clips.flatMap((c) => c.notes.map((n) => n.duration)),
      id
    );
  }
});

/** noteSteps as it was: every step over the whole length. */
function stepsBefore(expr, length, step = 1 / 64) {
  const out = [];
  for (let at = 0; at < length - 1e-9; at += step) {
    const cents = noteValueAt(expr.bend, at, 'bend') * 100;
    const pressure = noteValueAt(expr.pressure, at, 'pressure');
    const last = out[out.length - 1];
    if (last && Math.abs(last.cents - cents) < 0.5 && Math.abs(last.pressure - pressure) < 0.005) continue;
    out.push({ at, cents, pressure });
  }
  return out;
}

test("a note's expression steps are the same as before, and stop where its curves do", () => {
  const exprs = [
    { bend: [{ at: 0, value: 0 }, { at: 0.5, value: 1 }] },
    { bend: [{ at: 0.1, value: -2 }, { at: 0.3, value: 2 }, { at: 0.9, value: 0 }] },
    { pressure: [{ at: 0, value: 1 }, { at: 0.75, value: 0.2 }] },
    { bend: [{ at: 0.25, value: 12 }], pressure: [{ at: 0, value: 0.5 }, { at: 1.5, value: 1 }] },
    { bend: [{ at: 3, value: 0 }, { at: 3.5, value: -1 }] },
    { bend: [], pressure: [] },
  ];
  for (const expr of exprs)
    for (const length of [1 / 16, 0.3, 0.5, 1, 2, 4, 7.25])
      for (const step of [1 / 64, 1 / 500, 0.004 / 2])
        assert.deepEqual(noteSteps(expr, length, step), stepsBefore(expr, length, step), JSON.stringify({ expr, length, step }));

  // A note a million bars long, bent: as quick as a short one, its steps those of a short one
  const expr = exprs[0];
  const started = performance.now();
  const long = noteSteps(expr, 1_000_000, 0.004 / 2);
  assert.ok(performance.now() - started < 200, 'quick');
  assert.deepEqual(long, stepsBefore(expr, 1, 0.004 / 2));
  // With curves past the timeline: still no step past it
  const far = noteSteps({ bend: [{ at: 0, value: 0 }, { at: 1e9, value: 1 }] }, 1e12, 1);
  assert.ok(far.length > 0 && far.every((s) => s.at < TOTAL_BARS));
});

test("a failed export says so in plain words: the app's own words as they are, the browser's put plainly", () => {
  assert.equal(exportFailureWords(new Error("couldn't download the piano recordings. Check your internet connection and try again.")), "couldn't download the piano recordings. Check your internet connection and try again.");
  class SoundError extends Error {}
  assert.equal(exportFailureWords(new SoundError('the sound is missing')), 'the sound is missing');
  for (const err of [
    new DOMException("Failed to execute 'startRendering' on 'OfflineAudioContext': startRendering failed to create AudioBuffer(2, 2300823159, 44100)", 'NotSupportedError'),
    new RangeError('Array buffer allocation failed'),
    new TypeError("Cannot read properties of undefined (reading 'length')"),
    new Error(''),
    'a thrown string',
    undefined,
  ])
    assert.equal(exportFailureWords(err), BROWSER_FAILED);
  assert.doesNotMatch(BROWSER_FAILED, /AudioBuffer|OfflineAudioContext|Error/);
});
