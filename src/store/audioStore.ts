import { create } from 'zustand';
import { initAudio, getAudioContextState, setMasterVolume as setEngineMasterVolume, onAudioStateChange } from '../audio';
import type { AudioState } from '../audio';

/**
 * Global audio-context state: running/suspended status, master volume and the
 * audition-pad flash. Tempo and playback live in the timeline store.
 */
interface AudioStoreState {
  audioState: AudioState;
  masterVolume: number;
  activePad: string | null;

  // Actions
  initializeAudio: () => Promise<AudioState>;
  setMasterVolume: (db: number) => void;
  flashPad: (padId: string) => void;
}

export const useAudioStore = create<AudioStoreState>((set, get) => {
  // Listen for audio context state changes
  onAudioStateChange((state) => {
    set({ audioState: state });
  });

  return {
    audioState: getAudioContextState(),
    masterVolume: 0,
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
