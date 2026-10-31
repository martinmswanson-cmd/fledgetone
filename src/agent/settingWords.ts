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

/** An insert's name: "Delay" for echo, "Mono bass" for monoLow. */
export const insertLabel = (key: string): string => INSERT_LABELS[key] ?? plainKey(key) ?? 'insert';

/** A master part's name: "OTT", "stereo width". */
export const masterPartLabel = (key: string): string => MASTER_PART_LABELS[key] ?? plainKey(key) ?? 'part';

/** A setting's name in words: "low crossover" for lowFreq, "pre-delay" for preDelay; a key not known here split into words; null when it isn't plain. */
export function settingWord(key: string): string | null {
  return SETTING_WORDS[key] ?? plainKey(key);
}

/** A key the studio has no name for, in words ("someSetting" is "some setting"), or null when it isn't plain (an agent could have written it). */
function plainKey(key: string): string | null {
  const token = plainToken(key, 40);
  return token === null ? null : token.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}
