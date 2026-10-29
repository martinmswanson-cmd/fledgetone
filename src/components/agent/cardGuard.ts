/**
 * Accept and Dismiss only for the card the musician meant, by a deliberate press:
 *
 * - a card that has just appeared or moved on screen (a new suggestion, a card above it growing,
 *   the list scrolled by anything but the musician) ignores them for SETTLE_MS;
 * - a pointer's press counts only if it went down and came up on the same button with the card
 *   where it was; a key's only if Enter went down on that button just now (not held); a click with
 *   nothing behind it is an assistive tool's (a screen reader's, voice control's) and counts.
 *   Space never presses Accept, and a double-click's second click is never a press.
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

/** The press a pointer or Enter started: the button and where its card was. */
let down: { button: EventTarget; top: number; key: boolean } | null = null;

const cardTop = (el: Element) => (el.closest('[data-suggestion]') as HTMLElement | null)?.getBoundingClientRect().top ?? 0;

/** On a guarded button's pointerdown. */
export function guardDown(e: React.PointerEvent): void {
  down = { button: e.currentTarget, top: cardTop(e.currentTarget), key: false };
}

/** A key is held down on a guarded button (auto-repeating): its clicks never count, until it's let go. */
let repeating = false;

/** On a guarded button's keyup: a held key let go. */
export function guardKeyUp(): void {
  repeating = false;
}

/** On a guarded button's keydown: Enter (not held) starts a press; Space does nothing (and doesn't play the song). */
export function guardKey(e: React.KeyboardEvent): void {
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.key !== 'Enter') return;
  if (e.repeat) repeating = true;
  down = e.repeat ? null : { button: e.currentTarget, top: cardTop(e.currentTarget), key: true };
}

/** On another guarded button's keydown (Dismiss): Enter or Space, not held, starts a press. */
export function guardKeyPress(e: React.KeyboardEvent): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.repeat) repeating = true;
  down = e.repeat ? null : { button: e.currentTarget, top: cardTop(e.currentTarget), key: true };
}

/**
 * Whether a click on a guarded button of card `id` should count:
 *
 * - a pointer's click: only one that went down and came up on this button, the card settled and
 *   where it was ('unsettled' if it had just appeared or moved), never a double-click's second;
 * - a key's click (Enter, or Space on Dismiss): one that went down on this button, not held;
 * - a click with no pointer or key behind it (what screen readers, voice control and switch
 *   access send): a press too, unless a key is being held.
 *
 * Presses from keys and assistive tools aren't checked for settling: nothing slides under them.
 */
export function guardClick(e: React.MouseEvent, id: string): 'ok' | 'unsettled' | 'ignore' {
  const start = down;
  down = null;
  if (e.detail > 1) return 'ignore';
  if (e.detail === 0) {
    if (repeating) return 'ignore';
    // (Enter's press must be this button's; no press at all is an assistive tool's click)
    return !start || (start.key && start.button === e.currentTarget) ? 'ok' : 'ignore';
  }
  if (!start || start.key || start.button !== e.currentTarget) return 'ignore';
  if (!cardSettled(id)) return 'unsettled';
  return Math.abs(start.top - cardTop(e.currentTarget)) <= 1 ? 'ok' : 'unsettled';
}
