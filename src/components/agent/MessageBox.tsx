/**
 * The message box at the foot of the Suggestions panel: what the musician writes to their agent
 * (plain text, at most CONVERSATION.textMaxChars), sent only when they press Send or Enter
 * (Shift+Enter starts a new line), never by itself. "Ask about this" on a card ties the next
 * message to that suggestion (shown above the box, with a way to untie it); "Include what I've
 * selected" sends the selection along with the next message only, and only while the agent may
 * see the selection. Keys typed in the box stay in it (Space, letters, Delete, Ctrl+Z: none reaches
 * the studio's shortcuts); Esc still closes the panel, and what was typed is kept for when it opens
 * again. The agent never moves the focus here.
 */
import React from 'react';
import { Send, X } from 'lucide-react';
import { CONVERSATION } from '../../agent/protocol';
import { useConversation } from '../../agent/conversation';
import { announce, shortText, useSuggestions } from '../../agent/suggestionsStore';
import { sendToAgent } from '../../agent/bridgeClient';
import { deliveryWords } from './words';

export const MessageBox: React.FC<{ onSent?: () => void }> = ({ onSent }) => {
  const draft = useConversation((s) => s.draft);
  const about = useConversation((s) => s.about);
  const include = useConversation((s) => s.include);
  const see = useSuggestions((s) => s.permissions.see);
  const connected = useSuggestions((s) => s.connection.state === 'paired');
  const aboutTitle = useSuggestions((s) => (about ? s.suggestions.find((x) => x.id === about)?.title : undefined));
  const box = React.useRef<HTMLTextAreaElement>(null);
  const empty = !draft.trim();
  const left = CONVERSATION.textMaxChars - draft.length;

  const send = () => {
    if (empty) return;
    const m = sendToAgent(draft, { about: aboutTitle ? about : null, include: include && see });
    if (!m) return;
    useConversation.setState({ draft: '', about: null, include: false });
    const now = useConversation.getState().mine.find((x) => x.id === m.id);
    announce(now?.status === 'not_sent' ? `${deliveryWords(now)}. Retry is next to your message.` : 'Sent to your agent.', true);
    onSent?.();
    box.current?.focus({ preventScroll: true });
  };

  // (a key typed here is the box's: the studio's shortcuts never see it; Esc goes on to close the panel)
  const keep = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') e.stopPropagation();
  };

  return (
    <form
      data-agent-compose=""
      data-keep-focus=""
      aria-label="Message your agent"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="shrink-0 border-t border-forge-border px-3 py-2 flex flex-col gap-1.5"
    >
      {about && (
        <p className="flex items-center gap-1.5 text-[11px] text-forge-muted min-w-0" data-asking-about={about}>
          <span className="flex-1 min-w-0 truncate">
            Asking about {aboutTitle ? `“${shortText(aboutTitle, 60)}”` : 'a suggestion no longer on the panel'}
          </span>
          <button
            type="button"
            onClick={() => {
              useConversation.setState({ about: null });
              box.current?.focus({ preventScroll: true });
            }}
            className="p-1 rounded text-forge-muted hover:text-forge-text"
            aria-label="Don’t ask about that suggestion"
            title="Don’t ask about that suggestion"
          >
            <X className="w-3 h-3" aria-hidden />
          </button>
        </p>
      )}
      <textarea
        ref={box}
        value={draft}
        maxLength={CONVERSATION.textMaxChars}
        rows={2}
        placeholder="Message your agent…"
        aria-label="Message your agent"
        aria-describedby="agent-compose-hint"
        onChange={(e) => useConversation.setState({ draft: e.target.value.slice(0, CONVERSATION.textMaxChars) })}
        onKeyDown={(e) => {
          keep(e);
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        onKeyUp={keep}
        className="w-full resize-none max-h-32 min-h-[2.75rem] rounded-md border border-forge-border bg-forge-bg px-2 py-1.5 text-[12px] text-forge-text placeholder:text-forge-muted focus:outline-none focus:border-cyan-500/70"
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <label className={`flex items-center gap-1.5 text-[11px] ${see ? 'text-forge-text' : 'text-forge-muted'}`} title={see ? undefined : 'Allow “See what I select” (Change, above) to include it'}>
          <input
            type="checkbox"
            checked={include && see}
            disabled={!see}
            onChange={(e) => useConversation.setState({ include: e.target.checked })}
            aria-describedby={see ? undefined : 'agent-compose-see'}
            className="accent-cyan-500"
          />
          Include what I’ve selected
        </label>
        {!see && (
          <span id="agent-compose-see" className="text-[10px] text-forge-muted">
            (needs “See what I select”)
          </span>
        )}
        <span className="flex-1" />
        {left < 200 && (
          <span className={`text-[10px] ${left < 20 ? 'text-amber-300' : 'text-forge-muted'}`} aria-live="off">
            {left} left
          </span>
        )}
        <button type="submit" disabled={empty} className="ml-auto h-7 px-3 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-500/25 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
          <Send className="w-3.5 h-3.5" aria-hidden /> Send
        </button>
      </div>
      <p id="agent-compose-hint" className="text-[10px] text-forge-muted">
        {connected ? 'Enter sends, Shift+Enter starts a new line.' : 'No agent connected: messages can’t be sent now.'} Only what you send goes to your agent; nothing is saved.
      </p>
    </form>
  );
};
