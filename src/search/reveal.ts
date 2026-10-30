/**
 * Taking someone to a control: scroll it into view, focus it, and ring it for a moment so the eye
 * finds it. Controls inside a panel that has to open first (the Inspector, a popover) may only
 * appear a few frames later, so it waits for them (about a second at most).
 */
import { scrollBehavior } from '../components/reducedMotion';

const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function waitFor(selector: string, frames = 60): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const look = (left: number) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el || left <= 0) return resolve(el);
      requestAnimationFrame(() => look(left - 1));
    };
    look(frames);
  });
}

function flash(el: HTMLElement) {
  el.classList.remove('search-flash');
  // Restart the animation if it's still running from a moment ago
  void el.offsetWidth;
  el.classList.add('search-flash');
  window.setTimeout(() => el.classList.remove('search-flash'), 1900);
}

/** Show the control `selector` finds. Resolves false if it never appears. */
export async function reveal(selector: string): Promise<boolean> {
  const el = await waitFor(selector);
  if (!el) return false;
  // Inside a folded section (a <details>): unfold it, and any it sits in
  for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
  // A folded section that is the thing asked for (or wraps it straight away): open it too
  const own = el.matches('details') ? el : el.querySelector<HTMLDetailsElement>(':scope > details');
  if (own instanceof HTMLDetailsElement) own.open = true;
  el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  const target = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus({ preventScroll: true });
  flash(el);
  return true;
}

/** The agent's own parts of the page (the Suggestions panel, its dialog, the highlight, the header button): never pointed at by the agent. */
export const AGENT_UI = '[data-agent-panel], [data-agent-ui], [data-agent-highlight], [data-agent-chip], [data-agent-live]';

/**
 * Ring the control `selector` finds where it is, scrolled into view but not focused and nothing
 * opened: for an agent pointing something out without taking the keyboard. Never anything in the
 * agent's own parts of the page (AGENT_UI: their labels hold the agent's words, and scrolling
 * them could move a card under the pointer). Resolves to the control rung, or null if there's no such control.
 */
export async function ring(selector: string): Promise<HTMLElement | null> {
  const el = [...document.querySelectorAll<HTMLElement>(selector)].find((x) => !x.closest(AGENT_UI) && x.getClientRects().length > 0);
  if (!el) return null;
  el.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  flash(el);
  return el;
}

/** Click the button `selector` finds (to open what it opens), after bringing it into view. */
export async function press(selector: string): Promise<boolean> {
  const el = await waitFor(selector, 2);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
  el.click();
  return true;
}

/** Open something with `opener` (unless `selector` is already showing), then show `selector`. */
export async function openAndReveal(opener: string, selector: string): Promise<boolean> {
  if (!document.querySelector(selector) && !(await press(opener))) return false;
  return reveal(selector);
}
