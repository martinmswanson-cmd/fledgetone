import * as Tone from 'tone';

export type AudioState = 'suspended' | 'running' | 'closed';

export type InstrumentKey = 'drums' | 'bass' | 'keys' | 'brass';

/**
 * Build the mix graph in the current Tone context:
 *   per-track Tone.Channel strips -> master bus -> compressor -> limiter -> destination.
 * Used once for live playback and again inside Tone.Offline for WAV export.
 */
export function createMixChain(destination: Tone.InputNode) {
  // Central Master Bus node for all instrument voices
  const bus = new Tone.Gain(0.9);

  // Professional Master Mastering Chain
  const compressor = new Tone.Compressor({
    threshold: -18,
    ratio: 4,
    attack: 0.005,
    release: 0.1,
  });
  const limiter = new Tone.Limiter(-0.5);

  // Connect chain: bus -> compressor -> limiter -> destination
  bus.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(destination);

  /**
   * Per-track mixer channel strips. Every instrument preset routes into its own
   * Tone.Channel so volume, pan, mute and solo act on real audio nodes.
   * Tone.Channel solo is global: soloing any channel silences all non-soloed ones.
   */
  const channels: Record<InstrumentKey, Tone.Channel> = {
    drums: new Tone.Channel({ volume: 0, pan: 0 }).connect(bus),
    bass: new Tone.Channel({ volume: 0, pan: 0 }).connect(bus),
    keys: new Tone.Channel({ volume: 0, pan: 0 }).connect(bus),
    brass: new Tone.Channel({ volume: 0, pan: 0 }).connect(bus),
  };

  return { bus, compressor, limiter, channels };
}

const liveMix = createMixChain(Tone.getDestination());

export const masterBus = liveMix.bus;
export const masterCompressor = liveMix.compressor;
export const masterLimiter = liveMix.limiter;
export const trackChannels = liveMix.channels;

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
