/**
 * Two lean inserts for group buses (and any track): Saturation, a warm full-range soft clip that
 * thickens and glues (unlike the Distortion, it keeps the lows: a kick or 808 keeps its weight),
 * and Mono bass, which puts everything under a crossover in the middle, as an 808 or bass bus
 * wants. Each is a handful of native nodes, built only while switched on (see trackStrip.ts), so
 * live and export run the same nodes.
 *
 * The Saturation's dry/wet blend is inside its curve: the curve is (1 - mix) * x + mix * a tanh
 * that starts at the same slope, so quiet sound passes at its own level and only peaks are
 * rounded. One WaveShaper (4x oversampled, so no aliasing fizz) does it all, with no parallel dry
 * path to comb-filter against the oversampler's delay.
 */
import * as Tone from 'tone';
import type { TrackFx } from '../../store/timelineTypes';
import { smoothSet } from './smoothParam';

export interface BusInsert {
  input: Tone.ToneAudioNode;
  output: Tone.ToneAudioNode;
  dispose: () => void;
}

/** How far over full scale the Saturation's curve reaches (its input is scaled down by this). */
const HEADROOM = 8;

/** The drive (linear) an amount gives: 0 dB at 0, 24 dB at 1. */
export const saturationDrive = (amount: number) => 10 ** ((Math.max(0, Math.min(1, amount)) * 24) / 20);

/**
 * The Saturation's curve over -1..1 (input / HEADROOM): unity slope at zero, rounding off towards
 * 1 / drive (scaled back up so a quiet signal is untouched) blended with the straight line by `mix`.
 */
export function saturationCurve(amount: number, mix: number, points = 8193): Float32Array<ArrayBuffer> {
  const drive = saturationDrive(amount);
  const m = Math.max(0, Math.min(1, mix));
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = ((i / (points - 1)) * 2 - 1) * HEADROOM;
    curve[i] = (1 - m) * x + (m * Math.tanh(drive * x)) / drive;
  }
  return curve;
}

export interface SaturationInsert extends BusInsert {
  set: (s: NonNullable<TrackFx['saturate']>) => void;
}

export function createSaturation(settings: NonNullable<TrackFx['saturate']>): SaturationInsert {
  const input = new Tone.Gain(1 / HEADROOM);
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  const shaper = raw.createWaveShaper();
  shaper.oversample = '4x';
  let applied = { amount: NaN, mix: NaN };
  const set = (s: NonNullable<TrackFx['saturate']>) => {
    if (s.amount === applied.amount && s.mix === applied.mix) return;
    applied = { amount: s.amount, mix: s.mix };
    shaper.curve = saturationCurve(s.amount, s.mix);
  };
  set(settings);
  input.connect(shaper);
  shaper.connect(output.input as unknown as AudioNode);
  return {
    input,
    output,
    set,
    dispose: () => {
      shaper.disconnect();
      input.dispose();
      output.dispose();
    },
  };
}

export interface MonoBassInsert extends BusInsert {
  set: (s: NonNullable<TrackFx['monoLow']>, ramp?: number) => void;
}

/**
 * Mono bass by mid/side: M = (L + R) / 2 passes as it is, S = (L - R) / 2 goes through two
 * 2nd-order high-passes at the crossover first, then L = M + S', R = M - S'. Under the crossover
 * the sides are gone (the bass is in the middle); over it the sound is as it was.
 */
export function createMonoBass(settings: NonNullable<TrackFx['monoLow']>): MonoBassInsert {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  // A mono source becomes the same on both sides
  const inNode = raw.createGain();
  inNode.channelCount = 2;
  inNode.channelCountMode = 'explicit';
  const split = raw.createChannelSplitter(2);
  const merge = raw.createChannelMerger(2);
  const gain = (v: number) => {
    const g = raw.createGain();
    g.gain.value = v;
    return g;
  };
  const lToMid = gain(0.5);
  const rToMid = gain(0.5);
  const lToSide = gain(0.5);
  const rToSide = gain(-0.5);
  const mid = gain(1);
  const side = gain(1);
  const flip = gain(-1);
  const hp = () => {
    const f = raw.createBiquadFilter();
    f.type = 'highpass';
    f.Q.value = 20 * Math.log10(Math.SQRT1_2); // Butterworth: lowpass/highpass Q is in dB
    f.frequency.value = settings.freq;
    return f;
  };
  const hp1 = hp();
  const hp2 = hp();
  input.connect(inNode);
  inNode.connect(split);
  split.connect(lToMid, 0);
  split.connect(rToMid, 1);
  split.connect(lToSide, 0);
  split.connect(rToSide, 1);
  lToMid.connect(mid);
  rToMid.connect(mid);
  lToSide.connect(side);
  rToSide.connect(side);
  side.connect(hp1);
  hp1.connect(hp2);
  mid.connect(merge, 0, 0);
  mid.connect(merge, 0, 1);
  hp2.connect(merge, 0, 0);
  hp2.connect(flip);
  flip.connect(merge, 0, 1);
  merge.connect(output.input as unknown as AudioNode);
  const set = (s: NonNullable<TrackFx['monoLow']>, ramp = 0.03) => {
    const now = raw.currentTime;
    for (const f of [hp1, hp2]) smoothSet(f.frequency, s.freq, now, ramp / 3);
  };
  const nodes = [inNode, split, merge, lToMid, rToMid, lToSide, rToSide, mid, side, flip, hp1, hp2];
  return {
    input,
    output,
    set,
    dispose: () => {
      nodes.forEach((n) => n.disconnect());
      input.dispose();
      output.dispose();
    },
  };
}
