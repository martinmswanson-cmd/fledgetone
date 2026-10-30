/**
 * The agent's side of the studio, loaded on demand (see AgentMount): the Suggestions panel, the
 * Let an agent connect dialog, the timeline highlight and the live region that says what changes. In the dev server it also offers a few
 * hooks to the browser checks (scripts/agent-check/e2e.cjs, e2e2.cjs and e2e3.cjs).
 */
import React from 'react';
import { useUiStore } from '../../store/uiStore';
import { SuggestionsPanel } from './SuggestionsPanel';
import { ConnectDialog } from './ConnectDialog';
import { TimelineHighlight } from './TimelineHighlight';
import { unreadCount, useSuggestions, waitingCount } from '../../agent/suggestionsStore';
import { watchSong } from '../../agent/songWatch';
import { useTimelineStore } from '../../store/timelineStore';
import { stopAudition } from '../../audio/auditionPlayer';

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // For the browser checks only: what they need to compare, never in a production build
  void Promise.all([
    import('../../agent/suggestionsStore'),
    import('../../audio/auditionPlayer'),
    import('../../audio/listen'),
    import('../../agent/ops'),
    import('../../agent/handlers'),
    import('../../store/timelineStore'),
    import('../../agent/songWatch'),
    import('../../agent/listenSnapshot'),
    import('../../agent/conversation'),
    import('../../audio/exclusivePreview'),
    import('../../agent/whereHeard'),
  ]).then(([sg, audition, listen, ops, handlers, tl, watch, snap, conv, preview, where]) => {
    (window as unknown as Record<string, unknown>).__fledgetoneAgent = { sg, audition, listen, ops, handlers, tl, watch, snap, conv, preview, where };
  });
}

const AgentStudio: React.FC = () => {
  const panel = useUiStore((s) => s.agentPanelOpen);
  const connect = useUiStore((s) => s.agentConnectOpen);
  // (the browser checks make it fail on purpose, to see the studio stay up; never in a production build)
  if (import.meta.env.DEV && (window as unknown as { __agentCrash?: boolean }).__agentCrash) throw new Error('A failure for the browser checks');
  const announcement = useSuggestions((s) => s.announcement);
  // Suggestions waiting are kept true to the song (another song opened, an edit under them), connected or not
  const anyWaiting = useSuggestions((s) => waitingCount(s.suggestions) > 0);
  React.useEffect(() => (anyWaiting ? watchSong() : undefined), [anyWaiting]);
  // How many suggestions wait, for the header's button (the panel isn't opened for them)
  React.useEffect(() => {
    const count = () => {
      const sg = useSuggestions.getState();
      const waiting = waitingCount(sg.suggestions);
      const unread = unreadCount(sg);
      const st = useUiStore.getState().agentStatus;
      if ((st.waiting ?? 0) !== waiting || (st.unread ?? 0) !== unread) useUiStore.setState({ agentStatus: { ...st, waiting, unread } });
    };
    count();
    const unsubS = useSuggestions.subscribe(count);
    const unsubU = useUiStore.subscribe((u, prev) => u.agentStatus !== prev.agentStatus && count());
    return () => {
      unsubS();
      unsubU();
    };
  }, []);
  // The song's own playback and a before-and-after never play at once: Play stops the latter
  React.useEffect(() => useTimelineStore.subscribe((st, prev) => st.isPlaying && !prev.isPlaying && stopAudition()), []);
  return (
    <>
      {panel && <SuggestionsPanel />}
      {connect && <ConnectDialog />}
      <TimelineHighlight />
      {/* What changes, said for screen readers: one polite live region for all the agent's side */}
      <p role="status" aria-live="polite" className="sr-only" data-agent-live="">
        {announcement}
      </p>
    </>
  );
};

export default AgentStudio;
