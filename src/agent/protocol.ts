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
 * HMAC-SHA-256(code, C.S.server.A), and a fresh nonce for any next try. The studio checks that
 * proof against the code it was given: only if it matches does it send `pair_confirm` with
 * HMAC(code, S.C.studio.A), and the helper pairs once that checks out. A is the helper's address,
 * 127.0.0.1:<port>: the port the helper listens on, and the one the studio dialed (pairingAddress),
 * so a program on another port relaying frames to the helper fails the check. So the studio never
 * gives anything about the code to a program that hasn't proved it knows it (a program squatting
 * on the port learns nothing), and nothing about the song goes out before both have proved it.
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
import { LOOK_ALIKE_LETTERS } from './lookAlikes';
import { textName } from './names';

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
 * out of date, withdrawn), the permissions changed, it's leaving, or the musician sent the agent a
 * message (user_message, only when they press Send: see readUserMessage).
 */
export const STUDIO_EVENTS = ['changed', 'view', 'suggestion', 'permissions', 'bye', 'user_message'] as const;
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

/**
 * The address both proofs are bound to: where the helper listens, as the studio dialed it
 * (`127.0.0.1:<port>`). The helper uses the port it actually listens on and the studio the one it
 * actually connected to, so a program on another port that passes frames on to the real helper
 * (a relay) can't make the two proofs agree: pairing through it fails.
 */
export const pairingAddress = (port: number): string => `127.0.0.1:${Math.round(port)}`;

/** The studio's proof that it knows the code: HMAC(code, S.C.studio.address). */
export const studioProof = (code: string, serverNonce: string, studioNonce: string, address: string) => hmac(code, `${serverNonce}.${studioNonce}.studio.${address}`);
/** The helper's proof that it knows the code: HMAC(code, C.S.server.address). */
export const serverProof = (code: string, serverNonce: string, studioNonce: string, address: string) => hmac(code, `${studioNonce}.${serverNonce}.server.${address}`);

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
 * origins (passed in `studioOrigins`, Stage 2); the dev server only with `dev`. Never a page with
 * no origin of its own ("null"): a file opened from disk reads so, but so does any website's
 * sandboxed frame, which could then try codes on the helper (`fledgetone mcp --studio` serves
 * the studio from the helper instead). No Origin header at all (a program, not a browser page)
 * is refused: the studio is always a page.
 */
export function originAllowed(origin: string | undefined | null, opts: { dev?: boolean; studioOrigins?: readonly string[] } = {}): boolean {
  if (!origin || origin === 'null') return false;
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

/** `text` cut to at most `max` UTF-16 units between code points: never half of a surrogate pair at the end. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max));
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * What an agent's text may never hold: controls (C0 but tab and line breaks, DEL, C1), format
 * characters (zero-width ones, direction marks, embeddings, overrides and isolates, tag
 * characters), the other default-ignorable ones (fillers, variation selectors but the two
 * presentation ones, which only pick emoji or text style) and halves of surrogate pairs.
 */
// eslint-disable-next-line no-control-regex
const AGENT_HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}\p{Cs}]|(?![\uFE0E\uFE0F])\p{Default_Ignorable_Code_Point}/gu;

/** Text from an agent as the studio shows it: plain text without control, hidden or text-direction characters, at most `max` characters. */
export function plainAgentText(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  return cutText(
    text
      // (line and paragraph separators as plain line breaks; invisible format characters, as zero-width spaces and direction marks, gone)
      .replace(/[\u2028\u2029]/g, '\n')
      .replace(AGENT_HIDDEN, ''),
    max
  );
}

/**
 * A name or label an agent gives (a track's, a clip's, a marker's), as the song keeps it: plain
 * text by plainAgentText's rule (nothing hidden, no controls or direction characters), on one
 * line (white space as one space), trimmed, at most `max` characters, cut between code points.
 * Empty when nothing visible is left (blank braille and fillers don't count).
 */
export function agentLabel(text: unknown, max: number): string {
  const one = plainAgentText(text, Infinity).replace(/\s+/g, ' ').trim();
  const cut = cutText(one, max).trim();
  return hasVisibleText(cut) ? cut : '';
}

/**
 * More look-alikes than Unicode's confusables data names (LOOK_ALIKE_LETTERS): digits and signs
 * read as letters, i and l alike, small capitals, and letters read as the letter they're mostly
 * seen as. Applied after it, in lower case.
 */
const MORE_LOOK_ALIKES: Record<string, string> = {
  '0': 'o', '1': 'l', '3': 'e', '|': 'l', '!': 'l', i: 'l', ı: 'l', ł: 'l', ƒ: 'f', ſ: 'f', ɢ: 'g', ᴛ: 't', ᴏ: 'o', ᴇ: 'e', ꜰ: 'f', ʟ: 'l', ɴ: 'n', ᴅ: 'd',
  Ғ: 'f', ғ: 'f', И: 'n', г: 'r', н: 'h', т: 't', к: 'k', м: 'm', в: 'b', и: 'n', й: 'n', л: 'n', п: 'n', д: 'd', ԁ: 'd', ԍ: 'g', ɡ: 'g',
  η: 'n', ν: 'v', ι: 'l', κ: 'k', τ: 't', γ: 'y', δ: 'd', ϝ: 'f', ε: 'e', λ: 'l', π: 'n',
  // (the Canadian syllabics "fancy text" writes Latin with)
  ᗩ: 'a', ᗷ: 'b', ᑕ: 'c', ᗪ: 'd', ᗴ: 'e', ᕮ: 'e', ᖴ: 'f', ᘜ: 'g', ᕼ: 'h', ᓰ: 'l', ᒍ: 'j', ᖽ: 'k', ᒪ: 'l', ᗰ: 'm', ᑎ: 'n', ᑭ: 'p', ᑫ: 'q', ᖇ: 'r', ᔕ: 's', ᑌ: 'u', ᐯ: 'v', ᗯ: 'w', '᙭': 'x', ᖻ: 'y', ᘔ: 'z',
  // (signs shaped like letters: money, maths, marks)
  '€': 'e', '∈': 'e', '∊': 'e', $: 's', '@': 'a', '©': 'c', '®': 'r', '∩': 'n', '⋂': 'n', '√': 'v', '⊂': 'c', '∁': 'c', '∂': 'd',
  '₣': 'f', '₦': 'n', '₱': 'p', '₽': 'p', '₸': 't', '₲': 'g', '₳': 'a', '₵': 'c', '†': 't', '‡': 't', '+': 't',
  // (the squares and circles with more than one letter in, which have no decomposition)
  '🆊': 'p', '🆋': 'ic', '🆌': 'pa', '🆍': 'sa', '🆎': 'ab', '🆏': 'wc', '🆑': 'cl', '🆒': 'cool', '🆓': 'free', '🆔': 'id', '🆕': 'new', '🆖': 'ng',
  '🆗': 'ok', '🆘': 'sos', '🆙': 'up', '🆚': 'vs', '🆛': '3d', '🆝': '2k', '🆞': '4k', '🆟': '8k', '🆣': '60p', '🆤': '120p', '🆥': 'd', '🆦': 'hc',
  '🆧': 'hdr', '🆨': 'hires', '🆩': 'lossless', '🆪': 'shv', '🆫': 'uhd', '🆬': 'vod', '🅭': 'cc', '🅮': 'c', '🄋': '0', '🄌': '0', '⓿': '0',
};

/** Letters that read as more than one Latin letter (ƚ as l or t): any letter, as ANY_LETTER, in what text reads as. */
const EITHER_LETTERS = new Set(['ƚ']);

/**
 * The letter (or digits) a letter- or digit-shaped sign stands for whose block has no
 * decomposition: the negative circled and negative squared capitals (🅕, 🅵), the regional
 * indicators (🇫), and the dingbat and double circled digits (❶, ➀, ➊, ⓵) and numbers (❿, ⓫).
 */
function enclosedLetter(c: string): string | undefined {
  const at = c.codePointAt(0) ?? 0;
  const from = (first: number, last: number, base: string): string | undefined =>
    at >= first && at <= last ? String.fromCharCode(base.charCodeAt(0) + at - first) : undefined;
  return (
    from(0x1f150, 0x1f169, 'a') ?? // negative circled
    from(0x1f170, 0x1f189, 'a') ?? // negative squared
    from(0x1f1e6, 0x1f1ff, 'a') ?? // regional indicators
    from(0x2776, 0x277e, '1') ?? // dingbat negative circled
    from(0x2780, 0x2788, '1') ?? // dingbat circled sans-serif
    from(0x278a, 0x2792, '1') ?? // dingbat negative circled sans-serif
    from(0x24f5, 0x24fd, '1') ?? // double circled
    (at >= 0x24eb && at <= 0x24f4 ? String(at - 0x24eb + 11) : undefined) ?? // negative circled 11-20
    ([0x277f, 0x2789, 0x2793, 0x24fe].includes(at) ? '10' : undefined)
  );
}

/** Stands for a letter of any other script in what text reads as (readsAs): it may look like any Latin one. */
export const ANY_LETTER = '?';
/** A letter (of no script's Latin reading) readsAs puts for an EITHER_LETTERS one, so it's ANY_LETTER at the end. */
const EITHER = 'ꙮ';

/**
 * What `text` reads as at a glance: compatibility forms folded (full-width, ligatures), invisible
 * characters and accents dropped, look-alike letters of every script as the Latin ones (Unicode's
 * confusables data, LOOK_ALIKE_LETTERS, and MORE_LOOK_ALIKES: i and l alike), lower case, letters
 * only; a letter of another script that reads as no Latin one, or one that reads as more than one
 * (EITHER_LETTERS), is ANY_LETTER; letter-shaped signs (🅵, 🇫, €) as their letters. For telling text
 * that would pass for the app's name.
 */
export function readsAs(text: string): string {
  return [...text.normalize('NFKD').replace(/[\p{Cf}\p{M}\p{Default_Ignorable_Code_Point}]/gu, '')]
    .map((c) => {
      if (EITHER_LETTERS.has(c)) return EITHER;
      // (signs in blocks with no decomposition first, then this table's own, then Unicode's; a small letter whose capital is a look-alike, as Cherokee's, as that)
      const latin = (enclosedLetter(c) ?? MORE_LOOK_ALIKES[c] ?? LOOK_ALIKE_LETTERS.get(c) ?? LOOK_ALIKE_LETTERS.get(c.toUpperCase()) ?? c).toLowerCase();
      return [...latin].map((x) => MORE_LOOK_ALIKES[x] ?? x).join('');
    })
    .join('')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z\p{L}]/gu, '')
    // (by code point: a letter past the first 65,536 is one letter, not two)
    .replace(/[^a-z]/gu, ANY_LETTER);
}

/** The app's name as text reads (readsAs). */
const APP_READS = 'fledgetone';

/** Whether `text` itself starts with what reads as the app's name (see posesAsApp). */
function startsAsApp(text: string): boolean {
  const reads = readsAs(text);
  if (reads.length < APP_READS.length) return false;
  let same = 0;
  for (let i = 0; i < APP_READS.length; i++) {
    if (reads[i] === APP_READS[i]) same++;
    else if (reads[i] !== ANY_LETTER) return false;
  }
  return same >= 3;
}

/**
 * What can come before a name and still leave it read as the start: symbols, numbers,
 * punctuation, spaces, marks and invisible characters, and the letterlike symbols (ℹ, ™, ℅: some
 * of which are letters to Unicode).
 */
const LEAD = /^[\p{S}\p{N}\p{P}\p{Z}\p{M}\p{Cf}\s\u2100-\u214F]/u;
/** How far into a line's lead a name is looked for, code points. */
const LEAD_MAX = 24;

/** Whether one line starts with the app's name, after any lead of symbols, numbers or punctuation ("ℹ️ ", "1. ", "™ "). */
function lineAsApp(line: string): boolean {
  const chars = [...line];
  for (let i = 0; i <= Math.min(LEAD_MAX, chars.length); i++) {
    // (each place in the lead: a look-alike there, "Ⓕledgetone", is tried as the name's first letter too)
    if (startsAsApp(chars.slice(i).join(''))) return true;
    if (i < chars.length && !LEAD.test(chars[i])) return false;
  }
  return false;
}

/**
 * The app's name at the start of an agent's text, or of any line of it: it could pass for the
 * app speaking. Symbols, numbers, punctuation and spaces in front of it don't hide it ("ℹ️
 * Fledgetone:", "1. Fledgetone"). Each letter must read as the name's (readsAs), but a letter of
 * another script that reads as no Latin one counts as any letter (a look-alike no table names), as
 * long as at least three of them read as the name's own (and none as another letter): text in
 * another script altogether is never taken for the name.
 */
export function posesAsApp(text: string): boolean {
  return text.split(/[\n\r\u2028\u2029]/).some(lineAsApp);
}

/**
 * Text from an agent made safe to show as the agent's (plainAgentText, trimmed): each line that
 * starts with the app's name (posesAsApp) is shown in quotes, so it never reads as the app's own words.
 */
export function fromAgent(text: unknown, max: number): string {
  const plain = plainAgentText(text, max).replace(/\s+/g, (w) => (w.includes('\n') ? w : ' ')).trim();
  if (!posesAsApp(plain)) return plain;
  return plain
    .split('\n')
    .map((line) => (lineAsApp(line) ? `“${line.trim()}”` : line))
    .join('\n');
}

/** The longest agent name shown. */
export const AGENT_NAME_MAX = 40;

/**
 * An agent's name for itself as the studio shows it: plain, on one line, without quote or bracket
 * characters (so it can't close the "(…)" or the quotes the studio's words put it in: names.ts
 * textName), at most AGENT_NAME_MAX characters; none (the studio says "your agent") if it's empty
 * or starts with the app's name.
 */
export function agentName(text: unknown): string | undefined {
  const named = textName(plainAgentText(text, 200));
  const plain = cutText(named === '…' ? '' : named, AGENT_NAME_MAX).trim();
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

// ---------- The conversation ----------

/**
 * The musician's side of the conversation: what they write to their agent on the Suggestions
 * panel. Kept in memory only, on both ends (never saved with the song or to disk): the studio
 * keeps it for the tab, the helper until the studio disconnects.
 */
export const CONVERSATION = {
  /** A message the musician writes: at most this many characters. */
  textMaxChars: 2_000,
  /** Messages kept each way (the oldest go first). */
  keep: 200,
  /** get_messages gives at most this many at a time. */
  pageMax: 50,
  /** How long the studio waits for the helper to say it has a message, else it's "Not sent", ms. */
  ackMs: 5_000,
  /** Clips listed in a message's context, at most. */
  contextClips: 50,
} as const;

/** What the musician chose to send along with a message ("Include what I've selected"). */
export interface UserMessageContext {
  selectedTrackId?: string;
  selectedClipIds?: string[];
  editingClipId?: string;
  /** The bars the selected clips cover (song bars, toBar not included). */
  bars?: { fromBar: number; toBar: number };
}

/** The `user_message` event's params (studio to helper): one message the musician sent. */
export interface UserMessage {
  id: string;
  text: string;
  /** When it was written (ms since 1970). */
  at: number;
  /** The suggestion it asks about ("Ask about this" on a card). */
  suggestionId?: string;
  context?: UserMessageContext;
}

/** The helper's event (helper to studio) telling the studio it has the musician's messages (`received`), or the agent has read them (`seen`). */
export const USER_MESSAGE_STATUS = 'user_message_status';
export interface UserMessageStatusParams {
  ids: string[];
  status: 'received' | 'seen';
}

const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const shortId = (v: unknown) => (typeof v === 'string' && MESSAGE_ID.test(v) ? v : undefined);
/**
 * A track's or clip's id in a message's context, as the agent reads it (agentIds in agentText.ts):
 * letters, digits and - _ . : + (a song file's ids can hold them), and the alias of an id that held
 * hidden text ("clip-3~1a2b3c", with a counter "-2" at the most).
 */
const CONTEXT_ID = /^[A-Za-z0-9_.:+-]{1,128}(~[0-9a-f]{6,16}(-[0-9]{1,4})?)?$/;
const contextId = (v: unknown) => (typeof v === 'string' && CONTEXT_ID.test(v) ? v : undefined);
const bar = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 10_000 ? v : undefined);

/** A message's context as either end keeps it: only the fields it may have, ids checked (CONTEXT_ID), at most CONVERSATION.contextClips clips. Undefined if nothing is left. */
export function readContext(c: unknown): UserMessageContext | undefined {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return undefined;
  const o = c as Record<string, unknown>;
  const out: UserMessageContext = {};
  const track = contextId(o.selectedTrackId);
  if (track) out.selectedTrackId = track;
  if (Array.isArray(o.selectedClipIds)) {
    const clips = o.selectedClipIds.map(contextId).filter((x): x is string => !!x).slice(0, CONVERSATION.contextClips);
    if (clips.length) out.selectedClipIds = clips;
  }
  const editing = contextId(o.editingClipId);
  if (editing) out.editingClipId = editing;
  const b = o.bars as Record<string, unknown> | undefined;
  const from = bar(b?.fromBar);
  const to = bar(b?.toBar);
  if (from !== undefined && to !== undefined && to > from) out.bars = { fromBar: from, toBar: to };
  return Object.keys(out).length ? out : undefined;
}

const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const BLANK_BRAILLE = '\u2800';
/** A braille cell with dots (the blank one doesn't count). */
const isBraille = (c: string | undefined) => !!c && c > '\u2800' && c <= '\u28ff';
/** A character that shows by itself (a base for a variation selector, a neighbour for a joiner or a mark). */
const showsAlone = (c: string | undefined) => !!c && !/\s/u.test(c) && !INVISIBLE.test(c) && !CONTROL.test(c) && c !== BLANK_BRAILLE;
/** The end of something visible: a character that shows, or what hangs on one (a combining mark, a presentation selector). */
const visibleEnd = (c: string | undefined) => showsAlone(c) || (!!c && (/\p{M}/u.test(c) || c === '\uFE0E' || c === '\uFE0F'));
/** The flags made of tag sequences that exist (England, Scotland, Wales): their tag letters. */
const TAG_FLAGS = new Set(['gbeng', 'gbsct', 'gbwls']);
const JOINERS = new Set([0x200c, 0x200d]);
/** A letter of a script whose letters join (Arabic, Syriac, N'Ko, Mongolian, Adlam, Hanifi Rohingya). */
const JOINING_LETTER = /^[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}]$/u;
const MARKS = new Set([0x200e, 0x200f, 0x061c]);

/**
 * The musician's own text made plain (at most `max` characters), so the agent gets exactly what
 * the musician sees: control characters and every invisible or format character go (tag
 * characters, word joiners, soft hyphens, byte order marks, fillers, direction embeddings,
 * overrides and isolates), line and paragraph separators become line breaks. Kept, because writing
 * needs them, and only where they do something:
 *
 * - a joiner (U+200C, U+200D: emoji sequences, Persian and Indic words), one at a time, between
 *   two visible characters; a ZWJ also right after a letter of a joining script (Arabic, Syriac,
 *   N'Ko, Mongolian, Adlam, Hanifi Rohingya), before a space or the end, for a joined form;
 * - a direction mark (LRM, RLM, ALM), one at a time, next to something visible;
 * - an emoji or text presentation selector (U+FE0F, U+FE0E) right after a character that shows;
 * - the flags of England, Scotland and Wales (a black flag, their tag letters, a cancel tag): any
 *   other tag sequence leaves the plain black flag;
 * - a blank braille cell only next to a braille cell with dots.
 */
export function plainUserText(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  const cps = [...text.replace(/[\u2028\u2029]/g, '\n')];
  const out: string[] = [];
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    const cp = c.codePointAt(0)!;
    const prev = out.at(-1);
    const next = cps[i + 1];
    // (and a half of a surrogate pair, alone: it shows as a box, if at all)
    if (CONTROL.test(c) || (cp >= 0xd800 && cp <= 0xdfff)) continue;
    if (cp === 0x1f3f4) {
      let j = i + 1;
      while (j < cps.length && cps[j].codePointAt(0)! >= 0xe0020 && cps[j].codePointAt(0)! <= 0xe007e) j++;
      const tags = cps.slice(i + 1, j).map((t) => String.fromCodePoint(t.codePointAt(0)! - 0xe0000)).join('');
      if (cps[j]?.codePointAt(0) === 0xe007f && TAG_FLAGS.has(tags)) {
        out.push(...cps.slice(i, j + 1));
        i = j;
        continue;
      }
      // (another sequence: the plain flag, its tags left out with every other tag character)
      out.push(c);
      continue;
    }
    if (cp === 0xfe0e || cp === 0xfe0f) {
      if (showsAlone(prev)) out.push(c);
      continue;
    }
    if (JOINERS.has(cp)) {
      // (a ZWJ after a letter of a joining script keeps it in its joined form, even at a word's end: Arabic abbreviations)
      if ((visibleEnd(prev) && showsAlone(next)) || (cp === 0x200d && JOINING_LETTER.test(prev ?? '') && !JOINERS.has(next?.codePointAt(0) ?? -1))) out.push(c);
      continue;
    }
    if (MARKS.has(cp)) {
      if (!MARKS.has(prev?.codePointAt(0) ?? -1) && (visibleEnd(prev) || showsAlone(next))) out.push(c);
      continue;
    }
    if (c === BLANK_BRAILLE) {
      if (isBraille(prev) || isBraille(next)) out.push(c);
      continue;
    }
    if (INVISIBLE.test(c)) continue;
    out.push(c);
  }
  return cutText(out.join(''), max);
}

/** Whether text has anything to see (not only spaces and invisible characters, blank braille among them). */
export const hasVisibleText = (text: string): boolean => /[^\s\p{Cf}\p{M}\p{Default_Ignorable_Code_Point}\u2800]/u.test(text);

/**
 * A `user_message` event's params as both ends keep them, or null if it isn't one: an id of
 * letters, digits, - and _; the text plain (plainUserText), trimmed, with something visible in
 * it, at most CONVERSATION.textMaxChars; a time; the suggestion's id and the context only if
 * they're well formed (anything else is left out).
 */
export function readUserMessage(p: unknown): UserMessage | null {
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  const id = shortId(o.id);
  const text = plainUserText(o.text, CONVERSATION.textMaxChars).trim();
  if (!id || !hasVisibleText(text) || typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
  const suggestionId = shortId(o.suggestionId);
  const context = readContext(o.context);
  return { id, text, at: o.at, ...(suggestionId ? { suggestionId } : {}), ...(context ? { context } : {}) };
}
