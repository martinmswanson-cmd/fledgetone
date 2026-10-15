/**
 * The service worker (served as /sw.js by the production build only: vite.config.ts fills in the
 * build's id, the files to keep and the font stylesheets). It keeps the app itself (the page, its
 * scripts and styles, the icons and the fonts) so the app opens at once, and offline, after one
 * visit, and a new version downloads only the files that changed.
 *
 * The instruments' recordings and the plugins' WebAssembly are not handled here: the app already
 * keeps each one in IndexedDB once used, under its address and its set's fingerprint
 * (recordingStore.ts), so caching them here too would keep everything twice.
 *
 * A new version installs beside the running one and waits: the page shows "New version ready"
 * and only moves to it when the person clicks Reload (a SKIP_WAITING message), never mid-work.
 */

/* global self, caches, fetch, URL, Response */
const BUILD = '__FLEDGETONE_BUILD__';
/** The app version this worker brings (package.json), named in the "Version … is ready" notice */
const VERSION = '__FLEDGETONE_VERSION__';
/** The app's files, relative to the worker's scope ('./' is the page) */
const PRECACHE = /** @type {string[]} */ (__FLEDGETONE_PRECACHE__);
/** The web fonts' stylesheets (Google Fonts), whose latin font files are kept too */
const FONT_CSS = /** @type {string[]} */ (__FLEDGETONE_FONT_CSS__);

const SHELL_PREFIX = 'fledgetone-shell-';
const SHELL = SHELL_PREFIX + BUILD;
const FONTS = 'fledgetone-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
/** Files named by their content (Vite's hashed assets): a copy kept by an earlier version is the same file */
const HASHED = /^assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

const scopeUrl = () => new URL(self.registration.scope);

/**
 * What to do with a request: 'page' (the app's page: the kept copy), 'shell' (one of the app's
 * kept files), 'font' (Google Fonts) or null (not handled: recordings, plugins, version.json, other sites).
 */
function routeOf(url, mode, scope) {
  if (FONT_HOSTS.includes(url.hostname)) return 'font';
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  const path = url.pathname.slice(scope.pathname.length);
  if (mode === 'navigate') return path === '' || path === 'index.html' ? 'page' : null;
  if (path === '' || path === 'index.html') return 'page';
  if (PRECACHE.includes(path) || path.startsWith('assets/')) return 'shell';
  return null;
}

/** A response safe to keep and hand to a navigation (a redirected one isn't). */
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Keep the latin font files a font stylesheet names (the other alphabets' load when used, online). */
async function keepFonts() {
  const cache = await caches.open(FONTS);
  for (const href of FONT_CSS) {
    const res = await fetch(href, { mode: 'cors' });
    if (!res.ok) continue;
    const css = await res.clone().text();
    await cache.put(href, res);
    // Google's stylesheet labels each @font-face with its alphabet: /* latin */ @font-face {... url(...) ...}
    const urls = [...css.matchAll(/\/\*\s*(latin(?:-ext)?)\s*\*\/\s*@font-face\s*{[^}]*?url\(([^)]+)\)/g)].map((m) => m[2].replace(/["']/g, ''));
    await Promise.all(
      urls.map(async (u) => {
        if (await cache.match(u)) return;
        const font = await fetch(u, { mode: 'cors' });
        if (font.ok) await cache.put(u, font);
      })
    );
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const scope = scopeUrl();
      await Promise.all(
        PRECACHE.map(async (path) => {
          const url = new URL(path, scope).href;
          if (await cache.match(url)) return;
          // A hashed file an earlier version kept is the same file: no download
          if (HASHED.test(path)) {
            const old = await caches.match(url);
            if (old) return cache.put(url, old);
          }
          // The page and the unhashed files are checked with the server (not taken from the browser's cache unchecked)
          const res = await fetch(url, { cache: HASHED.test(path) ? 'default' : 'no-cache' });
          if (!res.ok) throw new Error(`${path}: ${res.status}`);
          await cache.put(url, await clean(res));
        })
      );
      // Fonts are a nicety: without them the app still opens (in the system's font)
      await keepFonts().catch(() => {});
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(SHELL_PREFIX) && n !== SHELL).map((n) => caches.delete(n)));
      // The first install takes over the open page (nothing to replace); later ones only arrive on Reload
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  // Which version this is: asked of a waiting worker, to name it in the notice
  if (event.data && event.data.type === 'VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ build: BUILD, version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const route = routeOf(url, req.mode, scopeUrl());
  if (!route) return;
  if (route === 'font') {
    event.respondWith(fontResponse(req, event));
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      const key = route === 'page' ? scopeUrl().href : req.url;
      const kept = (await cache.match(key, { ignoreSearch: route === 'page' })) ?? (await caches.match(req));
      if (kept) return kept;
      return fetch(req);
    })()
  );
});

/** Fonts: font files from the kept copy (they never change at an address); the stylesheet kept, and refreshed in the background. */
async function fontResponse(req, event) {
  const cache = await caches.open(FONTS);
  const kept = await cache.match(req, { ignoreVary: true });
  const isCss = new URL(req.url).hostname === 'fonts.googleapis.com';
  if (kept && !isCss) return kept;
  const network = fetch(req.url, { mode: 'cors' }).then(async (res) => {
    if (res.ok) await cache.put(req.url, res.clone());
    return res;
  });
  if (kept) {
    event.waitUntil(network.catch(() => {}));
    return kept;
  }
  return network.catch(() => fetch(req));
}

// For the unit test (scripts/pwa.test.mjs), which runs this file in a sandbox
self.__fledgetoneSw = { routeOf, BUILD, VERSION, SHELL };
