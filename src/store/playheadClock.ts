import { useSyncExternalStore } from 'react';

/**
 * The playhead as it moves, every animation frame while playing, for what has to move with it
 * smoothly: the playhead line, the view following it, the editors' playheads, the reference video.
 *
 * The store's playheadPosition is the same position, but while playing it's set only a few times a
 * second (timelineStore.ts): setting the store every frame ran every one of the app's store
 * subscriptions sixty times a second, on the main thread that hands the notes to the audio engine.
 * Stopped, every seek and move reaches both at once.
 */

let position = 1;
const listeners = new Set<() => void>();

/** Where the playhead is now. */
export const livePlayhead = (): number => position;

/** Move it (the store's frame loop, and every store change of playheadPosition). */
export function setLivePlayhead(bar: number): void {
  if (bar === position) return;
  position = bar;
  for (const l of listeners) l();
}

/** Called on every move, until the returned function is called. */
export function onPlayhead(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The playhead for a component that moves with it every frame. */
export function useLivePlayhead(): number {
  return useSyncExternalStore(onPlayhead, livePlayhead);
}
