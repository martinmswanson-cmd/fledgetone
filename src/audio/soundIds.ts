/**
 * A sound file's id is a hash of its bytes (content addressing: see soundLibrary.ts), so the same
 * bytes always have the same id and an id names one file only. Two forms: the first 128 bits of
 * the bytes' SHA-256 as 32 hex digits, or, in a browser with no crypto (a page not served over
 * https), "fnv" with a pair of FNV hashes and the length.
 *
 * A file from outside (a project, My sounds or "Share this sound" file) says which id each sound
 * it carries has. isSoundOf checks that against the bytes, by the form of the id itself (never by
 * what the browser happens to offer), before the bytes are kept or played under it: checkSounds.
 * Every browser can check both forms: where there's no crypto, the SHA-256 is worked out here (sha256).
 */
import { withSoundsMoved, type SoundHolders } from '../store/audioClips';
import type { EmbeddedSound } from '../store/timelineTypes';

/** 32 lowercase hex digits: the SHA-256 form. */
export const isShaSoundId = (id: string): boolean => /^[0-9a-f]{32}$/.test(id);

/** "fnv", two 8-digit hashes and the length in hex: the form made where the browser has no crypto. */
export const isFnvSoundId = (id: string): boolean => /^fnv[0-9a-f]{16}(0|[1-9a-f][0-9a-f]*)$/.test(id);

/** Bytes hashed at a time for the FNV pair, before the page gets a turn (a few milliseconds' work). */
const FNV_SLICE = 1 << 22;

/** Wait for the next task (not throttled in a background tab, unlike a timer). */
const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });

const view = (bytes: ArrayBuffer | Uint8Array): Uint8Array => (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

// ---------- SHA-256, for a browser with no crypto ----------

/** SHA-256's round constants (FIPS 180-4, 4.2.2). */
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Bytes put through SHA-256 at a time here, before the page gets a turn (a few milliseconds' work; a multiple of 64). */
const SHA_SLICE = 1 << 20;

/** SHA-256's compression of the 64-byte blocks of `d` from `from` to `to` into the state `h` (`w`: room for the message schedule). */
function shaBlocks(h: Int32Array, w: Int32Array, d: DataView, from: number, to: number): void {
  let h0 = h[0], h1 = h[1], h2 = h[2], h3 = h[3], h4 = h[4], h5 = h[5], h6 = h[6], h7 = h[7];
  for (let p = from; p < to; p += 64) {
    let a = h0, b = h1, c = h2, k = h3, e = h4, f = h5, g = h6, l = h7;
    for (let i = 0; i < 64; i++) {
      // (the message schedule worked out as the rounds go: a third quicker than beforehand, in V8)
      let wi: number;
      if (i < 16) wi = d.getInt32(p + i * 4);
      else {
        const x = w[i - 15];
        const y = w[i - 2];
        wi = (w[i - 16] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w[i - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      }
      w[i] = wi;
      const t1 = (l + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + wi) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      l = g;
      g = f;
      f = e;
      e = (k + t1) | 0;
      k = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + k) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + l) | 0;
  }
  h.set([h0, h1, h2, h3, h4, h5, h6, h7]);
}

/**
 * The bytes' SHA-256 (all 32 bytes of it), worked out here (FIPS 180-4) a slice at a time, so a
 * big file doesn't hold up the page: what a browser with no crypto checks a SHA-256 id with.
 */
export async function sha256(bytes: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const data = view(bytes);
  const h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Int32Array(64);
  const whole = data.length - (data.length % 64);
  const words = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = 0; at < whole; at += SHA_SLICE) {
    if (at) await nextTask();
    shaBlocks(h, w, words, at, Math.min(whole, at + SHA_SLICE));
  }
  // The last bytes, then 0x80, zeros and the length in bits (64 bits, high word first): one block or two
  const rest = data.length - whole;
  const tail = new Uint8Array(rest + 9 <= 64 ? 64 : 128);
  tail.set(data.subarray(whole));
  tail[rest] = 0x80;
  const last = new DataView(tail.buffer);
  last.setUint32(tail.length - 8, Math.floor(data.length / 0x20000000));
  last.setUint32(tail.length - 4, (data.length * 8) >>> 0);
  shaBlocks(h, w, last, 0, tail.length);
  const out = new Uint8Array(32);
  const digest = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) digest.setInt32(i * 4, h[i]);
  return out;
}

/** Whether this browser has crypto (a page served over https, or on this computer): what makes SHA-256 ids. */
const hasCrypto = (): boolean => !!globalThis.crypto?.subtle;

/** The SHA-256 form of the bytes' id: by the browser's crypto, or, where there's none, by sha256 here. */
export async function shaSoundId(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle ? new Uint8Array(await subtle.digest('SHA-256', view(bytes) as Uint8Array<ArrayBuffer>)) : await sha256(bytes);
  return Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The FNV form of the bytes' id (worked out a slice at a time, so a big file doesn't hold up the page). */
export async function fnvSoundId(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = view(bytes);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let at = 0; at < data.length; at += FNV_SLICE) {
    if (at) await nextTask();
    const end = Math.min(data.length, at + FNV_SLICE);
    for (let i = at; i < end; i++) {
      a = Math.imul(a ^ data[i], 0x01000193) >>> 0;
      b = Math.imul(b ^ data[i], 0x9e3779b1) >>> 0;
    }
  }
  return `fnv${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${data.length.toString(16)}`;
}

/**
 * The id of a sound file's bytes, as this browser makes it: the SHA-256 form, or the FNV one where
 * there's no crypto. (Not the SHA-256 worked out here: every sound such a browser already keeps is
 * under its FNV id, and the same file loaded again has to come to the same id to find its copy.)
 */
export async function soundIdOf(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  return hasCrypto() ? shaSoundId(bytes) : fnvSoundId(bytes);
}

/**
 * Whether `bytes` are the sound `id` names, checked by the id's own form: a SHA-256 id by SHA-256
 * (in any browser), an FNV id by the FNV pair. Any other id names no bytes (false).
 */
export async function isSoundOf(id: string, bytes: ArrayBuffer | Uint8Array): Promise<boolean> {
  if (isShaSoundId(id)) return (await shaSoundId(bytes)) === id;
  if (isFnvSoundId(id)) return (await fnvSoundId(bytes)) === id;
  return false;
}

/**
 * The id bytes from a file are kept under, given the id the file gave them: that one when it names
 * them (checked by its own form, as isSoundOf does), else the id this browser makes for them.
 */
export async function ownSoundId(given: string, bytes: ArrayBuffer | Uint8Array): Promise<string> {
  // (each hash worked out once: the one that checks the given id is this browser's own, where it makes that form)
  if (isShaSoundId(given)) {
    const sha = await shaSoundId(bytes);
    return sha === given ? given : hasCrypto() ? sha : fnvSoundId(bytes);
  }
  if (isFnvSoundId(given)) {
    const fnv = await fnvSoundId(bytes);
    return fnv === given ? given : hasCrypto() ? shaSoundId(bytes) : fnv;
  }
  return soundIdOf(bytes);
}

// ---------- sounds a file carries ----------

/** Base64 characters decoded at a time, before the page gets a turn (a few milliseconds' work; a multiple of 4). */
const BASE64_SLICE = 1 << 20;

const fromBase64 = (Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array }).fromBase64;

/** One slice of base64 decoded (throws if it isn't base64). */
function decodeSlice(text: string): Uint8Array {
  if (fromBase64) return fromBase64(text);
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Base64 text decoded a slice at a time, so a big sound doesn't hold up the page (a data: URL
 * fetch of a 30 MB sound held it up for about 300 ms at a time); undefined when it isn't base64.
 */
export async function base64Bytes(text: string): Promise<Uint8Array | undefined> {
  const plain = /[\t\n\f\r ]/.test(text) ? text.replace(/[\t\n\f\r ]+/g, '') : text;
  // (padding only at the very end, as one piece of base64 has it)
  const pad = plain.indexOf('=');
  if (pad !== -1 && pad < plain.length - 2) return undefined;
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (let at = 0; at < plain.length; at += BASE64_SLICE) {
      if (at) await nextTask();
      const part = decodeSlice(plain.slice(at, at + BASE64_SLICE));
      parts.push(part);
      size += part.length;
    }
  } catch {
    return undefined;
  }
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(size);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

/** The bytes a file carries for a sound (its base64), or undefined when they can't be read. */
export async function carriedBytes(sound: EmbeddedSound): Promise<ArrayBuffer | undefined> {
  const bytes = await base64Bytes(sound.data);
  if (!bytes) return undefined;
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
}

/** The sounds checkSounds has returned (each as it returned it): their bytes are what their ids say, so they need no second look. */
const checkedSounds = new WeakSet<EmbeddedSound>();

/** Whether `sound` is one checkSounds returned (so its bytes are what its id says). */
export const isCheckedSound = (sound: EmbeddedSound): boolean => checkedSounds.has(sound);

/**
 * A file's sounds with their bytes checked against their ids, before anything keeps or plays
 * them. One whose bytes are what its id says comes back as it is. One whose bytes aren't (a file
 * made by hand, or made to put other bytes under the id of a sound people have) comes back under
 * the id of its own bytes, and `moved` maps the id the file gave it to that one, so the song can be
 * pointed at it (withSoundsMoved) and play what it was made with. One whose bytes can't be read is
 * left out. Nothing comes back under an id that doesn't name its bytes.
 */
export async function checkSounds(sounds: readonly EmbeddedSound[]): Promise<{ sounds: EmbeddedSound[]; moved: Map<string, string> }> {
  const checked: Array<{ given: string; sound: EmbeddedSound; same: boolean }> = [];
  for (const sound of sounds) {
    if (checkedSounds.has(sound)) {
      checked.push({ given: sound.id, sound, same: true });
      continue;
    }
    try {
      const bytes = await carriedBytes(sound);
      if (!bytes) continue;
      const id = await ownSoundId(sound.id, bytes);
      const sure: EmbeddedSound = Object.freeze({ ...sound, id, size: bytes.byteLength });
      checkedSounds.add(sure);
      checked.push({ given: sound.id, sound: sure, same: id === sound.id });
    } catch {
      // (Can't be checked: left out, as unreadable)
    }
  }
  // An id one of the file's sounds truly has stays (another entry under it with other bytes goes nowhere)
  const right = new Set(checked.filter((c) => c.same).map((c) => c.given));
  const moved = new Map<string, string>();
  const out: EmbeddedSound[] = [];
  const ids = new Set<string>();
  for (const c of checked) {
    if (!c.same) {
      if (right.has(c.given)) continue;
      if (!moved.has(c.given)) moved.set(c.given, c.sound.id);
      // (two entries under one made-up id with different bytes: the first is the one the song gets)
      if (moved.get(c.given) !== c.sound.id) continue;
    }
    if (ids.has(c.sound.id)) continue;
    ids.add(c.sound.id);
    out.push(c.sound);
  }
  return { sounds: out, moved };
}

/**
 * A song (or anything that plays sounds and carries them) with those sounds checked (checkSounds)
 * and every reference to one that moved pointed at its new id: what opening a file does before
 * the song is used.
 */
export async function withCheckedSounds<T extends SoundHolders & { sounds?: EmbeddedSound[] }>(p: T): Promise<T> {
  if (!p.sounds?.length) return p;
  const { sounds, moved } = await checkSounds(p.sounds);
  return withSoundsMoved({ ...p, sounds }, moved);
}
