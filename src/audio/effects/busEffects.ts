import * as Tone from 'tone';
import type { MasterFx } from '../../store/timelineTypes';
import { createLightPingPong, type LightPingPong } from './lightFx';

/**
 * Shared return effects fed by every track's post-fader sends: one reverb and one
 * ping-pong delay. One instance of each keeps CPU low however many tracks there are.
 * Built per context (live, and again inside the offline export render).
 */
export interface BusEffects {
  reverb: Tone.Reverb;
  delay: LightPingPong;
  reverbInput: Tone.Gain;
  delayInput: Tone.Gain;
  /** Resolves when the reverb impulse response has been generated. */
  ready: Promise<void>;
  apply: (fx: MasterFx, bpm: number) => void;
  dispose: () => void;
}

const BEATS: Record<string, number> = { '4n': 1, '8n.': 0.75, '8n': 0.5, '16n': 0.25 };

/** Delay subdivision in seconds at a tempo (computed here so tempo changes stay in sync). */
export function delaySeconds(subdivision: string, bpm: number): number {
  return ((BEATS[subdivision] ?? 0.5) * 60) / bpm;
}

export function createBusEffects(destination: Tone.InputNode, fx: MasterFx, bpm: number): BusEffects {
  const reverbInput = new Tone.Gain(1);
  const delayInput = new Tone.Gain(1);

  const reverb = new Tone.Reverb({ decay: fx.reverbDecay, preDelay: 0.02, wet: 1 });
  // Tone.PingPongDelay's sound at wet 1, at a fraction of its CPU (see lightFx.ts)
  const delay = createLightPingPong({
    delayTime: delaySeconds(fx.delayTime, bpm),
    maxDelay: 2,
    feedback: Math.max(0, Math.min(0.8, fx.delayFeedback)),
  });

  reverbInput.connect(reverb);
  reverb.connect(destination);
  delayInput.connect(delay.input);
  delay.output.connect(destination);

  let current = { ...fx };
  return {
    reverb,
    delay,
    reverbInput,
    delayInput,
    ready: reverb.ready,
    apply: (next, tempo) => {
      // Regenerating the impulse response is costly, so only when the decay changes
      if (next.reverbDecay !== current.reverbDecay) reverb.decay = Math.max(0.8, Math.min(12, next.reverbDecay));
      delay.setDelayTime(delaySeconds(next.delayTime, tempo), 0.05);
      delay.setFeedback(Math.max(0, Math.min(0.8, next.delayFeedback)), 0.05);
      current = { ...next };
    },
    dispose: () => {
      [reverbInput, delayInput, reverb, delay].forEach((n) => n.dispose());
    },
  };
}
