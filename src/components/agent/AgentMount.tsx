/**
 * Where the agent's studio side comes in: nothing until the musician opens the Suggestions panel
 * or "Let an agent connect…" (or a connection is open, or suggestions wait), then the agent code (AgentStudio and all
 * it uses) is loaded as a chunk of its own, so the app's first download doesn't carry it. Never in
 * the phone apps, and never in Pocket (only the studio mounts this).
 */
import React, { lazy, Suspense } from 'react';
import { useUiStore } from '../../store/uiStore';
import { isNativeApp } from '../../native/nativeApp';

const AgentStudio = lazy(() => import('./AgentStudio'));

export const AgentMount: React.FC = () => {
  const wanted = useUiStore((s) => s.agentPanelOpen || s.agentConnectOpen || s.agentStatus.state !== 'off' || (s.agentStatus.waiting ?? 0) > 0);
  if (!wanted || isNativeApp()) return null;
  return (
    <Suspense fallback={null}>
      <AgentStudio />
    </Suspense>
  );
};
