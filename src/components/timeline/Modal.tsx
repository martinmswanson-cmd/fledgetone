/**
 * A centred dialog over a dimmed page, closed by Esc, its close button or a click outside. Tab
 * stays inside it, and focus goes back where it was when it closes.
 */
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** A wider dialog, for lists laid out in columns. */
  wide?: boolean;
}

/** What Tab moves between inside the dialog. */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A centred dialog over a dimmed page. Esc, the close button or a click outside it calls `onClose`. */
export const Modal: React.FC<ModalProps> = ({ title, onClose, children, wide = false }) => {
  const dialog = useRef<HTMLDivElement>(null);
  // Where focus was before the dialog opened (read on the first render, before anything in it autofocuses)
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  // (The latest onClose, for the key handler set up once)
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  // Take focus unless a control inside already has it (autoFocus does nothing on a disabled
  // button). Esc is heard on the window, so it works wherever focus is; Tab goes round inside
  useEffect(() => {
    if (dialog.current && !dialog.current.contains(document.activeElement)) dialog.current.focus();
    const onKey = (e: KeyboardEvent) => {
      const el = dialog.current;
      if (!el) return;
      // Another dialog on top of this one (the guide, a popover) has the keys
      const other = document.activeElement?.closest('[role="dialog"]');
      if (other && other !== el) return;
      if (e.key === 'Escape') {
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((f) => f.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = el.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    const back = opener.current;
    return () => {
      window.removeEventListener('keydown', onKey);
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Capped to the screen height, scrolling inside, so a long dialog still fits a phone */}
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-full flex flex-col rounded-xl border border-forge-borderLight bg-forge-panel shadow-2xl focus:outline-none`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-forge-border">
          <h3 className="text-sm font-semibold text-forge-text">{title}</h3>
          <button type="button" onClick={onClose} className="text-forge-muted hover:text-forge-text" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto text-xs text-forge-muted">{children}</div>
      </div>
    </div>
  );
};
