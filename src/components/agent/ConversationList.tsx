/**
 * The conversation on the Suggestions panel, both sides in the order they were written: the
 * agent's messages (marked "From your agent", its words quoted, plain text; a reply shows which
 * of the musician's messages it answers) and the musician's own (marked "You", set to the right
 * in another colour, with the suggestion it asks about, what of the selection went with it, and
 * where it is: sending, sent, seen by the agent, or not sent with Retry). Each pairing is a
 * connection of its own: an agent's message keeps the name it came with, and earlier connections
 * are set off by a line ("Earlier, with your agent (name)"); a message not sent in one of them has
 * no Retry, only "Put back in the box" to send it again as a new message. Nothing here takes the
 * focus when a message comes; what the agent writes is said in the panel's live region (throttled).
 */
import React from 'react';
import { RotateCw } from 'lucide-react';
import { useSuggestions, shortText, announce, type AgentMessage } from '../../agent/suggestionsStore';
import { contextWords, putBack, useConversation, type OwnMessage } from '../../agent/conversation';
import { retryMessage } from '../../agent/bridgeClient';
import { deliveryWords, fromYourAgent } from './words';

type Entry = { kind: 'agent'; m: AgentMessage } | { kind: 'mine'; m: OwnMessage };

/** The message box, for focus after a press that moves it (Retry). */
const focusBox = (toEnd = false) =>
  window.setTimeout(() => {
    const box = document.querySelector<HTMLTextAreaElement>('[data-agent-compose] textarea');
    box?.focus({ preventScroll: true });
    if (box && toEnd) box.setSelectionRange(box.value.length, box.value.length);
  }, 0);

export const ConversationList: React.FC<{ agent?: string; lastAgentRef: React.RefObject<HTMLElement | null> }> = ({ agent, lastAgentRef }) => {
  const messages = useSuggestions((s) => s.messages);
  const suggestions = useSuggestions((s) => s.suggestions);
  const mine = useConversation((s) => s.mine);
  const current = useConversation((s) => s.connection);
  const connected = useSuggestions((s) => s.connection.state === 'paired');
  const latest = messages.at(-1);

  // A message the connection dropped (or the helper never took) is said, once
  React.useEffect(
    () =>
      useConversation.subscribe((s, prev) => {
        const was = new Map(prev.mine.map((m) => [m.id, m.status]));
        const lost = s.mine.filter((m) => m.status === 'not_sent' && was.get(m.id) === 'sending');
        if (lost.length) announce(`Your message wasn’t sent: ${lost[0].reason ?? 'the agent isn’t connected'}. Retry is next to it.`);
      }),
    []
  );

  const entries: Entry[] = [...messages.map((m) => ({ kind: 'agent' as const, m })), ...mine.map((m) => ({ kind: 'mine' as const, m }))].sort((a, b) => a.m.at - b.m.at);
  if (!entries.length) return null;
  const titleOf = (id?: string) => (id ? suggestions.find((s) => s.id === id)?.title : undefined);
  const connOf = (e: Entry) => e.m.connection ?? 0;
  // The agent's name in each connection, as its messages came
  const names = new Map<number, string>();
  for (const m of messages) if (m.agent && m.connection !== undefined) names.set(m.connection, m.agent);
  const several = entries.some((e) => connOf(e) !== current);
  const divider = (conn: number) => {
    if (conn === current && connected) return `This connection: ${fromYourAgent(names.get(conn) ?? agent).replace(/^From y/, 'y')}`;
    if (conn === 0) return 'Before connecting';
    return `Earlier, with ${fromYourAgent(names.get(conn)).replace(/^From y/, 'y')}`;
  };

  return (
    <section aria-label="Conversation with your agent" data-agent-conversation="" className="flex flex-col gap-1.5">
      {entries.map((e, i) => {
        const conn = connOf(e);
        const line =
          several && (i === 0 || connOf(entries[i - 1]) !== conn) ? (
            <p key={`line-${e.m.id}`} role="separator" data-connection-line={conn} className="mt-1 flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-forge-muted before:h-px before:flex-1 before:bg-forge-border after:h-px after:flex-1 after:bg-forge-border">
              {divider(conn)}
            </p>
          ) : null;
        return (
          <React.Fragment key={e.m.id}>
            {line}
            {entry(e)}
          </React.Fragment>
        );
      })}
    </section>
  );

  function entry(e: Entry) {
    if (e.kind === 'agent') {
      const m = e.m;
      const answers = m.replyTo ? mine.find((x) => x.id === m.replyTo) : undefined;
      return (
        <figure
          ref={m === latest ? (lastAgentRef as React.RefObject<HTMLElement>) : undefined}
          data-agent-message={m.id}
          {...(m.replyTo ? { 'data-reply-to': m.replyTo } : {})}
          className="mr-6 rounded-md bg-forge-bg/60 border border-forge-border/60 border-l-2 border-l-cyan-500/60 px-2.5 py-1.5"
        >
          <figcaption className="text-[10px] font-mono uppercase tracking-wider text-forge-muted">{fromYourAgent(m.connection === undefined ? agent : m.agent)}</figcaption>
          {answers && <p className="mt-0.5 text-[11px] text-forge-muted border-l border-forge-border pl-1.5 break-words">Replying to you: “{shortText(answers.text, 60)}”</p>}
          <blockquote className="mt-0.5 text-[12px] text-forge-text whitespace-pre-wrap break-words">{m.text}</blockquote>
        </figure>
      );
    }
    const m = e.m;
    const about = titleOf(m.suggestionId);
    const context = contextWords(m);
    return (
      <figure data-own-message={m.id} data-delivery={m.status} className="ml-6 rounded-md bg-violet-500/10 border border-violet-400/30 border-r-2 border-r-violet-400/70 px-2.5 py-1.5">
        <figcaption className="text-[10px] font-mono uppercase tracking-wider text-violet-200/80 text-right">You</figcaption>
        {m.suggestionId && <p className="mt-0.5 text-[11px] text-forge-muted break-words">About the suggestion {about ? `“${shortText(about, 50)}”` : 'no longer on the panel'}</p>}
        <p className="mt-0.5 text-[12px] text-forge-text whitespace-pre-wrap break-words">{m.text}</p>
        {context && <p className="mt-0.5 text-[11px] text-forge-muted">{context}</p>}
        <p className={`mt-0.5 flex flex-wrap items-center justify-end gap-2 text-[11px] ${m.status === 'not_sent' ? 'text-amber-300' : 'text-forge-muted'}`}>
          <span data-delivery-words="">{deliveryWords(m)}</span>
          {m.status === 'not_sent' && (m.ended || m.connection !== current) && (
            <button
              type="button"
              data-keep-focus=""
              data-put-back={m.id}
              onClick={() => {
                // (nothing is sent: it's in the box, after what they're writing, for them to send as a new message, or not)
                if (!putBack(m.text)) announce('That doesn’t fit in the box: send or shorten what’s there first.', true);
                focusBox(true);
              }}
              className="h-6 px-2 rounded-md border border-forge-border text-forge-text hover:border-cyan-500/60"
              aria-label={`Put back in the box: “${shortText(m.text, 40)}”`}
            >
              Put back in the box
            </button>
          )}
          {m.status === 'not_sent' && !m.ended && m.connection === current && (
            <button
              type="button"
              data-keep-focus=""
              data-retry={m.id}
              onClick={() => {
                retryMessage(m.id);
                focusBox();
              }}
              className="h-6 px-2 rounded-md border border-amber-400/50 text-amber-100 hover:bg-amber-400/10 flex items-center gap-1"
              aria-label={`Retry sending “${shortText(m.text, 40)}”`}
            >
              <RotateCw className="w-3 h-3" aria-hidden /> Retry
            </button>
          )}
        </p>
      </figure>
    );
  }
};
