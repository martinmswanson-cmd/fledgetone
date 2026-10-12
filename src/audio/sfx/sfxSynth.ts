/**
 * The sound effects maker's synth: game sounds (jump, coin, laser, hit, power-up, explosion,
 * blip) from a handful of settings, in the spirit of the classic 8-bit sound generators. Each
 * category has a recipe that rolls new settings from a seed, so Randomize gives a fresh sound and
 * the same seed always gives the same one. Rendering is plain maths into a Float32Array, with no
 * Web Audio, so Node can unit-test it and the WAV is the same everywhere.
 */

export const SFX_WAVES = ['square', 'saw', 'triangle', 'sine', 'noise'] as const;
export type SfxWave = (typeof SFX_WAVES)[number];

export interface SfxParams {
  wave: SfxWave;
  /** Starting pitch, Hz (for noise: how fast it rumbles) */
  freq: number;
  /** Pitch change over the sound, semitones (-48 to +48) */
  slide: number;
  /** 0: an even glide; 1: most of the glide at the start */
  curve: number;
  /** A jump in pitch partway through, semitones (0: none), as in a coin */
  arp: number;
  /** When the jump comes, 0 to 1 of the way through */
  arpAt: number;
  /** Vibrato depth in semitones and speed in Hz */
  vibDepth: number;
  vibRate: number;
  /** Square wave width, 0.05 to 0.5 (0.5: a plain square) */
  duty: number;
  /** Envelope, seconds */
  attack: number;
  hold: number;
  decay: number;
  /** Extra level at the start, 0 to 1 */
  punch: number;
  /** Low-pass cutoff, Hz, and how far it moves over the sound, octaves (-4 to +4) */
  lowpass: number;
  lpSweep: number;
  /** High-pass cutoff, Hz */
  highpass: number;
  /** Bit crush, 0 (clean) to 1 (2-bit) */
  crush: number;
  /** Restart the pitch this many times a second (0: never), as in a power-up warble */
  repeat: number;
  /** 0 to 1 */
  volume: number;
  /** For noise, so the same sound renders the same */
  seed: number;
}

export const SFX_CATEGORIES = ['jump', 'coin', 'laser', 'hit', 'powerUp', 'explosion', 'blip'] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];
export const SFX_LABELS: Record<SfxCategory, string> = {
  jump: 'Jump',
  coin: 'Coin',
  laser: 'Laser',
  hit: 'Hit',
  powerUp: 'Power-up',
  explosion: 'Explosion',
  blip: 'Blip',
};

/** A seeded random number generator (mulberry32): numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE: SfxParams = {
  wave: 'square',
  freq: 440,
  slide: 0,
  curve: 0.5,
  arp: 0,
  arpAt: 0.3,
  vibDepth: 0,
  vibRate: 6,
  duty: 0.5,
  attack: 0,
  hold: 0.05,
  decay: 0.2,
  punch: 0,
  lowpass: 20000,
  lpSweep: 0,
  highpass: 20,
  crush: 0,
  repeat: 0,
  volume: 0.8,
  seed: 1,
};

/** New settings for a category, rolled from `seed`. */
export function generateSfx(category: SfxCategory, seed: number): SfxParams {
  const r = rng(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * r();
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const p: SfxParams = { ...BASE, seed };
  switch (category) {
    case 'jump':
      Object.assign(p, { wave: pick(['square', 'square', 'sine', 'triangle'] as const), freq: between(260, 600), slide: between(5, 14), curve: between(0.3, 0.8), duty: between(0.25, 0.5), hold: between(0.02, 0.08), decay: between(0.12, 0.28), punch: between(0, 0.3) });
      break;
    case 'coin':
      Object.assign(p, { wave: pick(['square', 'square', 'saw', 'triangle'] as const), freq: between(800, 1500), arp: pick([5, 7, 12, 12]), arpAt: between(0.08, 0.25), duty: between(0.3, 0.5), hold: between(0.04, 0.12), decay: between(0.18, 0.45), punch: between(0.3, 0.7) });
      break;
    case 'laser':
      Object.assign(p, { wave: pick(['saw', 'square', 'square', 'sine'] as const), freq: between(700, 2200), slide: -between(18, 40), curve: between(0.5, 0.95), duty: between(0.1, 0.5), hold: between(0, 0.05), decay: between(0.1, 0.3), punch: between(0, 0.4), vibDepth: r() < 0.3 ? between(0.2, 1) : 0, vibRate: between(10, 30) });
      break;
    case 'hit':
      Object.assign(p, { wave: pick(['noise', 'noise', 'saw', 'square'] as const), freq: between(120, 500), slide: -between(6, 18), curve: between(0.4, 0.9), hold: between(0, 0.03), decay: between(0.08, 0.22), punch: between(0.3, 0.8), lowpass: between(2500, 9000), crush: r() < 0.4 ? between(0.2, 0.6) : 0 });
      break;
    case 'powerUp':
      Object.assign(p, { wave: pick(['square', 'triangle', 'saw', 'square'] as const), freq: between(180, 520), slide: between(10, 26), curve: between(0, 0.4), duty: between(0.3, 0.5), hold: between(0.15, 0.35), decay: between(0.2, 0.5), repeat: r() < 0.6 ? between(5, 12) : 0, vibDepth: r() < 0.4 ? between(0.2, 0.8) : 0, vibRate: between(8, 18) });
      break;
    case 'explosion':
      Object.assign(p, { wave: 'noise', freq: between(30, 110), slide: -between(6, 20), curve: between(0.3, 0.8), attack: between(0, 0.01), hold: between(0.05, 0.25), decay: between(0.5, 1.4), punch: between(0.4, 0.9), lowpass: between(2000, 9000), lpSweep: -between(1, 3), crush: r() < 0.3 ? between(0.1, 0.4) : 0 });
      break;
    case 'blip':
      Object.assign(p, { wave: pick(['square', 'square', 'sine', 'triangle'] as const), freq: between(500, 1600), duty: between(0.25, 0.5), hold: between(0.01, 0.05), decay: between(0.04, 0.1), arp: r() < 0.3 ? pick([7, 12]) : 0, arpAt: between(0.3, 0.6) });
      break;
  }
  return p;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Small random changes to every setting, for "like this, but different". */
export function mutateSfx(p: SfxParams, seed: number): SfxParams {
  const r = rng(seed);
  const wiggle = (v: number, amount: number) => v * (1 + (r() * 2 - 1) * amount);
  return {
    ...p,
    seed,
    freq: clamp(wiggle(p.freq, 0.12), 20, 8000),
    slide: clamp(p.slide + (r() * 2 - 1) * 3, -48, 48),
    duty: clamp(p.duty + (r() * 2 - 1) * 0.08, 0.05, 0.5),
    hold: clamp(wiggle(p.hold, 0.2), 0, 1),
    decay: clamp(wiggle(p.decay, 0.2), 0.01, 2),
    punch: clamp(p.punch + (r() * 2 - 1) * 0.1, 0, 1),
    lowpass: clamp(wiggle(p.lowpass, 0.15), 200, 20000),
  };
}

/** How long a sound lasts, seconds. */
export const sfxLength = (p: SfxParams) => p.attack + p.hold + p.decay;

/** Render the sound, mono, peaking at `volume` (just under full scale at 1). */
export function renderSfx(p: SfxParams, sampleRate = 44100): Float32Array {
  const length = Math.max(1, Math.round(sfxLength(p) * sampleRate));
  const out = new Float32Array(length);
  const noise = rng(p.seed ^ 0x9e3779b9);
  const total = length / sampleRate;
  let phase = 0;
  let noiseValue = 0;
  let lp = 0;
  let hpIn = 0;
  let hpOut = 0;
  const repeatEvery = p.repeat > 0 ? 1 / p.repeat : Infinity;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // Pitch: the slide (restarted by Repeat), the arpeggio jump and vibrato, all in semitones
    const tr = p.repeat > 0 ? t % repeatEvery : t;
    const span = p.repeat > 0 ? repeatEvery : total;
    const x = Math.min(1, tr / span);
    const shaped = p.curve > 0 ? 1 - Math.pow(1 - x, 1 + p.curve * 4) : x;
    let semis = p.slide * shaped;
    if (p.arp && t >= p.arpAt * total) semis += p.arp;
    if (p.vibDepth) semis += p.vibDepth * Math.sin(2 * Math.PI * p.vibRate * t);
    const f = clamp(p.freq * Math.pow(2, semis / 12), 5, sampleRate / 2.2);

    const prev = phase;
    phase = (phase + f / sampleRate) % 1;
    let v: number;
    switch (p.wave) {
      case 'square':
        v = phase < p.duty ? 1 : -1;
        break;
      case 'saw':
        v = 2 * phase - 1;
        break;
      case 'triangle':
        v = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
        break;
      case 'sine':
        v = Math.sin(2 * Math.PI * phase);
        break;
      default: {
        // Noise: a new random level 32 times a cycle, so its pitch still means something
        if (Math.floor(phase * 32) !== Math.floor(prev * 32) || phase < prev) noiseValue = noise() * 2 - 1;
        v = noiseValue;
      }
    }

    // Filters: one-pole low-pass (swept) and high-pass
    const cutoff = clamp(p.lowpass * Math.pow(2, p.lpSweep * (t / total)), 50, sampleRate / 2.1);
    const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    lp += a * (v - lp);
    v = p.lowpass >= 19999 && p.lpSweep === 0 ? v : lp;
    const rc = 1 / (2 * Math.PI * Math.max(10, p.highpass));
    const hpA = rc / (rc + 1 / sampleRate);
    hpOut = hpA * (hpOut + v - hpIn);
    hpIn = v;
    v = p.highpass > 20 ? hpOut : v;

    if (p.crush > 0) {
      const steps = Math.pow(2, Math.round(16 - p.crush * 14)) / 2;
      v = Math.round(v * steps) / steps;
    }

    // Envelope: attack, hold (with punch fading over it), decay
    let env: number;
    if (t < p.attack) env = t / p.attack;
    else if (t < p.attack + p.hold) env = 1 + p.punch * (1 - (t - p.attack) / Math.max(1e-6, p.hold));
    else env = Math.pow(1 - Math.min(1, (t - p.attack - p.hold) / Math.max(1e-6, p.decay)), 2);
    out[i] = v * env;
  }
  // Short fades so it never clicks, then level to the volume
  const fade = Math.min(length, Math.round(0.002 * sampleRate));
  for (let i = 0; i < fade; i++) {
    out[i] *= i / fade;
    out[length - 1 - i] *= i / fade;
  }
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? (0.89 * p.volume) / peak : 0;
  for (let i = 0; i < length; i++) out[i] *= gain;
  return out;
}

/** A 16-bit mono WAV file of `samples`. */
export function sfxWav(samples: Float32Array, sampleRate = 44100): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(clamp(samples[i], -1, 1) * 32767), true);
  return bytes;
}

/** Move a frequency to the nearest note of a scale (`root` 0 = C; `steps` semitones above it). */
export function snapToScale(freq: number, root: number, steps: readonly number[]): number {
  const midi = 69 + 12 * Math.log2(freq / 440);
  let best = Math.round(midi);
  let bestGap = Infinity;
  for (let m = Math.floor(midi) - 2; m <= Math.ceil(midi) + 2; m++) {
    if (!steps.includes((((m - root) % 12) + 12) % 12)) continue;
    const gap = Math.abs(m - midi);
    if (gap < bestGap) {
      bestGap = gap;
      best = m;
    }
  }
  return 440 * Math.pow(2, (best - 69) / 12);
}
