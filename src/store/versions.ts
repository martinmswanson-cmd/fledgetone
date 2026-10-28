/**
 * Earlier versions of your songs, kept in this browser (IndexedDB), so "go back to 10 minutes
 * ago" is one tap. While you edit, autosave keeps one every couple of minutes (keepVersionWhileEditing);
 * and the song open is kept just before something replaces it: New, Open, a shared link, or
 * going back to a version (keepVersion). Old ones thin out (versionPolicy.ts).
 *
 * A version is the song as autosave stores it, without its sound files: those stay in the sound
 * library, and freeing unused sounds leaves the ones a kept version plays (protectSounds).
 * Nothing here ever stops autosave: storage blocked (some private modes) or full just means no
 * versions are kept.
 */
import { create } from 'zustand';
import { hasWork, newSongId, packedProject, unpackProject, type ProjectSnapshot } from './project';
import { referencedSoundIds } from './audioClips';
import { protectSounds } from '../audio/soundLibrary';
import { versionDue, versionsToDrop } from './versionPolicy';

/** Why a version was kept: while editing, before another song replaced it, or before going back to a version. */
/** Why it was kept: 'otherTab', another tab's song just before this tab's autosave wrote over it. */
export type VersionReason = 'editing' | 'replaced' | 'restore' | 'otherTab';

/** A kept version, as the list shows it (the song itself is stored apart, see readVersion). */
export interface VersionInfo {
  id: string;
  songId: string;
  savedAt: number;
  name: string;
  tracks: number;
  /** How long the song is, in bars (to the end of its last clip) */
  bars: number;
  why: VersionReason;
  /** The sounds it plays (kept when unused sounds are freed) */
  soundIds: string[];
  /** Its size stored */
  bytes: number;
}

const DB_NAME = 'fledgetone-versions';
const INFO_STORE = 'info';
const DATA_STORE = 'data';

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
      const db = req.result;
      if (!db.objectStoreNames.contains(INFO_STORE)) db.createObjectStore(INFO_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DATA_STORE)) db.createObjectStore(DATA_STORE);
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

/** The list of kept versions, newest first, for the Versions list (null until first read). */
export const useVersions = create<{ list: VersionInfo[] | null; unavailable: boolean; readAt: number }>(() => ({ list: null, unavailable: false, readAt: 0 }));

/** Every kept version, newest first. Throws if storage can't be read. */
async function readInfos(): Promise<VersionInfo[]> {
  const db = await openDb();
  const all = await request(db.transaction(INFO_STORE).objectStore(INFO_STORE).getAll() as IDBRequest<VersionInfo[]>);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

/** Read the list again (into useVersions). */
export async function refreshVersions(): Promise<void> {
  try {
    useVersions.setState({ list: await readInfos(), unavailable: false, readAt: Date.now() });
  } catch {
    useVersions.setState({ list: [], unavailable: true, readAt: Date.now() });
  }
}

/** The song kept as version `id`. Throws if it's gone or can't be read. */
export async function readVersion(id: string): Promise<ProjectSnapshot> {
  const db = await openDb();
  const json = await request(db.transaction(DATA_STORE).objectStore(DATA_STORE).get(id) as IDBRequest<string | undefined>);
  if (typeof json !== 'string') throw new Error('that version is no longer kept');
  return unpackProject(json);
}

/** What was last kept of each song this visit (when, and the song as stored), so an unchanged song isn't kept twice */
const lastKept = new Map<string, { at: number; json: string }>();
/** Writes one after another, so thinning sees each */
let queue: Promise<void> = Promise.resolve();

/** How long a song is, in bars: to the end of its last clip. */
const songBars = (p: ProjectSnapshot) => Math.max(0, Math.ceil(Math.max(1, ...p.clips.map((c) => c.startBar + c.lengthBars)) - 1 - 1e-6));

/**
 * Keep the song as a version now (unless it has no work in it, or it's just as last kept). Done
 * in the background; never throws. The song is read now, so later edits don't reach it.
 */
export function keepVersion(p: ProjectSnapshot, why: VersionReason): void {
  try {
    if (!hasWork(p)) return;
    const songId = p.songId || newSongId();
    const json = packedProject({ ...p, songId });
    const last = lastKept.get(songId);
    if (last?.json === json) return;
    const now = Date.now();
    lastKept.set(songId, { at: now, json });
    const ids = new Set(referencedSoundIds(p));
    // Frozen tracks' sounds too (only this browser has them)
    p.tracks.forEach((t) => t.frozen && ids.add(t.frozen.soundId));
    const info: VersionInfo = {
      id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      songId,
      savedAt: now,
      name: p.name,
      tracks: p.tracks.length,
      bars: songBars(p),
      why,
      soundIds: [...ids],
      bytes: json.length * 2,
    };
    queue = queue.then(() => store(info, json)).then(refreshVersions, () => undefined);
  } catch {
    // Nothing kept: autosave goes on all the same
  }
}

/** Called by autosave after each save: keep a version when the last one (of this song, this visit) is a couple of minutes old. */
export function keepVersionWhileEditing(p: ProjectSnapshot): void {
  const last = p.songId ? lastKept.get(p.songId) : undefined;
  if (versionDue(last?.at ?? null, Date.now())) keepVersion(p, 'editing');
}

/** Store a version and thin the list; when storage is full, thin harder and try once more. */
async function store(info: VersionInfo, json: string): Promise<void> {
  const write = async () => {
    const db = await openDb();
    const tx = db.transaction([INFO_STORE, DATA_STORE], 'readwrite');
    tx.objectStore(INFO_STORE).put(info);
    tx.objectStore(DATA_STORE).put(json, info.id);
    await completed(tx);
  };
  try {
    await write();
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'QuotaExceededError')) throw err;
    const all = await readInfos();
    await drop(all.slice(Math.ceil(all.length / 2)).map((v) => v.id));
    await write();
  }
  await thin();
}

async function drop(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  const tx = db.transaction([INFO_STORE, DATA_STORE], 'readwrite');
  for (const id of ids) {
    tx.objectStore(INFO_STORE).delete(id);
    tx.objectStore(DATA_STORE).delete(id);
  }
  await completed(tx);
}

/** Let old versions go (versionPolicy.ts says which). */
async function thin(): Promise<void> {
  await drop(versionsToDrop(await readInfos(), Date.now()));
}

// Freeing unused sounds leaves the ones kept versions play. If the versions can't be read, nothing
// is freed (a version's sounds might be among them); with no storage at all there are none.
protectSounds(async () => {
  if (typeof indexedDB === 'undefined') return [];
  return (await readInfos()).flatMap((v) => v.soundIds);
});
