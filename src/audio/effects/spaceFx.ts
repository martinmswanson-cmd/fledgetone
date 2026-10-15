import * as Tone from 'tone';
import type { TrackFx } from '../../store/timelineTypes';
import { ECHO_BEATS, REVERB_DECAY_MAX } from '../../store/timelineTypes';
import { writeTime } from './lightFx';
import { paramSetter as smoothParamSetter } from './smoothParam';

/**
 * The Delay and Reverb inserts: a track's own echoes and room, as against the shared master
 * reverb and delay its sends feed. On a return track at full mix they are a return's effect,
 * fed by any track's send. Both are built from plain Web Audio nodes, like lightFx.ts.
 */

export interface SpaceUnit {
  input: Tone.Gain;
  output: Tone.Gain;
  dispose: () => void;
}

/** Set native params, gliding over about `ramp` seconds (0 = at once), at writeTime (see smoothParam.ts). */
const paramSetter = (raw: BaseAudioContext) => smoothParamSetter(() => writeTime(raw));

/** An equal-power wet/dry pair for a mix of 0 to 1. */
const mixGains = (mix: number): [wet: number, dry: number] => {
  const m = Math.max(0, Math.min(1, mix));
  return [Math.sin((m * Math.PI) / 2), Math.cos((m * Math.PI) / 2)];
};

/** The longest echo: a half note at 30 BPM. */
const ECHO_MAX_SECONDS = 4;

export interface EchoUnit extends SpaceUnit {
  set: (s: TrackFx['echo'], bpm: number, ramp: number) => void;
}

/**
 * Echoes at a note value of the tempo. Each side has a delay whose output goes through a tone
 * low-pass and back in: to its own side (stereo echoes) or across to the other side (ping-pong,
 * fed the two sides summed into the left so the repeats bounce left, right, left...). Switching
 * between the two only moves gains, so it can change while playing.
 */
export function createEcho(settings: TrackFx['echo'], bpm: number): EchoUnit {
  const input = new Tone.Gain(1);
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  const setParam = paramSetter(raw);
  const into = input.input as unknown as AudioNode;
  const out = output.input as unknown as AudioNode;

  const dry = raw.createGain();
  into.connect(dry);
  dry.connect(out);

  const split = raw.createChannelSplitter(2);
  const merge = raw.createChannelMerger(2);
  into.connect(split);
  const delays = [raw.createDelay(ECHO_MAX_SECONDS), raw.createDelay(ECHO_MAX_SECONDS)];
  const tones = [raw.createBiquadFilter(), raw.createBiquadFilter()];
  // Into each side's delay: its own side (stereo), or both sides into the left (ping-pong)
  const feedIn = [raw.createGain(), raw.createGain()];
  const crossIn = raw.createGain();
  // Back into a delay: the same side's echo (stereo), or the other side's (ping-pong)
  const straight = [raw.createGain(), raw.createGain()];
  const cross = [raw.createGain(), raw.createGain()];
  const wet = raw.createGain();
  for (let side = 0; side < 2; side++) {
    tones[side].type = 'lowpass';
    tones[side].Q.value = 0.5;
    split.connect(feedIn[side], side);
    feedIn[side].connect(delays[side]);
    delays[side].connect(tones[side]);
    tones[side].connect(merge, 0, side);
    tones[side].connect(straight[side]);
    straight[side].connect(delays[side]);
    tones[side].connect(cross[side]);
    cross[side].connect(delays[1 - side]);
  }
  split.connect(crossIn, 1);
  crossIn.connect(delays[0]);
  merge.connect(wet);
  wet.connect(out);

  const set: EchoUnit['set'] = (s, tempo, ramp) => {
    const seconds = Math.min(ECHO_MAX_SECONDS, (ECHO_BEATS[s.time] ?? 0.5) * (60 / Math.max(1, tempo)));
    delays.forEach((d) => setParam(d.delayTime, seconds, ramp));
    tones.forEach((t) => setParam(t.frequency, s.tone, ramp));
    const fb = Math.max(0, Math.min(0.9, s.feedback));
    const pp = s.pingPong;
    setParam(feedIn[0].gain, pp ? 0.5 : 1, ramp);
    setParam(crossIn.gain, pp ? 0.5 : 0, ramp);
    setParam(feedIn[1].gain, pp ? 0 : 1, ramp);
    straight.forEach((g) => setParam(g.gain, pp ? 0 : fb, ramp));
    cross.forEach((g) => setParam(g.gain, pp ? fb : 0, ramp));
    const [w, d] = mixGains(s.mix);
    setParam(wet.gain, w, ramp);
    setParam(dry.gain, d, ramp);
  };
  set(settings, bpm, 0);
  return {
    input,
    output,
    set,
    dispose: () => {
      [dry, split, merge, ...delays, ...tones, ...feedIn, crossIn, ...straight, ...cross, wet].forEach((n) => n.disconnect());
      input.dispose();
      output.dispose();
    },
  };
}

/** A small deterministic noise source, so a reverb's tail is the same live and in every export. */
function noise(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296) * 2 - 1;
  };
}

/**
 * A reverb's impulse response: decaying noise, different on each side (so the tail is wide),
 * reaching -60 dB at `decay` seconds, faded in over a few milliseconds and scaled so the tail
 * carries the same energy as what goes in, whatever its length (a short room and a long hall
 * at the same mix sound about as loud).
 */
export function reverbImpulse(raw: BaseAudioContext, decay: number): AudioBuffer {
  const rate = raw.sampleRate;
  const seconds = Math.max(0.05, Math.min(REVERB_DECAY_MAX, decay));
  const length = Math.ceil(seconds * rate);
  const buffer = raw.createBuffer(2, length, rate);
  const fadeIn = Math.ceil(0.004 * rate);
  const k = Math.log(1000) / (seconds * rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const rand = noise(0x9e3779b9 + ch * 7919);
    let energy = 0;
    for (let i = 0; i < length; i++) {
      const v = rand() * Math.exp(-k * i) * (i < fadeIn ? i / fadeIn : 1);
      data[i] = v;
      energy += v * v;
    }
    const scale = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  return buffer;
}

export interface ReverbUnit extends SpaceUnit {
  set: (s: TrackFx['reverb'], ramp: number) => void;
}

/** input -> dry, plus input -> pre-delay -> convolver (the tail) -> tone low-pass -> wet. */
export function createReverb(settings: TrackFx['reverb']): ReverbUnit {
  const input = new Tone.Gain(1);
  input.channelCount = 2;
  input.channelCountMode = 'explicit';
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  const setParam = paramSetter(raw);
  const into = input.input as unknown as AudioNode;
  const out = output.input as unknown as AudioNode;
  const dry = raw.createGain();
  const pre = raw.createDelay(0.25);
  const convolver = raw.createConvolver();
  convolver.normalize = false;
  const tone = raw.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.5;
  const wet = raw.createGain();
  into.connect(dry);
  dry.connect(out);
  into.connect(pre);
  pre.connect(convolver);
  convolver.connect(tone);
  tone.connect(wet);
  wet.connect(out);
  let decay = -1;
  const set: ReverbUnit['set'] = (s, ramp) => {
    // A new tail only when its length changes (to the nearest 50 ms)
    const d = Math.round(s.decay * 20) / 20;
    if (d !== decay) {
      decay = d;
      convolver.buffer = reverbImpulse(raw, d);
    }
    setParam(pre.delayTime, Math.max(0, Math.min(0.2, s.preDelay / 1000)), ramp);
    setParam(tone.frequency, s.tone, ramp);
    const [w, dr] = mixGains(s.mix);
    setParam(wet.gain, w, ramp);
    setParam(dry.gain, dr, ramp);
  };
  set(settings, 0);
  return {
    input,
    output,
    set,
    dispose: () => {
      [dry, pre, convolver, tone, wet].forEach((n) => n.disconnect());
      input.dispose();
      output.dispose();
    },
  };
}

/** How long a track's own Delay and Reverb keep sounding after its last note (seconds). */
export function insertTailSeconds(fx: Partial<TrackFx>, bpm: number): number {
  let tail = 0;
  if (fx.reverb?.on && fx.reverb.mix > 0) tail = Math.max(tail, fx.reverb.decay + fx.reverb.preDelay / 1000);
  if (fx.echo?.on && fx.echo.mix > 0) {
    const step = (ECHO_BEATS[fx.echo.time] ?? 0.5) * (60 / Math.max(1, bpm));
    const fb = Math.min(0.9, fx.echo.feedback);
    // Repeats until they've fallen 60 dB (ping-pong takes two steps a round trip, but each repeat still falls by fb)
    const repeats = fb > 0.001 ? Math.log(0.001) / Math.log(fb) : 1;
    tail = Math.max(tail, Math.min(60, (repeats + 1) * step));
  }
  return tail;
}
