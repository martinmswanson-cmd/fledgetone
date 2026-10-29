/**
 * The helper's end of the studio connection: a WebSocket server on 127.0.0.1 only, which a
 * studio page pairs with by the code the agent shows the musician (see src/agent/protocol.ts).
 *
 * It refuses any page not from an allowed origin and any Host but its own address, caps frames
 * at LIMITS.frameBytes, pings every LIMITS.heartbeatMs (no answer: the connection is dropped),
 * counts wrong codes (five on a connection close it, twenty retire the code for a new one), and
 * serves one paired studio at a time. Once paired, `request` sends the studio a request and waits
 * for its answer (or a timeout), and the studio's events are kept in a ring buffer that
 * `waitForEvents` reads from, for the agent's wait_for_changes. It logs to stderr only.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import {
  encodeMessage,
  hostAllowed,
  LIMITS,
  newNonce,
  newPairingCode,
  normalizeCode,
  originAllowed,
  parseMessage,
  PROTOCOL_VERSION,
  sameProof,
  serverProof,
  STUDIO_EVENTS,
  studioProof,
  type Message,
  type PairParams,
  type Permissions,
  type StudioMethod,
} from '../../../src/agent/protocol';

/** The port the helper listens on unless told otherwise (a random one when it's taken). */
export const DEFAULT_PORT = 47123;

export interface BridgeServerOptions {
  /** The port: DEFAULT_PORT when absent, 0 for a random one. */
  port?: number;
  /** Let the dev server's pages connect (localhost:5173 and 5200). */
  dev?: boolean;
  /** Let pages with no origin of their own (a file opened from disk) connect. */
  allowNull?: boolean;
  /** More origins allowed (the `fledgetone studio` page). */
  studioOrigins?: string[];
  version: string;
  /** The agent's name, for the studio to show. */
  agentName?: () => string | undefined;
  log?: (text: string) => void;
}

/** What the studio said, kept for wait_for_changes. */
export interface StudioEventRecord {
  seq: number;
  at: string;
  event: string;
  params: unknown;
}

/** The request couldn't be answered: no studio, it timed out, or the studio answered with an error. */
export class BridgeError extends Error {
  readonly code: string;
  readonly extra?: Record<string, unknown>;
  constructor(code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

/** The message every live tool gives when no studio is paired. */
export const NOT_CONNECTED = 'No studio is connected — call connect_studio and ask the user to type the code in Fledgetone.';

interface Conn {
  ws: WebSocket;
  nonce: string;
  wrong: number;
  paired: boolean;
  alive: boolean;
  studio?: { app: { name: string; version: string }; permissions: Permissions };
}

export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private readonly conns = new Set<Conn>();
  private paired: Conn | null = null;
  private code: { plain: string; shown: string; expires: number; wrong: number } | null = null;
  private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 0;
  private readonly events: StudioEventRecord[] = [];
  private seq = 0;
  private waiters: Array<() => void> = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<(e: StudioEventRecord) => void>();
  private readonly opts: BridgeServerOptions;
  port = 0;

  constructor(opts: BridgeServerOptions) {
    this.opts = opts;
  }

  private log(text: string) {
    (this.opts.log ?? ((t: string) => process.stderr.write(`fledgetone: ${t}\n`)))(text);
  }

  /** Start listening; resolves with the port. The default port, if taken, falls back to a random one. */
  async start(): Promise<number> {
    const want = this.opts.port ?? DEFAULT_PORT;
    try {
      this.port = await this.listen(want);
    } catch (err) {
      if (this.opts.port !== undefined || (err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
      this.log(`port ${want} is taken: listening on another`);
      this.port = await this.listen(0);
    }
    this.heartbeat = setInterval(() => this.beat(), LIMITS.heartbeatMs);
    this.heartbeat.unref?.();
    this.log(`waiting for the studio on 127.0.0.1:${this.port}`);
    return this.port;
  }

  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: '127.0.0.1',
        port,
        maxPayload: LIMITS.frameBytes,
        perMessageDeflate: false,
        verifyClient: (info: { origin: string; req: IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void) => this.verify(info, done),
      });
      wss.once('error', reject);
      wss.once('listening', () => {
        wss.off('error', reject);
        wss.on('error', (e) => this.log(`connection error: ${e.message}`));
        this.wss = wss;
        wss.on('connection', (ws) => this.onConnection(ws));
        resolve((wss.address() as { port: number }).port);
      });
    });
  }

  private verify(info: { origin: string; req: IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void) {
    const port = (this.wss?.address() as { port: number } | undefined)?.port ?? this.port;
    if (!hostAllowed(info.req.headers.host, port)) {
      this.log(`refused a connection for host ${JSON.stringify(info.req.headers.host)}`);
      return done(false, 403, 'Forbidden');
    }
    if (!originAllowed(info.origin || info.req.headers.origin, { dev: this.opts.dev, allowNull: this.opts.allowNull, studioOrigins: this.opts.studioOrigins })) {
      this.log(`refused a connection from ${JSON.stringify(info.origin ?? null)} (not an allowed page)`);
      return done(false, 403, 'Forbidden');
    }
    done(true);
  }

  private onConnection(ws: WebSocket) {
    if (this.paired) {
      ws.close(4009, 'A studio is already connected');
      return;
    }
    const conn: Conn = { ws, nonce: newNonce(), wrong: 0, paired: false, alive: true };
    this.conns.add(conn);
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return ws.close(4002, 'Text frames only');
      void this.onMessage(conn, data.toString());
    });
    ws.on('close', () => this.onClose(conn));
    ws.on('error', () => {});
    this.send(conn, { kind: 'event', method: 'hello', params: { protocol: PROTOCOL_VERSION, nonce: conn.nonce, server: { name: 'fledgetone', version: this.opts.version } } });
  }

  private send(conn: Conn, m: Omit<Message, 'v'>) {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(encodeMessage(m));
  }

  private async onMessage(conn: Conn, text: string) {
    const m = parseMessage(text);
    if (!m) return conn.ws.close(4002, 'Not a Fledgetone message');
    if (!conn.paired) {
      if (m.kind === 'req' && m.method === 'pair') return this.onPair(conn, m);
      if (m.kind === 'req') this.send(conn, { kind: 'res', id: m.id, error: { code: 'not_paired', message: 'Pair first.' } });
      return;
    }
    if (m.kind === 'res') {
      const p = this.pending.get(m.id!);
      if (!p) return;
      this.pending.delete(m.id!);
      clearTimeout(p.timer);
      if (m.error) p.reject(new BridgeError(m.error.code, m.error.message, m.error));
      else p.resolve(m.result);
      return;
    }
    if (m.kind === 'event') {
      if (!(STUDIO_EVENTS as readonly string[]).includes(m.method!)) return;
      if (m.method === 'permissions' && conn.studio && typeof m.params === 'object' && m.params) conn.studio.permissions = { ...(m.params as Permissions), read: true };
      this.record(m.method!, m.params);
      if (m.method === 'bye') conn.ws.close(4000, 'Bye');
      return;
    }
    this.send(conn, { kind: 'res', id: m.id, error: { code: 'unknown_method', message: 'The helper takes no requests.' } });
  }

  private async onPair(conn: Conn, m: Message) {
    const p = (m.params ?? {}) as Partial<PairParams>;
    const fail = (code: string, message: string, extra: Record<string, unknown> = {}) => this.send(conn, { kind: 'res', id: m.id, error: { code, message, ...extra } });
    if (p.protocol !== PROTOCOL_VERSION) return fail('version', 'This helper speaks another version: update Fledgetone or its command line tools.');
    if (typeof p.nonce !== 'string' || p.nonce.length < 16 || p.nonce.length > 128 || typeof p.proof !== 'string') return fail('bad_request', 'A pair request needs a nonce and a proof.');
    const code = this.code;
    if (!code || code.expires < Date.now()) {
      this.code = null;
      return fail('no_code', 'There’s no code waiting: ask your agent to connect again for a new one.');
    }
    const expected = await studioProof(code.plain, conn.nonce, p.nonce);
    if (!sameProof(p.proof, expected)) {
      conn.wrong++;
      code.wrong++;
      this.log(`a wrong code was typed (${conn.wrong} on this connection)`);
      if (code.wrong >= LIMITS.wrongCodesPerCode) {
        this.code = null;
        this.record('code_retired', { reason: 'too many wrong codes' });
        fail('too_many_tries', 'Too many wrong codes: ask your agent for a new one.');
        return conn.ws.close(4001, 'Too many wrong codes');
      }
      if (conn.wrong >= LIMITS.wrongCodesPerConnection) {
        fail('too_many_tries', 'Too many wrong codes: connect again.');
        return conn.ws.close(4001, 'Too many wrong codes');
      }
      // A fresh nonce for the next try, so no proof is ever checked twice against the same one
      conn.nonce = newNonce();
      return fail('wrong_code', 'That isn’t the code.', { attemptsLeft: Math.min(LIMITS.wrongCodesPerConnection - conn.wrong, LIMITS.wrongCodesPerCode - code.wrong), nonce: conn.nonce });
    }
    if (this.paired) return fail('busy', 'A studio is already connected.');
    const proof = await serverProof(code.plain, conn.nonce, p.nonce);
    // The code is used up: another page can't pair with it
    this.code = null;
    conn.paired = true;
    const app = p.app && typeof p.app === 'object' ? { name: String(p.app.name ?? 'Fledgetone').slice(0, 64), version: String(p.app.version ?? '').slice(0, 40) } : { name: 'Fledgetone', version: '' };
    const permissions = { read: true, see: p.permissions?.see === true, suggest: p.permissions?.suggest === true, listen: p.permissions?.listen === true };
    conn.studio = { app, permissions };
    this.paired = conn;
    this.send(conn, { kind: 'res', id: m.id, result: { proof, server: { name: 'fledgetone', version: this.opts.version }, ...(this.opts.agentName?.() ? { agent: this.opts.agentName!()!.slice(0, LIMITS.nameMaxChars) } : {}) } });
    // Other pages waiting to pair are let go
    for (const other of this.conns) if (other !== conn) other.ws.close(4009, 'Another studio connected');
    this.log(`paired with ${app.name} ${app.version}`);
    this.record('paired', { app, permissions });
  }

  private onClose(conn: Conn) {
    this.conns.delete(conn);
    if (this.paired !== conn) return;
    this.paired = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeError('disconnected', 'The studio disconnected before it answered.'));
      this.pending.delete(id);
    }
    this.log('the studio disconnected');
    this.record('disconnected', {});
  }

  private beat() {
    for (const conn of this.conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        // closing
      }
    }
  }

  private record(event: string, params: unknown) {
    const e = { seq: ++this.seq, at: new Date().toISOString(), event, params };
    this.events.push(e);
    for (const listener of this.listeners) {
      try {
        listener(e);
      } catch {
        // a listener's trouble isn't the connection's
      }
    }
    while (this.events.length > LIMITS.eventBuffer) this.events.shift();
    const waiting = this.waiters;
    this.waiters = [];
    for (const w of waiting) w();
  }

  /** Be told of every event the studio sends (and of pairing and disconnecting). Returns the way to stop. */
  subscribe(listener: (e: StudioEventRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A new pairing code (the one waiting, if it's still fresh and `fresh` isn't asked). */
  pairingCode(fresh = false): { code: string; expiresAt: string } {
    if (fresh || !this.code || this.code.expires < Date.now()) {
      const shown = newPairingCode();
      this.code = { plain: normalizeCode(shown)!, shown, expires: Date.now() + LIMITS.codeLifetimeMs, wrong: 0 };
    }
    return { code: this.code.shown, expiresAt: new Date(this.code.expires).toISOString() };
  }

  get isPaired(): boolean {
    return this.paired !== null;
  }

  status() {
    return {
      listening: this.wss !== null,
      address: `ws://127.0.0.1:${this.port}`,
      port: this.port,
      connected: this.paired !== null,
      ...(this.paired?.studio ? { studio: this.paired.studio } : {}),
      ...(this.code && this.code.expires > Date.now() ? { codeWaiting: true } : {}),
      lastEvent: this.seq,
    };
  }

  /** What the paired studio lets the agent do (all false with no studio). */
  permissions(): Permissions {
    return this.paired?.studio?.permissions ?? { read: false, see: false, suggest: false, listen: false };
  }

  /** Wait up to `ms` for a studio to pair. */
  async waitForPairing(ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (!this.paired && Date.now() < end) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, end - Date.now()));
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return this.paired !== null;
  }

  /** Events after `since` (a seq), waiting up to `ms` for one if there are none yet. */
  async waitForEvents(since: number, ms: number): Promise<{ events: StudioEventRecord[]; last: number }> {
    const after = () => this.events.filter((e) => e.seq > since);
    if (!after().length && ms > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return { events: after(), last: this.seq };
  }

  /** Ask the paired studio; resolves with its answer. Throws BridgeError (not_connected, timeout, or the studio's own error). */
  request(method: StudioMethod, params: Record<string, unknown> = {}, timeoutMs: number = LIMITS.requestTimeoutMs): Promise<unknown> {
    const conn = this.paired;
    if (!conn) return Promise.reject(new BridgeError('not_connected', NOT_CONNECTED));
    const id = `r${++this.nextId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError('timeout', `The studio didn’t answer ${method} in ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send(conn, { kind: 'req', id, method, params });
    });
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.conns) c.ws.terminate();
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeError('closed', 'The helper is stopping.'));
    }
    this.pending.clear();
    const wss = this.wss;
    this.wss = null;
    if (wss) await new Promise<void>((resolve) => wss.close(() => resolve()));
  }
}
