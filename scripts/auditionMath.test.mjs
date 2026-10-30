// Hearing a stretch of a song as the song plays it (src/audio/auditionMath.ts): the run-in and the
// notes begun again at its start count only the notes the scheduler plays (not those a trim hides)
// for as long as it plays them (the sustain pedal holding a note let go). Run with `npm test`.
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
const { preRollStart, restartHeldNotes, soundingNotes } = await import('../src/audio/auditionMath.ts');
const { sustainNotes } = await import('../src/store/expression.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');

const track = { id: 't', name: 'Pad', instrumentKey: 'synthDesigner', isMuted: false, isSoloed: false, volume: 0, pan: 0 };
const note = (id, startOffset, duration) => ({ id, note: 'D3', startOffset, duration, velocity: 0.8 });
const songOf = (clip) => ({ tracks: [track], clips: [clip], bpm: 120, tempoPoints: [] });
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-3, `${what}: ${a} against ${b}`);

test('a note hidden by a trim is never heard in a range: no run-in for it, and it is not begun again', () => {
  // Starts a quarter of a bar before the clip (a left trim): the scheduler drops it
  const before = { id: 'c', trackId: 't', startBar: 1, lengthBars: 16, notes: [note('hidden', -0.25, '16m')] };
  assert.equal(preRollStart(songOf(before), 11), 11, 'nothing to run in from');
  assert.equal(restartHeldNotes([before], 3, 11)[0], before, 'the clip as it is');
  // At or past the clip's end (a right trim): dropped too
  const after = { id: 'c', trackId: 't', startBar: 1, lengthBars: 4, notes: [note('past', 4, '8m'), note('end', 3.99999999, '8m')] };
  assert.equal(preRollStart(songOf({ ...after, lengthBars: 4 }), 6), 6);
  assert.deepEqual(soundingNotes(after), []);
  // A note that does play still counts
  const plays = { ...before, notes: [...before.notes, note('plays', 0, '16m')] };
  assert.equal(preRollStart(songOf(plays), 11), 11 - 8);
  const out = restartHeldNotes([plays], 5, 11)[0];
  assert.equal(out.notes.find((n) => n.id === 'hidden'), plays.notes[0], 'the hidden one left as it is (the scheduler drops it)');
  assert.equal(out.notes.find((n) => n.id === 'plays').startOffset, 4, 'the one that plays begins again at the run-in');
});

test('a note held by the sustain pedal is heard in a range after it was let go, as the scheduler holds it', () => {
  // A quarter note in bar 1, the pedal down until 3 bars in: it sounds until bar 4
  const clip = { id: 'c', trackId: 't', startBar: 1, lengthBars: 16, expression: { sustain: [{ at: 0, value: 1 }, { at: 3, value: 1 }, { at: 3.01, value: 0 }] }, notes: [note('n1', 0, '4n')] };
  const [s] = soundingNotes(clip);
  near(s.bars, 3.01, 'held to the pedal coming up');
  near(s.bars, durationToBars(sustainNotes(clip.notes, clip.expression.sustain, clip.lengthBars)[0].duration), 'as the scheduler works it out');
  assert.equal(preRollStart(songOf(clip), 2), 1, 'rendered from the note');
  // Held over a run-in: begun again there, for what the pedal leaves of it
  const out = restartHeldNotes([clip], 2, 3)[0];
  const n = out.notes[0];
  assert.equal(out.startBar + n.startOffset, 2);
  near(durationToBars(n.duration), 2.01, 'to the pedal coming up');
  assert.equal(n.heldFrom, 1);
  // ...and the scheduler, holding it again, ends it at the same place (the pedal is up by then)
  const again = sustainNotes(out.notes, clip.expression.sustain, clip.lengthBars)[0];
  near(n.startOffset + durationToBars(again.duration), 3.01, 'the scheduler ends it where the pedal comes up');
  // Without the pedal it was over long before: nothing to run in, nothing begun again
  const dry = { ...clip, expression: undefined };
  assert.equal(preRollStart(songOf(dry), 2), 2);
  assert.equal(restartHeldNotes([dry], 2, 3)[0], dry);
});
