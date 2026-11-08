/**
 * Tab and the app's popups (the menu bar's menus, the floating pickers, popovers and right-click
 * menus): a Tab or Shift+Tab that takes focus out of an open popup closes it, so a popup never
 * stays open behind the keyboard (every global shortcut is off while a menu or dialog is open, see
 * keyboard.ts).
 *
 * Shift+Tab off its top goes back to the control that opened it; Tab off its end moves on as the
 * browser takes it when the popup sits in its place in the page, and to the stop after that
 * control when it was moved to the end of the page (portalled to <body>), as if it sat beside it;
 * a Tab from that control while its popup is open goes into the popup. Menus opened from the
 * keyboard take focus on their first item, their items move with the arrow keys, and focus goes
 * back to where it was when they close. Nothing here acts on the pointer: the mouse works as it
 * always has (a click on a popup's own text, which moves focus nowhere, keeps it open).
 */
import { useEffect, useRef, type RefObject } from 'react';

/** Where a popup sits: in its place in the page (next to what opened it), or moved to the end of <body>. */
export type PopupPlace = 'inline' | 'portal';

/**
 * Where focus is, seen from an open popup: on its first or last stop (`only`: its one stop),
 * between them (`inside`), on the control that opened it (`opener`), or anywhere else (`outside`).
 */
export type FocusAt = 'first' | 'last' | 'only' | 'inside' | 'opener' | 'outside';

/**
 * What a Tab does to an open popup: whether it closes (`close`), and where focus goes: `natural` lets
 * the browser move it on (the popup closes once focus lands outside it), `opener` back on the
 * control that opened it, `after-opener` to the stop after that control, `first` to the popup's first stop.
 */
export interface TabMove {
  close: boolean;
  focus: 'natural' | 'opener' | 'after-opener' | 'first';
}

/**
 * What a Tab (`back`: Shift+Tab) pressed with focus `at` does to an open popup sitting at `place`,
 * with or without a control to go back to (`hasOpener`). Null: nothing, focus moves within it.
 */
export function tabMove(at: FocusAt, back: boolean, place: PopupPlace, hasOpener: boolean): TabMove | null {
  if (at === 'opener') return back ? { close: true, focus: 'natural' } : { close: false, focus: 'first' };
  if (at === 'outside') return { close: true, focus: 'natural' };
  if (back) return at === 'first' || at === 'only' ? { close: true, focus: hasOpener ? 'opener' : 'natural' } : null;
  if (at === 'last' || at === 'only') return { close: true, focus: place === 'portal' && hasOpener ? 'after-opener' : 'natural' };
  return null;
}

/** Where focus is, from how many of the popup's stops come before and after it (`inPopup`: it's inside the popup). */
export function focusAt(inPopup: boolean, onOpener: boolean, before: number, after: number): FocusAt {
  if (!inPopup) return onOpener ? 'opener' : 'outside';
  if (!before && !after) return 'only';
  return !before ? 'first' : !after ? 'last' : 'inside';
}

/** How long after a key press a menu opening counts as opened from the keyboard. */
export const KEY_OPEN_MS = 1000;

/**
 * The last thing the user pressed: a key or the pointer (`kind`), and when (ms). A menu opening
 * within KEY_OPEN_MS of a key press, with no pointer press since, was opened from the keyboard.
 */
export function createInputMemory() {
  let last: { kind: 'key' | 'pointer'; at: number } | null = null;
  return {
    seen: (kind: 'key' | 'pointer', at: number) => {
      last = { kind, at };
    },
    fromKeys: (now: number) => !!last && last.kind === 'key' && now - last.at <= KEY_OPEN_MS,
  };
}

const inputs = createInputMemory();
if (typeof window !== 'undefined') {
  // (Capture: a handler that stops a key or a press still counts)
  window.addEventListener('keydown', (e) => !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) && inputs.seen('key', performance.now()), true);
  window.addEventListener('pointerdown', () => inputs.seen('pointer', performance.now()), true);
}

const STOPS = 'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable]:not([contenteditable="false"])';

/** The stops Tab visits inside `box`, in page order (one radio of a group: its checked one, else its first). */
export function tabStops(box: Element): HTMLElement[] {
  const radios = new Map<string, HTMLInputElement>();
  const stops = [...box.querySelectorAll<HTMLElement>(STOPS)].filter((el) => {
    if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled || el.closest('[inert]')) return false;
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false;
    if (!el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') return false;
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      const kept = radios.get(el.name);
      if (!kept || (el.checked && !kept.checked)) radios.set(el.name, el);
    }
    return true;
  });
  return stops.filter((el) => !(el instanceof HTMLInputElement && el.type === 'radio' && el.name) || radios.get(el.name) === el);
}

/** Where focus (`active`) is, seen from the popup `box` opened by `opener`. */
function whereIs(box: Element, opener: Element | null, active: Element | null): FocusAt {
  const inPopup = !!active && box.contains(active);
  if (!inPopup || !active) return focusAt(false, !!active && !!opener?.contains(active), 0, 0);
  const stops = tabStops(box).filter((s) => s !== active);
  const before = stops.filter((s) => !s.contains(active) && active.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING).length;
  const after = stops.filter((s) => active.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING).length;
  return focusAt(true, false, before, after);
}

interface PopupKeysOptions {
  /** Whether the popup is open now (its element in the page); default true */
  open?: boolean;
  /** Close it */
  onClose: () => void;
  /** The control that opened it; default: whatever had focus when it opened */
  opener?: RefObject<HTMLElement | null> | (() => HTMLElement | null | undefined);
  place: PopupPlace;
  /**
   * A menu of [role="menuitem"]s: opened from the keyboard it takes focus on its first item, and
   * gives focus back to its opener when it closes; the arrow keys move between its items
   */
  menu?: boolean;
}

/** Tab and Shift+Tab out of the popup `ref` close it (see the top of this file). */
export function usePopupKeys(ref: RefObject<HTMLElement | null>, { open = true, onClose, opener, place, menu = false }: PopupKeysOptions): void {
  // What had focus as it opened, and whether a key opened it (read on the first render, before anything in it takes focus)
  const focusedAtOpen = useRef<Element | null>(null);
  const keyOpened = useRef(false);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    focusedAtOpen.current = document.activeElement;
    keyOpened.current = inputs.fromKeys(performance.now());
  }
  wasOpen.current = open;
  // (The latest of each, for the handlers set up once per opening)
  const latest = useRef({ onClose, opener });
  useEffect(() => {
    latest.current = { onClose, opener };
  });

  useEffect(() => {
    const box = ref.current;
    if (!open || !box) return;
    const openerNow = (): HTMLElement | null => {
      const given = latest.current.opener;
      const el = typeof given === 'function' ? given() : given ? given.current : focusedAtOpen.current;
      return el instanceof HTMLElement && el !== document.body && el.isConnected && !box.contains(el) ? el : null;
    };
    const close = () => latest.current.onClose();
    if (menu && keyOpened.current && !box.contains(document.activeElement)) tabStops(box)[0]?.focus({ preventScroll: true });

    // A Tab is moving focus on (as the browser takes it): the popup closes if it lands outside
    let tabbing = 0;
    const onFocusIn = (e: FocusEvent) => {
      if (!tabbing) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || box.contains(t) || openerNow()?.contains(t) || t.closest('[data-tour-card]')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const active = document.activeElement;
      if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && active && box.contains(active)) {
        // (Only from an item: a number box in the menu keeps its arrows)
        const items = [...box.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter((i) => !(i as HTMLButtonElement).disabled && i.getClientRects().length);
        const at = items.indexOf(active as HTMLElement);
        if (at < 0) return;
        e.preventDefault();
        items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus in another popup (one opened from this one) or a tutorial's card: theirs to handle
      if (active && !box.contains(active) && active.closest('[role="menu"], [role="dialog"], [data-tour-card]')) return;
      const o = openerNow();
      const move = tabMove(whereIs(box, o, active), e.shiftKey, place, !!o);
      if (!move) return;
      if (move.focus === 'first') {
        const first = tabStops(box)[0];
        if (first) {
          e.preventDefault();
          first.focus();
          return;
        }
      } else if (move.focus === 'opener' && o) {
        e.preventDefault();
        o.focus();
        close();
        return;
      } else if (move.focus === 'after-opener' && o) {
        // The browser's Tab goes on from the opener: to the stop after it
        o.focus();
        close();
        return;
      }
      window.clearTimeout(tabbing);
      tabbing = window.setTimeout(() => (tabbing = 0), 0);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn, true);
      window.clearTimeout(tabbing);
      // A menu the keyboard opened gives focus back as it closes, unless something else took it
      if (menu && keyOpened.current) {
        const now = document.activeElement;
        if (!now || now === document.body || box.contains(now)) openerNow()?.focus({ preventScroll: true });
      }
    };
    // (Set up for each opening; the latest onClose and opener are read through `latest`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
