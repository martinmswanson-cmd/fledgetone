/**
 * Where the agent's studio side comes in: nothing until the musician opens the Suggestions panel
 * or "Let an agent connect…" (or a connection is open, or suggestions wait), then the agent code
 * (AgentStudio and all it uses) is loaded as a chunk of its own, so the app's first download
 * doesn't carry it (nor does the offline copy keep it ahead). Never in the phone apps, and never
 * in Pocket (only the studio mounts this).
 *
 * If that chunk can't be loaded (offline, or a newer version deployed meanwhile) or the agent's
 * side fails, the panel closes (its space goes back to the studio) and a note at the top says so,
 * with Reload (after saving the song: a browser remembers a failed download until the page loads
 * again, so trying again without reloading wouldn't help) and Close. The studio carries on.
 */
import React, { lazy, Suspense } from 'react';
import { useUiStore } from '../../store/uiStore';
import { flushAutosave } from '../../store/timelineStore';
import { isNativeApp } from '../../native/nativeApp';

const AgentStudio = lazy(() => import('./AgentStudio'));

class AgentBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('The Suggestions panel could not load:', error);
    useUiStore.setState({ agentPanelOpen: false, agentConnectOpen: false, agentLoadFailed: true });
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The note when the agent's side couldn't load: under the menu bar (clear of it and of the floating piano), above the studio, under dialogs and menus. */
const LoadFailed: React.FC = () => (
  <div
    role="alert"
    data-agent-ui=""
    data-agent-failed=""
    className="fixed top-20 left-1/2 -translate-x-1/2 z-[49] w-[min(92vw,26rem)] rounded-lg border border-amber-400/50 bg-forge-panel px-3 py-2 text-[12px] text-forge-text shadow-lg shadow-black/50 flex flex-wrap items-center gap-2"
  >
    <span className="flex-1 min-w-[12rem]">Couldn’t load the Suggestions panel (are you offline?). Reloading the page may help: your song is kept.</span>
    <button
      type="button"
      onClick={() => {
        flushAutosave();
        window.location.reload();
      }}
      className="h-7 px-2 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-cyan-100"
    >
      Reload
    </button>
    <button type="button" onClick={() => useUiStore.setState({ agentLoadFailed: false })} className="h-7 px-2 rounded-md border border-forge-border">
      Close
    </button>
  </div>
);

export const AgentMount: React.FC = () => {
  const wanted = useUiStore((s) => s.agentPanelOpen || s.agentConnectOpen || s.agentStatus.state !== 'off' || (s.agentStatus.waiting ?? 0) > 0);
  const failed = useUiStore((s) => s.agentLoadFailed);
  if (isNativeApp()) return null;
  if (failed) return <LoadFailed />;
  if (!wanted) return null;
  return (
    <AgentBoundary>
      <Suspense fallback={null}>
        <AgentStudio />
      </Suspense>
    </AgentBoundary>
  );
};
