/**
 * The phone app's web files (npm run build:app): the plain build (no GPL plugins: the App Store's
 * terms and the GPL don't fit together, see docs/APP.md) in dist-app/, without what the app
 * fetches from fledgetone.com instead: the recordings (about 600 MB; each loads from the site the
 * first time it's played, as on the web) and the GPL plugins' folder. `npx cap sync` then copies
 * dist-app/ into the iPhone and Android projects.
 */
import { existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = 'dist-app';
for (const dir of ['fledgetone-samples', 'fledgetone-plugins/gpl']) {
  const p = join(out, dir);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}
const size = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0) : statSync(p).size);
console.log(`${out}/: the app's web files, ${(size(out) / 1e6).toFixed(1)} MB`);
