// Put the home page (site/) next to the app for fledgetone.com: `npm run build:site` builds the
// app into dist-site/app/ (served at /app/), then this copies site/ into dist-site/ and writes the
// guide's pages from GUIDE.md (/guide/, see scripts/guide-site.mjs). The home page is plain HTML and
// CSS with no build step of its own. The Learn section's lessons (learn/, scripts/learn-site.mjs) go
// to /learn/.
//
// The website build has the GPL plugins (VITE_GPL_PLUGINS=1 in package.json's build:site), since
// the app's source is published with them. The app's cache rules move to the top of the site
// (scripts/site-headers.mjs).
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGuide } from './guide-site.mjs';
import { siteHeaders } from './site-headers.mjs';
import { writeLicenses } from './licenses-page.mjs';
import { learnCards, lessons, writeLearn } from './learn-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist-site');

if (!existsSync(join(OUT, 'app', 'index.html'))) {
  console.error('dist-site/app/ has no build: run npm run build:site, not this script on its own.');
  process.exit(1);
}
cpSync(join(ROOT, 'site'), OUT, { recursive: true });
// Netlify reads the cache rules from the top of the site only
const appHeaders = join(OUT, 'app', '_headers');
// (Run again over the same build, as when re-making the lessons, the rules have moved already)
if (existsSync(appHeaders)) {
  writeFileSync(join(OUT, '_headers'), siteHeaders(readFileSync(appHeaders, 'utf8')));
  rmSync(appHeaders);
}
const guide = writeGuide(OUT);
const licences = writeLicenses(OUT);
const learn = await writeLearn(OUT);
// The home page's Learn section lists the lessons
const home = join(OUT, 'index.html');
writeFileSync(home, readFileSync(home, 'utf8').replace('<!-- learn-cards -->', learnCards(await lessons())));
console.log(`dist-site/: the home page at /, the studio at /app/, the lessons at /learn/ (${learn}), the guide at /guide/ (${guide} pages), the licences at /licenses/ (${licences})`);
