// The Learn section of fledgetone.com (/learn/): hands-on lessons, written for the website and
// separate from the app's guide (GUIDE.md, at /guide/). Each lesson is a Markdown file in learn/
// (NN-slug.md, in order), with a small header:
//
//   ---
//   title: Make your first beat
//   summary: One line for the index and the page's description.
//   level: Beginner            (Beginner, Intermediate or Advanced)
//   time: 10 minutes
//   ---
//
// and a body in the same Markdown as the guide (### headings, lists, > tips, tables, **bold**,
// `code`, links; see guide-pages.mjs), plus three of its own:
//
//   {{shot:name}}          a screenshot from learn/shots/NN-slug.mjs (taken by
//                          scripts/guide-shots/capture.mjs --learn), with its caption
//   {{example:name}}       a button that opens a finished example in the studio, from a song link
//                          the same capture made (left out until it's been made)
//   ```grid                a step-sequencer pattern, one row a sound: x a hit, X an accent,
//   Kick  x...x...x...x...  - or . a rest, | a beat line (ignored)
//   ```
//
// Pages are written at build time by scripts/build-site.mjs: /learn/ (the index) and
// /learn/<slug>/. Styles: site/guide.css (the guide's) and site/learn.css.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escape, renderSection } from './guide-pages.mjs';
import { foot, head } from './guide-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEARN = join(ROOT, 'learn');
const IMG = join(ROOT, 'site', 'learn', 'img');
export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

/** A lesson file's header fields and body lines. */
export function parseLesson(text, file = '') {
  const m = text.replace(/\r/g, '').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: no --- header`);
  const meta = Object.fromEntries(
    m[1]
      .split('\n')
      .filter((l) => l.includes(':'))
      .map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()])
  );
  for (const k of ['title', 'summary', 'level', 'time']) if (!meta[k]) throw new Error(`${file}: no ${k} in the header`);
  if (!LEVELS.includes(meta.level)) throw new Error(`${file}: level must be one of ${LEVELS.join(', ')}`);
  return { ...meta, lines: m[2].split('\n') };
}

/** A ```grid block as a step grid: rows of a name and its steps. */
export function renderGrid(rows) {
  const parsed = rows
    .filter((r) => r.trim())
    .map((r) => {
      const m = r.match(/^\s*(.+?)\s{2,}([xX.\-| ]+)\s*$/) ?? r.match(/^\s*(\S+)\s+([xX.\-| ]+)\s*$/);
      if (!m) throw new Error(`grid row "${r}": a name, two spaces, then x X . - |`);
      return { name: m[1], steps: [...m[2].replace(/[| ]/g, '')] };
    });
  const n = Math.max(...parsed.map((r) => r.steps.length));
  const beat = n % 4 === 0 ? 4 : n % 3 === 0 ? 3 : n;
  const head = `<tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${i % beat === 0 ? i / beat + 1 : ''}</th>`).join('')}</tr>`;
  const body = parsed
    .map(
      (r) =>
        `<tr><th scope="row">${escape(r.name)}</th>${Array.from({ length: n }, (_, i) => {
          const c = r.steps[i] ?? '.';
          const cls = [c === 'x' ? 'on' : c === 'X' ? 'on acc' : '', i % beat === 0 ? 'beat' : ''].filter(Boolean).join(' ');
          return `<td${cls ? ` class="${cls}"` : ''}></td>`;
        }).join('')}</tr>`
    )
    .join('');
  const label = parsed.map((r) => `${r.name}: ${r.steps.map((c, i) => (c === 'x' || c === 'X' ? i + 1 : null)).filter(Boolean).join(', ') || 'none'}`).join('; ');
  return `<div class="l-grid" role="img" aria-label="${escape(`Steps: ${label}`)}"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** The screenshots (learn/shots/<lesson>.mjs) and example links taken for a lesson. */
async function assetsFor(slugName) {
  const shotsFile = join(LEARN, 'shots', `${slugName}.mjs`);
  const shots = existsSync(shotsFile) ? (await import(shotsFile)).SHOTS : [];
  const read = (f) => (existsSync(join(IMG, f)) ? JSON.parse(readFileSync(join(IMG, f), 'utf8')) : {});
  return { shots, sizes: read(`${slugName}.sizes.json`), links: read(`${slugName}.links.json`) };
}

function figure(shot, sizes) {
  const size = sizes[shot.file];
  if (!size) return '';
  const [w, h] = size;
  const css = w / 2;
  const kind = shot.phone ? ' phone' : css >= 1100 ? ' wide' : css < 700 ? ' narrow' : '';
  const src = `/learn/img/${shot.file}.webp`;
  return `<figure class="g-shot${kind}"${kind === ' narrow' ? ` style="--w: ${Math.round(css)}px"` : ''}><a href="${src}"><img src="${src}" width="${w}" height="${h}" alt="${escape(shot.alt)}" loading="lazy" decoding="async" /></a><figcaption>${escape(shot.caption)}</figcaption></figure>`;
}

function exampleButton(name, links) {
  const link = links[name];
  if (!link) return '';
  return `<p class="l-example"><a class="btn btn-primary" href="${escape(link.url)}">Open the example in the studio</a><span>${escape(link.label ?? 'The finished example, ready to play and change.')}</span></p>`;
}

/** A lesson's body as HTML: the guide's Markdown, with its shots, examples and step grids put in. */
export function renderLesson(lines, { shots = [], sizes = {}, links = {} } = {}) {
  const out = [];
  const headings = [];
  let chunk = [];
  const flush = () => {
    if (!chunk.length) return;
    const r = renderSection(chunk);
    out.push(r.html);
    headings.push(...r.headings);
    chunk = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const shot = line.match(/^\{\{shot:([\w-]+)\}\}\s*$/);
    const example = line.match(/^\{\{example:([\w-]+)\}\}\s*$/);
    if (shot) {
      flush();
      const s = shots.find((x) => x.file === shot[1]);
      if (!s) throw new Error(`no shot "${shot[1]}" in the lesson's shots file`);
      out.push(figure(s, sizes));
    } else if (example) {
      flush();
      out.push(exampleButton(example[1], links));
    } else if (/^```grid\s*$/.test(line)) {
      flush();
      const rows = [];
      while (++i < lines.length && !/^```\s*$/.test(lines[i])) rows.push(lines[i]);
      out.push(renderGrid(rows));
    } else chunk.push(line);
  }
  flush();
  return { html: out.filter(Boolean).join('\n'), headings };
}

/** Every lesson, in order: { slug, n, title, summary, level, time, html, headings }. */
export async function lessons() {
  if (!existsSync(LEARN)) return [];
  const files = readdirSync(LEARN).filter((f) => /^\d+-[\w-]+\.md$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    const slugName = f.replace(/\.md$/, '');
    const lesson = parseLesson(readFileSync(join(LEARN, f), 'utf8'), f);
    const assets = await assetsFor(slugName);
    out.push({ ...lesson, slug: slugName.replace(/^\d+-/, ''), file: slugName, n: out.length + 1, ...renderLesson(lesson.lines, assets) });
  }
  return out;
}

const levelTag = (level) => `<span class="l-level l-${level.toLowerCase()}">${level}</span>`;

const learnHead = (opts) => head({ ...opts, current: 'learn' }).replace('<link rel="stylesheet" href="/guide.css" />', '<link rel="stylesheet" href="/guide.css" />\n  <link rel="stylesheet" href="/learn.css" />');

function indexPage(all) {
  return (
    learnHead({
      title: 'Learn Fledgetone: hands-on lessons',
      description: 'Step-by-step lessons with screenshots and examples: beats, chords, bass, arranging, mixing, vocals, scoring video, game music and more.',
      path: 'learn/',
    }) +
    `
  <main id="main" class="g-index wrap">
    <div class="g-hero">
      <p class="mono-label">Learn</p>
      <h1>Make music with Fledgetone</h1>
      <p class="lede">Hands-on lessons, one idea at a time: open the studio beside this page and follow along. Each one builds a real example you can open at the end. For every button and setting, see the <a href="/guide/">guide</a>.</p>
    </div>
    ${LEVELS.map((level) => {
      const these = all.filter((l) => l.level === level);
      if (!these.length) return '';
      return `<h2 class="l-group">${level}</h2>
    <ol class="g-cards l-cards">
      ${these
        .map(
          (l) => `<li>
        <a href="/learn/${l.slug}/">
          <span class="l-num mono-label">Lesson ${l.n} · ${escape(l.time)}</span>
          <h2>${escape(l.title)}</h2>
          <p>${escape(l.summary)}</p>
        </a>
      </li>`
        )
        .join('\n      ')}
    </ol>`;
    }).join('\n    ')}
  </main>` +
    foot
  );
}

function lessonPage(l, all) {
  const prev = all[l.n - 2];
  const next = all[l.n];
  return (
    learnHead({ title: `${l.title} · Learn Fledgetone`, description: l.summary, path: `learn/${l.slug}/` }) +
    `
  <div class="g-layout wrap">
    <nav class="g-side" aria-label="Lessons">
      <details class="g-sections" open>
        <summary><span class="mono-label">Lessons</span> <span class="g-current">${escape(l.title)}</span></summary>
        <ol>
          ${all.map((o) => `<li><a href="/learn/${o.slug}/"${o.slug === l.slug ? ' aria-current="page"' : ''}>${o.n}. ${escape(o.title)}</a></li>`).join('\n          ')}
        </ol>
      </details>
    </nav>
    <main id="main" class="g-article">
      <p class="g-crumbs"><a href="/learn/">Learn</a> <span aria-hidden="true">/</span> Lesson ${l.n}</p>
      <h1>${escape(l.title)}</h1>
      <p class="l-meta">${levelTag(l.level)}<span>${escape(l.time)}</span><a href="/app/" target="_blank" rel="noopener">Open the studio beside this page</a></p>
      ${l.html}
      <nav class="g-pager" aria-label="Previous and next lessons">
        ${prev ? `<a class="g-prev" href="/learn/${prev.slug}/"><span class="mono-label">Previous</span>${escape(prev.title)}</a>` : '<span></span>'}
        ${next ? `<a class="g-next" href="/learn/${next.slug}/"><span class="mono-label">Next</span>${escape(next.title)}</a>` : '<span></span>'}
      </nav>
    </main>
    ${
      l.headings.length > 1
        ? `<nav class="g-toc" aria-label="On this page">
      <p class="mono-label">On this page</p>
      <ol>
        ${l.headings.map((h) => `<li><a href="#${h.id}">${escape(h.title)}</a></li>`).join('\n        ')}
      </ol>
    </nav>`
        : ''
    }
  </div>
  <script>
    if (matchMedia('(max-width: 900px)').matches) document.querySelector('.g-sections').open = false;
  </script>` +
    foot
  );
}

/** The lessons as cards for the home page's Learn section (the first of each level, then the rest). */
export function learnCards(all) {
  if (!all.length) return '';
  const firsts = all.filter((l, i) => all.findIndex((o) => o.level === l.level) === i);
  const ordered = [...firsts, ...all.filter((l) => !firsts.includes(l))];
  return `<ol class="g-cards l-cards l-home">
        ${ordered
          .map(
            (l) => `<li><a href="/learn/${l.slug}/"><span class="l-num mono-label">${l.level} · ${escape(l.time)}</span><h3>${escape(l.title)}</h3><p>${escape(l.summary)}</p></a></li>`
          )
          .join('\n        ')}
      </ol>`;
}

/** Write the Learn pages into outDir (the site build). Returns how many lessons. */
export async function writeLearn(outDir) {
  const all = await lessons();
  if (!all.length) return 0;
  const write = (path, html) => {
    const file = join(outDir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  };
  write('learn/index.html', indexPage(all));
  for (const l of all) write(`learn/${l.slug}/index.html`, lessonPage(l, all));
  return all.length;
}
