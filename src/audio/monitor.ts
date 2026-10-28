/**
 * The listening path: what's between the master section and the speakers, and only there (no
 * export ever goes through it). It does three things, in an AudioWorklet at the very end of the
 * live graph (after the loudness meter, so the meter shows what an export would measure):
 *   1. Level matching (on by default, a switch in the Master tab): the song is heard at about
 *      MONITOR_TARGET_LUFS short-term loudness whatever the master does, so pushing the master to
 *      Club loudness doesn't blast the listener and a quiet mix isn't buried. The gain follows the
 *      3 s loudness slowly: it never rises faster than MONITOR_RISE_DB_PER_S (a quiet part is
 *      brought up gently), falls faster, fast when the last 400 ms are far too loud, and at once
 *      when the last 50 ms are (a drop after a quiet intro). It holds still in silence, so it
 *      doesn't creep up between songs.
 *   2. The listening volume (the LISTEN slider in the header and the mixer), after the matching.
 *   3. A hard safety limiter with no look-ahead (no added delay): whatever the volume, nothing
 *      leaves louder than MONITOR_CEILING_DB.
 * The kernel is plain JavaScript (nothing from this module's scope) so the worklet embeds its
 * source, and Node tests it (scripts/monitor.test.mjs).
 */
import * as Tone from 'tone';
import { kWeightingFilters } from './loudness';
import { createWorkletNode, loadWorklet } from './worklets';

/** Where level matching puts the short-term loudness, LUFS. */
export const MONITOR_TARGET_LUFS = -15;
/** The fastest the matching gain rises, dB a second. */
export const MONITOR_RISE_DB_PER_S = 1;
/** How fast it falls when the song gets louder, dB a second. */
export const MONITOR_FALL_DB_PER_S = 6;
/** How fast it falls when the last 400 ms are more than MONITOR_MOMENTARY_HEADROOM over the target. */
export const MONITOR_FAST_FALL_DB_PER_S = 30;
export const MONITOR_MOMENTARY_HEADROOM = 6;
/** Over the last 50 ms: more than this over the target and the gain comes down at once (a kick's punch is well under it). */
export const MONITOR_FAST_HEADROOM = 8;
/** Its range: down to MONITOR_MIN_DB, up to MONITOR_MAX_DB. */
export const MONITOR_MIN_DB = -30;
export const MONITOR_MAX_DB = 6;
/** Where it starts (before it has heard anything): a little down, so a first Play is never loud. */
export const MONITOR_START_DB = -6;
/** Under this momentary loudness (LUFS) it's silence: the gain holds. */
export const MONITOR_SILENCE_LUFS = -50;
/** The safety limiter's ceiling, dBFS. */
export const MONITOR_CEILING_DB = -1;

export interface MonitorParams {
  /** 1: level matching on; 0: off (the gain glides back to 0 dB, rising no faster than its limit) */
  match: number;
  /** The listening volume, linear */
  volume: number;
  /** Where matching aims, LUFS */
  target: number;
}

export interface MonitorReading {
  /** The matching gain now, dB. */
  gainDb: number;
  /** The short-term loudness coming in (the master's), LUFS. */
  shortTerm: number;
  /** The most the safety limiter took off since the last reading, dB. */
  safetyDb: number;
  /** Whether the last 100 ms had sound in them (not silence: the song is playing). */
  sounding: boolean;
}

export interface MonitorKernel {
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, params: MonitorParams) => void;
  read: () => MonitorReading;
}

/**
 * The listening path's kernel at `sampleRate`, with the K-weighting filters `shelf` and `highpass`
 * ([b0, b1, b2, a1, a2] each, see kWeightingFilters in loudness.ts) and its constants passed in
 * (`c`), as the worklet has none of this module's.
 */
export function createMonitorKernel(
  sampleRate: number,
  shelf: readonly number[],
  highpass: readonly number[],
  c: { rise: number; fall: number; fastFall: number; headroom: number; fastHeadroom: number; min: number; max: number; start: number; silence: number; ceiling: number }
): MonitorKernel {
  const HOP = Math.round(sampleRate / 10);
  const SHORT = 30;
  const MOMENTARY = 4;
  const powers = new Float64Array(SHORT);
  let filled = 0;
  let at = 0;
  let acc = 0;
  let count = 0;
  // Filter states: [x1, x2, y1, y2] per filter per channel
  const st = new Float64Array(16);
  const filt = (x: number, b: readonly number[], o: number) => {
    const y = b[0] * x + b[1] * st[o] + b[2] * st[o + 1] - b[3] * st[o + 2] - b[4] * st[o + 3];
    st[o + 1] = st[o];
    st[o] = x;
    st[o + 3] = st[o + 2];
    st[o + 2] = y;
    return y;
  };
  const lufs = (p: number) => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);
  let gainDb = c.start;
  // The gain sample by sample follows gainDb closely (5 ms), so a change never clicks
  let g = Math.pow(10, gainDb / 20);
  let gLin = g;
  const gCoef = 1 - Math.exp(-1 / (0.005 * sampleRate));
  // A fast loudness (K-weighted power over about 50 ms): a loud part arriving pulls the gain down
  // at once, so nothing more than the headroom over the target gets through for longer than that
  let fast = 0;
  const fastCoef = 1 - Math.exp(-1 / (0.05 * sampleRate));
  let sinceCheck = 0;
  let vol = 1;
  let volSet = false;
  const volCoef = 1 - Math.exp(-1 / (0.02 * sampleRate));
  const ceiling = Math.pow(10, c.ceiling / 20);
  let safety = 1;
  const safetyRelease = 1 - Math.exp(-1 / (0.05 * sampleRate));
  let safetyMost = 1;
  let shortTerm = -Infinity;
  let sounding = false;
  const blockSeconds = HOP / sampleRate;

  /** A 100 ms block has been measured: the next gain. */
  const block = (power: number, p: MonitorParams) => {
    powers[at] = power;
    at = (at + 1) % SHORT;
    if (filled < SHORT) filled++;
    const mean = (n: number) => {
      let sum = 0;
      let used = 0;
      for (let k = 1; k <= Math.min(n, filled); k++) {
        const v = powers[(at - k + SHORT) % SHORT];
        // Silent blocks don't count (a song's gaps, or before it starts)
        if (lufs(v) < c.silence) continue;
        sum += v;
        used++;
      }
      return used ? sum / used : 0;
    };
    const momentary = lufs(mean(MOMENTARY));
    shortTerm = lufs(mean(SHORT));
    let wanted = gainDb;
    const silent = !(lufs(power) >= c.silence);
    sounding = !silent;
    if (!p.match) wanted = 0;
    else if (!silent && Number.isFinite(shortTerm)) wanted = Math.max(c.min, Math.min(c.max, p.target - shortTerm));
    let fall = c.fall;
    if (p.match && !silent && Number.isFinite(momentary) && momentary + gainDb > p.target + c.headroom) {
      wanted = Math.min(wanted, p.target + c.headroom - momentary);
      fall = c.fastFall;
    }
    if (wanted > gainDb) gainDb = Math.min(wanted, gainDb + c.rise * blockSeconds);
    else gainDb = Math.max(wanted, gainDb - fall * blockSeconds);
  };
  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, p: MonitorParams) => {
    if (!volSet) {
      vol = p.volume;
      volSet = true;
    }
    for (let i = 0; i < frames; i++) {
      const l = inL[i] - inL[i] === 0 ? inL[i] : 0;
      const r = inR[i] - inR[i] === 0 ? inR[i] : 0;
      const kl = filt(filt(l, shelf, 0), highpass, 4);
      const kr = filt(filt(r, shelf, 8), highpass, 12);
      const pw = kl * kl + kr * kr;
      acc += pw;
      fast += (pw - fast) * fastCoef;
      if (++count === HOP) {
        block(acc / HOP, p);
        acc = 0;
        count = 0;
      }
      if (++sinceCheck === 32) {
        sinceCheck = 0;
        // Far too loud right now: down at once (never up: that's the slow block's job)
        const now = lufs(fast);
        if (p.match && now > c.silence && now + gainDb > p.target + c.fastHeadroom) gainDb = Math.max(c.min, p.target + c.fastHeadroom - now);
        gLin = Math.pow(10, gainDb / 20);
      }
      g += (gLin - g) * gCoef;
      vol += (p.volume - vol) * volCoef;
      let ol = l * g * vol;
      let or = r * g * vol;
      // The safety limiter: down at once to what this sample needs, back up over about 50 ms
      const a = Math.max(ol < 0 ? -ol : ol, or < 0 ? -or : or);
      const need = a > ceiling ? ceiling / a : 1;
      safety = need < safety ? need : safety + (1 - safety) * safetyRelease;
      if (safety > 1) safety = 1;
      if (safety < safetyMost) safetyMost = safety;
      ol *= safety;
      or *= safety;
      if (ol > ceiling) ol = ceiling;
      else if (ol < -ceiling) ol = -ceiling;
      if (or > ceiling) or = ceiling;
      else if (or < -ceiling) or = -ceiling;
      outL[i] = ol;
      outR[i] = or;
    }
  };

  const read = (): MonitorReading => {
    const reading = { gainDb, shortTerm, safetyDb: safetyMost < 1 ? -20 * Math.log10(safetyMost) : 0, sounding };
    safetyMost = 1;
    return reading;
  };
  return { process, read };
}

/** The kernel's constants. */
export const MONITOR_CONSTANTS = {
  rise: MONITOR_RISE_DB_PER_S,
  fall: MONITOR_FALL_DB_PER_S,
  fastFall: MONITOR_FAST_FALL_DB_PER_S,
  headroom: MONITOR_MOMENTARY_HEADROOM,
  fastHeadroom: MONITOR_FAST_HEADROOM,
  min: MONITOR_MIN_DB,
  max: MONITOR_MAX_DB,
  start: MONITOR_START_DB,
  silence: MONITOR_SILENCE_LUFS,
  ceiling: MONITOR_CEILING_DB,
};

export const MONITOR_PROCESSOR = 'bbx-monitor';

const MONITOR_WORKLET_SOURCE = `
const createMonitorKernel = ${createMonitorKernel.toString()};
class MonitorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'match', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'volume', defaultValue: 1, minValue: 0, maxValue: 4, automationRate: 'k-rate' },
      { name: 'target', defaultValue: ${MONITOR_TARGET_LUFS}, minValue: -40, maxValue: 0, automationRate: 'k-rate' },
    ];
  }
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.kernel = createMonitorKernel(sampleRate, o.shelf, o.highpass, o.constants);
    this.silence = new Float32Array(128);
    this.frames = 0;
    this.every = Math.round(sampleRate / 4);
    this.params = { match: 1, volume: 1, target: ${MONITOR_TARGET_LUFS} };
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const frames = outL.length;
    if (this.silence.length < frames) this.silence = new Float32Array(frames);
    const inL = input.length > 0 ? input[0] : this.silence;
    const inR = input.length > 1 ? input[1] : inL;
    this.params.match = parameters.match[0];
    this.params.volume = parameters.volume[0];
    this.params.target = parameters.target[0];
    this.kernel.process(inL, inR, outL, outR, frames, this.params);
    this.frames += frames;
    if (this.frames >= this.every) {
      this.frames = 0;
      this.port.postMessage(this.kernel.read());
    }
    return true;
  }
}
registerProcessor('${MONITOR_PROCESSOR}', MonitorProcessor);
`;

// ---------- the switch (kept in this browser, like the playback buffering) ----------

const STORAGE_KEY = 'bbx-listening-match';

/** Whether listening is level-matched (default on). */
export function listeningMatched(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/**
 * Whether the listening path is in: 'pending' while its worklet loads, 'on' once it's in place,
 * 'off' where it couldn't start (no AudioWorklet, as on a plain-http address): then nothing is
 * level-matched and there's no safety limiter, so the Loud master's push isn't heard live either.
 */
export type MonitorStatus = 'pending' | 'on' | 'off';

/** The listening path's state for the UI. */
export interface ListeningState {
  reading: MonitorReading | null;
  /** The switch as set (kept in this browser). */
  wanted: boolean;
  status: MonitorStatus;
  /** Really level-matched: switched on and the listening path is in. */
  matched: boolean;
}

/** Level-matched only when switched on and the listening path is in (see MonitorStatus). */
export const isMatched = (wanted: boolean, status: MonitorStatus): boolean => wanted && status === 'on';

const listeners = new Set<(state: ListeningState) => void>();
let lastReading: MonitorReading | null = null;
let node: AudioWorkletNode | null = null;
let status: MonitorStatus = 'pending';
let volumeDb = 0;
/** Where the volume goes until the listening path is in (or for good, where worklets can't run). */
let fallbackVolume: ((db: number) => void) | null = null;

const stateNow = (wanted = listeningMatched()): ListeningState => ({ reading: lastReading, wanted, status, matched: isMatched(wanted, status) });
const notify = (wanted?: boolean) => {
  const st = stateNow(wanted);
  listeners.forEach((l) => l(st));
};

/** Hear the listening path's readings (a few a second), the switch and the install; returns a function that stops listening. */
export function onMonitorReading(listener: (state: ListeningState) => void): () => void {
  listeners.add(listener);
  listener(stateNow());
  return () => listeners.delete(listener);
}

/** The listening path's state now (see ListeningState). */
export const listeningState = (): ListeningState => stateNow();

/** The listening path's install state (see MonitorStatus). */
export const monitorStatus = (): MonitorStatus => status;

/** Level matching on or off (kept in this browser). */
export function setListeningMatched(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode: for this visit only
  }
  node?.parameters.get('match')?.setValueAtTime(on ? 1 : 0, 0);
  notify(on);
}

/** The listening volume (dB): after the level matching, before the safety limiter. */
export function setListeningVolume(db: number): void {
  volumeDb = db;
  if (node) node.parameters.get('volume')!.setValueAtTime(Math.pow(10, db / 20), 0);
  else fallbackVolume?.(db);
}

export const listeningVolume = (): number => volumeDb;

/** Whether the listening path is in place (its worklet loaded). */
export const monitorInstalled = (): boolean => node !== null;

// ---------- how loud the song was heard (for the export dialog) ----------

/** Readings kept: the last three minutes of the song playing (the worklet posts four a second). */
const HEARD_READINGS = 3 * 60 * 4;
/** Fewer than this (5 s of playing) says nothing yet. */
const HEARD_LEAST = 5 * 4;
const heardPower = new Float64Array(HEARD_READINGS);
const heardGain = new Float64Array(HEARD_READINGS);
let heardCount = 0;
let heardAt = 0;

/** One reading into the record of what was heard: only while the song plays. */
function heardReading(r: MonitorReading) {
  if (!r.sounding || !Number.isFinite(r.shortTerm)) return;
  heardPower[heardAt] = Math.pow(10, (r.shortTerm + 0.691) / 10);
  heardGain[heardAt] = r.gainDb;
  heardAt = (heardAt + 1) % HEARD_READINGS;
  heardCount = Math.min(HEARD_READINGS, heardCount + 1);
}

/** Forget what was heard (another song opened). */
export function resetHeardLoudness(): void {
  heardCount = 0;
  heardAt = 0;
}

/** How the song sounded as it last played (up to three minutes of it): its loudness out of the master (what a file of it measures) and how much the level matching turned it, on average. */
export interface HeardLoudness {
  /** The master's loudness, LUFS: about what a file of the song measures. */
  lufs: number;
  /** What the level matching added on average, dB (0 with it off). */
  matchDb: number;
}

/** What the song was heard at (see HeardLoudness); null before it has played a few seconds. */
export function heardLoudness(): HeardLoudness | null {
  if (heardCount < HEARD_LEAST) return null;
  let p = 0;
  let g = 0;
  for (let i = 0; i < heardCount; i++) {
    p += heardPower[i];
    g += heardGain[i];
  }
  return { lufs: -0.691 + 10 * Math.log10(p / heardCount), matchDb: isMatched(listeningMatched(), status) ? g / heardCount : 0 };
}

/**
 * How much louder (+) or quieter (-) a file at `fileLufs` sounds than the song did in the app (dB):
 * there it played at its own loudness plus what the level matching added; a file plays at its own.
 */
export const fileAgainstHeardDb = (heard: HeardLoudness, fileLufs: number): number => fileLufs - (heard.lufs + heard.matchDb);

/**
 * Put the listening path between `output` (the live destination's last node, where the meters
 * listen) and the speakers. Until it's in, and where AudioWorklets can't run, the volume goes to
 * `fallback` (the destination's own volume) and nothing is matched.
 */
export function installMonitor(context: Tone.BaseContext, output: Tone.ToneAudioNode, speakers: AudioNode, fallback: (db: number) => void): Promise<void> {
  fallbackVolume = fallback;
  fallback(volumeDb);
  return loadWorklet(context, MONITOR_PROCESSOR, MONITOR_WORKLET_SOURCE)
    .then(() => {
      const [shelf, highpass] = kWeightingFilters(context.sampleRate);
      const monitor = createWorkletNode(context, MONITOR_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { shelf, highpass, constants: MONITOR_CONSTANTS },
        parameterData: { match: listeningMatched() ? 1 : 0, volume: Math.pow(10, volumeDb / 20), target: MONITOR_TARGET_LUFS },
      });
      monitor.port.onmessage = (e: MessageEvent<MonitorReading>) => {
        lastReading = e.data;
        heardReading(e.data);
        notify();
      };
      Tone.connect(monitor, speakers);
      Tone.connect(output, monitor);
      Tone.disconnect(output, speakers);
      // The volume is the listening path's from now on
      fallback(0);
      node = monitor;
      status = 'on';
      notify();
    })
    .catch((err) => {
      status = 'off';
      notify();
      console.warn('The listening path could not start; the volume plays as before:', err);
    });
}
