/**
 * What the timeline's right-click menus share: closing on Esc, a click outside, scrolling, resizing
 * or Tab out of them, their keys, and staying on screen.
 */
import { useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import { usePopupKeys } from '../popupKeys';

/**
 * Close a popup menu on Esc, a click outside it, scrolling the page (or a panel), resizing the
 * window, or Tab out of it (Shift+Tab off its top: back on what opened it, `opener` if given, else
 * what was pressed or had focus as it opened; Tab off its end: on to the stop after that). Opened
 * from the keyboard (the menu key, Shift+F10, Enter on a button), it takes focus on its first
 * item, the arrow keys move between its items (and along a row of them, the track menu's
 * colours), and focus goes back when it closes; opened with the mouse it works as it always has.
 */
export function useMenuDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void, opener?: () => HTMLElement | null | undefined): void {
  usePopupKeys(ref, { onClose, opener, place: 'portal', menu: true });
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
