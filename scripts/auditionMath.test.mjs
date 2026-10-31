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
const { preRollStart, restartHeldNotes, soundingNotes, releaseSeconds, RELEASE_ALLOWANCE_SECONDS, loopChannels, LOOP_FADE_SECONDS } = await import('../src/audio/auditionMath.ts');
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
  // Without the pedal it ends at 1.25, and rings out a release (2 s, a bar here) after: a range
  // from bar 2 runs in from it (it isn't begun again: it plays as it is), one from bar 3 doesn't
  const dry = { ...clip, expression: undefined };
  assert.equal(preRollStart(songOf(dry), 2), 1);
  assert.equal(preRollStart(songOf(dry), 3), 3);
  assert.equal(restartHeldNotes([dry], 1, 2)[0], dry);
  assert.equal(restartHeldNotes([dry], 2, 3)[0], dry);
});

test('a note that ends at or just before a range rings out into it: the run-in starts from it', () => {
  // A pad's 2-bar chord ending exactly on bar 3, in a clip that ends there too (an Ambient pad)
  const pad = { id: 'c', trackId: 't', startBar: 1, lengthBars: 2, notes: [note('chord', 0, '2m')] };
  assert.equal(preRollStart(songOf(pad), 3), 1, 'its release is heard in bar 3');
  assert.equal(restartHeldNotes([pad], 1, 3)[0], pad, 'and it plays as it is: nothing begun again');
  // ...ending a hair before it
  assert.equal(preRollStart(songOf({ ...pad, lengthBars: 1.99 }), 3), 1);
  // Long over (more than the release before the range): no run-in
  assert.equal(RELEASE_ALLOWANCE_SECONDS, 2);
  assert.equal(preRollStart(songOf(pad), 4.01), 4.01, 'two seconds (a bar at 120 BPM) after it ends, it has rung out');
  assert.equal(preRollStart(songOf(pad), 3.99), 1);
  // An instrument whose recordings say how long they ring: a piano's 0.6 s
  const piano = { ...track, instrumentKey: 'piano' };
  assert.equal(releaseSeconds(piano), 0.6);
  assert.equal(releaseSeconds({ ...piano, ring: 3 }), 3, 'as the track sets its ring');
  assert.equal(releaseSeconds(track), RELEASE_ALLOWANCE_SECONDS, 'a synth: the allowance');
  assert.equal(releaseSeconds({ ...track, ring: 0.1 }), RELEASE_ALLOWANCE_SECONDS, '(a ring is a recorded instrument\'s)');
  const pianoSong = { ...songOf(pad), tracks: [piano] };
  assert.equal(preRollStart(pianoSong, 3.25), 1, 'still ringing a quarter of a bar (0.5 s) on');
  assert.equal(preRollStart(pianoSong, 3.5), 3.5, 'over a second on, it has died away');
  // A muted track's notes don't count
  assert.equal(preRollStart({ ...songOf(pad), tracks: [{ ...track, isMuted: true }] }, 3), 3);
});

test('a looped stretch goes round without a click: its end crossfades into what leads into its start', () => {
  const rate = 44100;
  // A held 110 Hz note across the whole render, the stretch starting mid-waveform 0.37 s in
  const sine = new Float32Array(rate).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 110 * i) / rate));
  const trim = Math.round(0.37 * rate);
  const fade = LOOP_FADE_SECONDS * rate;
  assert.ok(LOOP_FADE_SECONDS >= 0.01 && LOOP_FADE_SECONDS <= 0.02);
  const copy = sine.slice();
  const [out] = loopChannels([sine], trim, fade);
  assert.deepEqual(sine, copy, 'the render is left as it was');
  assert.equal(out.length, sine.length - trim);
  // Its start is the render's from the trim on, as it was
  assert.equal(out[0], sine[trim]);
  assert.equal(out[out.length - fade - 1], sine[sine.length - fade - 1]);
  let inside = 0;
  for (let i = 1; i < out.length; i++) inside = Math.max(inside, Math.abs(out[i] - out[i - 1]));
  const wrap = Math.abs(out[0] - out[out.length - 1]);
  // Cut as it was, the wrap jumped (the end isn't where the start is)
  assert.ok(Math.abs(sine[trim] - sine[sine.length - 1]) > 0.1);
  assert.ok(wrap <= inside, `the wrap steps ${wrap}, the music at most ${inside}`);
  // ...and going round, the last frame leads into the first as the song does
  assert.ok(Math.abs(out[out.length - 1] - sine[trim - 1]) < 0.01);
  // No run-in: the end fades out into the silence before the render
  const [alone] = loopChannels([sine], 0, fade);
  assert.equal(alone.length, sine.length);
  assert.ok(Math.abs(alone[alone.length - 1]) < 0.02, String(alone[alone.length - 1]));
  // A stretch shorter than two fades still loops (the fade shortened to fit)
  assert.equal(loopChannels([new Float32Array(100).fill(0.5)], 10, fade)[0].length, 90);
});

test('stretches played one after another (a suggestion that changes several places): each ends into what leads into the next, and A and B switch in the same stretch', async () => {
  const { joinStretches, stretchOf, sequenceOffset } = await import('../src/audio/auditionMath.ts');
  const rate = 44100;
  const fade = LOOP_FADE_SECONDS * rate;
  const tone = (hz, n) => new Float32Array(n).map((_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));
  // Two stretches of different music, each rendered with a run-in
  const one = tone(110, rate);
  const two = tone(330, rate);
  const trim = Math.round(0.3 * rate);
  const parts = [stretchOf([one], trim, fade), stretchOf([two], trim, fade)];
  const { channels, starts } = joinStretches(parts, fade);
  assert.deepEqual(starts, [0, rate - trim]);
  assert.equal(channels[0].length, 2 * (rate - trim));
  // Each stretch begins as rendered; the first one's end leads into the second's run-in, and the second's into the first's
  assert.equal(channels[0][0], one[trim]);
  assert.equal(channels[0][starts[1]], two[trim]);
  assert.ok(Math.abs(channels[0][starts[1] - 1] - two[trim - 1]) < 0.01, 'into the second stretch as the song plays into it');
  assert.ok(Math.abs(channels[0].at(-1) - one[trim - 1]) < 0.01, 'and round into the first');
  let inside = 0;
  for (let i = 1; i < channels[0].length; i++) inside = Math.max(inside, Math.abs(channels[0][i] - channels[0][i - 1]));
  assert.ok(inside < 0.05, `no step bigger than the music's own (${inside})`);
  // One stretch alone: what loopChannels makes
  const [alone] = loopChannels([one], trim, fade);
  assert.deepEqual(joinStretches([stretchOf([one], trim, fade)], fade).channels[0], alone);
  // Switching: the same stretch, the same bar in it, by each side's tempo (B at half A's tempo: twice as long)
  const plays = [{ fromBar: 1, toBar: 3 }, { fromBar: 69, toBar: 71 }];
  const a = { tempo: { bpm: 120, points: [] }, starts: [0, 4], seconds: 8 };
  const b = { tempo: { bpm: 60, points: [] }, starts: [0, 8], seconds: 16 };
  assert.equal(sequenceOffset(1, plays, a, b), 2, 'half a bar into the first stretch');
  assert.equal(sequenceOffset(5, plays, a, b), 10, 'half a bar into the second');
  assert.equal(sequenceOffset(10, plays, b, a), 5);
  assert.equal(sequenceOffset(8 + 5, plays, a, b), 10, 'round again');
});

test('a clip with a held note begun again keeps its place in its run of copies (its pass)', async () => {
  const { clipRuns, passOf } = await import('../src/store/noteChance.ts');
  // Three copies of a 16-bar pad (not linked): a chord held all 16 bars, a fill on every 3rd pass
  const notes = () => [{ id: 'n1', note: 'C4', startOffset: 0, duration: `${16 * 768}i`, velocity: 0.7 }, { id: 'n2', note: 'G5', startOffset: 15, duration: '4n', velocity: 0.7, cond: { n: 1, of: 3 } }];
  const mk = (id, startBar, lengthBars = 16) => ({ id, trackId: 't', name: 'Pad', startBar, lengthBars, notes: notes() });
  const passes = (clips) => {
    const runs = clipRuns(clips);
    return Object.fromEntries(clips.map((c) => [c.id, passOf(runs.get(c.id), 0, null)]));
  };
  const clips = [mk('A', 1), mk('B', 17), mk('C', 33)];
  const whole = passes(clips);
  assert.deepEqual(whole, { A: 0, B: 1, C: 2 });
  // Heard from bar 47 with a run-in from bar 40: C's chord begun again there
  const again = restartHeldNotes(clips, 40, 47);
  assert.notEqual(again, clips);
  assert.deepEqual(passes(again), whole);
  // A note running on past its clip's end, playing on the 3rd pass only: the clip without it and
  // the held-over one's own clip both keep the 3rd pass
  const ring = (id, startBar) => ({ id, trackId: 't', name: 'Pad', startBar, lengthBars: 4, notes: [{ id: 'r', note: 'C4', startOffset: 0, duration: '8m', velocity: 0.7, cond: { n: 3, of: 3 } }] });
  const short = [ring('A', 1), ring('B', 5), ring('C', 9)];
  const over = restartHeldNotes(short, 14, 15);
  const got = passes(over);
  assert.ok(over.some((c) => c.id === 'C~held'));
  assert.deepEqual([got.A, got.B, got.C, got['C~held']], [0, 1, 2, 2]);
});
