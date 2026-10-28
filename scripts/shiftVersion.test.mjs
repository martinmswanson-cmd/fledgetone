// Unit tests for keeping key-moved clips up to date (src/store/shiftVersion.ts) and the version it
// adds to a clip's audio, read back from a project file. Run with `npm test`.
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
const { SHIFT_VERSION, shiftIsStale, staleShifts } = await import('../src/store/shiftVersion.ts');
const { normalizeClipAudio } = await import('../src/store/audioClips.ts');

const base = { soundId: 's2', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 };

test('a clip moved into a key before the current re-pitch is found, with its original and shift', () => {
  const clips = [
    { id: 'a', audio: { ...base, shiftedFrom: 's1', shift: 3 } },
    { id: 'b', audio: { ...base, shiftedFrom: 's1', shift: -2, shiftVersion: SHIFT_VERSION } },
    { id: 'c', audio: { ...base } },
    { id: 'd' },
  ];
  assert.deepEqual(staleShifts(clips), [{ clipId: 'a', soundId: 's2', from: 's1', shift: 3 }]);
  assert.equal(shiftIsStale({ ...base, shiftedFrom: 's1', shift: 0 }), false);
  assert.ok(SHIFT_VERSION >= 2);
});

test('the version is kept with the clip (and dropped without a shift)', () => {
  assert.equal(normalizeClipAudio({ ...base, shiftedFrom: 's1', shift: 3, shiftVersion: 2 }).shiftVersion, 2);
  assert.equal('shiftVersion' in normalizeClipAudio({ ...base, shiftedFrom: 's1', shift: 3 }), false);
  assert.equal('shiftVersion' in normalizeClipAudio({ ...base, shiftVersion: 2 }), false);
});
