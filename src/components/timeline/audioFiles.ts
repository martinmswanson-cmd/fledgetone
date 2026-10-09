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
