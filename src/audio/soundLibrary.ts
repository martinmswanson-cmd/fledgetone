/**
 * The user's own sound files (audio clips, the Sampler, the Slicer, the Drum Rack and the Multi
 * Sampler). They're kept in this browser's IndexedDB under a hash of their bytes, decoded once per
 * sample rate, measured for waveform peaks in idle time, cached as time-stretched or warped
 * copies, and embedded into saved project files.
 */
import { create } from 'zustand';
import { liveMix } from './engine';
import { createPeaks, fillPeaks } from './waveform';
import { STRETCH_VERSION, type StretchPiece } from './timeStretch';
import { DspDropped, runDsp } from './dspRun';
import { beatAt, warpKey, warpPieces } from '../store/warp';
import type { Peaks } from './waveform';
import type { ClipAudio, CustomSample, EmbeddedSound, SoundMeta } from '../store/timelineTypes';

export type { EmbeddedSound, SoundMeta };

/**
 * The user's own sound files: audio clips, the Slicer's sound and the Sampler's. They live in the
 * browser's IndexedDB, keyed by a hash of their bytes, so a file loaded twice (or used by several
 * tracks or projects) is stored once, and projects only hold the ids: browser autosave has about
 * 5 MB for a whole project, and a sound file alone can be ten times that. A saved .fledgetone.json
 * embeds the files it uses (see embedSounds), and opening one puts them back here.
 *
 * Each sound is decoded once per sample rate (the live context's, and the WAV export's) and the
 * decoded buffer shared by every player; its waveform peaks are worked out once, in idle moments.
 */
/** What the library knows of a sound: being read, decoded and measured; ready; not in this browser; or unreadable. */
export type SoundStatus = 'loading' | 'ready' | 'missing' | 'error';

interface SoundLibraryState {
  metas: Record<string, SoundMeta>;
  status: Record<string, SoundStatus>;
  peaks: Record<string, Peaks>;
}

/** The sounds this page has met: their meta, state and waveform peaks (immutable records, for React). */
export const useSoundLibrary = create<SoundLibraryState>(() => ({ metas: {}, status: {}, peaks: {} }));

/** Biggest file that can be loaded: a few minutes of WAV. */
export const MAX_SOUND_BYTES = 50 * 1024 * 1024;

/** The file picker's filter: anything the browser might decode. */
export const AUDIO_FILE_ACCEPT = 'audio/*,.wav,.mp3,.ogg,.oga,.m4a,.aac,.flac,.aif,.aiff,.webm';

/** An error whose message is meant for the user (a toast or an inspector notice). */
export class SoundError extends Error {}

const megabytes = (bytes: number) => (bytes / 1048576).toFixed(1);

const setStatus = (id: string, status: SoundStatus) =>
  useSoundLibrary.setState((s) => (s.status[id] === status ? s : { status: { ...s.status, [id]: status } }));
const setMeta = (meta: SoundMeta) => useSoundLibrary.setState((s) => (s.metas[meta.id] === meta ? s : { metas: { ...s.metas, [meta.id]: meta } }));
const setPeaks = (id: string, peaks: Peaks) => useSoundLibrary.setState((s) => ({ peaks: { ...s.peaks, [id]: peaks } }));

/** What to tell the user in place of a sound that isn't ready: its status in words. */
export function soundStatusText(status: SoundStatus | undefined): string {
  if (status === 'missing') return 'Sound not in this browser';
  if (status === 'error') return "Can't read this sound";
  return 'Loading sound…';
}

/** A sound's status, or undefined when the library hasn't been asked about it yet. */
export const soundStatus = (id: string): SoundStatus | undefined => useSoundLibrary.getState().status[id];

/** How long a sound is, in seconds, if the library has read its meta. */
export const soundSeconds = (id: string): number | undefined => useSoundLibrary.getState().metas[id]?.seconds;

// ---------- IndexedDB ----------

const DB_NAME = 'bos-beat-box';
const DB_VERSION = 1;
const META_STORE = 'sound-meta';
const DATA_STORE = 'sound-data';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the database closes this connection: open again next time
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB blocked'));
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise = promise;
  // A failure (private mode, storage disabled) is tried again on the next use
  promise.catch(() => {
    if (dbPromise === promise) dbPromise = null;
  });
  return promise;
}

const request = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const completed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });

async function readStoredMeta(id: string): Promise<SoundMeta | undefined> {
  const db = await openDb();
  return request(db.transaction(META_STORE).objectStore(META_STORE).get(id) as IDBRequest<SoundMeta | undefined>);
}

async function readStoredData(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  return request(db.transaction(DATA_STORE).objectStore(DATA_STORE).get(id) as IDBRequest<Blob | undefined>);
}

async function writeStoredSound(meta: SoundMeta, data: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
  tx.objectStore(META_STORE).put(meta);
  tx.objectStore(DATA_STORE).put(data, meta.id);
  await completed(tx);
}

/** Keep any other file in this browser under `key` (the reference video: see videoStore). */
export async function storeBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(DATA_STORE, 'readwrite');
  tx.objectStore(DATA_STORE).put(blob, key);
  await completed(tx);
}

export async function readBlob(key: string): Promise<Blob | undefined> {
  return readStoredData(key);
}

export async function deleteBlob(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(DATA_STORE, 'readwrite');
  tx.objectStore(DATA_STORE).delete(key);
  await completed(tx);
}

/** Every sound kept in this browser (its meta, not its bytes). */
export async function storedSounds(): Promise<SoundMeta[]> {
  const db = await openDb();
  return request(db.transaction(META_STORE).objectStore(META_STORE).getAll() as IDBRequest<SoundMeta[]>);
}

async function deleteStoredSounds(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
  for (const id of ids) {
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(DATA_STORE).delete(id);
  }
  await completed(tx);
}

// ---------- hashing ----------

/** The id of a file's bytes: SHA-256 (the first 128 bits), or a pair of FNV hashes where the browser has no crypto. */
async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    return Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  const data = new Uint8Array(bytes);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    a = Math.imul(a ^ data[i], 0x01000193) >>> 0;
    b = Math.imul(b ^ data[i], 0x9e3779b1) >>> 0;
  }
  return `fnv${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${data.length.toString(16)}`;
}

// ---------- decoding ----------

const decoders = new Map<number, OfflineAudioContext>();

/** A context at `sampleRate` used only to decode (the browser resamples the file to it). */
function decoderFor(sampleRate: number): OfflineAudioContext {
  let decoder = decoders.get(sampleRate);
  if (!decoder) decoders.set(sampleRate, (decoder = new OfflineAudioContext(1, 1, sampleRate)));
  return decoder;
}

/** Decode a file's bytes to `sampleRate` (the bytes are consumed: pass a copy if they're needed again). */
const decodeBytes = (bytes: ArrayBuffer, sampleRate: number): Promise<AudioBuffer> => decoderFor(sampleRate).decodeAudioData(bytes);

/** The live context's sample rate: what sounds are decoded to for playback and their waveforms. */
const liveSampleRate = (): number => liveMix.bus.context.sampleRate;

const decoded = new Map<string, Promise<AudioBuffer>>();
/** The buffers decodeSound has finished: players read these the moment a note or clip starts. */
const decodedBuffers = new Map<string, AudioBuffer>();
const decodeKey = (id: string, sampleRate: number) => `${id}|${sampleRate}`;

/**
 * Forget decoded copies of sounds nothing uses any more (`keep`: the ids in use): decoded audio is
 * ten times the size of the file it came from. They're decoded again if needed. Returns the bytes freed.
 */
export function forgetDecodedSounds(keep: Set<string>): number {
  let bytes = 0;
  for (const [key, buffer] of stretchedBuffers) {
    if (keep.has(key.split('|')[0])) continue;
    bytes += buffer.length * buffer.numberOfChannels * 4;
    stretchedBuffers.delete(key);
    stretching.delete(key);
  }
  for (const [key, buffer] of decodedBuffers) {
    if (keep.has(key.split('|')[0])) continue;
    bytes += buffer.length * buffer.numberOfChannels * 4;
    decodedBuffers.delete(key);
    decoded.delete(key);
  }
  // (warped copies too: their keys start with the sound's id the same way)
  for (const [key, buffer] of warpedBuffers) {
    if (keep.has(key.split('|')[0])) continue;
    bytes += buffer.length * buffer.numberOfChannels * 4;
    warpedBuffers.delete(key);
    warping.delete(key);
  }
  return bytes;
}

/**
 * Sound files from an opened project that aren't in the library: while they're being stored, or
 * for good when the browser won't keep them (its storage full or blocked). Playing and saving use
 * these meanwhile, so a Save straight after Open, or in a browser that keeps nothing, still has
 * every sound the file had.
 */
const unstored = new Map<string, EmbeddedSound>();

/**
 * Let go of the held copies (see `unstored`) of sounds no longer needed: those not in `keep`
 * (the song now open, the one the Restore banner offers, the clipboard). In a browser that
 * stores nothing, each file opened would otherwise stay in memory for as long as the page is open.
 */
export function letGoHeldSounds(keep: ReadonlySet<string>): void {
  for (const id of [...unstored.keys()]) if (!keep.has(id)) unstored.delete(id);
}

/** How many sounds are held in memory for want of storage (for tests). */
export const heldSoundCount = (): number => unstored.size;

/** A sound's file: from the library, else from an opened project that carried it (undefined: neither has it). */
async function soundData(id: string): Promise<Blob | undefined> {
  try {
    const data = await readStoredData(id);
    if (data) return data;
  } catch {
    // Storage blocked: an opened project may still have it
  }
  const carried = unstored.get(id);
  return carried ? (await fetch(`data:${carried.type || 'application/octet-stream'};base64,${carried.data}`)).blob() : undefined;
}

/**
 * Sounds that live only in memory, never in the library or a project file: auto-freeze's renders
 * (see autoFreeze.ts). Audio clips play them like any other sound, at the rate they were made at.
 */
const memorySounds = new Map<string, AudioBuffer>();

/** Make `buffer` playable as sound `id` (in memory only). */
export function provideMemorySound(id: string, buffer: AudioBuffer): void {
  memorySounds.set(id, buffer);
  setStatus(id, 'ready');
}

/** Let go of a memory-only sound. */
export function dropMemorySound(id: string): void {
  memorySounds.delete(id);
  useSoundLibrary.setState((s) => {
    if (!(id in s.status)) return s;
    const status = { ...s.status };
    delete status[id];
    return { status };
  });
}

/** The sound decoded to `sampleRate`, once decodeSound has finished with it. */
export const decodedSound = (id: string, sampleRate: number): AudioBuffer | undefined => {
  const memory = memorySounds.get(id);
  if (memory) return memory.sampleRate === sampleRate ? memory : undefined;
  return decodedBuffers.get(decodeKey(id, sampleRate));
};

/**
 * The sound decoded to `sampleRate`, once per rate and shared. Rejects if the sound isn't in this
 * browser (a restored session whose files were cleared) or can't be decoded; a failure isn't kept,
 * so the sound is tried again once it has been loaded.
 */
export function decodeSound(id: string, sampleRate: number): Promise<AudioBuffer> {
  const memory = memorySounds.get(id);
  if (memory) return memory.sampleRate === sampleRate ? Promise.resolve(memory) : Promise.reject(new SoundError('This sound is only kept at its own sample rate.'));
  const key = decodeKey(id, sampleRate);
  let promise = decoded.get(key);
  if (!promise) {
    promise = (async () => {
      const data = await soundData(id);
      if (!data) {
        setStatus(id, 'missing');
        throw new SoundError('This sound is not in this browser any more.');
      }
      try {
        return await decodeBytes(await data.arrayBuffer(), sampleRate);
      } catch {
        setStatus(id, 'error');
        throw new SoundError("This sound can't be decoded.");
      }
    })();
    promise.then(
      (buffer) => decodedBuffers.set(key, buffer),
      () => decoded.delete(key)
    );
    decoded.set(key, promise);
  }
  return promise;
}

// ---------- time-stretched copies ----------

/**
 * A copy being made: its promise, and whether something must have it (an export or a freeze:
 * never dropped). One made in the background for playback is dropped once nothing wants it (a
 * tempo dragged on past it); while it's made, a quick stand-in (WSOLA: right speed and pitch)
 * plays in its place, never in an export.
 */
interface Making {
  promise: Promise<AudioBuffer>;
  required: boolean;
}

const toBuffer = (channels: Float32Array[], sampleRate: number) => {
  const length = Math.max(1, channels[0]?.length ?? 0);
  const buffer = new AudioBuffer({ length, numberOfChannels: Math.max(1, channels.length), sampleRate });
  channels.forEach((ch, c) => buffer.copyToChannel((ch.length ? ch : new Float32Array(1)) as Float32Array<ArrayBuffer>, c));
  return buffer;
};
const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));

/** Stand-ins by copy key (stretched or warped), until the real copy is made. */
const standIns = new Map<string, AudioBuffer>();
/** Stand-ins kept per sound and rate */
const KEEP_STAND_INS = 3;
function keepStandIn(key: string, prefix: string, buffer: AudioBuffer): void {
  standIns.set(key, buffer);
  const mine = [...standIns.keys()].filter((k) => k.startsWith(prefix) && k !== key && !isWanted(k));
  for (const old of mine.slice(0, Math.max(0, mine.length - KEEP_STAND_INS + 1))) standIns.delete(old);
}

/** Stretched copies of sounds (see timeStretch.ts), by sound, sample rate, speed and the stretch's version. */
const stretchedBuffers = new Map<string, AudioBuffer>();
const stretching = new Map<string, Making>();
const stretchKey = (id: string, sampleRate: number, ratio: number) => `${id}|${sampleRate}|${ratio.toFixed(4)}|v${STRETCH_VERSION}`;
/** Speeds kept per sound and rate: a tempo being dragged leaves only the last few behind */
const KEEP_STRETCHES = 3;
/** The speed last asked for, per sound and rate (still wanted while the tempo settles) */
const lastAsked = new Map<string, string>();

/** The sound played `ratio` times as fast at the same pitch, once stretchSound has made it (or its stand-in, while it's made). */
export const stretchedSound = (id: string, sampleRate: number, ratio: number): AudioBuffer | undefined => {
  const key = stretchKey(id, sampleRate, ratio);
  return stretchedBuffers.get(key) ?? standIns.get(key);
};

/**
 * Make (once, shared) the sound played `ratio` times as fast at the same pitch, decoded to
 * `sampleRate`. `background`: for playback, so a stand-in comes first and it may be dropped once
 * nothing wants it; otherwise (an export) it's always made, and waited for.
 */
export function stretchSound(id: string, sampleRate: number, ratio: number, background = false): Promise<AudioBuffer> {
  const key = stretchKey(id, sampleRate, ratio);
  const slot = `${id}|${sampleRate}`;
  const known = stretching.get(key);
  if (known) {
    if (background) return known.promise;
    // (Needed now: one dropped just before this asked is made again)
    known.required = true;
    return known.promise.catch((err) => (err instanceof DspDropped ? stretchSound(id, sampleRate, ratio) : Promise.reject(err)));
  }
  const making: Making = { promise: Promise.resolve(null as unknown as AudioBuffer), required: !background };
  const wantedNow = () => making.required || isWanted(key) || lastAsked.get(slot) === key;
  making.promise = (async () => {
    const source = await decodeSound(id, sampleRate);
    if (background && !standIns.has(key)) {
      const quick = await runDsp({ kind: 'stretch', ratio, quick: true }, channelsOf(source), sampleRate, { wanted: wantedNow });
      if (!stretchedBuffers.has(key)) keepStandIn(key, `${slot}|`, toBuffer(quick, sampleRate));
    }
    // (In a Worker: a long tonal sound is a few seconds of work; how the sound was heard is kept there for its next speed)
    const channels = await runDsp({ kind: 'stretch', ratio, key: slot }, channelsOf(source), sampleRate, { wanted: wantedNow });
    return toBuffer(channels, sampleRate);
  })();
  making.promise.then(
    (buffer) => {
      stretchedBuffers.set(key, buffer);
      standIns.delete(key);
      // Forget the oldest speeds of this sound beyond the last few
      const prefix = `${slot}|`;
      const mine = [...stretchedBuffers.keys()].filter((k) => k.startsWith(prefix) && !isWanted(k));
      for (const old of mine.slice(0, Math.max(0, mine.length - KEEP_STRETCHES))) {
        stretchedBuffers.delete(old);
        stretching.delete(old);
      }
    },
    () => stretching.delete(key)
  );
  stretching.set(key, making);
  return making.promise;
}

const stretchTimers = new Map<string, number>();
/**
 * Ask for a stretched copy soon: while a tempo is being dragged only the speed it settles on is
 * made (each takes a moment of work; one no longer wanted is dropped). Until then the player plays
 * the sound sped up as a tape would, then the stand-in, then the real copy.
 */
export function requestStretch(id: string, sampleRate: number, ratio: number): void {
  const slot = `${id}|${sampleRate}`;
  const key = stretchKey(id, sampleRate, ratio);
  if (stretchedBuffers.has(key)) return;
  lastAsked.set(slot, key);
  clearTimeout(stretchTimers.get(slot));
  stretchTimers.set(
    slot,
    window.setTimeout(() => {
      stretchTimers.delete(slot);
      void stretchSound(id, sampleRate, ratio, true).catch(() => {});
    }, 250)
  );
}

// ---------- warped copies ----------

/**
 * A sound played along a clip's warp markers at `bpm` (see warp.ts): each stretch between markers
 * time-stretched to its length in beats at that tempo, end to end. Index t seconds into it is
 * beat beatAt(0) + t * bpm / 60 of the sound. Kept per sound, rate, tempo and markers.
 */
const warpedBuffers = new Map<string, AudioBuffer>();
const warping = new Map<string, Making>();
const warpBufferKey = (id: string, sampleRate: number, audio: Pick<ClipAudio, 'stretchBpm' | 'warp'>, bpm: number) =>
  `${id}|${sampleRate}|${bpm.toFixed(4)}|${audio.stretchBpm}|${warpKey(audio)}|v${STRETCH_VERSION}`;
/** Warps kept per sound and rate (markers being dragged leave only the last few behind) */
const KEEP_WARPS = 4;
/** The warp last asked for, per sound and rate */
const lastWarp = new Map<string, string>();

export const warpedSound = (id: string, sampleRate: number, audio: Pick<ClipAudio, 'stretchBpm' | 'warp'>, bpm: number): AudioBuffer | undefined => {
  const key = warpBufferKey(id, sampleRate, audio, bpm);
  return warpedBuffers.get(key) ?? standIns.get(key);
};

/** Make (once, shared) the warped copy (see stretchSound for `background`). */
export function warpSound(id: string, sampleRate: number, audio: Pick<ClipAudio, 'stretchBpm' | 'warp'>, bpm: number, background = false): Promise<AudioBuffer> {
  const key = warpBufferKey(id, sampleRate, audio, bpm);
  const slot = `${id}|${sampleRate}`;
  const known = warping.get(key);
  if (known) {
    if (background) return known.promise;
    known.required = true;
    return known.promise.catch((err) => (err instanceof DspDropped ? warpSound(id, sampleRate, audio, bpm) : Promise.reject(err)));
  }
  const making: Making = { promise: Promise.resolve(null as unknown as AudioBuffer), required: !background };
  const wantedNow = () => making.required || isWanted(key) || lastWarp.get(slot) === key;
  const shape = { stretchBpm: audio.stretchBpm, warp: audio.warp };
  making.promise = (async () => {
    const source = await decodeSound(id, sampleRate);
    const pieces: StretchPiece[] = [];
    for (const piece of warpPieces(shape, 0, source.duration)) {
      const from = Math.round(piece.src0 * sampleRate);
      const to = Math.round(piece.src1 * sampleRate);
      // Its length at the song's tempo, in samples (rounded so the pieces add up to the beats)
      const outFrom = Math.round(((piece.beat0 - beatAt(shape, 0)) * 60 * sampleRate) / bpm);
      const outTo = Math.round(((piece.beat1 - beatAt(shape, 0)) * 60 * sampleRate) / bpm);
      if (to <= from || outTo <= outFrom) continue;
      pieces.push({ from, to, outFrom, outTo });
    }
    if (!pieces.length) return toBuffer(channelsOf(source).map(() => new Float32Array(1)), sampleRate);
    if (background && !standIns.has(key)) {
      const quick = await runDsp({ kind: 'warp', pieces, quick: true }, channelsOf(source), sampleRate, { wanted: wantedNow });
      if (!warpedBuffers.has(key)) {
        keepStandIn(key, `${slot}|`, toBuffer(quick, sampleRate));
        warpListeners.forEach((l) => l());
      }
    }
    // Heard whole and stretched along all the pieces at once (timeStretch.ts), in a Worker
    return toBuffer(await runDsp({ kind: 'warp', pieces, key: slot }, channelsOf(source), sampleRate, { wanted: wantedNow }), sampleRate);
  })();
  making.promise.then(
    (buffer) => {
      warpedBuffers.set(key, buffer);
      standIns.delete(key);
      const prefix = `${slot}|`;
      const mine = [...warpedBuffers.keys()].filter((k) => k.startsWith(prefix) && !isWanted(k));
      for (const old of mine.slice(0, Math.max(0, mine.length - KEEP_WARPS))) {
        warpedBuffers.delete(old);
        warping.delete(old);
      }
      warpListeners.forEach((l) => l());
    },
    () => warping.delete(key)
  );
  warping.set(key, making);
  return making.promise;
}

// ---------- copies the song plays ----------

/** A stretched or warped copy a player wants (see wantCopies). */
export type WantedCopy = { id: string; sampleRate: number; ratio: number } | { id: string; sampleRate: number; warp: Pick<ClipAudio, 'stretchBpm' | 'warp'>; bpm: number };

/** The copies each player (an audio clip schedule, an export) plays, by player: never forgotten to make room. */
const wanted = new Map<string, Set<string>>();
const wantTimers = new Map<string, number>();
const copyKey = (c: WantedCopy) => ('warp' in c ? warpBufferKey(c.id, c.sampleRate, c.warp, c.bpm) : stretchKey(c.id, c.sampleRate, c.ratio));
function isWanted(key: string): boolean {
  for (const keys of wanted.values()) if (keys.has(key)) return true;
  return false;
}

/**
 * The stretched and warped copies `owner` plays now (an empty list lets them go). Only the last
 * few speeds of a sound are kept, for a tempo being dragged; a song that plays one sound at many
 * speeds at once (an audio loop cut on every beat of a tempo glide) keeps every one it uses. With
 * `make`, the missing ones are made a moment after the song stops changing.
 */
export function wantCopies(owner: string, copies: readonly WantedCopy[], make = true): void {
  const keys = new Set(copies.map(copyKey));
  if (keys.size) wanted.set(owner, keys);
  else wanted.delete(owner);
  clearTimeout(wantTimers.get(owner));
  wantTimers.delete(owner);
  if (!make || !copies.length) return;
  wantTimers.set(
    owner,
    window.setTimeout(() => {
      wantTimers.delete(owner);
      for (const c of copies) {
        if ('warp' in c) {
          if (!warpedBuffers.has(copyKey(c))) void warpSound(c.id, c.sampleRate, c.warp, c.bpm, true).catch(() => {});
        } else if (c.ratio !== 1 && !stretchedBuffers.has(copyKey(c))) void stretchSound(c.id, c.sampleRate, c.ratio, true).catch(() => {});
      }
    }, 300)
  );
}

const warpListeners = new Set<() => void>();
/** Told whenever a warped copy is ready (the player swaps it in). */
export function onWarped(listener: () => void): () => void {
  warpListeners.add(listener);
  return () => warpListeners.delete(listener);
}

const warpTimers = new Map<string, number>();
/** Ask for a warped copy soon (while markers are being dragged, only where they settle is made). */
export function requestWarp(id: string, sampleRate: number, audio: Pick<ClipAudio, 'stretchBpm' | 'warp'>, bpm: number): void {
  const key = warpBufferKey(id, sampleRate, audio, bpm);
  if (warpedBuffers.has(key)) return;
  const slot = `${id}|${sampleRate}`;
  lastWarp.set(slot, key);
  clearTimeout(warpTimers.get(slot));
  const shape = { stretchBpm: audio.stretchBpm, warp: audio.warp };
  warpTimers.set(
    slot,
    window.setTimeout(() => {
      warpTimers.delete(slot);
      void warpSound(id, sampleRate, shape, bpm, true).catch(() => {});
    }, 200)
  );
}

// ---------- waveform peaks ----------

/** Seconds of sound measured per idle stretch (about a millisecond's work). */
const PEAKS_STRETCH_SECONDS = 4;

const idle = (work: () => void) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => work(), { timeout: 250 });
  else setTimeout(work, 0);
};

/** Work out a sound's peaks a stretch at a time, in idle moments, then hand them over. */
function measurePeaks(buffer: AudioBuffer, done: (peaks: Peaks) => void): void {
  const peaks = createPeaks(buffer.duration);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const perStretch = peaks.perSecond * PEAKS_STRETCH_SECONDS;
  let at = 0;
  const step = () => {
    fillPeaks(peaks, channels, buffer.sampleRate, at, at + perStretch);
    at += perStretch;
    if (at < peaks.min.length) idle(step);
    else done(peaks);
  };
  idle(step);
}

/** Decode a sound for playback and measure its peaks; its status follows. */
async function prepareSound(id: string): Promise<void> {
  try {
    const buffer = await decodeSound(id, liveSampleRate());
    if (useSoundLibrary.getState().peaks[id]) {
      setStatus(id, 'ready');
      return;
    }
    measurePeaks(buffer, (peaks) => {
      setPeaks(id, peaks);
      setStatus(id, 'ready');
    });
  } catch {
    // decodeSound set the status (missing or error)
  }
}

/**
 * Make a sound the project refers to known: its meta is read, it is decoded for playback and its
 * waveform measured. Nothing happens for a sound already met (ready, loading, or found missing).
 */
export function ensureSound(id: string): void {
  if (soundStatus(id) !== undefined) return;
  setStatus(id, 'loading');
  void (async () => {
    try {
      const meta = await readStoredMeta(id);
      if (!meta) {
        setStatus(id, 'missing');
        return;
      }
      setMeta(meta);
    } catch {
      setStatus(id, 'missing');
      return;
    }
    await prepareSound(id);
  })();
}

// ---------- loading files ----------

/**
 * Put a sound file into the library: checked for size, hashed, decoded (a file the browser can't
 * play is refused) and stored. The same bytes loaded again give the same id and are stored once.
 * The meta describes the file; the caller names the clip or track.
 */
export async function importSoundFile(file: Blob, name: string, maxBytes = MAX_SOUND_BYTES): Promise<SoundMeta> {
  if (file.size > maxBytes) {
    throw new SoundError(`"${name}" is ${megabytes(file.size)} MB. Sounds up to ${maxBytes / 1048576} MB can be loaded, because each is kept in this browser and saved inside your project file: trim it, or save it as MP3 or OGG (a tenth of the size).`);
  }
  const bytes = await file.arrayBuffer();
  const id = await hashBytes(bytes);
  const type = file.type || 'application/octet-stream';
  // Kept before decoding, which consumes the bytes
  const data = new Blob([bytes], { type });
  const sampleRate = liveSampleRate();
  let buffer: AudioBuffer;
  try {
    buffer = await decodeBytes(bytes, sampleRate);
  } catch {
    throw new SoundError(`Couldn't read "${name}" as audio. Try a WAV, MP3, OGG, FLAC or M4A file.`);
  }
  let meta = useSoundLibrary.getState().metas[id];
  if (!meta) {
    let stored: SoundMeta | undefined;
    try {
      stored = await readStoredMeta(id);
      meta = stored ?? { id, name, type, size: data.size, seconds: buffer.duration };
      if (!stored) await writeStoredSound(meta, data);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        throw new SoundError(`There's no room left in this browser to keep "${name}". "Free unused", under an Audio or Sampler track's settings, makes room.`);
      }
      throw new SoundError("Your browser is blocking storage for this site, so sounds can't be kept. Check the site's permissions (or leave private browsing).");
    }
  }
  decoded.set(decodeKey(id, sampleRate), Promise.resolve(buffer));
  decodedBuffers.set(decodeKey(id, sampleRate), buffer);
  setMeta(meta);
  if (soundStatus(id) !== 'ready') {
    setStatus(id, 'loading');
    measurePeaks(buffer, (peaks) => {
      setPeaks(id, peaks);
      setStatus(id, 'ready');
    });
  }
  return meta;
}

/** A sound carried inside a project as a data: URL (the Sampler's old form), put into the library. */
export async function importDataUrl(dataUrl: string, name: string): Promise<SoundMeta> {
  const data = await (await fetch(dataUrl)).blob();
  return importSoundFile(data, name);
}

/**
 * `tracks` with each Sampler sound kept the old way (a data: URL on the track) moved into the
 * library and the track pointed at it, as opening the file in the app does (timelineStore's
 * prepareSounds), so it plays as it does there: decoded as every library sound is. One that can't
 * be read or kept stays as it was (and plays from its data: URL, as it would in the app).
 */
export async function withLibrarySamples<T extends { sample?: CustomSample }>(tracks: T[]): Promise<T[]> {
  return Promise.all(
    tracks.map(async (t) => {
      const sample = t.sample;
      if (!sample?.dataUrl || sample.soundId) return t;
      try {
        const meta = await importDataUrl(sample.dataUrl, sample.name);
        return { ...t, sample: { name: sample.name, soundId: meta.id, root: sample.root } };
      } catch {
        return t;
      }
    })
  );
}

// ---------- project files ----------

const base64Of = (data: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(data);
  });

/**
 * The sounds with these ids as a project file embeds them (bytes in base64). A sound this browser
 * doesn't have is left out: the file still opens, with that sound missing.
 */
export async function embedSounds(ids: readonly string[]): Promise<EmbeddedSound[]> {
  const sounds: EmbeddedSound[] = [];
  for (const id of ids) {
    // (One an opened project carried that isn't stored yet, or can't be: as the project had it)
    const carried = unstored.get(id);
    if (carried) {
      sounds.push(carried);
      continue;
    }
    try {
      const meta = useSoundLibrary.getState().metas[id] ?? (await readStoredMeta(id));
      const data = meta && (await readStoredData(id));
      if (meta && data) sounds.push({ ...meta, data: await base64Of(data) });
    } catch {
      // Storage blocked: nothing to embed
    }
  }
  return sounds;
}

/**
 * Put a project file's embedded sounds into the library (the ones not already there) and get them
 * ready. Their status reads "loading" from the moment this is called, so clips drawn meanwhile
 * wait for them rather than report them missing.
 */
export function importEmbeddedSounds(sounds: readonly EmbeddedSound[]): Promise<void> {
  for (const sound of sounds) {
    const { data: _data, ...meta } = sound;
    setMeta(meta);
    if (soundStatus(sound.id) !== 'ready') setStatus(sound.id, 'loading');
    unstored.set(sound.id, sound);
  }
  return (async () => {
    for (const sound of sounds) {
      const { data, ...meta } = sound;
      try {
        if (!(await readStoredMeta(meta.id))) {
          const blob = await (await fetch(`data:${meta.type || 'application/octet-stream'};base64,${data}`)).blob();
          await writeStoredSound(meta, blob);
        }
        unstored.delete(meta.id);
      } catch {
        // Storage full or blocked: it plays and saves from the project's copy (or, if the data
        // isn't base64, stays missing)
      }
      await prepareSound(meta.id);
    }
  })();
}

// ---------- housekeeping ----------

/** How much the library holds in this browser. */
export async function librarySize(): Promise<{ count: number; bytes: number }> {
  const sounds = await storedSounds();
  return { count: sounds.length, bytes: sounds.reduce((sum, s) => sum + s.size, 0) };
}

/** Other keepers of sounds (the kept versions of songs, versions.ts): what each needs is never freed. */
const protectors: Array<() => Promise<Iterable<string>>> = [];

/** Never free the sounds `source` names (asked each time; if it throws, nothing is freed). */
export function protectSounds(source: () => Promise<Iterable<string>>): void {
  protectors.push(source);
}

/**
 * Delete every stored sound except the ones in `keep` (and the ones protectSounds keeps). Returns
 * what went. A deleted sound that something still refers to reads "missing" from then on.
 */
export async function freeUnusedSounds(keep: ReadonlySet<string>): Promise<{ count: number; bytes: number }> {
  const kept = new Set(keep);
  for (const source of protectors) for (const id of await source()) kept.add(id);
  const sounds = await storedSounds();
  const gone = sounds.filter((s) => !kept.has(s.id));
  await deleteStoredSounds(gone.map((s) => s.id));
  for (const { id } of gone) {
    for (const key of [...decoded.keys()]) {
      if (!key.startsWith(`${id}|`)) continue;
      decoded.delete(key);
      decodedBuffers.delete(key);
    }
    useSoundLibrary.setState((s) => {
      const { [id]: _m, ...metas } = s.metas;
      const { [id]: _p, ...peaks } = s.peaks;
      return { metas, peaks, status: { ...s.status, [id]: 'missing' } };
    });
  }
  return { count: gone.length, bytes: gone.reduce((sum, s) => sum + s.size, 0) };
}
