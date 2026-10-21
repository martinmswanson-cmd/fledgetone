// The Tools page (scripts/tools-site.mjs): its zip writer, its README pages, the page itself, the
// synth's description read from fledge.wasm, and the link to it in every page's footer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { crc32, fill, formatSize, HEADER, LICENCE, makeZip, markdownToHtml, notice, readSynth, toolsPage, TOOLS } from './tools-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The files in a zip, read back from its central directory. */
function unzip(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + packed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, size, name);
    assert.equal(crc32(data), crc, name);
    files[name] = { data, method, mode: zip.readUInt32LE(at + 38) >>> 16 };
    at += 46 + nameLen;
  }
  return files;
}

test('tools: CRC-32 is the zip one', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('tools: a zip reads back as the files that went in, compressed where that helps', () => {
  const text = 'la '.repeat(2000);
  const random = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 251));
  const zip = makeZip([
    { name: 'a/README.md', data: text },
    { name: 'a/x.bin', data: random },
    { name: 'a/build.sh', data: '#!/bin/sh\n', executable: true },
    { name: 'a/naïve.txt', data: 'é' },
  ]);
  const files = unzip(zip);
  assert.deepEqual(Object.keys(files), ['a/README.md', 'a/x.bin', 'a/build.sh', 'a/naïve.txt']);
  assert.equal(files['a/README.md'].data.toString(), text);
  assert.equal(files['a/README.md'].method, 8);
  assert.deepEqual(files['a/x.bin'].data, random);
  assert.equal(files['a/build.sh'].mode & 0o777, 0o755);
  assert.equal(files['a/naïve.txt'].data.toString(), 'é');
  // The same files make the same zip
  assert.deepEqual(makeZip([{ name: 'f', data: 'x' }], new Date(2026, 9, 21)), makeZip([{ name: 'f', data: 'x' }], new Date(2026, 9, 21)));
  assert.throws(() => makeZip([{ name: 'f', data: 'x' }, { name: 'f', data: 'y' }]), /twice/);
});

test('tools: sizes in words', () => {
  assert.equal(formatSize(840), '840 bytes');
  assert.equal(formatSize(44373), '44 KB');
  assert.equal(formatSize(1166165), '1.2 MB');
});

test('tools: every README has the header, the licence in plain words, and nothing left to fill', () => {
  for (const t of TOOLS) {
    const template = readFileSync(join(ROOT, 'tools', t.id, 'README.md'), 'utf8');
    assert.match(template, /\{\{HEADER\}\}/, t.id);
    assert.match(template, /\{\{LICENCE\}\}/, t.id);
  }
  assert.match(HEADER, /Part of Fledgetone \(https:\/\/fledgetone\.com\), © Martin Swanson, GPL-3\.0-or-later/);
  assert.match(HEADER, /github\.com\/martinmswanson-cmd\/fledgetone/);
  assert.match(LICENCE, /free to use, change and share/i);
  assert.match(LICENCE, /must release that whole program under the GPL/);
  assert.match(LICENCE, /source code/);
  assert.match(notice('X'), /GNU General Public License/);
  assert.equal(fill('a {{HEADER}} b {{X}}', { X: 'x' }), `a ${HEADER} b x`);
  assert.throws(() => fill('{{NOPE}}', {}), /NOPE/);
});

test('tools: a README as a page', () => {
  const md = '# Title\n\nSome `code` and **bold**, see https://fledgetone.com/guide/.\n\n## Use it\n\n```js\nconst a = 1 < 2;\n```\n\n| A | B |\n| --- | --- |\n| `x|y` | 2 |\n\n- one\n  more\n- two\n\n### Deeper\n\n1. first';
  const { title, html, headings } = markdownToHtml(md);
  assert.equal(title, 'Title');
  assert.deepEqual(headings, [{ id: 'use-it', title: 'Use it' }]);
  assert.match(html, /<code>code<\/code> and <strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/fledgetone\.com\/guide\/" rel="noopener">https:\/\/fledgetone\.com\/guide\/<\/a>\.<\/p>/);
  assert.match(html, /<pre class="code"><code>const a = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(html, /<td><code>x\|y<\/code><\/td><td>2<\/td>/);
  assert.match(html, /<ul><li>one more<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<h4 id="deeper">/);
  assert.match(html, /<ol><li>first<\/li><\/ol>/);
});

test('tools: the page has a card per tool with its download, size, README and licence', () => {
  const zips = Object.fromEntries(TOOLS.map((t, i) => [t.id, { file: `fledgetone-${t.id}.zip`, size: 1000 * (i + 2) }]));
  const page = toolsPage(TOOLS, zips);
  for (const [i, t] of TOOLS.entries()) {
    assert.match(page, new RegExp(`href="/tools/fledgetone-${t.id}\\.zip" download`));
    assert.match(page, new RegExp(`href="/tools/${t.id}/"`));
    assert.ok(page.includes(`<span>${formatSize(1000 * (i + 2))}</span>`));
  }
  assert.equal(page.split('<span>GPL-3.0-or-later</span>').length - 1, TOOLS.length);
  assert.match(page, /must release that whole program under the GPL/);
  assert.match(page, /href="\/tools\/LICENSE\.txt"/);
  assert.match(page, /<link rel="stylesheet" href="\/styles\.css" \/>/);
  assert.match(page, /<a href="\/tools\/">Tools<\/a>/);
});

test('tools: Fledge Synth\'s parameters and presets come from fledge.wasm, and it plays', () => {
  const s = readSynth(readFileSync(join(ROOT, 'public/fledgetone-plugins/fledge.wasm')));
  assert.ok(s.params.length >= 200);
  assert.equal(s.params[0].name, 'A on');
  assert.ok(s.params.some((p) => p.name === 'Cutoff' && /kHz|Hz/.test(p.text)));
  assert.ok(s.presets.includes('Bass/Wobble'));
  assert.ok(s.finite);
  assert.ok(s.peak > 0.001 && s.peak < 1, `peak ${s.peak}`);
});

test('tools: every page of the site links to the Tools page in its footer, and its zips download', async () => {
  for (const page of ['site/index.html', 'site/games/index.html', 'site/creators/index.html', 'site/scoring/index.html', 'site/404.html']) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    const footer = html.slice(html.indexOf('<footer'));
    assert.match(footer, /<a href="\/tools\/">Tools<\/a>/, page);
  }
  const { foot } = await import('./guide-site.mjs');
  assert.match(foot, /<a href="\/tools\/">Tools<\/a>/);
  const { siteHeaders } = await import('./site-headers.mjs');
  const out = siteHeaders('');
  assert.match(out, /\/tools\/\*\.zip\n {2}Content-Type: application\/zip\n {2}Content-Disposition: attachment/);
});
