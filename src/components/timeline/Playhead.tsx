/**
 * The playhead: its line across the lanes and its handle in the ruler, and scrubbing it with the
 * mouse.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { livePlayhead, onPlayhead } from '../../store/playheadClock';
import { snapBar } from '../../store/timelineTypes';
import { HEADER_WIDTH } from './layout';

/** Convert a pointer clientX to a 1-based bar using the ruler's bar-area element as origin. */
export function barFromClientX(clientX: number, origin: HTMLElement | null): number {
  if (!origin) return 1;
  const { zoom } = useTimelineStore.getState();
  const rect = origin.getBoundingClientRect();
  return (clientX - rect.left) / zoom + 1;
}

/**
 * Scrub the playhead with the mouse. Snaps to the active grid unless Shift is held.
 * Works while playing (Transport seeks live) or stopped.
 */
export function useScrub(originRef: React.RefObject<HTMLElement | null>) {
  return useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const seekTo = (clientX: number, shift: boolean) => {
        const s = useTimelineStore.getState();
        const raw = barFromClientX(clientX, originRef.current);
        s.seek(shift ? raw : snapBar(raw, s.snapGrid, s));
      };

      seekTo(e.clientX, e.shiftKey);
      document.body.style.cursor = 'ew-resize';

      const onMove = (ev: PointerEvent) => seekTo(ev.clientX, ev.shiftKey);
      const onUp = () => {
        document.body.style.cursor = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [originRef]
  );
}

interface PlayheadProps {
  variant: 'line' | 'head';
  onScrubStart: (e: React.PointerEvent) => void;
}

/**
 * Current Time Indicator. The "line" variant spans every track lane; the "head"
 * variant is the grab handle drawn inside the ruler. It moves every frame with the live playhead
 * (playheadClock.ts).
 */
export const Playhead: React.FC<PlayheadProps> = ({ variant, onScrubStart }) => {
  const zoom = useTimelineStore((s) => s.zoom);
  const x = (livePlayhead() - 1) * zoom;
  // Moved straight on the page each frame, not by re-rendering: on a big song a render a frame
  // (two playheads) was a good part of the page's time while it played
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = () => {
      if (el.current) el.current.style.transform = `translateX(${(livePlayhead() - 1) * zoom}px)`;
    };
    move();
    return onPlayhead(move);
  }, [zoom]);

  if (variant === 'head') {
    return (
      // Over the in/out brackets (z-20, earlier in the ruler) but under the marker flags (z-21), so a
      // flag the playhead sits on can still be clicked, dragged and renamed
      <div
        ref={el}
        className="absolute top-0 bottom-0 z-20 w-0"
        style={{ transform: `translateX(${x}px)`, willChange: 'transform' }}
      >
        <div
          className="absolute -left-[7px] top-0 w-[14px] h-full cursor-ew-resize"
          onPointerDown={onScrubStart}
          title="Drag to scrub"
        >
          <svg width="14" height="16" viewBox="0 0 14 16" className="absolute bottom-0 drop-shadow-[0_0_4px_rgba(239,68,68,0.8)]">
            <path d="M1 0 H13 V9 L7 15 L1 9 Z" fill="#ef4444" stroke="#fecaca" strokeWidth="1" />
          </svg>
          <div className="absolute left-[6.5px] top-0 bottom-4 w-px bg-red-500/60" />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={el}
      className="absolute top-0 bottom-0 z-[15] w-0"
      style={{ left: HEADER_WIDTH, transform: `translateX(${x}px)`, willChange: 'transform' }}
    >
      {/* visible needle */}
      <div className="absolute -left-px top-0 bottom-0 w-[2px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)] pointer-events-none" />
      {/* wider invisible grab zone */}
      <div className="absolute -left-[4px] top-0 bottom-0 w-[8px] cursor-ew-resize" onPointerDown={onScrubStart} />
    </div>
  );
};
