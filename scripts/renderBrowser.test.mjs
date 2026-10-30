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
import { execFile, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// The same song with a built-in plugin (Airwindows ADClip7) on its drums
const PLUGIN_SONG = join(ROOT, 'scripts/fixtures/render-plugin-song.fledgetone.json');

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

test('built-in plugins play from this copy (offline); plugins from other sites are refused in plain words', { skip, timeout: 300_000 }, async () => {
  const withPlugin = await cli('render', PLUGIN_SONG, '-o', 'plugin.wav', '--offline', '--bars', '1-2', '--json');
  assert.equal(withPlugin.code, 0, withPlugin.stderr);
  const plain = await cli('render', SONG, '-o', 'plain.wav', '--offline', '--bars', '1-2');
  assert.equal(plain.code, 0, plain.stderr);
  assert.ok(!readFileSync(join(work, 'plugin.wav')).equals(readFileSync(join(work, 'plain.wav'))), 'the plugin is heard');
  rmSync(join(work, 'plugin.wav'));
  rmSync(join(work, 'plain.wav'));
  // A plugin from another site: not run, and the render says why and what to do
  const song = JSON.parse(readFileSync(SONG, 'utf8'));
  song.tracks.find((t) => t.name === 'Keys').pluginFx = [{ id: 'fx-web', url: 'https://plugins.example/reverb/index.js', name: 'Web Reverb' }];
  writeFileSync(join(work, 'web-plugin.fledgetone.json'), JSON.stringify(song));
  const r = await cli('render', 'web-plugin.fledgetone.json', '-o', 'web.wav', '--offline');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /plugins from other sites.*"Keys" plays Web Reverb \(from https:\/\/plugins\.example\/reverb\/index\.js\).*Export it from the studio instead/s);
  assert.ok(!existsSync(join(work, 'web.wav')));
  // Bypassed, it plays no part: the song renders
  song.tracks.find((t) => t.name === 'Keys').pluginFx[0].bypass = true;
  writeFileSync(join(work, 'web-plugin-off.fledgetone.json'), JSON.stringify(song));
  const off = await cli('listen', 'web-plugin-off.fledgetone.json', '--bars', '1', '--offline');
  assert.equal(off.code, 0, off.stderr);
  const l = await cli('listen', 'web-plugin.fledgetone.json', '--bars', '1', '--offline');
  assert.equal(l.code, 2);
  assert.match(l.stderr, /plugins from other sites/);
});

/** The fixture song with only its keys, playing `notes` from bar 1 for 16 bars (and the clip's `extra`). */
function keysSong(name, notes, extra = {}) {
  const song = JSON.parse(readFileSync(SONG, 'utf8'));
  const keys = song.tracks.find((t) => t.name === 'Keys');
  song.tracks = [keys];
  song.clips = [{ ...song.clips.find((c) => c.trackId === keys.id), startBar: 1, lengthBars: 16, notes, ...extra }];
  writeFileSync(join(work, name), JSON.stringify(song));
  return name;
}

test('listen hears what the song plays: not a note a trim hides, and a note the sustain pedal holds; under 3 seconds there is no loudest 3 seconds', { skip, timeout: 300_000 }, async () => {
  const listenTo = async (file, bars) => {
    const r = await cli('listen', file, '--bars', bars, '--offline', '--json');
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  // A long note starting a quarter bar before its clip (a left trim): the song never plays it
  const hidden = keysSong('hidden.fledgetone.json', [{ id: 'n1', note: 'D3', startOffset: -0.25, duration: '16m', velocity: 0.8 }, { id: 'n2', note: 'A3', startOffset: 0, duration: '1m', velocity: 0.8 }]);
  const h = await listenTo(hidden, '11-12');
  assert.equal(h.mix.lufs, null, `bars 11 to 12 are silent, as the song plays them: ${JSON.stringify(h.mix)}`);
  // A quarter note held by the pedal until 3 bars in: it sounds in bars 2 and 3
  const held = keysSong('sustain.fledgetone.json', [{ id: 'n1', note: 'D3', startOffset: 0, duration: '4n', velocity: 0.8 }, { id: 'n2', note: 'A3', startOffset: 8, duration: '4n', velocity: 0.8 }], { expression: { sustain: [{ at: 0, value: 1 }, { at: 3, value: 1 }, { at: 3.01, value: 0 }] } });
  const whole = await listenTo(held, '1-4');
  const s = await listenTo(held, '2-3');
  assert.equal(typeof s.mix.lufs, 'number', `the held note is heard: ${JSON.stringify(s.mix)}`);
  assert.ok(Math.abs(s.bars[0].lufs - whole.bars[1].lufs) < 1, `bar 2 alone (${s.bars[0].lufs}) as in the song (${whole.bars[1].lufs})`);
  // Bars 2 to 3 are 4 seconds: the loudest 3 seconds is a whole window; bar 2 alone (2 s) has none
  assert.equal(typeof s.mix.shortTermMaxLufs, 'number');
  const one = await listenTo(held, '2');
  assert.equal(one.mix.shortTermMaxLufs, null);
  const text = await cli('listen', held, '--bars', '2', '--offline');
  assert.match(text.stdout, /too short for the loudest 3 seconds: under 3 seconds long/);
  for (const f of [hidden, held]) rmSync(join(work, f));
});

const listenJson = async (file, bars) => {
  const r = await cli('listen', file, '--bars', bars, '--offline', '--json');
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("a measured groove feel follows the song's meter (no studio to say what it is)", { skip, timeout: 300_000 }, async () => {
  const song = JSON.parse(readFileSync(SONG, 'utf8'));
  for (const c of song.clips) c.groove = { swing: 0, grid: 16, feel: { id: 'houseShuffle', amount: 1 } };
  writeFileSync(join(work, 'feel44.fledgetone.json'), JSON.stringify(song));
  writeFileSync(join(work, 'feel34.fledgetone.json'), JSON.stringify({ ...song, meter: { num: 3, den: 4 } }));
  for (const m of ['44', '34']) {
    const r = await cli('render', `feel${m}.fledgetone.json`, '-o', `feel${m}.wav`, '--bars', '1-3', '--offline');
    assert.equal(r.code, 0, r.stderr);
  }
  // The feel's steps count from each 3/4 measure's start, not from each 4/4 bar's
  assert.ok(!readFileSync(join(work, 'feel34.wav')).equals(readFileSync(join(work, 'feel44.wav'))), 'the 3/4 song plays its feel in 3/4');
  for (const f of ['feel44.fledgetone.json', 'feel34.fledgetone.json', 'feel44.wav', 'feel34.wav']) rmSync(join(work, f));
});

test("a controller lane's held value reaches the plugin in a range that starts after the clip does", { skip, timeout: 300_000 }, async () => {
  // Fledge Synth's organ (its mod wheel opens it up above 5 kHz), a chord a bar for 8 bars, CC 1 held at 1 from the start
  const notes = [];
  for (let b = 0; b < 8; b++) for (const [i, n] of ['C4', 'E4', 'G4'].entries()) notes.push({ id: `n${b}${i}`, note: n, startOffset: b, duration: '2n', velocity: 0.7 });
  const song = {
    format: 'fledgetone-project',
    version: 1,
    modWheel: 'dynamics',
    name: 'Organ wheel',
    bpm: 120,
    swing: 0,
    loopRegion: { inBar: 1, outBar: 9, enabled: false },
    tracks: [{ id: 't1', name: 'Organ', instrumentKey: 'plugin', volume: -12, pan: 0, reverbSend: 0, delaySend: 0, plugin: { id: 'p1', url: 'builtin:fledge/Fledge Synth', name: 'Fledge Synth', state: { builtin: 1, program: 23 } } }],
    clips: [{ id: 'c1', trackId: 't1', name: 'Organ', startBar: 1, lengthBars: 8, notes, expression: { cc1: [{ at: 0, value: 1 }] } }],
  };
  writeFileSync(join(work, 'wheel.fledgetone.json'), JSON.stringify(song));
  writeFileSync(join(work, 'nowheel.fledgetone.json'), JSON.stringify({ ...song, clips: [{ ...song.clips[0], expression: undefined }] }));
  const presence = (rep) => rep.mix.regions.find((r) => /^presence/.test(r.name)).db;
  const [first, later, none] = [await listenJson('wheel.fledgetone.json', '1-4'), await listenJson('wheel.fledgetone.json', '5-8'), await listenJson('nowheel.fledgetone.json', '5-8')];
  assert.ok(presence(first) - presence(none) > 3, `the wheel is heard: ${presence(first)} against ${presence(none)} dB without it`);
  assert.ok(Math.abs(presence(later) - presence(first)) < 0.5, `bars 5 to 8 (${presence(later)} dB) as bars 1 to 4 (${presence(first)} dB)`);
  for (const f of ['wheel.fledgetone.json', 'nowheel.fledgetone.json']) rmSync(join(work, f));
});

test("a listen reports what the master did in the bars asked for, not in the run-in before them", { skip, timeout: 300_000 }, async () => {
  // Drums and bass in bars 1 to 4 pushed 15 dB into the limiter; a quiet note held from bar 1 to 9 makes a listen of bars 5 to 8 run in from bar 1
  const song = JSON.parse(readFileSync(SONG, 'utf8'));
  song.master = { ...song.master, level: 15 };
  const keys = song.tracks.find((t) => t.name === 'Keys');
  song.clips = song.clips.map((c) => (c.trackId === keys.id ? { ...c, notes: [{ id: 'held', note: 'D3', startOffset: 0, duration: '8m', velocity: 0.05 }] } : { ...c, notes: c.notes.filter((n) => n.startOffset < 4) }));
  writeFileSync(join(work, 'limited.fledgetone.json'), JSON.stringify(song));
  const loud = await listenJson('limited.fledgetone.json', '1-4');
  assert.ok(loud.mix.master.limiterMaxGrDb > 3, `bars 1 to 4 are limited: ${loud.mix.master.limiterMaxGrDb} dB`);
  const quiet = await listenJson('limited.fledgetone.json', '5-8');
  assert.ok(quiet.mix.master.limiterMaxGrDb < 0.5, `bars 5 to 8 aren't: ${quiet.mix.master.limiterMaxGrDb} dB`);
  assert.ok(!quiet.findings.some((f) => /limiter/i.test(f)), JSON.stringify(quiet.findings));
  rmSync(join(work, 'limited.fledgetone.json'));
});

test("a listen from where a pad's chord has just ended hears its release, as the song does", { skip, timeout: 300_000 }, async () => {
  // The Ambient starter's warm pad: two-bar chords, one ending exactly on bar 3 and ringing on
  const made = await cli('new', '--starter', 'ambient', '-o', 'ambient.fledgetone.json');
  assert.equal(made.code, 0, made.stderr);
  const song = JSON.parse(readFileSync(join(work, 'ambient.fledgetone.json'), 'utf8'));
  const pad = song.tracks[0];
  song.tracks = [pad];
  song.clips = song.clips.filter((c) => c.trackId === pad.id);
  writeFileSync(join(work, 'pad.fledgetone.json'), JSON.stringify(song));
  const whole = await listenJson('pad.fledgetone.json', '1-4');
  const from3 = await listenJson('pad.fledgetone.json', '3-4');
  assert.ok(Math.abs(from3.bars[0].lufs - whole.bars[2].lufs) < 0.3, `bar 3 alone (${from3.bars[0].lufs}) as in the song (${whole.bars[2].lufs})`);
  for (const f of ['ambient.fledgetone.json', 'pad.fledgetone.json']) rmSync(join(work, f));
});

test('stems: never matched to a loudness target (and the summary says so); an MP3 stem\'s length includes the ring-out', { skip, timeout: 300_000 }, async () => {
  const r = await cli('render', SONG, '--stems', 'stems-wav', '--target', 'club', '--bars', '1-2', '--offline', '--json');
  assert.equal(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.stems.target, null);
  assert.ok(out.stems.notes.some((n) => /Stems aren't matched to a loudness target/.test(n)), JSON.stringify(out.stems.notes));
  const text = await cli('render', SONG, '--stems', 'stems-text', '--target', 'club', '--bars', '1-2', '--offline');
  assert.ok(!/, matched to -?\d/.test(text.stdout), text.stdout);
  const wav = wavInfo(join(work, out.stems.files[0].name));
  assert.ok(Math.abs(wav.seconds - out.stems.seconds) < 0.01, `${wav.seconds} against ${out.stems.seconds}`);
  assert.ok(wav.seconds > 4.05, 'bars 1 to 2 ring out past their 4 seconds');
  const mp3 = JSON.parse((await cli('render', SONG, '--stems', 'stems-mp3', '--format', 'mp3', '--bars', '1-2', '--offline', '--json')).stdout);
  assert.ok(Math.abs(mp3.stems.seconds - wav.seconds) < 0.01, `the MP3 stems say ${mp3.stems.seconds} s, the frames rendered are ${wav.seconds} s`);
  for (const d of ['stems-wav', 'stems-text', 'stems-mp3']) rmSync(join(work, d), { recursive: true, force: true });
});

test('Ctrl+C twice: the browser and its folder are cleaned up all the same', { skip, timeout: 120_000 }, async () => {
  const tmpRoot = join(work, 'tmp');
  mkdirSync(tmpRoot);
  const child = spawn(process.execPath, ['--import', join(CLI, 'src/tsHook.mjs'), join(CLI, 'src/fledgetone.ts'), 'render', SONG, '-o', 'stopped.wav', '--offline', '--verbose'], { cwd: work, env: { ...env, TMPDIR: tmpRoot }, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => (err += d));
  const deadline = Date.now() + 60_000;
  // Once the page is up (it logs), stop it twice in a row
  while (!/\[page /.test(err) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  child.kill('SIGINT');
  await new Promise((r) => setTimeout(r, 30));
  child.kill('SIGINT');
  const code = await new Promise((r) => child.on('exit', (c, sig) => r(c ?? sig)));
  assert.equal(code, 2, err.slice(-400));
  assert.match(err, /Stopped\./);
  assert.deepEqual(readdirSync(tmpRoot).filter((n) => n.startsWith('fledgetone-browser-')), [], 'no browser folder left');
  assert.ok(!existsSync(join(work, 'stopped.wav')));
});
