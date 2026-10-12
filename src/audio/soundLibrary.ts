import { create } from 'zustand';
import { liveMix } from './engine';
import { createPeaks, fillPeaks } from './waveform';
import { stretchChannels } from './timeStretch';
import { beatAt, warpKey, warpPieces } from '../store/warp';
import type { Peaks } from './waveform';
import type { ClipAudio, EmbeddedSound, SoundMeta } from '../store/timelineTypes';

export type { EmbeddedSound, SoundMeta };

/**
 * The user's own sound files: audio clips, the Slicer's sound and the Sampler's. They live in the
 * browser's IndexedDB, keyed by a hash of their bytes, so a file loaded twice (or used by several
 * tracks or projects) is stored once, and projects only hold the ids: browser autosave has about
 * 5 MB for a whole project, and a sound file alone can be ten times that. A saved .beatbox.json
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
  return bytes;
}

/** The sound decoded to `sampleRate`, once decodeSound has finished with it. */
export const decodedSound = (id: string, sampleRate: number): AudioBuffer | undefined => decodedBuffers.get(decodeKey(id, sampleRate));

/**
 * The sound decoded to `sampleRate`, once per rate and shared. Rejects if the sound isn't in this
 * browser (a restored session whose files were cleared) or can't be decoded; a failure isn't kept,
 * so the sound is tried again once it has been loaded.
 */
export function decodeSound(id: string, sampleRate: number): Promise<AudioBuffer> {
  const key = decodeKey(id, sampleRate);
  let promise = decoded.get(key);
  if (!promise) {
    promise = (async () => {
      const data = await readStoredData(id);
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

/** Stretched copies of sounds (see timeStretch.ts), by sound, sample rate and speed. */
const stretchedBuffers = new Map<string, AudioBuffer>();
const stretching = new Map<string, Promise<AudioBuffer>>();
const stretchKey = (id: string, sampleRate: number, ratio: number) => `${id}|${sampleRate}|${ratio.toFixed(4)}`;
/** Speeds kept per sound and rate: a tempo being dragged leaves only the last few behind */
const KEEP_STRETCHES = 3;

/** The sound played `ratio` times as fast at the same pitch, once stretchSound has made it. */
export const stretchedSound = (id: string, sampleRate: number, ratio: number): AudioBuffer | undefined =>
  stretchedBuffers.get(stretchKey(id, sampleRate, ratio));

/** Make (once, shared) the sound played `ratio` times as fast at the same pitch, decoded to `sampleRate`. */
export function stretchSound(id: string, sampleRate: number, ratio: number): Promise<AudioBuffer> {
  const key = stretchKey(id, sampleRate, ratio);
  let promise = stretching.get(key);
  if (!promise) {
    promise = (async () => {
      const source = await decodeSound(id, sampleRate);
      const channels = stretchChannels(
        Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c)),
        ratio,
        sampleRate
      );
      const buffer = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate });
      channels.forEach((ch, c) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
      return buffer;
    })();
    promise.then(
      (buffer) => {
        stretchedBuffers.set(key, buffer);
        // Forget the oldest speeds of this sound beyond the last few
        const prefix = `${id}|${sampleRate}|`;
        const mine = [...stretchedBuffers.keys()].filter((k) => k.startsWith(prefix));
        for (const old of mine.slice(0, Math.max(0, mine.length - KEEP_STRETCHES))) {
          stretchedBuffers.delete(old);
          stretching.delete(old);
        }
      },
      () => stretching.delete(key)
    );
    stretching.set(key, promise);
  }
  return promise;
}

const stretchTimers = new Map<string, number>();
/**
 * Ask for a stretched copy soon: while a tempo is being dragged only the speed it settles on is
 * made (each takes a moment of work). Until then the player plays the sound sped up as a tape would.
 */
export function requestStretch(id: string, sampleRate: number, ratio: number): void {
  if (stretchedSound(id, sampleRate, ratio)) return;
  const slot = `${id}|${sampleRate}`;
  clearTimeout(stretchTimers.get(slot));
  stretchTimers.set(
    slot,
    window.setTimeout(() => {
      stretchTimers.delete(slot);
      void stretchSound(id, sampleRate, ratio).catch(() => {});
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
const warping = new Map<string, Promise<AudioBuffer>>();
const warpBufferKey = (id: string, sampleRate: number, audio: Pick<ClipAudio, 'stretchBpm' | 'warp'>, bpm: number) =>
  `${id}|${sampleRate}|${bpm.toFixed(4)}|${audio.stretchBpm}|${warpKey(audio)}`;
/** Warps kept per sound and rate (markers being dragged leave only the last few behind) */
const KEEP_WARPS = 4;

export const warpedSound = (id: string, sampleRate: number, audio: Pick<ClipAudio, 'stretchBpm' | 'warp'>, bpm: number): AudioBuffer | undefined =>
  warpedBuffers.get(warpBufferKey(id, sampleRate, audio, bpm));

export function warpSound(id: string, sampleRate: number, audio: Pick<ClipAudio, 'stretchBpm' | 'warp'>, bpm: number): Promise<AudioBuffer> {
  const key = warpBufferKey(id, sampleRate, audio, bpm);
  let promise = warping.get(key);
  if (!promise) {
    const shape = { stretchBpm: audio.stretchBpm, warp: audio.warp };
    promise = (async () => {
      const source = await decodeSound(id, sampleRate);
      const input = Array.from({ length: source.numberOfChannels }, (_, c) => source.getChannelData(c));
      const parts: Float32Array[][] = [];
      for (const piece of warpPieces(shape, 0, source.duration)) {
        const a = Math.round(piece.src0 * sampleRate);
        const b = Math.round(piece.src1 * sampleRate);
        // Its length at the song's tempo, in samples (rounded so the pieces add up to the beats)
        const outStart = Math.round(((piece.beat0 - beatAt(shape, 0)) * 60 * sampleRate) / bpm);
        const outEnd = Math.round(((piece.beat1 - beatAt(shape, 0)) * 60 * sampleRate) / bpm);
        if (b <= a || outEnd <= outStart) continue;
        const stretched = stretchChannels(input.map((ch) => ch.subarray(a, b)), (b - a) / (outEnd - outStart), sampleRate);
        parts.push(stretched.map((ch) => (ch.length === outEnd - outStart ? ch : fitLength(ch, outEnd - outStart))));
      }
      const length = Math.max(1, parts.reduce((n, p) => n + p[0].length, 0));
      const buffer = new AudioBuffer({ length, numberOfChannels: source.numberOfChannels, sampleRate });
      for (let c = 0; c < source.numberOfChannels; c++) {
        const out = new Float32Array(length);
        let at = 0;
        for (const p of parts) {
          out.set(p[c], at);
          at += p[c].length;
        }
        buffer.copyToChannel(out, c);
      }
      return buffer;
    })();
    promise.then(
      (buffer) => {
        warpedBuffers.set(key, buffer);
        const prefix = `${id}|${sampleRate}|`;
        const mine = [...warpedBuffers.keys()].filter((k) => k.startsWith(prefix));
        for (const old of mine.slice(0, Math.max(0, mine.length - KEEP_WARPS))) {
          warpedBuffers.delete(old);
          warping.delete(old);
        }
        warpListeners.forEach((l) => l());
      },
      () => warping.delete(key)
    );
    warping.set(key, promise);
  }
  return promise;
}

/** A channel cut or padded with silence to `length` samples. */
function fitLength(ch: Float32Array, length: number): Float32Array {
  if (ch.length >= length) return ch.subarray(0, length);
  const out = new Float32Array(length);
  out.set(ch);
  return out;
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
  if (warpedSound(id, sampleRate, audio, bpm)) return;
  const slot = `${id}|${sampleRate}`;
  clearTimeout(warpTimers.get(slot));
  const shape = { stretchBpm: audio.stretchBpm, warp: audio.warp };
  warpTimers.set(
    slot,
    window.setTimeout(() => {
      warpTimers.delete(slot);
      void warpSound(id, sampleRate, shape, bpm).catch(() => {});
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
    throw new SoundError(`"${name}" is ${megabytes(file.size)} MB. Sounds up to ${MAX_SOUND_BYTES / 1048576} MB can be loaded: trim it, or save it as MP3 or OGG.`);
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
    } catch {
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
  }
  return (async () => {
    for (const sound of sounds) {
      const { data, ...meta } = sound;
      try {
        if (!(await readStoredMeta(meta.id))) {
          const blob = await (await fetch(`data:${meta.type || 'application/octet-stream'};base64,${data}`)).blob();
          await writeStoredSound(meta, blob);
        }
      } catch {
        // Storage blocked, or the data isn't base64: the sound stays missing
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

/**
 * Delete every stored sound except the ones in `keep`. Returns what went. A deleted sound that
 * something still refers to reads "missing" from then on.
 */
export async function freeUnusedSounds(keep: ReadonlySet<string>): Promise<{ count: number; bytes: number }> {
  const sounds = await storedSounds();
  const gone = sounds.filter((s) => !keep.has(s.id));
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
