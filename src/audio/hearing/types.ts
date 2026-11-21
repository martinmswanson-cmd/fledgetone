/**
 * The shapes of the sound report the hearing work produces (a fuller description of a sound, for an
 * agent that cannot hear it): one interface per group of findings, the faults, the time-resolved
 * "along" grids the pictures are drawn from, and the versions each group's rules are at. Types only.
 */
import type { BandSpectrum } from '../mixAnalysis';

/** Each group's rule version; raised whenever that group's numbers or thresholds change. */
export const HEARING_VERSIONS = { tone: 1, texture: 1, movement: 1, dynamics: 1, attack: 1, stereo: 1, pitch: 1, faults: 1 } as const;
export type HearingGroup = keyof typeof HEARING_VERSIONS;

/**
 * Where in a song: always seconds, and the bar and beat when the song's grid is known (the agent's
 * bars of four quarter notes and their quarter-note beats). Where the musician's ruler counts
 * otherwise (another meter, or measures out of line with bars after a meter change), also the
 * measure and beat the ruler shows.
 */
export interface Place {
  seconds: number;
  bar?: number;
  beat?: number;
  ruler?: { measure: number; beat: number };
}

/** The balance of the spectrum. */
export interface Tone {
  spectrum: BandSpectrum;
  regions: Array<{ name: string; db: number }>;
  centreHz: number;
  tiltDbPerOctave: number;
  rolloffHz: number;
  subVsBassDb: number;
  peaks: Array<{ hz: number; overDb: number }>;
}

/** Tonal against noisy, smooth against rough. */
export interface Texture {
  flatness: number;
  roughness: number;
  percussiveShare: number;
  flatTops: { share: number; levelDb: number } | null;
}

/** A slow wobble of one band's level. */
export interface Modulation {
  band: 'low' | 'mid' | 'high';
  hz: number;
  depthDb: number;
  note?: string;
}

/** How the sound changes over its length. */
export interface Movement {
  changeDb: number;
  modulations: Modulation[];
}

/** Loudness; null where the sound is too short or too quiet to measure. */
export interface Dynamics {
  lufs: number | null;
  shortTermMaxLufs: number | null;
  truePeakDbtp: number | null;
  crestDb: number | null;
  rangeLu: number | null;
}

/** How hard the sound starts. */
export interface Attack {
  onsetsPerSecond: number;
  riseMs: number | null;
  single: { riseMs: number; fall20Ms: number; peakDb: number } | null;
}

/** The stereo picture. */
export interface Stereo {
  correlation: number;
  balanceDb: number;
  monoLossDb: number;
  width: Array<{ name: string; db: number }>;
  lowSideDb: number;
}

/** Tempo, key and tuning. */
export interface Pitch {
  tempo: { bpm: number; confidence: number; alternative: number } | null;
  tempoKnown: boolean;
  key: { name: string; confidence: number; runnerUp: string } | null;
  tuningCents: number | null;
  chroma: number[];
}

export type FaultKind = 'click' | 'clipping' | 'dc' | 'hum' | 'silence' | 'channel';

/** Something wrong with the sound, and where. */
export interface Fault {
  kind: FaultKind;
  seconds: number | null;
  endSeconds?: number;
  count?: number;
  value?: number;
  channel?: 'left' | 'right';
  at?: Place;
  detail: string;
}

/** The sound over time, on a coarse grid: spectra of middle and sides, loudness and pitch classes. */
export interface Along {
  stepSeconds: number;
  freqs: number[];
  mid: number[][];
  side: number[][];
  lufs: Array<number | null>;
  chroma: number[][];
}

/** The whole report. */
export interface SoundReport {
  versions: Record<HearingGroup, number>;
  engine: string;
  settings: { sampleRate: number; knownKey?: string; stretch?: { fromSeconds: number; toSeconds: number; fromSaved?: boolean } };
  seconds: number;
  channels: 1 | 2;
  silent: boolean;
  tone?: Tone;
  texture?: Texture;
  movement?: Movement;
  dynamics?: Dynamics;
  attack?: Attack;
  stereo?: Stereo;
  pitch?: Pitch;
  faults: Fault[];
  along: Along;
  words: string[];
}
