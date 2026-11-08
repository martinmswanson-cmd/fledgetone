/**
 * Designed reverb impulse responses for the shared reverb, one per room style. Tone.Reverb's own is
 * white noise fading at one rate, which sounds like a hiss in a tunnel; a real room is different
 * at every frequency (the air and the walls soak up the highs, so they die first, and big rooms
 * keep their lows longest), answers first with a few distinct early reflections off the nearest
 * walls, and reaches each ear differently. Each style sets those: how long before the first
 * reflection, the reflections' pattern, how quickly the tail builds up, and how much longer or
 * shorter its lows and highs ring than its middle. The `decay` (seconds) is the middle's.
 *
 * Each room is made at ROOM_RATE (44.1 kHz) and, at any other rate, resampled from that (see
 * roomAtRate), so a song's rooms are the same at every rate it's played or exported at.
 *
 * Pure numbers (no Web Audio), so it can be tested; the result goes into the reverb's convolver.
 * One style, 'lush', isn't a convolution: it's the algorithmic reverb in lushReverb.ts, which takes
 * its low and high multipliers from here; its impulse response here is the hall's, which stands in
 * where that reverb can't run.
 */

import { onceResampler } from '../loopResample';

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
  /**
   * Where the highs reaching the room are soaked up (Hz): the shared reverb's input low-pass
   * (busEffects.ts). A steel plate takes nearly all the top; a stone church little of it.
   */
  damp: number;
  algorithmic?: boolean;
}

const HALL: RoomDesign = {
  name: 'Concert hall',
  about: 'A large hall: warm, wide, the lows ringing a little longer.',
  preDelay: 0.022,
  build: 0.06,
  low: 1.25,
  high: 0.5,
  damp: 7500,
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
    damp: 8000,
    reflections: [[0.008, 0.55, -0.5], [0.013, 0.5, 0.6], [0.019, 0.4, -0.2], [0.026, 0.35, 0.3], [0.034, 0.25, -0.7]],
  },
  church: {
    name: 'Church',
    about: 'Stone and height: a long, dark tail that blooms slowly.',
    preDelay: 0.04,
    build: 0.12,
    low: 1.4,
    high: 0.35,
    damp: 6000,
    reflections: [[0.035, 0.4, -0.7], [0.052, 0.35, 0.8], [0.071, 0.3, -0.4], [0.093, 0.28, 0.5], [0.118, 0.22, -0.9]],
  },
  studio: {
    name: 'Studio room',
    about: 'A treated live room: short, tight and natural, for drums and bands.',
    preDelay: 0.004,
    build: 0.015,
    low: 0.85,
    high: 0.7,
    damp: 9000,
    reflections: [[0.004, 0.45, -0.4], [0.007, 0.4, 0.5], [0.011, 0.3, -0.2], [0.016, 0.22, 0.3]],
  },
  plate: {
    name: 'Plate',
    about: 'A steel plate: dense, bright and smooth at once, no room in it. Vocals, snares.',
    preDelay: 0,
    build: 0.002,
    low: 0.8,
    high: 0.9,
    damp: 11000,
    reflections: [],
  },
  lush: {
    ...HALL,
    name: 'Lush',
    about: 'A smooth, dense, slowly shimmering tail with no hard echoes. Pads, ballads, ambient; light on the computer even when long.',
    low: 1.25,
    high: 0.55,
    // (As before every style had: the lush reverb runs at half the sample rate, on what's under it)
    damp: 5500,
    algorithmic: true,
  },
};

export const ROOM_STYLE_IDS = Object.keys(ROOM_STYLES) as RoomStyle[];

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
 * The rate every room is made at. At any other, a room is this one resampled (roomAtRate): made
 * sample by sample at each rate, the same seeded noise landed at other moments, so each rate had
 * another room (a note's body through a guitar's studio room or a harp's stage was up to 6.5 dB
 * louder or quieter at 96 kHz than at 44.1 kHz, and a reverb's tail 2 to 6 dB), and a song heard
 * at 48 kHz didn't sound as its 44.1 kHz export.
 */
export const ROOM_RATE = 44100;

type Channels = Float32Array<ArrayBuffer>[];
type Pair = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];
/** Samples worked out between pauses when a room is made while the page plays (see madeSoon). */
const PIECE = 0x4000;
/** A room made at once: no pauses. */
const AT_ONCE = Infinity;
/**
 * The resampling sinc's zero crossings each side for a room (see resampleOnce): half the usual, so
 * half the work, the room within 0.003 dB to 18 kHz (its top is soaked up: the song's reverb is fed
 * through a low-pass at 5.5 to 11 kHz, the Reverb insert's tail goes through its tone low-pass, the
 * guitars' studio room hears an amp's speaker or a dull recording).
 */
const ROOM_KERNEL = 12;

/** Run `steps` to its end at once: what it gives. */
function drain<T>(steps: Generator<void, T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/**
 * `channels`, a room's impulse response made at ROOM_RATE, at `rate`: resampled (band-limited,
 * see resampleOnce and ROOM_KERNEL) to `length` samples and scaled by ROOM_RATE / rate, so it's the
 * same room, as loud, below 18 kHz (a convolution adds one product per sample of the response: at twice the rate,
 * twice as many; left at its energy, a room was 6.8 dB louder at 96 kHz, and made as loud on noise,
 * still 1.4 dB louder or quieter here and there). At ROOM_RATE, the channels themselves.
 */
export function roomAtRate<T extends Channels>(channels: T, rate: number, length?: number): T {
  return drain(roomAtRateSteps(channels, rate, length, AT_ONCE));
}

/** roomAtRate in pieces of `piece` samples (see madeSoon): the same, sample for sample. */
function* roomAtRateSteps<T extends Channels>(channels: T, rate: number, length: number | undefined, piece: number): Generator<void, T> {
  if (rate === ROOM_RATE) return channels;
  const once = onceResampler(channels, ROOM_RATE, rate, length, ROOM_KERNEL, ROOM_RATE / rate);
  for (let i = 0; i < once.length; i += piece) {
    once.run(i, i + piece);
    if (i + piece < once.length) yield;
  }
  return once.outs as T;
}

/** Rooms made lately, by what they were made from, most recent last (see madeOnce). */
const made = new Map<string, Channels>();
/** Samples (both sides) kept in `made` at most: about 16 MB, the longest reverb at 96 kHz. */
const MADE_MOST = 4_000_000;
/** The rooms being made while the page plays (see madeSoon), by key. */
const making = new Map<string, Promise<Channels>>();
/** Rooms an export holds on to while its sound is set up (see prepareRooms): kept however many others are made. */
const held = new Map<string, number>();
/** Milliseconds of making a room before the page gets a turn (see madeSoon). */
const TURN_MS = 6;

/** Keep `room` as `key`'s, letting the least lately used go past MADE_MOST (never one held). */
function keep<T extends Channels>(key: string, room: T): T {
  made.delete(key);
  made.set(key, room);
  let kept = 0;
  for (const r of made.values()) kept += r.reduce((n, c) => n + c.length, 0);
  for (const [k, r] of made) {
    if (kept <= MADE_MOST) break;
    if (k === key || held.has(k)) continue;
    kept -= r.reduce((n, c) => n + c.length, 0);
    made.delete(k);
  }
  return room;
}

/**
 * The room `key` names, made at once by `steps` unless it was lately: a song's reverb and each
 * track's Reverb insert at the same decay, live and in an export at the same rate, share one. Kept
 * as made: those using it copy it (into an AudioBuffer), never change it.
 */
function madeOnce<T extends Channels>(key: string, steps: (piece: number) => Generator<void, T>): T {
  const have = made.get(key);
  return keep(key, (have as T | undefined) ?? drain(steps(AT_ONCE)));
}

/**
 * madeOnce, while the page plays: made a few milliseconds at a time, the page getting a turn
 * between (a long room at 96 kHz takes a few tenths of a second to make, which held up the page
 * and the notes it hands out). The room is the same, sample for sample.
 */
function madeSoon<T extends Channels>(key: string, steps: (piece: number) => Generator<void, T>): Promise<T> {
  const have = made.get(key);
  if (have) return Promise.resolve(keep(key, have as T));
  const going = making.get(key);
  if (going) return going as Promise<T>;
  const job = (async () => {
    const run = steps(PIECE);
    let from = performance.now();
    for (;;) {
      const r = run.next();
      if (r.done) return keep(key, r.value);
      if (performance.now() - from >= TURN_MS) {
        await pageTurn();
        from = performance.now();
      }
    }
  })();
  making.set(key, job);
  const done = () => void making.delete(key);
  job.then(done, done);
  return job;
}

/**
 * Let the page have a turn (whatever's waiting: a click, a frame, the notes handed out) and carry
 * on straight after: a message to itself, not a timer, which a page in a background tab waits up to
 * a second for (an export from a page out of sight would have taken minutes over a long room).
 */
function pageTurn(): Promise<void> {
  if (typeof MessageChannel !== 'function') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * The rooms being made now, a few milliseconds at a time (see madeSoon): Play waits for them
 * (liveTracks.ts liveSoundsReady), so a song's first notes are heard in their rooms, as exported.
 */
export const roomsMaking = (): Promise<unknown>[] => [...making.values()];

/** A room an export will want (see prepareRooms). */
export type RoomWish = { style: RoomStyle; decay: number; lowLevel?: number } | { insert: number } | 'stage';

/**
 * Make the rooms an export at `rate` will want, a few milliseconds at a time (see madeSoon), so
 * setting up its sound (which takes them at once, as roomChannels and the rest do) doesn't hold
 * up the page: away from 44.1 kHz a long room takes longer to make than it did, being made there
 * and resampled. Each is kept until the returned function is called. At 44.1 kHz, nothing to do.
 */
export async function prepareRooms(rate: number, wishes: readonly RoomWish[], signal?: AbortSignal): Promise<() => void> {
  if (rate === ROOM_RATE) return () => {};
  const keys: string[] = [];
  const release = () => {
    for (const key of keys.splice(0)) {
      const n = (held.get(key) ?? 1) - 1;
      if (n > 0) held.set(key, n);
      else held.delete(key);
    }
  };
  // (an export called off while its rooms are made lets go of the ones it holds: they'd stay for good)
  try {
    for (const wish of wishes) {
      signal?.throwIfAborted();
      const key = wish === 'stage' ? stageKey(rate) : 'insert' in wish ? insertKey(wish.insert, rate) : roomKey(wish.style, wish.decay, rate, wish.lowLevel ?? 1.6);
      if (keys.includes(key)) continue;
      keys.push(key);
      held.set(key, (held.get(key) ?? 0) + 1);
      if (wish === 'stage') await madeSoon(key, (piece) => stageSteps(rate, piece));
      else if ('insert' in wish) await madeSoon(key, (piece) => insertSteps(wish.insert, rate, piece));
      else await madeSoon(key, (piece) => roomSteps(wish.style, wish.decay, rate, wish.lowLevel ?? 1.6, piece));
    }
    signal?.throwIfAborted();
  } catch (err) {
    release();
    throw err;
  }
  return release;
}

/**
 * The impulse response's two channels for `style` with a middle decay of `decay` seconds (to
 * -60 dB), at `sampleRate`: made at ROOM_RATE (see roomAtRate). Its total energy at ROOM_RATE is 1
 * (ROOM_RATE / sampleRate at another rate: the same loudness), so changing style or decay keeps
 * the reverb's level about the same. It lasts until every band has fallen 60 dB (see roomSeconds),
 * and ends with a short fade. `lowLevel`: how loud its lows are against its middle (a room's
 * warmth). Shared with others asking for the same room: read it, don't change it.
 */
export function roomChannels(style: RoomStyle, decay: number, sampleRate: number, lowLevel = 1.6): Pair {
  return madeOnce(roomKey(style, decay, sampleRate, lowLevel), (piece) => roomSteps(style, decay, sampleRate, lowLevel, piece));
}

/** roomChannels made while the page plays, a few milliseconds at a time (see madeSoon). */
export function roomChannelsSoon(style: RoomStyle, decay: number, sampleRate: number, lowLevel = 1.6): Promise<Pair> {
  return madeSoon(roomKey(style, decay, sampleRate, lowLevel), (piece) => roomSteps(style, decay, sampleRate, lowLevel, piece));
}

const roomKey = (style: RoomStyle, decay: number, sampleRate: number, lowLevel: number) => `${style} ${decay} ${lowLevel} ${sampleRate}`;

function* roomSteps(style: RoomStyle, decay: number, sampleRate: number, lowLevel: number, piece: number): Generator<void, Pair> {
  return yield* roomAtRateSteps(yield* makeRoom(style, decay, lowLevel, piece), sampleRate, roomLength(style, decay, sampleRate), piece);
}

/** The guitars' studio room's decay (seconds to fall 60 dB, its middle; its highs die sooner: samplerManager.ts studioChain). */
export const STUDIO_DECAY = 0.45;

/**
 * Make, a few milliseconds at a time, the rooms the page is likely to want first at `rate`: a Reverb
 * insert at its first decay (`insertDecay`), the guitars' studio room and the stage, so the first
 * of each is there at once.
 */
export function prepareFirstRooms(rate: number, insertDecay: number): void {
  void insertRoomChannelsSoon(insertDecay, rate)
    .then(() => roomChannelsSoon('studio', STUDIO_DECAY, rate))
    .then(() => madeSoon(stageKey(rate), (piece) => stageSteps(rate, piece)))
    .catch(() => undefined);
}

/**
 * The level a convolver that normalizes its response gives `style`'s room at a middle decay of
 * `decay` as made at ROOM_RATE (the browser's calibration, -58 dB, over the response's power per
 * sample, the room's energy being 1). The song's reverb gives its room this level itself at every
 * other rate: worked out by the browser on the resampled room, it came out 0.07 to 0.15 dB louder
 * than at 44.1 kHz (resampling leaves out the little the room has above 18 kHz).
 */
export function normalizedLevel(style: RoomStyle, decay: number): number {
  return CONVOLVER_CALIBRATION * Math.sqrt(2 * roomLength(style, decay, ROOM_RATE));
}
/** The browser's convolver calibration (a normalized response's level per unit of power): -58 dB, as Chromium has it. */
const CONVOLVER_CALIBRATION = 10 ** (-58 / 20);

/** How many samples `style`'s room at a middle decay of `decay` lasts at `sampleRate` (see roomSeconds). */
const roomLength = (style: RoomStyle, decay: number, sampleRate: number) => Math.max(1, Math.round(roomSeconds(style, decay) * sampleRate));

/** Where the tail's noise and filters stand between pieces of a room (see roomTail). */
interface TailState {
  /** The noise's state (see roomTail) */
  s: number;
  lp: number;
  lp2: number;
  eLow: number;
  eMid: number;
  eHigh: number;
}

/** What shapes a room's tail (see makeRoom): fixed for the room. */
interface TailShape {
  start: number;
  build: number;
  cLow: number;
  cHigh: number;
  fLow: number;
  fMid: number;
  fHigh: number;
  lowLevel: number;
}

/**
 * Samples i0 to i1 of a room's tail into `data`, carrying on from `st`: noise split into low,
 * middle and high, each dying away at its own rate, swelling in over `build`. The noise is a
 * repeatable one (xorshift from a fixed seed: the same room every time it's built), worked out in
 * the loop (a function call a sample made the room three times as slow to make the first time).
 */
function roomTail(data: Float32Array, st: TailState, i0: number, i1: number, t: TailShape): void {
  const { start, build, cLow, cHigh, fLow, fMid, fHigh, lowLevel } = t;
  let { s, lp, lp2, eLow, eMid, eHigh } = st;
  for (let i = i0; i < i1; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const x = (s >>> 0) / 2147483648 - 1;
    // Split the noise: low, high, and what's between
    lp += cLow * (x - lp);
    lp2 += cHigh * (x - lp2);
    const low = lp;
    const high = x - lp2;
    const mid = lp2 - lp;
    // The tail swells in over `build`, as reflections pile up
    const k = i - start;
    const swell = k < build ? (k / build) ** 2 : 1;
    data[i] = swell * (low * eLow * lowLevel + mid * eMid + high * eHigh * 0.8);
    eLow *= fLow;
    eMid *= fMid;
    eHigh *= fHigh;
  }
  Object.assign(st, { s, lp, lp2, eLow, eMid, eHigh });
}

/** The room, made sample by sample at ROOM_RATE (see roomAtRate), in pieces of `piece` samples. */
function* makeRoom(style: RoomStyle, decay: number, lowLevel: number, piece: number): Generator<void, Pair> {
  const sampleRate = ROOM_RATE;
  const room = style === 'lush' ? HALL : (ROOM_STYLES[style] ?? HALL);
  const rt = Math.max(0.2, decay);
  const seconds = roomSeconds(style, decay);
  const n = Math.max(1, Math.round(seconds * sampleRate));
  // The time each band has to fall 60 dB: its own, or less if that would run past the end
  const room60 = seconds - room.preDelay - END_FADE;
  const t60 = (k: number) => Math.min(rt * k, room60);
  const out: Pair = [new Float32Array(n), new Float32Array(n)];
  // Per sample, how much each band falls (to -60 dB over its decay time)
  const fall = (t60: number) => Math.exp(-6.908 / (t60 * sampleRate));
  const shape: TailShape = {
    start: Math.round(room.preDelay * sampleRate),
    build: Math.max(1, Math.round(room.build * sampleRate)),
    // Crossovers between the low, middle and high bands of the tail (one-pole filters)
    cLow: 1 - Math.exp((-2 * Math.PI * 300) / sampleRate),
    cHigh: 1 - Math.exp((-2 * Math.PI * 4000) / sampleRate),
    fLow: fall(t60(room.low)),
    fMid: fall(t60(1)),
    fHigh: fall(t60(room.high)),
    lowLevel,
  };
  for (let c = 0; c < 2; c++) {
    const data = out[c];
    const st: TailState = { s: (c === 0 ? 0x1234567 : 0x7654321) >>> 0 || 1, lp: 0, lp2: 0, eLow: 1, eMid: 1, eHigh: 1 };
    for (let i = shape.start; i < n; i += piece) {
      roomTail(data, st, i, Math.min(n, i + piece), shape);
      if (i + piece < n) yield;
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

/** How long the stage's response lasts (seconds). */
const STAGE_SECONDS = 0.9;

/**
 * A small concert stage heard from a few metres, in stereo, around an instrument recorded in a dead
 * room (samplerManager.ts stageChain): a dozen early reflections from 6 to 45 ms (the floor, the
 * side walls and the shell behind the player, each a little duller and from one side or the
 * other) and a diffuse tail dying away over about 0.8 s (60 dB), its highs going first as air and
 * walls take them. Its energy at ROOM_RATE is the direct sound's, so the instrument's `room` sets
 * the level. The same every time (a seeded noise), and the same stage at every rate (made at
 * ROOM_RATE, see roomAtRate). Shared: read it, don't change it.
 */
export function stageChannels(rate: number): Pair {
  return madeOnce(stageKey(rate), (piece) => stageSteps(rate, piece));
}

const stageKey = (rate: number) => `stage ${rate}`;
const stageSteps = (rate: number, piece: number) => roomAtRateSteps(makeStage(), rate, Math.round(rate * STAGE_SECONDS), piece);

/** The stage, made sample by sample at ROOM_RATE (see stageChannels). */
function makeStage(): Pair {
  const rate = ROOM_RATE;
  const length = Math.round(rate * STAGE_SECONDS);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let seed = 0x5eed;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // The early reflections: [ms, gain, side (-1 left .. 1 right)]
  const early: Array<[number, number, number]> = [
    [6, 0.55, 0], [11, 0.42, -0.8], [13, 0.4, 0.8], [17, 0.3, -0.4], [21, 0.33, 0.5], [24, 0.25, -0.9],
    [28, 0.24, 0.9], [31, 0.2, -0.2], [35, 0.18, 0.4], [38, 0.15, -0.6], [42, 0.13, 0.7], [45, 0.12, -0.3],
  ];
  for (const [ms, g, side] of early) {
    const i = Math.round((ms / 1000) * rate);
    // a little duller each time: three samples' smear
    for (let k = -1; k <= 1; k++) {
      const w = k === 0 ? 0.5 : 0.25;
      left[i + k] += g * w * Math.sqrt((1 - side) / 2) * 1.2;
      right[i + k] += g * w * Math.sqrt((1 + side) / 2) * 1.2;
    }
  }
  // The tail: noise from 20 ms, its level falling 60 dB in 0.8 s, low-passed ever lower (8 kHz to 2 kHz)
  const begin = Math.round(0.02 * rate);
  let lpL = 0;
  let lpR = 0;
  for (let i = begin; i < length; i++) {
    const t = (i - begin) / rate;
    const env = 0.11 * Math.min(1, t / 0.03) * 10 ** ((-60 * t) / 0.8 / 20);
    const cutoff = 8000 * 0.25 ** Math.min(1, t / 0.6);
    const c = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
    lpL += c * ((random() * 2 - 1) - lpL);
    lpR += c * ((random() * 2 - 1) - lpR);
    left[i] += env * lpL * 1.7;
    right[i] += env * lpR * 1.7;
  }
  // Its energy set to the direct sound's (1): `room` dB then says how much of it there is
  let energy = 0;
  for (let i = 0; i < length; i++) energy += (left[i] * left[i] + right[i] * right[i]) / 2;
  const scale = 1 / Math.sqrt(energy);
  for (let i = 0; i < length; i++) {
    left[i] *= scale;
    right[i] *= scale;
  }
  return [left, right];
}

/**
 * The room a track's own Reverb insert plays (spaceFx.ts): the chamber, a room close and clear,
 * its highs dying sooner than its middle and its lows a little later, with its early reflections.
 * (The insert was a plain noise tail fading at one rate at every frequency: a hiss in a tunnel.)
 */
export const INSERT_ROOM: RoomStyle = 'chamber';

/**
 * How loud an impulse response makes a sound with a music-like balance (more in the lows, as
 * pink noise has, the same power in every octave, but not the sub-bass): its energy through a
 * pinking filter (an economical three-pole one) and a gentle low cut, run on until both have
 * rung out.
 */
export function pinkEnergy(x: Float32Array, sampleRate = 48000): number {
  let [b0, b1, b2] = [0, 0, 0];
  // (Under the bass: a one-pole high-pass at 200 Hz, so the match is made where parts sit)
  const k = Math.exp((-2 * Math.PI * 200) / sampleRate);
  let lp = 0;
  let sum = 0;
  const n = x.length + 8192;
  for (let i = 0; i < n; i++) {
    const w = i < x.length ? x[i] : 0;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    const p = b0 + b1 + b2 + w * 0.1848;
    lp = p + (lp - p) * k;
    const y = p - lp;
    sum += y * y;
  }
  return sum;
}

/** The pinking filter's own energy (a click's): what a flat, white tail of energy 1 brings through it */
const pinkWhite = new Map<number, number>();

/**
 * The insert's impulse response at a middle decay of `decay` seconds: INSERT_ROOM's, scaled to be
 * as loud on music as the plain noise tail it replaced was (a flat tail of energy 1 a side), so a
 * song's Reverb inserts keep their level.
 */
export function insertRoomChannels(decay: number, sampleRate: number): Pair {
  return madeOnce(insertKey(decay, sampleRate), (piece) => insertSteps(decay, sampleRate, piece));
}

/** insertRoomChannels made while the page plays, a few milliseconds at a time (see madeSoon). */
export function insertRoomChannelsSoon(decay: number, sampleRate: number): Promise<Pair> {
  return madeSoon(insertKey(decay, sampleRate), (piece) => insertSteps(decay, sampleRate, piece));
}

const insertKey = (decay: number, sampleRate: number) => `insert ${decay} ${sampleRate}`;

function* insertSteps(decay: number, sampleRate: number, piece: number): Generator<void, Pair> {
  // (Its lows no louder than its middle: the plain tail had none extra, and a track's own room
  // shouldn't make its bass boom more than it did. Matched at ROOM_RATE, then taken to the rate:
  // the pinking filter's sums are per sample)
  const out = yield* makeRoom(INSERT_ROOM, decay, 1, piece);
  let white = pinkWhite.get(ROOM_RATE);
  if (white === undefined) {
    const click = new Float32Array(1);
    click[0] = 1;
    white = pinkEnergy(click, ROOM_RATE);
    pinkWhite.set(ROOM_RATE, white);
  }
  const g = Math.sqrt((2 * white) / (pinkEnergy(out[0], ROOM_RATE) + pinkEnergy(out[1], ROOM_RATE)));
  for (const d of out) for (let i = 0; i < d.length; i++) d[i] *= g;
  return yield* roomAtRateSteps(out, sampleRate, roomLength(INSERT_ROOM, decay, sampleRate), piece);
}
