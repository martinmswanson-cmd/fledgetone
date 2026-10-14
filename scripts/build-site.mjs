// Put the home page (site/) next to the app for fledgetone.com: `npm run build:site` builds the
// app into dist-site/app/ (served at /app/), then this copies site/ into dist-site/. The home page
// is plain HTML and CSS with no build step of its own.
//
// The GPL plugins stay out of the website build until the app's source is published (see
// CONTRIBUTING.md), so their folder is removed from what Vite copied out of public/.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-site');

if (!existsSync(join(OUT, 'app', 'index.html'))) {
  console.error('dist-site/app/ has no build: run npm run build:site, not this script on its own.');
  process.exit(1);
}
cpSync(join(ROOT, 'site'), OUT, { recursive: true });
rmSync(join(OUT, 'app', 'fledgetone-plugins', 'gpl'), { recursive: true, force: true });
console.log('dist-site/: the home page at /, the studio at /app/');
