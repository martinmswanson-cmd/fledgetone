/**
 * Whether the browser keeps Fledgetone's storage (the autosave, your sounds, the kept recordings)
 * when the disk runs low, and how much it holds, under Inspector › Master › Instruments offline.
 * Protect asks the browser (pwa.ts); browsers decide by themselves, more readily for an installed app.
 */
import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { checkPersistence, storageUse, usePwa } from '../../pwa/pwa';

const size = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`);

export const StorageStatus: React.FC<{ refreshKey?: unknown }> = ({ refreshKey }) => {
  const persisted = usePwa((s) => s.persisted);
  const [use, setUse] = useState<{ usage: number; quota: number } | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    void checkPersistence();
    void storageUse().then(setUse);
  }, [refreshKey]);
  if (persisted === null && !use) return null;
  return (
    <div className="flex flex-col gap-1 pt-1 border-t border-forge-border/60 text-[10px]" data-testid="storage-status">
      {persisted !== null && (
        <div className="flex items-center justify-between gap-2">
          <span className={`flex items-center gap-1 ${persisted ? 'text-emerald-300' : 'text-amber-200'}`}>
            {persisted ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
            {persisted ? 'Storage: protected' : 'Storage: may be cleared by the browser if the disk gets full'}
          </span>
          {!persisted && (
            <button
              type="button"
              onClick={() => {
                setAsked(true);
                void checkPersistence(true);
              }}
              title="Ask the browser to keep your autosave, sounds and recordings even when space runs low"
              className="shrink-0 px-2 py-0.5 rounded border border-forge-border font-mono text-forge-muted hover:text-white"
            >
              Protect
            </button>
          )}
        </div>
      )}
      {asked && !persisted && <p className="text-forge-muted">The browser said no for now. Installing Fledgetone as an app (Help › Install Fledgetone) usually lets it keep your work; save songs to files too.</p>}
      {use && use.usage > 0 && (
        <p className="text-forge-muted">
          Fledgetone uses {size(use.usage)} in this browser{use.quota ? ` (of about ${size(use.quota)} it may use)` : ''}.
        </p>
      )}
    </div>
  );
};
