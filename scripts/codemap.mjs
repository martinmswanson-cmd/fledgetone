// Write docs/CODEMAP.md: every source file under src/ with what it is, taken from the summary
// comment at the top of the file (the first paragraph of it). `npm run codemap` rewrites it, and
// scripts/codemap.test.mjs fails when a file has no summary or the map is out of date.
//
// A file's summary is the comment block on its first line; failing that, the first comment
// before any code other than imports. Keep its first paragraph to a few sentences: it is what
// someone new reads to find their way.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CODEMAP = join(ROOT, 'docs', 'CODEMAP.md');

/** What each folder is for, shown above its files. Folders not listed here get no introduction. */
const FOLDERS = {
  src: 'The app shell: the entry point, the layout, and the problem-report and credits data.',
  'src/audio':
    'The sound engine. Everything that makes or measures sound: the master chain, the live graph, scheduling notes, audio clips and automation on the Transport, the offline export, the user\'s sound library, recording, metering, and the game, video and plugin exports. Files with no Web Audio in them (maths only) are unit-tested under Node.',
  'src/audio/effects': 'Effects: the per-track channel strip and its inserts, the shared reverb and delay, the master inserts, and the parameter writer that keeps automation and controls from fighting.',
  'src/audio/presets': 'The instruments\' sound design: one factory per instrument (or family), each building its nodes in whatever audio context is current, so the export can rebuild the same sound offline.',
  'src/audio/samplers': 'Recorded instruments: downloading, decoding and playing multi-sampled recordings, with tone shaping, guitar amps and expressive playing.',
  'src/audio/sfx': 'The sound effects maker\'s synth (plain maths, no Web Audio).',
  'src/components': 'The React UI outside the timeline: the header, the instrument menu, popovers, and shared controls.',
  'src/components/dock': 'The dock under the timeline (Mixer, Launcher, EQ, Instruments, Game, Video and Sound FX tabs) and its dialogs.',
  'src/components/guide': 'The in-app user guide, rendered from GUIDE.md.',
  'src/components/inspector': 'The Track Inspector side panel: instrument panels, insert effects, the EQ editors and the Master tab.',
  'src/components/menu': 'The menu bar.',
  'src/components/sfx': 'The Sound FX tab.',
  'src/components/timeline': 'The arrangement timeline and everything docked to it: tracks, clips, ruler, markers, automation, the piano roll and audio clip editor, and the dialogs opened from them.',
  'src/components/tour': 'The first-visit tour and the tutorials\' overlay.',
  'src/components/video': 'Scoring to a reference video: its lane, its preview window and the Video tab.',
  'src/gameKit': 'The adaptive music players shipped in the game kit (web, Unity, Godot), copied into its .zip as they are, and the web player\'s types.',
  'src/runtime': 'bos-player.js: plays a saved project in a web game, built separately (vite.runtime.config.ts).',
  'src/search': 'The search palette (Ctrl+K) and instrument search.',
  'src/store':
    'The app\'s state and the music logic. timelineStore.ts holds the song and the actions that change it (with undo); timelineTypes.ts defines the data; project.ts saves and loads it. Most other files are pure functions on that data (markers, tempo, takes, notation, smart tools, starters...), unit-tested under Node.',
  'src/support': 'Reporting a problem.',
  'src/tour': 'The tour and tutorials\' content and progress.',
};

// TypeScript, plus the game kit's players for the web, Unity and Godot
const isSource = (f) => /\.(ts|tsx|js|cs|gd)$/.test(f) && !/\.test\./.test(f);

function filesUnder(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? filesUnder(p) : isSource(name) ? [p] : [];
    });
}

/** The comment text of the block starting at `lines[i]` (a /* block, or a run of // or # lines). */
function commentAt(lines, i) {
  const line = lines[i] ?? '';
  if (/^\s*\/\*/.test(line)) {
    const end = lines.findIndex((l, k) => k >= i && l.includes('*/'));
    return lines
      .slice(i, end + 1)
      .map((l) => l.replace(/^\s*\/\*\*?|\*\/\s*$|^\s*\*( |$)/g, ''))
      .join('\n');
  }
  const run = /^\s*\/\//.test(line) ? /^\s*\/\/ ?/ : /^\s*# ?/.test(line) ? /^\s*# ?/ : null;
  if (run) {
    const out = [];
    for (let k = i; k < lines.length && run.test(lines[k]); k++) out.push(lines[k].replace(run, ''));
    return out.join('\n');
  }
  return null;
}

/** A file's summary: its first paragraph, as one line (null if it has none). */
export function summaryOf(source) {
  const lines = source.split('\n');
  let text = commentAt(lines, 0);
  if (text === null) {
    // The first comment before any code but imports
    let i = 0;
    let inImport = false;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (inImport) {
        if (/from\s+['"]|^\s*\}?\s*;?\s*$/.test(l) && /['"];?\s*$/.test(l)) inImport = false;
        continue;
      }
      if (/^\s*$/.test(l)) continue;
      if (/^import\b/.test(l)) {
        inImport = !/['"];?\s*$/.test(l);
        continue;
      }
      break;
    }
    text = commentAt(lines, i);
  }
  if (!text) return null;
  const first = text.trim().split(/\n\s*\n/)[0];
  return first.replace(/\s+/g, ' ').trim() || null;
}

/** The files with no summary comment (paths from the repository root). */
export function filesWithoutSummary() {
  return filesUnder(join(ROOT, 'src'))
    .filter((f) => !summaryOf(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f));
}

/** The map's Markdown. */
export function generatedCodemap() {
  const files = filesUnder(join(ROOT, 'src'));
  const byFolder = new Map();
  for (const f of files) {
    const rel = relative(ROOT, f);
    const folder = dirname(rel);
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push({ rel, name: rel.slice(folder.length + 1), summary: summaryOf(readFileSync(f, 'utf8')) });
  }
  const folders = [...byFolder.keys()].sort();
  const out = [
    '# Code map',
    '',
    '<!-- Generated by `npm run codemap` from the summary comment at the top of each file. Edit those, not this. -->',
    '',
    `Every source file under \`src/\`, by folder (${files.length} files). Each line is the summary at the top of the file; open the file for the detail. For how the parts work together, read [ARCHITECTURE.md](ARCHITECTURE.md) first.`,
    '',
    '## Folders',
    '',
    ...folders.map((f) => `- [\`${f}/\`](#${f.replace(/[^a-z0-9]+/gi, '').toLowerCase()}) (${byFolder.get(f).length})`),
    '',
  ];
  for (const folder of folders) {
    out.push(`## ${folder}/`, '');
    if (FOLDERS[folder]) out.push(FOLDERS[folder], '');
    out.push('| File | What it is |', '|---|---|');
    for (const { rel, name, summary } of byFolder.get(folder)) {
      out.push(`| [\`${name}\`](../${rel}) | ${(summary ?? '(no summary)').replace(/\|/g, '\\|')} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(CODEMAP, generatedCodemap());
  const missing = filesWithoutSummary();
  console.log(`docs/CODEMAP.md written${missing.length ? `; no summary in: ${missing.join(', ')}` : ''}`);
}
