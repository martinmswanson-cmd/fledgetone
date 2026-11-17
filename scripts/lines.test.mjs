// Lines video (src/store/lines.ts): each pitched track's runs of line and the pitch they show, the drum row's hits.
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

const { linesData, runPitch, isSounding, LINE_BEND } = await import('../src/store/lines.ts');

const n = (start, end, midi, track = 0, extra = {}) => ({ start, end, midi, color: '#fff', track, drum: false, ...extra });
const data = (notes, tracks = ['a', 'b']) => ({ notes: [...notes].sort((x, y) => x.start - y.start || x.midi - y.midi), tracks: tracks.map((name) => ({ name, color: '#fff' })), bars: [0, 2, 4], low: 0, high: 0, drumRows: [] });

test('a rest within the allowance keeps the line, a longer one ends it', () => {
  const kept = linesData(data([n(0, 1, 60), n(2.4, 3, 62)]));
  assert.equal(kept.tracks[0].runs.length, 1);
  assert.deepEqual([kept.tracks[0].runs[0].start, kept.tracks[0].runs[0].end], [0, 3]);
  const ended = linesData(data([n(0, 1, 60), n(2.6, 3, 62)]));
  assert.deepEqual(ended.tracks[0].runs.map((r) => [r.start, r.end]), [[0, 1], [2.6, 3]]);
});

test('the line bends to a new pitch as its note starts', () => {
  const run = linesData(data([n(0, 1, 60), n(1, 2, 72)])).tracks[0].runs[0];
  assert.equal(runPitch(run, 0.5), 60);
  assert.equal(runPitch(run, 1), 60);
  assert.ok(Math.abs(runPitch(run, 1 + LINE_BEND / 2) - 66) < 1e-9);
  assert.equal(runPitch(run, 1 + LINE_BEND), 72);
  assert.equal(runPitch(run, -1), 60);
  assert.equal(isSounding(run, 0.5), true);
  assert.equal(isSounding(run, 2.5), false);
});

test('a chord follows its top note, and stays there when it ends over held lower notes', () => {
  const run = linesData(data([n(0, 4, 48), n(0, 4, 55), n(0.01, 1, 64), n(2, 3, 52)])).tracks[0].runs[0];
  assert.equal(runPitch(run, 0.5), 64);
  assert.equal(runPitch(run, 1.5), 64);
  // The top note is over: a new note takes the line, though lower
  assert.equal(runPitch(run, 2.5), 52);
  assert.deepEqual(run.starts, [0, 2]);
});

test('a fast passage is a calm curve near its average', () => {
  const notes = [];
  for (let i = 0; i < 16; i++) notes.push(n(i * 0.1, i * 0.1 + 0.09, i % 2 ? 72 : 60));
  const run = linesData(data(notes)).tracks[0].runs[0];
  for (let t = 0.4; t < 1.4; t += 0.05) assert.ok(Math.abs(runPitch(run, t) - 66) < 2, `at ${t}: ${runPitch(run, t)}`);
  assert.equal(run.starts.length, 16);
});

test('drums and instruments with no pitch are hits, not lines', () => {
  const d = linesData(data([n(0, 0.1, 24, 0, { drum: true, kick: true }), n(0.5, 0.6, 26, 0, { drum: true }), n(1, 1.2, 50, 1, { perc: true })]));
  assert.deepEqual(d.tracks, []);
  assert.deepEqual(d.hits, [{ t: 0, kick: true }, { t: 0.5, kick: false }, { t: 1, kick: false }]);
  assert.deepEqual([d.low, d.high], [60, 72]);
});

test('two tracks on the same note are two lines', () => {
  const d = linesData(data([n(0, 1, 60, 0), n(0, 1, 60, 1)]));
  assert.deepEqual(d.tracks.map((t) => t.name), ['a', 'b']);
  assert.deepEqual([d.low, d.high], [60, 60]);
});
