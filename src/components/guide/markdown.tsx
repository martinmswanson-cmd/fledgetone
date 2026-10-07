import React from 'react';

/**
 * A small Markdown renderer for the in-app guide (GUIDE.md): ## / ### headings, paragraphs,
 * - and 1. lists, | tables |, > tips, **bold**, *italic*, `code` and [links](https://...). It builds React elements
 * (no raw HTML), which is all the guide needs without pulling in a Markdown library.
 */

export interface GuideSection {
  id: string;
  title: string;
  body: string[];
}

/** URL-safe id for a heading, e.g. "Timecode & frame rates" -> "timecode-frame-rates". */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Split the guide into its ## sections (anything before the first ## is dropped: the # title). */
export function splitSections(markdown: string): GuideSection[] {
  const sections: GuideSection[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) sections.push({ id: slug(h2[1]), title: h2[1].trim(), body: [] });
    else sections[sections.length - 1]?.body.push(line);
  }
  return sections;
}

/**
 * [links](https://...), **bold** and *italic* in text with no code spans. The emphasis markers must
 * hug the words, so "2 * 3" stays plain. Links only go to http(s) addresses, in a new tab.
 */
function emphasis(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*(\S(?:[^*]*\S)?)\*\*|\*(\S(?:[^*]*\S)?)\*/g)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) {
      out.push(
        <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200">
          {m[1]}
        </a>
      );
    } else {
      out.push(m[3] !== undefined ? <strong key={k} className="text-forge-text font-semibold">{m[3]}</strong> : <em key={k}>{m[4]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Inline markup: `code` first (nothing inside it is markup), then **bold** and *italic*. */
function inline(text: string, key: string): React.ReactNode[] {
  return text.split(/(`[^`]+`)/).flatMap((part, i) =>
    part.startsWith('`') && part.endsWith('`') && part.length > 1
      ? [
          <code key={`${key}-c${i}`} className="px-1 py-px rounded bg-black/50 border border-forge-border text-cyan-200 font-mono text-[0.92em]">
            {part.slice(1, -1)}
          </code>,
        ]
      : emphasis(part, `${key}-t${i}`)
  );
}

/** A table row's cells, splitting on | except inside `code`. */
function cells(row: string): string[] {
  const out: string[] = [];
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

/** Render the body lines of one section. */
export function renderBlocks(lines: string[], keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let n = 0;
  const key = () => `${keyPrefix}-${n++}`;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const h3 = line.match(/^###\s+(.*)/);
    if (h3) {
      out.push(
        <h4 key={key()} id={slug(h3[1])} className="mt-5 mb-1.5 text-sm font-semibold text-forge-text">
          {inline(h3[1], `${keyPrefix}-h${i}`)}
        </h4>
      );
      i++;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const [head, , ...body] = rows; // second row is the |---| divider
      const k = key();
      out.push(
        <div key={k} className="my-3 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr>
                {cells(head).map((c, j) => (
                  <th key={j} className="border-b border-forge-borderLight py-1.5 pr-3 font-semibold text-forge-text">
                    {inline(c, `${k}-th${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="align-top">
                  {cells(r).map((c, j) => (
                    <td key={j} className="border-b border-forge-border py-1.5 pr-3">
                      {inline(c, `${k}-${ri}-${j}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^\s*([-*]|\d+\.) /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*]|\d+\.) /, '');
        // Indented continuation lines belong to the item
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.) /.test(lines[i])) item += ` ${lines[i++].trim()}`;
        items.push(item);
      }
      const k = key();
      const List = ordered ? 'ol' : 'ul';
      out.push(
        <List key={k} className={`my-2 pl-5 space-y-1 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-forge-muted`}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${k}-${j}`)}</li>
          ))}
        </List>
      );
      continue;
    }

    if (line.startsWith('>')) {
      const parts: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) parts.push(lines[i++].replace(/^>\s?/, ''));
      const k = key();
      out.push(
        <div key={k} className="my-3 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-cyan-100/90">
          {inline(parts.join(' '), k)}
        </div>
      );
      continue;
    }

    // Always take at least this line, so an odd line (e.g. a stray "## ") can't stall the loop
    const para: string[] = [lines[i++].trim()];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|\s*\||\s*([-*]|\d+\.) |>)/.test(lines[i])) para.push(lines[i++].trim());
    const k = key();
    out.push(
      <p key={k} className="my-2 leading-relaxed">
        {inline(para.join(' '), k)}
      </p>
    );
  }
  return out;
}
