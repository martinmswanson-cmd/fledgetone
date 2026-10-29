/**
 * Focus back where it was when the Suggestions panel or the connect dialog opened, once it has
 * closed: to that control if it's still on the page (else the header's Suggestions button), and
 * only if focus went nowhere else meanwhile.
 */
export function returnFocus(opener: HTMLElement | null): void {
  window.setTimeout(() => {
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) return;
    const to = opener?.isConnected ? opener : document.querySelector<HTMLElement>('[data-agent-chip]');
    to?.focus({ preventScroll: true });
  }, 0);
}
