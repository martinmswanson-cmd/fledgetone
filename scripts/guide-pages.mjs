// The user guide as web pages for fledgetone.com: GUIDE.md split at its ## sections, one page each
// under /guide/<section>/, and an index at /guide/. scripts/build-site.mjs writes them at build time,
// so the site's guide is always the same text as the app's (src/components/guide/, which reads the
// same file). The Markdown here is the same small set the app's renderer handles: ## and ###
// headings, paragraphs, - and 1. lists, | tables |, > tips, **bold**, *italic*, `code` and
// [links](https://...) (or to the site's own pages, /learn/..., or to a heading of the guide's, #resampling). Pure, so it's unit tested (scripts/guidePages.test.mjs).

/** URL-safe id for a heading, e.g. "Timecode & frame rates" -> "timecode-frame-rates" (as the app's). */
export function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The guide's ## sections (anything before the first ## is the # title, and is dropped). */
export function splitSections(markdown) {
  const sections = [];
  for (const line of markdown.split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) sections.push({ id: slug(h2[1]), title: h2[1].trim(), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(line);
  }
  return sections;
}

export const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** **bold**, *italic* and [links](https://...) in text that has no code spans (escaped first). */
function emphasis(text) {
  return escape(text).replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)|\*\*(\S(?:[^*]*\S)?)\*\*|\*(\S(?:[^*]*\S)?)\*/g,
    (_, label, href, bold, italic) =>
      label !== undefined ? href.startsWith('/') ? `<a href="${href}">${label}</a>` : `<a href="${href}" rel="noopener">${label}</a>` : bold !== undefined ? `<strong>${bold}</strong>` : `<em>${italic}</em>`,
  );
}

/** Inline markup: `code` first (nothing inside it is markup), then emphasis and links. */
export function inline(text) {
  return text
    .split(/(`[^`]+`)/)
    .map((part) => (part.startsWith('`') && part.endsWith('`') && part.length > 1 ? `<code>${escape(part.slice(1, -1))}</code>` : emphasis(part)))
    .join('');
}

/** A table row's cells, splitting on | except inside `code`. */
function cells(row) {
  const out = [];
  let cell = '';
  let inCode = false;
  for (const ch of row.trim().replace(/^\||\|$/g, '')) {
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      out.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/**
 * One section's body as HTML, and its ### headings (for the page's "On this page" list). Figures
 * ({ after, html }) go after the first block under the ### heading whose id is `after`, after the
 * section's opening block when `after` is null, or at the end for 'end'.
 */
export function renderSection(lines, figures = []) {
  const out = [];
  const headings = [];
  let i = 0;
  const LIST = /^\s*([-*]|\d+\.) /;
  const under = (key) => figures.filter((f) => f.after === key).map((f) => f.html);
  let pending = under(null);
  const block = (html) => { out.push(html); out.push(...pending); pending = []; };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const h3 = line.match(/^###\s+(.*)/);
    if (h3) {
      const id = slug(h3[1]);
      headings.push({ id, title: h3[1].trim() });
      out.push(...pending);
      out.push(`<h3 id="${id}"><a href="#${id}">${inline(h3[1].trim())}</a></h3>`);
      pending = under(id);
      i++;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const [head, , ...body] = rows; // the second row is the |---| divider
      block(
        `<div class="g-table"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      );
      continue;
    }

    if (LIST.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items = [];
      while (i < lines.length && LIST.test(lines[i])) {
        let item = lines[i++].replace(LIST, '');
        // Indented continuation lines belong to the item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !LIST.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      const tag = ordered ? 'ol' : 'ul';
      block(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (line.startsWith('>')) {
      const parts = [];
      while (i < lines.length && lines[i].startsWith('>')) parts.push(lines[i++].replace(/^>\s?/, ''));
      block(`<aside class="g-tip">${inline(parts.join(' '))}</aside>`);
      continue;
    }

    // Always take at least this line, so an odd line can't stall the loop
    const para = [lines[i++].trim()];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|\s*\||\s*([-*]|\d+\.) |>)/.test(lines[i])) para.push(lines[i++].trim());
    block(`<p>${inline(para.join(' '))}</p>`);
  }
  out.push(...pending, ...under('end'));
  return { html: out.join('\n'), headings };
}

/** Plain text of the section's first paragraph, cut to a length that suits a meta description. */
export function summary(lines, max = 155) {
  const start = lines.findIndex((l) => l.trim() && !/^(#{2,3}\s|\s*\||\s*([-*]|\d+\.) |>)/.test(l));
  // The whole paragraph: a paragraph in GUIDE.md can run over several lines
  const para = [];
  // (A paragraph ends at a blank line, or where a heading, table, list or quote starts, as renderSection reads it)
  for (let i = start; i >= 0 && i < lines.length && lines[i].trim() && (i === start || !/^(#{2,3}\s|\s*\||\s*([-*]|\d+\.) |>)/.test(lines[i])); i++) para.push(lines[i].trim());
  const first = para.join(' ');
  const text = first.replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*+/g, '').trim();
  if (text.length <= max) return text;
  // Cut to leave room for the ellipsis, dropping a word only if the cut lands inside it
  const cut = text.slice(0, max - 1);
  return `${/\s/.test(text[max - 1]) ? cut.trimEnd() : cut.replace(/\s+\S*$/, '')}…`;
}

/**
 * The guide's links to its own headings ([Resampling](#resampling), as the app follows them) made
 * into links to the page that has them: /guide/<section>/ for a ## heading, with #<heading> for a ###.
 */
export function linkAnchors(sections) {
  const where = new Map();
  for (const s of sections) where.set(s.id, `/guide/${s.id}/`);
  for (const s of sections)
    for (const line of s.body) {
      const h3 = line.match(/^###\s+(.*)/);
      if (h3 && !where.has(slug(h3[1]))) where.set(slug(h3[1]), `/guide/${s.id}/#${slug(h3[1])}`);
    }
  return sections.map((s) => ({ ...s, body: s.body.map((line) => line.replace(/\]\(#([a-z0-9-]+)\)/g, (m, id) => (where.has(id) ? `](${where.get(id)})` : m))) }));
}

/** Every page of the guide: [{ path, html }], with paths relative to the site root. figures(id) gives a section's figures. */
export function guidePages(markdown, page, figures = () => []) {
  const sections = linkAnchors(splitSections(markdown)).map((s) => ({ ...s, ...renderSection(s.body, figures(s.id)), summary: summary(s.body) }));
  const pages = sections.map((s, i) => ({
    path: `guide/${s.id}/index.html`,
    html: page.section({ section: s, sections, prev: sections[i - 1], next: sections[i + 1] }),
  }));
  pages.unshift({ path: 'guide/index.html', html: page.index({ sections }) });
  return pages;
}
