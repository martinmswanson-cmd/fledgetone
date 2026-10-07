import * as Tone from 'tone';
import type { Track } from '../../store/timelineTypes';
import type { BusEffects } from './busEffects';
import { createLightChorus, createLightEq3, type LightChorus, type LightEq3 } from './lightFx';

/**
 * One mixer channel per track:
 *   input -> Distortion -> EQ3 -> Compressor -> makeup gain -> Chorus -> Channel (vol/pan/mute)
 *   Channel -> master bus, plus post-fader sends to the shared reverb and delay.
 *
 * An insert only exists while it's switched on (the EQ while any band is boosted or cut).
 * A bypassed insert is disposed and patched out of the chain rather than left running at
 * wet 0: Web Audio keeps processing every connected node, and a full set of idle inserts
 * cost more CPU than the instruments, so a dozen tracks could starve live playback. The EQ and
 * chorus are lean versions of Tone's (see lightFx.ts), for the same reason.
 */
export interface TrackStrip {
  /** Instruments connect here. */
  input: Tone.InputNode;
  channel: Tone.Channel;
  apply: (track: Track, opts?: { ramp?: number; muteOverride?: boolean }) => void;
  dispose: () => void;
}

/** An insert in the chain: where the signal goes in and where it comes out. */
interface Insert {
  input: Tone.ToneAudioNode;
  output: Tone.ToneAudioNode;
}

export function createTrackStrip(bus: Tone.InputNode, busFx: BusEffects): TrackStrip {
  const input = new Tone.Gain(1);
  const channel = new Tone.Channel({ volume: 0, pan: 0 });
  const reverbSend = new Tone.Gain(0);
  const delaySend = new Tone.Gain(0);

  input.connect(channel);
  channel.connect(bus);
  channel.connect(reverbSend);
  reverbSend.connect(busFx.reverbInput);
  channel.connect(delaySend);
  delaySend.connect(busFx.delayInput);

  let distortion: Tone.Distortion | null = null;
  let eq: LightEq3 | null = null;
  let compressor: Tone.Compressor | null = null;
  let makeup: Tone.Gain | null = null;
  let chorus: LightChorus | null = null;
  /** The inserts currently patched in, in signal order. */
  let chain: Insert[] = [];

  /** Patch input -> active inserts -> channel, only when the set of inserts changed. */
  const rewire = () => {
    const next: Insert[] = [];
    if (distortion) next.push({ input: distortion, output: distortion });
    if (eq) next.push({ input: eq.input, output: eq.output });
    if (compressor && makeup) next.push({ input: compressor, output: makeup });
    if (chorus) next.push({ input: chorus.input, output: chorus.output });
    if (next.length === chain.length && next.every((ins, i) => ins.input === chain[i].input)) return;

    input.disconnect();
    chain.forEach((ins) => ins.output.disposed || ins.output.disconnect());
    let from: Tone.ToneAudioNode = input;
    for (const ins of next) {
      from.connect(ins.input);
      from = ins.output;
    }
    from.connect(channel);
    chain = next;
  };

  /**
   * Ramp a param, or set it outright when ramp is 0 (offline setup, or an insert that was just
   * created). Always a linear ramp: rampTo() goes exponential for decibel params, which can't
   * reach 0 dB (the compressor threshold's ceiling) and throws.
   */
  const set = (param: Tone.Param<any> | Tone.Signal<any>, value: number, ramp: number) => {
    if (ramp > 0) param.linearRampTo(value, ramp);
    else param.value = value;
  };

  return {
    input,
    channel,
    apply: (track, opts = {}) => {
      const ramp = opts.ramp ?? 0.03;
      const { fx, eq: bands } = track;

      if (fx.distortion.on) {
        distortion ??= new Tone.Distortion({ distortion: fx.distortion.amount, oversample: '2x', wet: 1 });
        distortion.distortion = fx.distortion.amount;
      } else if (distortion) {
        distortion.dispose();
        distortion = null;
      }

      if (bands.low !== 0 || bands.mid !== 0 || bands.high !== 0) {
        const fresh = !eq;
        eq ??= createLightEq3(400, 2500);
        set(eq.low, bands.low, fresh ? 0 : ramp);
        set(eq.mid, bands.mid, fresh ? 0 : ramp);
        set(eq.high, bands.high, fresh ? 0 : ramp);
      } else if (eq) {
        eq.dispose();
        eq = null;
      }

      if (fx.compressor.on) {
        const fresh = !compressor;
        compressor ??= new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.01, release: 0.2 });
        makeup ??= new Tone.Gain(1);
        if (fresh) compressor.connect(makeup);
        // Set directly, never ramped: Tone starts any ramp from max(current, 1e-7), which is
        // above the threshold's 0 dB cap.
        set(compressor.threshold, fx.compressor.threshold, 0);
        set(compressor.ratio, fx.compressor.ratio, 0);
        set(makeup.gain, Tone.dbToGain(fx.compressor.makeup), fresh ? 0 : ramp);
      } else if (compressor) {
        compressor.dispose();
        makeup?.dispose();
        compressor = null;
        makeup = null;
      }

      if (fx.chorus.on) {
        const fresh = !chorus;
        chorus ??= createLightChorus({ rate: fx.chorus.rate, delayMs: 3.5, depth: fx.chorus.depth, spread: 180, wet: fx.chorus.mix });
        chorus.setWet(fx.chorus.mix, fresh ? 0 : ramp);
        chorus.setRate(fx.chorus.rate, fresh ? 0 : ramp);
        chorus.setDepth(fx.chorus.depth);
      } else if (chorus) {
        chorus.dispose();
        chorus = null;
      }

      rewire();

      set(channel.volume, track.volume <= -60 ? -Infinity : track.volume, ramp);
      set(channel.pan, track.pan, ramp);
      channel.mute = opts.muteOverride ?? track.isMuted;
      if (opts.muteOverride === undefined) channel.solo = track.isSoloed;

      set(reverbSend.gain, Math.max(0, Math.min(1, track.reverbSend)), ramp);
      set(delaySend.gain, Math.max(0, Math.min(1, track.delaySend)), ramp);
    },
    dispose: () => {
      [distortion, eq, compressor, makeup, chorus, input, channel, reverbSend, delaySend].forEach((n) => n?.dispose());
    },
  };
}
