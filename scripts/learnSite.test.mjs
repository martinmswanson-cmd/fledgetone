// The Learn section's builder (scripts/learn-site.mjs): lesson headers, step grids, shots and
// examples put into the page, and every lesson in learn/ building (each {{shot:...}} it names is
// in its shots file). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessons, parseLesson, renderGrid, renderLesson } from './learn-site.mjs';

const HEAD = '---\ntitle: T\nsummary: S\nlevel: Beginner\ntime: 5 minutes\n---\n';

test('a lesson needs its header, with a known level', () => {
  const l = parseLesson(`${HEAD}Body`);
  assert.equal(l.title, 'T');
  assert.deepEqual(l.lines, ['Body']);
  assert.throws(() => parseLesson('No header'), /header/);
  assert.throws(() => parseLesson(HEAD.replace('Beginner', 'Expert')), /level/);
  assert.throws(() => parseLesson(HEAD.replace('time: 5 minutes\n', '')), /time/);
});

test('a step grid lights its hits, accents brighter, beats marked', () => {
  const html = renderGrid(['Kick  x...|x...|x...|x...', 'Snare  ....|X...|....|X...']);
  assert.equal((html.match(/class="on"/g) ?? []).length + (html.match(/class="on beat"/g) ?? []).length, 4);
  assert.equal((html.match(/on acc/g) ?? []).length, 2);
  assert.match(html, /aria-label="Steps: Kick: 1, 5, 9, 13; Snare: 5, 13"/);
  assert.throws(() => renderGrid(['nonsense']), /grid row/);
});

test('shots, examples and grids go where the lesson puts them', () => {
  const shots = [{ file: 'a', alt: 'Alt', caption: 'Cap' }];
  const r = renderLesson(['### Step', 'Text.', '{{shot:a}}', '```grid', 'Hat  x.x.', '```', '{{example:ex}}'], {
    shots,
    sizes: { a: [1600, 800] },
    links: { ex: { url: 'https://fledgetone.com/app/#s=abc' } },
  });
  assert.deepEqual(r.headings.map((h) => h.id), ['step']);
  assert.ok(r.html.indexOf('<p>Text.</p>') < r.html.indexOf('/learn/img/a.webp'));
  assert.match(r.html, /l-grid/);
  assert.match(r.html, /href="https:\/\/fledgetone.com\/app\/#s=abc"/);
  // A shot not taken yet, or an example not made yet, is left out rather than broken
  assert.equal(renderLesson(['{{shot:a}}', '{{example:ex}}'], { shots }).html, '');
  assert.throws(() => renderLesson(['{{shot:missing}}'], { shots }), /no shot "missing"/);
});

test('every lesson in learn/ builds, in order, with a unique address', async () => {
  const all = await lessons();
  assert.ok(all.length > 0);
  assert.deepEqual(all.map((l) => l.n), all.map((_, i) => i + 1));
  assert.equal(new Set(all.map((l) => l.slug)).size, all.length);
});

test("the lessons' links into the guide go to sections and headings it has", async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { splitSections, slug } = await import('./guide-pages.mjs');
  const sections = splitSections(readFileSync(new URL('../GUIDE.md', import.meta.url), 'utf8'));
  const ids = new Map(sections.map((s) => [s.id, new Set(s.body.filter((l) => /^###\s/.test(l)).map((l) => slug(l.replace(/^###\s+/, ''))))]));
  const dir = new URL('../learn/', import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md')))
    for (const [, section, heading] of readFileSync(new URL(f, dir), 'utf8').matchAll(/\]\(\/guide\/([a-z0-9-]+)\/(?:#([a-z0-9-]+))?\)/g)) {
      assert.ok(ids.has(section), `${f}: /guide/${section}/`);
      if (heading) assert.ok(ids.get(section).has(heading), `${f}: /guide/${section}/#${heading}`);
    }
});
