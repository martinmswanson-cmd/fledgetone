import type { AutosaveFailure } from './project';

/**
 * What the studio and Pocket say when the song isn't autosaved, by why (see AutosaveFailure). Only
 * 'full' points to Dismiss: it's given only while the studio's Restore banner offers the last
 * session, and dismissing it makes room. Pocket has no Dismiss: there it's the file to save.
 */
export function notAutosavedWords(reason: AutosaveFailure | undefined, where: 'studio' | 'pocket'): string {
  const save = where === 'pocket' ? 'Save the file to keep your work.' : 'Use Save.';
  switch (reason) {
    case 'full':
      return where === 'pocket' ? `Not autosaved: browser storage is full. ${save}` : 'Not autosaved: browser storage is full. Use Save, or Dismiss your last session below to make room.';
    case 'too-big':
      return `Not autosaved: this project is too big for browser storage. ${save}`;
    case 'kept':
      return `Not autosaved: there's no room to keep a full copy of what this song opened without, so the stored copy is kept as it was. ${save}`;
    case 'unreadable':
      return `Not autosaved: the song stored in this browser couldn't be read and there's no room to copy it aside, so it's kept as it was. ${save}`;
    default:
      return `Not autosaved: this browser is blocking storage for this site. ${save}`;
  }
}
