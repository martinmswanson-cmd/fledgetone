/**
 * The shapes of the sound report the hearing work produces (a fuller description of a sound, for an
 * agent that cannot hear it): one interface per group of findings, the faults, the time-resolved
 * "along" grids the pictures are drawn from, and the versions each group's rules are at. Types only.
 */
import type { BandSpectrum } from '../mixAnalysis';

/** Each group's rule version; raised whenever that group's numbers or thresholds change. */
export const HEARING_VERSIONS = { tone: 1, texture: 1, movement: 1, dynamics: 1, attack: 1, stereo: 1, pitch: 1, faults: 1, register: 1, space: 1 } as const;
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
  /**
   * 0 to 1 (2 places): the share of the onsets that stand out only above 5 kHz: 90% or more of the power
   * each adds, in the bands where it stands out, is there. Hats do, alone or over a held sound; a snare or a
   * noise burst does alone, but not over a held sound that masks its lower part. Absent when there are no
   * onsets, and from a hearing saved before it was measured
   */
  highShare?: number;
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

/**
 * How the sound sits in a space: how long its sounds ring on after they end, how much of it is tail, a
 * clear echo, and the width of the tails. Decays, the wet share and the width are null when fewer than
 * three notes or hits end (a held sound, a riff with no gaps, silence).
 */
export interface Space {
  /** The median time, ms, for the level to fall 20 dB from where a note or hit ends; null beside an echo when under 150 ms (the notes' own stop, under repeats that ring on) */
  decayMs: number | null;
  /** 0 to 1 (2 places): the share of the energy of the notes that end in their tails, after they end, rather than in the direct sound; null beside an echo when the decay is under 150 ms, as the decay is */
  wetShare: number | null;
  /** A clear echo: its delay, ms, how many repeats stand out where it is heard most clearly, and its note value at the known tempo */
  echo: { ms: number; repeats: number; note?: string } | null;
  /** Side over mid in the tails less side over mid in the direct sound, dB (1 place); null for one channel, when nothing ends, beside an echo, when the decay is under 150 ms (sounds that stop almost at once: no tail to have a width), or when the tails are digital silence */
  tailWiderDb: number | null;
}

/**
 * Where the pitched parts sit (a report has none when no pitched part is heard: drums, noise). Hz are
 * of the parts' fundamentals, weighted by their energy.
 */
export interface Register {
  /** The 10th percentile of the pitched energy's pitch */
  lowHz: number;
  /** The 90th percentile */
  highHz: number;
  /** The median */
  centreHz: number;
  /** The median over time of the highest prominent pitched part; null when no frame has one */
  topHz: number | null;
  /** The share of the pitched energy in each octave, C1 to C8 (8 numbers adding to 1, 2 places) */
  octaves: number[];
}

export type FaultKind = 'click' | 'clipping' | 'dc' | 'hum' | 'silence' | 'channel';

/**
 * Something wrong with the sound, and where. `seconds` (and `endSeconds`, `at.seconds`) are counted
 * from the start of the audio heard: the start of the bars of a song, and for an audio file the start
 * of the file, whatever stretch of it was heard. `value` by kind: a click's is the size of its jump
 * from one sample to the next, dBFS; clipping's its highest peak, dBFS; a DC offset's the offset,
 * dBFS; hum's its frequency, Hz; a quieter channel's how far it is under the other, dB.
 */
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

/**
 * The sound over time, on a coarse grid: spectra of middle and sides, loudness and pitch classes.
 * Row i covers the step that starts i steps after the start of the audio heard (after the start of
 * the stretch, `settings.stretch.fromSeconds`, when a stretch of a file was heard).
 */
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
  /**
   * `stretch`: the stretch of the file that was heard, in file time, when one was asked for (and
   * `fromSaved` when the report was made from a saved hearing's grids): the rows of `along` count
   * from its `fromSeconds`.
   */
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
  register?: Register;
  space?: Space;
  faults: Fault[];
  /**
   * The per-second grids: what the pictures are drawn from and what a stretch of a saved hearing is
   * read from. A saved hearing keeps them; a reply and `--json` leave them out (they are about 2 KB a
   * second), and a small hearing (one track of a per-track listen) never has them.
   */
  along?: Along;
  words: string[];
}
