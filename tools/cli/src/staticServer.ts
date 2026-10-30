/**
 * A small web server on 127.0.0.1 for the command line's own pages: the renderer's (a headless
 * browser renders songs there: browserRender.ts) and `fledgetone studio`'s (a built copy of the
 * app, for browsers that won't let fledgetone.com reach the helper). It serves files from the
 * folders it's given, by address prefix, and nothing else: no listing, nothing outside those
 * folders (links followed are checked too), only GET and HEAD, and only for its own address (the
 * Host must be 127.0.0.1 or localhost at its port, so a site can't reach it through a name of its
 * own pointed at this computer).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.sf2': 'application/octet-stream',
};

/** A folder served under an address prefix ("/" for the top), or one page made in memory. */
export type Mount = { prefix: string; dir: string; index?: string } | { path: string; body: string | (() => string); type?: string };

/** What a request not served from a mount gets (the renderer's recordings fall back this way). */
export type Fallback = (path: string, query: URLSearchParams) => string | null;

/** The file `rel` inside `dir`, or null: nothing outside it, links followed included. */
export function fileInside(dir: string, rel: string): string | null {
  if (rel.includes('\0')) return null;
  const parts = rel.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.' || p.includes('\\'))) return null;
  if (!existsSync(dir)) return null;
  const root = realpathSync.native(dir);
  const full = resolve(root, ...parts);
  if (!existsSync(full)) return null;
  const real = realpathSync.native(full);
  const r = relative(root, real);
  if (r === '..' || r.startsWith('..' + sep) || isAbsolute(r) || r.split(sep).includes('..')) return null;
  return real;
}

export class StaticServer {
  private server: Server | null = null;
  port = 0;

  private mounts: Mount[];
  private opts: { fallback?: Fallback; headers?: Record<string, string> };

  constructor(mounts: Mount[], opts: { fallback?: Fallback; headers?: Record<string, string> } = {}) {
    this.mounts = mounts;
    this.opts = opts;
  }

  /** The address it serves at (after start). */
  get origin(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Start on 127.0.0.1 at `port` (0: any free one). Rejects (EADDRINUSE...) if it can't. */
  start(port = 0): Promise<void> {
    return new Promise((done, fail) => {
      const server = createServer((req, res) => this.handle(req, res));
      server.once('error', fail);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', fail);
        this.server = server;
        this.port = (server.address() as { port: number }).port;
        done();
      });
    });
  }

  /** Stop, dropping any connection still open. */
  close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const deny = (status: number, text: string) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(text);
    };
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return deny(421, 'Wrong address');
    if (req.method !== 'GET' && req.method !== 'HEAD') return deny(405, 'Only GET');
    let url: URL;
    let path: string;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
      path = decodeURIComponent(url.pathname);
    } catch {
      return deny(400, 'Bad address');
    }
    let file: string | null = null;
    let body: string | null = null;
    let type: string | undefined;
    for (const m of this.mounts) {
      if ('path' in m) {
        if (path === m.path) {
          body = typeof m.body === 'function' ? m.body() : m.body;
          type = m.type ?? TYPES[extname(m.path)] ?? 'text/html; charset=utf-8';
          break;
        }
        continue;
      }
      const prefix = m.prefix.endsWith('/') ? m.prefix : `${m.prefix}/`;
      if (!path.startsWith(prefix) && path !== m.prefix) continue;
      let rel = path.slice(prefix.length);
      if (!rel || rel.endsWith('/')) rel += m.index ?? '';
      if (!rel) continue;
      const found = fileInside(m.dir, rel);
      if (found && statSync(found).isFile()) {
        file = found;
        break;
      }
    }
    if (!file && body === null && this.opts.fallback) file = this.opts.fallback(path, url.searchParams);
    if (body !== null) {
      res.writeHead(200, { 'content-type': type!, 'cache-control': 'no-store', ...this.opts.headers });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    if (!file) return deny(404, 'Not here');
    const size = statSync(file).size;
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': String(size), 'cache-control': 'no-cache', ...this.opts.headers });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
