/**
 * A hook for a panel floating beside a button (portalled to the page body, on whichever side has
 * room), closed by a click elsewhere, Esc or scrolling.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MENU_W = 340;
const MENU_MAX_H = 460;

interface FloatingPos {
  left: number;
  top: number;
  maxHeight: number;
}

/**
 * A panel floating by a button (position: fixed, portalled to <body>, so nothing clips or covers
 * it), on whichever side has more room. It closes on a click elsewhere, Esc, or scrolling the page.
 */
export function useFloatingMenu(width = MENU_W, maxHeight = MENU_MAX_H) {
  const [pos, setPos] = useState<FloatingPos | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** Close it, and give focus back to the button if asked. */
  const close = useCallback((refocus = false) => {
    setPos(null);
    if (refocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't let Esc also close the piano roll or clear the clip selection
      e.preventDefault();
      e.stopImmediatePropagation();
      setPos(null);
      buttonRef.current?.focus();
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setPos(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) return setPos(null);
    const r = buttonRef.current!.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const roomBelow = window.innerHeight - r.bottom - 12;
    const roomAbove = r.top - 12;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    if (roomBelow >= maxHeight || roomBelow >= roomAbove) {
      setPos({ left, top: r.bottom + 4, maxHeight: Math.min(maxHeight, roomBelow) });
    } else {
      const h = Math.min(maxHeight, roomAbove);
      setPos({ left, top: r.top - 4 - h, maxHeight: h });
    }
  };

  const render = (label: string, children: React.ReactNode) =>
    pos &&
    createPortal(
      <div
        ref={menuRef}
        role="dialog"
        aria-label={label}
        className="fixed z-50 rounded-lg bg-forge-panel border border-forge-borderLight shadow-2xl flex flex-col text-xs font-mono overflow-hidden"
        style={{ left: pos.left, top: pos.top, width: Math.min(width, window.innerWidth - 16), maxHeight: pos.maxHeight }}
      >
        {children}
      </div>,
      document.body
    );

  return { open: pos !== null, toggle, close, buttonRef, render };
}
