// Rendering and listening in a headless browser (tools/cli/src/browserRender.ts running the app's
// own renderer, dist-runtime/fledgetone-render.js): a small song of built-in synths (nothing to
// download; the browser is kept offline) rendered to WAV, at its length, rate and loudness, the same
// bytes every time; a listen's report; and a before-and-after with a suggestion that changes only
// the bars it touches, through the agent helper's tools. Skipped, saying why, without a browser,
// without the built renderer (npm run build:runtime) or without tools/cli's dependencies.
// Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
const SONG = join(ROOT, 'scripts/fixtures/render-song.fledgetone.json');

const work = mkdtempSync(join(tmpdir(), 'fledgetone-render-'));
// Downloads (none here: offline) and nothing else kept in a folder of the test's own
const env = { ...process.env, FLEDGETONE_CACHE: join(work, 'cache') };
test.after(() => rmSync(work, { recursive: true, force: true }));

async function why() {
  if (!existsSync(join(SDK, 'package.json'))) return 'tools/cli dependencies are not installed (run npm install in tools/cli)';
  if (!existsSync(join(ROOT, 'dist-runtime/fledgetone-render.js'))) return 'the renderer is not built (npm run build:runtime)';
  const { canRender } = await import('../tools/cli/src/browserRender.ts');
  const no = await canRender();
  return no ? `no browser to render with: ${no}` : false;
}
const skip = await why();
if (skip) console.log(`# renderBrowser: skipped: ${skip}`);

function cli(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--import', join(CLI, 'src/tsHook.mjs'), join(CLI, 'src/fledgetone.ts'), ...args], { cwd: work, env, timeout: 240_000, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    );
  });
}

/** A WAV file's format and length. */
function wavInfo(path) {
  const b = readFileSync(path);
  assert.equal(b.toString('latin1', 0, 4), 'RIFF');
  assert.equal(b.toString('latin1', 8, 12), 'WAVE');
  let at = 12;
  let fmt;
  let frames = 0;
  while (at + 8 <= b.length) {
    const id = b.toString('latin1', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(at + 8), channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
    if (id === 'data') frames = size / (fmt.channels * (fmt.bits / 8));
    at += 8 + size + (size % 2);
  }
  return { ...fmt, seconds: frames / fmt.rate };
}

test('render: the song as Export makes it, at its rate and length, the same bytes every time', { skip, timeout: 300_000 }, async () => {
  const r = await cli('render', SONG, '-o', 'song.wav', '--offline', '--json');
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.written, ['song.wav']);
  assert.deepEqual(out.mix.range, { fromBar: 1, toBar: 9 });
  const info = wavInfo(join(work, 'song.wav'));
  assert.deepEqual({ format: info.format, channels: info.channels, rate: info.rate, bits: info.bits }, { format: 1, channels: 2, rate: 44100, bits: 24 });
  // 8 bars at 120 BPM are 16 seconds, then the tails ring out (at most a few seconds more)
  assert.ok(info.seconds >= 16 && info.seconds < 24, `${info.seconds} s`);
  assert.ok(Math.abs(info.seconds - out.mix.seconds) < 0.01);
  const m = JSON.parse((await cli('measure', 'song.wav', '--json')).stdout);
  assert.ok(m.lufs > -24 && m.lufs < -12, `${m.lufs} LUFS`);
  assert.ok(Math.abs(m.lufs - out.mix.lufs) < 0.3, `the report (${out.mix.lufs}) says what the file measures (${m.lufs})`);
  assert.ok(m.truePeakDbtp <= -0.8, `true peak ${m.truePeakDbtp}`);
  // Again: the same file, byte for byte
  const again = await cli('render', SONG, '-o', 'again.wav', '--offline');
  assert.equal(again.code, 0, again.stderr);
  assert.ok(readFileSync(join(work, 'song.wav')).equals(readFileSync(join(work, 'again.wav'))), 'two renders of a song are the same file');
  // Never over a file unasked
  const over = await cli('render', SONG, '-o', 'song.wav', '--offline');
  assert.equal(over.code, 2);
  assert.match(over.stderr, /already exists/);
  // Other rates and depths, and a range
  const short = await cli('render', SONG, '-o', 'short.wav', '--offline', '--bars', '1-2', '--rate', '48000', '--bits', '16');
  assert.equal(short.code, 0, short.stderr);
  const s = wavInfo(join(work, 'short.wav'));
  assert.equal(s.rate, 48000);
  assert.equal(s.bits, 16);
  assert.ok(s.seconds >= 4 && s.seconds < 11, `${s.seconds} s`);
  for (const f of ['song.wav', 'again.wav', 'short.wav']) rmSync(join(work, f));
});

test('listen: the report an agent reads, bar by bar and track by track', { skip, timeout: 300_000 }, async () => {
  const r = await cli('listen', SONG, '--bars', '1-8', '--per-track', '--offline', '--json');
  assert.equal(r.code, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.deepEqual(rep.range, { fromBar: 1, toBar: 9 });
  assert.equal(rep.renderMode, 'playback');
  assert.ok(Math.abs(rep.seconds - 16) < 0.01, `${rep.seconds} s`);
  for (const k of ['lufs', 'shortTermMaxLufs', 'truePeakDbtp', 'crestDb']) assert.equal(typeof rep.mix[k], 'number', k);
  assert.ok(rep.mix.regions.length >= 5);
  assert.equal(typeof rep.mix.master.limiterMaxGrDb, 'number');
  assert.deepEqual(rep.bars.map((b) => b.bar), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(rep.bars.every((b) => typeof b.lufs === 'number'));
  assert.deepEqual(rep.tracks.map((t) => t.name).sort(), ['Bass', 'Drums', 'Keys']);
  assert.ok(rep.tracks.every((t) => typeof t.lufs === 'number' && t.lufs < rep.mix.lufs + 1));
  assert.ok(Array.isArray(rep.findings) && Array.isArray(rep.checks));
  // In plain words without --json
  const text = await cli('listen', SONG, '--bars', '1-2', '--offline');
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /^Bars 1 to 2, the song as it is: 0:04\.0\n  Loudness -\d+\.\d LUFS/);
});

test('before and after a suggestion, through the agent helper: only the bars it touches change; render_file writes inside --root', { skip, timeout: 300_000 }, async () => {
  const root = mkdtempSync(join(work, 'root-'));
  copyFileSync(SONG, join(root, 'song.fledgetone.json'));
  const { Client } = await import(pathToFileURL(join(SDK, 'dist/esm/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(join(SDK, 'dist/esm/client/stdio.js')).href);
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', join(CLI, 'src/tsHook.mjs'), join(CLI, 'src/fledgetone.ts'), 'mcp', '--port', '0', '--root', root, '--offline'], cwd: ROOT, env, stderr: 'pipe' });
  const client = new Client({ name: 'test agent', version: '1' });
  await client.connect(transport);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content.map((c) => c.text).join('');
    assert.ok(!r.isError, `${name}: ${text}`);
    return JSON.parse(text);
  };
  try {
    const song = await call('get_song', { file: 'song.fledgetone.json' });
    const keys = song.clips.find((c) => c.name === 'Chords');
    // Two high notes in bar 5 of the keys
    const ops = [{ op: 'add_notes', clipId: keys.id, notes: [{ pitch: 'A5', start: 4, length: 0.5, velocity: 0.9 }, { pitch: 'E5', start: 4.5, length: 0.25, velocity: 0.9 }] }];
    await call('suggest', { title: 'A high answer', explanation: 'Two notes in bar 5.', ops, file: 'song.fledgetone.json', out: 'answer.suggestion.json' });
    const ab = await call('listen', { file: 'song.fledgetone.json', fromBar: 1, toBar: 9, suggestion: 'answer.suggestion.json' });
    assert.equal(ab.before.heard, 'the song as it is');
    assert.equal(ab.after.heard, 'the song with the suggestion');
    const bars = ab.difference.bars;
    assert.deepEqual(bars.map((b) => b.bar), [1, 2, 3, 4, 5, 6, 7, 8]);
    // (before it: the same, or different only by rounding far under anything heard)
    for (const b of bars.slice(0, 4)) assert.ok(!b.changed && (b.differenceDb === null || b.differenceDb < -120), `bar ${b.bar} is untouched: ${JSON.stringify(b)}`);
    assert.ok(bars[4].changed && bars[4].differenceDb > -60, `bar 5 changes: ${JSON.stringify(bars[4])}`);
    assert.equal(ab.difference.changedBars.fromBar, 5);
    assert.ok(ab.difference.changedBars.toBar <= 8, `the change dies away soon after: ${JSON.stringify(ab.difference.changedBars)}`);
    assert.match(ab.difference.summary[0], /^Bars? 5/);

    const done = await call('render_file', { file: 'song.fledgetone.json', out: 'bars-1-2.wav', fromBar: 1, toBar: 3, bitDepth: 16 });
    assert.equal(done.written, 'bars-1-2.wav');
    assert.equal(typeof done.lufs, 'number');
    const w = wavInfo(join(root, 'bars-1-2.wav'));
    assert.equal(w.bits, 16);
    assert.ok(Math.abs(w.seconds - done.seconds) < 0.01);
  } finally {
    await client.close();
  }
});
