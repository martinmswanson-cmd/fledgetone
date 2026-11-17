/**
 * A small window you work beside, dragged by its title bar (the tuner, the spectrum analyser): not
 * a dialog, so the song, the shortcuts and the keyboard piano keep working while it's open.
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';

export const FloatingWindow: React.FC<{
  title: string;
  icon?: React.ReactNode;
  /** Where it first appears, from the window's left and top */
  at: { x: number; y: number };
  onClose: () => void;
  /** Beside the title (a menu, a switch) */
  bar?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, at, onClose, bar, children }) => {
  const [pos, setPos] = useState(() => ({ x: Math.max(8, Math.min(at.x, window.innerWidth - 120)), y: Math.max(8, Math.min(at.y, window.innerHeight - 80)) }));
  const drag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    const move = (ev: PointerEvent) => setPos({ x: Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - start.x)), y: Math.max(0, Math.min(window.innerHeight - 30, ev.clientY - start.y)) });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  return (
    <div role="region" aria-label={title} data-floating-window className="fixed z-[46] rounded-lg border border-cyan-400/50 bg-forge-panel shadow-2xl max-w-[95vw]" style={{ left: pos.x, top: pos.y }} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="flex items-center gap-2 px-3 h-8 border-b border-forge-border cursor-move select-none" onPointerDown={drag}>
        {icon}
        <span className="text-xs font-semibold text-forge-text whitespace-nowrap">{title}</span>
        <div className="ml-auto flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
          {bar}
          <button type="button" onClick={onClose} className="h-6 w-6 flex items-center justify-center text-forge-muted hover:text-forge-text" title="Close" aria-label={`Close the ${title.toLowerCase()}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
};
