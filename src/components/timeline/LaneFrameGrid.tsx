/**
 * Grid lines drawn across lanes for the visible stretch only: video frame lines while snapping to
 * frames, and measure and beat lines in songs with other meters than 4/4.
 */
import React from 'react';
import { TOTAL_BARS, useSongMeter, useSongTempo, useTimelineStore } from '../../store/timelineStore';
import { barToSeconds, isPlainMeter, measuresBetween, secondsToBar } from '../../audio/tempoMap';
import { frameSeconds } from '../../audio/timecode';
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
  const fps = useTimelineStore((s) => s.fps);
  const tempo = useSongTempo();
  const { drawFrom, drawTo } = useDrawnStretch(TOTAL_BARS * zoom);
  let path = '';
  // Frames count from the start of bar 1, as the Frame snap does (along any tempo changes)
  if (tempo.points.length) {
    const frame = frameSeconds(fps);
    const xOf = (k: number) => (secondsToBar(k * frame, tempo) - 1) * zoom;
    for (let k = Math.ceil(barToSeconds(drawFrom / zoom + 1, tempo) / frame); xOf(k) <= drawTo; k++) path += `M${Math.round(xOf(k)) - drawFrom + 0.5} 0V${TRACK_HEIGHT}`;
  } else {
    for (let k = Math.ceil(drawFrom / pxPerFrame); k * pxPerFrame <= drawTo; k++) {
      path += `M${Math.round(k * pxPerFrame) - drawFrom + 0.5} 0V${TRACK_HEIGHT}`;
    }
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

/**
 * Measure and beat lines across a lane in a song with other time signatures than 4/4 (in plain
 * 4/4 the lane's repeating background draws them). Drawn for the visible stretch only.
 */
export const LaneMeterGrid = React.memo(function LaneMeterGrid() {
  const meterMap = useSongMeter();
  const zoom = useTimelineStore((s) => s.zoom);
  const { drawFrom, drawTo } = useDrawnStretch(TOTAL_BARS * zoom);
  if (isPlainMeter(meterMap)) return null;
  const measures = measuresBetween(Math.max(1, drawFrom / zoom), drawTo / zoom + 1, meterMap);
  const step = (() => {
    const avg = measures.length ? measures.reduce((a, m) => a + m.meter.num / m.meter.den, 0) / measures.length : 1;
    return [1, 2, 4, 8, 16, 32].find((k) => k * avg * zoom >= 44) ?? 64;
  })();
  let strong = '';
  let weak = '';
  const x = (bar: number) => Math.round((bar - 1) * zoom) - drawFrom + 0.5;
  for (const m of measures) {
    if ((m.measure - 1) % step === 0) strong += `M${x(m.bar)} 0V${TRACK_HEIGHT}`;
    else weak += `M${x(m.bar)} 0V${TRACK_HEIGHT}`;
    if (zoom / m.meter.den >= 12) for (let b = 1; b < m.meter.num; b++) weak += `M${x(m.bar + b / m.meter.den)} 0V${TRACK_HEIGHT}`;
  }
  return (
    <svg className="absolute top-0 h-full pointer-events-none" style={{ left: drawFrom, width: Math.max(0, drawTo - drawFrom) }} shapeRendering="crispEdges" aria-hidden="true">
      <path d={weak} stroke="rgba(255,255,255,0.05)" />
      <path d={strong} stroke="rgba(255,255,255,0.14)" />
    </svg>
  );
});
