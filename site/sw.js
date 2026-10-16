/**
 * Retires the studio's old service worker. Until the home page arrived, the studio lived at the
 * site's root and its worker (scope /) kept the page and answered visits to / from its copy. This
 * file replaces it at the same address: it takes over at once, lets go of the site and reloads any
 * open page, so / shows the home page again. The studio's own worker is now /app/sw.js (scope /app/),
 * which also clears the old worker's kept files when it starts (they share its cache names).
 */
/* global self */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      const pages = await self.clients.matchAll({ type: 'window' });
      await Promise.all(pages.map((page) => page.navigate(page.url).catch(() => {})));
    })()
  );
});
// The old worker's Reload button asks for this; the worker above already takes over on its own
self.addEventListener('message', () => self.skipWaiting());
