// Unit tests for audio clips and the Slicer: the clip envelope (src/audio/clipEnvelope.ts), waveform
// peaks and paths (src/audio/waveform.ts), slicing (src/audio/slicing.ts) and the clip / settings
// maths and parsing (src/store/audioClips.ts). Run with `npm test`.
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
const { DECLICK_SECONDS, dbToGain, envelopeAt, envelopeFrom, envelopeShape } = await import('../src/audio/clipEnvelope.ts');
const { createPeaks, fillPeaks, waveformPath } = await import('../src/audio/waveform.ts');
const { ENVELOPE_HOP, envelopeOf, equalSlices, midiOf, sliceEnd, sliceIndexOf, sliceKey, sliceNotes, transientSlices } = await import('../src/audio/slicing.ts');
const {
  audioClipSeconds,
  audioLengthLimit,
  audioTrimStartLimit,
  clipNameFromFile,
  normalizeClipAudio,
  normalizeSlicer,
  normalizeSlices,
  parseEmbeddedSounds,
  referencedSoundIds,
  retimeAudioClips,
  secondsPerBar,
  splitAudio,
  trimAudioStart,
} = await import('../src/store/audioClips.ts');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

// ---------- clip envelope ----------

test('an envelope has fades no longer than half the clip, at the clip gain; no fade is a hard edge', () => {
  const shape = envelopeShape(-6, 4, 0, 1);
  near(shape.level, dbToGain(-6));
  near(shape.level, 0.5011872336);
  assert.equal(shape.fadeIn, 0);
  assert.equal(shape.fadeOut, 1);
  assert.deepEqual(envelopeShape(0, 1, 5, 5), { level: 1, seconds: 1, fadeIn: 0.5, fadeOut: 0.5 });
  assert.deepEqual(envelopeShape(0, 1, -2, 0.1), { level: 1, seconds: 1, fadeIn: 0, fadeOut: 0.1 });
  // Outside the clip there's nothing; a hard start is at full level at once; inside a fade, a straight line
  assert.equal(envelopeAt(shape, -1), 0);
  near(envelopeAt(shape, 0), shape.level);
  near(envelopeAt(shape, 2), shape.level);
  near(envelopeAt(shape, 3.5), shape.level * 0.5);
  assert.equal(envelopeAt(shape, 4), 0);
  assert.equal(envelopeAt(shape, 5), 0);
  const soft = envelopeShape(0, 4, 1, 0);
  assert.equal(envelopeAt(soft, 0), 0);
  near(envelopeAt(soft, 0.25), 0.25);
  near(envelopeAt(soft, 3.999), 1);
});

test('the envelope from the clip start is its corners; from inside, a declick rise then the corners ahead', () => {
  const shape = envelopeShape(0, 2, 0.25, 0.5);
  assert.deepEqual(envelopeFrom(shape, 0), [
    [0, 0],
    [0.25, 1],
    [1.5, 1],
    [2, 0],
  ]);
  // Seeking into the fade-in: silence, the declick, then the rest of the fade-in's straight line
  const inside = envelopeFrom(shape, 0.1);
  assert.deepEqual(inside.map(([t]) => t), [0.1, 0.1 + DECLICK_SECONDS, 0.25, 1.5, 2]);
  assert.equal(inside[0][1], 0);
  near(inside[1][1], (0.1 + DECLICK_SECONDS) / 0.25);
  // Past the fades' corners only the end is left; after the end, nothing
  assert.deepEqual(envelopeFrom(shape, 1.9).map(([t]) => t), [1.9, 1.9 + DECLICK_SECONDS, 2]);
  assert.deepEqual(envelopeFrom(shape, 2), []);
  assert.deepEqual(envelopeFrom(shape, 3), []);
  // Without the declick (an envelope re-applied mid-clip) the first point is the envelope's own value
  assert.deepEqual(envelopeFrom(shape, 1, false), [
    [1, 1],
    [1.5, 1],
    [2, 0],
  ]);
  // Hard edges: full level from the first sample, held to the end (where the source just stops)
  assert.deepEqual(envelopeFrom(envelopeShape(0, 1, 0, 0), 0), [
    [0, 1],
    [1, 1],
  ]);
  // ...but a start inside such a clip still rises over the declick
  assert.deepEqual(envelopeFrom(envelopeShape(0, 1, 0, 0), 0.5).map(([t, v]) => [+t.toFixed(3), v]), [
    [0.5, 0],
    [0.502, 1],
    [1, 1],
  ]);
  // A hard start with a fade out
  assert.deepEqual(envelopeFrom(envelopeShape(0, 1, 0, 0.25), 0), [
    [0, 1],
    [0.75, 1],
    [1, 0],
  ]);
});

// ---------- waveform peaks ----------

test('peaks hold the lowest and highest sample of each column, and a path outlines them', () => {
  const sampleRate = 1000;
  const seconds = 1;
  const data = new Float32Array(sampleRate * seconds);
  for (let i = 0; i < data.length; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * 50 * i) / sampleRate);
  // 50 columns a second: each covers one cycle of the 50 Hz sine
  const peaks = createPeaks(seconds, 50);
  assert.equal(peaks.min.length, 50);
  fillPeaks(peaks, [data], sampleRate, 0, 25);
  // Only the first half is filled so far
  near(peaks.max[0], 0.5, 1e-3);
  near(peaks.min[0], -0.5, 1e-3);
  assert.equal(peaks.max[30], 0);
  fillPeaks(peaks, [data], sampleRate, 25, 50);
  near(peaks.max[49], 0.5, 1e-3);
  // The loudest channel sets a column's extremes
  const quiet = new Float32Array(data.length).fill(0.1);
  const both = createPeaks(seconds, 50);
  fillPeaks(both, [quiet, data], sampleRate, 0, 50);
  near(both.min[0], -0.5, 1e-3);

  const d = waveformPath(peaks, 0, 1, 200, 40);
  assert.ok(d.startsWith('M0 '));
  assert.ok(d.endsWith('z'));
  // One top point per column, then the bottom edge back: 200 'L's each way, and the two closing ones
  assert.equal((d.match(/L/g) ?? []).length, 2 * 200 + 1);
  // Peaks of 0.5 reach a quarter of the way in from the top (10) and bottom (30); at twice the gain, the edges
  assert.ok(d.includes(' 10.0'));
  assert.ok(d.includes(' 30.0'));
  const loud = waveformPath(peaks, 0, 1, 200, 40, 2);
  assert.ok(loud.includes(' 0.0'));
  assert.ok(loud.includes(' 40.0'));
  // Silence still draws a line a pixel tall; a stretch past the end of the sound is flat
  const silent = createPeaks(1, 100);
  assert.ok(waveformPath(silent, 0, 1, 10, 40).includes('19.5'));
  assert.ok(waveformPath(peaks, 5, 6, 10, 40).includes('19.5'));
  // Columns are capped, so a very wide clip doesn't make a megabyte of path
  assert.ok(waveformPath(peaks, 0, 1, 100000, 40).length < 300000);
});

// ---------- slicing ----------

test('equal slices divide the stretch; the key map runs up from C3', () => {
  assert.deepEqual(equalSlices(0, 2, 4), [0, 0.5, 1, 1.5]);
  assert.deepEqual(equalSlices(1, 3, 1), [1]);
  assert.equal(equalSlices(0, 10, 1000).length, 64);
  assert.equal(sliceEnd([0, 0.5, 1.5], 0, 2), 0.5);
  assert.equal(sliceEnd([0, 0.5, 1.5], 2, 2), 2);
  assert.equal(midiOf('C3'), 48);
  assert.equal(midiOf('Bb2'), 46);
  assert.equal(midiOf('c#4'), 61);
  assert.ok(Number.isNaN(midiOf('kick')));
  assert.equal(sliceKey(0), 'C3');
  assert.equal(sliceKey(1), 'C#3');
  assert.equal(sliceKey(13), 'C#4');
  assert.equal(sliceIndexOf('D3', 3), 2);
  assert.equal(sliceIndexOf('D#3', 3), -1);
  assert.equal(sliceIndexOf('B2', 3), -1);
});

test('auto slicing cuts at transients: where the energy jumps, not in the decay or the noise', () => {
  const sampleRate = 8000;
  const seconds = 3;
  const data = new Float32Array(sampleRate * seconds);
  const hits = [0, 0.6, 1.25, 2.2];
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    let v = 0.002 * Math.sin(2 * Math.PI * 100 * t); // a faint hum
    for (const h of hits) {
      const dt = t - h;
      if (dt >= 0) v += 0.8 * Math.exp(-dt * 12) * Math.sin(2 * Math.PI * 440 * dt);
    }
    data[i] = v;
  }
  const env = envelopeOf([data], sampleRate);
  assert.equal(env.length, Math.ceil(data.length / Math.round(ENVELOPE_HOP * sampleRate)));
  const slices = transientSlices(env, ENVELOPE_HOP, 0, seconds);
  assert.equal(slices.length, hits.length, `found ${slices.join(', ')}`);
  // The first slice is the start; the others sit at (or a hair before) the hits, so the attack is kept
  assert.equal(slices[0], 0);
  slices.slice(1).forEach((at, i) => {
    assert.ok(at <= hits[i + 1] + 1e-9 && at > hits[i + 1] - 0.012, `slice at ${at} for the hit at ${hits[i + 1]}`);
  });
  // Only the stretch asked for is cut, and a hit at its start isn't a cut of its own
  assert.deepEqual(transientSlices(env, ENVELOPE_HOP, 1.25, 3).length, 2);
  // Two hits closer than the shortest slice count as one; silence has no transients
  const double = new Float32Array(env.length);
  double[200] = 1;
  double[210] = 1;
  assert.deepEqual(transientSlices(double, ENVELOPE_HOP, 0, 1), [0, 0.4]);
  assert.deepEqual(transientSlices(new Float32Array(500), ENVELOPE_HOP, 0, 1), [0]);
});

test('"Chop to Slicer" notes play the slices in order, each as long as its slice, at the tempo', () => {
  const notes = sliceNotes([0, 0.5, 1.5], 0, 2, 120);
  assert.deepEqual(
    notes.map((n) => [n.note, n.startOffset, n.duration]),
    [
      ['C3', 0, '4n'],
      ['C#3', 0.25, '2n'],
      ['D3', 0.75, '4n'],
    ]
  );
  // The stretch starts at the clip's offset into the sound
  assert.deepEqual(sliceNotes([3, 3.5], 3, 4, 60).map((n) => n.startOffset), [0, 0.125]);
});

// ---------- clip maths ----------

test('audio clips keep their length in seconds across a tempo change; note clips keep their bars', () => {
  const audio = { soundId: 'a', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 };
  const clips = [
    { id: 'n', trackId: 't', name: 'n', startBar: 1, lengthBars: 2, notes: [], isSelected: false },
    { id: 'a', trackId: 't', name: 'a', startBar: 3, lengthBars: 2, notes: [], isSelected: false, audio },
  ];
  const faster = retimeAudioClips(clips, 120, 240);
  assert.equal(faster[0], clips[0]);
  assert.equal(faster[1].lengthBars, 4);
  assert.equal(faster[1].startBar, 3);
  assert.equal(faster[1].audio, audio);
  // Nothing to do: the same array comes back
  assert.equal(retimeAudioClips(clips, 120, 120), clips);
  const only = [clips[0]];
  assert.equal(retimeAudioClips(only, 120, 90), only);
  near(audioClipSeconds({ lengthBars: 2 }, 120), 4);
  near(secondsPerBar(60), 4);
});

test('cuts and trims move the offset into the sound; the left edge stops at the sound start, the right at its end', () => {
  const audio = { soundId: 'a', offset: 1, gain: 0, fadeIn: 0, fadeOut: 0 };
  assert.deepEqual(splitAudio(audio, 2.5), { ...audio, offset: 3.5 });
  assert.deepEqual(trimAudioStart(audio, 0.5), { ...audio, offset: 1.5 });
  assert.deepEqual(trimAudioStart(audio, -0.25), { ...audio, offset: 0.75 });
  assert.deepEqual(trimAudioStart(audio, -5), { ...audio, offset: 0 });
  // At 120 BPM (2 s a bar) a clip at bar 5 playing from 1 s in can go back to bar 4.5
  near(audioTrimStartLimit({ startBar: 5, audio }, 120), 4.5);
  assert.equal(audioTrimStartLimit({ startBar: 5 }, 120), 1);
  // A 5 s sound played from 1 s in lasts 4 s: 2 bars at 120 BPM; unknown length, no limit
  near(audioLengthLimit(audio, 5, 120), 2);
  assert.equal(audioLengthLimit(audio, undefined, 120), Infinity);
  assert.equal(audioLengthLimit({ ...audio, offset: 9 }, 5, 120), 0);
});

test('a project refers to each sound once, whichever tracks and clips use it', () => {
  const ids = referencedSoundIds({
    clips: [{ audio: { soundId: 'x' } }, { audio: { soundId: 'y' } }, { audio: { soundId: 'x' } }, {}],
    tracks: [{ sample: { soundId: 'x' } }, { sample: { dataUrl: 'data:' } }, { slicer: { soundId: 'z' } }, {}],
  });
  assert.deepEqual(ids, ['x', 'y', 'z']);
  // A clip launcher slot's audio counts too (saved in the file, never freed as unused)
  const slots = [{ scene: 0, clip: { name: 'Loop', lengthBars: 1, notes: [], audio: { soundId: 'w', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, reversedFrom: 'v' } } }, { scene: 1, clip: { name: 'Notes', lengthBars: 1, notes: [] } }];
  assert.deepEqual(referencedSoundIds({ clips: [], tracks: [{ slots }] }), ['w', 'v']);
  assert.equal(clipNameFromFile('take 3.wav'), 'take 3');
  assert.equal(clipNameFromFile('Vocal.Chop.FLAC'), 'Vocal.Chop');
  assert.equal(clipNameFromFile('  '), 'Audio');
});

test('clip audio and Slicer settings from a file are tidied, with safe defaults', () => {
  assert.equal(normalizeClipAudio(undefined), undefined);
  assert.equal(normalizeClipAudio({ offset: 1 }), undefined);
  assert.deepEqual(normalizeClipAudio({ soundId: 'a' }), { soundId: 'a', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 });
  assert.deepEqual(normalizeClipAudio({ soundId: 'a', offset: -3, gain: 99, fadeIn: -1, fadeOut: 1e9 }), { soundId: 'a', offset: 0, gain: 24, fadeIn: 0, fadeOut: 30 });
  assert.deepEqual(normalizeClipAudio({ soundId: 'a', gain: 'loud', fadeIn: NaN }), { soundId: 'a', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 });

  assert.deepEqual(normalizeSlices([2, 0.5, 0.5, -1, 1.5, 'x', 9], 0, 2), [0, 0.5, 1.5]);
  assert.deepEqual(normalizeSlices(undefined, 1, 2), [1]);
  assert.equal(normalizeSlices(Array.from({ length: 100 }, (_, i) => 1 + i * 0.01), 0, 3).length, 64);

  assert.equal(normalizeSlicer({}), undefined);
  const s = normalizeSlicer({ soundId: 'v', slices: [0.2, 0.4], end: 1 });
  assert.deepEqual(s, { soundId: 'v', name: 'Sound', start: 0, end: 1, slices: [0, 0.2, 0.4], mode: 'auto', count: 8, sensitivity: 0.5, pitch: false, focus: 0 });
  const t = normalizeSlicer({ soundId: 'v', name: 'v.wav', start: 2, end: 1, mode: 'equal', count: 7, sensitivity: 3, pitch: true, focus: 40 });
  assert.equal(t.end, 3);
  assert.equal(t.count, 8);
  assert.equal(t.sensitivity, 1);
  assert.equal(t.pitch, true);
  assert.equal(t.focus, 0);
  assert.equal(normalizeSlicer({ soundId: 'v', end: 2, slices: [1, 1.5], focus: 7 }).focus, 2);

  assert.deepEqual(parseEmbeddedSounds(undefined), []);
  assert.deepEqual(parseEmbeddedSounds([{ id: 'a', data: 'AAAA' }, { id: '', data: 'x' }, { id: 'b' }, 'junk']), [
    { id: 'a', name: 'Sound', type: 'application/octet-stream', size: 0, seconds: 0, data: 'AAAA' },
  ]);
});

test('overlapping audio clips crossfade: the earlier fades out, the later fades in, across the overlap', async () => {
  const { crossfades } = await import('../src/store/audioClips.ts');
  const audio = { soundId: 's', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 };
  const clip = (id, trackId, startBar, lengthBars) => ({ id, trackId, startBar, lengthBars, audio });
  // 120 BPM: a bar is 2 s. A ends at bar 3, B starts at 2.5: half a bar (1 s) of overlap
  const x = crossfades([clip('a', 't', 1, 2), clip('b', 't', 2.5, 2)], 120);
  assert.deepEqual(x.get('a'), { in: 0, out: 1 });
  assert.deepEqual(x.get('b'), { in: 1, out: 0 });
  // Touching clips, other tracks and note clips don't crossfade
  assert.equal(crossfades([clip('a', 't', 1, 2), clip('b', 't', 3, 2)], 120).size, 0);
  assert.equal(crossfades([clip('a', 't', 1, 2), clip('b', 'u', 2, 2)], 120).size, 0);
  assert.equal(crossfades([clip('a', 't', 1, 2), { ...clip('b', 't', 2, 2), audio: undefined }], 120).size, 0);
  // A clip wholly inside another is a layer: no crossfade
  assert.equal(crossfades([clip('a', 't', 1, 4), clip('b', 't', 2, 1)], 120).size, 0);
  // A chain: the middle clip crossfades on both sides
  const chain = crossfades([clip('a', 't', 1, 2), clip('b', 't', 2.75, 2), clip('c', 't', 4.5, 1)], 120);
  assert.deepEqual(chain.get('b'), { in: 0.5, out: 0.5 });
});

test('a crossfade is equal power: the two curves keep the level through the overlap', () => {
  const out = envelopeShape(0, 4, 0, 1, { out: true });
  const into = envelopeShape(0, 4, 1, 0, { in: true });
  assert.equal(out.curveOut, true);
  assert.equal(into.curveIn, true);
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const a = envelopeAt(out, 3 + r);
    const b = envelopeAt(into, r);
    assert.ok(Math.abs(a * a + b * b - 1) < 1e-6, `power at ${r}: ${a * a + b * b}`);
  }
  // Midway each is at -3 dB, not -6 dB as a straight line would be
  assert.ok(Math.abs(envelopeAt(into, 0.5) - Math.SQRT1_2) < 1e-9);
  // The points follow the curve: 16 steps across the fade, each on it
  const points = envelopeFrom(into, 0);
  assert.equal(points.length, 18);
  for (const [t, g] of points) assert.ok(Math.abs(g - envelopeAt(into, t)) < 1e-9 || t >= 4);
  // No curve without a fade
  assert.equal(envelopeShape(0, 4, 0, 0, { in: true, out: true }).curveIn, undefined);
});

test('a clip that follows the tempo keeps its bars and plays its sound faster or slower', async () => {
  const { stretchRatio, retimeAudioClips, audioSourceSeconds, audioLengthLimit, audioTrimStartLimit, loopTempos, normalizeClipAudio } = await import('../src/store/audioClips.ts');
  const plain = { soundId: 's', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 };
  const loop = { ...plain, stretchBpm: 100 };
  assert.equal(stretchRatio(plain, 120), 1);
  assert.equal(stretchRatio(loop, 120), 1.2);
  const clips = [
    { id: 'a', trackId: 't', startBar: 1, lengthBars: 4, audio: plain, notes: [] },
    { id: 'b', trackId: 't', startBar: 5, lengthBars: 4, audio: loop, notes: [] },
  ];
  const after = retimeAudioClips(clips, 100, 120);
  assert.equal(after[0].lengthBars, 4.8); // as recorded: keeps its seconds
  assert.equal(after[1].lengthBars, 4); // follows: keeps its bars
  assert.equal(retimeAudioClips([clips[1]], 100, 120)[0], clips[1]);
  // 4 bars at 120 is 8 s of song, 9.6 s of a recording made at 100
  assert.ok(Math.abs(audioSourceSeconds(clips[1], 120) - 9.6) < 1e-9);
  // A 9.6 s sound fills exactly 4 bars at 120 when it follows the tempo
  assert.ok(Math.abs(audioLengthLimit(loop, 9.6, 120) - 4) < 1e-9);
  assert.ok(Math.abs(audioTrimStartLimit({ startBar: 3, audio: { ...loop, offset: 2.4 } }, 120) - 2) < 1e-9);
  // A 9.6 s loop is 4 bars at 100 (or 2 at 50, 8 at 200)
  assert.equal(loopTempos(9.6, 100)[0], 100);
  assert.ok(loopTempos(9.6, 190).includes(200));
  // Saved and opened
  assert.equal(normalizeClipAudio({ ...plain, stretchBpm: 100 }).stretchBpm, 100);
  assert.equal(normalizeClipAudio({ ...plain, stretchBpm: 9999 }).stretchBpm, 400);
  assert.equal('stretchBpm' in normalizeClipAudio(plain), false);
});
