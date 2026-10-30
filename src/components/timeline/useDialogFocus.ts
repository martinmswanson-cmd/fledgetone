/**
 * A modal dialog's keys and focus (Modal's, and a dialog laid out its own way such as the audition
 * pads): it takes focus as it opens, Esc closes it, Tab goes round inside it, and focus goes back
 * where it was when it closes.
 */
import { useEffect, useRef, type RefObject } from 'react';

/** What Tab moves between inside the dialog. */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The dialog on top: the last one in the page that holds the keys (this one, the guide, Search). */
const topDialog = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].pop() ?? null;

/**
 * A dialog's keys and focus, for `dialog` (a [role="dialog"][aria-modal="true"] element): it takes
 * focus as it opens unless a control inside already has it, Esc calls `onClose` wherever focus is
 * (unless another dialog is on top), Tab goes round inside it, and focus goes back where it was
 * when it closes. Modal uses it; so can a dialog laid out its own way (the audition pads).
 */
export function useDialogFocus(dialog: RefObject<HTMLElement | null>, onClose: () => void): void {
  // Where focus was before the dialog opened (read on the first render, before anything in it autofocuses)
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  // (The latest onClose, for the key handler set up once)
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  // Take focus unless a control inside already has it (autoFocus does nothing on a disabled
  // button). Esc is heard on the window, so it works wherever focus is; Tab goes round inside
  useEffect(() => {
    if (dialog.current && !dialog.current.contains(document.activeElement)) dialog.current.focus();
    const onKey = (e: KeyboardEvent) => {
      const el = dialog.current;
      if (!el) return;
      // Another dialog on top of this one (the guide, a popover) has the keys; with focus in none,
      // the one opened last (two can be open when Search opens one over another)
      const other = document.activeElement?.closest('[role="dialog"]');
      if (other ? other !== el : topDialog() !== el) return;
      if (e.key === 'Escape') {
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // A tutorial's card is part of the round too: a step inside the dialog may need its Next
      const card = document.querySelector<HTMLElement>('[data-tour-card]');
      const focusable = [el, ...(card ? [card] : [])].flatMap((box) => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)]).filter((f) => f.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = el.contains(document.activeElement) || !!card?.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      } else if (card) {
        // Between the dialog and the card, which needn't be next to each other in the page
        const at = focusable.indexOf(document.activeElement as HTMLElement);
        if (at < 0) return;
        e.preventDefault();
        focusable[at + (e.shiftKey ? -1 : 1)]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    const back = opener.current;
    return () => {
      window.removeEventListener('keydown', onKey);
      // (Its opener gone, as a menu item or the search box is: the dialog still open under it, if any)
      const to = back?.isConnected ? back : topDialog();
      to?.focus({ preventScroll: true });
    };
    // (Set up once, for the dialog's life)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

