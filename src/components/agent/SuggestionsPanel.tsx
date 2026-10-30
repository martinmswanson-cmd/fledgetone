/**
 * The Suggestions panel, on the right of the studio: who's connected and what they may do (with
 * Change and Disconnect), the agent's suggestions in the order they came (a new one goes at the
 * end, so nothing on the panel moves under the pointer), each a card to hear, accept or dismiss
 * (SuggestionCard), the conversation with the agent (ConversationList: its messages and the
 * musician's own), and the message box at the foot (MessageBox: sent only when the musician presses
 * Send). Everything the agent wrote is shown as plain text, quoted and marked as from the agent. Only the musician opens it (an agent's suggestion counts
 * on the header's button instead); it takes focus when opened and gives it back when closed.
 * Full width on a narrow window, under dialogs, menus and toasts; Esc closes it. What changes is
 * said for screen readers in one live region (AgentStudio's).
 */
import React from 'react';
import { MessagesSquare, X } from 'lucide-react';
import { agentOpeners, useUiStore } from '../../store/uiStore';
import { announce, shortText, unreadCount, useSuggestions, type Suggestion } from '../../agent/suggestionsStore';
import { disconnectAgent } from '../../agent/bridgeClient';
import { watchSong } from '../../agent/songWatch';
import { SuggestionCard } from './SuggestionCard';
import { STATUS_WORDS } from './words';
import { stopAudition } from '../../audio/auditionPlayer';
import { noteCardPlaces, noteListScroll, noteOwnInput } from './cardGuard';
import { returnFocus } from './returnFocus';
import { ConversationList } from './ConversationList';
import { MessageBox } from './MessageBox';

/** "can read, suggest, listen": what the musician allowed, in words. */
function allowed(p: { see: boolean; suggest: boolean; listen: boolean }): string {
  const can = ['read', p.see && 'see what you select', p.suggest && 'suggest', p.listen && 'listen'].filter(Boolean) as string[];
  return `can ${can.length > 1 ? `${can.slice(0, -1).join(', ')} and ${can.at(-1)}` : can[0]}`;
}

/** What changed between two lists of suggestions, in words, for the live region (all at once). */
function statusNews(before: readonly Suggestion[], after: readonly Suggestion[]): string {
  const was = new Map(before.map((s) => [s.id, s.status]));
  return after
    .filter((s) => was.has(s.id) && was.get(s.id) !== s.status && s.status !== 'accepted' && s.status !== 'dismissed')
    .map((s) => `“${shortText(s.title, 60)}”: ${STATUS_WORDS[s.status]}.`)
    .join(' ');
}

export const SuggestionsPanel: React.FC = () => {
  const suggestions = useSuggestions((s) => s.suggestions);
  const messages = useSuggestions((s) => s.messages);
  const info = useSuggestions((s) => s.connection);
  const permissions = useSuggestions((s) => s.permissions);
  const unread = useSuggestions(unreadCount);
  const lastMessage = React.useRef<HTMLElement>(null);
  const ui = useUiStore.getState();
  const close = () => ui.setAgentPanelOpen(false);
  const panel = React.useRef<HTMLElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const connected = info.state === 'paired';
  const agent = info.agent;

  React.useEffect(() => {
    // Opened by the musician (an agent never opens it): focus comes here, and goes back when it closes
    panel.current?.focus({ preventScroll: true });
    // The suggestions are kept true to the song while they're on show
    const unwatch = watchSong();
    // While the panel is open, the agent panel's width is kept clear for floating panels (the piano)
    const wide = window.matchMedia('(min-width: 640px)');
    const setWidth = () => document.documentElement.style.setProperty('--agent-panel-w', wide.matches ? '380px' : '0px');
    setWidth();
    wide.addEventListener('change', setWidth);
    return () => {
      unwatch();
      wide.removeEventListener('change', setWidth);
      document.documentElement.style.removeProperty('--agent-panel-w');
      // Closing the panel stops a before-and-after that's playing, and takes its tint off the
      // timeline (the card under the pointer or focus is gone with it)
      stopAudition();
      useSuggestions.setState({ focusId: null });
      returnFocus(agentOpeners.panel);
    };
  }, []);

  // Where each card is, after every change of layout (a card that moved ignores presses for a moment)
  React.useLayoutEffect(() => noteCardPlaces(list.current));
  React.useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => noteCardPlaces(el));
    const watchCards = () => el.querySelectorAll('[data-suggestion]').forEach((c) => ro.observe(c));
    watchCards();
    const mo = new MutationObserver(watchCards);
    mo.observe(el, { childList: true, subtree: true });
    // A scroll the musician didn't make (anything but their wheel, touch, keys or a press) moves the cards
    const onScroll = () => noteListScroll(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // The agent's messages count as seen once the latest has been on screen
  const latest = messages.at(-1);
  React.useEffect(() => {
    const el = lastMessage.current;
    if (!el || !latest || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (seen) => {
        if (seen.some((x) => x.isIntersecting)) useSuggestions.setState((st) => (st.messagesSeenAt >= latest.at ? st : { messagesSeenAt: latest.at }));
      },
      { root: list.current, threshold: 0.5 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [latest]);
  const toMessages = () => {
    noteOwnInput();
    lastMessage.current?.scrollIntoView({ block: 'end' });
  };
  // After the musician sends: the list to its end, where their message is (their own doing, so the cards keep their time)
  const toEnd = () =>
    window.setTimeout(() => {
      noteOwnInput();
      const el = list.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);

  // Statuses that change (out of date, for another song, undone...) are said together
  React.useEffect(
    () =>
      useSuggestions.subscribe((s, prev) => {
        if (s.suggestions === prev.suggestions) return;
        const news = statusNews(prev.suggestions, s.suggestions);
        if (news) announce(news);
      }),
    []
  );

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-label="Suggestions"
      data-agent-panel=""
      onClick={(e) => {
        // After a pointer's press on a button, focus goes to the panel itself: Space then plays
        // the song as everywhere, rather than pressing that button again
        // (the message box and Retry keep it: focus goes back to the box)
        const t = e.target as Element;
        if (e.detail > 0 && t.closest('button') && !t.closest('[data-keep-focus]') && document.activeElement !== panel.current) panel.current?.focus({ preventScroll: true });
      }}
      onKeyDown={(e) => {
        // (Esc while an input method composes text is the method's)
        if (e.key === 'Escape' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
          e.stopPropagation();
          close();
        }
      }}
      className="fixed right-0 top-0 bottom-0 z-[45] w-full sm:w-[380px] bg-forge-panel border-l border-forge-border shadow-2xl shadow-black/60 flex flex-col outline-none"
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
              <span className="text-forge-text">Connected: your agent{agent ? ` (${agent})` : ''}</span> · {allowed(permissions)}
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

      {/* (the new-messages button floats over the list's foot, so it never moves the cards) */}
      <div className="relative flex-1 min-h-0">
        <div ref={list} onWheel={noteOwnInput} onTouchMove={noteOwnInput} onPointerDown={noteOwnInput} onKeyDown={noteOwnInput} className="h-full overflow-y-auto p-3 pb-12 flex flex-col gap-3">
          {suggestions.length === 0 ? (
            <p className="text-[12px] text-forge-muted">
              {connected ? 'No suggestions yet. Ask your agent for one: it appears here for you to hear before and after, then accept or dismiss.' : 'Suggestions from an agent you connect appear here. Nothing changes in your song until you accept one.'}
            </p>
          ) : (
            suggestions.map((s) => <SuggestionCard key={s.id} suggestion={s} />)
          )}
          <ConversationList agent={agent} lastAgentRef={lastMessage} />
        </div>
        {unread > 0 && (
          <button
            type="button"
            onClick={toMessages}
            data-agent-unread=""
            className="absolute bottom-2 left-1/2 -translate-x-1/2 h-7 px-3 rounded-full border border-cyan-500/50 bg-forge-panel text-[12px] text-cyan-100 shadow-lg shadow-black/50 hover:bg-cyan-500/20"
          >
            Jump to {unread} new message{unread === 1 ? '' : 's'} from your agent
          </button>
        )}
      </div>
      <MessageBox onSent={toEnd} />
    </aside>
  );
};
