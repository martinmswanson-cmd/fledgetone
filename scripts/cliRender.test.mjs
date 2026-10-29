// The command line's render and listen, without a browser (tools/cli/src/renderCommands.ts and the
// agent helper's render_file and listen with a file): their arguments checked before anything is
// rendered, the shape of a before-and-after (src/agent/listenReport.ts), and the helper writing
// renders only inside --root, never through a link or over a file unasked. The renders themselves
// are in renderBrowser.test.mjs. Needs tools/cli's dependencies for the parts that run the helper.
// Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'tools/cli');
const SDK = join(CLI, 'node_modules/@modelcontextprotocol/sdk');
const haveCli = existsSync(join(SDK, 'package.json'));
const skip = haveCli ? false : 'tools/cli dependencies are not installed (run npm install in tools/cli)';
const SONG = join(ROOT, 'scripts/fixtures/render-song.fledgetone.json');

const rc = await import('../tools/cli/src/renderCommands.ts');
const { compareListens, HEARD_DIFFERENCE_DB } = await import('../src/agent/listenReport.ts');

const tmp = mkdtempSync(join(tmpdir(), 'fledgetone-render-args-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

function cli(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--import', join(CLI, 'src/tsHook.mjs'), join(CLI, 'src/fledgetone.ts'), ...args], { cwd: ROOT, timeout: 60_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    );
  });
}

test('render: its arguments, checked before anything renders', () => {
  const plan = rc.renderPlan([SONG], { o: join(tmp, 'out.wav'), bars: '9-16', rate: '48000', bits: '32f' });
  assert.deepEqual({ ...plan, song: undefined }, { song: undefined, out: { path: join(tmp, 'out.wav'), format: 'wav' }, fromBar: 9, toBar: 17, sampleRate: 48000, bitDepth: 32, overwrite: false });
  assert.equal(rc.renderPlan([SONG], { o: join(tmp, 'a.mp3') }).out.format, 'mp3');
  assert.equal(rc.renderPlan([SONG], { o: join(tmp, 'a.wav') }).bitDepth, 24, 'the export’s default depth');
  assert.equal(rc.renderPlan([SONG], { o: join(tmp, 'a.wav'), target: 'none' }).target, false);
  assert.equal(rc.renderPlan([SONG], { o: join(tmp, 'a.wav'), target: 'club' }).target, 'club');
  assert.deepEqual(rc.renderPlan([SONG], { stems: join(tmp, 'stems'), format: 'mp3' }).stems, { dir: join(tmp, 'stems'), format: 'mp3' });
  const bad = [
    [[SONG], {}, /missing the file to write/],
    [[], { o: 'x.wav' }, /missing the song file/],
    [[SONG], { o: join(tmp, 'x.flac') }, /give a \.wav or \.mp3 file/],
    [[SONG], { o: join(tmp, 'x.mp3'), rate: '96000' }, /MP3 stops at 48000 Hz/],
    [[SONG], { o: join(tmp, 'x.wav'), rate: '22050' }, /--rate takes/],
    [[SONG], { o: join(tmp, 'x.wav'), bits: '8' }, /--bits takes 16, 24 or 32f/],
    [[SONG], { o: join(tmp, 'x.mp3'), bits: '16' }, /--bits is for WAV/],
    [[SONG], { o: join(tmp, 'x.wav'), format: 'mp3' }, /--format says mp3/],
    [[SONG], { o: join(tmp, 'x.wav'), bars: '9-5' }, /ends before it starts/],
    [[SONG], { o: SONG }, /give a \.wav or \.mp3 file|is the song itself/],
  ];
  for (const [args, flags, re] of bad) assert.throws(() => rc.renderPlan(args, flags), re, JSON.stringify(flags));
  writeFileSync(join(tmp, 'there.wav'), 'x');
  assert.throws(() => rc.renderPlan([SONG], { o: join(tmp, 'there.wav') }), /already exists: give another file, or --overwrite/);
  assert.equal(rc.renderPlan([SONG], { o: join(tmp, 'there.wav'), overwrite: true }).overwrite, true);
  writeFileSync(join(tmp, 'afile'), 'x');
  assert.throws(() => rc.renderPlan([SONG], { stems: join(tmp, 'afile') }), /isn't a folder/);
});

test('listen: its arguments, and the ops it hears with', async () => {
  assert.deepEqual(rc.listenPlan([SONG], { bars: '5', 'per-track': true }), { song: SONG, fromBar: 5, toBar: 6, perTrack: true, force: false });
  assert.throws(() => rc.listenPlan([SONG], { suggestion: 'a.json', ops: 'b.json' }), /not both/);
  assert.throws(() => rc.listenPlan([SONG, 'other.json'], {}), /a suggestion goes with --suggestion/);
  const song = { songId: 'render-test-song', tracks: [], clips: [] };
  const ops = [{ op: 'set_tempo', bpm: 100 }];
  const heard = rc.opsToHear(song, { ops: 'ops.json' }, () => ({ opsVersion: 1, ops }));
  assert.deepEqual(heard.ops, ops);
  assert.match(heard.idBase, /^sg-/);
  assert.throws(() => rc.opsToHear(song, { ops: 'ops.json' }, () => [{ op: 'frobnicate' }]), /the ops can't be read/);
  const other = { format: 'fledgetone-suggestion', version: 1, songId: 'another-song', touchedHashes: {}, title: 't', explanation: '', opsVersion: 1, ops };
  assert.throws(() => rc.opsToHear(song, { suggestion: 's.json' }, () => other), /made for another song/);
  assert.equal(rc.opsToHear(song, { suggestion: 's.json', force: true }, () => other).title, 't');
});

test('a before-and-after: which bars changed, and the difference in plain words', () => {
  const report = (lufs, bars) => ({
    range: { fromBar: 1, toBar: 5 },
    seconds: 8,
    heard: 'x',
    renderMode: 'playback',
    mix: { lufs, shortTermMaxLufs: lufs + 2, truePeakDbtp: -1, crestDb: 12, regions: [{ name: 'bass', db: -3 }], master: { limiterMaxGrDb: 1, clipperMaxDb: null } },
    bars: bars.map((l, i) => ({ bar: i + 1, lufs: l })),
    findings: [],
  });
  const before = report(-16, [-16, -16, -16, -16]);
  const after = report(-15.5, [-16, -16, -14, -16]);
  const same = compareListens(before, before, [null, null, null, null]);
  assert.equal(same.difference.changedBars, null);
  assert.match(same.difference.summary[0], /sounds the same/);
  const c = compareListens(before, after, [null, HEARD_DIFFERENCE_DB - 10, -30, -60]);
  assert.deepEqual(c.difference.changedBars, { fromBar: 3, toBar: 5 });
  assert.deepEqual(c.difference.bars.map((b) => b.changed), [false, false, true, true]);
  assert.equal(c.difference.bars[2].lufsChange, 2);
  assert.equal(c.difference.mix.lufs, 0.5);
  assert.match(c.difference.summary[0], /^Bars 3 to 4 sound different \(what changed is up to -30\.0 dBFS\); the other bars sound the same\.$/);
  assert.match(c.difference.summary.join(' '), /0\.5 LU louder/);
  assert.ok(c.before === before && c.after === after, 'both reports are kept whole');
  // A tempo change can't be lined up sample by sample: every bar counts as changed
  assert.ok(compareListens(before, after, ['tempo', 'tempo', 'tempo', 'tempo']).difference.bars.every((b) => b.changed && b.differenceDb === null));
});

test('render and listen on the command line: mistakes are exit 2, in plain words, before any browser starts', { skip }, async () => {
  const r = await cli('render', SONG);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /missing the file to write/);
  const l = await cli('listen');
  assert.equal(l.code, 2);
  assert.match(l.stderr, /missing the song file/);
  const help = await cli('--help');
  for (const c of ['render', 'listen', 'studio']) assert.match(help.stdout, new RegExp(`^  ${c} `, 'm'), c);
  const studio = await cli('studio', '--app', tmp);
  assert.equal(studio.code, 2);
  assert.match(studio.stderr, /isn't a built app/);
});

test('render_file and listen with a file: only inside --root, never through a link, never over a file unasked', { skip, timeout: 60_000 }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'fledgetone-render-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'fledgetone-render-outside-'));
  copyFileSync(SONG, join(work, 'song.fledgetone.json'));
  writeFileSync(join(work, 'old.wav'), 'x');
  symlinkSync(join(outside, 'planted.wav'), join(work, 'planted.wav'));
  const { Client } = await import(pathToFileURL(join(SDK, 'dist/esm/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(join(SDK, 'dist/esm/client/stdio.js')).href);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', join(CLI, 'src/tsHook.mjs'), join(CLI, 'src/fledgetone.ts'), 'mcp', '--port', '0', '--root', work],
    cwd: ROOT,
    stderr: 'pipe',
    // (no browser is ever reached here: each call is refused first)
    env: { ...process.env, FLEDGETONE_BROWSER: '/nonexistent/browser' },
  });
  const client = new Client({ name: 'test agent', version: '1' });
  await client.connect(transport);
  const text = (r) => r.content.map((c) => c.text).join('');
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'render_file'), 'a render_file tool');
    const refused = async (name, args, re) => {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(r.isError, `${name} ${JSON.stringify(args)} should be refused`);
      assert.match(text(r), re);
    };
    await refused('render_file', { file: 'song.fledgetone.json', out: '../out.wav' }, /outside the folder/);
    await refused('render_file', { file: 'song.fledgetone.json', out: join(outside, 'out.wav') }, /outside the folder/);
    await refused('render_file', { file: 'song.fledgetone.json', out: 'out.txt' }, /only \.wav, \.mp3 files/);
    await refused('render_file', { file: 'song.fledgetone.json', out: 'out.json' }, /only \.wav, \.mp3 files/);
    await refused('render_file', { file: 'song.fledgetone.json', out: 'planted.wav' }, /is a link/);
    await refused('render_file', { file: 'song.fledgetone.json', out: 'old.wav' }, /exists: choose another name, or pass overwrite/);
    await refused('render_file', { file: 'song.fledgetone.json', out: 'a.wav', format: 'mp3' }, /is a \.wav file but format says mp3/);
    await refused('render_file', { file: '../elsewhere.fledgetone.json', out: 'a.wav' }, /outside the folder/);
    await refused('render_file', { file: 'song.fledgetone.json', out: 'a.wav', fromBar: 3 }, /both fromBar and toBar/);
    await refused('listen', { file: 'song.fledgetone.json', fromBar: 1, toBar: 80 }, /At most 64 bars/);
    await refused('listen', { file: 'song.fledgetone.json', fromBar: 1, toBar: 5, suggestionId: 'x' }, /give "suggestion"/);
    await refused('listen', { file: 'song.fledgetone.json', fromBar: 1, toBar: 5, suggestion: '../s.json' }, /outside the folder/);
    await refused('listen', { fromBar: 1, toBar: 5, perTrack: true }, /for listening to a file/);
    // Without a browser, a plain message (and nothing left running)
    await refused('listen', { file: 'song.fledgetone.json', fromBar: 1, toBar: 5 }, /No browser to render with|playwright-core|isn't built yet/);
    assert.ok(!existsSync(join(outside, 'planted.wav')) && !existsSync(join(work, 'a.wav')), 'nothing was written');
  } finally {
    await client.close();
    rmSync(work, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
