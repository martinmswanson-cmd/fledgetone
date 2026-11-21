/**
 * The playback mode setting as it's stored in this browser (see playbackMode.ts): a mode the
 * person picked, or Stable that the app switched to by itself after playback kept lagging
 * (perfMonitor.ts). The app only ever switches by itself when nobody has picked a mode: a choice
 * made on purpose, Responsive included, is kept. Pure, so Node can test it.
 */

/** What the lag warning is about: the page freezing (notes sent late), or the audio engine itself falling behind. */
export type LagKind = 'busy' | 'behind';

/**
 * Whether the lag warning pops up. Once closed it stays away for the rest of the visit (the LAG
 * badge in the header still says so and opens the same help), except that a warning closed while
 * only the page was busy comes back once if the audio engine itself then falls behind: that's a
 * different problem, with different fixes.
 */
export function lagWarningShows(lagging: boolean, kind: LagKind, closedFor: LagKind | null): boolean {
  if (!lagging) return false;
  return closedFor === null || (closedFor === 'busy' && kind === 'behind');
}

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
