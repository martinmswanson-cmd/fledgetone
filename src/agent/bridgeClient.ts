/**
 * The studio's connection to the agent's helper, for real: a WebSocket to 127.0.0.1:<port> wired
 * to the protocol client (bridgeProtocolClient.ts) with the studio's handlers (handlers.ts). Loaded
 * only when the musician asks for an agent to connect (it isn't in the app's first download), and
 * never in the phone apps.
 *
 * While connected it counts the song's revisions (revision.ts) and tells the agent of each edit
 * (`changed`), of what the musician selects if they allow it (`view`), and of every suggestion
 * answered (`suggestion`); the song watch (songWatch.ts) keeps the suggestions true to the song
 * meanwhile. All of that stops when the connection does.
 *
 * It also carries the musician's messages to the agent (sendToAgent, only when they press Send or
 * Retry) and the helper's word on them (received, seen by the agent); a message still on its way
 * when the connection goes, or sent with none open, is "Not sent" until the musician retries it
 * (within that connection only: a new pairing starts a new one, see conversation.ts).
 */
import { songParts, useTimelineStore } from '../store/timelineStore';
import { useUiStore } from '../store/uiStore';
import { APP_VERSION } from '../version';
import { closeMessage, createBridgeClient, type BridgeClient, type BridgeInfo } from './bridgeProtocolClient';
import { CONVERSATION, DEFAULT_PERMISSIONS, readUserMessage, USER_MESSAGE_STATUS, type Permissions, type UserMessageStatusParams } from './protocol';
import { addOwn, failSending, newConnection, newUserMessageId, NO_ANSWER_REASON, outgoing, selectionContext, setDelivery, useConversation, type OwnMessage } from './conversation';
import { RevisionCounter } from './revision';
import { useSuggestions } from './suggestionsStore';
import { watchSong } from './songWatch';
import { studioHandlers, viewSelection } from './handlers';

/** The helper's port unless the musician gives another (as `fledgetone mcp` listens by default). */
export const DEFAULT_PORT = 47123;

let socket: WebSocket | null = null;
let client: BridgeClient | null = null;
const counter = new RevisionCounter();
let tracking: (() => void) | null = null;
/** The port the open connection dialed. */
let dialedPort: number | null = null;

/** The connection as the panel shows it. */
function setInfo(info: BridgeInfo) {
  // A new pairing is a new connection: what wasn't sent before it can't be retried into it
  if (info.state === 'paired' && useSuggestions.getState().connection.state !== 'paired') newConnection();
  useSuggestions.setState({ connection: info });
  const state = info.state === 'paired' ? 'connected' : info.state === 'waiting' || info.state === 'proving' || info.state === 'wrong_code' ? 'connecting' : 'off';
  useUiStore.setState({ agentStatus: { state, ...(info.agent ? { agent: info.agent } : {}) } });
}

/** Count revisions and tell the agent of changes, until stopTracking (a disconnect). */
export function trackSong(): void {
  if (tracking) return;
  counter.update(songParts(useTimelineStore.getState()) as unknown as Record<string, unknown>);
  let changedTimer = 0;
  let viewTimer = 0;
  const unwatch = watchSong((ctx) => {
    const before = counter.revision;
    const revision = counter.update(ctx.parts);
    if (revision === before) return;
    useSuggestions.setState({ revision });
    // The agent hears of edits a moment after a burst of them ends
    window.clearTimeout(changedTimer);
    changedTimer = window.setTimeout(() => client?.emit('changed', { revision: useSuggestions.getState().revision }), 300);
  });
  const unsub = useTimelineStore.subscribe((s, prev) => {
    const selection = s.selectedTrackId !== prev.selectedTrackId || s.editingClipId !== prev.editingClipId || s.clips !== prev.clips;
    if (selection && useSuggestions.getState().permissions.see) {
      window.clearTimeout(viewTimer);
      viewTimer = window.setTimeout(() => {
        viewTimer = 0;
        // (asked again now: "See what I select" may have been unticked meanwhile)
        if (!useSuggestions.getState().permissions.see) return;
        const t = useTimelineStore.getState();
        client?.emit('view', viewSelection(t));
      }, 400);
    }
  });
  // Every answer to a suggestion (accepted, dismissed, out of date, undone...) goes to the agent
  const unsubS = useSuggestions.subscribe((s, prev) => {
    // Unticked "See what I select": a view on its way doesn't go
    if (prev.permissions.see && !s.permissions.see) {
      window.clearTimeout(viewTimer);
      viewTimer = 0;
    }
    if (s.suggestions === prev.suggestions) return;
    const was = new Map(prev.suggestions.map((x) => [x.id, x.status]));
    // (only this agent's own: another connection's suggestions are none of its business)
    const connection = useConversation.getState().connection;
    for (const x of s.suggestions) if (x.connection === connection && was.has(x.id) && was.get(x.id) !== x.status) client?.emit('suggestion', { id: x.id, status: x.status, ...(x.status === 'out_of_date' && x.outOfDate ? { outOfDate: x.outOfDate } : {}) });
  });
  useSuggestions.setState({ revision: counter.revision });
  tracking = () => {
    unwatch();
    unsub();
    unsubS();
    window.clearTimeout(changedTimer);
    window.clearTimeout(viewTimer);
  };
}

function stopTracking() {
  tracking?.();
  tracking = null;
}

/** Connect to the helper on `port` and pair with `code`. A connection already open is closed first. */
export function connectAgent(code: string, port = DEFAULT_PORT, permissions: Permissions = DEFAULT_PERMISSIONS): void {
  disconnectAgent('Connecting again.');
  trackSong();
  useSuggestions.setState({ permissions: { ...permissions, read: true } });
  let ws: WebSocket;
  // (the port dialed is the one the pairing proofs are bound to)
  const dialed = Math.round(port);
  try {
    ws = new WebSocket(`ws://127.0.0.1:${dialed}`);
  } catch {
    setInfo({ state: 'refused', message: 'That port can’t be reached.' });
    return;
  }
  socket = ws;
  dialedPort = dialed;
  const c = createBridgeClient({
    send: (text) => ws.send(text),
    close: (code_, reason) => ws.close(code_, reason),
    handlers: studioHandlers(),
    port: dialed,
    app: { name: 'Fledgetone', version: APP_VERSION },
    permissions,
    onState: (info) => {
      if (client === c) setInfo(info);
    },
    onEvent: (method, params) => {
      if (client !== c || method !== USER_MESSAGE_STATUS || typeof params !== 'object' || !params) return;
      const p = params as Partial<UserMessageStatusParams>;
      const ids = Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === 'string').slice(0, CONVERSATION.keep) : [];
      if (ids.length && (p.status === 'received' || p.status === 'seen')) setDelivery(ids, p.status === 'seen' ? 'seen' : 'sent');
    },
  });
  client = c;
  // (the helper says hello as soon as the connection opens: the wait for it starts now, as the
  // socket is made, so a program on the port that takes the connection but never completes it,
  // or never says hello, is said so after HELLO_TIMEOUT_MS all the same)
  c.opened();
  ws.onopen = () => {
    if (client === c) c.opened();
  };
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') void c.receive(e.data);
  };
  ws.onclose = (e) => {
    if (client !== c) return;
    c.closed(closeMessage(e.code, c.state));
    stopTracking();
    failSending();
  };
  ws.onerror = () => {
    // The close event follows with the reason
  };
  c.pair(code);
  setInfo(c.info());
}

/** What the musician allows, changed while connected. */
export function setAgentPermissions(permissions: Permissions): void {
  const p = { ...permissions, read: true };
  useSuggestions.setState({ permissions: p });
  // (the tick goes with the permission: allowing it again doesn't tick it again)
  if (!p.see) useConversation.setState({ include: false });
  client?.setPermissions(p);
}

/** Disconnect (the agent is told). The suggestions stay on the panel. */
export function disconnectAgent(reason = 'The musician disconnected.'): void {
  const c = client;
  client = null;
  if (c) c.disconnect(reason);
  socket = null;
  stopTracking();
  failSending();
  setInfo({ state: 'closed', ...(c ? { message: reason } : {}) });
}

/** Hand a message to the helper (only paired, on an open socket); it's "Not sent" if the helper doesn't say it has it in time. */
function deliver(m: OwnMessage): void {
  // What goes is decided now: the selection only while the agent may see it, the suggestion only while it's on the panel
  const st = useSuggestions.getState();
  // (a suggestion of another connection's agent is none of this one's: it can't read it)
  const params = outgoing(m, { see: st.permissions.see, onPanel: (id) => st.suggestions.some((s) => s.id === id && s.connection === m.connection) });
  // (and the conversation shows what went, no more)
  if (params.context !== m.context || params.suggestionId !== m.suggestionId)
    useConversation.setState((c) => ({ mine: c.mine.map((x) => (x.id === m.id ? { ...x, context: params.context, suggestionId: params.suggestionId } : x)) }));
  const ok = !!client && client.state === 'paired' && socket?.readyState === WebSocket.OPEN && client.emit('user_message', params);
  if (!ok) {
    setDelivery([m.id], 'not_sent');
    return;
  }
  const c = client;
  window.setTimeout(() => {
    const now = useConversation.getState().mine.find((x) => x.id === m.id);
    if (now?.status === 'sending') setDelivery([m.id], 'not_sent', client === c ? NO_ANSWER_REASON : undefined);
  }, CONVERSATION.ackMs);
}

/**
 * The musician pressed Send: their text (made plain, at most CONVERSATION.textMaxChars), the
 * suggestion it asks about, and their selection only if they ticked "Include what I've selected"
 * and allow the agent to see it. Added to the conversation whatever happens, and sent if an agent
 * is connected (else "Not sent", with Retry). Returns the message, or null if there's nothing to send.
 */
export function sendToAgent(text: string, opts: { about?: string | null; include?: boolean } = {}): OwnMessage | null {
  const st = useSuggestions.getState();
  const t = useTimelineStore.getState();
  const context = opts.include && st.permissions.see ? selectionContext(t) : undefined;
  const connection = useConversation.getState().connection;
  const about = opts.about && st.suggestions.some((s) => s.id === opts.about && s.connection === connection) ? opts.about : undefined;
  const read = readUserMessage({ id: newUserMessageId(), text, at: Date.now(), ...(about ? { suggestionId: about } : {}), ...(context ? { context } : {}) });
  if (!read) return null;
  const m: OwnMessage = { ...read, status: 'sending', connection };
  addOwn(m);
  deliver(m);
  return m;
}

/** Retry: the same message (its id and words) sent again, now, within the connection it was written in (else nothing). */
export function retryMessage(id: string): void {
  const c = useConversation.getState();
  const m = c.mine.find((x) => x.id === id);
  if (!m || m.status !== 'not_sent' || m.ended || m.connection !== c.connection) return;
  setDelivery([id], 'sending');
  deliver({ ...m, status: 'sending' });
}

/** Whether a connection is open or opening. */
export const agentConnected = (): boolean => !!client && (client.state === 'paired' || client.state === 'proving' || client.state === 'waiting' || client.state === 'wrong_code');

/**
 * For the dialog: try the code again on the connection that's open (after a wrong code), with
 * what the musician allows now (the boxes as they are at this press, never as they were at the
 * first). Only to the port that connection dialed: false (connect afresh) if `port` is another.
 */
export function retryCode(code: string, port: number, permissions: Permissions): boolean {
  if (!client || client.state !== 'wrong_code' || !socket || socket.readyState !== WebSocket.OPEN || Math.round(port) !== dialedPort) return false;
  setAgentPermissions(permissions);
  client.pair(code);
  return true;
}

// Closing the tab: say goodbye
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => client?.disconnect('The studio closed.'));
