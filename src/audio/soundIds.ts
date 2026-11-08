/**
 * A sound file's id is a hash of its bytes (content addressing: see soundLibrary.ts), so the same
 * bytes always have the same id and an id names one file only. Two forms: the first 128 bits of
 * the bytes' SHA-256 as 32 hex digits, or, in a browser with no crypto (a page not served over
 * https), "fnv" with a pair of FNV hashes and the length.
 *
 * A file from outside (a project, My sounds or "Share this sound" file) says which id each sound
 * it carries has. isSoundOf checks that against the bytes, by the form of the id itself (never by
 * what the browser happens to offer), before the bytes are kept or played under it: checkSounds.
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

/** The SHA-256 form of the bytes' id, or undefined in a browser with no crypto. */
export async function shaSoundId(bytes: ArrayBuffer | Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  const digest = new Uint8Array(await subtle.digest('SHA-256', view(bytes) as Uint8Array<ArrayBuffer>));
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

/** The id of a sound file's bytes, as this browser makes it: the SHA-256 form, or the FNV one where there's no crypto. */
export async function soundIdOf(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  return (await shaSoundId(bytes)) ?? fnvSoundId(bytes);
}

/**
 * Whether `bytes` are the sound `id` names, checked by the id's own form: a SHA-256 id by SHA-256,
 * an FNV id by the FNV pair. Any other id names no bytes (false), and so does a SHA-256 id in a
 * browser with no crypto, where it can't be checked.
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
  if (isFnvSoundId(given) && (await fnvSoundId(bytes)) === given) return given;
  // (a SHA-256 id is right when the bytes' own is the same; where there's no crypto it can't be, so they go under their FNV one)
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
