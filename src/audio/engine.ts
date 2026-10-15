/**
 * The master section and the live audio context. createMixChain builds the mix graph (master bus,
 * compressor, the OTT and width inserts, limiter and ceiling, plus the shared reverb and delay
 * returns) in whatever context is current: once for live playback (liveMix) and again inside every
 * export render. Also starting the audio, its running / suspended state, and the master volume.
 */
import * as Tone from 'tone';
import { liveTransport, liveDestination, liveContext } from './liveContext';
// Must run before any oscillator exists: keeps Tone's waveform cache per audio context
import './toneFixes';
import { createBusEffects } from './effects/busEffects';
import { createMasterInserts } from './effects/masterChain';
import { LIMITER_PROCESSOR, LIMITER_WORKLET_SOURCE } from './effects/limiter';
import { createWorkletNode, loadWorklet } from './worklets';
import { DEFAULT_MASTER_FX, defaultMasterSettings } from '../store/timelineTypes';
import type { MasterFx, MasterSettings } from '../store/timelineTypes';

export type AudioState = 'suspended' | 'running' | 'closed';

export type { InstrumentKey } from './instrumentCatalog';

/** The mix bus's gain: a little headroom before the master compressor. */
export const BUS_GAIN = 0.9;

/**
 * Build the mix graph in the current Tone context:
 *   track strips -> master bus -> compressor -> (OTT, stereo width) -> look-ahead limiter -> destination
 *   track sends  -> shared reverb / delay -> master bus
 * Track strips are created per track (see trackStrip.ts). `auditionInput` is a dry input for
 * the sound deck's pads. Used once for live playback and again inside the WAV export render.
 * The master section's inserts (`master`, see masterChain.ts) are only built while switched on.
 */
export function createMixChain(destination: Tone.InputNode, masterFx: MasterFx = DEFAULT_MASTER_FX, bpm = 122, master: MasterSettings = defaultMasterSettings()) {
  // Central master bus for every track and the effect returns
  const bus = new Tone.Gain(BUS_GAIN);
  const busFx = createBusEffects(bus, masterFx, bpm);

  // Master mastering chain
  const compressor = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.005, release: 0.1 });
  // Where the inserts end and the limiter begins
  const limiterIn = new Tone.Gain(1);
  // The stand-in limiter until the look-ahead one (effects/limiter.ts, an AudioWorklet) has
  // loaded, and where AudioWorklets can't run: a hard-knee compressor (Tone.Limiter keeps a 30 dB
  // soft knee, which barely limits) and a ceiling that rounds off what its 20:1 ratio lets through
  const limiter = new Tone.Compressor({ threshold: -1, ratio: 20, attack: 0, release: 0.08, knee: 0 });
  const ceiling = new Tone.WaveShaper(ceilingCurve());
  bus.connect(compressor);
  // Patches compressor -> limiterIn itself, with the OTT and width in between while they're on
  const inserts = createMasterInserts(compressor, limiterIn, master);
  limiterIn.connect(limiter);
  limiter.connect(ceiling);
  ceiling.connect(destination);
  let lookahead: AudioWorkletNode | null = null;
  const context = bus.context;
  // Resolves once the look-ahead limiter has taken over (or for good on the stand-in)
  const limiterReady = loadWorklet(context, LIMITER_PROCESSOR, LIMITER_WORKLET_SOURCE)
    .then(() => {
      if (limiterIn.disposed) return;
      const node = createWorkletNode(context, LIMITER_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      Tone.connect(node, destination);
      Tone.connect(limiterIn, node);
      limiterIn.disconnect(limiter);
      // The stand-in and its ceiling hear nothing from now on: out of the graph, so the audio
      // thread doesn't keep running them on silence
      limiter.disconnect();
      ceiling.disconnect();
      lookahead = node;
    })
    .catch((err) => console.warn('The look-ahead limiter could not start; using the stand-in:', err));
  const disposeLimiter = () => {
    if (limiterIn.disposed) return;
    lookahead?.port.postMessage('dispose');
    lookahead?.disconnect();
    limiterIn.dispose();
    limiter.dispose();
    ceiling.dispose();
  };

  const auditionInput = new Tone.Gain(1).connect(bus);

  return {
    bus,
    busFx,
    compressor,
    inserts,
    limiter,
    limiterReady,
    /** Whether the look-ahead limiter is the one in use (its delay is LIMITER latency, not the stand-in's) */
    lookahead: () => lookahead !== null,
    disposeLimiter,
    ceiling,
    auditionInput,
  };
}

export type MixChain = ReturnType<typeof createMixChain>;

/**
 * Unity up to -0.45 dBFS, then a smooth bend that never passes -0.04 dBFS. The signal reaching it
 * is already limited to about -1 dBFS, so it only touches the odd fast transient.
 */
function ceilingCurve(): Float32Array {
  const n = 4097;
  const knee = 0.95;
  const room = 0.995 - knee;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = a <= knee ? x : Math.sign(x) * (knee + room * Math.tanh((a - knee) / room));
  }
  return curve;
}

export const liveMix = createMixChain(Tone.getDestination());

export const masterBus = liveMix.bus;
export const masterBusEffects = liveMix.busFx;
export const masterCompressor = liveMix.compressor;
export const masterLimiter = liveMix.limiter;
/** Where the sound deck's audition instruments play (dry, straight to the master bus). */
export const auditionInput = liveMix.auditionInput;

// Configure default transport clock settings for modern electric funk. (Swing isn't the
// Transport's: the clip schedule delays the off-beat 16ths itself, see swungNotes.)
liveTransport.bpm.value = 122;

let audioStateChangeListeners: Array<(state: AudioState) => void> = [];

/**
 * Register callback for Tone.js context state changes
 */
export function onAudioStateChange(listener: (state: AudioState) => void): () => void {
  audioStateChangeListeners.push(listener);
  return () => {
    audioStateChangeListeners = audioStateChangeListeners.filter((l) => l !== listener);
  };
}

function notifyState(state: AudioState) {
  audioStateChangeListeners.forEach((l) => l(state));
}

/**
 * Initialize AudioContext cleanly following modern browser autoplay guidelines.
 * Must be triggered by a user gesture (e.g., button click).
 */
export async function initAudio(): Promise<AudioState> {
  if (liveContext.state !== 'running') {
    await Tone.start();
    // In case Tone's underlying raw context needs resuming
    if (liveContext.rawContext && liveContext.rawContext.state === 'suspended') {
      await liveContext.rawContext.resume();
    }
  }

  const state = liveContext.state as AudioState;
  notifyState(state);
  return state;
}

/**
 * Get current Tone AudioContext state
 */
export function getAudioContextState(): AudioState {
  return liveContext.state as AudioState;
}

/**
 * Set global master volume in decibels (-60dB to +6dB)
 */
export function setMasterVolume(db: number): void {
  liveDestination.volume.rampTo(db, 0.05);
}

/**
 * Get current master volume in decibels
 */
export function getMasterVolume(): number {
  return liveDestination.volume.value;
}

/**
 * Set global BPM
 */
export function setBpm(bpm: number): void {
  liveTransport.bpm.rampTo(Math.max(40, Math.min(240, bpm)), 0.05);
}

/**
 * Get global BPM
 */
export function getBpm(): number {
  return liveTransport.bpm.value;
}
