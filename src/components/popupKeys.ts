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
 *
 * What opened a popup, when it isn't given: what was pressed to open it (its control, or the
 * thing itself, a ruler or a lane, focused just for the moment), else what had focus. A press
 * that keeps focus where it was (a tempo flag, which drags) still leaves its popup something to
 * go back to and on from: otherwise Tab and Shift+Tab out of a popup moved to the end of the page
 * or out of it, the popup staying open.
 */
import { useEffect, useRef, type RefObject } from 'react';

/** Where a popup sits: in its place in the page (next to what opened it), or moved to the end of <body>. */
export type PopupPlace = 'inline' | 'portal';

/**
 * Where focus is, seen from an open popup: on its first or last stop (`only`: its one stop),
 * between them (`inside`), on the control that opened it (`opener`), on nothing at all with that
 * control known (`nowhere`: a click that took focus nowhere opened it), or anywhere else (`outside`).
 */
export type FocusAt = 'first' | 'last' | 'only' | 'inside' | 'opener' | 'nowhere' | 'outside';

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
  // (Focus on nothing: Tab goes into the popup, Shift+Tab back on what opened it)
  if (at === 'nowhere') return back ? { close: true, focus: hasOpener ? 'opener' : 'natural' } : { close: false, focus: 'first' };
  if (at === 'outside') return { close: true, focus: 'natural' };
  if (back) return at === 'first' || at === 'only' ? { close: true, focus: hasOpener ? 'opener' : 'natural' } : null;
  if (at === 'last' || at === 'only') return { close: true, focus: place === 'portal' && hasOpener ? 'after-opener' : 'natural' };
  return null;
}

/**
 * Where focus is, from how many of the popup's stops come before and after it (`inPopup`: it's
 * inside the popup; `onNothing`: on no element, with what opened the popup known).
 */
export function focusAt(inPopup: boolean, onOpener: boolean, before: number, after: number, onNothing = false): FocusAt {
  if (!inPopup) return onOpener ? 'opener' : onNothing ? 'nowhere' : 'outside';
  if (!before && !after) return 'only';
  return !before ? 'first' : !after ? 'last' : 'inside';
}

/** How long after a key press a menu opening counts as opened from the keyboard. */
export const KEY_OPEN_MS = 1000;

/**
 * The last thing the user pressed: a key or the pointer (`kind`), and when (ms). A menu opening
 * within KEY_OPEN_MS of a key press, with no pointer press since, was opened from the keyboard.
 */
export function createInputMemory<T = unknown>() {
  let last: { kind: 'key' | 'pointer'; at: number; target?: T } | null = null;
  return {
    seen: (kind: 'key' | 'pointer', at: number, target?: T) => {
      last = { kind, at, target };
    },
    fromKeys: (now: number) => !!last && last.kind === 'key' && now - last.at <= KEY_OPEN_MS,
    /** What a press just now pressed (a popup opening now was opened by it), else nothing */
    pressed: (now: number): T | undefined => (last && last.kind === 'pointer' && now - last.at <= KEY_OPEN_MS ? last.target : undefined),
  };
}

/**
 * What a popup goes back to (see the top of this file), from what it was given (`given`; a
 * function or ref that has none gives null), what was pressed to open it (`pressed`: its nearest
 * control, or the pressed thing itself), and what had focus as it opened (`focused`). Each must
 * still be in the page and outside the popup (`usable`).
 */
export function pickOpener<T>(
  { given, pressedControl, pressedThing, focused }: { given?: T | null; pressedControl?: T | null; pressedThing?: T | null; focused?: T | null },
  usable: (el: T) => boolean
): { el: T; borrowed: boolean } | null {
  for (const el of [given, pressedControl, focused]) if (el && usable(el)) return { el, borrowed: false };
  return pressedThing && usable(pressedThing) ? { el: pressedThing, borrowed: true } : null;
}

const inputs = createInputMemory<Element>();
if (typeof window !== 'undefined') {
  // (Capture: a handler that stops a key or a press still counts)
  window.addEventListener('keydown', (e) => !['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) && inputs.seen('key', performance.now()), true);
  window.addEventListener('pointerdown', (e) => inputs.seen('pointer', performance.now(), e.target instanceof Element ? e.target : undefined), true);
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

/** The nearest control at or around `el` that focus can go to (a disabled one can't) */
function controlAt(el: Element | undefined): HTMLElement | null {
  const c = el?.closest<HTMLElement>(STOPS);
  return c && !(c as HTMLButtonElement).disabled ? c : null;
}

/**
 * Focus `el`, which may be no control at all (a ruler pressed to open its menu): it takes focus for
 * the moment (tabindex -1, gone as focus leaves), so Tab goes on from its place in the page.
 */
function focusOn(el: HTMLElement, borrowed: boolean) {
  if (borrowed && !el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
  }
  el.focus({ preventScroll: true });
}

/** Where focus (`active`) is, seen from the popup `box` opened by `opener`. */
function whereIs(box: Element, opener: Element | null, active: Element | null): FocusAt {
  const inPopup = !!active && box.contains(active);
  if (!inPopup || !active) return focusAt(false, !!active && !!opener?.contains(active), 0, 0, !!opener && (!active || active === document.body));
  const stops = tabStops(box).filter((s) => s !== active);
  const before = stops.filter((s) => !s.contains(active) && active.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING).length;
  const after = stops.filter((s) => active.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING).length;
  return focusAt(true, false, before, after);
}

/**
 * Where the arrow keys go in a menu: its items in rows (a group of them side by side, such as the
 * track menu's colours, is one row; every other item is a row of its own). Up and Down move a row
 * (onto a row's chosen item, else its first; round from the end), Left and Right along a row,
 * Home and End to the first and last row. `rows`: each row's item count; `chosen`: each row's
 * chosen item (-1: none). From item `item` of row `row`; null: the key isn't the menu's.
 */
export function menuArrow(rows: number[], chosen: number[], row: number, item: number, key: string): { row: number; item: number } | null {
  const land = (r: number) => ({ row: r, item: chosen[r] >= 0 ? chosen[r] : 0 });
  const n = rows.length;
  if (!n) return null;
  if (key === 'ArrowDown') return land((row + 1) % n);
  if (key === 'ArrowUp') return land((row - 1 + n) % n);
  if (key === 'Home') return land(0);
  if (key === 'End') return land(n - 1);
  if (key === 'ArrowRight' || key === 'ArrowLeft') return rows[row] > 1 ? { row, item: (item + (key === 'ArrowRight' ? 1 : -1) + rows[row]) % rows[row] } : null;
  return null;
}

/** A menu's items (enabled, shown) in rows, as menuArrow takes them: a [role="group"] of items is one row. */
function menuRows(box: Element): HTMLElement[][] {
  const items = [...box.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter((i) => !(i as HTMLButtonElement).disabled && i.getClientRects().length);
  const rows: HTMLElement[][] = [];
  let group: Element | null = null;
  for (const i of items) {
    const g = i.closest('[role="group"]');
    if (g && box.contains(g) && g === group) rows[rows.length - 1].push(i);
    else rows.push([i]);
    group = g && box.contains(g) ? g : null;
  }
  return rows;
}

/** The item a menu opened from the keyboard starts on: its first plain item (not a colour or a check), else its first stop. */
function firstItem(box: Element): HTMLElement | undefined {
  const rows = menuRows(box);
  return rows.find((r) => r.length === 1 && r[0].getAttribute('role') === 'menuitem')?.[0] ?? rows[0]?.[0] ?? tabStops(box)[0];
}

interface PopupKeysOptions {
  /** Whether the popup is open now (its element in the page); default true */
  open?: boolean;
  /** Close it */
  onClose: () => void;
  /** The control that opened it; default: what was pressed to open it, else whatever had focus when it opened (see pickOpener) */
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
  const pressedAtOpen = useRef<Element | undefined>(undefined);
  const keyOpened = useRef(false);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    focusedAtOpen.current = document.activeElement;
    keyOpened.current = inputs.fromKeys(performance.now());
    pressedAtOpen.current = inputs.pressed(performance.now());
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
    const usable = (el: Element): boolean => el instanceof HTMLElement && el !== document.body && el.isConnected && !box.contains(el);
    const found = () => {
      const given = latest.current.opener;
      const pressed = pressedAtOpen.current;
      const thing = pressed instanceof HTMLElement ? pressed : pressed?.parentElement;
      return pickOpener<Element>(
        { given: typeof given === 'function' ? given() : given?.current, pressedControl: controlAt(pressed), pressedThing: thing, focused: focusedAtOpen.current },
        usable
      ) as { el: HTMLElement; borrowed: boolean } | null;
    };
    const openerNow = (): HTMLElement | null => found()?.el ?? null;
    const backTo = (o: HTMLElement) => focusOn(o, !!found()?.borrowed);
    const close = () => latest.current.onClose();
    if (menu && keyOpened.current && !box.contains(document.activeElement)) firstItem(box)?.focus({ preventScroll: true });

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
      if (menu && active && box.contains(active) && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        // (Only from an item: a number box in the menu keeps its arrows)
        const rows = menuRows(box);
        const row = rows.findIndex((r) => r.includes(active as HTMLElement));
        if (row < 0) return;
        const chosen = rows.map((r) => r.findIndex((i) => i.getAttribute('aria-checked') === 'true'));
        const to = menuArrow(
          rows.map((r) => r.length),
          chosen,
          row,
          rows[row].indexOf(active as HTMLElement),
          e.key
        );
        // (The page never scrolls under a menu: that would close it)
        e.preventDefault();
        if (to) rows[to.row][to.item]?.focus();
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
        backTo(o);
        close();
        return;
      } else if (move.focus === 'after-opener' && o) {
        // To the stop after the opener, as the browser's Tab from it would go. (Found here: the
        // browser's own Tab is lost when it starts from a select that closing the popup took away)
        e.preventDefault();
        const next = tabStops(document.body).find((stop) => !box.contains(stop) && stop !== o && !!(o.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING));
        close();
        if (next) next.focus();
        else backTo(o);
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
        const o = !now || now === document.body || box.contains(now) ? found() : null;
        if (o) focusOn(o.el, o.borrowed);
      }
    };
    // (Set up for each opening; the latest onClose and opener are read through `latest`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
