import type { LoopRegion } from './timelineTypes';
import { TOTAL_BARS } from './timelineTypes';

const EPS = 1e-6;

/**
 * An insert or delete bars (the ruler's ripple edits), as plain numbers. Undo steps keep this
 * rather than the functions that move positions (see rippleRules): a function made inside a store
 * action keeps everything that action could see alive, the whole store state at the time included
 * (its undo history too), so each ripple step held on to every state before it.
 */
export type RippleEdit =
  | { kind: 'insert'; at: number; bars: number }
  /** `minLoop`: the shortest loop the snap grid allowed at the time. */
  | { kind: 'remove'; from: number; to: number; minLoop: number };

/** How a ripple edit moves what sits at a song position. */
export interface RippleRules {
  movePoint: (bar: number) => number;
  moveLoop: (loop: LoopRegion) => LoopRegion;
  /** From after the edit back to before it (a position in bars that were removed comes back at the cut). */
  backPoint: (bar: number) => number;
}

export function rippleRules(edit: RippleEdit): RippleRules {
  if (edit.kind === 'insert') {
    const { at, bars } = edit;
    // Positions move with the music after the insert point. A loop starting there moves; one ending there doesn't.
    const movePoint = (bar: number) => (bar >= at - EPS ? bar + bars : bar);
    return {
      movePoint,
      moveLoop: (loop) => {
        const outBar = loop.outBar > at + EPS ? loop.outBar + bars : loop.outBar;
        const inBar = movePoint(loop.inBar);
        // Pushed off the end: pin Out to the end of the timeline. A loop that moved whole keeps its
        // length; one that started before the insert point keeps its In.
        if (outBar > TOTAL_BARS + 1) return { ...loop, outBar: TOTAL_BARS + 1, inBar: Math.min(inBar, TOTAL_BARS + 1 - (loop.outBar - loop.inBar)) };
        return { ...loop, inBar, outBar };
      },
      backPoint: (bar) => (bar >= at + bars - EPS ? bar - bars : Math.min(bar, at)),
    };
  }
  const { from, to, minLoop } = edit;
  const len = to - from;
  const movePoint = (bar: number) => (bar <= from ? bar : bar >= to ? bar - len : from);
  return {
    movePoint,
    moveLoop: (loop) => {
      const inBar = movePoint(loop.inBar);
      const outBar = movePoint(loop.outBar);
      // A loop (nearly) all inside the removed bars, like "Delete bars In → Out", keeps its length, now over what came after
      if (outBar - inBar < minLoop - EPS) return { ...loop, inBar, outBar: Math.min(TOTAL_BARS + 1, inBar + loop.outBar - loop.inBar) };
      return { ...loop, inBar, outBar };
    },
    backPoint: (bar) => (bar > from + EPS ? bar + len : bar),
  };
}
