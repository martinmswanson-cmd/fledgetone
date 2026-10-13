import * as Tone from 'tone';
import { createParamWriter, type AutomationTarget, type ParamWriter } from './paramWriter';
import { PEQ_MAX_BANDS, type PeqBand } from '../../store/timelineTypes';
import { BIQUAD_TYPE, biquadQ, hasGain } from '../peq';

/**
 * Lean stand-ins for Tone.EQ3, Tone.Distortion and Tone.Chorus that sound the same but cost far
 * less CPU, and the track Filter and Pump built the same way.
 *
 * Tone.Filter drives its BiquadFilterNodes' frequency, Q, gain and detune from Signals
 * (ConstantSourceNodes). A filter param fed by a node is audio-rate, so Chrome recomputes the
 * filter's coefficients every sample, and a Tone.EQ3 holds four such filters. Tone.Chorus adds
 * two LFOs (oscillator, wave shaper, scaler and constant sources each), a feedback loop and a
 * signal-driven crossfade around two delay lines. In a dense song those idle helpers cost more
 * than the instruments. These versions use the same filters, delay lines and mixing law, with
 * plain node parameters that only change when the user moves a control.
 */

/**
 * Set native params, ramping over `ramp` seconds (0 = at once). Ramps start from the last value
 * set here: an AudioParam's .value doesn't show scheduled values until the context renders (an
 * offline export sets these up before it starts).
 */
/**
 * While automation applies a setting (see the track strip's controls), the time it applies it for:
 * in an export that is ahead of the render, which waits while the page schedules. Else -Infinity,
 * and changes happen now.
 */
let controlAt = -Infinity;
/** Run `fn` with the effects' changes scheduled at `time` (or now, if that is past). */
export function atControlTime<T>(time: number, fn: () => T): T {
  const was = controlAt;
  controlAt = time;
  try {
    return fn();
  } finally {
    controlAt = was;
  }
}
/** When a change made now takes effect on `raw`'s clock. */
export const writeTime = (raw: BaseAudioContext): number => Math.max(raw.currentTime, controlAt);

function paramSetter(raw: BaseAudioContext): (param: AudioParam, value: number, ramp: number) => void {
  const current = new Map<AudioParam, number>();
  return (param, value, ramp) => {
    const at = writeTime(raw);
    param.cancelScheduledValues(at);
    const from = current.get(param);
    if (ramp > 0 && from !== undefined && from !== value) {
      param.setValueAtTime(from, at);
      param.linearRampToValueAtTime(value, at + ramp);
    } else {
      param.setValueAtTime(value, at);
    }
    current.set(param, value);
  };
}

/** The parts of an insert the track strip patches together. */
export interface LightInsert {
  input: Tone.Gain;
  output: Tone.Gain;
  dispose: () => void;
}

export interface LightEq3 extends LightInsert {
  /** Band gains, as plain gains (not dB), so an EQ automation lane can drive them too. */
  low: ParamWriter;
  mid: ParamWriter;
  high: ParamWriter;
}

/**
 * Tone.EQ3's three-band split (12 dB/oct crossovers at `lowFrequency` and `highFrequency`, Q 1)
 * with a gain per band, built from fixed-coefficient biquads.
 */
export function createLightEq3(lowFrequency = 400, highFrequency = 2500): LightEq3 {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const filter = (type: BiquadFilterType, frequency: number) => new Tone.BiquadFilter({ type, frequency, Q: 1 });
  const low = filter('lowpass', lowFrequency);
  const lowMid = filter('highpass', lowFrequency);
  const mid = filter('lowpass', highFrequency);
  const high = filter('highpass', highFrequency);
  const lowGain = new Tone.Gain(1);
  const midGain = new Tone.Gain(1);
  const highGain = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  const writer = (gain: Tone.Gain) =>
    createParamWriter(gain.gain.input as AudioParam, { raw, now: () => input.context.now(), initial: 1 });

  input.fan(low, lowMid, high);
  low.chain(lowGain, output);
  lowMid.chain(mid, midGain, output);
  high.chain(highGain, output);

  return {
    input,
    output,
    low: writer(lowGain),
    mid: writer(midGain),
    high: writer(highGain),
    dispose: () => [input, output, low, lowMid, mid, high, lowGain, midGain, highGain].forEach((n) => n.dispose()),
  };
}

export interface LightDistortion extends LightInsert {
  /** Set the amount (0-1), gliding over `ramp` seconds (0 = at once). */
  setAmount: (amount: number, ramp?: number) => void;
}

/** The drive an amount gives: 0 dB at 0 (clean), about 10 dB at 0.3, 32 dB at 1. */
const driveOf = (amount: number) => Math.pow(10, amount * 1.6);

/**
 * How loud a soft-clipped signal comes out, against how loud it went in, at a typical level
 * (a sine peaking at 0.3): the makeup gain that keeps the insert from changing the level.
 */
function driveMakeup(drive: number): number {
  const a = 0.3;
  let sum = 0;
  const n = 256;
  for (let i = 0; i < n; i++) {
    const y = Math.tanh(drive * a * Math.sin((2 * Math.PI * i) / n));
    sum += y * y;
  }
  return a / Math.SQRT2 / Math.sqrt(sum / n);
}

/**
 * A pedal-style overdrive, instead of Tone.Distortion's bare curve: that curve clipped hard at
 * any level, with no tone shaping, so chords turned to buzz and everything came out fizzy and
 * quiet. Here: the lows are tightened (so the bass doesn't turn to mud), the signal is driven
 * into a smooth tanh clip (4x oversampled: no aliasing fizz), the top is rolled off more the
 * harder it's driven (as a speaker does), and the level is made up so the insert is about as
 * loud as what went in. Amount 0 is clean; the drive, tone and makeup glide, so turning the
 * knob while playing is smooth (the curve itself never changes).
 */
export function createLightDistortion(amount: number): LightDistortion {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  const tight = raw.createBiquadFilter();
  tight.type = 'highpass';
  tight.frequency.value = 90;
  tight.Q.value = 0.7;
  const drive = raw.createGain();
  const shaper = raw.createWaveShaper();
  shaper.oversample = '4x';
  const curve = new Float32Array(4097);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / (curve.length - 1)) * 2 - 1);
  shaper.curve = curve;
  const tone = raw.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.8;
  const makeup = raw.createGain();
  const settings = (value: number) => {
    const d = driveOf(Math.max(0, Math.min(1, value)));
    return { drive: d, tone: 8000 - 4500 * value, makeup: driveMakeup(d) };
  };
  const first = settings(amount);
  drive.gain.value = first.drive;
  tone.frequency.value = first.tone;
  makeup.gain.value = first.makeup;
  let applied = amount;
  const setAmount = (value: number, ramp = 0.02) => {
    if (value === applied) return;
    applied = value;
    const next = settings(value);
    const now = writeTime(raw);
    for (const [param, target] of [[drive.gain, next.drive], [tone.frequency, next.tone], [makeup.gain, next.makeup]] as const) {
      param.cancelScheduledValues(now);
      if (ramp > 0) {
        param.setValueAtTime(param.value, now);
        param.linearRampToValueAtTime(target, now + ramp);
      } else param.setValueAtTime(target, now);
    }
  };
  input.connect(tight);
  tight.connect(drive);
  drive.connect(shaper);
  shaper.connect(tone);
  tone.connect(makeup);
  makeup.connect(output.input as unknown as AudioNode);
  return {
    input,
    output,
    setAmount,
    dispose: () => {
      [tight, drive, shaper, tone, makeup].forEach((n) => n.disconnect());
      input.dispose();
      output.dispose();
    },
  };
}

export interface LightChorus extends LightInsert {
  /** Set the LFO rate (Hz), ramping over `ramp` seconds (0 = now). */
  setRate: (hz: number, ramp: number) => void;
  /** Set the depth (0-1): how far the delay swings around its centre. */
  setDepth: (depth: number) => void;
  /** Set the wet/dry mix (0-1), with Tone's equal-power crossfade. */
  setWet: (wet: number, ramp: number) => void;
}

/** The chorus's wet level against Tone's (see createLightChorus). */
const WET_LEVEL = Math.SQRT1_2;

/**
 * Tone.Chorus with its defaults (feedback 0, sine LFO): each channel goes through a delay line
 * whose time swings around `delayMs` by `depth`, the left and right LFOs `spread` degrees apart,
 * mixed with the dry signal by an equal-power crossfade.
 *
 * The wet side is 3 dB down on Tone's. Every chorus was voiced through a track strip that folded
 * stereo to mono, where the two sides' wet signals (nearly unrelated) averaged to half their
 * power. The strip keeps both sides now, so this leaves each side with the level and the dry/wet
 * balance the folded chorus had, only wide.
 */
export function createLightChorus(opts: { rate: number; delayMs: number; depth: number; spread: number; wet: number }): LightChorus {
  const input = new Tone.Gain(1);
  // Like Tone's stereo effects, a mono source is spread to both channels
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  const output = new Tone.Gain(1);
  // Made at their starting levels: set later, they'd change only a look-ahead (0.1 s) on, and a
  // chorus switched on while playing silenced the track until then
  const mixAt = (mix: number) => (Math.max(0, Math.min(1, mix)) * Math.PI) / 2;
  const dry = new Tone.Gain(Math.cos(mixAt(opts.wet)));
  const wet = new Tone.Gain(Math.sin(mixAt(opts.wet)) * WET_LEVEL);
  const raw = input.context.rawContext as unknown as BaseAudioContext;

  const centre = opts.delayMs / 1000;
  const split = raw.createChannelSplitter(2);
  const merge = raw.createChannelMerger(2);
  const now = raw.currentTime;
  const side = (phaseDeg: number, channel: 0 | 1) => {
    const delay = raw.createDelay(0.05);
    // Tone builds a phase-shifted sine from the same two coefficients
    const phase = (phaseDeg * Math.PI) / 180;
    const osc = raw.createOscillator();
    osc.setPeriodicWave(raw.createPeriodicWave(new Float32Array([0, -Math.sin(phase)]), new Float32Array([0, Math.cos(phase)])));
    osc.frequency.value = opts.rate;
    const swing = raw.createGain();
    osc.connect(swing);
    swing.connect(delay.delayTime);
    split.connect(delay, channel);
    delay.connect(merge, 0, channel);
    osc.start(now);
    return { delay, osc, swing };
  };
  const left = side(90 - opts.spread / 2, 0);
  const right = side(90 + opts.spread / 2, 1);

  input.connect(split);
  input.connect(dry);
  merge.connect(wet.input as unknown as AudioNode);
  dry.connect(output);
  wet.connect(output);

  const setDepth = (depth: number) => {
    // Tone's LFO runs from max(centre - deviation, 0) to centre + deviation
    const deviation = centre * depth;
    const min = Math.max(centre - deviation, 0);
    const max = centre + deviation;
    const at = writeTime(raw);
    for (const s of [left, right]) {
      s.delay.delayTime.setValueAtTime((min + max) / 2, at);
      s.swing.gain.setValueAtTime((max - min) / 2, at);
    }
  };
  const ramped = (param: Tone.Param<'gain'>, value: number, ramp: number) => {
    const at = controlAt > -Infinity ? writeTime(raw) : undefined;
    if (ramp > 0) param.linearRampTo(value, ramp, at);
    else if (at !== undefined) param.setValueAtTime(value, at);
    else param.value = value;
  };
  const setWet = (mix: number, ramp: number) => {
    ramped(dry.gain, Math.cos(mixAt(mix)), ramp);
    ramped(wet.gain, Math.sin(mixAt(mix)) * WET_LEVEL, ramp);
  };
  setDepth(opts.depth);
  let rate = opts.rate;

  return {
    input,
    output,
    setDepth,
    setWet,
    setRate: (hz, ramp) => {
      if (hz === rate) return;
      for (const { osc } of [left, right]) {
        const at = writeTime(raw);
        osc.frequency.cancelScheduledValues(at);
        if (ramp > 0) {
          osc.frequency.setValueAtTime(rate, at);
          osc.frequency.linearRampToValueAtTime(hz, at + ramp);
        } else {
          osc.frequency.setValueAtTime(hz, at);
        }
      }
      rate = hz;
    },
    dispose: () => {
      for (const s of [left, right]) {
        s.osc.stop();
        s.osc.disconnect();
        s.swing.disconnect();
        s.delay.disconnect();
      }
      split.disconnect();
      merge.disconnect();
      [input, output, dry, wet].forEach((n) => n.dispose());
    },
  };
}

export interface LightPingPong extends LightInsert {
  /** Echo time in seconds, ramped over `ramp` seconds (0 = now). */
  setDelayTime: (seconds: number, ramp: number) => void;
  /** How much of each echo comes back (0-1), ramped like setDelayTime. */
  setFeedback: (feedback: number, ramp: number) => void;
}

/**
 * Tone.PingPongDelay at wet 1: the left channel echoes after one delay, the right after two,
 * and each echo feeds the opposite side, so repeats bounce left and right. Same delay lines and
 * feedback routing, but the delay time is a plain parameter rather than a signal, which spares
 * three delay lines from per-sample delay-time processing.
 */
export function createLightPingPong(opts: { delayTime: number; feedback: number; maxDelay: number }): LightPingPong {
  const input = new Tone.Gain(1);
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;

  const split = raw.createChannelSplitter(2);
  const merge = raw.createChannelMerger(2);
  const leftIn = raw.createGain();
  const left = raw.createDelay(opts.maxDelay);
  const rightPre = raw.createDelay(opts.maxDelay);
  const right = raw.createDelay(opts.maxDelay);
  const feedbackL = raw.createGain();
  const feedbackR = raw.createGain();

  input.connect(split);
  split.connect(leftIn, 0);
  leftIn.connect(left);
  left.connect(merge, 0, 0);
  split.connect(rightPre, 1);
  rightPre.connect(right);
  right.connect(merge, 0, 1);
  // Left echoes feed the right delay (after its pre-delay); right echoes feed the left
  left.connect(feedbackL);
  feedbackL.connect(right);
  right.connect(feedbackR);
  feedbackR.connect(leftIn);
  merge.connect(output.input as unknown as AudioNode);

  const ramped = paramSetter(raw);
  const delays = [left, rightPre, right];
  const setDelayTime = (seconds: number, ramp: number) => {
    const t = Math.max(0, Math.min(opts.maxDelay, seconds));
    delays.forEach((d) => ramped(d.delayTime, t, ramp));
  };
  const setFeedback = (feedback: number, ramp: number) => {
    [feedbackL, feedbackR].forEach((g) => ramped(g.gain, feedback, ramp));
  };
  setDelayTime(opts.delayTime, 0);
  setFeedback(opts.feedback, 0);

  return {
    input,
    output,
    setDelayTime,
    setFeedback,
    dispose: () => {
      [split, merge, leftIn, left, rightPre, right, feedbackL, feedbackR].forEach((n) => n.disconnect());
      input.dispose();
      output.dispose();
    },
  };
}

export interface FilterSettings {
  type: 'lowpass' | 'highpass' | 'bandpass';
  /** Hz */
  cutoff: number;
  /** As a Q: 0.71 is flat (a Butterworth response), higher peaks at the cutoff */
  resonance: number;
  /** dB per octave */
  slope: 12 | 24;
}

/** Settings an automation lane drives instead of the insert's own controls. */
export interface FilterLanes {
  cutoff?: boolean;
  resonance?: boolean;
}

export interface LightFilter extends LightInsert {
  /**
   * Cutoff and resonance ramp over `ramp` seconds (0 = at once); type and slope switch at once.
   * What `lanes` says a lane drives is left alone.
   */
  set: (settings: FilterSettings, ramp: number, lanes?: FilterLanes) => void;
  /**
   * What a Filter Cutoff or Resonance lane drives, for the type and slope set now: the stages'
   * params, each with how a cutoff (Hz) or resonance (as a Q) becomes its value.
   */
  targets: (lane: 'cutoff' | 'resonance') => AutomationTarget[];
  /** Changes when the type or slope does (and with them, what targets() returns). */
  shape: () => string;
}

/**
 * Make a biquad's cutoff and Q change once per 128-sample render block (3 ms) instead of every
 * sample. While either moves (a lane's sweep, a ramp), Chrome otherwise works out new filter
 * coefficients for each sample: on six tracks with busy cutoff lanes that was about 40% more
 * render CPU, for a difference no one can hear in a sweep. Live, the node is
 * standardized-audio-context's wrapper, whose params don't pass automationRate on, so it's set on
 * the native node the wrapper keeps (the export's nodes are native already). If that's ever
 * missing, the filter just stays per-sample, and still sounds the same.
 */
function blockRate(node: BiquadFilterNode): void {
  const native = (node as BiquadFilterNode & { _nativeBiquadFilterNode?: BiquadFilterNode })._nativeBiquadFilterNode ?? node;
  try {
    native.frequency.automationRate = 'k-rate';
    native.Q.automationRate = 'k-rate';
  } catch {
    // A browser without automationRate (or one that refuses it here): per-sample it is
  }
}

/** Q of the first of two cascaded stages in a 4th-order Butterworth filter (the second's is 1.31). */
const BUTTERWORTH_Q1 = 1 / (2 * Math.cos(Math.PI / 8));

/**
 * A resonant low-pass, high-pass or band-pass filter, 12 dB per octave from one biquad or 24 from
 * two in series, with plain parameters (see above for why not Tone.Filter).
 *
 * The two 24 dB stages are a Butterworth pair at the flat setting (Q 0.54 and 1.31). More
 * resonance raises only the second stage's Q, so the peak at the cutoff is about as high as the
 * 12 dB filter's at the same setting rather than twice as high in dB. Web Audio takes a low- or
 * high-pass biquad's Q in dB and a band-pass's as a plain ratio, so it's converted here.
 */
export function createLightFilter(): LightFilter {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  const first = raw.createBiquadFilter();
  const second = raw.createBiquadFilter();
  blockRate(first);
  blockRate(second);
  input.connect(first);
  const writer = (param: AudioParam) => createParamWriter(param, { raw, now: () => input.context.now(), initial: param.value });
  const stages = [first, second].map((stage) => ({ frequency: writer(stage.frequency), q: writer(stage.Q) }));
  let applied: FilterSettings | null = null;

  /** Each stage's Q as a ratio for a resonance (the first 24 dB low/high-pass stage stays Butterworth: null). */
  const stageQs = (s: FilterSettings, resonance: number): Array<number | null> =>
    s.type !== 'bandpass' && s.slope === 24 ? [null, resonance / BUTTERWORTH_Q1] : [resonance, resonance];
  const toParam = (type: FilterSettings['type'], ratio: number) => (type === 'bandpass' ? ratio : 20 * Math.log10(ratio));
  const nyquist = raw.sampleRate / 2;

  const set = (s: FilterSettings, ramp: number, lanes: FilterLanes = {}) => {
    const typeChanged = applied?.type !== s.type;
    if (typeChanged) {
      first.type = s.type;
      second.type = s.type;
    }
    if (applied?.slope !== s.slope) {
      first.disconnect();
      second.disconnect();
      if (s.slope === 24) {
        first.connect(second);
        second.connect(output.input as unknown as AudioNode);
      } else {
        first.connect(output.input as unknown as AudioNode);
      }
    }
    // A new type reads Q in different units, so it can't ramp from the old value
    const qRamp = typeChanged ? 0 : ramp;
    const cutoff = Math.min(s.cutoff, nyquist);
    const qs = stageQs(s, s.resonance);
    stages.forEach((stage, i) => {
      if (!lanes.cutoff) stage.frequency.set(cutoff, ramp);
      const q = qs[i];
      if (q === null) stage.q.set(toParam(s.type, BUTTERWORTH_Q1), qRamp);
      else if (!lanes.resonance) stage.q.set(toParam(s.type, q), qRamp);
    });
    applied = { ...s };
  };

  return {
    input,
    output,
    set,
    targets: (lane) => {
      if (!applied) return [];
      if (lane === 'cutoff') return stages.map((stage) => ({ writer: stage.frequency, map: (hz: number) => Math.min(hz, nyquist) }));
      const s = applied;
      // (Not the first 24 dB low/high-pass stage, which stays Butterworth)
      return stages.flatMap((stage, i) => (stageQs(s, 1)[i] === null ? [] : [{ writer: stage.q, map: (q: number) => toParam(s.type, stageQs(s, q)[i]!) }]));
    },
    shape: () => (applied ? `${applied.type}|${applied.slope}` : ''),
    dispose: () => {
      first.disconnect();
      second.disconnect();
      input.dispose();
      output.dispose();
    },
  };
}

export interface LightPump extends LightInsert {
  /**
   * Duck at `time` and swell back. Triggers normally come in time order: one at the same moment
   * as another is ignored, and one earlier than those already scheduled replaces them.
   */
  trigger: (time: number) => void;
  /** How far it ducks (0-1) and how long the swell back takes (seconds), from the next trigger on. */
  setShape: (depth: number, release: number) => void;
}

/** How fast the Pump ducks: quick enough to clear room for a kick, slow enough not to click. */
const PUMP_ATTACK = 0.004;
/** Straight-line pieces the swell back is drawn with (one automation event each). */
const PUMP_SEGMENTS = 12;

/** One duck as scheduled: from the gain it had at `at`, down to `floor`, back up to 1 over `release`. */
interface Duck {
  at: number;
  from: number;
  floor: number;
  release: number;
}

/** The swell's shape, 0 to 1 over 0 to 1: a raised cosine, so it leaves the floor and lands on full volume gently. */
const swell = (x: number) => (1 - Math.cos(Math.PI * x)) / 2;

/** The gain a duck gives at `time`, on exactly the straight lines it was scheduled as. */
function duckGain(d: Duck, time: number): number {
  const t = time - d.at;
  if (t <= 0) return d.from;
  if (t < PUMP_ATTACK) return d.from + ((d.floor - d.from) * t) / PUMP_ATTACK;
  const x = ((t - PUMP_ATTACK) / d.release) * PUMP_SEGMENTS;
  if (x >= PUMP_SEGMENTS) return 1;
  const k = Math.floor(x);
  const a = swell(k / PUMP_SEGMENTS);
  const b = swell((k + 1) / PUMP_SEGMENTS);
  return d.floor + (1 - d.floor) * (a + (b - a) * (x - k));
}

/**
 * Sidechain-style pumping as one gain whose value is automated per trigger: down to 1 - depth
 * in 4 ms, then a smooth swell back to full volume over the release. Nothing runs between
 * triggers. Automation is sample-accurate, live and in the export.
 *
 * A trigger during a swell ducks from wherever the swell has got to: the automation after that
 * moment is cancelled and the line up to it redrawn, so the gain never jumps. The value at a
 * moment is worked out from the ducks scheduled (an AudioParam can't report scheduled values,
 * and Firefox has no cancelAndHoldAtTime). A trigger earlier than ones already scheduled (the
 * Transport restarted within its look-ahead) replaces them.
 */
export function createLightPump(): LightPump {
  const node = new Tone.Gain(1);
  const gain = node.input.gain;
  const raw = node.context.rawContext as unknown as BaseAudioContext;
  let floor = 0.3;
  let release = 0.3;
  /** Recent ducks, in time order: the last one tells the gain at the next trigger. */
  let ducks: Duck[] = [];

  const trigger = (time: number) => {
    const at = Math.max(time, raw.currentTime);
    // Two drum tracks kicking together (or a Transport tick handed over twice) duck once
    if (ducks.some((d) => Math.abs(d.at - at) < 1e-4)) return;
    if (floor >= 1) return;
    // Ducks long over can't matter any more
    ducks = ducks.filter((d) => d.at < at && d.at > at - 5);
    const prev = ducks[ducks.length - 1];
    const from = prev ? duckGain(prev, at) : 1;
    gain.cancelScheduledValues(at);
    // Carry on the line the gain was on up to this moment (or hold full volume)
    if (from < 1) gain.linearRampToValueAtTime(from, at);
    else gain.setValueAtTime(1, at);
    gain.linearRampToValueAtTime(floor, at + PUMP_ATTACK);
    for (let k = 1; k <= PUMP_SEGMENTS; k++) {
      gain.linearRampToValueAtTime(floor + (1 - floor) * swell(k / PUMP_SEGMENTS), at + PUMP_ATTACK + (release * k) / PUMP_SEGMENTS);
    }
    ducks.push({ at, from, floor, release });
  };

  return {
    input: node,
    output: node,
    trigger,
    setShape: (depth, seconds) => {
      floor = 1 - Math.max(0, Math.min(1, depth));
      release = Math.max(0.01, seconds);
    },
    dispose: () => node.dispose(),
  };
}

export interface LightLofi extends LightInsert {
  set: (settings: { crush: number; tone: number; wow: number; mix: number }, ramp: number) => void;
}

/** Bits the Crush amount leaves: 16 (clean) at 0 down to 3 at 1. */
export const lofiBits = (crush: number) => Math.round(16 - Math.max(0, Math.min(1, crush)) * 13);

const crushCurves = new Map<number, Float32Array<ArrayBuffer>>();

/** A staircase: the signal rounded to the levels `bits` bits allow (shared, as nodes copy it). */
function crushCurve(bits: number): Float32Array<ArrayBuffer> {
  let curve = crushCurves.get(bits);
  if (!curve) {
    const levels = 2 ** (bits - 1);
    curve = new Float32Array(16385);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    crushCurves.set(bits, curve);
  }
  return curve;
}

/** Wow: a slow wobble of the delay time, so the pitch drifts like a worn tape. */
const WOW_RATE = 0.55;
/** The delay the wobble swings around, and its widest swing (seconds). */
const WOW_BASE = 0.006;
const WOW_SWING = 0.0035;

/**
 * Lo-fi: the signal through a slowly wobbling delay (tape wow), rounded to fewer bits (digital
 * grit: 16 bits is clean, 3 is a buzzy 8-bit crunch), then darkened by a low-pass, mixed with the
 * dry signal. Plain nodes, so live and the export sound the same. The wobble's delay puts the wet
 * signal 6 ms late, too little to hear as lateness.
 */
export function createLightLofi(settings: { crush: number; tone: number; wow: number; mix: number }): LightLofi {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  const setParam = paramSetter(raw);
  const dry = raw.createGain();
  const delay = raw.createDelay(0.05);
  delay.delayTime.value = WOW_BASE;
  const lfo = raw.createOscillator();
  lfo.frequency.value = WOW_RATE;
  const swing = raw.createGain();
  const shaper = raw.createWaveShaper();
  const tone = raw.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.7;
  const wet = raw.createGain();
  const into = input.input as unknown as AudioNode;
  const out = output.input as unknown as AudioNode;
  into.connect(dry);
  dry.connect(out);
  into.connect(delay);
  lfo.connect(swing);
  swing.connect(delay.delayTime);
  delay.connect(shaper);
  shaper.connect(tone);
  tone.connect(wet);
  wet.connect(out);
  lfo.start();
  let bits = 0;
  const set: LightLofi['set'] = (s, ramp) => {
    const b = lofiBits(s.crush);
    if (b !== bits) {
      bits = b;
      shaper.curve = crushCurve(b);
    }
    setParam(tone.frequency, s.tone, ramp);
    setParam(swing.gain, WOW_SWING * Math.max(0, Math.min(1, s.wow)), ramp);
    // An equal-power crossfade, so the mix doesn't dip in the middle
    const m = Math.max(0, Math.min(1, s.mix));
    setParam(wet.gain, Math.sin((m * Math.PI) / 2), ramp);
    setParam(dry.gain, Math.cos((m * Math.PI) / 2), ramp);
  };
  set(settings, 0);
  return {
    input,
    output,
    set,
    dispose: () => {
      lfo.stop();
      [dry, delay, lfo, swing, shaper, tone, wet].forEach((n) => n.disconnect());
      input.dispose();
      output.dispose();
    },
  };
}

export interface LightGate extends LightInsert {
  /** How far it closes (0-1) and how much of each step it stays open (0-1). */
  setShape: (depth: number, length: number) => void;
  /**
   * Open at each of `steps` (times, in order, `stepSeconds` apart) and close for the rest of the
   * step. Anything scheduled from the first of them on is replaced. At `resetAt` it opens fully,
   * unless a later call replaces that (playback carrying on): so when the music stops, the track
   * isn't left shut.
   */
  schedule: (steps: number[], stepSeconds: number, resetAt: number) => void;
}

/** Ramp into each open step and out of it: short enough to chop, long enough not to click. */
const GATE_OPEN = 0.002;
const GATE_CLOSE = 0.003;

/** Trance gate / stutter: one gain, chopped on the beat grid (the strip's clock calls schedule()). */
export function createLightGate(): LightGate {
  const node = new Tone.Gain(1);
  const gain = node.input.gain;
  let floor = 0.1;
  let length = 0.5;
  return {
    input: node,
    output: node,
    setShape: (depth, len) => {
      floor = 1 - Math.max(0, Math.min(1, depth));
      length = Math.max(0.1, Math.min(0.95, len));
    },
    schedule: (steps, stepSeconds, resetAt) => {
      if (!steps.length) return;
      gain.cancelScheduledValues(steps[0]);
      for (const at of steps) {
        gain.setValueAtTime(floor, at);
        gain.linearRampToValueAtTime(1, at + GATE_OPEN);
        // Shut in time for the next step to open from the floor
        const close = Math.min(at + length * stepSeconds, at + stepSeconds - GATE_CLOSE - 0.001);
        gain.setValueAtTime(1, Math.max(at + GATE_OPEN, close));
        gain.linearRampToValueAtTime(floor, Math.max(at + GATE_OPEN, close) + GATE_CLOSE);
      }
      gain.setValueAtTime(floor, resetAt);
      gain.linearRampToValueAtTime(1, resetAt + 0.01);
    },
    dispose: () => node.dispose(),
  };
}

export interface LightPeq extends LightInsert {
  /** How many bands it has filters for (the bands switched on when it was made). */
  count: number;
  /** The bands that are on, in order, go to its filters; there must be `count` of them. */
  set: (bands: readonly PeqBand[], ramp: number) => void;
}

/** How many of `bands` are switched on: the filters a parametric EQ for them needs. */
export const peqActiveBands = (bands: readonly (PeqBand | undefined)[]): number => bands.filter((b) => b?.on).length;

/**
 * The parametric EQ: one biquad per band that's on, in series. A band that's off has no filter at
 * all: a filter left in at 0 dB passes the sound through but still costs as much as any other, and
 * most tracks use one or two bands of the six (a starter's low cut). Changing a band's shape or
 * settings just sets its filter; switching a band on or off changes `count`, and the track strip
 * swaps in a new EQ, crossfading as it does for any insert.
 */
export function createLightPeq(count: number): LightPeq {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  const setParam = paramSetter(raw);
  const stages = Array.from({ length: Math.max(1, Math.min(PEQ_MAX_BANDS, count)) }, () => {
    const f = raw.createBiquadFilter();
    blockRate(f);
    f.type = 'peaking';
    f.gain.value = 0;
    return f;
  });
  let from: AudioNode = input.input as unknown as AudioNode;
  for (const f of stages) {
    from.connect(f);
    from = f;
  }
  from.connect(output.input as unknown as AudioNode);
  const nyquist = raw.sampleRate / 2;
  const shapes: Array<BiquadFilterType | null> = stages.map(() => null);

  return {
    input,
    output,
    count: stages.length,
    set: (all, ramp) => {
      const bands = all.filter((b) => b?.on);
      stages.forEach((f, i) => {
        const b = bands[i];
        const type: BiquadFilterType = b?.on ? BIQUAD_TYPE[b.type] : 'peaking';
        // A new shape reads its params differently: set them at once
        const fresh = shapes[i] !== type;
        if (fresh) {
          f.type = type;
          shapes[i] = type;
        }
        const r = fresh ? 0 : ramp;
        if (!b?.on) {
          setParam(f.gain, 0, r);
          return;
        }
        setParam(f.frequency, Math.min(b.freq, nyquist - 1), r);
        setParam(f.gain, hasGain(b.type) ? b.gain : 0, r);
        setParam(f.Q, biquadQ(b), r);
      });
    },
    dispose: () => {
      stages.forEach((f) => f.disconnect());
      input.dispose();
      output.dispose();
    },
  };
}

export interface MbcSettings {
  lowFreq: number;
  highFreq: number;
  attack: number;
  release: number;
  bands: ReadonlyArray<{ threshold: number; ratio: number; gain: number; bypass?: boolean }>;
}

export interface LightMbc extends LightInsert {
  set: (s: MbcSettings, ramp: number) => void;
  /** Each band's gain reduction now, in dB (0 or below) */
  reduction: () => [number, number, number];
}

/**
 * The multiband compressor: Linkwitz-Riley crossovers (two Butterworth biquads each, 24 dB per
 * octave) split the sound into low, mid and high, each band goes through its own compressor and
 * makeup gain, and the three add back up. The low band also passes the high crossover's all-pass,
 * so with the compressors idle the bands sum to the input's level at every frequency.
 */
export function createLightMbc(initial: MbcSettings): LightMbc {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  const setParam = paramSetter(raw);
  const BUTTERWORTH_DB = 20 * Math.log10(Math.SQRT1_2);
  const biquad = (type: BiquadFilterType) => {
    const f = raw.createBiquadFilter();
    blockRate(f);
    f.type = type;
    f.Q.value = type === 'allpass' ? Math.SQRT1_2 : BUTTERWORTH_DB;
    return f;
  };
  const chain = (nodes: AudioNode[]) => {
    for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]);
    return { first: nodes[0], last: nodes[nodes.length - 1] };
  };
  const src = input.input as unknown as AudioNode;
  const dst = output.input as unknown as AudioNode;
  const lowLp = [biquad('lowpass'), biquad('lowpass')];
  const lowAp = biquad('allpass');
  const restHp = [biquad('highpass'), biquad('highpass')];
  const midLp = [biquad('lowpass'), biquad('lowpass')];
  const highHp = [biquad('highpass'), biquad('highpass')];
  const comps = [0, 1, 2].map(() => raw.createDynamicsCompressor());
  const gains = [0, 1, 2].map(() => raw.createGain());
  comps.forEach((c) => (c.knee.value = 6));
  const low = chain([...lowLp, lowAp, comps[0], gains[0]]);
  src.connect(low.first);
  const rest = chain(restHp);
  src.connect(rest.first);
  const mid = chain([...midLp, comps[1], gains[1]]);
  rest.last.connect(mid.first);
  const high = chain([...highHp, comps[2], gains[2]]);
  rest.last.connect(high.first);
  gains.forEach((g) => g.connect(dst));

  const set = (s: MbcSettings, ramp: number) => {
    const nyquist = raw.sampleRate / 2 - 1;
    const f1 = Math.min(s.lowFreq, nyquist);
    const f2 = Math.min(Math.max(s.highFreq, f1 * 1.5), nyquist);
    [...lowLp, ...restHp].forEach((f) => setParam(f.frequency, f1, ramp));
    [lowAp, ...midLp, ...highHp].forEach((f) => setParam(f.frequency, f2, ramp));
    comps.forEach((c, i) => {
      const b = s.bands[i];
      // A bypassed band: a compressor at 1:1 does nothing (and adds no makeup of its own)
      setParam(c.threshold, b.bypass ? 0 : b.threshold, 0);
      setParam(c.ratio, b.bypass ? 1 : b.ratio, 0);
      setParam(c.attack, s.attack, 0);
      setParam(c.release, s.release, 0);
      // The browser's compressor adds make-up gain of its own (0.6 of what it takes off a full-scale
      // signal): take that back out, so the band's Gain is all the make-up there is
      const autoMakeup = b.bypass ? 0 : -0.6 * b.threshold * (1 - 1 / b.ratio);
      setParam(gains[i].gain, b.bypass ? 1 : 10 ** ((b.gain - autoMakeup) / 20), ramp);
    });
  };
  set(initial, 0);

  return {
    input,
    output,
    set,
    reduction: () => comps.map((c) => c.reduction) as [number, number, number],
    dispose: () => {
      [...lowLp, lowAp, ...restHp, ...midLp, ...highHp, ...comps, ...gains].forEach((n) => n.disconnect());
      input.dispose();
      output.dispose();
    },
  };
}
