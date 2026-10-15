/**
 * The producer tag: a short sound (a voice saying the producer's name) laid over beat previews so
 * they can't be used without paying. One slot, kept in this browser like the reference track
 * (keptSounds.ts), never in a project. Everything that needs the tag asks here, so a fuller
 * producer-tag feature can take over by changing only this file.
 */
import { keepSound, keptSound } from './keptSounds';
import { decodeSound, importSoundFile } from './soundLibrary';
import { parseTag, TAG_STORAGE_KEY } from '../store/producerTag';

/**
 * The tag sound, if one is set: its library id and name. The one set here first, else the tag
 * recorded or imported in Arrange a beat (see store/producerTag.ts), so either place works.
 */
export function producerTagSound(): { id: string; name: string } | null {
  const own = keptSound('producerTag');
  if (own) return own;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TAG_STORAGE_KEY);
  } catch {
    // storage blocked: no tag
  }
  const tag = parseTag(raw);
  return tag ? { id: tag.soundId, name: tag.name } : null;
}

/** Set the tag from a sound file (kept in this browser), or clear it (null). */
export async function setProducerTag(file: File | null): Promise<{ id: string; name: string } | null> {
  if (!file) {
    keepSound('producerTag', null);
    return null;
  }
  const meta = await importSoundFile(file, file.name);
  const sound = { id: meta.id, name: file.name };
  keepSound('producerTag', sound);
  return sound;
}

/** The tag's samples at `sampleRate` (one or two channels), or null if none is set or it's gone from this browser. */
export async function producerTagChannels(sampleRate: number): Promise<Float32Array[] | null> {
  const tag = producerTagSound();
  if (!tag) return null;
  try {
    const buffer = await decodeSound(tag.id, sampleRate);
    return Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
  } catch {
    return null;
  }
}
