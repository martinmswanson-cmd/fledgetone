/**
 * Going back to a kept version (versions.ts): it opens as the song, and the song open until then
 * is kept as a version first, so going back can itself be undone from the same list.
 */
import { currentProject, useTimelineStore } from './timelineStore';
import { keepVersion, readVersion, refreshVersions } from './versions';
import { captureWamStatesNow } from '../audio/wamHost';

/** Open version `id` as the song. Resolves to the song's name, or throws (the version can't be read). */
export async function restoreVersion(id: string): Promise<string> {
  const project = await readVersion(id);
  // (With the plugins' latest settings: they otherwise reach the tracks every few seconds)
  captureWamStatesNow();
  keepVersion(currentProject(), 'restore');
  useTimelineStore.getState().loadProject(project);
  void refreshVersions();
  return project.name;
}
