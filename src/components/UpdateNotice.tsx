/**
 * "Version 2026.10.xx is ready: Reload": a bar across the top of the page once a new version of
 * the app has downloaded in the background (pwa.ts). It's fixed to the top over everything, and
 * keeps its own height of room in the page, so it's the first thing seen and the page sits below
 * it (in the corner it was easy to miss). It waits while the song plays or an export
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
  const bar = 'flex flex-col items-center gap-1 px-3 pb-1.5 pt-[max(6px,env(safe-area-inset-top))] text-xs';
  const row = (
    <div className="flex flex-wrap items-center justify-center gap-2">
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
  );
  return (
    <>
      {/* Its room in the page, so everything sits below it: the same words, unseen, so it's as
          tall as the bar however they wrap */}
      <div className={`pk-update invisible shrink-0 border-b border-transparent ${bar}`} aria-hidden inert>
        {row}
        {problem && <p>{problem}</p>}
      </div>
      {/* The bar itself, fixed to the top over everything (a dialog, Pocket's start screen): a
          new version is never hidden under what happens to be open */}
      <div role="status" data-testid="update-notice" className={`fixed inset-x-0 top-0 z-[90] border-b border-cyan-400/50 bg-[#10262d] text-forge-text shadow-md shadow-black/40 ${bar}`}>
        {row}
        {problem && <p className="text-amber-200">{problem}</p>}
      </div>
    </>
  );
};
