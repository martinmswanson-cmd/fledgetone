/**
 * Distance (Track.distance): how a part set back on the stage reaches the hall. Its reverb send
 * gets a little more on top of what the track sends, whether the send is the track's own setting
 * or an automation lane's value at the moment (the lane writes the send, so the extra is added to
 * each value it writes). Pure numbers, so Node can test it; trackStrip.ts applies them.
 */

/** How much more of a track reaches the hall at full distance (added to its reverb send) */
export const DISTANCE_SEND = 0.35;

/** The reverb send a track plays at: its send (setting or lane value) plus its distance's extra, 0..1. */
export function roomSendLevel(send: number, distance: number): number {
  const d = Math.max(0, Math.min(1, distance || 0));
  return Math.max(0, Math.min(1, (send || 0) + DISTANCE_SEND * d));
}
