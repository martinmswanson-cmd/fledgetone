/**
 * A centred dialog over a dimmed page, closed by Esc, its close button or a click outside. Tab
 * stays inside it, and focus goes back where it was when it closes.
 */
import React, { useRef } from 'react';
import { useDialogFocus } from './useDialogFocus';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** A wider dialog, for lists laid out in columns. */
  wide?: boolean;
}

/** A centred dialog over a dimmed page. Esc, the close button or a click outside it calls `onClose`. */
export const Modal: React.FC<ModalProps> = ({ title, onClose, children, wide = false }) => {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, onClose);

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
