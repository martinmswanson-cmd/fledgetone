/**
 * Which sound sources' ended handlers an export runs at a suspend, and in what order (see
 * endedOnTime.ts). Pure: no Web Audio. A source told to stop is due once the render has reached
 * its stop time, whether or not the browser has reported its end yet (the report's moment varies
 * from render to render; the stop time doesn't). One never told to stop is due once the browser
 * has reported it. Due ones run in order of their stop times, then of when they were given a
 * handler, so every render lets go of the same nodes in the same order.
 */

/** One source waiting for its ended handlers to run. */
export interface EndedWait {
  /** When it was told to stop (seconds), or null if it hasn't been */
  stopAt: number | null;
  /** The browser has reported its end */
  ended: boolean;
}

/** The indices of `waiting` (in the order they were given a handler) whose handlers run at `time`, in the order they run. */
export function endedDue(waiting: readonly EndedWait[], time: number): number[] {
  const at = (w: EndedWait) => w.stopAt ?? (w.ended ? time : Infinity);
  return waiting
    .map((_, i) => i)
    .filter((i) => at(waiting[i]) <= time)
    .sort((a, b) => at(waiting[a]) - at(waiting[b]) || a - b);
}
