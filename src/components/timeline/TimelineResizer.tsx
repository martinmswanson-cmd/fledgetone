import React from 'react';
import { TIMELINE_DEFAULT, useUiStore } from '../../store/uiStore';

/**
 * The bar under the timeline: drag it down to make the timeline taller and see more tracks at once,
 * up to keep it compact. Double-click fits every track in (or, if they already fit, goes back to the
 * usual height). The height is kept in this browser.
 */
export const TimelineResizer: React.FC<{ scrollRef: React.RefObject<HTMLDivElement | null> }> = ({ scrollRef }) => {
  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY;
    // Start from the height it shows now (a short song can show less than its limit)
    const h0 = scrollRef.current?.clientHeight ?? useUiStore.getState().timelineHeight;
    const move = (ev: PointerEvent) => useUiStore.getState().setTimelineHeight(h0 + (ev.clientY - y0));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('cursor-ns-resize');
    };
    document.body.classList.add('cursor-ns-resize');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const fit = () => {
    const el = scrollRef.current;
    const { timelineHeight, setTimelineHeight } = useUiStore.getState();
    if (!el) return;
    // Everything already shows: back to the usual height; else tall enough for every track
    setTimelineHeight(el.scrollHeight <= timelineHeight ? TIMELINE_DEFAULT : el.scrollHeight);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const { timelineHeight, setTimelineHeight } = useUiStore.getState();
    setTimelineHeight(timelineHeight + (e.key === 'ArrowDown' ? 40 : -40));
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the timeline"
      tabIndex={0}
      title="Drag to show more or fewer tracks (double-click to fit them all)"
      onPointerDown={startResize}
      onDoubleClick={fit}
      onKeyDown={onKeyDown}
      className="h-1.5 shrink-0 cursor-ns-resize bg-forge-border/40 hover:bg-cyan-500/50 focus-visible:bg-cyan-500/50 focus:outline-none transition-colors"
    />
  );
};
