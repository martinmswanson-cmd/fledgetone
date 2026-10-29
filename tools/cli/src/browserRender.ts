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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  ];
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
        args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync'],
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
        ['/fledgetone-sfx', pub('fledgetone-sfx')],
      ]
        .filter((m): m is [string, string] => !!m[1])
        .map(([prefix, dir]) => ({ prefix, dir })),
    ],
    {
      // Not in a folder: kept from an earlier download?
      fallback: (path, query) => {
        const m = /^\/(fledgetone-(?:samples|plugins|sfx))\/(.+)$/.exec(path);
        const kept = m ? keptPath(m[1], m[2], query) : null;
        return kept && existsSync(kept) ? kept : null;
      },
    }
  );
  await server.start(0);
  // The browser's profile and Playwright's working folder go in here, deleted at the end
  const tempDir = mkdtempSync(join(tmpdir(), 'fledgetone-browser-'));
  let launched: Launched | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onSignal: (() => void) | undefined;
  const pageErrors: string[] = [];
  try {
    const run = (async () => {
      launched = await launch(chromium, opts.browser, Math.min(60_000, timeoutMs), tempDir);
      const { browser } = launched;
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
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
        if (kept && existsSync(kept)) return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': contentType(kept) }, body: readFileSync(kept) });
        if (opts.offline) {
          opts.onLog?.(`not downloading ${url} (--offline)`);
          return route.abort('internetdisconnected');
        }
        try {
          const response = await route.fetch();
          const body = await response.body();
          if (response.ok() && kept) {
            mkdirSync(dirname(kept), { recursive: true });
            const part = `${kept}.part-${process.pid}`;
            writeFileSync(part, body);
            renameSync(part, kept);
          }
          return route.fulfill({ status: response.status(), headers: { ...response.headers(), 'access-control-allow-origin': '*' }, body });
        } catch (err) {
          opts.onLog?.(`couldn't download ${url}: ${((err as Error).message ?? '').split('\n')[0]}`);
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
      // Ctrl+C (or being told to stop): everything is shut down before the command ends
      onSignal = () => fail(new Error('Stopped.'));
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
    });
    run.catch(() => {}); // (its rejection is handled by the race; this keeps a late one quiet)
    return await Promise.race([run, deadline]);
  } catch (err) {
    if (err instanceof RenderSetupError) throw err;
    const message = (err as Error).message ?? String(err);
    // (a page that failed on its own, then went quiet: say what it said)
    if (/took longer than/.test(message) && pageErrors.length) throw new Error(`${message} The page said: ${pageErrors[0]}`);
    // A page error comes back wrapped by Playwright: the app's own words, without its wrapping
    const own = /Error: ([^\n]+)/.exec(message.replace(/^page\.evaluate: /, ''));
    throw new Error(own && message.startsWith('page.evaluate') ? own[1] : message.split('\n')[0]);
  } finally {
    clearTimeout(timer);
    if (onSignal) {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
    await closeBrowser(launched);
    await server.close();
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
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

