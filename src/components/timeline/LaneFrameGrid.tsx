import React from 'react';
import { TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import { frameBars } from '../../store/timelineTypes';
import { useDrawnStretch } from './drawnStretch';
import { TRACK_HEIGHT } from './layout';

/** Lines closer than this would just grey the lane out. */
const MIN_FRAME_PX = 8;

/**
 * Faint lines on every video frame across a lane, while Snap is Frame and frames are at least 8px
 * apart, so frame-snapped clips visibly sit on them. Drawn in SVG for the visible stretch only:
 * a repeating CSS background can't do it, because browsers round a tile's width to 1/64 px and a
 * frame is rarely a whole number of those, so the lines drift off the frames (by most of a frame
 * a few hundred bars in).
 */
export const LaneFrameGrid = React.memo(function LaneFrameGrid() {
  const pxPerFrame = useTimelineStore((s) => (s.snapGrid === 'frame' ? frameBars(s) * s.zoom : 0));
  return pxPerFrame >= MIN_FRAME_PX ? <FrameLines pxPerFrame={pxPerFrame} /> : null;
});

const FrameLines: React.FC<{ pxPerFrame: number }> = ({ pxPerFrame }) => {
  const zoom = useTimelineStore((s) => s.zoom);
  const { drawFrom, drawTo } = useDrawnStretch(TOTAL_BARS * zoom);
  let path = '';
  // Frames count from the start of bar 1, as the Frame snap does
  for (let k = Math.ceil(drawFrom / pxPerFrame); k * pxPerFrame <= drawTo; k++) {
    path += `M${Math.round(k * pxPerFrame) - drawFrom + 0.5} 0V${TRACK_HEIGHT}`;
  }
  return (
    <svg
      data-frame-grid=""
      className="absolute top-0 h-full pointer-events-none"
      style={{ left: drawFrom, width: Math.max(0, drawTo - drawFrom) }}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path d={path} stroke="rgba(255,255,255,0.025)" />
    </svg>
  );
};
