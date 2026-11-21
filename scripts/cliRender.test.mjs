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

// (before any test is declared: a top-level await after them would let the folder's clean-up run early under a name filter)
async function whyNoBrowser() {
  if (skip) return skip;
  if (!existsSync(join(ROOT, 'dist-runtime/fledgetone-render.js'))) return 'the renderer is not built (npm run build:runtime)';
  const no = await br.canRender();
  return no ? `no browser to render with: ${no}` : false;
}
const browserSkip = await whyNoBrowser();
if (browserSkip) console.log(`# cliRender: the browser tests are skipped: ${browserSkip}`);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

test("a before-and-after's summary: the faults the two do not share, and each region once", () => {
  const report = (regions) => ({
    range: { fromBar: 1, toBar: 3 },
    seconds: 4,
    heard: 'x',
    renderMode: 'playback',
    mix: { lufs: -16, shortTermMaxLufs: -14, truePeakDbtp: -1, crestDb: 12, regions, master: { limiterMaxGrDb: 1, clipperMaxDb: null } },
    bars: [{ bar: 1, lufs: -16 }, { bar: 2, lufs: -16 }],
    findings: [],
  });
  const before = report([{ name: 'bass (60-200 Hz)', db: -3 }, { name: 'mids (500 Hz-2 kHz)', db: -10 }]);
  const after = report([{ name: 'bass (60-200 Hz)', db: -3.4 }, { name: 'mids (500 Hz-2 kHz)', db: -8.3 }]);
  const difference = (group, measure, words) => ({ group, measure, a: 1, b: 2, change: 1, size: 1, words });
  const comparison = {
    levelDb: 0,
    differences: [
      difference('tone', 'mids (500 Hz-2 kHz)', 'Mids (500 Hz-2 kHz): -8.3 dB against -10.0 dB (+1.7 dB).'),
      difference('tone', 'bass (60-200 Hz)', 'Bass (60-200 Hz): -3.4 dB against -1.9 dB (-1.5 dB).'),
      difference('tone', 'centre', 'Centre: 1.4 kHz against 1.2 kHz (+0.22 octaves).'),
      difference('stereo', 'width: mids (500 Hz-2 kHz)', 'Width: mids (500 Hz-2 kHz): -10.0 dB against -14.0 dB (+4.0 dB).'),
    ],
    faults: ['Clicks: 1 after (at bar 2, beat 3), none before.'],
    spectrum: { freqs: [], changeDb: [] },
    skipped: [],
    notes: [],
  };
  const summary = compareListens(before, after, [null, -30], undefined, undefined, { comparison, pictures: [] }).difference.summary;
  // the mids moved by more than 1 dB of the balance, so the balance says them, and the sound report does not say them again
  assert.equal(summary.filter((line) => /^mids \(500 Hz-2 kHz\)/i.test(line)).length, 1, summary.join('\n'));
  assert.ok(summary.includes('mids (500 Hz-2 kHz): +1.7 dB against the whole.'));
  // the bass moved by less than that of the balance: only the sound report's line gives it
  assert.equal(summary.filter((line) => /^bass /i.test(line)).length, 1);
  assert.ok(summary.includes('Bass (60-200 Hz): -3.4 dB against -1.9 dB (-1.5 dB).'));
  // a width of a region is another measure, and is kept; the faults come before the differences
  assert.ok(summary.includes('Width: mids (500 Hz-2 kHz): -10.0 dB against -14.0 dB (+4.0 dB).'));
  assert.ok(summary.indexOf('Clicks: 1 after (at bar 2, beat 3), none before.') > 0);
  assert.ok(summary.indexOf('Clicks: 1 after (at bar 2, beat 3), none before.') < summary.indexOf('Centre: 1.4 kHz against 1.2 kHz (+0.22 octaves).'));
});

test('a long range says which stretches its detail spectrograms cover, when they do not cover all of it', async () => {
  const { detailsLine, hearingLines } = await import('../tools/cli/src/hearingCommands.ts');
  const { detailRanges } = await import('../src/audio/hearing/hearingOf.ts');
  const pictures = (seconds, bars, prefix = '') => [
    { name: `${prefix}spectrogram`, kind: 'spectrogram', fromSeconds: 0, toSeconds: seconds, path: `p/${prefix}spectrogram.png`, shows: 's' },
    ...detailRanges(0, seconds, bars).map((d) => ({ name: `${prefix}${d.name}`, kind: 'spectrogram', fromSeconds: d.fromSeconds, toSeconds: d.toSeconds, path: `p/${prefix}${d.name}.png`, shows: 's' })),
    { name: `${prefix}level`, kind: 'level', fromSeconds: 0, toSeconds: seconds, path: `p/${prefix}level.png`, shows: 's' },
  ];
  // 15 minutes: 30 stretches of 30 seconds, of which twelve are drawn
  const long = detailsLine(pictures(900));
  assert.equal(long.length, 1);
  assert.match(long[0], /^The detail spectrograms cover 0:00 to 0:30, 1:30 to 2:00, .*, 14:30 to 15:00: 12 stretches, not all of it\. The overview covers it all; hear a stretch for the details of the rest\.$/);
  assert.doesNotMatch(long[0], /\b(good|bad|too|should)\b/i);
  // six minutes: every stretch is drawn, so nothing is added; nor for a short one with no details
  assert.deepEqual(detailsLine(pictures(360)), []);
  assert.deepEqual(detailsLine(pictures(20)), []);
  // a song of 128 bars: sixteen groups of 8 bars, twelve drawn, said in bars
  const bars = Array.from({ length: 128 }, (_, i) => ({ bar: 1 + i, start: i * 2, end: i * 2 + 2, beats: 4 }));
  assert.match(detailsLine(pictures(256, bars, 'after-'))[0], /^The detail spectrograms cover bars 1 to 8, bars 9 to 16, .*bars 121 to 128: 12 stretches, not all of it\./);
  // in the text output it follows the pictures
  const lines = hearingLines({ pictures: pictures(900) });
  assert.equal(lines.at(-1), `  ${long[0]}`);
  assert.equal(lines[0], 'Pictures:');
});

test("listen --per-track --sound in words: each track's words, indented under its line", () => {
  const sound = (words) => ({ words });
  const report = {
    range: { fromBar: 1, toBar: 3 },
    seconds: 4,
    heard: 'the song as it is',
    renderMode: 'playback',
    mix: { lufs: -16, shortTermMaxLufs: -14, truePeakDbtp: -1, crestDb: 12, regions: [{ name: 'bass', db: -3 }], master: { limiterMaxGrDb: 1, clipperMaxDb: null } },
    bars: [{ bar: 1, lufs: -16 }, { bar: 2, lufs: -16 }],
    tracks: [
      { id: 'track-1', name: 'Keys', lufs: -20, truePeakDbtp: -6, crestDb: 10, regions: [{ name: 'bass', db: -9 }], sound: sound(['Tonal (flatness 0.01).', 'Nearly mono (correlation 0.99).']) },
      { id: 'track-2', name: 'Drums', lufs: -18, truePeakDbtp: -3, crestDb: 14, regions: [], sound: sound(['Mostly hits (80% percussive).']) },
      { id: 'track-3', name: 'Muted', lufs: null, truePeakDbtp: null, crestDb: null, regions: [], sound: sound(['It is silent.']) },
      { id: 'track-4', name: 'Not heard', lufs: -30, truePeakDbtp: -20, crestDb: 9, regions: [] },
    ],
    findings: [],
  };
  const lines = rc.reportText(report);
  const at = (start) => lines.findIndex((l) => l.startsWith(start));
  assert.deepEqual(lines.slice(at('  "Keys"'), at('  "Keys"') + 3), ['  "Keys": -20.0 LUFS, peak -6.0 dBTP; bass -9.0', '      Tonal (flatness 0.01).', '      Nearly mono (correlation 0.99).']);
  assert.deepEqual(lines.slice(at('  "Drums"'), at('  "Drums"') + 2), ['  "Drums": -18.0 LUFS, peak -3.0 dBTP', '      Mostly hits (80% percussive).']);
  assert.equal(lines[at('  "Muted"') + 1], '      It is silent.');
  assert.equal(lines.at(-1), '  "Not heard": -30.0 LUFS, peak -20.0 dBTP', 'a track with no hearing has its line alone');
  // without the hearing, the lines are as they were
  const plain = rc.reportText({ ...report, tracks: report.tracks.map(({ sound: _s, ...t }) => t) });
  assert.equal(plain.filter((l) => l.startsWith('      ')).length, 0);
  assert.equal(plain.length, lines.length - 4);
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

// ---------- Hearing more on the command line: listen and measure with a browser ----------

const browserEnv = { ...process.env, FLEDGETONE_CACHE: join(tmp, 'cache') };

/** The command line, given the time a render takes. */
function slowCli(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--import', join(CLI, 'src/tsHook.mjs'), join(CLI, 'src/fledgetone.ts'), ...args], { cwd: tmp, env: browserEnv, timeout: 240_000, maxBuffer: 16 << 20 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    );
  });
}

test("listen's hearing options: --close as a bar and quarter beat, checked against the bars before any browser starts", { skip }, async () => {
  const plan = rc.listenPlan([SONG], { pictures: join(tmp, 'pics'), close: ['9.3', '2'], against: 'a.hearing.json' });
  assert.equal(plan.sound, true);
  assert.deepEqual(plan.closeBars, [{ bar: 9, beat: 3 }, { bar: 2, beat: 1 }]);
  assert.ok(!rc.listenPlan([SONG], {}).sound);
  assert.ok(!('closeBars' in rc.listenPlan([SONG], {})), 'a plan without the options is as it was');
  for (const close of ['9.5', '9.0', 'x', '-1', '1:30']) assert.throws(() => rc.listenPlan([SONG], { close: [close] }), /--close/, close);
  assert.throws(() => rc.listenPlan([SONG], { 'against-to': '3' }), /--against-to/);
  // A bar outside the range: before any browser starts
  const r = await cli('listen', SONG, '--close', '99', '--offline');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--close 99/);
  const before = await cli('listen', SONG, '--bars', '3-4', '--close', '2.1', '--offline');
  assert.equal(before.code, 2);
  assert.match(before.stderr, /--close 2\.1/);
});

test('listen with none of the hearing options prints what it did before, text and --json', { skip: browserSkip, timeout: 300_000 }, async () => {
  const text = await slowCli('listen', SONG, '--offline');
  assert.equal(text.code, 0, text.stderr);
  assert.equal(text.stdout, readFileSync(join(ROOT, 'scripts/fixtures/cli-listen-snapshot.txt'), 'utf8'));
  const json = await slowCli('listen', SONG, '--offline', '--json');
  assert.equal(json.code, 0, json.stderr);
  assert.equal(json.stdout, readFileSync(join(ROOT, 'scripts/fixtures/cli-listen-snapshot.json'), 'utf8'));
});

test('listen --sound --pictures --close --save: the sound, its pictures written by name, a close-up at a bar and beat, a saved hearing', { skip: browserSkip, timeout: 300_000 }, async (t) => {
  const pictures = join(tmp, 'listen-pictures');
  const saved = join(tmp, 'song.hearing.json');
  const started = Date.now();
  const r = await slowCli('listen', SONG, '--bars', '1-4', '--sound', '--pictures', pictures, '--close', '2.3', '--save', saved, '--offline', '--json');
  t.diagnostic(`listen --sound --pictures of bars 1 to 4: ${Date.now() - started} ms`);
  assert.equal(r.code, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(typeof rep.sound, 'object');
  const closeUp = join(pictures, 'closeup-bar-2-beat-3.png');
  assert.ok(readFileSync(closeUp).subarray(0, 8).equals(PNG_SIGNATURE));
  assert.ok(rep.pictures.some((p) => p.path === closeUp), rep.pictures.map((p) => p.path).join(', '));
  assert.ok(rep.pictures.every((p) => existsSync(p.path) && !('id' in p)));
  const hearing = JSON.parse(readFileSync(saved, 'utf8'));
  assert.equal(hearing.fledgetoneHearing, 1);
  assert.equal(hearing.of, 'render-song.fledgetone.json');
  assert.equal(hearing.range.fromBar, 1);
  assert.equal(hearing.range.toBar, 5);
  // In words: the report's lines, then the sound and the pictures, then the findings
  const words = await slowCli('listen', SONG, '--bars', '1-4', '--against', saved, '--pictures', pictures, '--offline');
  assert.equal(words.code, 0, words.stderr);
  assert.match(words.stdout, /Bar by bar \(LUFS\)[^\n]*\nSound:\n {2}\S[^]*\nAgainst song\.hearing\.json:\n {2}Read as the song against song\.hearing\.json\.[^]*\nPictures:\n {2}[^\n]*spectrogram\.png: [^]*\n\n(Findings:|Nothing to flag\.)/);
  // Track by track: each track's pictures by its own names
  const tracks = await slowCli('listen', SONG, '--bars', '1-2', '--per-track', '--pictures', join(tmp, 'track-pictures'), '--offline', '--json');
  assert.equal(tracks.code, 0, tracks.stderr);
  const each = JSON.parse(tracks.stdout).tracks;
  // (named for the track's id, which begins "track-" already: not "track-track-...")
  for (const track of each) {
    assert.match(track.id, /^track-/);
    assert.ok(existsSync(join(tmp, 'track-pictures', `${track.id}-spectrogram.png`)), track.id);
    assert.ok(!existsSync(join(tmp, 'track-pictures', `track-${track.id}-spectrogram.png`)), `no track-${track.id}`);
  }
  // --json leaves the per-second grids out, of the mix and of every track; the saved hearing keeps them
  assert.equal(r.stdout.includes('"along"'), false, 'no grids in the mix');
  assert.equal(tracks.stdout.includes('"along"'), false, 'no grids in any track');
  assert.ok(each.every((track) => track.sound && track.sound.words), 'each track is heard');
  assert.ok(tracks.stdout.length < 60_000, `listen --per-track --json of 2 bars is ${tracks.stdout.length} characters`);
  assert.ok(hearing.sound.along.mid.length >= 1, 'the saved hearing has its grids');
  // In words, each track's own words are under its line
  const trackWords = await slowCli('listen', SONG, '--bars', '1-2', '--per-track', '--sound', '--offline');
  assert.equal(trackWords.code, 0, trackWords.stderr);
  for (const track of each) {
    const said = new RegExp(`\\n {2}"${track.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}": [^\\n]*\\n {6}\\S`);
    assert.match(trackWords.stdout, said, `${track.name} has words under its line`);
    assert.ok(trackWords.stdout.includes(`      ${track.sound.words[0]}\n`), `${track.name}: ${track.sound.words[0]}`);
  }
});

test('listen --suggestion --sound: the sound difference and the difference picture; --against compares the after version', { skip: browserSkip, timeout: 300_000 }, async () => {
  const ops = join(tmp, 'louder-keys.json');
  writeFileSync(ops, JSON.stringify([{ op: 'set_track', trackId: 'track-fixture-1p', volumeDb: 6 }]));
  const pictures = join(tmp, 'compare-pictures');
  const r = await slowCli('listen', SONG, '--bars', '1-2', '--ops', ops, '--pictures', pictures, '--offline', '--json');
  assert.equal(r.code, 0, r.stderr);
  const ab = JSON.parse(r.stdout);
  assert.ok(ab.difference.sound.levelDb > 0);
  assert.ok(existsSync(join(pictures, 'difference.png')));
  assert.ok(ab.after.pictures.every((p) => p.path.startsWith(join(pictures, 'after-'))));
  const words = await slowCli('listen', SONG, '--bars', '1-2', '--ops', ops, '--sound', '--offline');
  assert.equal(words.code, 0, words.stderr);
  assert.match(words.stdout, /\nSound \(after\):\n {2}\S/);
  // Against another sound: the after version is read against it
  const tone = Buffer.alloc(44 + 48000 * 4);
  tone.write('RIFF', 0);
  tone.writeUInt32LE(36 + 48000 * 4, 4);
  tone.write('WAVEfmt ', 8);
  tone.writeUInt32LE(16, 16);
  tone.writeUInt16LE(1, 20);
  tone.writeUInt16LE(2, 22);
  tone.writeUInt32LE(48000, 24);
  tone.writeUInt32LE(48000 * 4, 28);
  tone.writeUInt16LE(4, 32);
  tone.writeUInt16LE(16, 34);
  tone.write('data', 36);
  tone.writeUInt32LE(48000 * 4, 40);
  for (let i = 0; i < 48000; i++) for (const c of [0, 1]) tone.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 48000)), 44 + i * 4 + c * 2);
  writeFileSync(join(tmp, 'tone.wav'), tone);
  const against = await slowCli('listen', SONG, '--bars', '1-2', '--ops', ops, '--against', join(tmp, 'tone.wav'), '--offline', '--json');
  assert.equal(against.code, 0, against.stderr);
  assert.match(JSON.parse(against.stdout).after.against.notes[0], /the song against tone\.wav/);
});

test('measure through the browser: an MP3 heard, a WAV it cannot read in Node, and a file that is not audio in one line', { skip: browserSkip, timeout: 300_000 }, async () => {
  const mp3 = join(tmp, 'song.mp3');
  assert.equal((await slowCli('render', SONG, '--bars', '1-2', '-o', mp3, '--offline')).code, 0);
  const r = await slowCli('measure', mp3, '--sound', '--pictures', join(tmp, 'mp3-pictures'), '--offline', '--json');
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.file, 'song.mp3');
  assert.equal(typeof m.sound, 'object');
  assert.ok(existsSync(join(tmp, 'mp3-pictures', 'spectrogram.png')));
  const text = await slowCli('measure', 'song.mp3', '--offline');
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /^song\.mp3: 0:0\d, 2 channels\nLoudness /);
  // An 8-bit WAV, which Node's reader leaves to the browser
  const frames = 48000;
  const eight = Buffer.alloc(44 + frames);
  eight.write('RIFF', 0);
  eight.writeUInt32LE(36 + frames, 4);
  eight.write('WAVEfmt ', 8);
  eight.writeUInt32LE(16, 16);
  eight.writeUInt16LE(1, 20);
  eight.writeUInt16LE(1, 22);
  eight.writeUInt32LE(48000, 24);
  eight.writeUInt32LE(48000, 28);
  eight.writeUInt16LE(1, 32);
  eight.writeUInt16LE(8, 34);
  eight.write('data', 36);
  eight.writeUInt32LE(frames, 40);
  for (let i = 0; i < frames; i++) eight[44 + i] = 128 + Math.round(60 * Math.sin((2 * Math.PI * 1000 * i) / 48000));
  writeFileSync(join(tmp, 'eight.wav'), eight);
  const e = await slowCli('measure', join(tmp, 'eight.wav'), '--sound', '--offline', '--json');
  assert.equal(e.code, 0, e.stderr);
  assert.ok(Math.abs(JSON.parse(e.stdout).sound.tone.centreHz - 1000) < 50);
  // Not audio at all
  writeFileSync(join(tmp, 'x.mp3'), 'These are not sounds.\n');
  const bad = await slowCli('measure', join(tmp, 'x.mp3'), '--offline');
  assert.notEqual(bad.code, 0);
  assert.equal(bad.stderr.trim(), "fledgetone: x.mp3 can't be read as audio.");
});

test('listen --close: the message says what was typed; the bars are checked before the sound to read against is heard', { skip }, async () => {
  const r = await cli('listen', SONG, '--close', '99', '--offline');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^fledgetone: --close 99 is outside the bars heard/);
  writeFileSync(join(tmp, 'not-audio-either.mp3'), 'These are not sounds.\n');
  const against = await cli('listen', SONG, '--close', '99', '--against', join(tmp, 'not-audio-either.mp3'), '--offline');
  assert.equal(against.code, 2);
  assert.match(against.stderr, /^fledgetone: --close 99 is outside the bars heard/);
  assert.match((await cli('listen', SONG, '--close', '-1')).stderr, /^fledgetone: --close -1: give a bar/);
});

test('measure through the browser: a close-up past the end is refused as for a WAV, before the sound to read against is heard', { skip: browserSkip, timeout: 300_000 }, async () => {
  const mp3 = join(tmp, 'short.mp3');
  assert.equal((await slowCli('render', SONG, '--bars', '1', '-o', mp3, '--offline')).code, 0);
  writeFileSync(join(tmp, 'y.mp3'), 'These are not sounds.\n');
  const r = await slowCli('measure', mp3, '--close', '99', '--against', join(tmp, 'y.mp3'), '--offline');
  assert.equal(r.code, 2);
  assert.equal(r.stderr.trim(), 'fledgetone: --close 99 is past the end of short.mp3');
  // An MP3 read against an MP3, in one page
  const both = await slowCli('measure', mp3, '--against', mp3, '--offline', '--json');
  assert.equal(both.code, 0, both.stderr);
  assert.match(JSON.parse(both.stdout).against.notes[0], /short\.mp3 against short\.mp3/);
});
