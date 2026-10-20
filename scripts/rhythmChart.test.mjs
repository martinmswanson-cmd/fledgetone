// The rhythm game's chart (src/store/rhythmChart.ts): the song's kicks, snares and melody on four lanes, thinned per difficulty.
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

const { buildChart, LANES } = await import('../src/store/rhythmChart.ts');

// 120 BPM in 4/4 (a beat is 0.5 s, a bar 2 s), 8 bars: kick on 1 and 3, snare on 2 and 4, hats
// on every eighth, and a melody of eighth notes climbing and falling, with a long note per bar
function song() {
  const notes = [];
  const bars = [];
  for (let b = 0; b <= 8; b++) bars.push(b * 2);
  for (let b = 0; b < 8; b++) {
    const t0 = b * 2;
    for (let beat = 0; beat < 4; beat++) notes.push({ start: t0 + beat * 0.5, end: t0 + beat * 0.5 + 0.1, midi: beat % 2 ? 26 : 24, color: '#f00', track: 0, drum: true });
    for (let e = 0; e < 8; e++) notes.push({ start: t0 + e * 0.25, end: t0 + e * 0.25 + 0.05, midi: 30, color: '#f00', track: 0, drum: true });
    const tune = [60, 62, 64, 65, 67, 65, 64];
    tune.forEach((m, i) => notes.push({ start: t0 + i * 0.25, end: t0 + i * 0.25 + 0.2, midi: m, color: '#0f0', track: 1, drum: false }));
    notes.push({ start: t0 + 1.75, end: t0 + 1.75 + 1.2, midi: 72, color: '#0f0', track: 1, drum: false });
    // A chord under the tune: only its top note counts
    notes.push({ start: t0, end: t0 + 2, midi: 48, color: '#00f', track: 2, drum: false });
  }
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return { notes, tracks: [], bars, low: 48, high: 72, drumRows: [24, 26, 30] };
}

test('every note is on a lane, in time order, inside the song', () => {
  for (const d of ['easy', 'normal', 'hard']) {
    const chart = buildChart(song(), d);
    assert.ok(chart.length > 0, d);
    for (let i = 0; i < chart.length; i++) {
      const n = chart[i];
      assert.ok(n.lane >= 0 && n.lane < LANES, `${d}: lane ${n.lane}`);
      assert.ok(n.time >= 0 && n.time < 16, `${d}: time ${n.time}`);
      if (i) assert.ok(chart[i - 1].time <= n.time, `${d}: sorted`);
      if (n.end !== undefined) assert.ok(n.end > n.time, `${d}: a hold ends after it starts`);
    }
  }
});

test('harder charts have more notes; easy keeps its notes apart and has no holds', () => {
  const easy = buildChart(song(), 'easy');
  const normal = buildChart(song(), 'normal');
  const hard = buildChart(song(), 'hard');
  assert.ok(easy.length < normal.length && normal.length < hard.length, `${easy.length} < ${normal.length} < ${hard.length}`);
  for (let i = 1; i < easy.length; i++) assert.ok(easy[i].time - easy[i - 1].time >= 0.42 - 1e-9);
  assert.ok(easy.every((n) => n.end === undefined));
  assert.ok(normal.some((n) => n.end !== undefined), 'the long note is a hold on normal');
});

test('kicks and snares keep the backbone on easy, kicks to the left and snares to the right', () => {
  const easy = buildChart(song(), 'easy');
  const beats = new Set(easy.map((n) => Math.round(n.time * 1000)));
  // Every beat of every bar has a note
  for (let b = 0; b < 8; b++) for (let beat = 0; beat < 4; beat++) assert.ok(beats.has(b * 2000 + beat * 500), `bar ${b + 1} beat ${beat + 1}`);
  const at = (t) => easy.find((n) => Math.abs(n.time - t) < 1e-6);
  assert.ok(at(0).lane <= 1, 'a kick on the left');
  assert.ok(at(0.5).lane >= LANES - 2, 'a snare on the right');
});

test('a lane is never asked for twice too fast', () => {
  const hard = buildChart(song(), 'hard');
  const last = new Map();
  for (const n of hard) {
    if (last.has(n.lane)) assert.ok(n.time - last.get(n.lane) >= 0.16 - 1e-9, `lane ${n.lane} at ${n.time}`);
    last.set(n.lane, n.end ?? n.time);
  }
});

test('an empty song has an empty chart', () => {
  assert.deepEqual(buildChart({ notes: [], tracks: [], bars: [0, 2], low: 60, high: 72, drumRows: [] }, 'normal'), []);
});
