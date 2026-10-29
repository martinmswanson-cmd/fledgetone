/**
 * The studio's end of the agent connection, without the WebSocket or the store: the pairing
 * steps and the dispatch of the helper's requests to handlers, given a function that sends text
 * and one that closes the connection. The studio wires it to a WebSocket and its handlers to the
 * store; tests wire it straight to the helper in the same process.
 *
 * Pairing (see protocol.ts): it waits for the helper's `hello`, sends `pair` with its nonce and
 * proof, and checks the helper's proof before anything else: a helper that can't prove it knows
 * the code is refused and the connection closed, before any handler has run. Until then every
 * request is answered "not_paired". Once paired, each request goes to its handler if the musician
 * allowed what it needs (STUDIO_METHODS), else it's answered "not_allowed".
 */
import {
  DEFAULT_PERMISSIONS,
  encodeMessage,
  isStudioMethod,
  LIMITS,
  newNonce,
  normalizeCode,
  parseMessage,
  PROTOCOL_VERSION,
  sameProof,
  serverProof,
  STUDIO_METHODS,
  studioProof,
  type HelloParams,
  type PairResult,
  type Permissions,
  type ProtocolError,
  type StudioEvent,
  type StudioMethod,
} from './protocol';

/**
 * Where pairing is:
 * - waiting: connected, waiting for the helper's hello (or for a code to be typed);
 * - proving: the code sent as a proof, waiting for the helper's;
 * - paired: both proved they know the code, requests are served;
 * - wrong_code: the helper says the code was wrong (try again with pair());
 * - refused: it can't go on (the helper couldn't prove itself, too many tries, no code waiting, another version);
 * - closed: the connection is gone.
 */
export type BridgeState = 'waiting' | 'proving' | 'paired' | 'wrong_code' | 'refused' | 'closed';

export interface BridgeInfo {
  state: BridgeState;
  /** The helper, once it has said hello. */
  server?: { name: string; version: string };
  /** The agent's name, once paired. */
  agent?: string;
  /** Tries left, after a wrong code. */
  attemptsLeft?: number;
  /** Why it was refused or closed, in plain words. */
  message?: string;
}

/** A handler's way to answer with an error of its own (code and plain-words message). */
export class HandlerError extends Error {
  readonly code: string;
  readonly extra?: Record<string, unknown>;
  constructor(code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

/** A request's handler: the request's params in, the response's result out (or a thrown HandlerError). */
export type Handler = (params: Record<string, unknown>, ctx: { method: StudioMethod; id: string }) => unknown;
export type Handlers = Partial<Record<StudioMethod, Handler>>;

export interface BridgeClientOptions {
  /** Send one text frame to the helper. */
  send: (text: string) => void;
  /** Close the connection (the WebSocket's close: a 4000-4999 code and a reason). */
  close: (code: number, reason: string) => void;
  handlers: Handlers;
  /** This app, for the helper to show. */
  app: { name?: string; version: string };
  /** What the agent may do (read only until the musician ticks more). */
  permissions?: Permissions;
  /** Told of every change of state. */
  onState?: (info: BridgeInfo) => void;
  /** Told of the helper's events once paired (none are defined yet beyond hello). */
  onEvent?: (method: string, params: unknown) => void;
}

export interface BridgeClient {
  readonly state: BridgeState;
  info(): BridgeInfo;
  /** Pair with the code the musician typed (again, after a wrong code). Sent as soon as the helper has said hello. */
  pair(code: string): void;
  /** A text frame from the helper. Resolves once its request, if it was one, has been answered. */
  receive(text: string): Promise<void>;
  /** Tell the helper something (only once paired; false otherwise). */
  emit(event: StudioEvent, params?: unknown): boolean;
  /** What the agent may do from now on (the helper is told). */
  setPermissions(p: Permissions): void;
  /** Leave: says bye and closes. */
  disconnect(reason?: string): void;
  /** The connection closed (from the WebSocket's close event). */
  closed(reason?: string): void;
}

/** Close codes the client uses. */
export const CLOSE = { refused: 4003, version: 4004, leaving: 4000, protocol: 4002 } as const;

export function createBridgeClient(opts: BridgeClientOptions): BridgeClient {
  let state: BridgeState = 'waiting';
  let info: BridgeInfo = { state };
  let permissions: Permissions = { ...(opts.permissions ?? DEFAULT_PERMISSIONS), read: true };
  let serverNonce: string | null = null;
  let code: string | null = null;
  let pending: { id: string; nonce: string; code: string; timer: ReturnType<typeof setTimeout> } | null = null;
  let pairCount = 0;

  const setState = (next: BridgeState, extra: Partial<BridgeInfo> = {}) => {
    state = next;
    info = { ...info, ...extra, state };
    if (next !== 'wrong_code') delete info.attemptsLeft;
    opts.onState?.({ ...info });
  };

  const sendRaw = (m: Parameters<typeof encodeMessage>[0]) => {
    if (state === 'closed') return;
    try {
      opts.send(encodeMessage(m));
    } catch {
      // A socket that's going: its close event follows
    }
  };

  const refuse = (message: string, closeCode: number = CLOSE.refused) => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    setState('refused', { message });
    try {
      opts.close(closeCode, message.slice(0, 120));
    } catch {
      // Already closing
    }
  };

  /** Pairing can't start now: one is under way, or it's done or over. */
  const busy = () => pending !== null || state === 'paired' || state === 'refused' || state === 'closed';

  const sendPair = async () => {
    if (!serverNonce || !code || busy()) return;
    const nonce = newNonce();
    const id = `pair-${++pairCount}`;
    const forCode = code;
    const proof = await studioProof(forCode, serverNonce, nonce);
    // (the state may have moved on while the proof was made)
    if (busy()) return;
    const timer = setTimeout(() => refuse('The helper didn’t answer. Check it’s running, then try again.'), LIMITS.pairTimeoutMs);
    pending = { id, nonce, code: forCode, timer };
    setState('proving');
    sendRaw({ kind: 'req', id, method: 'pair', params: { protocol: PROTOCOL_VERSION, nonce, proof, app: { name: opts.app.name ?? 'Fledgetone', version: opts.app.version }, permissions } });
  };

  const onPairAnswer = async (result: unknown, error: ProtocolError | undefined) => {
    const p = pending!;
    clearTimeout(p.timer);
    pending = null;
    if (error) {
      if (error.code === 'wrong_code') {
        if (typeof error.nonce === 'string') serverNonce = error.nonce;
        setState('wrong_code', { attemptsLeft: typeof error.attemptsLeft === 'number' ? error.attemptsLeft : undefined, message: 'That code isn’t the one your agent gave. Check it and type it again.' });
        return;
      }
      refuse(error.message || 'The helper refused the connection.');
      return;
    }
    const r = (result ?? {}) as Partial<PairResult>;
    const expected = await serverProof(p.code, serverNonce!, p.nonce);
    if (!sameProof(r.proof, expected)) {
      // Not the helper the agent started (it doesn't know the code): nothing has been sent to it
      refuse('This connection didn’t prove it knows the code, so nothing was sent. Start the connection again from your agent.');
      return;
    }
    const server = r.server && typeof r.server.name === 'string' ? { name: r.server.name.slice(0, LIMITS.nameMaxChars), version: String(r.server.version ?? '').slice(0, 40) } : info.server;
    setState('paired', { server, agent: typeof r.agent === 'string' ? r.agent.slice(0, LIMITS.nameMaxChars) : undefined, message: undefined });
  };

  const answer = (id: string, result: unknown) => sendRaw({ kind: 'res', id, result: result ?? null });
  const answerError = (id: string, code: string, message: string, extra?: Record<string, unknown>) => sendRaw({ kind: 'res', id, error: { ...extra, code, message } });

  const onRequest = async (id: string, method: string, params: unknown) => {
    if (state !== 'paired') return answerError(id, 'not_paired', 'Not paired yet.');
    if (!isStudioMethod(method)) return answerError(id, 'unknown_method', `The studio doesn't know "${method}".`);
    const need = STUDIO_METHODS[method];
    if (!permissions[need]) return answerError(id, 'not_allowed', `The musician hasn't allowed the agent to ${need === 'see' ? 'see what they select' : need} (they can change that in Fledgetone).`);
    const handler = opts.handlers[method];
    if (!handler) return answerError(id, 'unavailable', `The studio can't ${method.replace(/_/g, ' ')} yet.`);
    try {
      const p = typeof params === 'object' && params !== null && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
      answer(id, await handler(p, { method, id }));
    } catch (err) {
      if (err instanceof HandlerError) answerError(id, err.code, err.message, err.extra);
      else answerError(id, 'failed', err instanceof Error ? err.message : 'Something went wrong in the studio.');
    }
  };

  return {
    get state() {
      return state;
    },
    info: () => ({ ...info }),
    pair(text: string) {
      const plain = normalizeCode(text);
      if (!plain) {
        setState(state === 'proving' ? 'proving' : 'wrong_code', { message: 'A code is 8 letters and digits, like K7QM-3XPD.' });
        return;
      }
      code = plain;
      void sendPair();
    },
    async receive(text: string) {
      if (state === 'closed' || state === 'refused') return;
      const m = parseMessage(text);
      if (!m) {
        // Not our protocol, or another version of it: nothing more is said
        refuse('The helper speaks another version of the connection. Update Fledgetone’s command line tools.', CLOSE.version);
        return;
      }
      if (m.kind === 'event' && m.method === 'hello') {
        const h = (m.params ?? {}) as Partial<HelloParams>;
        if (h.protocol !== PROTOCOL_VERSION || typeof h.nonce !== 'string' || h.nonce.length < 16) {
          refuse('The helper speaks another version of the connection. Update Fledgetone’s command line tools.', CLOSE.version);
          return;
        }
        // A second hello mid-pairing would let a helper swap nonces under a proof: only the first counts
        if (serverNonce) return;
        serverNonce = h.nonce;
        if (h.server && typeof h.server.name === 'string') info = { ...info, server: { name: h.server.name.slice(0, LIMITS.nameMaxChars), version: String(h.server.version ?? '').slice(0, 40) } };
        await sendPair();
        return;
      }
      if (m.kind === 'res') {
        if (pending && m.id === pending.id) await onPairAnswer(m.result, m.error);
        return;
      }
      if (m.kind === 'req') return onRequest(m.id!, m.method!, m.params);
      if (state === 'paired' && m.method) opts.onEvent?.(m.method, m.params);
    },
    emit(event, params) {
      if (state !== 'paired') return false;
      sendRaw({ kind: 'event', method: event, params: params ?? {} });
      return true;
    },
    setPermissions(p) {
      permissions = { ...p, read: true };
      if (state === 'paired') sendRaw({ kind: 'event', method: 'permissions', params: permissions });
    },
    disconnect(reason = 'The musician disconnected.') {
      if (state === 'paired') sendRaw({ kind: 'event', method: 'bye', params: { reason } });
      if (pending) clearTimeout(pending.timer);
      pending = null;
      try {
        opts.close(CLOSE.leaving, reason.slice(0, 120));
      } catch {
        // Already closing
      }
      setState('closed', { message: reason });
    },
    closed(reason) {
      if (pending) clearTimeout(pending.timer);
      pending = null;
      if (state !== 'closed') setState('closed', state === 'refused' ? {} : { message: reason || 'The connection closed.' });
    },
  };
}
