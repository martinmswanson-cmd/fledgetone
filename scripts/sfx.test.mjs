// Unit tests for the sound effects maker and key detection (src/audio/sfx/sfxSynth.ts, src/store/songKey.ts). Run with `npm test`.
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

const { generateSfx, renderSfx, sfxLength, sfxWav, snapToScale, mutateSfx, SFX_CATEGORIES } = await import('../src/audio/sfx/sfxSynth.ts');
const { detectKey } = await import('../src/store/songKey.ts');

const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('every category renders a sound of the right length, at the volume, without clicks at the ends', () => {
  for (const c of SFX_CATEGORIES) {
    for (const seed of [1, 2, 3]) {
      const p = generateSfx(c, seed);
      const x = renderSfx(p, 44100);
      assert.equal(x.length, Math.round(sfxLength(p) * 44100), c);
      assert.ok(Math.abs(peakOf(x) - 0.89 * p.volume) < 1e-6, `${c} peak`);
      assert.ok(Math.abs(x[0]) < 1e-9 && Math.abs(x[x.length - 1]) < 1e-9, `${c} ends`);
      assert.ok(x.every(Number.isFinite));
    }
  }
});

test('the same seed makes the same sound; a new seed a different one', () => {
  assert.deepEqual(renderSfx(generateSfx('explosion', 9)), renderSfx(generateSfx('explosion', 9)));
  assert.notDeepEqual(generateSfx('coin', 1), generateSfx('coin', 2));
  const m = mutateSfx(generateSfx('laser', 4), 5);
  assert.equal(m.wave, generateSfx('laser', 4).wave);
});

test('a WAV file of the sound', () => {
  const x = renderSfx(generateSfx('blip', 3));
  const wav = sfxWav(x, 44100);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(wav.length, 44 + x.length * 2);
});

test('snapping to a scale', () => {
  // 450 Hz is nearest A4 (440); in C major A is in the scale
  assert.ok(Math.abs(snapToScale(450, 0, [0, 2, 4, 5, 7, 9, 11]) - 440) < 1e-9);
  // 466 Hz (A#4) is not in C major: A4 or B4
  const s = snapToScale(466.16, 0, [0, 2, 4, 5, 7, 9, 11]);
  assert.ok(Math.abs(s - 440) < 1e-6 || Math.abs(s - 493.88) < 0.01);
});

test('key detection from notes', () => {
  const tracks = [{ id: 't', instrumentKey: 'piano' }, { id: 'd', instrumentKey: 'drums' }];
  const notes = (names) => names.map((note, i) => ({ id: 'n' + i, note, startOffset: i * 0.25, duration: '4n', velocity: 0.8 }));
  const clip = (trackId, names) => ({ id: 'c' + trackId, trackId, name: 'c', startBar: 1, lengthBars: 4, isSelected: false, notes: notes(names) });
  // A minor: A C E, D F A, E G# B, A C E
  const am = detectKey([clip('t', ['A2', 'C4', 'E4', 'A4', 'D3', 'F4', 'A4', 'E3', 'G#4', 'B4', 'A2', 'C4', 'E4', 'A3']), clip('d', ['C1', 'C1', 'C1'])], tracks);
  assert.equal(am.name, 'A minor');
  const g = detectKey([clip('t', ['G2', 'B3', 'D4', 'G4', 'C3', 'E4', 'G4', 'D3', 'F#4', 'A4', 'G2', 'B3', 'D4'])], tracks);
  assert.equal(g.name, 'G major');
  assert.equal(detectKey([clip('d', ['C1'])], tracks), null);
});
