import React, { useEffect, useRef } from 'react';

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
 * A small panel dropped below its anchor (place it inside a `relative` wrapper). It's a dialog, so
 * the timeline's and sound deck's keyboard shortcuts pause while it's open. Esc or a click
 * anywhere else closes it.
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
