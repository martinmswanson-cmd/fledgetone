// Unit tests for Chop my voice (src/audio/voiceChops.ts), on a synthesised sung voice and plain
// tones. Run with `npm test`.
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
const { findSyllables, layoutChops, tuneChop, chopGain, frameLevels, MAX_CHOPS, REACH, MAX_MOVE } = await import('../src/audio/voiceChops.ts');
const { detectPitch, hzToMidi, midiToHz } = await import('../src/audio/vocalTune.ts');
const { barOfSource } = await import('../src/store/audioClips.ts');
const { testVoice } = await import('./audio-check/testVoice.mjs');

const SR = 44100;

/** Sung notes with harmonics, `gap` seconds of silence between, each `cents` off its note. */
function tones(notes, { length = 0.3, gap = 0.12, cents = 0 } = {}) {
  const n = Math.round((notes.length * (length + gap) + gap) * SR);
  const x = new Float32Array(n);
  notes.forEach((m, k) => {
    const hz = midiToHz(m + cents / 100);
    const a = Math.round((gap + k * (length + gap)) * SR);
    const len = Math.round(length * SR);
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / 400, (len - i) / 400);
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin((2 * Math.PI * hz * h * i) / SR) / h;
      x[a + i] = 0.25 * env * v;
    }
  });
  return x;
}

/** The pitch of a sound where it's loud, MIDI. */
function pitchOf(y) {
  const ps = detectPitch(y, SR).filter((f) => f.hz > 0).map((f) => hzToMidi(f.hz)).sort((a, b) => a - b);
  return ps[Math.floor(ps.length / 2)];
}

test('separate sung notes are found as one syllable each, with their notes', () => {
  const notes = [57, 60, 64, 62, 67];
  const syl = findSyllables(tones(notes, { cents: 30 }), SR);
  assert.equal(syl.length, notes.length);
  syl.forEach((s, i) => {
    assert.ok(Math.abs(s.midi - (notes[i] + 0.3)) < 0.25, `syllable ${i}: ${s.midi}`);
    assert.ok(s.end - s.start > 0.2 && s.end - s.start < 0.4);
  });
});

test('a tune sung on one breath is cut where the note changes', () => {
  // Two notes with no gap between them
  const x = tones([60], { length: 0.4, gap: 0.1 });
  const y = tones([65], { length: 0.4, gap: 0 });
  const joined = new Float32Array(x.length + y.length);
  joined.set(x.subarray(0, x.length - Math.round(0.1 * SR)));
  joined.set(y, x.length - Math.round(0.1 * SR));
  const syl = findSyllables(joined, SR);
  assert.equal(syl.length, 2);
  assert.equal(Math.round(syl[0].midi), 60);
  assert.equal(Math.round(syl[1].midi), 65);
});

test('a synthesised sung hook gives syllables near its notes', () => {
  const voice = testVoice({ style: 'sung', sampleRate: SR });
  const syl = findSyllables(voice.samples, SR);
  assert.ok(syl.length >= 4 && syl.length <= MAX_CHOPS, `${syl.length} syllables`);
  const pitched = syl.filter((s) => s.midi !== null);
  assert.ok(pitched.length >= syl.length * 0.6);
  // Each pitched syllable's note is one the hook sings, within a semitone
  const sung = voice.notes.map((n) => n.midi);
  for (const s of pitched) assert.ok(sung.some((m) => Math.abs(m - s.midi) < 1), `${s.midi.toFixed(2)} isn't one of ${sung}`);
});

test('silence and a near-silent take give no syllables', () => {
  assert.deepEqual(findSyllables(new Float32Array(SR), SR), []);
  assert.deepEqual(findSyllables(tones([60]).map((v) => v * 1e-5), SR), []);
});

test('a held note with no quiet in it (trimmed tight) is still a syllable', () => {
  for (const attack of [0.005, 0.02]) {
    const n = SR;
    const hz = midiToHz(57);
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / (attack * SR), (n - i) / (attack * SR));
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin((2 * Math.PI * hz * h * i) / SR) / h;
      x[i] = 0.25 * env * v;
    }
    const syl = findSyllables(x, SR);
    assert.ok(syl.length >= 1, `attack ${attack}: ${syl.length} syllables`);
    assert.equal(Math.round(syl[0].midi), 57);
  }
});

test('noise (a breath) is a syllable with no note', () => {
  let seed = 1;
  const x = new Float32Array(Math.round(0.6 * SR));
  for (let i = Math.round(0.1 * SR); i < Math.round(0.5 * SR); i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    x[i] = 0.2 * (seed / 0x7fffffff - 0.5);
  }
  const syl = findSyllables(x, SR);
  assert.equal(syl.length, 1);
  assert.equal(syl[0].midi, null);
});

test('the keys: one syllable a key, a clash moved to a free key near it, unpitched ones under the lowest', () => {
  const s = (midi, level = -20) => ({ start: 0, end: 0.3, midi, level });
  const keys = layoutChops([s(60.2), s(59.9, -25), s(64), s(null), s(60.1, -30), s(60, -10), s(60, -40)]);
  const roots = keys.map((k) => k.root);
  assert.equal(new Set(roots).size, roots.length, 'one syllable a key');
  for (const k of keys) {
    assert.ok(k.lo <= k.root && k.root <= k.hi);
    assert.ok(k.root - k.lo <= REACH && k.hi - k.root <= REACH);
  }
  // Sorted, and neighbours' ranges don't overlap
  for (let i = 1; i < keys.length; i++) {
    assert.ok(keys[i].root > keys[i - 1].root);
    assert.ok(keys[i].lo > keys[i - 1].hi);
  }
  const at = (i) => keys.find((k) => k.index === i)?.root;
  assert.equal(at(0), 60);
  assert.ok(Math.abs(at(1) - 60) <= MAX_MOVE);
  assert.equal(at(2), 64);
  assert.ok(at(3) < Math.min(...keys.filter((k) => k.index !== 3).map((k) => k.root)), 'the breath under the lowest');
  // The clashes spread out to the nearest free keys
  assert.equal(at(4), 61);
  assert.equal(at(5), 62);
  assert.equal(at(6), 58);
  assert.equal(keys.length, 7);
  // With every key within reach taken, the quieter of the two on its note is left out
  const full = layoutChops([s(58), s(59), s(60, -30), s(61), s(62), s(60, -5)]);
  assert.equal(full.length, 5);
  assert.equal(full.find((k) => k.root === 60).index, 5);
});

test('in the song key: each syllable on the nearest note of it, a clash moved to a free note of it', () => {
  const s = (midi, level = -20) => ({ start: 0, end: 0.3, midi, level });
  const C_MAJOR = { root: 0, steps: [0, 2, 4, 5, 7, 9, 11] };
  const keys = layoutChops([s(61.3), s(60.1), s(59.8), s(66.2)], C_MAJOR);
  const at = (i) => keys.find((k) => k.index === i)?.root;
  assert.equal(at(0), 62);
  assert.equal(at(1), 60);
  // 60 is taken, 61 isn't in the key: 59
  assert.equal(at(2), 59);
  assert.equal(at(3), 67);
  for (const k of keys) assert.ok(C_MAJOR.steps.includes(k.root % 12));
});

test('in a key picked for them (no notes in the song to say one), the chops go on its notes', () => {
  const s = (midi, level = -20) => ({ start: 0, end: 0.3, midi, level });
  // Sung on F, F#, G#, A#: in E minor, the F goes to E or F# and the G# and A# onto G, A or B
  const sung = [s(65.1), s(66), s(68.2), s(70.1)];
  const E_MINOR = { root: 4, steps: [0, 2, 3, 5, 7, 8, 10] };
  const keys = layoutChops(sung, E_MINOR);
  assert.equal(keys.length, 4);
  for (const k of keys) assert.ok(E_MINOR.steps.includes((k.root - 4 + 12) % 12), `${k.root} isn't in E minor`);
  // With no key, each stays on its own semitone
  assert.deepEqual(layoutChops(sung, null).map((k) => k.root), [65, 66, 68, 70]);
});

test('chops are placed where the take plays them: its stretch, warp and the tempo map', () => {
  const audio = { soundId: 's', offset: 1, gain: 0, fadeIn: 0, fadeOut: 0 };
  // As recorded, at 120: 2 s into the clip is a bar
  assert.ok(Math.abs(barOfSource({ startBar: 5, audio }, 3, 120) - 6) < 1e-9);
  // Following the tempo, recorded at 60 and played at 120 (twice as fast): half a bar
  assert.ok(Math.abs(barOfSource({ startBar: 5, audio: { ...audio, stretchBpm: 60 } }, 3, 120) - 5.5) < 1e-9);
  // Warp markers: the sound's 2 s on beat 4 of it and 4 s on beat 6, so 3 s is beat 5 (a bar and a quarter)
  const warped = { ...audio, offset: 0, stretchBpm: 60, warp: [{ src: 0, beat: 0 }, { src: 2, beat: 4 }, { src: 4, beat: 6 }] };
  assert.ok(Math.abs(barOfSource({ startBar: 5, audio: warped }, 3, 120) - 6.25) < 1e-9);
  // A tempo change half way through: 2 s at 120 (a bar), then 1 s at 60 (a quarter of a bar)
  const tempo = { bpm: 120, points: [{ id: 't', bar: 6, bpm: 60, ramp: false }] };
  assert.ok(Math.abs(barOfSource({ startBar: 5, audio: { ...audio, offset: 0 } }, 3, tempo) - 6.25) < 1e-9);
});

test('a chop is tuned onto its key, keeping its length', () => {
  const voice = testVoice({ style: 'sung', sampleRate: SR });
  const x = voice.samples;
  const frames = detectPitch(x, SR);
  const syl = findSyllables(x, SR, frames).filter((s) => s.midi !== null).slice(0, 4);
  for (const s of syl) {
    for (const move of [0, 2, -3]) {
      const root = Math.round(s.midi) + move;
      const y = tuneChop(x, SR, frames, s, root);
      assert.equal(y.length, Math.round(s.end * SR) - Math.round(s.start * SR));
      assert.ok(Math.abs(pitchOf(y) - root) < 0.15, `${s.midi.toFixed(2)} on ${root}: ${pitchOf(y)}`);
      // Faded in and out
      assert.ok(Math.abs(y[0]) < 1e-3 && Math.abs(y[y.length - 1]) < 1e-3);
    }
  }
});

test('chops are levelled to one loudness, peaks under -1 dBFS', () => {
  const loud = tones([60]).map((v) => v * 2);
  const soft = tones([60]).map((v) => v * 0.05);
  const levelOf = (y) => {
    const db = Array.from(frameLevels(y, SR)).sort((a, b) => a - b);
    return db[Math.floor(db.length * 0.9)];
  };
  const a = loud.map((v) => v * chopGain(loud, SR));
  const b = soft.map((v) => v * chopGain(soft, SR));
  assert.ok(Math.abs(levelOf(a) - levelOf(b)) < 0.5);
  for (const y of [a, b]) assert.ok(Math.max(...y.map(Math.abs)) <= 10 ** (-1 / 20) + 1e-6);
});
