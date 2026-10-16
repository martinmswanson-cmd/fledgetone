// Installing Fledgetone as an app: the manifest and its icons, the service worker (src/pwa/sw.js,
// run here in a sandbox with a pretend cache and network), the Netlify cache rules, the
// recordings' versioned addresses and the install instructions. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { installAdvice } = await import('../src/pwa/installAdvice.ts');

test('the manifest names the app, opens in its own window and has its icons at the right sizes', () => {
  const m = JSON.parse(readFileSync(join(ROOT, 'public/manifest.webmanifest'), 'utf8'));
  assert.equal(m.name, 'Fledgetone');
  assert.equal(m.display, 'standalone');
  // Relative, so the same file works with the app at / or at /app/ (fledgetone.com); the scope is
  // the whole site, so the home page can offer the install too
  assert.equal(m.start_url, './');
  assert.equal(m.scope, '/');
  assert.equal(m.id, '/');
  assert.equal(m.background_color, '#121214');
  assert.equal(m.theme_color, '#121214');
  const want = [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']];
  for (const [sizes, purpose] of want) {
    const icon = m.icons.find((i) => i.sizes === sizes && i.purpose === purpose);
    assert.ok(icon, `${sizes} ${purpose}`);
    const png = readFileSync(join(ROOT, 'public', icon.src));
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, sizes);
  }
  // The page links it; the theme colour matches
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html, /<meta name="theme-color" content="#121214"/);
});

/** sw.js filled in as the build does, run in a sandbox: a pretend Cache API and network. */
function sandbox({ build = 'b2', precache = ['./', 'favicon.svg', 'assets/index-AAAAAAAA.js', 'assets/index-BBBBBBBB.css'], stores = {}, network = {} } = {}) {
  const fetched = [];
  const listeners = {};
  class Resp {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.ok = this.status < 300;
      this.redirected = false;
      this.headers = init.headers ?? {};
    }
    clone() {
      return new Resp(this.body, this);
    }
    async text() {
      return String(this.body);
    }
    async blob() {
      return this.body;
    }
  }
  const caches = {
    async open(name) {
      stores[name] ??= new Map();
      const m = stores[name];
      return {
        match: async (k) => m.get(typeof k === 'string' ? k : k.url),
        put: async (k, v) => void m.set(typeof k === 'string' ? k : k.url, v),
        keys: async () => [...m.keys()],
      };
    },
    async match(k) {
      for (const m of Object.values(stores)) if (m.has(typeof k === 'string' ? k : k.url)) return m.get(typeof k === 'string' ? k : k.url);
    },
    async keys() {
      return Object.keys(stores);
    },
    async delete(name) {
      return delete stores[name];
    },
  };
  const self = {
    registration: { scope: 'https://fledgetone.com/' },
    clients: { claim: async () => {} },
    skipWaiting: () => (self.skipped = true),
    addEventListener: (type, fn) => (listeners[type] = fn),
  };
  const fetch = async (url) => {
    const u = typeof url === 'string' ? url : url.url;
    fetched.push(u);
    return u in network ? new Resp(network[u]) : new Resp('missing', { status: 404 });
  };
  const source = readFileSync(join(ROOT, 'src/pwa/sw.js'), 'utf8')
    .replace("'__FLEDGETONE_BUILD__'", JSON.stringify(build))
    .replace("'__FLEDGETONE_VERSION__'", JSON.stringify('2026.10.16'))
    .replace('__FLEDGETONE_PRECACHE__', JSON.stringify(precache))
    .replace('__FLEDGETONE_FONT_CSS__', '[]');
  vm.runInNewContext(source, { self, caches, fetch, URL, Response: Resp, console });
  const fire = async (type, extra = {}) => {
    let wait;
    let responded;
    listeners[type]({ ...extra, waitUntil: (p) => (wait = p), respondWith: (p) => (responded = p) });
    await wait;
    return responded;
  };
  return { self, stores, fetched, fire, sw: self.__fledgetoneSw };
}

test('the worker handles the app and fonts, and leaves recordings, plugins and version.json to the app', () => {
  const { sw } = sandbox();
  const scope = new URL('https://fledgetone.com/');
  const route = (u, mode = 'cors') => sw.routeOf(new URL(u), mode, scope);
  assert.equal(route('https://fledgetone.com/', 'navigate'), 'page');
  assert.equal(route('https://fledgetone.com/?utm=x', 'navigate'), 'page');
  assert.equal(route('https://fledgetone.com/assets/index-AAAAAAAA.js'), 'shell');
  assert.equal(route('https://fledgetone.com/favicon.svg'), 'shell');
  assert.equal(route('https://fonts.gstatic.com/s/outfit/v15/x.woff2'), 'font');
  assert.equal(route('https://fledgetone.com/fledgetone-samples/cello/C3_0_0.mp3?v=abc'), null);
  assert.equal(route('https://fledgetone.com/fledgetone-plugins/mda.wasm?v=abc'), null);
  assert.equal(route('https://twobirdsworkshop.com/fledgetone-samples/cello/C3_0_0.mp3'), null);
  assert.equal(route('https://fledgetone.com/version.json'), null);
  assert.equal(route('https://fledgetone.com/other.html', 'navigate'), null);
});

test('a new version downloads only the files that changed, then removes the old version\'s copy', async () => {
  const old = new Map([
    ['https://fledgetone.com/', 'old page'],
    ['https://fledgetone.com/favicon.svg', 'icon'],
    ['https://fledgetone.com/assets/index-AAAAAAAA.js', 'same script'],
    ['https://fledgetone.com/assets/index-OLDOLDOL.css', 'old style'],
  ]);
  const network = {
    'https://fledgetone.com/': 'new page',
    'https://fledgetone.com/favicon.svg': 'icon',
    'https://fledgetone.com/assets/index-BBBBBBBB.css': 'new style',
  };
  const { stores, fetched, fire, self, sw } = sandbox({ stores: { 'fledgetone-shell-b1': old, 'fledgetone-fonts-v1': new Map([['f', 1]]) }, network });
  await fire('install');
  // The unchanged hashed script came from the old copy; the page and the unhashed files are checked with the server
  assert.deepEqual(fetched.sort(), ['https://fledgetone.com/', 'https://fledgetone.com/assets/index-BBBBBBBB.css', 'https://fledgetone.com/favicon.svg']);
  assert.equal(stores['fledgetone-shell-b2'].get('https://fledgetone.com/assets/index-AAAAAAAA.js'), 'same script');
  // It waits: nothing moves until the page asks
  assert.equal(self.skipped, undefined);
  await fire('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(self.skipped, true);
  await fire('activate');
  assert.deepEqual(Object.keys(stores).sort(), ['fledgetone-fonts-v1', 'fledgetone-shell-b2']);
  // The page comes from the kept copy, offline too
  const res = await fire('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://fledgetone.com/' } });
  assert.equal(res.body, 'new page');
  // A recording isn't answered by the worker
  assert.equal(await fire('fetch', { request: { method: 'GET', mode: 'cors', url: 'https://fledgetone.com/fledgetone-samples/cello/C3_0_0.mp3?v=a' } }), undefined);
  // It says which version it brings
  let said;
  await fire('message', { data: { type: 'VERSION' }, ports: [{ postMessage: (v) => (said = v) }] });
  assert.deepEqual(JSON.parse(JSON.stringify(said)), { build: 'b2', version: '2026.10.16' });
  assert.equal(sw.SHELL, 'fledgetone-shell-b2');
});

test('a failed download fails the install, so a half-kept version never takes over', async () => {
  const { fire } = sandbox({ network: { 'https://fledgetone.com/': 'page' } });
  await assert.rejects(fire('install'));
});

test('recordings are asked for with their set\'s fingerprint, so they can be kept for good', async () => {
  const { versionedUrl } = await import('../src/audio/waitFor.ts');
  assert.equal(versionedUrl('fledgetone-samples/cello/C3_0_0.mp3', 'abc'), 'fledgetone-samples/cello/C3_0_0.mp3?v=abc');
  assert.equal(versionedUrl('x.mp3?a=1', 'abc'), 'x.mp3?a=1&v=abc');
  assert.equal(versionedUrl('x.mp3', ''), 'x.mp3');
});

test('Netlify: the worker and manifest are always checked, hashed files and versioned recordings kept a year', () => {
  const headers = readFileSync(join(ROOT, 'public/_headers'), 'utf8');
  const rule = (path) => headers.split(/\n(?=\/)/).find((b) => b.startsWith(path + '\n'));
  assert.match(rule('/sw.js'), /Cache-Control: no-cache/);
  assert.match(rule('/manifest.webmanifest'), /Cache-Control: no-cache/);
  assert.match(rule('/version.json'), /Cache-Control: no-cache/);
  assert.match(rule('/assets/*'), /max-age=31536000, immutable/);
  assert.match(rule('/fledgetone-samples/*'), /max-age=31536000, immutable/);
  assert.match(rule('/fledgetone-samples/*'), /Access-Control-Allow-Origin: \*/);
  // Only one place sets them, so they never add up to two Cache-Control headers
  assert.doesNotMatch(readFileSync(join(ROOT, 'netlify.toml'), 'utf8'), /^\[\[headers\]\]/m);
});

test('install instructions fit the browser', () => {
  const at = (userAgent, maxTouchPoints = 0, installable = true) => installAdvice({ userAgent, maxTouchPoints, installable });
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
  assert.match(at(mac), /Add to Dock/);
  assert.match(at(mac, 5), /Add to Home Screen/); // an iPad
  assert.match(at('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'), /Add to Home Screen/);
  assert.match(at('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'), /Edge/);
  assert.match(at('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'), /install icon/);
  assert.match(at('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'), /Chrome, Edge or Safari/);
  assert.match(at(mac, 0, false), /fledgetone\.com/);
});

test('fledgetone.com: the app\'s cache rules move to the top of the site, under /app/', async () => {
  const { siteHeaders } = await import('./site-headers.mjs');
  const out = siteHeaders(readFileSync(join(ROOT, 'public/_headers'), 'utf8'));
  const rule = (path) => out.split(/\n(?=\/)/).find((b) => b.startsWith(path + '\n'));
  assert.match(rule('/app/sw.js'), /Cache-Control: no-cache/);
  assert.match(rule('/app/manifest.webmanifest'), /application\/manifest\+json/);
  assert.match(rule('/app/assets/*'), /immutable/);
  assert.match(rule('/video/*'), /max-age=86400/);
  assert.equal(rule('/sw.js'), undefined);
});
