/**
 * Designed reverb impulse responses for the shared reverb, one per room style. Tone.Reverb's own is
 * white noise fading at one rate, which sounds like a hiss in a tunnel; a real room is different
 * at every frequency (the air and the walls soak up the highs, so they die first, and big rooms
 * keep their lows longest), answers first with a few distinct early reflections off the nearest
 * walls, and reaches each ear differently. Each style sets those: how long before the first
 * reflection, the reflections' pattern, how quickly the tail builds up, and how much longer or
 * shorter its lows and highs ring than its middle. The `decay` (seconds) is the middle's.
 *
 * Pure numbers (no Web Audio), so it can be tested; the result goes into the reverb's convolver.
 * One style, 'lush', isn't a convolution: it's the algorithmic reverb in lushReverb.ts, which takes
 * its low and high multipliers from here; its impulse response here is the hall's, which stands in
 * where that reverb can't run.
 */

export type RoomStyle = 'hall' | 'chamber' | 'church' | 'studio' | 'plate' | 'lush';

/** A room style's design. `algorithmic`: played by the lush reverb (lushReverb.ts), not the convolver. */
export interface RoomDesign {
  name: string;
  about: string;
  preDelay: number;
  build: number;
  low: number;
  high: number;
  reflections: Array<[time: number, gain: number, side: number]>;
  algorithmic?: boolean;
}

const HALL: RoomDesign = {
  name: 'Concert hall',
  about: 'A large hall: warm, wide, the lows ringing a little longer.',
  preDelay: 0.022,
  build: 0.06,
  low: 1.25,
  high: 0.5,
  reflections: [[0.019, 0.5, -0.6], [0.027, 0.45, 0.7], [0.041, 0.35, -0.3], [0.053, 0.3, 0.4], [0.067, 0.25, -0.8], [0.079, 0.2, 0.9]],
};

export const ROOM_STYLES: Record<RoomStyle, RoomDesign> = {
  hall: HALL,
  chamber: {
    name: 'Chamber',
    about: 'A smaller room for a few players: close, clear, a quick bloom.',
    preDelay: 0.01,
    build: 0.03,
    low: 1.05,
    high: 0.6,
    reflections: [[0.008, 0.55, -0.5], [0.013, 0.5, 0.6], [0.019, 0.4, -0.2], [0.026, 0.35, 0.3], [0.034, 0.25, -0.7]],
  },
  church: {
    name: 'Church',
    about: 'Stone and height: a long, dark tail that blooms slowly.',
    preDelay: 0.04,
    build: 0.12,
    low: 1.4,
    high: 0.35,
    reflections: [[0.035, 0.4, -0.7], [0.052, 0.35, 0.8], [0.071, 0.3, -0.4], [0.093, 0.28, 0.5], [0.118, 0.22, -0.9]],
  },
  studio: {
    name: 'Studio room',
    about: 'A treated live room: short, tight and natural, for drums and bands.',
    preDelay: 0.004,
    build: 0.015,
    low: 0.85,
    high: 0.7,
    reflections: [[0.004, 0.45, -0.4], [0.007, 0.4, 0.5], [0.011, 0.3, -0.2], [0.016, 0.22, 0.3]],
  },
  plate: {
    name: 'Plate',
    about: 'A steel plate: dense, bright and smooth at once, no room in it. Vocals, snares.',
    preDelay: 0,
    build: 0.002,
    low: 0.8,
    high: 0.9,
    reflections: [],
  },
  lush: {
    ...HALL,
    name: 'Lush',
    about: 'A smooth, dense, slowly shimmering tail with no hard echoes. Pads, ballads, ambient; light on the computer even when long.',
    low: 1.25,
    high: 0.55,
    algorithmic: true,
  },
};

export const ROOM_STYLE_IDS = Object.keys(ROOM_STYLES) as RoomStyle[];

/** A repeatable noise source (the same room every time it's built). */
function noise(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2147483648 - 1;
  };
}

/**
 * Longest impulse response made (seconds). Every style's every band fits up to the longest decay
 * the app offers (12 s: a church's lows ring 1.4 times that); past it, the bands that would ring
 * longer are shortened to end there, so the tail still dies away instead of stopping.
 */
export const ROOM_IR_MAX_SECONDS = 18;
/** The fade at the very end of an impulse response (seconds), so whatever is left stops without a click */
const END_FADE = 0.05;

/**
 * How long `style`'s impulse response is at a middle decay of `decay` seconds: until its
 * longest-ringing band has fallen 60 dB, plus the end fade, at most ROOM_IR_MAX_SECONDS.
 */
export function roomSeconds(style: RoomStyle, decay: number): number {
  const room = style === 'lush' ? HALL : (ROOM_STYLES[style] ?? HALL);
  const rt = Math.max(0.2, decay);
  return Math.min(ROOM_IR_MAX_SECONDS, room.preDelay + rt * Math.max(1, room.low, room.high) + END_FADE);
}

/**
 * The impulse response's two channels for `style` with a middle decay of `decay` seconds (to
 * -60 dB), at `sampleRate`. Its total energy is 1, so changing style or decay keeps the reverb's
 * level about the same. It lasts until every band has fallen 60 dB (see roomSeconds), and ends
 * with a short fade.
 */
export function roomChannels(style: RoomStyle, decay: number, sampleRate: number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const room = style === 'lush' ? HALL : (ROOM_STYLES[style] ?? HALL);
  const rt = Math.max(0.2, decay);
  const seconds = roomSeconds(style, decay);
  const n = Math.max(1, Math.round(seconds * sampleRate));
  // The time each band has to fall 60 dB: its own, or less if that would run past the end
  const room60 = seconds - room.preDelay - END_FADE;
  const t60 = (k: number) => Math.min(rt * k, room60);
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(n), new Float32Array(n)];
  // Crossovers between the low, middle and high bands of the tail (one-pole filters)
  const cLow = 1 - Math.exp((-2 * Math.PI * 300) / sampleRate);
  const cHigh = 1 - Math.exp((-2 * Math.PI * 4000) / sampleRate);
  // Per sample, how much each band falls (to -60 dB over its decay time)
  const fall = (t60: number) => Math.exp(-6.908 / (t60 * sampleRate));
  const fLow = fall(t60(room.low));
  const fMid = fall(t60(1));
  const fHigh = fall(t60(room.high));
  const start = Math.round(room.preDelay * sampleRate);
  const build = Math.max(1, Math.round(room.build * sampleRate));
  for (let c = 0; c < 2; c++) {
    const rnd = noise(c === 0 ? 0x1234567 : 0x7654321);
    const data = out[c];
    let lp = 0;
    let lp2 = 0;
    let eLow = 1;
    let eMid = 1;
    let eHigh = 1;
    for (let i = start; i < n; i++) {
      const x = rnd();
      // Split the noise: low, high, and what's between
      lp += cLow * (x - lp);
      lp2 += cHigh * (x - lp2);
      const low = lp;
      const high = x - lp2;
      const mid = lp2 - lp;
      // The tail swells in over `build`, as reflections pile up
      const k = i - start;
      const swell = k < build ? (k / build) ** 2 : 1;
      data[i] = swell * (low * eLow * 1.6 + mid * eMid + high * eHigh * 0.8);
      eLow *= fLow;
      eMid *= fMid;
      eHigh *= fHigh;
    }
    // The early reflections: distinct, a little softened (a 1 ms smear), each favouring a side
    for (const [time, gain, side] of room.reflections) {
      const at = Math.round((room.preDelay + time) * sampleRate);
      const g = gain * (c === 0 ? 1 - side * 0.5 : 1 + side * 0.5) * 6;
      const width = Math.max(1, Math.round(0.001 * sampleRate));
      for (let j = 0; j < width && at + j < n; j++) data[at + j] += (g * (1 - j / width)) / width;
    }
  }
  // The end fade (raised cosine)
  const fade = Math.min(n, Math.round(END_FADE * sampleRate));
  for (const d of out) for (let k = 0; k < fade; k++) d[n - 1 - k] *= 0.5 - 0.5 * Math.cos((Math.PI * k) / fade);
  // Total energy 1 across both channels
  let energy = 0;
  for (const d of out) for (let i = 0; i < n; i++) energy += d[i] * d[i];
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (const d of out) for (let i = 0; i < n; i++) d[i] *= scale;
  return out;
}
