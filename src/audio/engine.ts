import * as Tone from 'tone';
import { createBusEffects } from './effects/busEffects';
import { DEFAULT_MASTER_FX } from '../store/timelineTypes';
import type { MasterFx } from '../store/timelineTypes';

export type AudioState = 'suspended' | 'running' | 'closed';

export type { InstrumentKey } from './instrumentCatalog';

/**
 * Build the mix graph in the current Tone context:
 *   track strips -> master bus -> compressor -> limiter -> destination
 *   track sends  -> shared reverb / delay -> master bus
 * Track strips are created per track (see trackStrip.ts). `auditionInput` is a dry input for
 * the sound deck's pads. Used once for live playback and again inside the WAV export render.
 */
export function createMixChain(destination: Tone.InputNode, masterFx: MasterFx = DEFAULT_MASTER_FX, bpm = 122) {
  // Central master bus for every track and the effect returns
  const bus = new Tone.Gain(0.9);
  const busFx = createBusEffects(bus, masterFx, bpm);

  // Master mastering chain
  const compressor = new Tone.Compressor({ threshold: -18, ratio: 4, attack: 0.005, release: 0.1 });
  const limiter = new Tone.Limiter(-0.5);
  bus.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(destination);

  const auditionInput = new Tone.Gain(1).connect(bus);

  return { bus, busFx, compressor, limiter, auditionInput };
}

export type MixChain = ReturnType<typeof createMixChain>;

export const liveMix = createMixChain(Tone.getDestination());

export const masterBus = liveMix.bus;
export const masterBusEffects = liveMix.busFx;
export const masterCompressor = liveMix.compressor;
export const masterLimiter = liveMix.limiter;
/** Where the sound deck's audition instruments play (dry, straight to the master bus). */
export const auditionInput = liveMix.auditionInput;

// Configure default transport clock settings for modern electric funk
Tone.Transport.bpm.value = 122;
Tone.Transport.swing = 0.2;
Tone.Transport.swingSubdivision = '16n';

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
  if (Tone.context.state !== 'running') {
    await Tone.start();
    // In case Tone's underlying raw context needs resuming
    if (Tone.context.rawContext && Tone.context.rawContext.state === 'suspended') {
      await Tone.context.rawContext.resume();
    }
  }

  const state = Tone.context.state as AudioState;
  notifyState(state);
  return state;
}

/**
 * Get current Tone AudioContext state
 */
export function getAudioContextState(): AudioState {
  return Tone.context.state as AudioState;
}

/**
 * Set global master volume in decibels (-60dB to +6dB)
 */
export function setMasterVolume(db: number): void {
  Tone.Destination.volume.rampTo(db, 0.05);
}

/**
 * Get current master volume in decibels
 */
export function getMasterVolume(): number {
  return Tone.Destination.volume.value;
}

/**
 * Set global BPM
 */
export function setBpm(bpm: number): void {
  Tone.Transport.bpm.rampTo(Math.max(40, Math.min(240, bpm)), 0.05);
}

/**
 * Get global BPM
 */
export function getBpm(): number {
  return Tone.Transport.bpm.value;
}
