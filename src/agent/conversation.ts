/**
 * The musician's side of the conversation with their agent: the messages they wrote on the
 * Suggestions panel, each with where its delivery is, and what they're writing now. A small store
 * of its own, in memory only: kept for the tab (a reload clears it), never saved with the song or
 * to disk, and nothing is sent until the musician presses Send (bridgeClient.ts sends it).
 *
 * Delivery: sending (handed to the helper), sent (the helper has it), seen (the agent fetched it:
 * wait_for_changes, get_messages, or a reply to it), not sent (no agent connected, the connection
 * went, or the helper didn't answer in time). A message not sent stays not sent until the musician
 * presses Retry: nothing goes later without them knowing.
 *
 * Each pairing is a connection of its own (`connection` counts them): a message belongs to the one
 * it was written in, and Retry stays within it. Once another pairing starts, the earlier messages
 * not sent can't be retried (they'd go to another agent, or one allowed less): the musician can
 * put one back in the box and send it as a new message. What goes with a message is decided at
 * each send and retry (outgoing): the selection only while the agent may see it, the suggestion
 * only while it's on the panel.
 */
import { create } from 'zustand';
import { CONVERSATION, hasVisibleText, readContext, type UserMessage, type UserMessageContext } from './protocol';

export type Delivery = 'sending' | 'sent' | 'seen' | 'not_sent';

/** One of the musician's own messages, with its delivery. */
export interface OwnMessage extends UserMessage {
  status: Delivery;
  /** Not sent: why, in plain words. */
  reason?: string;
  /** The connection it was written in (0: before any). */
  connection: number;
  /** Not sent, and its connection has ended: no Retry (put it back in the box instead). */
  ended?: boolean;
}

export interface ConversationState {
  mine: OwnMessage[];
  /** What's in the message box (kept while the panel is closed). */
  draft: string;
  /** The suggestion the next message asks about ("Ask about this"), if any. */
  about: string | null;
  /** "Include what I've selected", for the next message only. */
  include: boolean;
  /** The current connection's number (each pairing counts one more; 0 before any). */
  connection: number;
}

export const useConversation = create<ConversationState>(() => ({ mine: [], draft: '', about: null, include: false, connection: 0 }));

/** Why a message wasn't sent, in plain words. */
export const NOT_CONNECTED_REASON = 'the agent isn’t connected';
export const NO_ANSWER_REASON = 'the agent’s helper didn’t answer';
export const ENDED_REASON = 'that connection ended';
export const BEFORE_REASON = 'written before this connection';

/** A new message id: random, so a retry is told from a new message. */
export function newUserMessageId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return `u-${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)}`;
}

/** Where each delivery stands: one never goes back (a late answer from the helper still counts), except not sent, which only Retry moves. */
const RANK: Record<Delivery, number> = { not_sent: 0, sending: 1, sent: 2, seen: 3 };

/** `list` with the messages `ids` moved on to `to` (never back: seen stays seen). */
export function withDelivery(list: readonly OwnMessage[], ids: readonly string[], to: Delivery, reason?: string): OwnMessage[] {
  const which = new Set(ids);
  return list.map((m) => {
    if (!which.has(m.id) || m.ended) return m;
    if (to === 'not_sent') return m.status === 'sending' ? { ...m, status: to, reason: reason ?? NOT_CONNECTED_REASON } : m;
    if (RANK[to] <= RANK[m.status] && m.status !== 'not_sent') return m;
    const next: OwnMessage = { ...m, status: to };
    delete next.reason;
    return next;
  });
}

/** Move messages on (the helper's word, or a reply to them). */
export function setDelivery(ids: readonly string[], to: Delivery, reason?: string): void {
  useConversation.setState((st) => ({ mine: withDelivery(st.mine, ids, to, reason) }));
}

/** Every message still sending is not sent (the connection went). */
export function failSending(reason = NOT_CONNECTED_REASON): void {
  useConversation.setState((st) => ({ mine: withDelivery(st.mine, st.mine.filter((m) => m.status === 'sending').map((m) => m.id), 'not_sent', reason) }));
}

/**
 * A new pairing: the next connection. Messages not sent before it lose Retry (said so), and the
 * next message starts plain (no suggestion tied to it, no selection ticked).
 */
export function newConnection(): number {
  const n = useConversation.getState().connection + 1;
  useConversation.setState((st) => ({
    connection: n,
    about: null,
    include: false,
    mine: st.mine.map((m) => (m.connection < n && m.status !== 'sent' && m.status !== 'seen' && !m.ended ? { ...m, status: 'not_sent', ended: true, reason: m.connection > 0 ? ENDED_REASON : BEFORE_REASON } : m)),
  }));
  return n;
}

/**
 * What goes to the agent for message `m` now: its id, words and time; the suggestion it asks
 * about only if that's still on the panel; the selection only if the musician ticked it for this
 * message (it has a context) and the agent may see the selection right now.
 */
export function outgoing(m: UserMessage, now: { see: boolean; onPanel: (suggestionId: string) => boolean }): UserMessage {
  return {
    id: m.id,
    text: m.text,
    at: m.at,
    ...(m.suggestionId && now.onPanel(m.suggestionId) ? { suggestionId: m.suggestionId } : {}),
    ...(m.context && now.see ? { context: m.context } : {}),
  };
}

/** A message added to the conversation (the oldest go past CONVERSATION.keep). */
export function addOwn(m: OwnMessage): void {
  useConversation.setState((st) => ({ mine: [...st.mine, m].slice(-CONVERSATION.keep) }));
}

/** The selection as a message's context: the selected track, clips and the bars they cover, the clip open in the editor. Undefined when nothing is selected. */
export function selectionContext(s: { selectedTrackId: string | null; editingClipId: string | null; clips: readonly { id: string; isSelected: boolean; startBar: number; lengthBars: number }[] }): UserMessageContext | undefined {
  const picked = s.clips.filter((c) => c.isSelected);
  const from = picked.length ? Math.min(...picked.map((c) => c.startBar)) : 0;
  const to = picked.length ? Math.max(...picked.map((c) => c.startBar + c.lengthBars)) : 0;
  return readContext({
    selectedTrackId: s.selectedTrackId ?? undefined,
    selectedClipIds: picked.map((c) => c.id),
    editingClipId: s.editingClipId ?? undefined,
    ...(picked.length ? { bars: { fromBar: from, toBar: to } } : {}),
  });
}

/** What the musician's message carries along, in words (under it in the conversation). */
export function contextWords(m: Pick<UserMessage, 'context'>): string | null {
  const c = m.context;
  if (!c) return null;
  const parts: string[] = [];
  if (c.selectedClipIds?.length) parts.push(`${c.selectedClipIds.length} selected clip${c.selectedClipIds.length === 1 ? '' : 's'}`);
  else if (c.selectedTrackId) parts.push('the selected track');
  if (c.bars) {
    const a = Math.floor(c.bars.fromBar);
    const b = Math.max(a, Math.ceil(c.bars.toBar) - 1);
    parts.push(a === b ? `bar ${a}` : `bars ${a}-${b}`);
  }
  if (c.editingClipId && !c.selectedClipIds?.includes(c.editingClipId)) parts.push('the clip being edited');
  return parts.length ? `With your selection: ${parts.join(', ')}` : 'With your selection';
}

/** The box's words with `text` put back after them (a blank line between), for "Put back in the box": what the musician is writing is never lost. */
export function withPutBack(draft: string, text: string): string {
  const next = hasVisibleText(draft) ? `${draft.replace(/\s+$/, '')}\n\n${text}` : text;
  return next.slice(0, CONVERSATION.textMaxChars);
}
