import * as Tone from 'tone';
import type { MasterFx } from '../../store/timelineTypes';
import { createLightPingPong, type LightPingPong } from './lightFx';
import { decodeSound } from '../soundLibrary';

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
  /** Resolves when the reverb impulse response is in place (generated, or the recorded room loaded). */
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

  // What goes into the hall is low-cut and damped above 5.5 kHz, as a real room soaks up the top:
  // the reverb's own impulse is full-band noise, which kept bright parts' hiss in the tail and
  // the bass's boom in the wash
  const lowCut = new Tone.Filter({ type: 'highpass', frequency: 180, rolloff: -12 });
  const damp = new Tone.Filter({ type: 'lowpass', frequency: 5500, rolloff: -12 });
  reverbInput.chain(lowCut, damp, reverb);
  reverb.connect(destination);
  delayInput.connect(delay.input);
  delay.output.connect(destination);

  // A recorded room: its impulse response (a sound in the library) goes into the reverb's own
  // convolver in place of the generated one, so the sends, filters and exports all stay as they are
  const convolver = () => (reverb as unknown as { _convolver: ConvolverNode })._convolver;
  let roomToken = 0;
  const loadRoom = async (room: string | undefined) => {
    const token = ++roomToken;
    if (!room) {
      await reverb.generate();
      return;
    }
    try {
      const buffer = roomImpulse(await decodeSound(room, reverb.context.sampleRate), reverb.context);
      if (token === roomToken) convolver().buffer = buffer;
    } catch {
      // Not in this browser any more: the generated hall stands in
      if (token === roomToken) await reverb.generate();
    }
  };

  let current = { ...fx };
  return {
    reverb,
    delay,
    reverbInput,
    delayInput,
    ready: reverb.ready.then(() => (fx.room ? loadRoom(fx.room) : undefined)),
    apply: (next, tempo) => {
      if (next.room !== current.room) {
        if (!next.room && next.reverbDecay !== current.reverbDecay) {
          roomToken++;
          reverb.decay = Math.max(0.8, Math.min(12, next.reverbDecay));
        } else void loadRoom(next.room);
      } else if (!next.room && next.reverbDecay !== current.reverbDecay) {
        // Regenerating the impulse response is costly, so only when the decay changes
        reverb.decay = Math.max(0.8, Math.min(12, next.reverbDecay));
      }
      delay.setDelayTime(delaySeconds(next.delayTime, tempo), 0.05);
      delay.setFeedback(Math.max(0, Math.min(0.8, next.delayFeedback)), 0.05);
      current = { ...next };
    },
    dispose: () => {
      roomToken++;
      [reverbInput, lowCut, damp, delayInput, reverb, delay].forEach((n) => n.dispose());
    },
  };
}

/** Longest room kept (seconds): a longer tail is faded out there */
const ROOM_MAX_SECONDS = 12;

/**
 * A room recording made ready for the convolver: mono or stereo (a recording with more channels
 * keeps its first two), its leading silence taken off so the hall answers on time, and no longer
 * than ROOM_MAX_SECONDS, faded at the cut.
 */
function roomImpulse(source: AudioBuffer, context: Tone.BaseContext): AudioBuffer {
  const rate = source.sampleRate;
  const channels = Math.min(2, source.numberOfChannels);
  let peak = 0;
  for (let c = 0; c < channels; c++) for (const v of source.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  let start = 0;
  const threshold = peak * 0.05;
  outer: for (; start < source.length; start++) for (let c = 0; c < channels; c++) if (Math.abs(source.getChannelData(c)[start]) >= threshold) break outer;
  // A millisecond before the first reflection, so its attack isn't clipped
  start = Math.max(0, start - Math.round(rate * 0.001));
  const length = Math.max(1, Math.min(source.length - start, Math.round(ROOM_MAX_SECONDS * rate)));
  const out = context.createBuffer(channels, length, rate);
  const fade = Math.min(length, Math.round(rate * 0.5));
  const cut = length < source.length - start;
  for (let c = 0; c < channels; c++) {
    const data = source.getChannelData(c).subarray(start, start + length);
    const copy = new Float32Array(data);
    if (cut) for (let i = 0; i < fade; i++) copy[length - 1 - i] *= i / fade;
    out.copyToChannel(copy, c);
  }
  return out;
}
