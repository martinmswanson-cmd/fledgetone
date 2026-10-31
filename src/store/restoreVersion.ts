/**
 * Going back to a kept version (versions.ts): it opens as the song, and the song open until then
 * is kept as a version first, so going back can itself be undone from the same list.
 */
import { currentProject, useTimelineStore } from './timelineStore';
import { keepVersion, readVersion, refreshVersions } from './versions';
import { captureWamStatesNow } from '../audio/wamHost';
import { unreadWords } from './project';

/**
 * Open version `id` as the song. Resolves to the song's name, and what of it couldn't open, in
 * words ('' when it all did: the version itself stays kept as it is either way), or throws (the
 * version can't be read).
 */
export async function restoreVersion(id: string): Promise<{ name: string; without: string }> {
  const project = await readVersion(id);
  // (With the plugins' latest settings: they otherwise reach the tracks every few seconds)
  captureWamStatesNow();
  keepVersion(currentProject(), 'restore');
  useTimelineStore.getState().loadProject(project);
  void refreshVersions();
  const { parts, over } = project.unread ? unreadWords(project.unread) : { parts: '', over: '' };
  return { name: project.name, without: [parts && `${parts} this version can't read`, over].filter(Boolean).join(', and without ') };
}
