// Unit tests for keeping recorded instruments small and loading what a song plays first
// (src/audio/samplers/recordingMaths.ts, songSamples.ts), and for choosing which note to let go
// (noteStealing.ts). Run with `npm test`.
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

const { keptLength, isDualMono, foldToMono, levelOutline, TAIL_KEEP, OUTLINE_STEP } = await import('../src/audio/samplers/recordingMaths.ts');
const { indexRecordings, neededSamples, quickSamples, nearestMidi, layerOf, songNotesByInstrument, parseSampleName, decodeRateOf } = await import('../src/audio/samplers/songSamples.ts');
const { chooseNoteToSteal, noteLevelNow, STEAL_GRACE } = await import('../src/audio/samplers/noteStealing.ts');

const SR = 1000;
/** A decaying tone: 1 s loud, then silence for `silence` seconds. */
function decaying(seconds, silence) {
  const out = new Float32Array(Math.round((seconds + silence) * SR));
  for (let i = 0; i < seconds * SR; i++) out[i] = Math.sin(i * 0.3) * Math.exp(-i / (0.2 * SR));
  return out;
}

test('a silent tail is cut a little after the last sample above -90 dB of the peak', () => {
  const x = decaying(1, 3);
  const n = keptLength([x], SR);
  let last = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 10 ** (-90 / 20)) last = i;
  assert.equal(n, last + 1 + Math.round(TAIL_KEEP * SR));
  assert.ok(n < x.length / 2);
});

test('a tail is never cut inside a loop or above the sampler\'s own end of the sound', () => {
  const x = decaying(1, 3);
  assert.equal(keptLength([x], SR, 3.5 * SR), 3.5 * SR);
  // The sampler hears its end at an absolute level: keep everything above that too
  const loud = keptLength([x], SR, 0, 1e-6);
  assert.ok(loud >= keptLength([x], SR));
  // Nothing to cut: the whole length
  const full = new Float32Array(500).fill(0.5);
  assert.equal(keptLength([full], SR), 500);
  // Silent throughout: a sample or the loop's length, never nothing
  assert.equal(keptLength([new Float32Array(100)], SR), 1);
});

test('two channels are one sound only when they match closely in shape and level', () => {
  const l = decaying(1, 0);
  assert.equal(isDualMono(l, Float32Array.from(l)), true);
  // 0.05 dB apart: still the same
  assert.equal(isDualMono(l, l.map((v) => v * 10 ** (0.05 / 20))), true);
  // 0.5 dB apart: a real balance between the sides
  assert.equal(isDualMono(l, l.map((v) => v * 10 ** (0.5 / 20))), false);
  // Different sounds
  const r = l.map((v, i) => v * Math.cos(i * 0.01));
  assert.equal(isDualMono(l, r), false);
  assert.deepEqual([...foldToMono(Float32Array.of(1, 0.5), Float32Array.of(1, 0.3))].map((v) => +v.toFixed(3)), [1, 0.4]);
});

test('a level outline follows the recording', () => {
  const x = decaying(1, 1);
  const o = levelOutline([x], SR);
  assert.equal(o.length, Math.ceil(x.length / (OUTLINE_STEP * SR)));
  assert.ok(o[0] > o[5] && o[5] > o[10]);
  assert.equal(o[o.length - 1], 0);
});

// A two-loudness set with two takes: notes C4 (60), E4 (64), G#4 (68), C5 (72); releases at C4 and C5
const midiOf = (n) => ({ C4: 60, E4: 64, 'G#4': 68, C5: 72, C3: 48, D4: 62, B4: 71 })[n];
const names = [];
for (const n of ['C4', 'E4', 'G#4', 'C5']) for (const l of [0, 1]) for (const t of [0, 1]) names.push(`${n}|${l}|${t}`);
names.push('rel|C4|0', 'rel|C5|0');
const index = indexRecordings(names, midiOf, [0.55, 1]);

test('the nearest recording is the one the sampler would pick (the higher on a tie)', () => {
  assert.equal(nearestMidi([60, 64, 68, 72], 62), 64);
  assert.equal(nearestMidi([60, 64, 68, 72], 61), 60);
  assert.equal(nearestMidi([60, 64, 68, 72], 60), 60);
  assert.equal(nearestMidi([60, 64, 68, 72], 90), 72);
  assert.equal(nearestMidi([60], 200), undefined);
  assert.equal(layerOf([0.55, 1], 0.55), 0);
  assert.equal(layerOf([0.55, 1], 0.56), 1);
  assert.deepEqual(parseSampleName('rel|C4|1'), { note: 'C4', layer: 0, take: 1, release: true });
});

test('a song needs the nearest recording at the loudnesses its velocities reach, with every take', () => {
  // A soft C4: only the soft loudness, both takes, and its release sound
  const soft = neededSamples(index, [{ midi: 60, velocity: 0.2, loudest: 0.2 }]);
  assert.deepEqual([...soft].sort(), ['C4|0|0', 'C4|0|1', 'rel|C4|0']);
  // Near the boundary: both loudnesses (they're blended there)
  const edge = neededSamples(index, [{ midi: 60, velocity: 0.5, loudest: 0.5 }]);
  assert.ok(edge.has('C4|0|0') && edge.has('C4|1|1'));
  // A soft note in a loud chord plays at the chord's loudest
  const chord = neededSamples(index, [{ midi: 60, velocity: 0.2, loudest: 0.9 }]);
  assert.ok(chord.has('C4|1|0'));
  // Between recordings: the nearest, and the other side's within stretching distance
  const d4 = neededSamples(index, [{ midi: 62, velocity: 0.2, loudest: 0.2 }]);
  assert.ok(d4.has('E4|0|0') && d4.has('C4|0|0'));
  // The Human insert moves velocity: a soft note may play louder
  assert.ok(!neededSamples(index, [{ midi: 60, velocity: 0.4, loudest: 0.4 }]).has('C4|1|0'));
  assert.ok(neededSamples(index, [{ midi: 60, velocity: 0.4, loudest: 0.4, drift: 0.3 }]).has('C4|1|0'));
  // The mod wheel plays the loudness at its value and the next louder
  const wheel = neededSamples(index, [{ midi: 60, velocity: 0.2, loudest: 0.2 }], [0.2, 0.3]);
  assert.ok(wheel.has('C4|1|0'));
  // Far below every recording: its own and the first-loaded loudness's nearest
  const low = neededSamples(index, [{ midi: 48, velocity: 0.2, loudest: 0.2 }]);
  assert.ok(low.has('C4|0|0') && low.has(`C4|${index.quick}|0`));
  // Far fewer than the whole set
  assert.ok(soft.size < names.length / 4);
});

test('with nothing known of the song, one loudness of every note loads first', () => {
  assert.deepEqual([...quickSamples(index)].sort(), ['C4|1|0', 'C5|1|0', 'E4|1|0', 'G#4|1|0']);
});

test('a song\'s notes are gathered by instrument, chords at their loudest, takes and the mod wheel included', () => {
  const human = (on) => ({ human: { on, timing: 0.5, dynamics: 0.5, pitch: 0.5 } });
  const tracks = [{ id: 'a', instrumentKey: 'piano', fx: human(false) }, { id: 'b', instrumentKey: 'piano', fx: human(true) }, { id: 'c', instrumentKey: 'strings' }];
  const clips = [
    { trackId: 'a', notes: [{ note: 'C4', startOffset: 0, velocity: 0.3 }, { note: 'E4', startOffset: 0, velocity: 0.9 }, { note: 'C5', startOffset: 0.25, velocity: 0.5 }] },
    { trackId: 'b', notes: [], takes: [{ id: 't', name: 'Take', notes: [{ note: 'D4', startOffset: 0, velocity: 0.7 }] }] },
    { trackId: 'c', notes: [{ note: 'B4', startOffset: 0, velocity: 0.4 }], expression: { mod: [{ at: 0, value: 0.5 }, { at: 1, value: 0.2 }] } },
  ];
  const songs = songNotesByInstrument(tracks, clips, midiOf);
  assert.deepEqual(songs.get('piano'), {
    wheel: null,
    notes: [
      { midi: 60, velocity: 0.3, loudest: 0.9, drift: 0 },
      { midi: 64, velocity: 0.9, loudest: 0.9, drift: 0 },
      { midi: 72, velocity: 0.5, loudest: 0.5, drift: 0 },
      { midi: 62, velocity: 0.7, loudest: 0.7, drift: 0.15 },
    ],
  });
  assert.deepEqual(songs.get('strings').wheel, [0.2, 0.5]);
});

test('a note\'s level now follows its recording\'s outline and falls through its release', () => {
  const outline = Float32Array.of(1, 0.5, 0.25, 0.125);
  const base = { gain: 0.8, outline, releasedAt: Infinity, releaseTc: 0.1 };
  assert.equal(noteLevelNow({ ...base, position: 0 }, 0), 0.8);
  assert.equal(noteLevelNow({ ...base, position: 2.5 * OUTLINE_STEP }, 0), 0.8 * 0.25);
  // Past the end of the recording: silent
  assert.equal(noteLevelNow({ ...base, position: 10 }, 0), 0);
  // A held note looping its steady stretch stays at the loop's level
  assert.equal(noteLevelNow({ ...base, position: 10, loop: [OUTLINE_STEP, 2 * OUTLINE_STEP] }, 0), 0.8 * 0.5);
  // Released 0.1 s ago (one time constant)
  assert.ok(Math.abs(noteLevelNow({ ...base, position: 0, releasedAt: 0.9 }, 1) - 0.8 * Math.exp(-1)) < 1e-9);
  // No outline: as loud as it started
  assert.equal(noteLevelNow({ gain: 0.5, position: 3, releasedAt: Infinity, releaseTc: 0.1 }, 0), 0.5);
});

test('the quietest note is let go, not the oldest', () => {
  const now = 10;
  const notes = [
    { start: 1, level: 0.5, held: true }, // the oldest, still loud
    { start: 5, level: 0.01, held: true }, // faded almost away
    { start: 8, level: 0.2, held: true },
  ];
  assert.equal(chooseNoteToSteal(notes, now), 1);
});

test('a note already let go goes before a held one, unless the held one is much quieter', () => {
  const now = 10;
  assert.equal(chooseNoteToSteal([{ start: 1, level: 0.1, held: true }, { start: 5, level: 0.2, held: false }], now), 1);
  assert.equal(chooseNoteToSteal([{ start: 1, level: 0.01, held: true }, { start: 5, level: 0.2, held: false }], now), 0);
});

test('a note in its first moments is only let go when every note is that young', () => {
  const now = 10;
  const young = now - STEAL_GRACE / 2;
  assert.equal(chooseNoteToSteal([{ start: young, level: 0, held: false }, { start: 1, level: 0.9, held: true }], now), 1);
  assert.equal(chooseNoteToSteal([{ start: young, level: 0.5, held: true }, { start: young, level: 0.1, held: true }], now), 1);
  // Ties go to the oldest; nothing to choose from: none
  assert.equal(chooseNoteToSteal([{ start: 3, level: 0.2, held: true }, { start: 2, level: 0.2, held: true }], now), 1);
  assert.equal(chooseNoteToSteal([], now), -1);
});

test('the brightest sets decode at twice the rate: a whole set, or a kit\'s rows; never the release sounds', () => {
  assert.equal(decodeRateOf(undefined, 'C4|0|0', 48000), 48000);
  assert.equal(decodeRateOf(true, 'C4|0|0', 48000), 96000);
  assert.equal(decodeRateOf(true, 'rel|C4|0', 44100), 44100);
  assert.equal(decodeRateOf(['F#1', 'C#2'], 'F#1|3|1', 44100), 88200);
  assert.equal(decodeRateOf(['F#1', 'C#2'], 'C1|3|1', 44100), 44100);
});
