// Which take a recorded instrument plays for a song's note (src/audio/takeTurns.ts, songPlace.ts songTurn): its
// turn, counted from the song's start note by note and loudness by loudness, so it's the same live from wherever
// playback began, after a pause, on every pass of a loop and in every export; and a steady pattern never plays the
// same take twice running. Run with `npm test`.
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

const { loudnessOf, songTurns, takeOf } = await import('../src/audio/takeTurns.ts');
const { atSongPlace, songTurn, struckLater } = await import('../src/audio/songPlace.ts');

/** Transport ticks: 192 a quarter note */
const Q = 192;
const BAR = 4 * Q;
/** A recorded kit's loudnesses (four, as the Studio and Session kits have) and a sampled instrument's (three) */
const KIT = [0.3, 0.55, 0.8, 1];
const SAMPLED = [0.35, 0.68, 1];

/** Hits of `note` every `step` ticks from `from`, over `bars` bars, at `velocity` (or a velocity per hit). */
const every = (note, step, { from = 0, bars = 8, velocity = 0.7 } = {}) => {
  const out = [];
  for (let tick = from; tick < bars * BAR; tick += step) out.push({ tick, note, velocity: typeof velocity === 'function' ? velocity(tick) : velocity });
  return out;
};

/** The recording each hit plays (its note, loudness and take) with `takes` takes, and how many hits running play the same one. */
function played(notes, tops, takes = 2) {
  const turns = songTurns(notes, tops);
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].tick - notes[b].tick || a - b);
  const byNote = new Map();
  for (const i of order) {
    const n = notes[i];
    const rec = `${n.note}|${loudnessOf(n.velocity, tops)}|${takeOf(turns[i], takes)}`;
    if (!byNote.has(n.note)) byNote.set(n.note, []);
    byNote.get(n.note).push(rec);
  }
  let repeats = 0;
  const used = new Set();
  for (const recs of byNote.values()) {
    recs.forEach((r, k) => {
      used.add(r);
      if (k > 0 && recs[k - 1] === r) repeats++;
    });
  }
  return { turns, repeats, used };
}

test('a steady pattern never plays the same take twice running, and plays every take', () => {
  const patterns = {
    '16ths': every('F#1', Q / 4),
    // (swing moves a note's time, not its tick: a swung pattern counts as the straight one)
    '8ths': every('F#1', Q / 2),
    quarters: every('C1', Q),
    'offbeat 8ths': every('F#1', Q, { from: Q / 2 }),
    'half notes': every('D1', 2 * Q),
    '8th triplets': every('F#1', Q / 3),
    '32nd roll': every('D1', Q / 8, { bars: 1 }),
  };
  for (const [name, notes] of Object.entries(patterns)) {
    for (const takes of [2, 3]) {
      const { repeats, used } = played(notes, KIT, takes);
      assert.equal(repeats, 0, `${name} with ${takes} takes`);
      assert.equal(used.size, takes, `${name} plays all ${takes} takes`);
    }
  }
});

test('accents on another loudness between them leave each loudness playing its takes in turn', () => {
  // 16th hats accented on the beat, a snare on 2 and 4, a kick on 1 and 3 (a written drum part)
  const notes = [
    ...every('F#1', Q / 4, { velocity: (t) => (t % Q === 0 ? 0.9 : 0.5) }),
    ...every('D1', 2 * Q, { from: Q, velocity: 0.85 }),
    ...every('C1', 2 * Q, { velocity: 0.9 }),
  ];
  const { turns, repeats, used } = played(notes, KIT);
  assert.equal(repeats, 0);
  // both takes of the soft hat and of the accent, the snare and the kick
  assert.equal(used.size, 8);
  // each loudness's hits alternate on their own (as a kit counting per row and loudness played them)
  const soft = notes.map((n, i) => [n, turns[i]]).filter(([n]) => n.note === 'F#1' && n.velocity === 0.5);
  soft.forEach(([, t], k) => assert.equal(t, k));
});

test('two notes played in turn each play their takes in turn (an octave line, a sampled instrument)', () => {
  const notes = every('C3', Q, { velocity: 0.6 }).flatMap((n) => [n, { ...n, tick: n.tick + Q / 2, note: 'C4' }]);
  const { repeats, used } = played(notes, SAMPLED);
  assert.equal(repeats, 0);
  assert.equal(used.size, 4);
});

test("a song's note's turn depends only on the song: the same wherever playback begins, after a pause, on every pass and in every export", () => {
  // Two clips on a track, in either order: each note's turn is where it falls in the song
  const a = every('F#1', Q / 2, { bars: 4 });
  const b = every('F#1', Q / 2, { from: 4 * BAR, bars: 8 });
  const both = songTurns([...a, ...b], KIT);
  const swapped = songTurns([...b, ...a], KIT);
  assert.deepEqual(swapped, [...both.slice(a.length), ...both.slice(0, a.length)]);
  // A hit from bar 5 on (playback started there, a range export from there, after a pause there)
  // has the turn it has in the whole song: the 32 hats before it count, played or not
  assert.equal(both[a.length], 32);
  assert.equal(takeOf(both[a.length], 2), 0);
});

test('a whole song from bar 1 plays the takes a kit counting its hits played (what an export of the whole song always had)', () => {
  const notes = [...every('F#1', Q / 4, { velocity: (t) => (t % Q === 0 ? 0.9 : 0.5) }), ...every('D1', Q, { from: Q / 2, velocity: 0.8 }), { tick: 5 * Q, note: 'D1', velocity: 0.8 }];
  const turns = songTurns(notes, KIT);
  // The old way: a fresh kit counting each row's and loudness's hits as they play, in time order
  const count = new Map();
  const order = notes.map((_, i) => i).sort((x, y) => notes[x].tick - notes[y].tick || x - y);
  for (const i of order) {
    const k = `${notes[i].note}|${loudnessOf(notes[i].velocity, KIT)}`;
    const n = count.get(k) ?? 0;
    count.set(k, n + 1);
    assert.equal(turns[i], n);
  }
});

test('hits of one note at one tick (two clips) take their turns in the order given', () => {
  assert.deepEqual(songTurns([{ tick: 0, note: 'C1', velocity: 0.9 }, { tick: 0, note: 'C1', velocity: 0.9 }, { tick: Q, note: 'C1', velocity: 0.9 }], KIT), [0, 1, 2]);
  // a velocity past the loudest plays the loudest
  assert.equal(loudnessOf(1.2, KIT), 3);
  assert.equal(loudnessOf(0.3, KIT), 0);
  assert.equal(loudnessOf(0.31, KIT), 1);
  assert.equal(takeOf(5, 2), 1);
});

test("a song's note carries its turn to the instrument; a note played by hand has none (it plays the next take)", () => {
  const turns = new Map([['F#1', 7], ['C1', 2]]);
  assert.equal(songTurn('F#1'), undefined);
  const seen = atSongPlace(10, 2.5, () => [songTurn('F#1'), songTurn('C1'), songTurn('D1'), struckLater(0.02, () => songTurn('F#1')), atSongPlace(11, 3, () => songTurn('F#1'))], turns);
  assert.deepEqual(seen, [7, 2, undefined, 7, undefined]);
  assert.equal(songTurn('F#1'), undefined);
});
