/** The View menu's button in the menu bar (where the Suggestions panel opens from). */
const viewMenu = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((m) => m.textContent?.trim() === 'View' && m.getClientRects().length > 0) ?? null;

/**
 * Focus back where it was when the Suggestions panel or the connect dialog opened, once it has
 * closed: to that control if it's still on the page (else the header's Suggestions button, else
 * the View menu's button, else the selected track's lane), and only if focus went nowhere else
 * meanwhile.
 */
export function returnFocus(opener: HTMLElement | null): void {
  window.setTimeout(() => {
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) return;
    const to = opener?.isConnected ? opener : (document.querySelector<HTMLElement>('[data-agent-chip]') ?? viewMenu() ?? document.querySelector<HTMLElement>('[data-lane]'));
    to?.focus({ preventScroll: true });
  }, 0);
}
