/**
 * Taking someone to a control: scroll it into view, focus it, and ring it for a moment so the eye
 * finds it. Controls inside a panel that has to open first (the Inspector, a popover) may only
 * appear a few frames later, so it waits for them (about a second at most).
 */

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
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const target = el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
  target?.focus({ preventScroll: true });
  flash(el);
  return true;
}

/** Click the button `selector` finds (to open what it opens), after bringing it into view. */
export async function press(selector: string): Promise<boolean> {
  const el = await waitFor(selector, 2);
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.click();
  return true;
}

/** Open something with `opener` (unless `selector` is already showing), then show `selector`. */
export async function openAndReveal(opener: string, selector: string): Promise<boolean> {
  if (!document.querySelector(selector) && !(await press(opener))) return false;
  return reveal(selector);
}
