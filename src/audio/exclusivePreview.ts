/**
 * One preview at a time, so two musics never play at once: each player of a preview outside the
 * song (a suggestion's before-and-after, Try it in a game, the Game preview's audition pads, the
 * rhythm game, the SFX maker, a variation or a tuned clip heard, a chop, a Fledge Synth preset or
 * its tour, an instrument's preview) says how it stops (registerPreview, or useExclusivePreview in
 * a component) and claims the speakers when it starts (claimPreview): every other one stops. A
 * player that can't be stopped (a short phrase) only claims. Imports nothing, so anything can use
 * it without bringing in what the others need (the agent's code stays out of the first download).
 */
import { useCallback, useEffect, useRef } from 'react';

const stops = new Map<string, () => void>();

/** How preview `id` stops (one per id: a second replaces the first). Returns the way to take it back. */
export function registerPreview(id: string, stop: () => void): () => void {
  stops.set(id, stop);
  return () => {
    if (stops.get(id) === stop) stops.delete(id);
  };
}

/** Preview `id` starts: every other preview stops. */
export function claimPreview(id: string): void {
  for (const [other, stop] of [...stops]) {
    if (other === id) continue;
    try {
      stop();
    } catch {
      // A player already gone
    }
  }
}

/**
 * For a component that plays a preview: `stop` is registered while it's mounted (as it is at each
 * render), and the function returned claims the speakers (call it as the preview starts).
 */
export function useExclusivePreview(id: string, stop: () => void): () => void {
  const latest = useRef(stop);
  useEffect(() => {
    latest.current = stop;
  });
  useEffect(() => registerPreview(id, () => latest.current()), [id]);
  return useCallback(() => claimPreview(id), [id]);
}
