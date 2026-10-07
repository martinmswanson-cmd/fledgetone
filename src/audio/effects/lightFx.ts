import * as Tone from 'tone';

/**
 * Lean stand-ins for Tone.EQ3 and Tone.Chorus that sound the same but cost far less CPU.
 *
 * Tone.Filter drives its BiquadFilterNodes' frequency, Q, gain and detune from Signals
 * (ConstantSourceNodes). A filter param fed by a node is audio-rate, so Chrome recomputes the
 * filter's coefficients every sample, and a Tone.EQ3 holds four such filters. Tone.Chorus adds
 * two LFOs (oscillator, wave shaper, scaler and constant sources each), a feedback loop and a
 * signal-driven crossfade around two delay lines. In a dense song those idle helpers cost more
 * than the instruments. These versions use the same filters, delay lines and mixing law, with
 * plain node parameters that only change when the user moves a control.
 */

/** The parts of an insert the track strip patches together. */
export interface LightInsert {
  input: Tone.Gain;
  output: Tone.Gain;
  dispose: () => void;
}

export interface LightEq3 extends LightInsert {
  /** Band gains in dB (Tone.Param with decibel units, like Tone.EQ3's). */
  low: Tone.Param<'decibels'>;
  mid: Tone.Param<'decibels'>;
  high: Tone.Param<'decibels'>;
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
  const lowGain = new Tone.Gain({ gain: 0, units: 'decibels' });
  const midGain = new Tone.Gain({ gain: 0, units: 'decibels' });
  const highGain = new Tone.Gain({ gain: 0, units: 'decibels' });

  input.fan(low, lowMid, high);
  low.chain(lowGain, output);
  lowMid.chain(mid, midGain, output);
  high.chain(highGain, output);

  return {
    input,
    output,
    low: lowGain.gain,
    mid: midGain.gain,
    high: highGain.gain,
    dispose: () => [input, output, low, lowMid, mid, high, lowGain, midGain, highGain].forEach((n) => n.dispose()),
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

/**
 * Tone.Chorus with its defaults (feedback 0, sine LFO): each channel goes through a delay line
 * whose time swings around `delayMs` by `depth`, the left and right LFOs `spread` degrees apart,
 * mixed with the dry signal by an equal-power crossfade.
 */
export function createLightChorus(opts: { rate: number; delayMs: number; depth: number; spread: number; wet: number }): LightChorus {
  const input = new Tone.Gain(1);
  // Like Tone's stereo effects, a mono source is spread to both channels
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  const output = new Tone.Gain(1);
  const dry = new Tone.Gain(0);
  const wet = new Tone.Gain(0);
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
    for (const s of [left, right]) {
      s.delay.delayTime.value = (min + max) / 2;
      s.swing.gain.value = (max - min) / 2;
    }
  };
  const ramped = (param: Tone.Param<'gain'>, value: number, ramp: number) => {
    if (ramp > 0) param.linearRampTo(value, ramp);
    else param.value = value;
  };
  const setWet = (mix: number, ramp: number) => {
    const fade = Math.max(0, Math.min(1, mix));
    ramped(dry.gain, Math.cos((fade * Math.PI) / 2), ramp);
    ramped(wet.gain, Math.sin((fade * Math.PI) / 2), ramp);
  };
  setDepth(opts.depth);
  setWet(opts.wet, 0);
  let rate = opts.rate;

  return {
    input,
    output,
    setDepth,
    setWet,
    setRate: (hz, ramp) => {
      if (hz === rate) return;
      for (const { osc } of [left, right]) {
        const at = raw.currentTime;
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

  // Ramps start from the last value set here: an AudioParam's .value doesn't show scheduled
  // values until the context renders (an offline export sets these up before it starts)
  const current = new Map<AudioParam, number>();
  const ramped = (param: AudioParam, value: number, ramp: number) => {
    const at = raw.currentTime;
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
