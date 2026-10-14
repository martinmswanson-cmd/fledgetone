/**
 * Rows and strips scrolled out of sight are skipped by the browser (content-visibility: hidden,
 * set only once they're out of sight, so the rows on screen aren't clipped to their boxes; `auto`
 * didn't save the drawing): not drawn, not laid out, and their meters not read. On a big song
 * most of the timeline's tracks and the mixer's strips are out of sight, and every frame the page
 * changed (the playhead's time, a meter) the browser went over all of them again: most of the
 * page's time while a big song played.
 *
 * One IntersectionObserver for all of them; each element is switched straight on the page, so a
 * row going in or out of sight doesn't re-render it. A margin keeps the ones just out of sight
 * drawn, so scrolling doesn't show them blank.
 */
import { useEffect, type RefObject } from 'react';

const hidden = new WeakSet<Element>();
let observer: IntersectionObserver | null = null;

function watch(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        if (e.isIntersecting) {
          hidden.delete(el);
          el.style.contentVisibility = '';
          el.style.containIntrinsicSize = '';
        } else if (e.boundingClientRect.width && e.boundingClientRect.height) {
          // Kept at the size it had, so the scrollbars and the rows under it don't move (the
          // observer's own measure: asking the element made the browser lay the page out again
          // for each one, a sixth of a second when a big song opened)
          el.style.containIntrinsicSize = `auto ${e.boundingClientRect.width}px auto ${e.boundingClientRect.height}px`;
          el.style.contentVisibility = 'hidden';
          hidden.add(el);
        }
      }
    },
    { rootMargin: '300px' }
  );
  return observer;
}

/** Whether `el` is skipped as out of sight now (a meter in it needn't be read). */
export const isOffscreen = (el: Element | null | undefined): boolean => {
  for (let e = el; e; e = e.parentElement) if (hidden.has(e)) return true;
  return false;
};

/** Skip drawing the element in `ref` while it's scrolled out of sight. */
export function useSkipOffscreen(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const o = watch();
    o.observe(el);
    return () => {
      o.unobserve(el);
      hidden.delete(el);
      el.style.contentVisibility = '';
      el.style.containIntrinsicSize = '';
    };
  }, [ref]);
}
