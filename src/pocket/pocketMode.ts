/**
 * Which interface opens: Pocket (the phone version, src/pocket/) or the full studio. Phones get
 * Pocket unless the person chose the studio; `?pocket` or `?studio` in the address picks one and
 * remembers it (so a computer can try Pocket too). The same song plays in both: they share the
 * store, the engine and the autosave.
 */
import { isNativeApp } from '../native/nativeApp';

const CHOICE_KEY = 'fledgetone.interface';

/** A phone: a narrow screen driven by touch (a tablet in landscape or a laptop with a touch screen is not one). */
export const onPhone = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const touchOnly = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const narrow = Math.min(window.screen.width, window.screen.height) < 600;
  return touchOnly && narrow;
};

type Choice = 'pocket' | 'studio';

function stored(): Choice | null {
  try {
    const v = localStorage.getItem(CHOICE_KEY);
    return v === 'pocket' || v === 'studio' ? v : null;
  } catch {
    return null;
  }
}

/** Remember which interface to open (and open it). */
export function chooseInterface(choice: Choice): void {
  try {
    localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Private browsing: the address below still picks it this time
  }
  const url = new URL(location.href);
  url.searchParams.delete('pocket');
  url.searchParams.delete('studio');
  url.searchParams.set(choice, '');
  location.replace(url.toString().replace(/([?&](?:pocket|studio))=(?=&|#|$)/, '$1'));
}

/** Whether this page opens Pocket. */
export function wantsPocket(): boolean {
  const params = new URLSearchParams(location.search);
  if (params.has('pocket') || params.has('studio')) {
    const choice: Choice = params.has('pocket') ? 'pocket' : 'studio';
    try {
      localStorage.setItem(CHOICE_KEY, choice);
    } catch {
      // Not remembered: fine
    }
    return choice === 'pocket';
  }
  // (The phone app opens Pocket, on a tablet too, unless the studio was chosen)
  return (stored() ?? (onPhone() || isNativeApp() ? 'pocket' : 'studio')) === 'pocket';
}
