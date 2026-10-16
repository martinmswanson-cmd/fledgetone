/**
 * Rap vocal chain presets: one click puts a ready vocal chain on an audio track, made of the
 * track's own inserts (EQ, Pro EQ, Compressor, Multiband, Bass Drive, Delay, Reverb...) with
 * settings, named by how they sound. Applying one replaces that track's built-in inserts and
 * nothing else (its volume, sends, plugins and clips stay); the Ad-lib chain also pans the track a
 * little off centre, as ad-libs sit. Pure, so Node tests it (scripts/vocalChains.test.mjs).
 *
 * The inserts play in the strip's fixed order (trackStrip.ts), which is already a vocal engineer's
 * order: saturation, then EQ (low cut, mud out, presence in), the compressor, the multiband as a
 * de-esser (only its top band, above about 6 kHz, works: it tames the S's the brightening and the
 * compression bring up), then the chorus, lo-fi, filter, delay and reverb.
 */
import type { PeqBand, Track, TrackEq, TrackFx } from './timelineTypes';
import { defaultTrackFx, normalizeTrackFx } from './timelineTypes';
import { defaultBassDrive } from './bassTools';

/** The vocal chain presets, by sound. */
export const VOCAL_CHAIN_IDS = ['clean', 'aggressive', 'adlib', 'phone', 'darkWide', 'stack'] as const;
export type VocalChainId = (typeof VOCAL_CHAIN_IDS)[number];

/** A vocal chain: the inserts that are on, with their settings (every other insert off). */
export interface VocalChain {
  id: VocalChainId;
  name: string;
  /** One line on how it sounds and what it's for */
  description: string;
  /** The inserts it switches on, each with its settings (merged over the defaults) */
  fx: Partial<{ [K in keyof TrackFx]: Partial<NonNullable<TrackFx[K]>> }>;
  /** The 3-band EQ (flat in every chain: the Pro EQ does the shaping) */
  eq?: TrackEq;
  /** The track's pan, when the chain sets one (an ad-lib sits off centre) */
  pan?: number;
}

const band = (type: PeqBand['type'], freq: number, gain = 0, q = 1): PeqBand => ({ on: true, type, freq, gain, q });

/** The multiband compressor as a de-esser: only the band above `from` Hz is squeezed, hard and fast. */
const deEsser = (from: number, threshold: number, ratio: number): Partial<TrackFx['mbc']> => ({
  on: true,
  lowFreq: 200,
  highFreq: from,
  attack: 0.002,
  release: 0.08,
  bands: [
    { threshold: 0, ratio: 1, gain: 0, bypass: true },
    { threshold: 0, ratio: 1, gain: 0, bypass: true },
    { threshold, ratio, gain: 0 },
  ],
});

/** The presets. Levels were set by rendering a test voice through each (see GUIDE.md, Rap vocals). */
export const VOCAL_CHAINS: readonly VocalChain[] = [
  {
    id: 'clean',
    name: 'Clean lead',
    description: 'Clear and upfront: low cut, a little presence and air, steady compression, a short room.',
    fx: {
      peq: { on: true, bands: [band('lowcut', 90, 0, 0.71), band('bell', 300, -2.5, 1.2), band('bell', 3000, 1.5, 0.9), band('highshelf', 10000, 2.5, 0.7)] },
      compressor: { on: true, threshold: -32, ratio: 3.5, makeup: 3.5 },
      mbc: deEsser(6500, -40, 4),
      echo: { on: true, time: '1/4', feedback: 0.2, tone: 4000, pingPong: false, mix: 0.08 },
      reverb: { on: true, decay: 1.2, preDelay: 30, tone: 7000, mix: 0.12 },
    },
  },
  {
    id: 'aggressive',
    name: 'Aggressive lead',
    description: 'In your face: hard compression, bright, a little saturation, a tight slap and almost no room.',
    fx: {
      bassDrive: { on: true, crossover: 250, drive: 0.35, character: 'tube', mix: 0.35, tone: 9000 },
      peq: { on: true, bands: [band('lowcut', 120, 0, 0.71), band('bell', 350, -3, 1.2), band('bell', 2500, 0.5, 1), band('highshelf', 10000, 3, 0.7)] },
      compressor: { on: true, threshold: -42, ratio: 10, makeup: 4 },
      mbc: deEsser(5500, -48, 8),
      echo: { on: true, time: '1/16', feedback: 0.15, tone: 3500, pingPong: false, mix: 0.1 },
      reverb: { on: true, decay: 0.8, preDelay: 10, tone: 6000, mix: 0.07 },
    },
  },
  {
    id: 'adlib',
    name: 'Ad-lib',
    description: 'Thinner and off to the side, with a bouncing delay: the shouts and answers around the lead.',
    pan: 0.4,
    fx: {
      peq: { on: true, bands: [band('lowcut', 250, 0, 0.8), band('bell', 1200, 2, 1), band('highshelf', 8000, 2, 0.7), band('highcut', 12000, 0, 0.71)] },
      compressor: { on: true, threshold: -36, ratio: 5, makeup: 2.5 },
      mbc: deEsser(6000, -40, 5),
      echo: { on: true, time: '1/8d', feedback: 0.45, tone: 4000, pingPong: true, mix: 0.3 },
      reverb: { on: true, decay: 1.8, preDelay: 20, tone: 6000, mix: 0.15 },
    },
  },
  {
    id: 'phone',
    name: 'Phone / radio',
    description: 'Squeezed into the middle band, gritty and crushed: an intro, a skit or a hook that cuts through.',
    fx: {
      distortion: { on: true, amount: 0.25 },
      peq: { on: true, bands: [band('lowcut', 500, 0, 1), band('bell', 1500, 4, 0.8), band('highcut', 3200, 0, 1)] },
      compressor: { on: true, threshold: -38, ratio: 6, makeup: 4.5 },
      lofi: { on: true, crush: 0.25, tone: 6000, wow: 0.05, mix: 0.4 },
      filter: { on: true, type: 'lowpass', cutoff: 4000, resonance: 0.9, slope: 24 },
    },
  },
  {
    id: 'darkWide',
    name: 'Dark and wide',
    description: 'Warm and rounded, top end rolled off, chorus width, long ping-pong echoes and a big dark room.',
    fx: {
      peq: { on: true, bands: [band('lowcut', 100, 0, 0.71), band('bell', 250, 1.5, 1), band('highshelf', 6000, -4, 0.7), band('highcut', 9000, 0, 0.71)] },
      compressor: { on: true, threshold: -34, ratio: 4, makeup: 2 },
      chorus: { on: true, rate: 0.6, depth: 0.4, mix: 0.3 },
      echo: { on: true, time: '1/4', feedback: 0.35, tone: 2500, pingPong: true, mix: 0.2 },
      reverb: { on: true, decay: 3.2, preDelay: 40, tone: 4000, mix: 0.25 },
    },
  },
  {
    id: 'stack',
    name: 'Backing stack',
    description: 'Doubles and harmonies tucked behind the lead: thinner, glued by compression, chorused and in the room.',
    fx: {
      peq: { on: true, bands: [band('lowcut', 180, 0, 0.71), band('bell', 400, -3, 1), band('bell', 3000, -1.5, 1), band('highshelf', 9000, 1.5, 0.7)] },
      compressor: { on: true, threshold: -38, ratio: 6, makeup: 2.5 },
      mbc: deEsser(6000, -42, 5),
      chorus: { on: true, rate: 0.9, depth: 0.3, mix: 0.25 },
      reverb: { on: true, decay: 2, preDelay: 25, tone: 6000, mix: 0.22 },
    },
  },
];

/** A preset by id. */
export const vocalChain = (id: VocalChainId): VocalChain => VOCAL_CHAINS.find((c) => c.id === id) ?? VOCAL_CHAINS[0];

/** The inserts a chain makes: every one off but the chain's own, with its settings. */
export function vocalChainFx(id: VocalChainId): TrackFx {
  const chain = vocalChain(id);
  const base = defaultTrackFx();
  const raw: Record<string, unknown> = { ...base };
  for (const [key, patch] of Object.entries(chain.fx)) {
    const start = key === 'bassDrive' ? defaultBassDrive() : (base as unknown as Record<string, object>)[key];
    raw[key] = { ...start, ...patch };
  }
  // (normalizeTrackFx clamps every value to its range, as a project file's are)
  return normalizeTrackFx(raw);
}

/** The track with a chain on it: its built-in inserts and 3-band EQ replaced, and the pan where the chain sets one. */
export function withVocalChain(track: Track, id: VocalChainId): Track {
  const chain = vocalChain(id);
  return {
    ...track,
    fx: vocalChainFx(id),
    eq: chain.eq ?? { low: 0, mid: 0, high: 0 },
    ...(chain.pan !== undefined ? { pan: chain.pan } : {}),
  };
}

/** Which chain a track has on, if its inserts are exactly one of the presets (for showing it lit). */
export function matchingVocalChain(track: Pick<Track, 'fx' | 'eq'>): VocalChainId | null {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const chain of VOCAL_CHAINS) {
    if (same(normalizeTrackFx(track.fx), vocalChainFx(chain.id)) && same(track.eq, chain.eq ?? { low: 0, mid: 0, high: 0 })) return chain.id;
  }
  return null;
}
