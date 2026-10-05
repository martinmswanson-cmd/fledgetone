import * as Tone from 'tone';

export type AudioState = 'suspended' | 'running' | 'closed';

// Central Master Bus node for all instrument voices
export const masterBus = new Tone.Gain(0.9);

// Professional Master Mastering Chain
export const masterCompressor = new Tone.Compressor({
  threshold: -18,
  ratio: 4,
  attack: 0.005,
  release: 0.1,
});

export const masterLimiter = new Tone.Limiter(-0.5);

// Connect chain: masterBus -> masterCompressor -> masterLimiter -> Tone.Destination
masterBus.connect(masterCompressor);
masterCompressor.connect(masterLimiter);
masterLimiter.connect(Tone.Destination);

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
