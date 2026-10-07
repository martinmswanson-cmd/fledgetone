import { useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** Close a popup menu on Esc, a click outside it, scrolling the page (or a panel) or resizing the window. */
export function useMenuDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const outside = (e: Event) => !ref.current?.contains(e.target as Node);
    const onPointerDown = (e: PointerEvent) => {
      if (outside(e)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Scrolling inside the menu doesn't count: a number box scrolls its own text once it's full
    const onScroll = (e: Event) => {
      if (outside(e)) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [ref, onClose]);
}

/**
 * Put a fixed-position menu at (x, y), moved left / up as far as needed to stay on screen. Runs
 * after every render, because a notice or an input appearing inside the menu makes it taller.
 */
export function useKeepOnScreen(ref: RefObject<HTMLElement | null>, x: number, y: number): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(y, window.innerHeight - el.offsetHeight - 8))}px`;
  });
}

export const menuClass = 'fixed z-50 w-60 py-1 rounded-md border border-forge-borderLight bg-forge-panelLight shadow-2xl text-xs font-mono';
