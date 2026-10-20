/**
 * The overview scrollbar under the lanes: the whole song in miniature, with the visible window as
 * a thumb to drag, click or stretch (zoom).
 */
import { usePlayheadReadout } from './playheadReadout';
import React, { useEffect, useRef, useState } from 'react';
import { MAX_ZOOM, MIN_ZOOM, TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import { HEADER_WIDTH } from './layout';

const HANDLE_PX = 8;

/** Follow the pointer until release, showing `cursor` page-wide meanwhile. */
function trackPointer(cursor: string, onMove: (ev: PointerEvent) => void): void {
  const onUp = () => {
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  document.body.style.cursor = cursor;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

interface TimelineScrollbarProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Premiere-style horizontal slider under the lanes. The track is an overview of the whole
 * song (clips, loop region, playhead); the thumb is the visible window.
 * Drag the thumb to scroll, click the track to jump there, drag a thumb edge to zoom.
 */
export const TimelineScrollbar: React.FC<TimelineScrollbarProps> = ({ scrollRef }) => {
  const zoom = useTimelineStore((s) => s.zoom);
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const loop = useTimelineStore((s) => s.loopRegion);
  const trackRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1 });

  // Mirror the scroll container's horizontal position and visible width
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setView({ left: el.scrollLeft, width: Math.max(1, el.clientWidth - HEADER_WIDTH) });
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [scrollRef, zoom]);

  const total = TOTAL_BARS * zoom;
  const startFrac = Math.min(1, view.left / total);
  const widthFrac = Math.min(1, view.width / total);

  const trackWidth = () => trackRef.current?.getBoundingClientRect().width ?? 1;

  const dragThumb = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    const pxPerTrackPx = (TOTAL_BARS * useTimelineStore.getState().zoom) / trackWidth();
    const onMove = (ev: PointerEvent) => {
      el.scrollLeft = startScroll + (ev.clientX - startX) * pxPerTrackPx;
    };
    trackPointer('grabbing', onMove);
  };

  /** Drag one edge of the thumb: the other edge stays put and zoom changes to fit. */
  const dragEdge = (edge: 'left' | 'right') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = scrollRef.current;
    if (!el) return;
    const w = trackWidth();
    const visible = Math.max(1, el.clientWidth - HEADER_WIDTH);
    const z0 = useTimelineStore.getState().zoom;
    const l0 = (el.scrollLeft / (TOTAL_BARS * z0)) * w;
    const r0 = l0 + (visible / (TOTAL_BARS * z0)) * w;
    const startX = e.clientX;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const l = edge === 'left' ? Math.max(0, Math.min(r0 - 4, l0 + dx)) : l0;
      const r = edge === 'right' ? Math.min(w, Math.max(l0 + 4, r0 + dx)) : r0;
      const zoomTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, visible / (((r - l) / w) * TOTAL_BARS)));
      useTimelineStore.getState().setZoom(zoomTarget);
      const z = useTimelineStore.getState().zoom;
      const scroll = edge === 'right' ? (l / w) * TOTAL_BARS * z : (r / w) * TOTAL_BARS * z - visible;
      // Let React apply the new lane width before scrolling into it
      requestAnimationFrame(() => {
        el.scrollLeft = scroll;
      });
    };
    trackPointer('ew-resize', onMove);
  };

  const jumpTo = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = scrollRef.current;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!el || !rect) return;
    const frac = (e.clientX - rect.left) / rect.width;
    el.scrollLeft = frac * total - view.width / 2;
    dragThumb(e);
  };

  const pct = (bar: number) => `${((bar - 1) / TOTAL_BARS) * 100}%`;
  const rowOf = new Map(tracks.map((t, i) => [t.id, i]));
  const rowH = 100 / Math.max(1, tracks.length);

  return (
    <div className="flex items-center border-t border-forge-border bg-forge-panel select-none">
      <div className="shrink-0 px-3 text-[10px] font-mono uppercase tracking-widest text-forge-muted" style={{ width: HEADER_WIDTH }}>
        Overview
      </div>
      <div className="flex-1 min-w-0 py-1.5 pr-3">
        <div
          ref={trackRef}
          className="relative h-7 rounded-md bg-forge-bg border border-forge-border overflow-hidden cursor-pointer"
          onPointerDown={jumpTo}
          role="scrollbar"
          aria-orientation="horizontal"
          aria-label="Timeline scroll"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(startFrac * 100)}
        >
          {/* Loop region */}
          {loop.enabled && (
            <div
              className="absolute top-0 bottom-0 bg-amber-400/10 border-x border-amber-400/40 pointer-events-none"
              style={{ left: pct(loop.inBar), width: `${((loop.outBar - loop.inBar) / TOTAL_BARS) * 100}%` }}
            />
          )}

          {/* Clip overview */}
          {clips.map((c) => {
            const row = rowOf.get(c.trackId);
            const track = row === undefined ? null : tracks[row];
            if (!track) return null;
            return (
              <div
                key={c.id}
                className="absolute rounded-[1px] pointer-events-none"
                style={{
                  left: pct(c.startBar),
                  width: `${(c.lengthBars / TOTAL_BARS) * 100}%`,
                  top: `calc(${row! * rowH}% + 2px)`,
                  height: `calc(${rowH}% - 3px)`,
                  backgroundColor: track.color,
                  opacity: 0.7,
                }}
              />
            );
          })}

          <OverviewPlayhead />

          {/* Thumb = visible window */}
          <div
            className="absolute top-0 bottom-0 rounded-md border-2 border-cyan-300/90 bg-cyan-300/10 cursor-grab shadow-[0_0_8px_rgba(103,232,249,0.35)]"
            style={{ left: `${startFrac * 100}%`, width: `${widthFrac * 100}%`, minWidth: HANDLE_PX * 3 }}
            onPointerDown={dragThumb}
            title="Drag to scroll • drag an end to zoom"
          >
            <div
              className="absolute left-0 top-0 bottom-0 cursor-ew-resize flex items-center justify-center hover:bg-cyan-300/30"
              style={{ width: HANDLE_PX }}
              onPointerDown={dragEdge('left')}
            >
              <div className="w-px h-3 bg-cyan-200" />
            </div>
            <div
              className="absolute right-0 top-0 bottom-0 cursor-ew-resize flex items-center justify-center hover:bg-cyan-300/30"
              style={{ width: HANDLE_PX }}
              onPointerDown={dragEdge('right')}
            >
              <div className="w-px h-3 bg-cyan-200" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * The overview's playhead, on its own so the clip overview doesn't re-render every frame of
 * playback. A full-width layer slid by a share of its own width, so moving it repaints nothing.
 */
const OverviewPlayhead: React.FC = () => {
  const playhead = usePlayheadReadout(30);
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ transform: `translateX(${((playhead - 1) / TOTAL_BARS) * 100}%)`, willChange: 'transform' }}>
      <div className="absolute top-0 bottom-0 left-0 w-px bg-red-500" />
    </div>
  );
};
