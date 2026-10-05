import { create } from 'zustand';
import {
  initAudio,
  getAudioContextState,
  setMasterVolume as setEngineMasterVolume,
  setBpm as setEngineBpm,
  startDemoLoop,
  stopDemoLoop,
  isDemoLoopPlaying,
  onAudioStateChange,
} from '../audio';
import type { AudioState, DemoStepEvent } from '../audio';

interface AudioStoreState {
  audioState: AudioState;
  bpm: number;
  masterVolume: number;
  isDemoPlaying: boolean;
  currentStep16: number;
  currentStep32: number;
  currentBar: number;
  activeTracks: {
    bass: boolean;
    keys: boolean;
    brass: boolean;
    drums: boolean;
  };
  activePad: string | null;

  // Actions
  initializeAudio: () => Promise<AudioState>;
  setMasterVolume: (db: number) => void;
  setBpm: (bpm: number) => void;
  tapTempo: () => void;
  toggleDemo: () => Promise<void>;
  flashPad: (padId: string) => void;
}

let tapTimes: number[] = [];

export const useAudioStore = create<AudioStoreState>((set, get) => {
  // Listen for audio context state changes
  onAudioStateChange((state) => {
    set({ audioState: state });
  });

  return {
    audioState: getAudioContextState(),
    bpm: 122,
    masterVolume: 0,
    isDemoPlaying: false,
    currentStep16: 0,
    currentStep32: 0,
    currentBar: 0,
    activeTracks: {
      bass: false,
      keys: false,
      brass: false,
      drums: false,
    },
    activePad: null,

    initializeAudio: async () => {
      const state = await initAudio();
      set({ audioState: state });
      return state;
    },

    setMasterVolume: (db: number) => {
      setEngineMasterVolume(db);
      set({ masterVolume: db });
    },

    setBpm: (bpm: number) => {
      const clamped = Math.max(40, Math.min(240, Math.round(bpm)));
      setEngineBpm(clamped);
      set({ bpm: clamped });
    },

    tapTempo: () => {
      const now = performance.now();
      tapTimes.push(now);

      // Keep only taps within the last 2.5 seconds
      if (tapTimes.length > 1) {
        const diff = now - tapTimes[tapTimes.length - 2];
        if (diff > 2500) {
          tapTimes = [now];
          return;
        }
      }

      if (tapTimes.length > 5) {
        tapTimes.shift();
      }

      if (tapTimes.length >= 2) {
        const intervals: number[] = [];
        for (let i = 1; i < tapTimes.length; i++) {
          intervals.push(tapTimes[i] - tapTimes[i - 1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const calculatedBpm = Math.round(60000 / avgInterval);
        const clampedBpm = Math.max(60, Math.min(200, calculatedBpm));
        get().setBpm(clampedBpm);
      }
    },

    toggleDemo: async () => {
      const { audioState, initializeAudio, isDemoPlaying } = get();

      // Ensure audio context is running first
      if (audioState !== 'running') {
        await initializeAudio();
      }

      if (isDemoPlaying || isDemoLoopPlaying()) {
        stopDemoLoop();
        set({
          isDemoPlaying: false,
          currentStep16: 0,
          currentStep32: 0,
          currentBar: 0,
          activeTracks: { bass: false, keys: false, brass: false, drums: false },
        });
      } else {
        set({ isDemoPlaying: true });
        startDemoLoop((event: DemoStepEvent) => {
          set({
            currentStep16: event.step16,
            currentStep32: event.step,
            currentBar: event.bar,
            activeTracks: event.activeTracks,
          });
        });
      }
    },

    flashPad: (padId: string) => {
      set({ activePad: padId });
      setTimeout(() => {
        if (get().activePad === padId) {
          set({ activePad: null });
        }
      }, 120);
    },
  };
});
