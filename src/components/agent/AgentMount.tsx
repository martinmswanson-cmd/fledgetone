/**
 * Where the agent's studio side comes in: nothing until the musician opens the Suggestions panel
 * or "Let an agent connect…" (or a connection is open, or suggestions wait), then the agent code
 * (AgentStudio and all it uses) is loaded as a chunk of its own, so the app's first download
 * doesn't carry it (nor does the offline copy keep it ahead). Never in the phone apps, and never
 * in Pocket (only the studio mounts this).
 *
 * If that chunk can't be loaded (offline, or a newer version deployed meanwhile) or the agent's
 * side fails, a small note says so with Retry (then Reload, as a browser may remember a failed
 * download until the page loads again) and Close: the studio itself carries on.
 */
import React, { lazy, Suspense } from 'react';
import { useUiStore } from '../../store/uiStore';
import { flushAutosave } from '../../store/timelineStore';
import { isNativeApp } from '../../native/nativeApp';

/** A fresh lazy component for each try (a failed one stays failed). */
const loadStudio = () => lazy(() => import('./AgentStudio'));

class AgentBoundary extends React.Component<{ onRetry: () => void; tries: number; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('The Suggestions panel could not load:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const ui = useUiStore.getState();
    return (
      <div role="alert" data-agent-ui="" data-agent-failed="" className="fixed right-4 bottom-4 z-[45] max-w-sm rounded-lg border border-amber-400/50 bg-forge-panel px-3 py-2 text-[12px] text-forge-text shadow-lg shadow-black/50 flex flex-wrap items-center gap-2">
        <span className="flex-1 min-w-[12rem]">
          {this.props.tries === 0 ? 'Couldn’t load the Suggestions panel (are you offline?).' : 'Still couldn’t load the Suggestions panel. Reloading the page may help: your song is kept.'}
        </span>
        {this.props.tries === 0 ? (
          <button
            type="button"
            onClick={() => {
              this.setState({ failed: false });
              this.props.onRetry();
            }}
            className="h-7 px-2 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-cyan-100"
          >
            Retry
          </button>
        ) : (
          // (the browser may remember the failed download until the page loads again)
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
        )}
        <button
          type="button"
          onClick={() => {
            ui.setAgentPanelOpen(false);
            ui.setAgentConnectOpen(false);
            this.setState({ failed: false });
          }}
          className="h-7 px-2 rounded-md border border-forge-border"
        >
          Close
        </button>
      </div>
    );
  }
}

export const AgentMount: React.FC = () => {
  const wanted = useUiStore((s) => s.agentPanelOpen || s.agentConnectOpen || s.agentStatus.state !== 'off' || (s.agentStatus.waiting ?? 0) > 0);
  const [tries, setTries] = React.useState(0);
  // (a new one for each try: Retry loads the chunk again)
  const [AgentStudio, setStudio] = React.useState(loadStudio);
  const retry = () => {
    setTries((n) => n + 1);
    setStudio(loadStudio);
  };
  if (!wanted || isNativeApp()) return null;
  return (
    <AgentBoundary key={tries} tries={tries} onRetry={retry}>
      <Suspense fallback={null}>
        <AgentStudio />
      </Suspense>
    </AgentBoundary>
  );
};
