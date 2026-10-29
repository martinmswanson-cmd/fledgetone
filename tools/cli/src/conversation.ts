/**
 * The conversation between the musician and their agent, as the helper keeps it: the musician's
 * messages (the studio's `user_message` events, sent only when they press Send) and the agent's
 * (say), in the order they came, in memory only (the last CONVERSATION.keep, cleared when the
 * studio disconnects; never written anywhere). The agent reads it with get_messages, a page at a
 * time; the musician's messages also come through wait_for_changes.
 *
 * The studio is told when the helper has a message (`received`) and when the agent has read it
 * (`seen`: it came back from wait_for_changes or get_messages, or the agent replied to it), so the
 * musician sees where each one is. A message sent again (Retry) with the same id is kept once.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CONVERSATION, fromAgent, LIMITS, readUserMessage, USER_MESSAGE_STATUS, type UserMessageContext, type UserMessageStatusParams } from '../../../src/agent/protocol';
import { DROP, type BridgeServer, type StudioEventRecord } from './bridgeServer';

/** One message, either way, as get_messages gives it. */
export interface ConversationEntry {
  /** Its place in the conversation (pass the last one back as `since`). */
  seq: number;
  id: string;
  from: 'musician' | 'agent';
  text: string;
  at: string;
  /** The musician's: the suggestion they asked about. */
  suggestionId?: string;
  /** The musician's: what they chose to include of their selection. */
  context?: UserMessageContext;
  /** The agent's: the musician's message it answers. */
  replyTo?: string;
  /** The agent's: the suggestion it's about. */
  about?: string;
}

/** What the agent is told about working with the musician (added to the server's instructions). */
export const CONVERSATION_INSTRUCTIONS = `The musician can write to you from their Suggestions panel. Their messages come through wait_for_changes (event "user_message") and get_messages reads the whole conversation. Answer with say, passing replyTo (their message's id). Work alongside them, not for them: answer their questions, ask before suggesting big changes, and keep each suggestion small.`;

export class Conversation {
  private entries: ConversationEntry[] = [];
  private seq = 0;
  private readonly seen = new Set<string>();
  private readonly bridge: BridgeServer;

  constructor(bridge: BridgeServer) {
    this.bridge = bridge;
    bridge.eventFilter = (event, params) => (event === 'user_message' ? this.fromStudio(params) : params);
    bridge.subscribe((e) => {
      // Privacy first: nothing of it outlives the connection
      if (e.event === 'disconnected') this.clear();
    });
  }

  private tell(ids: string[], status: UserMessageStatusParams['status']) {
    if (ids.length) this.bridge.notify(USER_MESSAGE_STATUS, { ids, status } satisfies UserMessageStatusParams);
  }

  private push(e: Omit<ConversationEntry, 'seq'>) {
    this.entries.push({ seq: ++this.seq, ...e });
    // (kept each way: the oldest of the side over its cap goes first)
    for (const side of ['musician', 'agent'] as const) {
      const mine = this.entries.filter((x) => x.from === side);
      if (mine.length > CONVERSATION.keep) {
        const gone = new Set(mine.slice(0, mine.length - CONVERSATION.keep));
        this.entries = this.entries.filter((x) => !gone.has(x));
      }
    }
  }

  /** A user_message from the studio: kept (made plain) and acknowledged; one already kept (a retry) is acknowledged again, not kept twice. */
  private fromStudio(params: unknown): unknown {
    const m = readUserMessage(params);
    if (!m) return DROP;
    if (this.entries.some((x) => x.from === 'musician' && x.id === m.id)) {
      this.tell([m.id], this.seen.has(m.id) ? 'seen' : 'received');
      return DROP;
    }
    this.push({ id: m.id, from: 'musician', text: m.text, at: new Date(m.at).toISOString(), ...(m.suggestionId ? { suggestionId: m.suggestionId } : {}), ...(m.context ? { context: m.context } : {}) });
    this.tell([m.id], 'received');
    return m;
  }

  /** The agent said something (the studio showed it). */
  addAgent(id: string, text: string, opts: { replyTo?: string; about?: string } = {}): void {
    this.push({ id, from: 'agent', text: fromAgent(text, LIMITS.sayMaxChars), at: new Date().toISOString(), ...(opts.replyTo ? { replyTo: opts.replyTo } : {}), ...(opts.about ? { about: opts.about } : {}) });
    if (opts.replyTo) this.markSeen([opts.replyTo]);
  }

  /** The agent has read these of the musician's messages: the studio is told (each once). */
  markSeen(ids: readonly string[]): void {
    const known = new Set(this.entries.filter((x) => x.from === 'musician').map((x) => x.id));
    const fresh = ids.filter((id) => known.has(id) && !this.seen.has(id));
    for (const id of fresh) this.seen.add(id);
    this.tell(fresh, 'seen');
  }

  /** The musician's messages among wait_for_changes' events are seen. */
  seenIn(events: readonly StudioEventRecord[]): void {
    this.markSeen(events.filter((e) => e.event === 'user_message').map((e) => (e.params as { id?: string } | null)?.id).filter((x): x is string => typeof x === 'string'));
  }

  /** A page of the conversation after `since`, oldest first, at most `limit`; the musician's messages in it are seen. */
  page(since = 0, limit: number = CONVERSATION.pageMax) {
    const after = this.entries.filter((x) => x.seq > since);
    const messages = after.slice(0, Math.max(1, Math.min(limit, CONVERSATION.pageMax)));
    this.markSeen(messages.filter((x) => x.from === 'musician').map((x) => x.id));
    const answered = new Set(this.entries.map((x) => x.replyTo).filter(Boolean));
    return {
      messages,
      last: messages.at(-1)?.seq ?? Math.max(since, this.seq),
      more: after.length > messages.length,
      unanswered: this.entries.filter((x) => x.from === 'musician' && !answered.has(x.id)).map((x) => x.id),
    };
  }

  /** Whether `id` is one of the musician's messages kept now. */
  hasMusicianMessage(id: string): boolean {
    return this.entries.some((x) => x.from === 'musician' && x.id === id);
  }

  /** Forget it all (and the musician's messages kept for wait_for_changes too). */
  clear(): void {
    this.entries = [];
    this.seen.clear();
    this.bridge.forget('user_message');
  }
}

/** The get_messages tool. */
export function registerConversationTools(server: McpServer, conversation: Conversation, guard: (body: () => unknown) => Promise<CallToolResult>): void {
  server.registerTool(
    'get_messages',
    {
      title: 'The conversation',
      description: `The conversation with the musician, both ways, oldest first: their messages (from "musician"; with suggestionId when they asked about one of your suggestions, and context when they chose to include their selection) and yours (from "agent", with replyTo). At most ${CONVERSATION.pageMax} at a time: pass "last" back as "since" for the next page ("more" says there are more). "unanswered" lists their messages you haven't replied to. Only the last ${CONVERSATION.keep} each way are kept, in memory only, cleared when the studio disconnects. Reading their messages tells them you've seen them.`,
      inputSchema: { since: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(CONVERSATION.pageMax).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ since, limit }) => guard(() => conversation.page(since ?? 0, limit ?? CONVERSATION.pageMax))
  );
}
