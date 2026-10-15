// The guide's web pages (scripts/guide-pages.mjs): GUIDE.md split into sections and rendered to HTML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { slug, splitSections, inline, renderSection, summary, guidePages } = await import('./guide-pages.mjs');

test('slugs match the in-app guide', () => {
  assert.equal(slug('Timecode and frame rates'), 'timecode-and-frame-rates');
  assert.equal(slug('Writing notes: the piano roll'), 'writing-notes-the-piano-roll');
});

test('sections split at ## and drop the title above the first', () => {
  const s = splitSections('# Title\nintro\n## One\na\n### Sub\nb\n## Two\nc');
  assert.deepEqual(s.map((x) => [x.id, x.body.filter(Boolean)]), [['one', ['a', '### Sub', 'b']], ['two', ['c']]]);
});

test('inline markup: code, bold, italic, links, and everything else escaped', () => {
  assert.equal(inline('**Save** then *open* `Ctrl+S`'), '<strong>Save</strong> then <em>open</em> <code>Ctrl+S</code>');
  assert.equal(inline('2 * 3 <b>'), '2 * 3 &lt;b&gt;');
  assert.equal(inline('`**not bold**`'), '<code>**not bold**</code>');
  assert.equal(inline('[Tone.js](https://tonejs.github.io)'), '<a href="https://tonejs.github.io" rel="noopener">Tone.js</a>');
  assert.equal(inline('[local](GUIDE.md)'), '[local](GUIDE.md)', 'only http(s) links become links');
});

test('blocks: headings, lists with continuation lines, tables with | in code, tips', () => {
  const { html, headings } = renderSection([
    '### The loop', 'Some *text*', 'carries on.', '',
    '- one', '  more of one', '- two', '',
    '1. first', '',
    '| Key | Does |', '|---|---|', '| `a|b` | x |', '',
    '> A tip',
  ]);
  assert.deepEqual(headings, [{ id: 'the-loop', title: 'The loop' }]);
  assert.match(html, /<h3 id="the-loop"><a href="#the-loop">The loop<\/a><\/h3>/);
  assert.match(html, /<p>Some <em>text<\/em> carries on\.<\/p>/);
  assert.match(html, /<ul><li>one more of one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><\/ol>/);
  assert.match(html, /<td><code>a\|b<\/code><\/td><td>x<\/td>/);
  assert.match(html, /<aside class="g-tip">A tip<\/aside>/);
});

test('a summary is the first paragraph as plain text, cut at a word', () => {
  assert.equal(summary(['', '### Skip', 'Press **Play** or `Space`.']), 'Press Play or Space.');
  assert.equal(summary(['word '.repeat(60)], 20), 'word word word word…');
});

test('the real guide makes an index and a page per section', () => {
  const md = readFileSync(new URL('../GUIDE.md', import.meta.url), 'utf8');
  const pages = guidePages(md, { index: ({ sections }) => String(sections.length), section: ({ section }) => section.title });
  const count = splitSections(md).length;
  assert.equal(pages.length, count + 1);
  assert.equal(pages[0].path, 'guide/index.html');
  assert.ok(pages.some((p) => p.path === 'guide/getting-started/index.html'));
  assert.equal(new Set(pages.map((p) => p.path)).size, pages.length, 'no two sections share a page');
});
