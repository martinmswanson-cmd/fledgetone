import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { instrumentsByCategory } from '../../audio/instrumentCatalog';

const MENU_W = 300;
const MENU_MAX_H = 440;

/**
 * "Add Track" button and its instrument picker. The picker floats (position: fixed, portalled to
 * <body>) so nothing in the timeline can clip or cover it, lists every instrument by category, and closes on an
 * outside click or Escape.
 */
export const AddTrackMenu: React.FC = () => {
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null);
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setPos(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) return setPos(null);
    const r = buttonRef.current!.getBoundingClientRect();
    // Open on whichever side of the button has more room, never covering the button itself
    const roomBelow = window.innerHeight - r.bottom - 12;
    const roomAbove = r.top - 12;
    const left = Math.min(r.left, window.innerWidth - MENU_W - 8);
    if (roomBelow >= MENU_MAX_H || roomBelow >= roomAbove) {
      setPos({ left, top: r.bottom + 4, maxHeight: Math.min(MENU_MAX_H, roomBelow) });
    } else {
      const maxHeight = Math.min(MENU_MAX_H, roomAbove);
      setPos({ left, top: r.top - 4 - maxHeight, maxHeight });
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={pos !== null}
        className="w-full h-7 rounded border border-dashed border-forge-border hover:border-cyan-400 text-forge-muted hover:text-cyan-200 bg-forge-bg/60 hover:bg-cyan-950/20 text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition shadow-sm"
        title="Add a new instrument track"
      >
        <Plus className="w-3.5 h-3.5" />
        Add Track
      </button>

      {/* Rendered into <body>: inside the timeline's sticky header column it would share that
          column's stacking layer and get covered by later sticky rows (e.g. the piano roll ruler) */}
      {pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-50 rounded-lg bg-forge-panel border border-forge-borderLight shadow-2xl flex flex-col text-xs font-mono overflow-hidden"
            style={{ left: pos.left, top: pos.top, width: MENU_W, maxHeight: pos.maxHeight }}
          >
            <div className="px-3 py-1.5 text-[10px] text-forge-muted font-bold uppercase tracking-wider border-b border-forge-border bg-black/40">
              Add Instrument Track
            </div>
            <div className="overflow-y-auto py-1">
              {instrumentsByCategory().map(({ category, instruments }) => (
                <div key={category}>
                  <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest text-forge-muted/80 font-bold">{category}</div>
                  {instruments.map((inst) => (
                    <button
                      key={inst.key}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        useTimelineStore.getState().addTrack(inst.key);
                        setPos(null);
                      }}
                      className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-forge-bg text-left transition"
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: inst.color }} />
                      <span className="text-forge-text font-medium whitespace-nowrap">{inst.name}</span>
                      <span className="ml-auto text-[10px] text-forge-muted truncate pl-2">{inst.blurb}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
