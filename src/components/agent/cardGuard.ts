/**
 * Accept and Dismiss only for the card the musician meant, by a deliberate press:
 *
 * - a card that has just appeared or moved on screen (a new suggestion, a card above it growing,
 *   the list scrolled by anything but the musician) ignores them for SETTLE_MS;
 * - a pointer's press counts only if it went down and came up on the same button with the card
 *   where it was; a key's only if Enter went down on that button just now (not held); a click with
 *   nothing behind it is an assistive tool's (a screen reader's, voice control's) and counts (a
 *   press left behind, aborted or long gone, doesn't stop it). Space never presses Accept, and a
 *   double-click's second click is never a press. A click that doesn't count always says why.
 *
 * So a click aimed at one card never lands on another that slid under the pointer, and the second
 * press that accepts without listening is always a separate one.
 */
import type React from 'react';

/** How long a card that appeared or moved ignores Accept and Dismiss, ms. */
export const SETTLE_MS = 1000;
/** A scroll this soon after the musician's own wheel, touch, key or press in the list is theirs, ms. */
const OWN_SCROLL_MS = 600;

/** Where each card was last seen on screen, and since when. */
const seen = new Map<string, { top: number; since: number }>();
let ownInputAt = -Infinity;

/** Note where the cards in `list` are now (the panel calls this after every change of layout, and on scrolls). */
export function noteCardPlaces(list: HTMLElement | null, now = performance.now()): void {
  if (!list) return;
  const here = new Set<string>();
  for (const el of list.querySelectorAll<HTMLElement>('[data-suggestion]')) {
    const id = el.dataset.suggestion!;
    here.add(id);
    const top = el.getBoundingClientRect().top;
    const was = seen.get(id);
    if (!was || Math.abs(was.top - top) > 1) seen.set(id, { top, since: now });
  }
  for (const id of [...seen.keys()]) if (!here.has(id)) seen.delete(id);
}

/** The musician did something in the list that scrolls it (a wheel, a touch, a key, a press). */
export function noteOwnInput(): void {
  ownInputAt = performance.now();
}

/** The list scrolled: by the musician, the cards keep their time; by anything else, they moved. */
export function noteListScroll(list: HTMLElement | null, now = performance.now()): void {
  if (!list) return;
  if (now - ownInputAt < OWN_SCROLL_MS) {
    // Moved by the musician's own hand: where they are now is where they've been
    for (const el of list.querySelectorAll<HTMLElement>('[data-suggestion]')) {
      const was = seen.get(el.dataset.suggestion!);
      if (was) was.top = el.getBoundingClientRect().top;
    }
    return;
  }
  noteCardPlaces(list, now);
}

/** Whether card `id` has stayed where it is long enough to be pressed. */
export const cardSettled = (id: string, now = performance.now()): boolean => {
  const at = seen.get(id);
  return !!at && now - at.since >= SETTLE_MS;
};

/** A press older than this when its click comes isn't the click's (an aborted one left behind), ms. */
export const PRESS_MAX_MS = 1000;

/** The press a pointer or Enter started: the button, where its card was, which pointer button, and when. */
let down: { button: EventTarget; top: number; key: boolean; pointerButton: number; at: number } | null = null;

const cardTop = (el: Element) => (el.closest('[data-suggestion]') as HTMLElement | null)?.getBoundingClientRect().top ?? 0;

/** A key is held down on a guarded button (auto-repeating): its clicks never count, until it's let go. */
let repeating = false;

// A press that ends anywhere (dragged off the button, cancelled, a key let go elsewhere) is over:
// what it left behind mustn't decide the next press (an assistive tool's click would be ignored
// for a pointer's press long gone). Cleared just after the event, so the click that a press on
// the button itself makes (it comes after its pointerup or keyup) still sees it.
let listening = false;
function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const later = (fn: () => void) => window.setTimeout(fn, 0);
  window.addEventListener(
    'pointerup',
    () => {
      const was = down;
      if (was && !was.key) later(() => down === was && (down = null));
    },
    true
  );
  window.addEventListener(
    'pointercancel',
    () => {
      if (down && !down.key) down = null;
    },
    true
  );
  window.addEventListener(
    'keyup',
    () => {
      const was = down;
      later(() => {
        repeating = false;
        if (was && was.key && down === was) down = null;
      });
    },
    true
  );
  window.addEventListener('blur', () => {
    down = null;
    repeating = false;
  });
}

/** On a guarded button's pointerdown. */
export function guardDown(e: React.PointerEvent): void {
  listen();
  down = { button: e.currentTarget, top: cardTop(e.currentTarget), key: false, pointerButton: e.button, at: performance.now() };
}

/** On a guarded button's keyup: a held key let go (just after: Space's click on Dismiss comes after its keyup). */
export function guardKeyUp(): void {
  window.setTimeout(() => (repeating = false), 0);
}

/** On a guarded button's keydown: Enter (not held) starts a press; Space does nothing (and doesn't play the song). */
export function guardKey(e: React.KeyboardEvent): void {
  listen();
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.key !== 'Enter') return;
  if (e.repeat) repeating = true;
  down = e.repeat ? null : { button: e.currentTarget, top: cardTop(e.currentTarget), key: true, pointerButton: -1, at: performance.now() };
}

/** On another guarded button's keydown (Dismiss): Enter or Space, not held, starts a press. */
export function guardKeyPress(e: React.KeyboardEvent): void {
  listen();
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.repeat) repeating = true;
  down = e.repeat ? null : { button: e.currentTarget, top: cardTop(e.currentTarget), key: true, pointerButton: -1, at: performance.now() };
}

/**
 * What guardClick made of a click: 'ok' (a press), 'unsettled' (the card just appeared or moved),
 * or why else it was ignored: a double-click's second click ('double'), a key held down ('held'),
 * a pointer's press that didn't start and end on this button ('unfinished').
 */
export type GuardResult = 'ok' | 'unsettled' | 'double' | 'held' | 'unfinished';

/** What the card says for a click that didn't count (never nothing). */
export const GUARD_WORDS: Record<Exclude<GuardResult, 'ok'>, string> = {
  unsettled: 'That card just appeared or moved: press again if you meant it.',
  double: 'A double-click counts as one press: press again, once, if you meant it.',
  held: 'A key held down doesn’t press it: let go, then press once.',
  unfinished: 'That press didn’t start and end on this button: press it again if you meant it.',
};

/**
 * Whether a click on a guarded button of card `id` should count:
 *
 * - a pointer's click: only one that went down and came up on this button, the card settled and
 *   where it was ('unsettled' if it had just appeared or moved), never a double-click's second;
 * - a key's click (Enter, or Space on Dismiss): one that went down on this button, not held;
 * - a click with no pointer or key behind it (what screen readers, voice control and switch
 *   access send): a press too, unless a key is being held. A press left behind (on another
 *   button, or over PRESS_MAX_MS ago) counts as none.
 *
 * Presses from keys and assistive tools aren't checked for settling: nothing slides under them.
 */
export function guardClick(e: React.MouseEvent, id: string, now = performance.now()): GuardResult {
  const was = down;
  down = null;
  const mine = was && was.button === e.currentTarget ? was : null;
  if (e.detail > 1) return 'double';
  if (e.detail === 0) {
    if (repeating) return 'held';
    // (Enter's press on this button, or no press at all: an assistive tool's click; a press left
    // behind, on another button or long gone, is none)
    const fresh = mine && now - mine.at <= PRESS_MAX_MS ? mine : null;
    return !fresh || fresh.key ? 'ok' : 'unfinished';
  }
  if (!mine || mine.key || mine.pointerButton !== e.button) return 'unfinished';
  if (!cardSettled(id)) return 'unsettled';
  return Math.abs(mine.top - cardTop(e.currentTarget)) <= 1 ? 'ok' : 'unsettled';
}
