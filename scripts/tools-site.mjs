// The Tools page for fledgetone.com (/tools/): Fledgetone's own tools as zips people can use in
// their own programs, built from the repository on every site build (so they're always current)
// into dist-site/tools/: the game music players, Fledge Synth (WebAssembly with a Web Audio
// wrapper), the Drop pad's effects and the song player (the web runtime). Each zip has its README
// (tools/<tool>/README.md, with parts filled in here), the GPL's text and a notice; each README is
// also a page at /tools/<tool>/. The hand-written parts of the packages (wrappers, examples,
// READMEs) are in tools/; the rest comes from src/, engine/ and public/.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { escape, inline, slug } from './guide-pages.mjs';
import { foot, head } from './guide-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE_URL = 'https://github.com/martinmswanson-cmd/fledgetone';

// --- A .zip writer (deflated where that's smaller, else stored) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (the zip polynomial) of `data`. */
export function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A .zip of `entries` ({ name, data: Buffer | string }), every file dated `date` (so the same
 * files make the same zip). Names use forward slashes; folders are implied by them.
 */
export function makeZip(entries, date = new Date(2026, 0, 1)) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.name)) throw new Error(`${e.name} is in the zip twice`);
    seen.add(e.name);
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const name = Buffer.from(e.name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const deflate = packed.length < data.length;
    const body = deflate ? packed : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(0x031e, 4); // made by: Unix, 3.0 (so the permissions below are read)
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt16LE(dosTime, 12);
    cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    // (extra, comment, disk, internal attributes: 0)
    cen.writeUInt32LE(((e.executable ? 0o755 : 0o644) | 0o100000) << 16 >>> 0, 38);
    cen.writeUInt32LE(offset, 42);
    parts.push(local, name, body);
    central.push(cen, name);
    offset += local.length + name.length + body.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

/** A file size as people read it: "840 bytes", "12 KB", "1.4 MB". */
export function formatSize(bytes) {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1000 / 1000).toFixed(1)} MB`;
}

// --- What every README says ---

export const HEADER = `Part of Fledgetone (https://fledgetone.com), © Martin Swanson, GPL-3.0-or-later.
Source code: ${SOURCE_URL}`;

export const LICENCE = `## Licence

These files are free software under the GNU General Public License, version 3 or (at your choice)
any later version: GPL-3.0-or-later. The full text is in \`LICENSE\`. In plain words:

- **Free to use, change and share.** You can use them for anything, for free, change them, and
  give them to others, changed or not.
- **A program that includes them is GPL too.** If you share a program that includes these files,
  or code made from them, you must release that whole program under the GPL as well, and give the
  people you share it with its source code (or a way to get it).
- **Keep the notices.** Keep this licence and the copyright notice with the files.
- **No warranty.** They come as they are, with no promise that they work for your purpose.
- **Your music is yours.** The licence covers this code, not what you make with it: the music,
  sounds and songs you make with these tools are yours, to use and share on any terms you like.

This is a summary to help you; the licence text in \`LICENSE\` is what counts. Questions or
concerns: email martin@twobirdsworkshop.com.`;

/** The NOTICE that goes in every zip. */
export const notice = (title, credits = 'Everything in this zip is Fledgetone\'s own code.') => `${title}
${'='.repeat(title.length)}

${HEADER}

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. It is distributed in the hope that it will be
useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See the GNU General Public License (LICENSE) for more details.

In plain words: you can use, change and share it for free. If you share a program that includes
it, that program must be released under the GPL too, with its source code.

${credits}
`;

/** Fill a README's {{NAME}}s. Every one must be given (a missing one is a mistake in the README). */
export function fill(template, values) {
  const all = { HEADER, LICENCE, ...values };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
    if (!(k in all)) throw new Error(`README asks for {{${k}}}, which isn't given`);
    return all[k];
  });
}

// --- The READMEs as pages ---

/** A table row's cells (| a | `b|c` | splits on the bars outside code). */
function cells(row) {
  const out = [];
  let cell = '';
  let code = false;
  for (const ch of row.trim().replace(/^\||\|$/g, '')) {
    if (ch === '`') code = !code;
    if (ch === '|' && !code) {
      out.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/**
 * The Markdown the READMEs use as HTML: headings, paragraphs, lists, tables, code blocks and
 * inline code, bold and links. "#" is the page's title (returned apart); "##" and "###" are its
 * sections. Plain URLs in text become links.
 */
export function markdownToHtml(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const out = [];
  const headings = [];
  let title = '';
  let i = 0;
  const LIST = /^\s*([-*]|\d+\.) /;
  const text = (s) => inline(s).replace(/(^|[\s(])(https:\/\/[^\s<)]+[^\s<).,:;])/g, '$1<a href="$2" rel="noopener">$2</a>');
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      const t = h[2].trim();
      if (h[1] === '#') title = t;
      else {
        const id = slug(t);
        if (h[1] === '##') headings.push({ id, title: t });
        const tag = h[1] === '##' ? 'h3' : 'h4';
        out.push(`<${tag} id="${id}"><a href="#${id}">${inline(t)}</a></${tag}>`);
      }
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(`<pre class="code"><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const [top, , ...body] = rows;
      out.push(
        `<div class="g-table"><table><thead><tr>${cells(top).map((c) => `<th>${text(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${text(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      );
      continue;
    }
    if (LIST.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items = [];
      while (i < lines.length && LIST.test(lines[i])) {
        let item = lines[i++].replace(LIST, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !LIST.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${text(it)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|\s*\||\s*([-*]|\d+\.) )/.test(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${text(para.join(' '))}</p>`);
  }
  return { title, html: out.join('\n'), headings };
}

/** A README's page at /tools/<id>/. */
export function readmePage(tool, readme, zip) {
  const { title, html } = markdownToHtml(readme);
  return (
    head({ title: `${title} · Fledgetone tools`, description: tool.what, path: `tools/${tool.id}/`, current: 'tools' }) +
    `
  <main id="main" class="g-index wrap tool-readme">
    <article class="g-article">
      <p class="g-crumbs"><a href="/tools/">Tools</a> <span aria-hidden="true">/</span> ${escape(title)}</p>
      <h1>${escape(title)}</h1>
      <p class="tool-get"><a class="btn btn-primary btn-sm" href="/tools/${zip.file}" download>${DOWNLOAD_ICON} Download ${escape(zip.file)} (${formatSize(zip.size)})</a> <a class="btn btn-ghost btn-sm" href="/tools/${tool.id}/README.md">README.md</a></p>
      ${html}
    </article>
  </main>
` +
    foot
  );
}

// --- The Tools page ---

const DOWNLOAD_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';
const DOC_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/></svg>';

/** The tools, in the page's order (`what` is the card's text and the README page's description). */
export const TOOLS = [
  {
    id: 'game-music-players',
    title: 'Game music players',
    color: '--green',
    who: 'For game developers',
    what: 'The players that make a game kit from the studio play in your game: they switch states on the beat, build layers with the intensity, and play stingers and sound effects. For the web, Godot 4 and Unity.',
    inZip: ['A web player (JavaScript, with TypeScript types)', 'A Godot 4 player and an example scene', 'A Unity player and an example component'],
  },
  {
    id: 'fledge-synth',
    title: 'Fledge Synth',
    color: '--cyan',
    who: 'For web developers and music app makers',
    what: 'Fledgetone\'s own synthesizer, compiled to WebAssembly, with a small wrapper to play it through the Web Audio API: notes, presets and every parameter by name.',
    inZip: ['The synth (WebAssembly) and its Web Audio wrapper', 'An example page that plays a few notes', 'Its Rust source code, to build it yourself'],
  },
  {
    id: 'drop-effects',
    title: 'Drop pad effects',
    color: '--red',
    who: 'For web developers and browser games',
    what: 'The Drop pad\'s effects for any sound in a web page: Stutter, Filter, Tape stop, Crush, Gate and Echo, held as long as you like and in time with the music.',
    inZip: ['The effects as an AudioWorklet, with a helper to turn them on and off', 'The same effects as a plain JavaScript module', 'An example page with a beat and a pad for each effect'],
  },
  {
    id: 'song-player',
    title: 'Song player',
    color: '--purple',
    who: 'For web games where size matters',
    what: 'Plays a song saved from the studio in a web page with no audio files: it makes the music in the browser from the song\'s small project file, then plays it with states, intensity and stingers.',
    inZip: ['The player (one JavaScript module) and its types', 'An example page: choose a saved song and play it', 'The licences of the open-source libraries inside it'],
    note: 'Songs with recorded instruments download their recordings while they load, from fledgetone.com and a few public sample collections. The README says which.',
  },
];

const PLAIN_LICENCE = `<ul class="ticks tool-terms" style="--c: var(--cyan)">
          <li><strong>Free to use, change and share.</strong> Use them for anything, for free, change them, and give them to others.</li>
          <li><strong>A program that includes them is GPL too.</strong> If you share a program that includes them, or code made from them, you must release that whole program under the GPL as well, with its source code.</li>
          <li><strong>Keep the notices.</strong> The licence and the copyright notice stay with the files.</li>
          <li><strong>No warranty.</strong> They come as they are.</li>
          <li><strong>Your music is yours.</strong> The licence covers the tools' code, not what you make with them: the music, sounds and songs you make are yours, on any terms you like.</li>
        </ul>
        <p>Questions or concerns? Email <a href="mailto:martin@twobirdsworkshop.com">martin@twobirdsworkshop.com</a>.</p>`;

/** The Tools page, from the tools and their zips ({ file, size } by tool id). */
export function toolsPage(tools, zips) {
  const card = (t) => {
    const z = zips[t.id];
    return `<article class="tool-card" style="--c: var(${t.color})" aria-labelledby="${t.id}-title">
          <p class="tool-who">${escape(t.who)}</p>
          <h3 id="${t.id}-title">${escape(t.title)}</h3>
          <p>${escape(t.what)}</p>
          <p class="tool-in">In the zip</p>
          <ul class="ticks">
            ${t.inZip.map((x) => `<li>${escape(x)}</li>`).join('\n            ')}
          </ul>
          ${t.note ? `<p class="tool-note">${escape(t.note)}</p>` : ''}
          <div class="tool-actions">
            <a class="btn btn-primary btn-sm" href="/tools/${z.file}" download>${DOWNLOAD_ICON} Download</a>
            <a class="btn btn-ghost btn-sm" href="/tools/${t.id}/">${DOC_ICON} README</a>
          </div>
          <p class="tool-meta"><span>${escape(z.file)}</span><span>${formatSize(z.size)}</span><span>GPL-3.0-or-later</span></p>
        </article>`;
  };
  return `<!doctype html>
<!--
  fledgetone.com/tools/: Fledgetone's own tools to download and use in your own programs. Written
  by scripts/tools-site.mjs on every site build, with the zips next to it (always current).
-->
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fledgetone tools: players, synth and effects for your own programs</title>
  <meta name="description" content="Download Fledgetone's own tools to use in your own programs: the game music players for the web, Godot and Unity, Fledge Synth as WebAssembly, the Drop pad effects and the song player. Free software under the GPL." />
  <link rel="canonical" href="https://fledgetone.com/tools/" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Fledgetone" />
  <meta property="og:title" content="Fledgetone tools" />
  <meta property="og:description" content="Fledgetone's game music players, synth and effects, to use in your own programs. Free software under the GPL." />
  <meta property="og:url" content="https://fledgetone.com/tools/" />
  <meta property="og:image" content="https://fledgetone.com/img/og.jpg" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" type="image/svg+xml" href="/app/favicon.svg" />
  <link rel="apple-touch-icon" href="/app/apple-touch-icon.png" />
  <link rel="manifest" href="/app/manifest.webmanifest" />
  <meta name="theme-color" content="#121214" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <script src="/main.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <div class="wip-bar" role="note"><span class="wip-tag">Work in progress</span> Fledgetone is still being built, so things may change or break.</div>

  <header class="nav">
    <div class="wrap nav-row">
      <a class="brand" href="/" aria-label="Fledgetone home">
        <img src="/img/logo.png" alt="" width="34" height="34" />
        <span>Fledgetone</span>
      </a>
      <nav class="nav-links" aria-label="Pages">
        <a href="/games/">For games</a>
        <a href="/creators/">For creators</a>
        <a href="/scoring/">For scoring</a>
        <a href="/learn/">Learn</a>
        <a href="/guide/">Guide</a>
      </nav>
      <div class="nav-cta">
        <a class="btn btn-primary btn-sm" href="/app/">Open the studio</a>
      </div>
    </div>
  </header>

  <main id="main">
    <section class="hero page-hero" style="--c: var(--cyan)" data-ruler="Intro" data-ruler-color="--cyan">
      <canvas class="hero-roll" aria-hidden="true"></canvas>
      <div class="wrap hero-copy">
        <p class="eyebrow">
          <span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
          <span class="who">Tools</span>
        </p>
        <h1>Take Fledgetone's parts into your own programs.</h1>
        <p class="lede">The players, the synth and the effects inside Fledgetone, packed to use in your own games, sites and apps. Each download has the code, an example and a README that shows how to use it.</p>
        <p class="fineprint">Free software under the GNU General Public License, version 3 or later. Made fresh from the source code every time the site is updated.</p>
      </div>
    </section>

    <section id="downloads" class="wrap page-section tools" aria-labelledby="downloads-title" data-ruler="Tools" data-ruler-color="--cyan">
      <h2 id="downloads-title" class="section-title"><span class="mono-label">Downloads</span>Pick a tool</h2>
      <div class="tool-cards">
        ${tools.map(card).join('\n        ')}
      </div>
    </section>

    <section id="licence" class="wrap page-section tools" aria-labelledby="licence-title" data-ruler="Licence" data-ruler-color="--amber">
      <h2 id="licence-title" class="section-title"><span class="mono-label">Licence</span>What you can do with them</h2>
      <div class="tool-licence">
        <p>Every tool here is free software under the <a href="/tools/LICENSE.txt">GNU General Public License, version 3</a> or (at your choice) any later version: GPL-3.0-or-later. In plain words:</p>
        ${PLAIN_LICENCE}
        <p class="note-line">This is a summary; the licence text is what counts. The game music players and the song player also come inside the game kits and runtime kits you export from the studio, and there they carry an extra permission: they can ship inside any game, closed-source too, but changes to the players themselves stay under the GPL (see the kit's LICENSE-exported-files.txt). The source code of all of Fledgetone is on <a href="${SOURCE_URL}">GitHub</a>, and the open-source software it uses is on the <a href="/licenses/">licences page</a>.</p>
      </div>
    </section>
  </main>
` + foot;
}

// --- Building the zips ---

const read = (p) => readFileSync(join(ROOT, p));
const readText = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Every file under `dir` (relative to the repository), skipping `skip` folders. */
function filesUnder(dir, skip = []) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) {
        if (!skip.includes(e.name)) walk(p);
      } else out.push(p);
    }
  };
  walk(dir);
  return out;
}

/**
 * Bundle `entry` (TypeScript welcome) to one plain ES module with Vite, not minified, and the npm
 * packages that went into it. `config` is a Vite config file to start from (else none).
 */
async function bundle(entry, { config, env = {} } = {}) {
  const { build } = await import('vite');
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const packages = new Map();
  try {
    const result = await build({
      configFile: config ? join(ROOT, config) : false,
      root: ROOT,
      logLevel: 'silent',
      publicDir: false,
      plugins: [
        {
          name: 'packages-inside',
          generateBundle() {
            for (const id of this.getModuleIds()) {
              const m = id.replace(/\\/g, '/').match(/^(.*\/node_modules\/)((?:@[^/]+\/)?[^/]+)\//);
              if (m && this.getModuleInfo(id)?.code) packages.set(m[2], m[1] + m[2]);
            }
          },
        },
      ],
      build: {
        write: false,
        emptyOutDir: false,
        minify: config ? undefined : false,
        lib: { entry: join(ROOT, entry), formats: ['es'], fileName: () => 'out.js' },
        rollupOptions: { output: { codeSplitting: false } },
      },
    });
    const output = (Array.isArray(result) ? result[0] : result).output;
    const chunk = output.find((o) => o.type === 'chunk' && o.isEntry);
    return { code: chunk.code, packages };
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Import a bundled module's code (for the build's own use). */
const importCode = (code) => import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

/** The licence texts of npm packages, as the app's third-party-licenses.txt has them. */
function packageLicences(packages) {
  return [...packages]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, dir]) => {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
      const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${pkg.license ?? 'see the package'}`;
      return { name, version: pkg.version, licence: pkg.license ?? 'unknown', text };
    });
}

/** A Markdown table cell's text (bars escaped). */
const cell = (s) => String(s).replace(/\|/g, '\\|');

/** Fledge Synth's parameters and presets, read from fledge.wasm itself. */
export function readSynth(wasm) {
  const e = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports;
  const decoder = new TextDecoder();
  const str = (p) => {
    const b = new Uint8Array(e.memory.buffer);
    let q = p;
    while (b[q]) q++;
    return decoder.decode(b.slice(p, q));
  };
  const h = e.bb_create(0, 48000);
  const params = [];
  for (let i = 0; i < e.bb_params(h); i++) params.push({ name: str(e.bb_param_name(h, i)), value: e.bb_get(h, i), text: str(e.bb_param_display(h, i)) });
  const presets = [];
  for (let i = 0; i < e.bb_programs(h); i++) presets.push(str(e.bb_program_name(h, i)));
  // Make some sound, to be sure the module plays (and stays quiet enough)
  e.bb_midi(h, 0x90, 60, 100);
  let peak = 0;
  let finite = true;
  for (let b = 0; b < 100; b++) {
    e.bb_process(h, 128);
    for (const w of [2, 3]) {
      const out = new Float32Array(e.memory.buffer, e.bb_buffer(h, w), 128);
      for (const x of out) {
        if (!Number.isFinite(x)) finite = false;
        peak = Math.max(peak, Math.abs(x));
      }
    }
  }
  e.bb_destroy(h);
  return { params, presets, peak, finite };
}

export async function gameMusicPlayers() {
  // (The scripts by paths relative to the scene, so it works in whatever folder the three files share)
  const godotScene = `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="music_example.gd" id="1"]
[ext_resource type="Script" path="AdaptiveMusic.gd" id="2"]

[node name="MusicExample" type="Node"]
script = ExtResource("1")

[node name="Music" type="Node" parent="."]
script = ExtResource("2")
music_dir = "res://music/"

[node name="Help" type="Label" parent="."]
offset_left = 24.0
offset_top = 24.0
offset_right = 824.0
offset_bottom = 624.0
`;
  return {
    readme: fill(readText('tools/game-music-players/README.md'), {}),
    files: [
      { name: 'web/adaptive-music.js', data: read('src/gameKit/adaptive-music.js') },
      { name: 'web/adaptive-music.d.ts', data: read('src/gameKit/adaptive-music.d.ts') },
      { name: 'godot/AdaptiveMusic.gd', data: read('src/gameKit/godot/AdaptiveMusic.gd') },
      { name: 'godot/music_example.gd', data: read('src/gameKit/godot/music_example.gd') },
      { name: 'godot/music_example.tscn', data: godotScene },
      { name: 'unity/AdaptiveMusic.cs', data: read('src/gameKit/unity/AdaptiveMusic.cs') },
      { name: 'unity/AdaptiveMusicExample.cs', data: read('src/gameKit/unity/AdaptiveMusicExample.cs') },
    ],
    notice: notice('Game music players'),
  };
}

async function fledgeSynth() {
  const wasm = read('public/fledgetone-plugins/fledge.wasm');
  const synth = readSynth(wasm);
  if (!synth.finite || synth.peak <= 0 || synth.peak >= 1) throw new Error(`fledge.wasm didn't play a note cleanly (peak ${synth.peak})`);
  // The choices' options and their room to grow, as the studio's editor has them (fledgeLayout.ts)
  const layout = await importCode((await bundle('src/audio/plugins/fledgeLayout.ts')).code);
  const macros = await importCode((await bundle('src/audio/plugins/fledgeMacros.ts')).code);
  const names = new Set(synth.params.map((p) => p.name));
  const choices = {};
  const switches = new Set();
  for (const c of layout.allFledgeControls()) {
    if (!names.has(c.p)) throw new Error(`fledgeLayout.ts names ${c.p}, which fledge.wasm doesn't have`);
    if (c.kind === 'choice') choices[c.p] = { options: c.options, cap: c.cap };
    else if (c.kind === 'toggle') switches.add(c.p);
  }
  if (synth.presets.join('\n') !== macros.FLEDGE_PRESETS.join('\n')) throw new Error('fledge.wasm\'s presets differ from fledgeMacros.ts: rebuild the synth (engine/fledge-synth/build.sh)');
  const choicesJs = `// The options of Fledge Synth's parameters that are choices, and the room each list keeps to
// grow (an option's value is its place / (cap - 1)). Part of Fledgetone (https://fledgetone.com),
// © Martin Swanson, GPL-3.0-or-later. Written from the studio's own list (fledgeLayout.ts).
export const CHOICES = ${JSON.stringify(choices, null, 2)};
`;
  const kindOf = (name) => (choices[name] ? 'choice' : switches.has(name) ? 'switch' : 'knob');
  const PARAMS = ['| # | Parameter | Kind | Starts at |', '| --- | --- | --- | --- |', ...synth.params.map((p, i) => `| ${i} | ${cell(p.name)} | ${kindOf(p.name)} | ${cell(p.text)} |`)].join('\n');
  const PRESETS = [
    '| # | Preset | Its macros |',
    '| --- | --- | --- |',
    ...synth.presets.map((name, i) => `| ${i} | ${cell(name)} | ${cell((macros.FLEDGE_MACRO_NAMES[name] ?? []).map((m, k) => `${k + 1}: ${m}`).join(', ') || '(none)')} |`),
  ].join('\n') + '\n\nA preset\'s macros are the parameters `Macro 1` to `Macro 4`: each moves several things at once.';
  const CHOICES = Object.entries(choices)
    .map(([name, c]) => `- **${name}**: ${c.options.join(', ')}`)
    .join('\n');
  const source = filesUnder('engine/fledge-synth', ['target']).map((p) => ({ name: `source/${relative('engine/fledge-synth', p)}`, data: read(p), executable: p.endsWith('.sh') }));
  return {
    readme: fill(readText('tools/fledge-synth/README.md'), { PRESET_COUNT: String(synth.presets.length), PARAMS, PRESETS, CHOICES }),
    files: [
      { name: 'fledge-synth.js', data: read('tools/fledge-synth/fledge-synth.js') },
      { name: 'fledge-processor.js', data: read('tools/fledge-synth/fledge-processor.js') },
      { name: 'fledge-choices.js', data: choicesJs },
      { name: 'fledge.wasm', data: wasm },
      { name: 'index.html', data: read('tools/fledge-synth/index.html') },
      ...source,
    ],
    notice: notice('Fledge Synth', 'Everything in this zip is Fledgetone\'s own code. The synth uses no other libraries (see source/Cargo.toml).'),
  };
}

async function dropEffects() {
  const { code, packages } = await bundle('src/audio/effects/dropFx.ts');
  if (packages.size) throw new Error(`dropFx.ts now takes in npm packages (${[...packages.keys()].join(', ')}): list their licences`);
  const kernel = await importCode(code);
  if (kernel.DROP_PROCESSOR !== 'bbx-drop') throw new Error('tools/drop-effects/drop-effects.js names the processor bbx-drop: update it');
  const top = '// The Drop pad\'s effects. Part of Fledgetone (https://fledgetone.com), © Martin Swanson,\n// GPL-3.0-or-later. Bundled from src/audio/effects/dropFx.ts';
  return {
    readme: fill(readText('tools/drop-effects/README.md'), {}),
    files: [
      { name: 'drop-effects.js', data: read('tools/drop-effects/drop-effects.js') },
      { name: 'drop-processor.js', data: `${top} (its AudioWorklet processor, loaded by drop-effects.js).\n${kernel.DROP_WORKLET_SOURCE.trim()}\n` },
      { name: 'drop-fx.js', data: `${top}.\n${code}` },
      { name: 'drop-fx.ts', data: read('src/audio/effects/dropFx.ts') },
      { name: 'index.html', data: read('tools/drop-effects/index.html') },
    ],
    notice: notice('Drop pad effects'),
  };
}

async function songPlayer() {
  // As the site's own studio: with the GPL plugins (songs made on the site can use them)
  const { code, packages } = await bundle('src/runtime/player.ts', { config: 'vite.runtime.config.ts', env: { VITE_GPL_PLUGINS: '1' } });
  const libs = packageLicences(packages);
  const THIRD_PARTY = [
    '`bos-player.js` has these open-source libraries inside it, each under its own licence (all of them permit this). Their full texts are in `THIRD-PARTY-LICENSES.txt`.',
    '',
    '| Library | Version | Licence |',
    '| --- | --- | --- |',
    ...libs.map((l) => `| ${cell(l.name)} | ${cell(l.version)} | ${cell(l.licence)} |`),
    '',
    'The built-in plugin effects and the recordings it downloads have their own licences: see https://fledgetone.com/licenses/ and https://fledgetone.com/guide/credits/.',
  ].join('\n');
  const thirdParty = `The song player (bos-player.js) includes the following open-source software.\n\n${libs
    .map((l) => `${l.name} ${l.version} (${l.licence})\n${'='.repeat(60)}\n${l.text}`)
    .join('\n\n\n')}\n`;
  const player = Buffer.from(code);
  return {
    readme: fill(readText('tools/song-player/README.md'), {
      PLAYER_SIZE: formatSize(player.length),
      PLAYER_GZIP: formatSize(gzipSync(player).length),
      THIRD_PARTY,
    }),
    files: [
      { name: 'bos-player.js', data: player },
      { name: 'bos-player.d.ts', data: read('tools/song-player/bos-player.d.ts') },
      { name: 'adaptive-music.d.ts', data: read('src/gameKit/adaptive-music.d.ts') },
      { name: 'index.html', data: read('tools/song-player/index.html') },
      { name: 'THIRD-PARTY-LICENSES.txt', data: thirdParty },
    ],
    notice: notice(
      'Song player',
      `Fledgetone's own code, with these open-source libraries bundled inside bos-player.js, each under its own licence (texts in THIRD-PARTY-LICENSES.txt):\n${libs.map((l) => `  ${l.name} ${l.version} (${l.licence})`).join('\n')}`,
    ),
  };
}

const BUILDERS = { 'game-music-players': gameMusicPlayers, 'fledge-synth': fledgeSynth, 'drop-effects': dropEffects, 'song-player': songPlayer };

/** The date the zips' files carry: the version's (package.json's version is the release date). */
function versionDate() {
  const v = JSON.parse(readText('package.json')).version;
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(2026, 0, 1);
}

/** Write /tools/: the zips, each README as a page and as README.md, the licence, and the page. */
export async function writeTools(outDir) {
  const dir = join(outDir, 'tools');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const licence = read('LICENSE');
  cpSync(join(ROOT, 'LICENSE'), join(dir, 'LICENSE.txt'));
  const date = versionDate();
  const zips = {};
  for (const tool of TOOLS) {
    const { readme, files, notice: note } = await BUILDERS[tool.id]();
    const file = `fledgetone-${tool.id}.zip`;
    const zip = makeZip(
      [{ name: 'README.md', data: readme }, { name: 'NOTICE.txt', data: note }, { name: 'LICENSE', data: licence }, ...files].map((f) => ({ ...f, name: `fledgetone-${tool.id}/${f.name}` })),
      date,
    );
    writeFileSync(join(dir, file), zip);
    zips[tool.id] = { file, size: zip.length, sha256: createHash('sha256').update(zip).digest('hex') };
    mkdirSync(join(dir, tool.id), { recursive: true });
    writeFileSync(join(dir, tool.id, 'README.md'), readme);
    writeFileSync(join(dir, tool.id, 'index.html'), readmePage(tool, readme, zips[tool.id]));
  }
  writeFileSync(join(dir, 'index.html'), toolsPage(TOOLS, zips));
  return TOOLS.map((t) => `${zips[t.id].file} ${formatSize(zips[t.id].size)}`).join(', ');
}

// Run on its own (node scripts/tools-site.mjs [outDir]) to make just the tools, e.g. to try them
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2] ?? join(ROOT, 'dist-site');
  if (!existsSync(out) || !statSync(out).isDirectory()) mkdirSync(out, { recursive: true });
  console.log(`tools: ${await writeTools(out)}`);
}
