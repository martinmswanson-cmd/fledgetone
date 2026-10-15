import { hashSeed } from './human';

/**
 * Repeatable noise for the instruments, so a song renders the same sample for sample every time.
 * The noise buffers are filled from a fixed seed, and each noise burst starts at a point of its
 * looped buffer picked by a hash of its key (its track, what plays it: a drum row, a note, which
 * layer) and its time. Every burst still differs from the next, as a drum never sounds quite the
 * same twice; it just differs the same way on every play and in every export. (Before, the
 * buffers and starting points came from Math.random: two exports of a song with a riser or a
 * clap in it nulled to only about -17 dB.)
 */

/** A seeded generator of numbers in [0, 1) (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The key of one source of noise: an instrument's seed (its track's) and what in it plays ("snare", a note). */
export function noiseKey(seed: number, what: string | number): number {
  return hashSeed(`${seed >>> 0}|${what}`);
}

/** An instrument's seed, from its track's id (0 for one with no track: an audition). */
export function trackSeed(trackId: string | undefined): number {
  return trackId ? hashSeed(trackId) : 0;
}

/**
 * Where a burst of noise with `key` starting at `time` (seconds) begins in its looped buffer, as a
 * share of the buffer, in [0, 1). The time counts in microseconds, below any float noise in it.
 */
export function noiseStart(key: number, time: number): number {
  return seededRandom(hashSeed(`${key >>> 0}@${Math.round(time * 1e6)}`))();
}

/** Fill `data` with white noise from `seed`, at `level` (peak). */
export function fillWhiteNoise(data: Float32Array, seed: number, level = 1): void {
  const random = seededRandom(seed);
  for (let i = 0; i < data.length; i++) data[i] = (random() * 2 - 1) * level;
}

/** The noise colours Tone.Noise plays. */
export type NoiseColour = 'white' | 'pink' | 'brown';

/**
 * One channel of Tone.Noise's noise of `colour`, made the way Tone makes it (the same filters and
 * gains) but from `seed` instead of Math.random.
 */
export function toneNoiseChannel(colour: NoiseColour, length: number, seed: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(length);
  const random = seededRandom(seed);
  if (colour === 'brown') {
    let last = 0;
    for (let i = 0; i < length; i++) {
      last = (last + 0.02 * (random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
  } else if (colour === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  } else {
    for (let i = 0; i < length; i++) data[i] = random() * 2 - 1;
  }
  return data;
}
