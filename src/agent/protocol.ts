/**
 * The local connection between the studio (a browser tab) and the agent's helper (`fledgetone
 * mcp`, a program on the same computer): its messages, pairing, which pages may connect, and its
 * limits. Shared by both ends, so it runs in the browser and in Node (Web Crypto only, through
 * globalThis.crypto).
 *
 * Messages are JSON text frames: `{ v: 1, id, kind: 'req' | 'res' | 'event', method, params }`,
 * a response carrying the request's id and `result` or `error: { code, message }`.
 *
 * Pairing (once per connection, before anything else): the helper shows the agent a 12-character
 * code (K7QM-3XPD-9TBW, 60 bits), the agent asks the musician to type it in the studio. Neither
 * end ever sends the code. The helper opens with a `hello` event carrying its nonce S. The studio
 * sends a `pair` request with its nonce C and no proof; the helper answers with its own proof,
 * HMAC-SHA-256(code, C.S.server), and a fresh nonce for any next try. The studio checks that
 * proof against the code it was given: only if it matches does it send `pair_confirm` with
 * HMAC(code, S.C.studio), and the helper pairs once that checks out. So the studio never gives
 * anything about the code to a program that hasn't proved it knows it (a program squatting on
 * the port learns nothing), and nothing about the song goes out before both have proved it.
 *
 * Without a PAKE, one side has to prove first, and its proof could be guessed at offline: here
 * that's the helper, to whatever connects. It answers at most five tries a connection and twenty
 * a code (the budget is taken before any HMAC is worked out, one at a time), a code lasts ten
 * minutes, and 60 bits is far beyond guessing in that time.
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
  /** Tries to pair on one connection before it's closed. */
  triesPerConnection: 5,
  /** Tries to pair in all before the code is retired (the agent asks for a new one). */
  triesPerCode: 20,
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

/**
 * The code's letters: Crockford's base 32 (digits and capitals without I, L, O and U), so it
 * reads aloud and types cleanly; typed O is read as 0, and I or L as 1.
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 12 letters of 32: 60 bits. */
export const CODE_LENGTH = 12;

const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** A new pairing code, shown as "K7QM-3XPD-9TBW". */
export function newPairingCode(): string {
  // 32 letters: each random byte's low five bits are one, equally likely
  const out = [...random(CODE_LENGTH)].map((b) => CODE_ALPHABET[b & 31]).join('');
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

/** A code as typed ("k7qm 3xpd 9tbw", "K7QM-3XPD-9TBW") in its plain form ("K7QM3XPD9TBW"), or null if it can't be one. */
export function normalizeCode(text: string): string | null {
  const plain = text.toUpperCase().replace(/[\s-]+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
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

/** The `pair` request's params (studio to helper): the studio's nonce, no proof yet. */
export interface PairParams {
  protocol: number;
  nonce: string;
  app: { name: string; version: string };
  permissions: Permissions;
}

/** The `pair` response's result: the helper's proof for this try, and its nonce for the next one. */
export interface PairChallenge {
  proof: string;
  nonce: string;
  attemptsLeft: number;
}

/** The `pair_confirm` request's params (studio to helper, once the helper's proof checked out). */
export interface ConfirmParams {
  proof: string;
}

/** The `pair_confirm` response's result (helper to studio): paired. */
export interface PairResult {
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
  return (
    text
      // (line and paragraph separators as plain line breaks; invisible format characters, as zero-width spaces and direction marks, gone)
      .replace(/[\u2028\u2029]/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Cf}]/gu, '')
      .slice(0, max)
  );
}

/** Letters that look like Latin ones (Cyrillic, Greek, digits and the like), as those letters. */
const LOOK_ALIKES: Record<string, string> = {
  а: 'a', е: 'e', ё: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', т: 't', н: 'h', м: 'm', в: 'b', г: 'r', ԁ: 'd', ԍ: 'g', ɡ: 'g', ӏ: 'l', і: 'l', ї: 'l', ј: 'j', ѕ: 's', ԛ: 'q', ԝ: 'w', һ: 'h',
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'l', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', γ: 'y', δ: 'd',
  '0': 'o', '1': 'l', '3': 'e', '|': 'l', i: 'l', ı: 'l', ł: 'l', ƒ: 'f', ſ: 'f', ɢ: 'g', ᴛ: 't', ᴏ: 'o', ᴇ: 'e', ꜰ: 'f', ʟ: 'l', ɴ: 'n', ᴅ: 'd',
};

/**
 * What `text` reads as at a glance: compatibility forms folded (full-width, ligatures), invisible
 * characters and accents dropped, look-alike letters as the Latin ones (i and l alike), lower
 * case, letters only. For telling text that would pass for the app's name.
 */
export function readsAs(text: string): string {
  return [
    ...text
      .normalize('NFKD')
      .replace(/[\p{Cf}\p{M}]/gu, '')
      .toLowerCase(),
  ]
    .map((c) => LOOK_ALIKES[c] ?? c)
    .join('')
    .replace(/[^a-z]/g, '');
}

/** The app's own name at the start of an agent's text: it could pass for the app speaking. */
const posesAsApp = (text: string) => readsAs(text).startsWith(readsAs('Fledgetone'));

/**
 * Text from an agent made safe to show as the agent's (plainAgentText, trimmed): text that starts
 * with the app's name is shown in quotes, so it never reads as the app's own words.
 */
export function fromAgent(text: unknown, max: number): string {
  const plain = plainAgentText(text, max).replace(/\s+/g, (w) => (w.includes('\n') ? w : ' ')).trim();
  return posesAsApp(plain) ? `“${plain}”` : plain;
}

/** The longest agent name shown. */
export const AGENT_NAME_MAX = 40;

/**
 * An agent's name for itself as the studio shows it: plain, on one line, at most AGENT_NAME_MAX
 * characters; none (the studio says "your agent") if it's empty or starts with the app's name.
 */
export function agentName(text: unknown): string | undefined {
  const plain = plainAgentText(text, 200).replace(/\s+/g, ' ').trim().slice(0, AGENT_NAME_MAX).trim();
  return plain && !posesAsApp(plain) ? plain : undefined;
}

/**
 * What's typed or pasted in the code field, as it's shown there: a label in front ("Code: ...")
 * dropped, O read as 0 and I or L as 1, anything else not in the code's letters left out, at most
 * CODE_LENGTH of them, grouped in fours ("K7QM-3XPD-9TBW").
 */
export function typedCode(text: string): string {
  // (a code never has a colon in it, nor starts with the word "code")
  const unlabelled = (text.includes(':') ? text.slice(text.lastIndexOf(':') + 1) : text).replace(/^\s*(pairing\s+)?code\b\s*[=-]?/i, '');
  const plain = [...unlabelled.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')].filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, CODE_LENGTH);
  return plain.replace(/(.{4})(?=.)/g, '$1-');
}
