/**
 * The agent's side of the studio, loaded on demand (see AgentMount): the Suggestions panel, the
 * Let an agent connect dialog and the timeline highlight. In the dev server it also offers a few
 * hooks to the browser checks (scripts/agent-check/e2e.cjs).
 */
import React from 'react';
import { useUiStore } from '../../store/uiStore';
import { SuggestionsPanel } from './SuggestionsPanel';
import { ConnectDialog } from './ConnectDialog';
import { TimelineHighlight } from './TimelineHighlight';
import { trackSong } from '../../agent/bridgeClient';
import { useTimelineStore } from '../../store/timelineStore';
import { stopAudition } from '../../audio/auditionPlayer';

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // For the browser checks only: what they need to compare, never in a production build
  void Promise.all([import('../../agent/suggestionsStore'), import('../../audio/auditionPlayer'), import('../../audio/listen'), import('../../agent/ops'), import('../../agent/handlers'), import('../../store/timelineStore')]).then(
    ([sg, audition, listen, ops, handlers, tl]) => {
      (window as unknown as Record<string, unknown>).__fledgetoneAgent = { sg, audition, listen, ops, handlers, tl };
    }
  );
}

const AgentStudio: React.FC = () => {
  const panel = useUiStore((s) => s.agentPanelOpen);
  const connect = useUiStore((s) => s.agentConnectOpen);
  React.useEffect(() => trackSong(), []);
  // The song's own playback and a before-and-after never play at once: Play stops the latter
  React.useEffect(() => useTimelineStore.subscribe((st, prev) => st.isPlaying && !prev.isPlaying && stopAudition()), []);
  return (
    <>
      {panel && <SuggestionsPanel />}
      {connect && <ConnectDialog />}
      <TimelineHighlight />
    </>
  );
};

export default AgentStudio;
