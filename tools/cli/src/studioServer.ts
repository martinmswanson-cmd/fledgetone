/**
 * `fledgetone studio`: a built copy of the app served on 127.0.0.1, for browsers that won't let a
 * page from fledgetone.com reach the helper on this computer (Safari, Brave). The studio opened
 * from here is the same app; its address (http://127.0.0.1:47200 by default) is its own, so its
 * saved songs and settings are kept apart from fledgetone.com's. Started with the helper
 * (`fledgetone mcp --studio`), its address is let in by the helper at once; on its own, the helper
 * needs `--allow-origin <its address>`.
 *
 * It serves a build made beforehand (it doesn't build the app): `npm run build:site` (dist-site,
 * the app at /app/, as on fledgetone.com) or `npm run build` (dist), or the folder given with --app.
 */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StaticServer } from './staticServer';
import { repoRoot } from './browserRender';

export const STUDIO_PORT = 47200;

/** A built app to serve: its folder and the address of the app in it. */
export function findAppBuild(asked?: string): { dir: string; path: string } | null {
  const isApp = (dir: string) => existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'assets'));
  if (asked) {
    const dir = resolve(asked);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
    if (isApp(join(dir, 'app'))) return { dir, path: '/app/' };
    return isApp(dir) ? { dir, path: '/' } : null;
  }
  const root = repoRoot();
  if (!root) return null;
  if (isApp(join(root, 'dist-site', 'app'))) return { dir: join(root, 'dist-site'), path: '/app/' };
  if (isApp(join(root, 'dist'))) return { dir: join(root, 'dist'), path: '/' };
  return null;
}

export const NO_BUILD = `There's no built app to serve. In the Fledgetone repository, run \`npm run build\` (or \`npm run build:site\`), then \`fledgetone studio\` again, or give a built app's folder with --app <folder>.`;

/** Serve the app on 127.0.0.1:`port`. Returns the server and the address to open. */
export async function startStudio(port: number, app: { dir: string; path: string }): Promise<{ server: StaticServer; url: string; origins: string[] }> {
  const server = new StaticServer([{ prefix: '/', dir: app.dir, index: 'index.html' }], {
    // (the app's pages are its own: nothing here is for other sites to frame or read)
    headers: { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' },
  });
  try {
    await server.start(port);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new Error(code === 'EADDRINUSE' ? `Port ${port} is taken (another \`fledgetone studio\`?): choose another port, or stop that one.` : `Couldn't serve the studio on port ${port} (${code ?? (err as Error).message}).`);
  }
  return { server, url: `${server.origin}${app.path}`, origins: [server.origin, `http://localhost:${server.port}`] };
}
