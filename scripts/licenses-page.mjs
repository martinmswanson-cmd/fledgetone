// The licences page for fledgetone.com (/licenses/): the open-source software in the studio and its
// built-in plugins, with each licence's full text, read from the third-party-licenses.txt the app's
// build writes (vite.config.ts). The recorded sounds' credits are in the guide (/guide/credits/).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { escape } from './guide-pages.mjs';
import { head, foot } from './guide-site.mjs';

const RULE = /^={60}$/;

/**
 * third-party-licenses.txt as groups of entries. Entries are a title line over a rule of 60 "=",
 * then the licence text, three blank-line-separated chunks apart; a chunk with no rule that starts
 * with "Fledgetone" opens a new group (the app's libraries, then the built-in plugins).
 */
export function parseLicenses(txt) {
  const groups = [];
  for (let chunk of txt.replace(/\r/g, '').split(/\n{3,}/)) {
    let lines = chunk.split('\n');
    // The file's opening sentence sits right above the first entry
    const at = lines.findIndex((l, i) => RULE.test(lines[i + 1] ?? ''));
    if (at > 0 && chunk.startsWith('Fledgetone')) {
      groups.push({ intro: lines.slice(0, at).join(' ').trim(), entries: [] });
      lines = lines.slice(at);
      chunk = lines.join('\n');
    }
    if (lines.length > 1 && RULE.test(lines[1])) {
      const m = lines[0].match(/^(.*?)\s*\(([^()]*)\)(.*?)\s*$/);
      if (!groups.length) groups.push({ intro: '', entries: [] });
      groups.at(-1).entries.push({ name: m ? m[1] + m[3] : lines[0], licence: m ? m[2] : '', text: lines.slice(2).join('\n').trim() });
    } else if (chunk.startsWith('Fledgetone')) {
      groups.push({ intro: chunk.trim().replace(/\s+/g, ' '), entries: [] });
    } else if (groups.at(-1)?.entries.length) {
      const last = groups.at(-1).entries.at(-1);
      last.text += `\n\n\n${chunk.trim()}`;
    }
  }
  return groups.filter((g) => g.entries.length);
}

const TITLES = ['In the studio', 'In the built-in effects and instruments'];

export function licensesPage(groups) {
  const count = groups.reduce((n, g) => n + g.entries.length, 0);
  return (
    head({
      title: 'Licences · Fledgetone',
      description: 'The open-source software in Fledgetone and the full text of each licence.',
      path: 'licenses/',
      current: 'licenses',
    }) +
    `
  <main id="main" class="g-index wrap licenses">
    <div class="g-hero">
      <p class="mono-label">Licences</p>
      <h1>Open-source software in Fledgetone</h1>
      <p class="lede">Fledgetone is built on ${count} pieces of open-source software. Here is each one with its licence. Click a name for the full text. Fledgetone itself is free software under the GNU General Public License, version 3, and <a href="https://github.com/martinmswanson-cmd/fledgetone">its source code is on GitHub</a>.</p>
      <p class="fineprint">The recorded instruments and their licences are listed in the guide, under <a href="/guide/credits/">Credits</a>. The same list is in the studio: Guide &rsaquo; Credits. As one text file: <a href="/app/third-party-licenses.txt">third-party-licenses.txt</a>.</p>
    </div>
    ${groups
      .map(
        (g, i) => `<section class="lic-group">
      <h2>${escape(TITLES[i] ?? 'Also included')}</h2>
      <ul class="lic-list">
        ${g.entries
          .map(
            (e) => `<li><details>
          <summary><span class="lic-name">${escape(e.name)}</span>${e.licence ? `<span class="lic-tag">${escape(e.licence)}</span>` : ''}</summary>
          <pre>${escape(e.text)}</pre>
        </details></li>`,
          )
          .join('\n        ')}
      </ul>
    </section>`,
      )
      .join('\n    ')}
  </main>` +
    foot
  );
}

/** Write /licenses/ into the site build from the app's licence file. */
export function writeLicenses(outDir) {
  const groups = parseLicenses(readFileSync(join(outDir, 'app', 'third-party-licenses.txt'), 'utf8'));
  mkdirSync(join(outDir, 'licenses'), { recursive: true });
  writeFileSync(join(outDir, 'licenses', 'index.html'), licensesPage(groups));
  return groups.reduce((n, g) => n + g.entries.length, 0);
}
