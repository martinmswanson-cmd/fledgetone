// Unit tests for warp markers (src/store/warp.ts) and the audio clip maths that follows them. Run with `npm test`.
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
const { beatAt, srcAt, sourceAt, clipSecondsAt, warpPieces, normalizeWarp, quantizeWarp, isWarped } = await import('../src/store/warp.ts');
const { audioSourceSeconds, audioLengthLimit, audioTrimStartLimit, envelopeDbAt, normalizeClipAudio } = await import('../src/store/audioClips.ts');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('without markers the beat grid is the recording tempo, and clips play as before', () => {
  const audio = { soundId: 's', offset: 1, gain: 0, fadeIn: 0, fadeOut: 0, stretchBpm: 100 };
  close(beatAt(audio, 3), 5);
  close(srcAt(audio, 5), 3);
  // At 120 the clip plays 1.2x as fast
  close(sourceAt(audio, 2, 120), 1 + 2.4);
  close(clipSecondsAt(audio, 3.4, 120), 2);
  // Not following the tempo: as recorded
  const plain = { ...audio, stretchBpm: undefined };
  close(sourceAt(plain, 2, 120), 3);
  close(audioSourceSeconds({ lengthBars: 1, audio }, 120), 2 * 1.2);
  assert.equal(isWarped(audio), false);
});

test('markers pin moments of the sound to beats, stretching evenly between them', () => {
  // Recorded at 120 (2 beats a second); the hit at 1.1 s moved onto beat 2
  const audio = { soundId: 's', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, stretchBpm: 120, warp: [{ src: 0, beat: 0 }, { src: 1.1, beat: 2 }, { src: 2, beat: 4 }] };
  assert.ok(isWarped(audio));
  close(beatAt(audio, 1.1), 2);
  close(beatAt(audio, 0.55), 1);
  close(srcAt(audio, 3), 1.1 + 0.45);
  // Past the last marker: the recording's tempo
  close(beatAt(audio, 3), 6);
  // At 120 BPM the clip reaches the hit exactly on beat 2 (1 second in)
  close(sourceAt(audio, 1, 120), 1.1);
  close(clipSecondsAt(audio, 1.1, 120), 1);
  // The clip's limits and lengths follow the markers
  close(audioLengthLimit({ ...audio, offset: 0 }, 2, 120) * 2, 2);
  close(audioTrimStartLimit({ startBar: 3, audio: { ...audio, offset: 1.1 } }, 120), 3 - 0.5);
  const pieces = warpPieces(audio, 0.5, 2.5);
  assert.deepEqual(pieces.map((p) => [p.src0, p.src1]), [[0.5, 1.1], [1.1, 2], [2, 2.5]]);
});

test('markers are tidied: in order, apart, never folding or stretching too far', () => {
  const warp = normalizeWarp([{ src: 1, beat: 2 }, { src: 0, beat: 0 }, { src: 1.001, beat: 2.5 }, { src: 2, beat: 1.5 }, { src: 3, beat: 6 }, { src: 4, beat: 60 }, { src: NaN, beat: 1 }], 120);
  assert.deepEqual(warp, [{ src: 0, beat: 0 }, { src: 1, beat: 2 }, { src: 3, beat: 6 }]);
  const parsed = normalizeClipAudio({ soundId: 's', stretchBpm: 120, warp: [{ src: 0, beat: 0 }, { src: 1, beat: 2 }], envelope: [{ src: 2, db: -6 }, { src: 1, db: 99 }] });
  assert.equal(parsed.warp.length, 2);
  assert.deepEqual(parsed.envelope, [{ src: 1, db: 12 }, { src: 2, db: -6 }]);
});

test('quantize pulls hits onto the song grid', () => {
  // Recorded at 120, placed at bar 1: hits a little late and early of the 8ths (0.25 s apart)
  const audio = { soundId: 's', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, stretchBpm: 120 };
  const onsets = [0.27, 0.49, 0.78, 1.02];
  const warp = quantizeWarp(audio, onsets, { grid: 0.5, strength: 1, from: 0, to: 2, songBeatOf: (b) => b });
  for (const src of onsets) {
    const beat = beatAt({ ...audio, warp }, src);
    close(beat * 2, Math.round(beat * 2), 1e-9);
  }
  // Half strength: half way there
  const half = quantizeWarp(audio, [0.27], { grid: 0.5, strength: 0.5, from: 0, to: 2, songBeatOf: (b) => b });
  close(beatAt({ ...audio, warp: half }, 0.27), 0.54 - 0.02);
});

test('the gain envelope runs in straight lines through its points', () => {
  const pts = [{ src: 1, db: -12 }, { src: 3, db: 0 }];
  assert.equal(envelopeDbAt(undefined, 2), 0);
  assert.equal(envelopeDbAt(pts, 0), -12);
  assert.equal(envelopeDbAt(pts, 2), -6);
  assert.equal(envelopeDbAt(pts, 9), 0);
});
