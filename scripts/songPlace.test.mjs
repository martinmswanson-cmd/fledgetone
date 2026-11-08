// What a note's small differences and its noise are picked by (src/audio/songPlace.ts): a song's note by its place in the song, the same live from wherever playback began, on every pass of a loop and in every export; a note played by hand by its time on the audio clock. Run with `npm test`.
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

const { atSongPlace, noteJitter, placeOf, struckLater } = await import('../src/audio/songPlace.ts');
const { noiseKey, noiseStart, trackSeed } = await import('../src/audio/seededNoise.ts');

const key = noiseKey(trackSeed('track-1'), 'snare');

test('a note played by hand is picked by its time on the audio clock, as before', () => {
  assert.equal(placeOf(12.5), 12.5);
  // 'F#1@250' hashed with salt 37 (a recorded hit's level)
  assert.equal(noteJitter('F#1', 0.25, 37), -0.8003483428154952);
  assert.notEqual(noteJitter('F#1', 0.75, 37), noteJitter('F#1', 0.25, 37));
});

test("a song's note is picked by its place, wherever the audio clock is when it plays", () => {
  // The same hat 2.5 s into the song: played from bar 1 a while after the page opened, from bar 2
  // later on, on a loop's third pass, after a pause, and in an export (its clock from 0.25 s)
  const clocks = [14.73, 99.123456, 1234.5, 3.141592653589793, 0.25 + 2.5 + 0.3 / 44100];
  const jitters = clocks.map((at) => atSongPlace(at, 2.5, () => [noteJitter('F#1', at, 37), noteJitter('F#1', at, 5), noiseStart(key, at)]));
  for (const j of jitters) assert.deepEqual(j, jitters[0]);
  // ...and it's what a note at that time would have been picked by
  assert.deepEqual(jitters[0], [noteJitter('F#1', 2.5, 37), noteJitter('F#1', 2.5, 5), noiseStart(key, 2.5)]);
  // Another place, another pick: every hit still differs from the next
  const picks = new Set(Array.from({ length: 64 }, (_, i) => atSongPlace(100 + i * 0.5, i * 0.5, () => noteJitter('F#1', 100 + i * 0.5, 37))));
  assert.equal(picks.size, 64);
  const starts = new Set(Array.from({ length: 64 }, (_, i) => atSongPlace(7 + i * 0.125, i * 0.125, () => noiseStart(key, 7 + i * 0.125))));
  assert.equal(starts.size, 64);
});

test("what starts later within a song's note keeps how much later (a strum's later string, a clap's later slap)", () => {
  const strum = (at) => atSongPlace(at, 4, () => [noteJitter('E3', at + 0.012, 7), noteJitter('B3', at + 0.024, 7), noiseStart(key, at + 0.011)]);
  assert.deepEqual(strum(50), strum(0.25 + 4));
  assert.deepEqual(strum(50), [noteJitter('E3', 4.012, 7), noteJitter('B3', 4.024, 7), noiseStart(key, 4.011)]);
});

test("a song's note struck later than asked (the page held up) is picked as it would have been on time", () => {
  const onTime = atSongPlace(20, 1, () => [noteJitter('C4', 20, 71), noiseStart(key, 20)]);
  const moved = atSongPlace(20, 1, () => struckLater(0.0123, () => [noteJitter('C4', 20.0123, 71), noiseStart(key, 20.0123)]));
  assert.deepEqual(moved, onTime);
  // Played by hand, a moved note is picked by where it plays (no place to go back to)
  assert.equal(struckLater(0.0123, () => noteJitter('C4', 20.0123, 71)), noteJitter('C4', 20.0123, 71));
  // (Not moved: as it is)
  assert.equal(atSongPlace(20, 1, () => struckLater(0, () => placeOf(20.5))), 1.5);
});

test('outside a note of the song, the clock counts again (after one that failed too)', () => {
  assert.equal(atSongPlace(30, 3, () => atSongPlace(31, 4, () => placeOf(31)) + placeOf(30)), 7);
  assert.throws(() =>
    atSongPlace(30, 3, () => {
      throw new Error('a note that failed');
    })
  );
  assert.equal(placeOf(30), 30);
  assert.equal(noteJitter('F#1', 0.25, 37), -0.8003483428154952);
});
