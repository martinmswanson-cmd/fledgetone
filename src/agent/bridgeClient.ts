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
 */
import { songParts, useTimelineStore } from '../store/timelineStore';
import { useUiStore } from '../store/uiStore';
import { APP_VERSION } from '../version';
import { closeMessage, createBridgeClient, type BridgeClient, type BridgeInfo } from './bridgeProtocolClient';
import { DEFAULT_PERMISSIONS, type Permissions } from './protocol';
import { RevisionCounter } from './revision';
import { useSuggestions } from './suggestionsStore';
import { watchSong } from './songWatch';
import { studioHandlers } from './handlers';

/** The helper's port unless the musician gives another (as `fledgetone mcp` listens by default). */
export const DEFAULT_PORT = 47123;

let socket: WebSocket | null = null;
let client: BridgeClient | null = null;
const counter = new RevisionCounter();
let tracking: (() => void) | null = null;

/** The connection as the panel shows it. */
function setInfo(info: BridgeInfo) {
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
        const t = useTimelineStore.getState();
        client?.emit('view', { selectedTrackId: t.selectedTrackId, selectedClipIds: t.clips.filter((c) => c.isSelected).map((c) => c.id), editingClipId: t.editingClipId });
      }, 400);
    }
  });
  // Every answer to a suggestion (accepted, dismissed, out of date, undone...) goes to the agent
  const unsubS = useSuggestions.subscribe((s, prev) => {
    if (s.suggestions === prev.suggestions) return;
    const was = new Map(prev.suggestions.map((x) => [x.id, x.status]));
    for (const x of s.suggestions) if (was.has(x.id) && was.get(x.id) !== x.status) client?.emit('suggestion', { id: x.id, status: x.status, ...(x.status === 'out_of_date' && x.outOfDate ? { outOfDate: x.outOfDate } : {}) });
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
  try {
    ws = new WebSocket(`ws://127.0.0.1:${Math.round(port)}`);
  } catch {
    setInfo({ state: 'refused', message: 'That port can’t be reached.' });
    return;
  }
  socket = ws;
  const c = createBridgeClient({
    send: (text) => ws.send(text),
    close: (code_, reason) => ws.close(code_, reason),
    handlers: studioHandlers(),
    app: { name: 'Fledgetone', version: APP_VERSION },
    permissions,
    onState: (info) => {
      if (client === c) setInfo(info);
    },
  });
  client = c;
  ws.onmessage = (e) => {
    if (typeof e.data === 'string') void c.receive(e.data);
  };
  ws.onclose = (e) => {
    if (client !== c) return;
    c.closed(closeMessage(e.code, c.state));
    stopTracking();
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
  client?.setPermissions(p);
}

/** Disconnect (the agent is told). The suggestions stay on the panel. */
export function disconnectAgent(reason = 'The musician disconnected.'): void {
  const c = client;
  client = null;
  if (c) c.disconnect(reason);
  socket = null;
  stopTracking();
  setInfo({ state: 'closed', ...(c ? { message: reason } : {}) });
}

/** Whether a connection is open or opening. */
export const agentConnected = (): boolean => !!client && (client.state === 'paired' || client.state === 'proving' || client.state === 'waiting' || client.state === 'wrong_code');

/**
 * For the dialog: try the code again on the connection that's open (after a wrong code), with
 * what the musician allows now (the boxes as they are at this press, never as they were at the first).
 */
export function retryCode(code: string, permissions: Permissions): boolean {
  if (!client || client.state !== 'wrong_code' || !socket || socket.readyState !== WebSocket.OPEN) return false;
  setAgentPermissions(permissions);
  client.pair(code);
  return true;
}

// Closing the tab: say goodbye
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => client?.disconnect('The studio closed.'));
