/**
 * Rendering and listening to song files in a headless browser, with no studio open: the
 * command line's `render` and `listen`, and the agent helper's render_file and listen with a file.
 *
 * A browser (an installed Chrome or Chromium, found by playwright-core) opens a page served on
 * 127.0.0.1 at a free port (a secure context, as the app's audio needs), which loads the app's own
 * renderer (dist-runtime/fledgetone-render.js, built from src/runtime/render.ts with
 * `npm run build:runtime`) and renders with the app's export path. The page reaches nothing but
 * that server and, for instrument recordings it doesn't have, the app's own site (the same
 * addresses the app downloads them from); every other request is refused. Recordings downloaded
 * once are kept (in ~/.cache/fledgetone/downloads, or FLEDGETONE_CACHE) and served from there
 * next time; a folder of recordings (--samples, or public/fledgetone-samples in a copy of the
 * repository) is served first, and --offline downloads nothing.
 *
 * Every run starts its own browser and server and shuts both down when it ends, also when it
 * fails or takes too long (the browser is killed by its process if it won't close).
 */
import { createRequire } from 'node:module';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StaticServer } from './staticServer';

// ---------- The bits of Playwright used here (it's loaded at run time, if it's there) ----------

interface PwRoute {
  request(): { url(): string };
  continue(): Promise<void>;
  abort(code?: string): Promise<void>;
  fetch(): Promise<{ ok(): boolean; status(): number; headers(): Record<string, string>; body(): Promise<Buffer> }>;
  fulfill(o: { status?: number; headers?: Record<string, string>; body?: Buffer | string; response?: unknown }): Promise<void>;
}
interface PwPage {
  on(event: 'pageerror', fn: (e: Error) => void): void;
  on(event: 'console', fn: (m: { type(): string; text(): string }) => void): void;
  exposeFunction(name: string, fn: (...a: never[]) => unknown): Promise<void>;
  goto(url: string, o?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  evaluate<T, A>(fn: (arg: A) => T | Promise<T>, arg: A): Promise<T>;
}
interface PwContext {
  route(url: string, fn: (route: PwRoute) => unknown): Promise<void>;
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(o?: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
  version(): string;
}
interface PwBrowserServer {
  wsEndpoint(): string;
  process(): { pid?: number; exitCode: number | null; signalCode: string | null };
  close(): Promise<void>;
  kill(): Promise<void>;
}
interface PwChromium {
  launchServer(o: Record<string, unknown>): Promise<PwBrowserServer>;
  connect(wsEndpoint: string, o?: Record<string, unknown>): Promise<PwBrowser>;
}

/** A browser started here: the connection to it, and its process (to end it by its own id if it won't close). */
interface Launched {
  browser: PwBrowser;
  server: PwBrowserServer;
  label: string;
}

/** A mistake in what was asked, or something missing on this computer: said plainly, exit code 2. */
export class RenderSetupError extends Error {}

/** The repository the command line is part of (where dist-runtime/ and public/ are). */
export function repoRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === 'fledgetone') return dir;
      } catch {
        // Not ours
      }
    }
    dir = dirname(dir);
  }
  return null;
}

/** Where the command line keeps what it downloads (FLEDGETONE_CACHE, else the user's cache folder). */
export function cacheDir(): string {
  if (process.env.FLEDGETONE_CACHE) return resolve(process.env.FLEDGETONE_CACHE);
  const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'fledgetone');
}

/** playwright-core (or playwright) from wherever it's installed: tools/cli, the repository, NODE_PATH, the global packages. */
async function loadChromium(): Promise<PwChromium> {
  const here = dirname(fileURLToPath(import.meta.url));
  const req = createRequire(join(here, 'x.js'));
  const tries: string[] = [];
  if (process.env.FLEDGETONE_PLAYWRIGHT) tries.push(resolve(process.env.FLEDGETONE_PLAYWRIGHT));
  tries.push('playwright-core', 'playwright');
  const globalRoot = join(dirname(dirname(process.execPath)), 'lib', 'node_modules');
  for (const name of tries) {
    let path: string | null = null;
    for (const paths of [undefined, [globalRoot]]) {
      try {
        path = req.resolve(name, paths ? { paths } : undefined);
        break;
      } catch {
        // Not here
      }
    }
    if (!path) continue;
    const mod = (await import(pathToFileURL(path).href)) as { chromium?: PwChromium; default?: { chromium?: PwChromium } };
    const chromium = mod.chromium ?? mod.default?.chromium;
    if (chromium) return chromium;
  }
  throw new RenderSetupError(
    'Rendering needs playwright-core, which drives a browser to render with: run `npm install playwright-core` in tools/cli (it downloads no browser; an installed Chrome or Chromium is used).'
  );
}

/** The browsers tried, in order: the one asked for, Chrome, Playwright's own Chromium, Edge, then the usual places. */
function browserCandidates(asked?: string): Array<{ label: string; options: Record<string, unknown> }> {
  const path = asked ?? process.env.FLEDGETONE_BROWSER;
  if (path) return [{ label: path, options: { executablePath: path } }];
  const known = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter((p) => existsSync(p));
  return [
    { label: 'Google Chrome', options: { channel: 'chrome' } },
    { label: "Playwright's Chromium", options: {} },
    { label: 'Microsoft Edge', options: { channel: 'msedge' } },
    ...known.map((p) => ({ label: p, options: { executablePath: p } })),
    ...playwrightBrowsers().map((p) => ({ label: p, options: { executablePath: p } })),
  ];
}

/**
 * Chromium downloaded by any version of Playwright (in PLAYWRIGHT_BROWSERS_PATH or its usual
 * folder), newest first: one made for another version still renders.
 */
function playwrightBrowsers(): string[] {
  const dirs = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache', 'ms-playwright'), join(homedir(), 'Library', 'Caches', 'ms-playwright'), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright')].filter(
    (d): d is string => !!d && d !== '0' && existsSync(d)
  );
  const programs = [
    ['chrome-linux', 'chrome'],
    ['chrome-linux64', 'chrome'],
    ['chrome-linux', 'headless_shell'],
    ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-win64', 'chrome.exe'],
  ];
  const found: Array<{ path: string; rev: number }> = [];
  for (const dir of dirs) {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const m = /^chromium(?:_headless_shell)?-(\d+)$/.exec(name);
      if (!m) continue;
      for (const parts of programs) {
        const path = join(dir, name, ...parts);
        if (existsSync(path)) found.push({ path, rev: Number(m[1]) });
      }
    }
  }
  // (newest first; of one download, the headless shell first: it's made for this and calls nothing)
  const shell = (p: string) => (/headless/i.test(p) ? 0 : 1);
  return [...new Set(found.sort((a, b) => b.rev - a.rev || shell(a.path) - shell(b.path)).map((f) => f.path))];
}

export const NO_BROWSER =
  'No browser to render with was found. Install Google Chrome or Chromium, or run `npx playwright-core install chromium` in tools/cli, or give one with --browser <path to its program> (or FLEDGETONE_BROWSER).';

/**
 * `fn`, with the temporary folder pointed at `dir` meanwhile: Playwright makes the browser's
 * profile and its own working folder in the temporary folder as it launches, and the folder
 * they're in is deleted (whole) when the browser is closed, so nothing of it is left behind.
 */
async function withTempDir<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const keys = ['TMPDIR', 'TMP', 'TEMP'] as const;
  const before = keys.map((k) => process.env[k]);
  for (const k of keys) process.env[k] = dir;
  try {
    return await fn();
  } finally {
    keys.forEach((k, i) => (before[i] === undefined ? delete process.env[k] : (process.env[k] = before[i])));
  }
}

async function launch(chromium: PwChromium, asked: string | undefined, timeoutMs: number, tempDir: string): Promise<Launched> {
  return withTempDir(tempDir, () => launchIn(chromium, asked, timeoutMs));
}

/**
 * The proxy the environment names for HTTPS (HTTPS_PROXY, else HTTP_PROXY), as Playwright takes
 * it: the page's own server and NO_PROXY's hosts bypass it. Recordings download through it.
 */
export function proxyFromEnv(env: NodeJS.ProcessEnv = process.env): { server: string; bypass: string; username?: string; password?: string } | null {
  const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  const noProxyList = (env.NO_PROXY || env.no_proxy || '').split(',').map((x) => x.trim());
  // (NO_PROXY=* : nothing goes through it)
  if (noProxyList.includes('*')) return null;
  const noProxy = noProxyList.filter((x) => x && !/\s/.test(x));
  const bypass = [...new Set(['127.0.0.1', 'localhost', ...noProxy])].join(',');
  return {
    server: `${url.protocol}//${url.host}`,
    bypass,
    ...(url.username ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : {}),
  };
}

async function launchIn(chromium: PwChromium, asked: string | undefined, timeoutMs: number): Promise<Launched> {
  const why: string[] = [];
  for (const c of browserCandidates(asked)) {
    let server: PwBrowserServer | null = null;
    try {
      // (launched as a server and connected to, so its process is ours to end if it won't close)
      server = await chromium.launchServer({
        headless: true,
        timeout: timeoutMs,
        // (stopping is ours to handle: withRenderer closes the browser, then the command ends)
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        // (no sound card needed, nothing played: renders are offline)
        args: [
          '--autoplay-policy=no-user-gesture-required',
          '--mute-audio',
          '--no-first-run',
          '--no-default-browser-check',
          // (the browser's own calls home: none of them are needed to render)
          '--disable-background-networking',
          '--disable-component-update',
          '--disable-sync',
          '--disable-default-apps',
          '--disable-domain-reliability',
          '--disable-client-side-phishing-detection',
          '--no-pings',
          '--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,AutofillServerCommunication,CertificateTransparencyComponentUpdater,PushMessaging',
        ],
        ...c.options,
      });
      const browser = await chromium.connect(server.wsEndpoint(), { timeout: timeoutMs });
      return { browser, server, label: c.label };
    } catch (err) {
      if (server) await closeBrowser({ server });
      why.push(`${c.label}: ${((err as Error).message ?? String(err)).split('\n')[0]}`);
    }
  }
  throw new RenderSetupError(`${NO_BROWSER}${asked ? `\n(${why.join('; ')})` : ''}`);
}

export interface BrowserOptions {
  /** A browser's program to use (else one is looked for). */
  browser?: string;
  /** A folder of instrument recordings laid out as public/fledgetone-samples (default: that folder, in a copy of the repository). */
  samples?: string;
  /** Download nothing: recordings not in the samples folder or the cache can't be had. */
  offline?: boolean;
  /** The renderer from a running dev server instead of the built one (working on Fledgetone): http://localhost:5200/ */
  appUrl?: string;
  /** The longest a run may take, ms (default 10 minutes). */
  timeoutMs?: number;
  /** Told how far a render has got. */
  onProgress?: (fraction: number, what: string) => void;
  /** Told what the page logged (its errors), for --verbose. */
  onLog?: (line: string) => void;
}

/** An open renderer: a page with fledgetone-render.js loaded. */
export interface RenderSession {
  call<T>(fn: string, ...args: unknown[]): Promise<T>;
  /** A kept file's bytes (from renderSong's files). */
  take(id: string, bytes: number): Promise<Buffer>;
  browserName: string;
}

const DOWNLOADS = /^https:\/\/fledgetone\.com\/app\/(fledgetone-(?:samples|plugins|sfx))\/([^?#]+)(?:\?([^#]*))?$/;

/** Where a download is kept: by folder, path and the set's fingerprint (?v=), so a re-made set is downloaded afresh. */
function keptPath(folder: string, path: string, query: URLSearchParams): string | null {
  const v = query.get('v');
  if (v !== null && !/^[A-Za-z0-9._-]{1,80}$/.test(v)) return null;
  const parts = path.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p === '.' || p.includes('\\') || p.includes('\0') || p.includes('@'))) return null;
  const last = parts.pop()!;
  return join(cacheDir(), 'downloads', folder, ...parts, v ? `${last}@${v}` : last);
}

/**
 * Open a renderer, run `job` with it, and shut it all down (the browser, the server), whatever
 * happens. Rejects with RenderSetupError when something is missing (playwright-core, a browser,
 * the built renderer), or with the page's own error.
 */
export async function withRenderer<T>(opts: BrowserOptions, job: (session: RenderSession) => Promise<T>): Promise<T> {
  const root = repoRoot();
  const runtime = root ? join(root, 'dist-runtime', 'fledgetone-render.js') : null;
  if (!opts.appUrl && (!runtime || !existsSync(runtime)))
    throw new RenderSetupError(`The renderer isn't built yet: run \`npm run build:runtime\` in ${root ?? 'the Fledgetone repository'} (it writes dist-runtime/fledgetone-render.js).`);
  const samples = opts.samples ? resolve(opts.samples) : root ? join(root, 'public', 'fledgetone-samples') : null;
  if (opts.samples && (!existsSync(samples!) || !statSync(samples!).isDirectory())) throw new RenderSetupError(`--samples ${opts.samples} isn't a folder`);
  const chromium = await loadChromium();
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const pub = (name: string) => (root ? join(root, 'public', name) : null);
  const server = new StaticServer(
    [
      { path: '/', body: '<!doctype html><meta charset="utf-8"><title>Fledgetone renderer</title><p>Fledgetone is rendering here.</p>' },
      ...(runtime ? [{ prefix: '/runtime', dir: dirname(runtime) }] : []),
      ...[
        ['/fledgetone-samples', samples],
        ['/fledgetone-plugins', pub('fledgetone-plugins')],
        // (the renderer asks for its plugins next to itself: pluginSources.ts)
        ['/runtime/fledgetone-plugins', pub('fledgetone-plugins')],
        ['/fledgetone-sfx', pub('fledgetone-sfx')],
      ]
        .filter((m): m is [string, string] => !!m[1])
        .map(([prefix, dir]) => ({ prefix, dir })),
    ],
    {
      // Not in a folder: kept from an earlier download?
      fallback: (path, query) => {
        const m = /^\/(?:runtime\/)?(fledgetone-(?:samples|plugins|sfx))\/(.+)$/.exec(path);
        const kept = m ? keptPath(m[1], m[2], query) : null;
        return kept && keptIsGood(kept) ? kept : null;
      },
    }
  );
  await server.start(0);
  removeStaleBrowserFolders();
  // The browser's profile and Playwright's working folder go in here, deleted at the end
  const tempDir = mkdtempSync(join(tmpdir(), 'fledgetone-browser-'));
  writeFileSync(join(tempDir, 'owner.pid'), String(process.pid));
  let launched: Launched | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let downloadFailed = false;
  // Ctrl+C (or being told to stop): the first stops the run; any more are let be until everything is shut down
  let stop: ((err: Error) => void) | undefined;
  const onSignal = () => {
    stop?.(new Error('Stopped.'));
    stop = undefined;
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const pageErrors: string[] = [];
  try {
    const run = (async () => {
      launched = await launch(chromium, opts.browser, Math.min(60_000, timeoutMs), tempDir);
      const { browser } = launched;
      // A proxy is the page's only (its downloads go through it), not the browser's own
      const proxy = proxyFromEnv();
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, ...(proxy ? { proxy } : {}) });
      const appOrigin = opts.appUrl ? new URL(opts.appUrl).origin : null;
      // The page reaches its own server (and the dev server in --app-url), and the app's own site for recordings; nothing else
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        let origin = '';
        try {
          origin = new URL(url).origin;
        } catch {
          // (data: and blob: aren't routed)
        }
        if (origin === server.origin || (appOrigin && origin === appOrigin)) return route.continue();
        const m = DOWNLOADS.exec(url);
        if (!m) {
          opts.onLog?.(`refused a request to ${url.slice(0, 120)}`);
          return route.abort('blockedbyclient');
        }
        const kept = keptPath(m[1], decodeURIComponent(m[2]), new URLSearchParams(m[3] ?? ''));
        if (kept && keptIsGood(kept)) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': contentType(kept) }, body: readFileSync(kept) });
        if (opts.offline) {
          opts.onLog?.(`not downloading ${url} (--offline)`);
          return route.abort('internetdisconnected');
        }
        try {
          const response = await route.fetch();
          const body = await response.body();
          // Kept only if it's what was asked for: a whole answer, of the right kind and size
          const why = response.status() >= 200 && response.status() < 300 ? downloadProblem(kept ?? url, response.headers()['content-type'] ?? '', body) : `the site answered ${response.status()}`;
          if (!why && kept) {
            mkdirSync(dirname(kept), { recursive: true });
            const part = `${kept}.part-${process.pid}`;
            writeFileSync(part, body);
            renameSync(part, kept);
          } else if (why) {
            downloadFailed = true;
            opts.onLog?.(`not keeping ${url}: ${why}`);
          }
          return route.fulfill({ status: response.status(), headers: { ...response.headers(), 'access-control-allow-origin': '*' }, body });
        } catch (err) {
          const why = ((err as Error).message ?? '').split('\n')[0].replace(/^(route\.fetch: )+/, '');
          downloadFailed = true;
          opts.onLog?.(`couldn't download ${url}: ${why}`);
          return route.abort('failed');
        }
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => {
        pageErrors.push(e.message);
        opts.onLog?.(`[page error] ${e.message}`);
      });
      page.on('console', (m) => opts.onLog?.(`[page ${m.type()}] ${m.text().slice(0, 400)}`));
      await page.exposeFunction('__fledgetoneProgress', (f: number, what: string) => opts.onProgress?.(f, what));
      const moduleUrl = opts.appUrl ? new URL('src/runtime/render.ts', opts.appUrl.endsWith('/') ? opts.appUrl : `${opts.appUrl}/`).href : `${server.origin}/runtime/fledgetone-render.js`;
      await page.goto(opts.appUrl ?? `${server.origin}/`, { waitUntil: 'load', timeout: 60_000 });
      await page.evaluate(async (url: string) => {
        (window as unknown as { __fledgetone: unknown }).__fledgetone = await import(/* @vite-ignore */ url);
      }, moduleUrl);
      const session: RenderSession = {
        browserName: `${launched.label} ${browser.version()}`,
        call: <R>(fn: string, ...args: unknown[]) =>
          page.evaluate(
            async ([name, list]: [string, unknown[]]) => {
              const w = window as unknown as { __fledgetone: Record<string, (...a: unknown[]) => unknown>; __fledgetoneProgress: (f: number, what: string) => void };
              const last = list[list.length - 1];
              // The options get the progress callback (it can't cross from the command line)
              if (last && typeof last === 'object' && !Array.isArray(last)) list[list.length - 1] = { ...last, onProgress: (f: number, what: string) => void w.__fledgetoneProgress(f, what) };
              return (await w.__fledgetone[name](...list)) as R;
            },
            [fn, args] as [string, unknown[]]
          ),
        take: async (id, bytes) => {
          const chunks: Buffer[] = [];
          const step = 6 * 1024 * 1024;
          for (let at = 0; at < bytes; at += step) {
            const b64 = await page.evaluate(([i, a, b]: [string, number, number]) => (window as unknown as { __fledgetone: { take(i: string, a: number, b: number): Promise<string> } }).__fledgetone.take(i, a, b), [id, at, Math.min(bytes, at + step)] as [string, number, number]);
            chunks.push(Buffer.from(b64, 'base64'));
          }
          await page.evaluate((i: string) => (window as unknown as { __fledgetone: { release(i: string): void } }).__fledgetone.release(i), id);
          return Buffer.concat(chunks);
        },
      };
      return await job(session);
    })();
    const deadline = new Promise<never>((_, fail) => {
      timer = setTimeout(() => fail(new Error(`It took longer than ${Math.round(timeoutMs / 1000)} seconds, so it was stopped (--timeout gives more).`)), timeoutMs);
      stop = fail;
    });
    run.catch(() => {}); // (its rejection is handled by the race; this keeps a late one quiet)
    return await Promise.race([run, deadline]);
  } catch (err) {
    if (err instanceof RenderSetupError) throw err;
    let message = (err as Error).message ?? String(err);
    // (the app says to check the connection; behind a proxy, say how this reaches it)
    if (downloadFailed && /couldn.t download/i.test(message)) message += ` ${downloadHint()}`;
    // (a page that failed on its own, then went quiet: say what it said)
    if (/took longer than/.test(message) && pageErrors.length) throw new Error(`${message} The page said: ${pageErrors[0]}`);
    // A page error comes back wrapped by Playwright: the app's own words, without its wrapping
    const own = /Error: ([^\n]+)/.exec(message.replace(/^page\.evaluate: /, ''));
    throw new Error(own && message.startsWith('page.evaluate') ? `${own[1]}${downloadFailed && /couldn.t download/i.test(own[1]) ? ` ${downloadHint()}` : ''}` : message.split('\n')[0]);
  } finally {
    clearTimeout(timer);
    // (a second Ctrl+C meanwhile is heard and let be, so the clean-up below always finishes)
    await closeBrowser(launched);
    await server.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

/** What to try when a download fails: the proxy in use, or how to name one, and the samples folder. */
function downloadHint(): string {
  const proxy = proxyFromEnv();
  return proxy
    ? `(It downloads through the proxy at ${proxy.server}, from HTTPS_PROXY: check it lets fledgetone.com through, and if it uses a certificate of its own, give it with NODE_EXTRA_CA_CERTS. Or give the recordings with --samples.)`
    : '(Behind a proxy? Set HTTPS_PROXY to it. Or give the recordings with --samples.)';
}

/** The kinds of file each extension may be, by the site's content type and the file's first bytes. */
const KINDS: Array<{ ext: RegExp; types: RegExp; magic: (b: Buffer) => boolean }> = [
  { ext: /\.mp3$/i, types: /^(audio\/(mpeg|mp3)|application\/octet-stream)/i, magic: (b) => b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { ext: /\.ogg$/i, types: /^(audio\/ogg|application\/ogg|application\/octet-stream)/i, magic: (b) => b.toString('latin1', 0, 4) === 'OggS' },
  { ext: /\.wasm$/i, types: /^(application\/wasm|application\/octet-stream)/i, magic: (b) => b[0] === 0 && b.toString('latin1', 1, 4) === 'asm' },
  { ext: /\.wav$/i, types: /^(audio\/(wav|x-wav|wave)|application\/octet-stream)/i, magic: (b) => b.toString('latin1', 0, 4) === 'RIFF' },
  // (a plugin's preset: binary, any first bytes)
  { ext: /\.fxp$/i, types: /^(application\/octet-stream|application\/x-fxp|binary\/octet-stream)/i, magic: () => true },
  { ext: /\.json$/i, types: /^(application\/json|text\/plain|application\/octet-stream)/i, magic: (b) => /^\s*[[{]/.test(b.toString('utf8', 0, 64)) },
];
/** The biggest file a download may be (the largest plugin is about 10 MB, a recording well under 1). */
export const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

/** Why a downloaded file isn't kept (null: it's fine): the wrong kind, empty, too big. `name` is its path or address. */
export function downloadProblem(name: string, type: string, body: Buffer): string | null {
  const plain = name.replace(/@[^/\\]*$/, '').replace(/[?#].*$/, '');
  const kind = KINDS.find((k) => k.ext.test(plain));
  if (!body.length) return 'it is empty';
  if (body.length > MAX_DOWNLOAD_BYTES) return `it is ${Math.round(body.length / 1e6)} MB, more than any recording or plugin`;
  if (!kind) return 'not a kind of file it keeps';
  if (type && !kind.types.test(type)) return `it came as ${type.split(';')[0]}`;
  if (!kind.magic(body)) return "its contents aren't what its name says";
  return null;
}

/** Whether a kept download is still sound: a damaged one is deleted (and downloaded again). */
function keptIsGood(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const size = statSync(path).size;
    const fd = openSync(path, 'r');
    const head = Buffer.alloc(Math.min(64, size));
    readSync(fd, head, 0, head.length, 0);
    closeSync(fd);
    if (size > 0 && size <= MAX_DOWNLOAD_BYTES && downloadProblem(path, '', head) === null) return true;
  } catch {
    // Unreadable: as damaged
  }
  rmSync(path, { force: true });
  return false;
}

/** Leftover browser folders (from a run that was killed) more than an hour old, whose run has ended, are deleted. */
export function removeStaleBrowserFolders(base = tmpdir(), olderThanMs = 60 * 60_000): number {
  let removed = 0;
  let names: string[] = [];
  try {
    names = readdirSync(base);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith('fledgetone-browser-')) continue;
    const dir = join(base, name);
    try {
      if (Date.now() - statSync(dir).mtimeMs < olderThanMs) continue;
      const pid = Number(readFileSync(join(dir, 'owner.pid'), 'utf8'));
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid)) continue;
    } catch {
      // No owner written: an old run's (or not readable): still only if old enough, checked above
    }
    try {
      rmSync(dir, { recursive: true, force: true });
      removed++;
    } catch {
      // In use or not ours to delete
    }
  }
  return removed;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Close the browser; if it won't within 5 seconds, end its process (by its own id). */
async function closeBrowser(launched: Pick<Launched, 'server'> & { browser?: PwBrowser } | null): Promise<void> {
  if (!launched) return;
  const wait = (p: Promise<unknown>, ms: number) => Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
  if (launched.browser) await wait(launched.browser.close(), 3000);
  await wait(launched.server.close(), 5000);
  const proc = launched.server.process();
  if (proc?.pid && proc.exitCode === null && proc.signalCode === null) {
    await wait(launched.server.kill(), 3000);
    if (proc.exitCode === null && proc.signalCode === null) {
      try {
        process.kill(proc.pid, 'SIGKILL');
      } catch {
        // Gone already
      }
    }
  }
}

function contentType(path: string): string {
  return path.includes('.mp3') ? 'audio/mpeg' : path.includes('.ogg') ? 'audio/ogg' : path.includes('.wasm') ? 'application/wasm' : path.includes('.js') ? 'text/javascript' : path.includes('.json') ? 'application/json' : 'application/octet-stream';
}

/** Whether rendering can run here, and why not: for the tests, which skip without a browser. */
export async function canRender(opts: Pick<BrowserOptions, 'browser'> = {}): Promise<string | null> {
  try {
    const chromium = await loadChromium();
    const tempDir = mkdtempSync(join(tmpdir(), 'fledgetone-browser-'));
    try {
      await closeBrowser(await launch(chromium, opts.browser, 30_000, tempDir));
    } finally {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
    }
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

