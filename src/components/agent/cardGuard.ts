/**
 * Accept and Dismiss only for the card the musician meant: a card that has just appeared or moved
 * on the panel (a new suggestion, a card above it growing) ignores them for SETTLE_MS, and a
 * pointer press counts only if it went down and came up on the same button with the card where it
 * was. So a click aimed at one card never lands on another that slid under the pointer.
 */
import type React from 'react';

/** How long a card that appeared or moved ignores Accept and Dismiss, ms. */
export const SETTLE_MS = 1000;

/** Where each card was last seen on the panel, and since when. */
const seen = new Map<string, { top: number; since: number }>();

/** Note where the cards in `list` are now (the panel calls this after every change of layout). */
export function noteCardPlaces(list: HTMLElement | null, now = performance.now()): void {
  if (!list) return;
  const here = new Set<string>();
  for (const el of list.querySelectorAll<HTMLElement>('[data-suggestion]')) {
    const id = el.dataset.suggestion!;
    here.add(id);
    const top = el.offsetTop;
    const was = seen.get(id);
    if (!was || Math.abs(was.top - top) > 1) seen.set(id, { top, since: now });
  }
  for (const id of [...seen.keys()]) if (!here.has(id)) seen.delete(id);
}

/** Whether card `id` has stayed where it is long enough to be pressed. */
export const cardSettled = (id: string, now = performance.now()): boolean => {
  const at = seen.get(id);
  return !!at && now - at.since >= SETTLE_MS;
};

/** The press a pointer started: the button and where its card was. */
let down: { button: EventTarget; top: number } | null = null;

const cardTop = (el: Element) => (el.closest('[data-suggestion]') as HTMLElement | null)?.getBoundingClientRect().top ?? 0;

/** On a guarded button's pointerdown. */
export function guardDown(e: React.PointerEvent): void {
  down = { button: e.currentTarget, top: cardTop(e.currentTarget) };
}

/**
 * Whether a click on a guarded button of card `id` should count: the card settled, and (for a
 * pointer's click, not a key's) the press began on this button with the card in the same place.
 */
export function guardClick(e: React.MouseEvent, id: string): boolean {
  const start = down;
  down = null;
  if (!cardSettled(id)) return false;
  // A key's click (Enter, Space) has no pointer behind it: the button had the focus already
  if (e.detail === 0) return true;
  return !!start && start.button === e.currentTarget && Math.abs(start.top - cardTop(e.currentTarget)) <= 1;
}
