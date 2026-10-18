// Showcase video (src/store/showcase.ts): the notes the song plays, in seconds from the start of the export, only what's heard.
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

const { showcaseData, firstFrom } = await import('../src/store/showcase.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');

const track = (id, instrumentKey, extra = {}) => ({ id, name: id, color: `#${id.length}00000`, instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0, ...extra });
const note = (n, at, duration = '4n') => ({ id: `${n}${at}`, note: n, startOffset: at, duration, velocity: 0.8 });
const clip = (id, trackId, startBar, lengthBars, notes) => ({ id, trackId, name: id, startBar, lengthBars, notes, isSelected: false });
// 120 BPM in 4/4: a bar is 2 seconds
const toSeconds = (bar) => (bar - 1) * 2;

test('notes in seconds from the start of the range, sorted, with the drums apart', () => {
  const tracks = [track('piano', 'piano'), track('kit', 'drums')];
  const clips = [clip('a', 'piano', 2, 2, [note('C4', 0), note('E4', 1, '2n')]), clip('b', 'kit', 2, 1, [note('C2', 0, '16n'), note('D2', 0.5, '16n')])];
  const d = showcaseData(tracks, clips, 2, 4, toSeconds);
  assert.deepEqual(d.notes.map((n) => [n.start, n.midi, n.drum]), [[0, 36, true], [0, 60, false], [1, 38, true], [2, 64, false]]);
  assert.equal(d.notes.find((n) => n.midi === 64).end, 3);
  assert.deepEqual(d.tracks.map((t) => t.name), ['piano', 'kit']);
  assert.deepEqual(d.drumRows, [36, 38]);
  assert.equal(d.low, 60);
  assert.equal(d.high, 64);
  assert.deepEqual(d.bars, [0, 2, 4]);
});

test('only what is heard: muted tracks, solos elsewhere and notes hidden by a trimmed clip are left out', () => {
  const tracks = [track('lead', 'piano'), track('pad', 'piano', { isMuted: true })];
  const clips = [clip('a', 'lead', 1, 1, [note('C5', 0), note('D5', 1.5)]), clip('b', 'pad', 1, 1, [note('C3', 0)])];
  const d = showcaseData(tracks, clips, 1, 3, toSeconds);
  assert.deepEqual(d.notes.map((n) => n.midi), [72]);
  const solo = showcaseData([track('lead', 'piano'), track('pad', 'piano', { isSoloed: true })], clips, 1, 3, toSeconds);
  assert.deepEqual(solo.notes.map((n) => n.midi), [48]);
});

test('a note held past the end of its clip or the range is cut there', () => {
  const d = showcaseData([track('p', 'piano')], [clip('a', 'p', 1, 1, [note('C4', 0.5, '1m')])], 1, 3, toSeconds);
  assert.equal(d.notes[0].end, 2);
  const r = showcaseData([track('p', 'piano')], [clip('a', 'p', 1, 4, [note('C4', 0, '1m'), note('D4', 3)])], 1, 2, toSeconds);
  assert.deepEqual(r.notes.map((n) => [n.midi, n.end]), [[60, 2]]);
});

test('firstFrom finds the first note starting at or after a time', () => {
  const notes = [0, 1, 1, 2, 5].map((start) => ({ start }));
  assert.equal(firstFrom(notes, 1), 1);
  assert.equal(firstFrom(notes, 1.5), 3);
  assert.equal(firstFrom(notes, 9), 5);
  assert.equal(firstFrom(notes, -1), 0);
});
