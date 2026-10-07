import { useTimelineStore } from '../../store/timelineStore';

/**
 * Zoomed in, the timeline is up to 512,000 px wide, so the ruler labels and the lanes' frame lines
 * are drawn only for the visible stretch plus at least this much either side. Scrolling redraws
 * them once per chunk, not per frame.
 */
export const RENDER_CHUNK = 1024;

/** The stretch of the lanes worth drawing now, in px from bar 1: what's on screen plus a chunk or two either side. */
export function useDrawnStretch(totalWidth: number): { drawFrom: number; drawTo: number } {
  const chunk = useTimelineStore((s) => Math.floor(s.viewLeft / RENDER_CHUNK));
  const viewWidth = useTimelineStore((s) => s.viewWidth);
  return {
    drawFrom: Math.max(0, (chunk - 1) * RENDER_CHUNK),
    drawTo: Math.min(totalWidth, (chunk + 2) * RENDER_CHUNK + viewWidth),
  };
}
