// The command line's render and listen, without a browser (tools/cli/src/renderCommands.ts and the
// agent helper's render_file and listen with a file): their arguments checked before anything is
// rendered, the shape of a before-and-after (src/agent/listenReport.ts), and the helper writing
// renders only inside --root, never through a link or over a file unasked. The renders themselves
// are in renderBrowser.test.mjs. Needs tools/cli's dependencies for the parts that run the helper.
// Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
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
const br = await import('../tools/cli/src/browserRender.ts');

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
    [[SONG], { o: join(tmp, 'x.wav'), bars: '0' }, /songs start at bar 1/],
    [[SONG], { o: join(tmp, 'x.wav'), bars: '0-4' }, /songs start at bar 1/],
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
  // One bar: "sounds"
  const one = compareListens(before, after, [null, null, -30, null]);
  assert.match(one.difference.summary[0], /^Bar 3 sounds different/);
  assert.match(c.difference.summary[0], /^Bars 3 to 4 sound different \(what changed is up to -30\.0 dBFS\); the other bars sound the same\.$/);
  assert.match(c.difference.summary.join(' '), /0\.5 LU louder/);
  assert.ok(c.before === before && c.after === after, 'both reports are kept whole');
  // (scan r8) the change over the same moments of both, when it's known: each one's integrated
  // loudness alone can read the after louder though it's quieter (the gate leaves its quiet parts out)
  const paired = compareListens(before, after, [null, null, -30, null], -2.04, new Map([['t', -8]]));
  assert.equal(paired.difference.mix.lufs, -2);
  assert.match(paired.difference.summary.join(' '), /Overall it is 2\.0 LU quieter \(-15\.5 against -16 LUFS measured alone; the change is over the same moments of both\)\./);
  const withTracks = (r, lufs) => ({ ...r, tracks: [{ id: 't', name: 'Clav', lufs, truePeakDbtp: -3, crestDb: 10, regions: [] }] });
  const tr = compareListens(withTracks(before, -20), withTracks(after, -17), [null, null, null, null], null, new Map([['t', -8]]));
  assert.equal(tr.difference.tracks[0].lufs, -8);
  assert.equal(tr.difference.mix.lufs, 0.5, 'not known: after minus before');
  assert.match(readFileSync(new URL('../src/audio/auditionPlayer.ts', import.meta.url), 'utf8'), /const paired = pairedLoudnessDiff\(ma\.blocks, mb\.blocks\);/);
  // A tempo change can't be lined up sample by sample: every bar counts as changed
  assert.ok(compareListens(before, after, ['tempo', 'tempo', 'tempo', 'tempo']).difference.bars.every((b) => b.changed && b.differenceDb === null));
});

test("a before-and-after's sound comparison: on the difference when given, its first five differences' words at the summary's end", () => {
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
  const diffs = [null, HEARD_DIFFERENCE_DB - 10, -30, -60];
  const plain = compareListens(before, after, diffs);
  assert.ok(!('sound' in plain.difference) && !('pictures' in plain.difference));
  const difference = (measure, words) => ({ group: 'tone', measure, a: 1, b: 2, change: 1, size: 1, words });
  const comparison = { levelDb: 0.5, differences: [difference('centre', 'It is brighter.'), difference('tilt', 'It tilts up.')], spectrum: { freqs: [], changeDb: [] }, skipped: [], notes: [] };
  const pictures = [{ name: 'difference', kind: 'difference', shows: 's', fromSeconds: 0, toSeconds: 8, width: 1500, height: 700, id: 'f1', bytes: 10 }];
  const heard = compareListens(before, after, diffs, undefined, undefined, { comparison, pictures });
  assert.equal(heard.difference.sound, comparison);
  assert.deepEqual(heard.difference.pictures, pictures);
  assert.deepEqual(heard.difference.summary, [...plain.difference.summary, 'It is brighter.', 'It tilts up.']);
  // At most five differences' words
  const many = { ...comparison, differences: [...Array(7)].map((_, i) => difference(`m${i}`, `Difference ${i}.`)) };
  assert.deepEqual(compareListens(before, after, diffs, undefined, undefined, { comparison: many, pictures: [] }).difference.summary.slice(plain.difference.summary.length), ['Difference 0.', 'Difference 1.', 'Difference 2.', 'Difference 3.', 'Difference 4.']);
  assert.ok(!('pictures' in compareListens(before, after, diffs, undefined, undefined, { comparison, pictures: [] }).difference), 'no pictures: no pictures key');
});

test('hearing an audio file: at most MAX_HEAR_SECONDS at a time, said in minutes and seconds', async () => {
  const { MAX_HEAR_SECONDS } = await import('../src/audio/hearing/hearingOf.ts');
  const { tooLongToHear } = await import('../src/agent/listenReport.ts');
  assert.equal(tooLongToHear(MAX_HEAR_SECONDS), null);
  assert.equal(tooLongToHear(2), null);
  assert.equal(tooLongToHear(1000), 'At most 15 minutes at a time (this is 16:40); name a stretch.');
  assert.equal(tooLongToHear(MAX_HEAR_SECONDS + 4.6), 'At most 15 minutes at a time (this is 15:05); name a stretch.');
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

test('downloads: a proxy from the environment, and only whole files of the right kind kept', () => {
  assert.equal(br.proxyFromEnv({}), null);
  assert.deepEqual(br.proxyFromEnv({ HTTPS_PROXY: 'http://127.0.0.1:3128', NO_PROXY: 'example.org, .corp' }), { server: 'http://127.0.0.1:3128', bypass: '127.0.0.1,localhost,example.org,.corp' });
  assert.deepEqual(br.proxyFromEnv({ https_proxy: 'http://me:p%40ss@proxy.lan:8080' }), { server: 'http://proxy.lan:8080', bypass: '127.0.0.1,localhost', username: 'me', password: 'p@ss' });
  assert.equal(br.proxyFromEnv({ HTTPS_PROXY: 'http://127.0.0.1:3128', NO_PROXY: '*' }), null, 'NO_PROXY=* means no proxy');
  assert.equal(br.downloadProblem('fledgetone-plugins/surge/patches/Lead.fxp', 'application/octet-stream', Buffer.from('CcnK')), null, 'presets are kept');
  assert.match(br.downloadProblem('x/Lead.fxp', 'text/html', Buffer.from('<html>')), /came as text\/html/);
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(100)]);
  assert.equal(br.downloadProblem('a/C4_0_0.mp3@abc', 'audio/mpeg', mp3), null);
  assert.equal(br.downloadProblem('https://fledgetone.com/app/fledgetone-samples/x/C4.mp3?v=1', 'audio/mpeg', mp3), null);
  assert.match(br.downloadProblem('a/C4.mp3', 'text/html; charset=utf-8', mp3), /came as text\/html/);
  assert.match(br.downloadProblem('a/C4.mp3', 'audio/mpeg', Buffer.from('<html>blocked</html>')), /aren't what its name says/);
  assert.match(br.downloadProblem('a/C4.mp3', 'audio/mpeg', Buffer.alloc(0)), /empty/);
  assert.match(br.downloadProblem('a/big.wasm', 'application/wasm', Buffer.alloc(br.MAX_DOWNLOAD_BYTES + 1)), /more than any/);
  assert.equal(br.downloadProblem('p/airwindows.wasm', 'application/wasm', Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])), null);
  assert.match(br.downloadProblem('p/index.html', 'text/html', Buffer.from('x')), /not a kind of file/);
});

test('leftover browser folders: old ones whose run ended are deleted, others kept', () => {
  const base = mkdtempSync(join(tmpdir(), 'fledgetone-stale-'));
  try {
    const old = Date.now() / 1000 - 3 * 3600;
    const make = (name, pid, age) => {
      const dir = join(base, name);
      mkdirSync(dir);
      if (pid !== undefined) writeFileSync(join(dir, 'owner.pid'), String(pid));
      if (age) utimesSync(dir, age, age);
      return dir;
    };
    const ended = make('fledgetone-browser-ended', 2 ** 22 + 12345, old);
    const noOwner = make('fledgetone-browser-noowner', undefined, old);
    const running = make('fledgetone-browser-running', process.ppid, old);
    const fresh = make('fledgetone-browser-fresh', 2 ** 22 + 12346, 0);
    const other = make('something-else', undefined, old);
    assert.equal(br.removeStaleBrowserFolders(base), 2);
    assert.ok(!existsSync(ended) && !existsSync(noOwner), 'old, ended: deleted');
    assert.ok(existsSync(running) && existsSync(fresh) && existsSync(other), 'running, new, or not ours: kept');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a listen's places: the agent's bar and quarter beat in every meter, and the ruler's measure and beat where it counts otherwise", async () => {
  const { songPlaces } = await import('../src/agent/listenReport.ts');
  const { barToSeconds, measureAt } = await import('../src/audio/tempoMap.ts');
  const tempo = { bpm: 120, points: [] };
  const meter = (num, den, points = []) => ({ base: { num, den }, points });
  /** The place of song position `pos` in a listen of [from, to), checked against measureAt. */
  const check = (map, from, to, pos) => {
    const place = songPlaces(tempo, map, from, to)(barToSeconds(pos, tempo) - barToSeconds(from, tempo));
    const bar = Math.floor(pos + 1e-9);
    assert.equal(place.bar, bar, `${pos}`);
    assert.equal(place.beat, 1 + Math.floor((pos - bar) * 4 + 1e-9), `${pos}`);
    assert.ok(place.beat >= 1 && place.beat <= 4);
    const m = measureAt(pos, map);
    const ruler = { measure: m.measure, beat: 1 + Math.floor((pos - m.start) * m.meter.den + 1e-6) };
    return { place, ruler };
  };
  // 4/4: no ruler, the numbers are the ruler's
  for (const pos of [1, 1.25, 2.5, 4.75, 8.99]) {
    const { place, ruler } = check(meter(4, 4), 1, 9, pos);
    assert.ok(!('ruler' in place), JSON.stringify(place));
    assert.deepEqual([place.bar, place.beat], [ruler.measure, ruler.beat]);
  }
  // 3/4 and 6/8: the agent's bars, and the ruler's measures beside them
  for (const [num, den] of [[3, 4], [6, 8]]) {
    for (let pos = 1; pos < 9; pos += 0.125) {
      const { place, ruler } = check(meter(num, den), 1, 9, pos);
      assert.deepEqual(place.ruler, ruler, `${num}/${den} at ${pos}`);
    }
  }
  // (the review's examples: bar 2, beat 3 is measure 3, beat 1 in 3/4; an eighth later in 6/8 it is measure 3, beat 2)
  assert.deepEqual(check(meter(3, 4), 1, 9, 2.5).place, { seconds: 3, bar: 2, beat: 3, ruler: { measure: 3, beat: 1 } });
  assert.deepEqual(check(meter(6, 8), 1, 9, 2.625).place, { seconds: 3.25, bar: 2, beat: 3, ruler: { measure: 3, beat: 2 } });
  // 4/4, then 3/4 from bar 5: no ruler before; after, the ruler's measures
  const changing = meter(4, 4, [{ id: 'm', bar: 5, num: 3, den: 4 }]);
  for (let pos = 1; pos < 5; pos += 0.25) assert.ok(!('ruler' in check(changing, 1, 12, pos).place), `${pos}`);
  for (let pos = 5; pos < 12; pos += 0.25) {
    const { place, ruler } = check(changing, 1, 12, pos);
    assert.deepEqual(place.ruler, ruler, `${pos}`);
  }
  // A range that starts part-way through a bar: a moment just after bar 1.5 is bar 1, beat 3
  assert.deepEqual(songPlaces(tempo, meter(4, 4), 1.5, 3)(0.1), { seconds: 0.1, bar: 1, beat: 3 });
  // The range's very end is in its last bar
  assert.deepEqual(songPlaces(tempo, meter(4, 4), 1, 3)(4), { seconds: 4, bar: 2, beat: 4 });
});

test("a WAV's header: its rate and length, so a file over the limit is refused before it is decoded", async () => {
  const { wavHeader, tooLongToHear } = await import('../src/agent/listenReport.ts');
  const header = (rate, channels, dataBytes) => {
    const b = Buffer.alloc(44);
    b.write('RIFF', 0, 'latin1');
    b.writeUInt32LE(Math.min(0xffffffff, 36 + dataBytes), 4);
    b.write('WAVEfmt ', 8, 'latin1');
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(channels, 22);
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * channels * 2, 28);
    b.writeUInt16LE(channels * 2, 32);
    b.writeUInt16LE(16, 34);
    b.write('data', 36, 'latin1');
    b.writeUInt32LE(dataBytes, 40);
    return new Uint8Array(b);
  };
  assert.deepEqual(wavHeader(header(44100, 2, 44100 * 4 * 2)), { sampleRate: 44100, seconds: 2 });
  // 16 minutes, said by the header alone (no samples here at all)
  const long = wavHeader(header(48000, 2, 48000 * 4 * 960));
  assert.equal(long.seconds, 960);
  assert.match(tooLongToHear(long.seconds), /this is 16:00/);
  assert.equal(wavHeader(header(48000, 1, 0xffffffff)).seconds, null, 'a stream: no length');
  assert.equal(wavHeader(new TextEncoder().encode('These are not sounds.')), null);
});
