/**
 * The local connection between the studio (a browser tab) and the agent's helper (`fledgetone
 * mcp`, a program on the same computer): its messages, pairing, which pages may connect, and its
 * limits. Shared by both ends, so it runs in the browser and in Node (Web Crypto only, through
 * globalThis.crypto).
 *
 * Messages are JSON text frames: `{ v: 1, id, kind: 'req' | 'res' | 'event', method, params }`,
 * a response carrying the request's id and `result` or `error: { code, message }`.
 *
 * Pairing (once per connection, before anything else): the helper shows the agent an 8-character
 * code (K7QM-3XPD), the agent asks the musician to type it in the studio. Neither end ever sends
 * the code. The helper opens with a `hello` event carrying its nonce S; the studio answers with a
 * `pair` request carrying its nonce C and HMAC-SHA-256(code, S.C.studio); the helper checks it and
 * answers with HMAC(code, C.S.server). The studio checks that before it sends any song data, so a
 * program that doesn't know the code can't pass for the helper. Five wrong codes on a connection
 * close it; twenty on one code retire the code.
 *
 * Only pages from the allowed origins may connect (the published app, and the dev server with
 * --dev), and only at 127.0.0.1:<port> by that exact Host (so another site's DNS name pointed at
 * 127.0.0.1 is refused).
 */
/** The protocol version both ends speak. */
export const PROTOCOL_VERSION = 1;

export type MessageKind = 'req' | 'res' | 'event';

/** An error a response can carry. */
export interface ProtocolError {
  code: string;
  message: string;
  [extra: string]: unknown;
}

export interface Message {
  v: typeof PROTOCOL_VERSION;
  kind: MessageKind;
  /** Requests and their responses */
  id?: string;
  /** Requests and events */
  method?: string;
  params?: unknown;
  /** Responses */
  result?: unknown;
  error?: ProtocolError;
}

/** The connection's limits. The helper enforces the agent's side; the studio its own. */
export const LIMITS = {
  /** The largest message, in bytes. */
  frameBytes: 2 * 1024 * 1024,
  /** A ping this often; no answer by the next one closes the connection. */
  heartbeatMs: 15_000,
  /** Wrong codes on one connection before it's closed. */
  wrongCodesPerConnection: 5,
  /** Wrong codes in all before the code is replaced by a new one. */
  wrongCodesPerCode: 20,
  /** How long a code waits to be typed in. */
  codeLifetimeMs: 10 * 60_000,
  /** How long the studio waits for the helper's proof. */
  pairTimeoutMs: 10_000,
  /** Suggestions waiting for the musician at once. */
  waitingSuggestions: 5,
  /** At most one new suggestion this often. */
  suggestEveryMs: 3_000,
  /** Ops in one suggestion, and notes it may add. */
  maxOps: 500,
  maxAddedNotes: 5000,
  /** One listen at a time, at most this many bars or seconds, at most listensPerMinute a minute. */
  listenMaxBars: 64,
  listenMaxSeconds: 90,
  listensPerMinute: 10,
  /** point_at at most once this often. */
  pointAtEveryMs: 1_000,
  /** say: at most this many characters, once this often. */
  sayMaxChars: 4_000,
  sayEveryMs: 1_000,
  /** get_song at most this many times a second. */
  getSongPerSecond: 4,
  /** A suggestion's title and explanation. */
  titleMaxChars: 80,
  explanationMaxChars: 2_000,
  /** Names an agent gives are cut to this many characters where the studio shows them. */
  nameMaxChars: 64,
  /** Events the helper keeps for wait_for_changes. */
  eventBuffer: 200,
  waitForChangesMaxSeconds: 25,
  connectWaitMaxSeconds: 60,
  /** How long the helper waits for the studio to answer a request (listen: listenTimeoutMs). */
  requestTimeoutMs: 15_000,
  listenTimeoutMs: 120_000,
} as const;

/** What the helper asks of the studio (requests), with what each needs the musician to have allowed. */
export const STUDIO_METHODS = {
  get_song: 'read',
  get_notes: 'read',
  get_automation: 'read',
  get_view: 'see',
  preview_suggestion: 'read',
  suggest: 'suggest',
  get_suggestion: 'suggest',
  withdraw_suggestion: 'suggest',
  listen: 'listen',
  say: 'read',
  point_at: 'read',
} as const;
export type StudioMethod = keyof typeof STUDIO_METHODS;
/** What the musician lets an agent do: read the song (always), see what they select, suggest changes, listen to renders. */
export type Permission = 'read' | 'see' | 'suggest' | 'listen';
export type Permissions = Record<Permission, boolean>;
/** Read only, until the musician ticks more. */
export const DEFAULT_PERMISSIONS: Permissions = { read: true, see: false, suggest: false, listen: false };

/**
 * What the studio tells the helper without being asked (events): the song changed (its new
 * revision), the view or selection changed, a suggestion's status changed (accepted, dismissed,
 * out of date, withdrawn), the permissions changed, or it's leaving.
 */
export const STUDIO_EVENTS = ['changed', 'view', 'suggestion', 'permissions', 'bye'] as const;
export type StudioEvent = (typeof STUDIO_EVENTS)[number];

export const isStudioMethod = (m: unknown): m is StudioMethod => typeof m === 'string' && Object.hasOwn(STUDIO_METHODS, m);

/** A message as text. */
export const encodeMessage = (m: Omit<Message, 'v'>): string => JSON.stringify({ v: PROTOCOL_VERSION, ...m });

/** A message from text, or null if it isn't one of ours (wrong version, not JSON, the wrong shape, too big). */
export function parseMessage(text: unknown): Message | null {
  if (typeof text !== 'string' || text.length > LIMITS.frameBytes) return null;
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (o.v !== PROTOCOL_VERSION || (o.kind !== 'req' && o.kind !== 'res' && o.kind !== 'event')) return null;
  if (o.id !== undefined && (typeof o.id !== 'string' || !o.id || o.id.length > 64)) return null;
  if (o.kind !== 'res' && (typeof o.method !== 'string' || !/^[a-z_]{1,40}$/.test(o.method))) return null;
  if (o.kind !== 'event' && o.id === undefined) return null;
  if (o.error !== undefined && (typeof o.error !== 'object' || o.error === null || typeof (o.error as ProtocolError).code !== 'string')) return null;
  return o as unknown as Message;
}

// ---------- Pairing ----------

/** The code's letters: no 0/O, 1/I/L or U/V lookalikes, so it reads aloud and types cleanly. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXYZ';
export const CODE_LENGTH = 8;

const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** A new pairing code, shown as "K7QM-3XPD". */
export function newPairingCode(): string {
  let out = '';
  // Rejection sampling keeps every letter equally likely
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (out.length < CODE_LENGTH) for (const b of random(16)) if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** A code as typed ("k7qm 3xpd", "K7QM-3XPD") in its plain form ("K7QM3XPD"), or null if it can't be one. */
export function normalizeCode(text: string): string | null {
  const plain = text.toUpperCase().replace(/[\s-]+/g, '');
  if (plain.length !== CODE_LENGTH || [...plain].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return plain;
}

const toB64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** A fresh random nonce (32 bytes, base64url). */
export const newNonce = (): string => toB64url(random(32));

async function hmac(code: string, text: string): Promise<string> {
  const plain = normalizeCode(code);
  if (!plain) throw new Error('not a pairing code');
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(plain), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toB64url(new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(text))));
}

/** The studio's proof that it knows the code: HMAC(code, S.C.studio). */
export const studioProof = (code: string, serverNonce: string, studioNonce: string) => hmac(code, `${serverNonce}.${studioNonce}.studio`);
/** The helper's proof that it knows the code: HMAC(code, C.S.server). */
export const serverProof = (code: string, serverNonce: string, studioNonce: string) => hmac(code, `${studioNonce}.${serverNonce}.server`);

/** Two proofs compared in time that doesn't depend on where they differ. */
export function sameProof(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The `hello` event's params (helper to studio, first). */
export interface HelloParams {
  protocol: number;
  nonce: string;
  server: { name: string; version: string };
}

/** The `pair` request's params (studio to helper). */
export interface PairParams {
  protocol: number;
  nonce: string;
  proof: string;
  app: { name: string; version: string };
  permissions: Permissions;
}

/** The `pair` response's result (helper to studio). */
export interface PairResult {
  proof: string;
  server: { name: string; version: string };
  /** The agent's own name for itself, as its MCP client gave it (cut to LIMITS.nameMaxChars). */
  agent?: string;
}

// ---------- Who may connect ----------

/** The published app's origin. */
export const APP_ORIGINS = ['https://fledgetone.com'] as const;
/** The dev server's origins (only with --dev). */
export const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5200', 'http://127.0.0.1:5200'] as const;

/**
 * Whether a page from `origin` may connect: the published app; the `fledgetone studio` page's own
 * origins (passed in `studioOrigins`, Stage 2); the dev server only with `dev`; a page with no
 * origin of its own ("null": a file opened from disk) only with `allowNull`. No Origin header at
 * all (a program, not a browser page) is refused: the studio is always a page.
 */
export function originAllowed(origin: string | undefined | null, opts: { dev?: boolean; allowNull?: boolean; studioOrigins?: readonly string[] } = {}): boolean {
  if (!origin) return false;
  if (origin === 'null') return opts.allowNull === true;
  if ((APP_ORIGINS as readonly string[]).includes(origin)) return true;
  if (opts.studioOrigins?.includes(origin)) return true;
  return opts.dev === true && (DEV_ORIGINS as readonly string[]).includes(origin);
}

/** Whether a request's Host header is this helper's own address, exactly (no other name for 127.0.0.1). */
export const hostAllowed = (host: string | undefined | null, port: number): boolean => host === `127.0.0.1:${port}`;

// ---------- Rates ----------

/** At most `count` takes in any `windowMs`. take() gives 0 when allowed (and counts it), else the ms until one is. */
export class RateLimiter {
  private readonly times: number[] = [];
  readonly count: number;
  readonly windowMs: number;
  constructor(count: number, windowMs: number) {
    this.count = count;
    this.windowMs = windowMs;
  }
  take(now = Date.now()): number {
    while (this.times.length && now - this.times[0] >= this.windowMs) this.times.shift();
    if (this.times.length >= this.count) return this.windowMs - (now - this.times[0]);
    this.times.push(now);
    return 0;
  }
}

/** Text from an agent as the studio shows it: plain text without control or text-direction characters, at most `max` characters. */
export function plainAgentText(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').slice(0, max);
}
