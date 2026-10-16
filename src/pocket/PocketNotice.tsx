/**
 * Pocket's opening notice: the phone version is in its early stages and the studio on a computer
 * is the full experience. It shows each time Pocket opens until "Don't show this again" is ticked.
 */
import React, { useState } from 'react';
import { Monitor } from 'lucide-react';
import { pill } from './pocketUi';

const HIDDEN_KEY = 'fledgetone.pocketNoticeHidden';

const hidden = (): boolean => {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
};

export const PocketNotice: React.FC = () => {
  const [open, setOpen] = useState(() => !hidden());
  const [hide, setHide] = useState(false);
  if (!open) return null;
  const close = () => {
    if (hide) {
      try {
        localStorage.setItem(HIDDEN_KEY, '1');
      } catch {
        // Private browsing: it shows again next time
      }
    }
    setOpen(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-labelledby="pocket-notice-title">
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative w-full max-w-sm rounded-3xl border border-forge-border bg-forge-panel p-5">
        <div className="flex items-center gap-3 mb-3">
          <Monitor className="w-7 h-7 shrink-0 text-cyan-300" />
          <h2 id="pocket-notice-title" className="text-base font-semibold">
            An early version for phones
          </h2>
        </div>
        <p className="text-sm text-forge-text mb-2">
          Fledgetone Pocket, the phone version, is in its early stages: some things are missing, and some may not work as they should yet.
        </p>
        <p className="text-sm text-forge-muted mb-4">
          The desktop experience is much better: open fledgetone.com on a computer for the full studio. Your songs open there as they are.
        </p>
        <label className="flex items-center gap-3 h-11 text-sm text-forge-muted mb-3">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} className="w-5 h-5 accent-cyan-500" />
          Don't show this again
        </label>
        <button type="button" autoFocus className={`${pill} w-full !border-cyan-400 text-cyan-200`} onClick={close}>
          Continue
        </button>
      </div>
    </div>
  );
};
