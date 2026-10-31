/**
 * The plain names of a track's inserts, their settings and the master's parts, as the studio says
 * them on a suggestion's card (What changes, songDiff.ts, and the cautions, ops.ts), never the
 * song file's keys ("monoLow freq", "mbc lowFreq", "master ott depth").
 */
import { plainToken } from './agentText';

/** Each insert by its key (TrackFx). */
export const INSERT_LABELS: Readonly<Record<string, string>> = {
  distortion: 'Distortion',
  compressor: 'Compressor',
  chorus: 'Chorus',
  filter: 'Filter',
  pump: 'Pump',
  lofi: 'Lo-fi',
  gate: 'Gate',
  echo: 'Delay',
  reverb: 'Reverb',
  human: 'Human',
  peq: 'Parametric EQ',
  mbc: 'Multiband compressor',
  saturate: 'Saturation',
  monoLow: 'Mono bass',
  bassDrive: 'Bass Drive',
};

/** Each of the master's parts with settings of their own (MasterSettings), as songDiff's master sentences name them. */
export const MASTER_PART_LABELS: Readonly<Record<string, string>> = {
  ott: 'OTT',
  width: 'stereo width',
  loud: 'Loud',
  clipper: 'clipper',
};

/** The settings of the inserts and the master's parts, by key. */
const SETTING_WORDS: Readonly<Record<string, string>> = {
  amount: 'amount',
  threshold: 'threshold',
  ratio: 'ratio',
  makeup: 'makeup gain',
  rate: 'rate',
  depth: 'depth',
  mix: 'mix',
  type: 'type',
  cutoff: 'cutoff',
  resonance: 'resonance',
  slope: 'slope',
  release: 'release',
  attack: 'attack',
  trigger: 'trigger',
  source: 'track it follows',
  shape: 'shape',
  points: 'drawn shape',
  crush: 'crush',
  tone: 'tone',
  wow: 'wow',
  length: 'length',
  time: 'time',
  feedback: 'feedback',
  pingPong: 'ping-pong',
  decay: 'decay',
  preDelay: 'pre-delay',
  timing: 'timing',
  dynamics: 'dynamics',
  pitch: 'pitch',
  bands: 'bands',
  lowFreq: 'low crossover',
  highFreq: 'high crossover',
  freq: 'frequency',
  crossover: 'crossover',
  drive: 'drive',
  character: 'character',
  target: 'target',
  push: 'push',
  subTilt: 'sub tilt',
  crunch: 'crunch',
  split: 'split',
  inGain: 'input gain',
  outGain: 'output gain',
  monoBass: 'mono bass',
  softness: 'softness',
  ceiling: 'ceiling',
};

/**
 * The settings with choices, by key, each choice in the words the studio's menus use ("low-pass",
 * "kick and snare", "1/8 dotted"), never the song file's ("lowpass", "kickSnare", "1/8d").
 */
const CHOICE_WORDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  type: { lowpass: 'low-pass', highpass: 'high-pass', bandpass: 'band-pass', lowcut: 'low cut', lowshelf: 'low shelf', bell: 'bell', notch: 'notch', highshelf: 'high shelf', highcut: 'high cut' },
  slope: { 12: '12 dB', 24: '24 dB' },
  trigger: { kick: 'kick', snare: 'snare', kickSnare: 'kick and snare', beat: 'every beat', eighth: 'every 8th note', track: 'a track' },
  shape: { smooth: 'smooth', hard: 'hard cut', tick: 'short tick', swell: 'long swell', hole: 'hole for drums', drawn: 'drawn' },
  time: { '1/32': '1/32', '1/16t': '1/16 triplet', '1/16': '1/16', '1/8t': '1/8 triplet', '1/16d': '1/16 dotted', '1/8': '1/8', '1/4t': '1/4 triplet', '1/8d': '1/8 dotted', '1/4': '1/4', '1/4d': '1/4 dotted', '1/2': '1/2' },
  rate: { '1/8': '1/8', '1/8T': '1/8 triplet', '1/16': '1/16', '1/16T': '1/16 triplet', '1/32': '1/32' },
  character: { tube: 'warm tube', hard: 'hard clip', fold: 'fold', crush: 'bitcrush' },
  target: { streaming: 'streaming (-14 LUFS)', loud: 'loud (-9 LUFS)', club: 'club (-6 LUFS)' },
  glue: { standard: 'standard', gentle: 'gentle', punchy: 'punchy', tight: 'tight', off: 'off' },
};

/** `table`'s own entry for `key` (never a name every object has: "toString", "constructor"). */
const own = <T>(table: Readonly<Record<string, T>> | undefined, key: string): T | undefined => (table && Object.hasOwn(table, key) ? table[key] : undefined);

/**
 * A setting's value in words: on or off for a switch, a choice as the menus name it (CHOICE_WORDS),
 * a number as it is; null when it isn't plain (a text an agent could have written).
 */
export function valueWord(key: string, value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  // (a number is a choice only for the Filter's slope: the Chorus rate, the OTT time are numbers)
  const word = typeof value === 'string' || (typeof value === 'number' && key === 'slope') ? own(own(CHOICE_WORDS, key), String(value)) : undefined;
  return word ?? plainToken(value);
}

/** An insert's name: "Delay" for echo, "Mono bass" for monoLow. */
export const insertLabel = (key: string): string => own(INSERT_LABELS, key) ?? plainKey(key) ?? 'insert';

/** A master part's name: "OTT", "stereo width". */
export const masterPartLabel = (key: string): string => own(MASTER_PART_LABELS, key) ?? plainKey(key) ?? 'part';

/** A setting's name in words: "low crossover" for lowFreq, "pre-delay" for preDelay; a key not known here split into words; null when it isn't plain. */
export function settingWord(key: string): string | null {
  return own(SETTING_WORDS, key) ?? plainKey(key);
}

/** A key the studio has no name for, in words ("someSetting" is "some setting"), or null when it isn't plain (an agent could have written it). */
function plainKey(key: string): string | null {
  const token = plainToken(key, 40);
  return token === null ? null : token.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}
