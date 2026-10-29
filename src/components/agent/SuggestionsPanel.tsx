/**
 * The Suggestions panel, on the right of the studio: who's connected and what they may do (with
 * Change and Disconnect), the agent's messages, and its suggestions, newest first, each a card
 * to hear, accept or dismiss (SuggestionCard). Everything the agent wrote is shown as plain text.
 * Full width on a narrow window; Esc closes it.
 */
import React from 'react';
import { MessagesSquare, X } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';
import { useSuggestions } from '../../agent/suggestionsStore';
import { disconnectAgent } from '../../agent/bridgeClient';
import { SuggestionCard } from './SuggestionCard';
import { stopAudition } from '../../audio/auditionPlayer';

/** "can read, suggest, listen": what the musician allowed, in words. */
function allowed(p: { see: boolean; suggest: boolean; listen: boolean }): string {
  const can = ['read', p.see && 'see what you select', p.suggest && 'suggest', p.listen && 'listen'].filter(Boolean) as string[];
  return `can ${can.length > 1 ? `${can.slice(0, -1).join(', ')} and ${can.at(-1)}` : can[0]}`;
}

export const SuggestionsPanel: React.FC = () => {
  const suggestions = useSuggestions((s) => s.suggestions);
  const messages = useSuggestions((s) => s.messages);
  const info = useSuggestions((s) => s.connection);
  const permissions = useSuggestions((s) => s.permissions);
  const ui = useUiStore.getState();
  const close = () => ui.setAgentPanelOpen(false);
  const panel = React.useRef<HTMLElement>(null);
  const connected = info.state === 'paired';

  React.useEffect(() => {
    panel.current?.focus();
    // Closing the panel stops a before-and-after that's playing
    return () => stopAudition();
  }, []);

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-label="Suggestions"
      data-agent-panel=""
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
      className="fixed right-0 top-0 bottom-0 z-[70] w-full sm:w-[380px] bg-forge-panel border-l border-forge-border shadow-2xl shadow-black/60 flex flex-col outline-none"
    >
      <header className="flex items-center gap-2 px-3 py-2 border-b border-forge-border">
        <MessagesSquare className="w-4 h-4 text-cyan-400" aria-hidden />
        <h2 className="flex-1 text-sm font-semibold text-forge-text">Suggestions</h2>
        <button type="button" onClick={close} className="p-1.5 rounded-md text-forge-muted hover:text-forge-text" aria-label="Close the Suggestions panel" title="Close (Esc)">
          <X className="w-4 h-4" />
        </button>
      </header>

      <section aria-label="Connection" className="px-3 py-2 border-b border-forge-border text-[12px] text-forge-muted flex flex-wrap items-center gap-2">
        {connected ? (
          <>
            <span className="flex-1 min-w-0">
              <span className="text-forge-text">Connected: {info.agent ?? 'your agent'}</span> · {allowed(permissions)}
            </span>
            <button type="button" onClick={() => ui.setAgentConnectOpen(true)} className="h-7 px-2 rounded-md border border-forge-border text-forge-text hover:border-cyan-500/60">
              Change
            </button>
            <button type="button" onClick={() => disconnectAgent()} className="h-7 px-2 rounded-md border border-forge-border text-forge-text hover:border-red-400/60">
              Disconnect
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 min-w-0">{info.state === 'waiting' || info.state === 'proving' ? 'Connecting…' : 'No agent connected.'}</span>
            <button type="button" onClick={() => ui.setAgentConnectOpen(true)} className="h-7 px-2 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-cyan-100">
              Let an agent connect…
            </button>
          </>
        )}
      </section>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {messages.length > 0 && (
          <section aria-label="Messages from the agent" className="flex flex-col gap-1.5">
            {messages.slice(-20).map((m) => (
              <p key={m.id} className="rounded-md bg-forge-bg/60 border border-forge-border/60 px-2.5 py-1.5 text-[12px] text-forge-text whitespace-pre-wrap break-words">
                {m.text}
              </p>
            ))}
          </section>
        )}
        {suggestions.length === 0 ? (
          <p className="text-[12px] text-forge-muted">
            {connected ? 'No suggestions yet. Ask your agent for one: it appears here for you to hear before and after, then accept or dismiss.' : 'Suggestions from an agent you connect appear here. Nothing changes in your song until you accept one.'}
          </p>
        ) : (
          suggestions.map((s) => <SuggestionCard key={s.id} suggestion={s} />)
        )}
      </div>
    </aside>
  );
};
