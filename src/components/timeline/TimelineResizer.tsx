import React, { useEffect, useState } from 'react';
import { ChevronsDown, GripHorizontal } from 'lucide-react';
import { TIMELINE_DEFAULT, useUiStore } from '../../store/uiStore';

/**
 * The bar under the timeline: drag it down to make the timeline taller (and push the panels under it
 * down) to see more tracks at once, up to keep it compact. It stops at the last track: there's no
 * empty space to drag into. Double-click fits every track in exactly (or, if it already does, goes
 * back to the usual height). The height is kept in this browser.
 */
export const TimelineResizer: React.FC<{ scrollRef: React.RefObject<HTMLDivElement | null> }> = ({ scrollRef }) => {
  // How many pixels of tracks are hidden below the timeline (to say there's more to see)
  const [hidden, setHidden] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    const content = el?.firstElementChild as HTMLElement | null;
    if (!el || !content) return;
    const measure = () => setHidden(Math.max(0, content.offsetHeight - el.clientHeight));
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    watch.observe(content);
    measure();
    return () => watch.disconnect();
  }, [scrollRef]);

  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY;
    const el = scrollRef.current;
    // From the height it shows now, up to the height of its tracks (no empty space under them)
    const h0 = el?.clientHeight ?? useUiStore.getState().timelineHeight;
    const tracks = (el?.firstElementChild as HTMLElement | null)?.offsetHeight ?? Infinity;
    const move = (ev: PointerEvent) => useUiStore.getState().setTimelineHeight(Math.min(tracks, h0 + (ev.clientY - y0)));
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
    // How tall the tracks are (the scroll area's content, not the empty space under them)
    const content = (el.firstElementChild as HTMLElement | null)?.offsetHeight ?? el.scrollHeight;
    // Already fitted: back to the usual height; else exactly tall enough for every track
    setTimelineHeight(Math.abs(content - timelineHeight) <= 2 ? TIMELINE_DEFAULT : content);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const el = scrollRef.current;
    const { setTimelineHeight } = useUiStore.getState();
    const tracks = (el?.firstElementChild as HTMLElement | null)?.offsetHeight ?? Infinity;
    setTimelineHeight(Math.min(tracks, (el?.clientHeight ?? 0) + (e.key === 'ArrowDown' ? 40 : -40)));
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
      className="group relative h-4 shrink-0 cursor-ns-resize flex items-center justify-center bg-forge-border/30 hover:bg-cyan-500/25 focus-visible:bg-cyan-500/25 focus:outline-none transition-colors border-y border-forge-border/60"
    >
      {/* A grip in the middle says it can be dragged */}
      <span className="flex items-center gap-1.5 px-4 py-px rounded-full bg-forge-panelLight border border-forge-borderLight text-forge-muted group-hover:text-cyan-300 group-hover:border-cyan-500/60 transition-colors leading-none">
        <GripHorizontal className="w-4 h-4" aria-hidden />
        {hidden > 8 && (
          <span className="flex items-center gap-0.5 text-[10px] font-mono">
            <ChevronsDown className="w-3 h-3" aria-hidden />
            more tracks below: drag down
          </span>
        )}
      </span>
    </div>
  );
};
