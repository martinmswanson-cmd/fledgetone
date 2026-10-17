import type React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import type { SoundMeta } from '../../store/timelineTypes';
import { AUDIO_FILE_ACCEPT, importSoundFile, SoundError } from '../../audio/soundLibrary';
import { showToast } from './toastStore';

/**
 * Sound files arriving on the timeline: dropped from the desktop onto an Audio track's lane or
 * the space under the tracks, or picked with "Load audio…". Each goes into the sound library
 * (see soundLibrary.ts) and becomes a clip.
 */

/** True while a desktop file drag is over the element (a deck pad drag carries no files). */
export const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files');

/** Open the browser's file picker for sound files. Resolves with none if it was cancelled. */
export function pickAudioFiles(multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = AUDIO_FILE_ACCEPT;
    input.multiple = multiple;
    input.style.display = 'none';
    const done = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    input.addEventListener('change', done);
    input.addEventListener('cancel', done);
    document.body.appendChild(input);
    input.click();
  });
}

/** Put files into the sound library, one after another; a file that can't be loaded says why in a toast and is skipped. */
export async function importAudioFiles(files: Iterable<File>): Promise<SoundMeta[]> {
  const sounds: SoundMeta[] = [];
  for (const file of files) {
    try {
      sounds.push(await importSoundFile(file, file.name));
    } catch (err) {
      showToast(err instanceof SoundError ? err.message : `Couldn't load "${file.name}".`);
    }
  }
  return sounds;
}

/** Load `files` and lay them on an Audio track (null: a new one) as clips from `bar`. */
export async function dropAudioFiles(trackId: string | null, bar: number, files: Iterable<File>): Promise<void> {
  const sounds = await importAudioFiles(files);
  if (!sounds.length) return;
  const message = useTimelineStore.getState().addAudioClips(trackId, bar, sounds);
  if (message) showToast(message);
}

// ---------- folders (sample packs) ----------

/** A file and where it sat in the dropped or picked folder ("Pack/Kicks/Kick 01.wav"). */
export interface PathFile {
  file: File;
  path: string;
}

/** Most files read from one folder (a whole sound library dropped by mistake stops here). */
const MAX_FOLDER_FILES = 5000;

/** True if a drop holds a folder (the browser gives it as an entry, not as a file). */
export function dropHasFolder(dt: DataTransfer): boolean {
  return Array.from(dt.items ?? []).some((item) => item.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory);
}

/**
 * Every file of a drop, folders opened all the way down, each with its path. The entries are taken
 * from the drop at once (the browser empties it after the drop event), then read.
 */
export async function filesFromDrop(dt: DataTransfer): Promise<PathFile[]> {
  const entries = Array.from(dt.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return Array.from(dt.files).map((file) => ({ file, path: file.name }));
  const out: PathFile[] = [];
  const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));
  const readAll = async (dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    // readEntries gives a batch at a time (Chrome: 100), until an empty one
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) return all;
      all.push(...batch);
    }
  };
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (out.length >= MAX_FOLDER_FILES) return;
    if (entry.isFile) {
      // (Hidden files, like macOS's "._" copies and .DS_Store, aren't sounds)
      if (entry.name.startsWith('.')) return;
      try {
        out.push({ file: await fileOf(entry as FileSystemFileEntry), path });
      } catch {
        // Unreadable: left out
      }
      return;
    }
    if (!entry.isDirectory || entry.name.startsWith('.') || entry.name === '__MACOSX') return;
    for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, `${path}/${child.name}`);
  };
  for (const entry of entries) await walk(entry, entry.name);
  return out;
}

/** Open the browser's folder picker. Resolves with every file in the folder (none if cancelled). */
export function pickAudioFolder(): Promise<PathFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    input.multiple = true;
    input.style.display = 'none';
    const done = () => {
      const files = Array.from(input.files ?? [])
        .filter((f) => !f.name.startsWith('.') && !f.webkitRelativePath.includes('/__MACOSX/'))
        .slice(0, MAX_FOLDER_FILES);
      resolve(files.map((file) => ({ file, path: file.webkitRelativePath || file.name })));
      input.remove();
    };
    input.addEventListener('change', done);
    input.addEventListener('cancel', done);
    document.body.appendChild(input);
    input.click();
  });
}
