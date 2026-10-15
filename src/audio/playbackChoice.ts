/**
 * The playback mode setting as it's stored in this browser (see playbackMode.ts): a mode the
 * person picked, or Stable that the app switched to by itself after playback kept lagging
 * (perfMonitor.ts). The app only ever switches by itself when nobody has picked a mode: a choice
 * made on purpose, Responsive included, is kept. Pure, so Node can test it.
 */

export type PlaybackMode = 'responsive' | 'stable';

/** What's stored when the app switched to Stable by itself (a choice is stored as its mode) */
export const AUTO_STABLE = 'auto-stable';

/** The stored setting read: the mode, and whether the person chose it (nothing stored: Responsive, not chosen). */
export function readPlaybackChoice(stored: string | null): { mode: PlaybackMode; chosen: boolean } {
  if (stored === 'stable' || stored === 'responsive') return { mode: stored, chosen: true };
  return { mode: stored === AUTO_STABLE ? 'stable' : 'responsive', chosen: false };
}

/**
 * Whether the app should switch itself to Stable for the next start: playback lagged again after
 * the look-ahead was widened (`episodes` times this session), on Responsive, which nobody chose.
 */
export function shouldSwitchToStable(episodes: number, running: PlaybackMode, stored: string | null): boolean {
  const choice = readPlaybackChoice(stored);
  return episodes >= 2 && running === 'responsive' && choice.mode === 'responsive' && !choice.chosen;
}
