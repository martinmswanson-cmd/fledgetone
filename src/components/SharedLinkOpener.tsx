/**
 * Opens a song shared as a link (#s=... in the address, see shareLink.ts), on page load or when
 * one is pasted into an open page, asking first if there's work on the timeline. Renders nothing.
 */
import { useEffect } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { hasWork } from '../store/project';
import { isShareHash, projectFromHash } from '../store/shareLink';
import { showToast } from './timeline/toastStore';

/** Take the shared song out of the address, so a reload doesn't open it again over later work. */
const clearHash = () => history.replaceState(null, '', `${location.pathname}${location.search}`);

/**
 * Opens a song shared as a link (see shareLink.ts): when the page is opened with "#s=..." (or an older "#song=...") in
 * its address, or one is pasted into the address of an open page. A page that already has work
 * on its timeline asks first.
 */
export function SharedLinkOpener(): null {
  useEffect(() => {
    const openFromHash = async (askFirst: boolean) => {
      if (!isShareHash(location.hash)) return;
      try {
        const project = await projectFromHash(location.hash);
        if (!project) return;
        if (askFirst && hasWork(useTimelineStore.getState()) && !window.confirm(`Open the shared song "${project.name}"? It replaces what's on the timeline.`)) {
          clearHash();
          return;
        }
        useTimelineStore.getState().loadProject(project);
        showToast(`Opened "${project.name}" from a shared link`);
      } catch {
        showToast("Couldn't open the shared song: the link may have been cut short");
      }
      clearHash();
    };
    void openFromHash(false);
    const onHash = () => void openFromHash(true);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return null;
}
