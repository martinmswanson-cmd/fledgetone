import React, { useEffect, useLayoutEffect, useRef } from 'react';

/** Room kept between a popover and the edge of whatever would cut it off. */
const EDGE_GAP = 8;

/**
 * Slide a popover sideways so it stays on screen and inside every box around it that clips its
 * overflow (the timeline card does: there, focusing a field hanging past the edge would scroll the
 * whole card sideways), narrowing it if that box is narrower still.
 */
function keepInside(el: HTMLElement) {
  el.style.translate = '';
  el.style.maxWidth = '';
  let left = 0;
  let right = document.documentElement.clientWidth;
  for (let box = el.parentElement; box && box !== document.body; box = box.parentElement) {
    if (getComputedStyle(box).overflowX === 'visible') continue;
    const r = box.getBoundingClientRect();
    left = Math.max(left, r.left);
    right = Math.min(right, r.right);
  }
  if (el.offsetWidth > right - left - 2 * EDGE_GAP) el.style.maxWidth = `${right - left - 2 * EDGE_GAP}px`;
  const rect = el.getBoundingClientRect();
  const dx = Math.max(left + EDGE_GAP - rect.left, Math.min(0, right - EDGE_GAP - rect.right));
  if (dx) el.style.translate = `${dx}px 0`;
}

interface PopoverProps {
  /** Accessible name of the dialog. */
  label: string;
  onClose: () => void;
  /** The button that opens the popover: clicks on it toggle rather than count as "outside". */
  anchorRef: React.RefObject<HTMLElement | null>;
  className?: string;
  children: React.ReactNode;
}

/**
 * A small panel dropped below its anchor (place it inside a `relative` wrapper), slid sideways if
 * it would stick out of the screen or a clipping box. It's a dialog, so the timeline's and sound
 * deck's keyboard shortcuts pause while it's open. Esc or a click anywhere else closes it. Mark the
 * field to focus on opening with `data-autofocus` (not `autoFocus`, which focuses before placing).
 */
export const Popover: React.FC<PopoverProps> = ({ label, onClose, anchorRef, className = '', children }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't let Esc also close the piano roll or clear the clip selection
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose, anchorRef]);

  // Place it before anything in it takes focus (focus would scroll a clipping box to show the field),
  // then focus the field marked data-autofocus and bring the panel into view if it opened below the fold
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    keepInside(el);
    el.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    const below = el.getBoundingClientRect().bottom + EDGE_GAP - window.innerHeight;
    if (below > 0) window.scrollBy({ top: below });
    const onResize = () => keepInside(el);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`absolute z-50 top-full mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-forge-borderLight bg-forge-panel shadow-2xl p-3 flex flex-col gap-2.5 text-xs text-forge-muted ${className}`}
    >
      {children}
    </div>
  );
};
