// Synthesised test material for the sample-flipping tools (scripts/sampleAnalysis.test.mjs,
// scripts/sampleFlip.test.mjs): soul-style chord loops in a known key and tempo, with a little
// noise and drum hits, and drum loops at known tempos. Made here from sine partials and noise, so
// the tests need no recordings. Everything is seeded: the same call makes the same samples.

/** mulberry32 */
export function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hz = (midi, cents = 0) => 440 * 2 ** ((midi - 69 + cents / 100) / 12);

/** An electric-piano-like note: a few decaying harmonics, added into `out` at `at` seconds. */
function keysNote(out, sr, at, seconds, midi, level, cents = 0) {
  const f = hz(midi, cents);
  const start = Math.round(at * sr);
  const n = Math.min(out.length - start, Math.round(seconds * sr));
  for (let h = 1; h <= 6; h++) {
    if (f * h > sr / 2.2) break;
    const amp = (level / h ** 1.3) * (h === 2 ? 1.2 : 1);
    const decay = 1.6 + h * 0.9;
    const w = (2 * Math.PI * f * h * (1 + (h - 1) * 0.0004)) / sr;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t / 0.004) * Math.exp(-decay * t) * Math.min(1, (n - i) / (0.01 * sr));
      out[start + i] += amp * env * Math.sin(w * i);
    }
  }
}

/** A round bass note (fundamental and a little second harmonic). */
function bassNote(out, sr, at, seconds, midi, level, cents = 0) {
  const f = hz(midi, cents);
  const start = Math.round(at * sr);
  const n = Math.min(out.length - start, Math.round(seconds * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.008) * Math.exp(-1.2 * t) * Math.min(1, (n - i) / (0.01 * sr));
    out[start + i] += level * env * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t));
  }
}

export function kick(out, sr, at, level = 0.8) {
  const start = Math.round(at * sr);
  const n = Math.min(out.length - start, Math.round(0.35 * sr));
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 48 + 110 * Math.exp(-t * 30);
    phase += (2 * Math.PI * f) / sr;
    out[start + i] += level * Math.exp(-t * 9) * Math.sin(phase);
  }
}

export function snare(out, sr, at, level = 0.5, random = Math.random) {
  const start = Math.round(at * sr);
  const n = Math.min(out.length - start, Math.round(0.22 * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[start + i] += level * (Math.exp(-t * 22) * (random() * 2 - 1) * 0.8 + Math.exp(-t * 30) * Math.sin(2 * Math.PI * 190 * t) * 0.5);
  }
}

export function hat(out, sr, at, level = 0.18, random = Math.random) {
  const start = Math.round(at * sr);
  const n = Math.min(out.length - start, Math.round(0.05 * sr));
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const white = random() * 2 - 1;
    // A crude high-pass: the difference of white noise
    out[start + i] += level * Math.exp(-t * 80) * (white - prev);
    prev = white;
  }
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

/** Progressions as scale degrees (0 = the tonic chord), per mode. */
export const PROGRESSIONS = {
  minor: [
    [0, 5, 2, 6], // i VI III VII
    [0, 3, 6, 2], // i iv VII III
    [0, 3, 4, 0], // i iv v i
    [0, 6, 5, 4], // i VII VI v
  ],
  major: [
    [0, 4, 5, 3], // I V vi IV
    [0, 5, 3, 4], // I vi IV V
    [1, 4, 0, 0], // ii V I I
    [0, 3, 0, 4], // I IV I V
  ],
};

/**
 * A soul-style chord loop: one chord a bar (7th chords, voiced around middle C, the root in the
 * bass), with optional drums and vinyl-style noise. Returns mono samples at `sr`.
 */
export function chordLoop({ root, mode, progression, bpm, bars = 4, sr = 22050, drums = true, noise = 0.01, sevenths = true, cents = 0, seed = 1 }) {
  const random = rng(seed);
  const bar = 240 / bpm;
  const out = new Float32Array(Math.round(bars * bar * sr));
  const scale = mode === 'major' ? MAJOR : MINOR;
  const note = (degree, octave) => 12 * (octave + 1) + root + scale[((degree % 7) + 7) % 7] + 12 * Math.floor(degree / 7);
  for (let b = 0; b < bars; b++) {
    const d = progression[b % progression.length];
    const at = b * bar;
    const chord = [d, d + 2, d + 4, ...(sevenths ? [d + 6] : [])].map((x) => note(x, 3));
    // Keep the voicing between G3 and G4 or so
    const voiced = chord.map((m) => (m < 55 ? m + 12 : m > 72 ? m - 12 : m));
    // Two stabs a bar, soul-style: on 1 and the and of 2
    for (const [t, len, lvl] of [[0, bar * 0.45, 0.16], [bar * 0.375, bar * 0.6, 0.12]]) for (const m of voiced) keysNote(out, sr, at + t, len, m, lvl, cents);
    bassNote(out, sr, at, bar * 0.48, note(d, 2), 0.32, cents);
    bassNote(out, sr, at + bar * 0.625, bar * 0.3, note(d, 2), 0.22, cents);
  }
  if (drums) {
    const beat = 60 / bpm;
    for (let k = 0; k < bars * 4; k++) {
      const at = k * beat;
      if (k % 2 === 0) kick(out, sr, at, 0.45);
      else snare(out, sr, at, 0.3, random);
      hat(out, sr, at, 0.1, random);
      hat(out, sr, at + beat / 2, 0.07, random);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += noise * (random() * 2 - 1);
  return out;
}

/**
 * A drum loop at `bpm`: `style` 'boombap' (kick on 1 and the and of 2 and 3, snare on 2 and 4,
 * 8th hats, swung), 'trap' (half-time snare on 3, 16th hats with rolls, syncopated kicks) or
 * 'four' (four on the floor).
 */
export function drumLoop({ bpm, bars = 4, sr = 22050, style = 'boombap', seed = 1, noise = 0.003 }) {
  const random = rng(seed);
  const beat = 60 / bpm;
  const out = new Float32Array(Math.round(bars * 4 * beat * sr));
  for (let b = 0; b < bars; b++) {
    const bar = b * 4 * beat;
    const s16 = (i) => bar + (i * beat) / 4;
    if (style === 'boombap') {
      const swing = beat * 0.08;
      for (const i of [0, 6, 10]) kick(out, sr, s16(i));
      for (const i of [4, 12]) snare(out, sr, s16(i), 0.55, random);
      for (let i = 0; i < 16; i += 2) hat(out, sr, s16(i) + (i % 4 === 2 ? swing : 0), i % 4 ? 0.12 : 0.18, random);
    } else if (style === 'trap') {
      for (const i of [0, 7, 10]) kick(out, sr, s16(i), 0.9);
      snare(out, sr, s16(8), 0.6, random);
      for (let i = 0; i < 16; i++) hat(out, sr, s16(i), i % 2 ? 0.08 : 0.14, random);
      if (b % 2 === 1) for (let r = 0; r < 4; r++) hat(out, sr, s16(14) + (r * beat) / 8, 0.1, random);
    } else {
      for (let i = 0; i < 16; i += 4) kick(out, sr, s16(i));
      for (const i of [4, 12]) snare(out, sr, s16(i), 0.4, random);
      for (let i = 2; i < 16; i += 4) hat(out, sr, s16(i), 0.2, random);
    }
  }
  for (let i = 0; i < out.length; i++) out[i] += noise * (random() * 2 - 1);
  return out;
}
