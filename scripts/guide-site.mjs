// The guide's pages for fledgetone.com, written into the site build: an index at /guide/ and a
// page per section at /guide/<section>/ (scripts/guide-pages.mjs turns GUIDE.md into their HTML;
// this wraps it in the site's header, navigation and footer, and adds the screenshots listed in
// scripts/guide-shots/shots.mjs). Styles: site/guide.css.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escape, guidePages } from './guide-pages.mjs';
import { SHOTS } from './guide-shots/shots.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://fledgetone.com';

export const head = ({ title, description, path, current = 'guide' }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escape(title)}</title>
  <meta name="description" content="${escape(description)}" />
  <link rel="canonical" href="${SITE}/${path}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Fledgetone" />
  <meta property="og:title" content="${escape(title)}" />
  <meta property="og:description" content="${escape(description)}" />
  <meta property="og:image" content="${SITE}/img/og.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" type="image/svg+xml" href="/app/favicon.svg" />
  <meta name="theme-color" content="#121214" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/guide.css" />
</head>
<body class="guide-page">
  <a class="skip" href="#main">Skip to content</a>
  <div class="wip-bar" role="note"><span class="wip-tag">Work in progress</span> Fledgetone is still being built, so things may change or break.</div>
  <header class="nav">
    <div class="wrap nav-row">
      <a class="brand" href="/" aria-label="Fledgetone home"><img src="/img/logo.png" alt="" width="34" height="34" /><span>Fledgetone</span></a>
      <nav class="nav-links" aria-label="Site">
        <a href="/games/">For games</a>
        <a href="/creators/">For creators</a>
        <a href="/film/">For film</a>
        <a href="/learn/"${current === 'learn' ? ' aria-current="page"' : ''}>Learn</a>
        <a href="/guide/"${current === 'guide' ? ' aria-current="page"' : ''}>Guide</a>
      </nav>
      <div class="nav-cta"><a class="btn btn-primary btn-sm" href="/app/">Open the studio</a></div>
    </div>
  </header>
`;

export const foot = `
  <footer class="footer">
    <div class="wrap foot-row">
      <div class="brand"><img src="/img/logo.png" alt="" width="26" height="26" /><span>Fledgetone</span></div>
      <p>Make music for you.</p>
      <nav aria-label="Footer">
        <a href="/app/">Studio</a>
        <a href="/games/">For games</a>
        <a href="/creators/">For creators</a>
        <a href="/film/">For film</a>
        <a href="/learn/">Learn</a>
        <a href="/guide/">Guide</a>
        <a href="/licenses/">Licences</a>
        <a href="https://github.com/martinmswanson-cmd/fledgetone">Source code</a>
        <a href="https://github.com/martinmswanson-cmd/fledgetone/blob/master/CODE_OF_CONDUCT.md">Code of conduct</a>
      </nav>
    </div>
    <p class="wrap foot-note">Fledgetone is an independent project. It is not affiliated with, endorsed by or sponsored by any company or product named on this site. Unity, Godot, FMOD Studio, Wwise, Premiere, DaVinci Resolve, Final Cut, Chrome, Edge, Safari, Firefox and the other names here are trademarks of their owners, used only to say what Fledgetone works with.</p>
    <div class="wrap foot-note foot-end"><a href="https://www.netlify.com">This site is powered by Netlify</a><span class="foot-credit">Made by Martin Swanson</span></div>
  </footer>
</body>
</html>
`;

/**
 * A section's screenshots and clips as figures. Pictures not taken yet (no entry in sizes.json) are
 * left out, so the guide builds without them. Wide ones may spread beside the text; narrow ones
 * (popovers, panels) keep their own size.
 */
export function figuresFor(sectionId, sizes) {
  return SHOTS.filter((s) => s.section === sectionId && (s.video || sizes[s.file])).map((s) => {
    const note = s.ai ? ` <span class="ai-note">${s.sound ? 'Film: AI-generated. Music: made in Fledgetone.' : `The film in the ${s.video ? 'clip' : 'picture'} is AI-generated.`}</span>` : '';
    const caption = `<figcaption>${escape(s.caption)}${note}</figcaption>`;
    if (s.video) {
      const play = s.sound ? 'controls preload="none"' : 'muted loop playsinline autoplay preload="metadata"';
      return { after: s.after, html: `<figure class="g-shot wide"><video src="${s.video}" poster="${s.poster}" ${play} aria-label="${escape(s.alt)}"></video>${caption}</figure>` };
    }
    const [w, h] = sizes[s.file];
    const css = w / 2; // taken at twice the size, for sharp screens
    const kind = css >= 1100 ? ' wide' : css < 700 ? ' narrow' : '';
    const src = `/guide/img/${s.file}.webp`;
    return {
      after: s.after,
      html: `<figure class="g-shot${kind}"${kind === ' narrow' ? ` style="--w: ${Math.round(css)}px"` : ''}><a href="${src}"><img src="${src}" width="${w}" height="${h}" alt="${escape(s.alt)}" loading="lazy" decoding="async" /></a>${caption}</figure>`,
    };
  });
}

const sectionList = (sections, current) =>
  sections
    .map((s) => `<li><a href="/guide/${s.id}/"${s.id === current ? ' aria-current="page"' : ''}>${escape(s.title)}</a></li>`)
    .join('\n          ');

export const page = {
  index: ({ sections }) =>
    head({
      title: 'Fledgetone guide',
      description: 'How to use Fledgetone: the timeline, piano roll, instruments, mixing, scoring to video, game music, recording and exporting.',
      path: 'guide/',
    }) +
    `
  <main id="main" class="g-index wrap">
    <div class="g-hero">
      <p class="mono-label">Guide</p>
      <h1>How to use Fledgetone</h1>
      <p class="lede">Every part of the studio, one section at a time. The same guide is in the app: click <strong>GUIDE</strong> or press <kbd>?</kbd>.</p>
      <label class="g-filter"><span class="mono-label">Find a topic</span>
        <input id="g-filter" type="search" placeholder="markers, export, tempo…" autocomplete="off" />
      </label>
    </div>
    <ol class="g-cards">
      ${sections
        .map(
          (s) => `<li data-text="${escape([s.title, ...s.headings.map((h) => h.title)].join(' ').toLowerCase())}">
        <a href="/guide/${s.id}/">
          <h2>${escape(s.title)}</h2>
          <p>${escape(s.summary)}</p>
          ${s.headings.length ? `<span class="g-count">${s.headings.length} topic${s.headings.length > 1 ? 's' : ''}</span>` : ''}
        </a>
      </li>`,
        )
        .join('\n      ')}
    </ol>
    <p class="g-none" hidden>Nothing matches. Try another word, or <a href="/app/">search inside the app</a> (Ctrl+K).</p>
  </main>
  <script>
    // Filter the sections by their titles and the topics in them
    const input = document.getElementById('g-filter'), none = document.querySelector('.g-none');
    const cards = [...document.querySelectorAll('.g-cards li')];
    input.addEventListener('input', () => {
      const words = input.value.toLowerCase().split(/\\s+/).filter(Boolean);
      let shown = 0;
      for (const c of cards) { const ok = words.every((w) => c.dataset.text.includes(w)); c.hidden = !ok; shown += ok; }
      none.hidden = shown > 0;
    });
  </script>` +
    foot,

  section: ({ section: s, sections, prev, next }) =>
    head({ title: `${s.title} · Fledgetone guide`, description: s.summary, path: `guide/${s.id}/` }) +
    `
  <div class="g-layout wrap">
    <nav class="g-side" aria-label="Guide sections">
      <details class="g-sections" open>
        <summary><span class="mono-label">Guide</span> <span class="g-current">${escape(s.title)}</span></summary>
        <ol>
          ${sectionList(sections, s.id)}
        </ol>
      </details>
    </nav>
    <main id="main" class="g-article">
      <p class="g-crumbs"><a href="/guide/">Guide</a> <span aria-hidden="true">/</span> ${escape(s.title)}</p>
      <h1>${escape(s.title)}</h1>
      ${s.html}
      <nav class="g-pager" aria-label="Previous and next sections">
        ${prev ? `<a class="g-prev" href="/guide/${prev.id}/"><span class="mono-label">Previous</span>${escape(prev.title)}</a>` : '<span></span>'}
        ${next ? `<a class="g-next" href="/guide/${next.id}/"><span class="mono-label">Next</span>${escape(next.title)}</a>` : '<span></span>'}
      </nav>
    </main>
    ${
      s.headings.length > 1
        ? `<nav class="g-toc" aria-label="On this page">
      <p class="mono-label">On this page</p>
      <ol>
        ${s.headings.map((h) => `<li><a href="#${h.id}">${escape(h.title)}</a></li>`).join('\n        ')}
      </ol>
    </nav>`
        : ''
    }
  </div>
  <script>
    // On small screens the section list starts folded; clips stay still for reduced motion
    if (matchMedia('(max-width: 900px)').matches) document.querySelector('.g-sections').open = false;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.querySelectorAll('.g-shot video').forEach((v) => { v.pause(); v.controls = true; });
  </script>` +
    foot,
};

/** Write the guide's pages into outDir (the site build). Returns how many. */
export function writeGuide(outDir) {
  const sizesFile = join(ROOT, 'site', 'guide', 'img', 'sizes.json');
  const sizes = existsSync(sizesFile) ? JSON.parse(readFileSync(sizesFile, 'utf8')) : {};
  const pages = guidePages(readFileSync(join(ROOT, 'GUIDE.md'), 'utf8'), page, (id) => figuresFor(id, sizes));
  for (const p of pages) {
    const file = join(outDir, p.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, p.html);
  }
  return pages.length;
}
