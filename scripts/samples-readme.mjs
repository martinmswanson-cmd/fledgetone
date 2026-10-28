// public/fledgetone-samples/README.txt, the notice that goes with the hosted recordings (they're
// served to other sites too), generated from src/credits.ts so it lists every set with who made it
// and its licence. `npm run samples-readme` rewrites it; scripts/samplesReadme.test.mjs fails if
// it's out of date.
import { register } from 'node:module';
import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);
const { SAMPLE_CREDITS } = await import('../src/credits.ts');

const DIR = fileURLToPath(new URL('../public/fledgetone-samples/', import.meta.url));
export const README = `${DIR}README.txt`;
const HOSTED = 'fledgetone-samples/';

/** Markdown as plain text: a link's words with its address after them */
const plain = (md) => md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\*\*?([^*]+)\*\*?/g, '$1');

/** Words wrapped to `width`, each line after the first indented by `indent`. */
function wrap(text, indent, width = 100) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = indent + word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

/** The README as it should be, from the credits and the folders hosted. */
export function samplesReadme(folders = readdirSync(DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
  const out = [
    'Recordings for Fledgetone\'s "(Real)" instruments, converted to MP3.',
    'How they were made: scripts/real-samples/README.md in the Fledgetone source.',
    'Generated from src/credits.ts (npm run samples-readme): every folder here, who made it and its licence.',
  ];
  const listed = new Set();
  for (const credit of SAMPLE_CREDITS) {
    const sets = folders.filter((f) => credit.prefixes.some((p) => p.startsWith(HOSTED) && `${HOSTED}${f}/`.startsWith(p))).sort();
    if (!sets.length) continue;
    sets.forEach((s) => listed.add(s));
    out.push('', wrap(`${sets.join(', ')}:`, '  '), `  ${wrap(plain(credit.samples), '  ', 98)}`, `  Licence: ${wrap(plain(credit.licence), '    ', 89)}`);
  }
  const missing = folders.filter((f) => !listed.has(f));
  if (missing.length) throw new Error(`no credit for ${missing.join(', ')} (add it to src/credits.ts)`);
  return out.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(README, samplesReadme());
  console.log(`wrote ${README}`);
}
