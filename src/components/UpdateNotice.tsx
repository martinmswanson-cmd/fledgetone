/**
 * "Version 2026.10.xx is ready: Reload": a small notice in the corner once a new version of the
 * app has downloaded in the background (pwa.ts). It waits while the song plays or an export
 * renders, and the app never reloads by itself: Reload writes the autosave first, and What's new
 * opens after it. Later hides the notice until the next time the app opens.
 */
import React, { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { reloadToUpdate, usePwa } from '../pwa/pwa';
import { useTimelineStore } from '../store/timelineStore';
import { useRenderBusy } from '../audio/renderBusy';
import { APP_VERSION } from '../version';

export const UpdateNotice: React.FC = () => {
  const ready = usePwa((s) => s.updateReady);
  const version = usePwa((s) => s.updateVersion);
  const playing = useTimelineStore((s) => s.isPlaying);
  const rendering = useRenderBusy((s) => s.running > 0);
  const busy = playing || rendering;
  const [hidden, setHidden] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!ready || hidden || busy) return null;
  // (Two builds of one version number: just "a new version")
  const named = version && version !== APP_VERSION ? `Version ${version} is ready` : 'A new version is ready';
  return (
    <div
      role="status"
      data-testid="update-notice"
      className="fixed bottom-4 right-4 z-[90] flex max-w-sm flex-col gap-1 rounded-lg border border-cyan-400/50 bg-forge-panel px-3 py-2 text-xs text-forge-text shadow-lg shadow-black/50"
    >
      <div className="flex items-center gap-2">
        <RefreshCw className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
        <span>{named}</span>
        <button
          type="button"
          onClick={() => setProblem(reloadToUpdate() ?? null)}
          title="Reload into the new version. Your work is saved first and opens again after it."
          className="rounded border border-cyan-400/60 bg-cyan-500/15 px-2 py-0.5 font-mono font-bold text-cyan-100 hover:bg-cyan-500/25"
        >
          Reload
        </button>
        <button type="button" onClick={() => setHidden(true)} title="Later (the new version opens next time)" aria-label="Later" className="text-forge-muted hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {problem && <p className="text-amber-200">{problem}</p>}
    </div>
  );
};
