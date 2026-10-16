/**
 * Painting a grid with a finger: press a cell to turn it on (or off, if it was on), then slide
 * along the row to do the same to every cell passed over. The whole stroke is one undo step.
 * Cells carry data-row and data-step; the grid takes the pointer events (its touch-action is
 * pan-y, so sliding up or down still scrolls the page while sliding sideways paints).
 */
import type React from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { buzz } from './pocketSession';

type Cell = { row: string; step: number };

function cellAt(x: number, y: number): Cell | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-row][data-step]');
  return el ? { row: el.dataset.row!, step: Number(el.dataset.step) } : null;
}

/**
 * Pointer handlers for a grid: `isOn` says whether a cell is on, `paint` turns one on or off
 * (called only when it changes).
 */
export function paintHandlers(isOn: (c: Cell) => boolean, paint: (c: Cell, on: boolean) => void): Pick<React.HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onClick'> {
  return {
    onPointerDown: (e) => {
      const first = cellAt(e.clientX, e.clientY);
      if (!first || e.button > 0) return;
      e.preventDefault();
      const on = !isOn(first);
      useTimelineStore.getState().checkpoint();
      paint(first, on);
      buzz();
      let last = `${first.row}|${first.step}`;
      const move = (ev: PointerEvent) => {
        const c = cellAt(ev.clientX, ev.clientY);
        // Along the row the stroke started on
        if (!c || c.row !== first.row) return;
        const key = `${c.row}|${c.step}`;
        if (key === last) return;
        last = key;
        if (isOn(c) !== on) paint(c, on);
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    // A keyboard's Enter or Space on a cell (a pointer's press was handled above)
    onClick: (e) => {
      if (e.detail !== 0) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-row][data-step]');
      if (!el) return;
      const c = { row: el.dataset.row!, step: Number(el.dataset.step) };
      useTimelineStore.getState().checkpoint();
      paint(c, !isOn(c));
    },
  };
}
