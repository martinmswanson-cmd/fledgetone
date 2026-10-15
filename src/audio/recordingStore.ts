import { INSTRUMENTS, type SampleSource } from './instrumentCatalog';
import { pluginFamilies, pluginSource } from './plugins/pluginSources';

/**
 * The instruments' recordings, kept in this browser (IndexedDB) once downloaded, so each one is
 * downloaded once ever: songs open at once on the next visit, and instruments already used work
 * offline. IndexedDB rather than the Cache API because it also works when the app is opened from
 * a file. A recording is stored under its address plus its set's fingerprint (`version`), so a
 * re-made set is downloaded afresh rather than played from an old copy.
 *
 * `downloadAll` fetches every instrument's recordings ahead of time (the "Download all for offline
 * use" setting), only storing them: nothing is decoded until an instrument is used.
 */

const DB_NAME = 'bos-beat-box-recordings';
const STORE = 'recordings';

/**
 * A kept recording. Kept as a Blob: the browser stores it beside the database and hands it over
 * without copying it through the page's thread (bytes kept as an ArrayBuffer were serialized
 * there, half a second of a big song's first opening). Copies kept before are bytes.
 */
interface Stored {
  blob?: Blob;
  bytes?: ArrayBuffer;
  version: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
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
  // A failure (private window, storage turned off) is tried again next time
  promise.catch(() => {
    if (dbPromise === promise) dbPromise = null;
  });
  return promise;
}

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function read(key: string, version: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    const hit = (await done(db.transaction(STORE).objectStore(STORE).get(key))) as Stored | undefined;
    if (!hit || hit.version !== version) return null;
    return hit.blob ? await hit.blob.arrayBuffer() : (hit.bytes ?? null);
  } catch {
    return null;
  }
}

/** Whether a recording is kept (without reading it). */
async function has(key: string, version: string): Promise<boolean> {
  try {
    const db = await openDb();
    const hit = (await done(db.transaction(STORE).objectStore(STORE).get(key))) as Stored | undefined;
    return !!hit && hit.version === version;
  } catch {
    return false;
  }
}

async function write(key: string, version: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ blob, version } satisfies Stored, key));
  } catch {
    // Not kept (storage full or unavailable): it's downloaded again next time
  }
}

/** The addresses a recording can come from, in order (its own, then the site's copy). */
const addressesOf = (source: Pick<SampleSource, 'baseUrl' | 'fallbackUrl'>, file: string) => [source.baseUrl + file, ...(source.fallbackUrl ? [source.fallbackUrl + file] : [])];

async function download(addresses: string[], signal?: AbortSignal): Promise<ArrayBuffer> {
  let last: unknown;
  for (const url of addresses) {
    try {
      const res = await fetch(url, { signal });
      if (res.ok) return await res.arrayBuffer();
      last = new Error(`${url}: ${res.status}`);
    } catch (err) {
      if (signal?.aborted) throw err;
      last = err;
    }
  }
  throw last;
}

/**
 * A recording's bytes: the kept copy, or downloaded (and kept for next time). The bytes are the
 * caller's: decoding them (which detaches them) doesn't touch the kept copy.
 */
export async function recordingBytes(source: Pick<SampleSource, 'baseUrl' | 'fallbackUrl' | 'version'>, file: string): Promise<ArrayBuffer> {
  const addresses = addressesOf(source, file);
  const version = source.version ?? '';
  const kept = await read(addresses[0], version);
  if (kept) return kept;
  const bytes = await download(addresses);
  void write(addresses[0], version, new Blob([bytes]));
  return bytes;
}

/** Every recording any instrument plays, once each, and the plugins' files. */
function everyRecording(): Array<{ key: string; version: string; addresses: string[] }> {
  const seen = new Map<string, { key: string; version: string; addresses: string[] }>();
  for (const def of Object.values(INSTRUMENTS)) {
    const source = def.samples;
    if (!source) continue;
    for (const file of Object.values(source.samples)) {
      const addresses = addressesOf(source, file);
      if (!seen.has(addresses[0])) seen.set(addresses[0], { key: addresses[0], version: source.version ?? '', addresses });
    }
    // and its release sounds
    const rel = source.releases;
    for (const file of Object.values(rel?.samples ?? {})) {
      const addresses = addressesOf(rel!, file);
      if (!seen.has(addresses[0])) seen.set(addresses[0], { key: addresses[0], version: rel!.version ?? '', addresses });
    }
  }
  // And the built-in plugins' WebAssembly (plugins/builtinHost.ts)
  for (const family of pluginFamilies()) {
    const source = pluginSource(family);
    const addresses = addressesOf(source, family.file);
    seen.set(addresses[0], { key: addresses[0], version: source.version, addresses });
  }
  return [...seen.values()];
}

/** How many recordings the instruments have in all. */
export const recordingCount = (): number => everyRecording().length;

/** How many recordings are kept in this browser, and their size in bytes. */
export async function keptRecordings(): Promise<{ count: number; bytes: number }> {
  try {
    const db = await openDb();
    const store = db.transaction(STORE).objectStore(STORE);
    return await new Promise((resolve, reject) => {
      let count = 0;
      let bytes = 0;
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve({ count, bytes });
        count++;
        const kept = cursor.value as Stored;
        bytes += kept.blob?.size ?? kept.bytes?.byteLength ?? 0;
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return { count: 0, bytes: 0 };
  }
}

/** Forget every kept recording (they're downloaded again when next used). */
export async function clearRecordings(): Promise<void> {
  try {
    const db = await openDb();
    await done(db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
  } catch {
    // Nothing kept, or storage unavailable
  }
}

export interface DownloadProgress {
  /** Recordings done (already kept, or downloaded now) */
  done: number;
  total: number;
  /** Bytes downloaded by this run */
  bytes: number;
  /** Recordings that couldn't be downloaded */
  failed: number;
}

/**
 * Download and keep every instrument's recordings that aren't kept yet, a few at a time, until
 * done or `signal` aborts. Asks the browser to keep the storage for good (it may still clear it
 * when the disk is nearly full, unless the person allows it).
 */
export async function downloadAll(onProgress: (p: DownloadProgress) => void, signal: AbortSignal): Promise<DownloadProgress> {
  void navigator.storage?.persist?.().catch(() => false);
  const all = everyRecording();
  const progress: DownloadProgress = { done: 0, total: all.length, bytes: 0, failed: 0 };
  onProgress({ ...progress });
  let next = 0;
  const worker = async () => {
    while (next < all.length && !signal.aborted) {
      const item = all[next++];
      if (!(await has(item.key, item.version))) {
        try {
          const bytes = await download(item.addresses, signal);
          await write(item.key, item.version, new Blob([bytes]));
          progress.bytes += bytes.byteLength;
        } catch {
          if (signal.aborted) break;
          progress.failed++;
        }
      }
      progress.done++;
      onProgress({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return progress;
}
