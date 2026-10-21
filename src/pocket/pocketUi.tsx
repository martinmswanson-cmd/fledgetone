/**
 * Pocket's small shared pieces: a bottom sheet (a list that slides up over the screen), a card
 * section, the button style, sized for thumbs (at least 44 px), and the chooser of how often a
 * note plays.
 */
import React, { useEffect } from 'react';
import { Check, X } from 'lucide-react';
import { onBack } from '../native/backButton';
import { NOTE_CHANCES, chanceIdOf } from '../store/noteChance';
import type { NoteEvent } from '../store/timelineTypes';

export const pill = 'h-11 px-4 rounded-xl border border-forge-border bg-forge-panel text-sm font-medium active:scale-95 transition-transform disabled:opacity-40 flex items-center justify-center gap-2';
export const pillOn = '!border-cyan-400 !bg-cyan-500/15 text-cyan-200';

/** A titled card. */
export const Card: React.FC<{ title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }> = ({ title, right, children }) => (
  <section className="rounded-2xl border border-forge-border bg-forge-panel/60 p-3 mb-3">
    {(title || right) && (
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-semibold text-forge-text flex-1 min-w-0 truncate">{title}</h2>
        {right}
      </div>
    )}
    {children}
  </section>
);

/** A sheet over the bottom of the screen, closed by its X, the backdrop, Esc or the phone's Back. */
export const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    const off = onBack(() => {
      onClose();
      return true;
    });
    return () => {
      window.removeEventListener('keydown', key);
      off();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative max-h-[85dvh] flex flex-col rounded-t-3xl border-t border-forge-border bg-forge-panel pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-forge-border">
          <h2 className="flex-1 text-base font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="w-11 h-11 -mr-2 flex items-center justify-center text-forge-muted">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-3 py-3">{children}</div>
      </div>
    </div>
  );
};

/** A row in a sheet's list: a name and a line about it. */
export const SheetItem: React.FC<{ title: string; detail?: string; onClick: () => void; color?: string; trailing?: React.ReactNode }> = ({ title, detail, onClick, color, trailing }) => {
  const item = (
    <button type="button" onClick={onClick} className="w-full min-w-0 text-left px-3 py-3 rounded-xl active:bg-white/5 flex items-start gap-3">
      {color && <span className="mt-1.5 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />}
      <span className="min-w-0">
        <span className="block text-sm text-forge-text">{title}</span>
        {detail && <span className="block text-xs text-forge-muted mt-0.5 line-clamp-2">{detail}</span>}
      </span>
    </button>
  );
  // (A star or a bin beside the row, not inside its button)
  return trailing ? <div className="flex items-center">{item}{trailing}</div> : item;
};

/** How often a note plays (see noteChance.ts): Always, 75%, 50%, 25%, 1st of 2... */
export const ChanceSheet: React.FC<{ title: string; note: Pick<NoteEvent, 'chance' | 'cond'>; onPick: (id: string) => void; onClose: () => void }> = ({ title, note, onPick, onClose }) => {
  const now = chanceIdOf(note);
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="text-xs text-forge-muted px-2 mb-2">A note that doesn't play every time keeps a repeated part from going stale. "1st of 2" plays the first time round, not the second, and so on; a percentage is how likely it is to play each time.</p>
      {NOTE_CHANCES.map((c) => (
        <SheetItem
          key={c.id}
          title={c.label}
          onClick={() => {
            onPick(c.id);
            onClose();
          }}
          trailing={c.id === now ? <Check className="w-4 h-4 mr-3 text-cyan-300 shrink-0" aria-label="Chosen" /> : undefined}
        />
      ))}
    </Sheet>
  );
};
