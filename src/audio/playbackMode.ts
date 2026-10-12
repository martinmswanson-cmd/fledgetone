import * as Tone from 'tone';

/**
 * How the browser buffers live audio, chosen per browser (Inspector > Master > Playback) and
 * applied when the app starts, before the mix is built (the browser fixes an audio context's
 * buffer when it's created). Imported first by main.tsx.
 *
 * - responsive: the browser's smallest buffer and Tone's usual 0.1 s look-ahead. Least delay
 *   between a key pressed on a MIDI keyboard and its sound.
 * - stable: the browser's playback-sized buffer and a 0.25 s look-ahead, so a busy moment (on the
 *   audio thread or the page) is absorbed instead of heard as a crackle or a late note. Adds a
 *   few tens of milliseconds of delay to live playing.
 */
export type PlaybackMode = 'responsive' | 'stable';

const KEY = 'bosBeatbox.playbackMode';

function read(): PlaybackMode {
  try {
    return localStorage.getItem(KEY) === 'stable' ? 'stable' : 'responsive';
  } catch {
    return 'responsive';
  }
}

/** The mode this page started with. */
export const PLAYBACK_MODE: PlaybackMode = read();

/** Remember a mode for the next start (it applies after a reload). */
export function choosePlaybackMode(mode: PlaybackMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Storage blocked: the choice can't be kept
  }
}

/** The mode chosen for the next start (may differ from PLAYBACK_MODE until a reload). */
export const chosenPlaybackMode = (): PlaybackMode => read();

if (PLAYBACK_MODE === 'stable' && typeof window !== 'undefined') {
  // The context Tone made when it was imported isn't used: let it go (its clock and audio device)
  const unused = Tone.getContext();
  Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0.25 }), true);
  void (unused as Tone.Context).close?.().catch(() => {});
}
