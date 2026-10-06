import * as Tone from 'tone';
import type { Track } from '../../store/timelineTypes';
import type { BusEffects } from './busEffects';

/**
 * One mixer channel per track:
 *   input -> Distortion -> EQ3 -> Compressor -> makeup gain -> Chorus -> Channel (vol/pan/mute)
 *   Channel -> master bus, plus post-fader sends to the shared reverb and delay.
 * Bypassed inserts stay in the chain at wet 0 (or a 1:1 ratio) so toggling never re-patches.
 */
export interface TrackStrip {
  /** Instruments connect here. */
  input: Tone.InputNode;
  channel: Tone.Channel;
  apply: (track: Track, opts?: { ramp?: number; muteOverride?: boolean }) => void;
  dispose: () => void;
}

export function createTrackStrip(bus: Tone.InputNode, busFx: BusEffects): TrackStrip {
  const distortion = new Tone.Distortion({ distortion: 0.3, oversample: '2x', wet: 0 });
  const eq = new Tone.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 400, highFrequency: 2500 });
  const compressor = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.01, release: 0.2 });
  const makeup = new Tone.Gain(1);
  const chorus = new Tone.Chorus({ frequency: 1.5, delayTime: 3.5, depth: 0.6, spread: 180, wet: 0 }).start();
  const channel = new Tone.Channel({ volume: 0, pan: 0 });
  const reverbSend = new Tone.Gain(0);
  const delaySend = new Tone.Gain(0);

  distortion.chain(eq, compressor, makeup, chorus, channel);
  channel.connect(bus);
  channel.connect(reverbSend);
  reverbSend.connect(busFx.reverbInput);
  channel.connect(delaySend);
  delaySend.connect(busFx.delayInput);

  /**
   * Ramp a param, or set it outright when ramp is 0 (offline setup). Always a linear ramp:
   * rampTo() goes exponential for decibel params, which can't reach 0 dB (the compressor
   * threshold's ceiling) and throws.
   */
  const set = (param: Tone.Param<any> | Tone.Signal<any>, value: number, ramp: number) => {
    if (ramp > 0) param.linearRampTo(value, ramp);
    else param.value = value;
  };

  return {
    input: distortion,
    channel,
    apply: (track, opts = {}) => {
      const ramp = opts.ramp ?? 0.03;
      const { fx, eq: bands } = track;

      set(distortion.wet, fx.distortion.on ? 1 : 0, ramp);
      distortion.distortion = fx.distortion.amount;

      set(eq.low, bands.low, ramp);
      set(eq.mid, bands.mid, ramp);
      set(eq.high, bands.high, ramp);

      // Bypassed compressor = threshold 0 dB at 1:1, no makeup. Set directly, never ramped:
      // Tone starts any ramp from max(current, 1e-7), which is above the threshold's 0 dB cap.
      set(compressor.threshold, fx.compressor.on ? fx.compressor.threshold : 0, 0);
      set(compressor.ratio, fx.compressor.on ? fx.compressor.ratio : 1, 0);
      set(makeup.gain, fx.compressor.on ? Tone.dbToGain(fx.compressor.makeup) : 1, ramp);

      set(chorus.wet, fx.chorus.on ? fx.chorus.mix : 0, ramp);
      set(chorus.frequency, fx.chorus.rate, ramp);
      chorus.depth = fx.chorus.depth;

      set(channel.volume, track.volume <= -60 ? -Infinity : track.volume, ramp);
      set(channel.pan, track.pan, ramp);
      channel.mute = opts.muteOverride ?? track.isMuted;
      if (opts.muteOverride === undefined) channel.solo = track.isSoloed;

      set(reverbSend.gain, Math.max(0, Math.min(1, track.reverbSend)), ramp);
      set(delaySend.gain, Math.max(0, Math.min(1, track.delaySend)), ramp);
    },
    dispose: () => {
      [distortion, eq, compressor, makeup, chorus, channel, reverbSend, delaySend].forEach((n) => n.dispose());
    },
  };
}
