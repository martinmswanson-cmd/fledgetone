// Fold the Vite build into one self-contained HTML file (dist-single/index.html) that can be
// uploaded anywhere on its own: scripts, styles and the favicon are inlined. Run after `vite build`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'dist-single');
const read = (p) => readFileSync(join(dist, p.replace(/^\.?\//, '')), 'utf8');

let html = read('index.html');

// <script type="module" crossorigin src="/assets/index-xxx.js"></script>
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  // A literal "</script" inside the bundle would end the inline tag early
  const js = read(src).replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});

// <link rel="stylesheet" crossorigin href="/assets/index-xxx.css">
html = html.replace(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+)"[^>]*>/g, (_, href) => `<style>${read(href)}</style>`);

// Favicon as a data URI so it doesn't depend on where the file is hosted
html = html.replace(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)"\s*\/?>/, (_, href) => {
  const svg = read(href);
  return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" />`;
});

// The bundled libraries' licence notices travel with the file (see thirdPartyLicenses in
// vite.config.ts). "--" can't appear inside an HTML comment.
const licenses = read('third-party-licenses.txt').replace(/--/g, '- -');
html = html.replace(/<html([^>]*)>/, (tag) => `${tag}\n<!--\n${licenses}-->`);

const leftovers = html.match(/(src|href)="\/(assets|favicon)[^"]*"/g);
if (leftovers) throw new Error(`Unresolved local references: ${leftovers.join(', ')}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
console.log(`dist-single/index.html written (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
