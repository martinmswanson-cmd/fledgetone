// The command line (tools/cli): info, check, diff, notes, list, new, apply and measure on the
// fixtures in scripts/fixtures, run from its TypeScript source as `node --import
// tools/cli/src/tsHook.mjs tools/cli/src/fledgetone.ts`. apply never writes over the song it
// reads. Needs tools/cli's dependencies (npm install in tools/cli): skipped without them. Run with
// `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'tools/cli');
const haveCli = existsSync(join(CLI, 'node_modules/@modelcontextprotocol/sdk/package.json'));
const skip = haveCli ? false : 'tools/cli dependencies are not installed (run npm install in tools/cli)';
const FIX = join(ROOT, 'scripts/fixtures');
const SONG = join(FIX, 'agent-song.fledgetone.json');
const EDITED = join(FIX, 'agent-song-edited.fledgetone.json');
const SUGGESTION = join(FIX, 'agent-suggestion.json');

/** Run the command line; resolves with { code, stdout, stderr }. */
function cli(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--import', join(CLI, 'src/tsHook.mjs'), join(CLI, 'src/fledgetone.ts'), ...args], { cwd: ROOT, timeout: 60_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    );
  });
}

const tmp = mkdtempSync(join(tmpdir(), 'fledgetone-cli-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

test('--help lists the commands, and the privacy line', { skip }, async () => {
  const r = await cli('--help');
  assert.equal(r.code, 0);
  for (const c of ['info', 'check', 'diff', 'notes', 'list', 'new', 'apply', 'measure', 'link', 'from-link', 'mcp']) assert.match(r.stdout, new RegExp(`^  ${c} `, 'm'), c);
  assert.match(r.stdout, /Fledgetone sends nothing anywhere\. Your agent sends what it reads to whoever runs it\./);
  const bad = await cli('frobnicate');
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /unknown command "frobnicate"/);
});

test('info: the song in plain words, or as the agent reads it', { skip }, async () => {
  const r = await cli('info', SONG);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Agent test song: 70\.0 BPM, 4\/4/);
  assert.match(r.stdout, /Kalimba \(Kalimba \(Real\), other\).*\[track-starter_ambient-3\]/);
  const j = await cli('info', SONG, '--json');
  const song = JSON.parse(j.stdout);
  assert.equal(song.schema, 'fledgetone.agent-song/1');
  assert.equal(song.songId, 'agent-test-song');
  assert.equal(song.tracks.length, 4);
});

test('check: a saved song opens as it is; a damaged one says what the app changes', { skip }, async () => {
  const ok = await cli('check', SONG);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /opens as it is/);
  const raw = JSON.parse(readFileSync(SONG, 'utf8'));
  raw.tracks[0].volume = 40;
  raw.clips.push({ ...raw.clips[0], id: 'orphan', trackId: 'no-such-track' });
  const damaged = join(tmp, 'damaged.fledgetone.json');
  writeFileSync(damaged, JSON.stringify(raw));
  const r = await cli('check', damaged);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /Track "Warm pad": volume: 40 → 6/);
  assert.match(r.stdout, /belongs to no track/);
  const fixed = join(tmp, 'fixed.fledgetone.json');
  assert.equal((await cli('check', damaged, '--fix', '-o', fixed)).code, 0);
  assert.equal((await cli('check', fixed)).code, 0);
  const notJson = join(tmp, 'nope.fledgetone.json');
  writeFileSync(notJson, 'not json');
  const bad = await cli('check', notJson);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /isn't JSON/);
});

test('check, info: a track past the most a song opens with is said once (not each of its clips), in the singular; info says what was left out on stderr', { skip }, async () => {
  const raw = JSON.parse(readFileSync(SONG, 'utf8'));
  const t0 = raw.tracks[0];
  const c0 = raw.clips.find((c) => c.trackId === t0.id);
  // 256 tracks and one more, which has two clips
  for (let i = raw.tracks.length; i < 257; i++) raw.tracks.push({ ...t0, id: `extra-${i}`, name: `Extra ${i}` });
  for (const k of [1, 2]) raw.clips.push({ ...c0, id: `last-${k}`, name: `last ${k}`, trackId: 'extra-256' });
  const capped = join(tmp, 'capped.fledgetone.json');
  writeFileSync(capped, JSON.stringify(raw));
  const r = await cli('check', capped);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /It has 1 track over the most a song opens with \(256 tracks\): that is left out when it opens\./);
  assert.doesNotMatch(r.stdout, /belongs to no track/);
  assert.match(r.stdout, /1 thing the app changes/);
  const info = await cli('info', capped, '--json');
  assert.equal(info.code, 0, info.stderr);
  JSON.parse(info.stdout);
  assert.equal(info.stderr.trim(), 'Left out on reading the file: 1 track over the most a song opens with (256 tracks). The rest is used as it is.');
  // A file read in full says nothing
  assert.equal((await cli('info', SONG)).stderr, '');
});

test('diff: what changed, in plain words', { skip }, async () => {
  const r = await cli('diff', SONG, EDITED);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /- Turns "Glass" down by 2\.5 dB \(-23\.5 dB to -26 dB\)\./);
  assert.match(r.stdout, /- In "Kalimba" on "Kalimba": adds 2 notes in bar 8\./);
  assert.match(r.stdout, /- Adds the marker "Coda" at bar 13\./);
  // Where it is heard: the track wherever it plays, the notes and the marker where they are
  assert.match(r.stdout, /^\(Heard in bars? \d/m);
  const json = await cli('diff', SONG, EDITED, '--json');
  const d = JSON.parse(json.stdout);
  assert.ok(Array.isArray(d.regions) && d.regions.length > 0);
  assert.ok(d.changes.every((c) => !('marked' in c)), 'the plain words only');
  assert.ok(!/[\uE000\uE001]/.test(json.stdout));
  const same = await cli('diff', SONG, SONG);
  assert.match(same.stdout, /No differences/);
});

test('mcp --allow-null-origin is no longer offered: it says to use --studio', { skip }, async () => {
  const r = await cli('mcp', '--allow-null-origin');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--allow-null-origin is no longer offered.*--studio/s);
  const help = await cli('--help');
  assert.ok(!/allow-null-origin/.test(help.stdout));
});

test('apply: writes a new song equal to the edited fixture, and never over the song it reads', { skip }, async () => {
  const input = join(tmp, 'song.fledgetone.json');
  copyFileSync(SONG, input);
  const before = readFileSync(input, 'utf8');
  const refused = await cli('apply', input, SUGGESTION, '-o', input);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /is the song itself/);
  assert.equal(readFileSync(input, 'utf8'), before);
  const out = join(tmp, 'out.fledgetone.json');
  const r = await cli('apply', input, SUGGESTION, '-o', out);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /"A kalimba answer": wrote/);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), JSON.parse(readFileSync(EDITED, 'utf8')));
  assert.equal(readFileSync(input, 'utf8'), before);
  // On the song it already changed, the suggestion is out of date
  const again = await cli('apply', out, SUGGESTION, '-o', join(tmp, 'again.fledgetone.json'));
  assert.equal(again.code, 1);
  assert.match(again.stdout, /The song changed since this suggestion was made/);
});

test('notes, list and new', { skip }, async () => {
  const n = await cli('notes', SONG, '--track', 'Kalimba', '--bars', '5-5');
  assert.equal(n.code, 0, n.stderr);
  assert.ok(n.stdout.trim().split('\n').length >= 2);
  assert.ok(n.stdout.trim().split('\n').every((l) => /^bar\s+5\.\d{3}\s+\S+/.test(l)), n.stdout);
  const inst = await cli('list', 'instruments', 'kalimba', '--json');
  assert.ok(JSON.parse(inst.stdout).some((i) => i.key === 'realKalimba' || /Kalimba/.test(i.name)));
  const inserts = JSON.parse((await cli('list', 'inserts', 'filter', '--json')).stdout);
  assert.deepEqual([inserts[0].settings.cutoff.min, inserts[0].settings.cutoff.max], [20, 20000]);
  const made = join(tmp, 'new.fledgetone.json');
  const r = await cli('new', '--starter', 'celtic', '-o', made);
  assert.equal(r.code, 0, r.stderr);
  assert.match((await cli('info', made)).stdout, /112\.0 BPM/);
  assert.equal((await cli('new', '--starter', 'celtic', '-o', made)).code, 2, 'no overwriting without --overwrite');
});

/** A 16-bit WAV of a 1 kHz sine at half scale in every channel. */
function makeWav({ channels = 2, rate = 48000, seconds = 2, truncate, level = () => 0.5 } = {}) {
  const frames = Math.round(rate * seconds);
  const size = frames * channels * 2;
  const buf = Buffer.alloc(44 + size);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + size, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(size, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(level(i / rate) * Math.sin((2 * Math.PI * 1000 * i) / rate) * 32767);
    for (let c = 0; c < channels; c++) buf.writeInt16LE(v, 44 + (i * channels + c) * 2);
  }
  return truncate ? buf.subarray(0, truncate) : buf;
}

test('measure: the loudness of a WAV file', { skip }, async () => {
  const wav = join(tmp, 'sine.wav');
  writeFileSync(wav, makeWav());
  const r = await cli('measure', wav, '--json');
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  // A half-scale 1 kHz sine in both channels: -6 LUFS, a peak of -6 dBTP
  assert.ok(Math.abs(m.lufs - -6.0) < 0.6, `lufs ${m.lufs}`);
  assert.ok(Math.abs(m.truePeakDbtp - -6.0) < 0.3, `true peak ${m.truePeakDbtp}`);
  assert.ok(Math.abs(m.crestDb - 3.0) < 0.2, `crest ${m.crestDb}`);
  assert.equal(m.regions[3].name, 'mids (500 Hz-2 kHz)');
  assert.ok(m.regions[3].db > -1, 'the sine is in the mids');
});

test('measure: mono as one channel, more than two said, silence and damaged files in plain words', { skip }, async () => {
  const measureOf = async (name, wav) => {
    const path = join(tmp, name);
    writeFileSync(path, wav);
    return cli('measure', path, '--json');
  };
  // Mono is one channel (BS.1770): 3 dB under the same sine in both
  const mono = JSON.parse((await measureOf('mono.wav', makeWav({ channels: 1 }))).stdout);
  assert.ok(Math.abs(mono.lufs - -9.0) < 0.6, `mono lufs ${mono.lufs}`);
  const six = JSON.parse((await measureOf('six.wav', makeWav({ channels: 6 }))).stdout);
  assert.match(six.note, /only the first two of its 6 channels/);
  const empty = JSON.parse((await measureOf('empty.wav', makeWav({ seconds: 0 }))).stdout);
  assert.equal(empty.silent, true);
  assert.deepEqual(empty.regions, []);
  const text = await measureOf('empty2.wav', makeWav({ seconds: 0 }));
  assert.equal(text.code, 0);
  // Under 0.4 seconds: no loudness reading, said in words (not "-Infinity LUFS")
  const shortPath = join(tmp, 'short.wav');
  writeFileSync(shortPath, makeWav({ seconds: 0.2 }));
  const short = await cli('measure', shortPath);
  assert.equal(short.code, 0, short.stderr);
  assert.match(short.stdout, /Too short to measure loudness/);
  assert.doesNotMatch(short.stdout, /Infinity|NaN|Balance/);
  for (const [name, wav, re] of [
    ['cut.wav', makeWav({ truncate: 30 }), /damaged or cut short/],
    ['slow.wav', makeWav({ rate: 4, seconds: 2 }), /sample rate is 4 Hz/],
  ]) {
    const r = await cli('measure', ...[join(tmp, name)].map((p) => (writeFileSync(p, wav), p)));
    assert.equal(r.code, 2, name);
    assert.match(r.stderr, re, name);
    assert.doesNotMatch(r.stderr, /DataView|RangeError|at /, name);
  }
});

test('writes never go through a link, a hard link is the same file, and -o never writes over a file unasked', { skip }, async () => {
  const { symlinkSync, linkSync, existsSync } = await import('node:fs');
  const input = join(tmp, 'linked.fledgetone.json');
  copyFileSync(SONG, input);
  // A hard link to the song is the song
  const hard = join(tmp, 'hard.fledgetone.json');
  linkSync(input, hard);
  const r = await cli('apply', input, SUGGESTION, '-o', hard);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /is the song itself/);
  // A link pointing at nothing yet, where the output goes: refused, nothing made where it points
  const target = join(tmp, 'elsewhere.fledgetone.json');
  const dangling = join(tmp, 'dangling.fledgetone.json');
  symlinkSync(target, dangling);
  const viaLink = await cli('apply', input, SUGGESTION, '-o', dangling, '--overwrite');
  assert.equal(viaLink.code, 2);
  assert.match(viaLink.stderr, /is a link/);
  assert.ok(!existsSync(target));
  // An existing file isn't written over without --overwrite
  const taken = join(tmp, 'taken.fledgetone.json');
  writeFileSync(taken, 'mine');
  const over = await cli('apply', input, SUGGESTION, '-o', taken);
  assert.equal(over.code, 2);
  assert.match(over.stderr, /already exists/);
  assert.equal(readFileSync(taken, 'utf8'), 'mine');
  assert.equal((await cli('apply', input, SUGGESTION, '-o', taken, '--overwrite')).code, 0);
});

test('from-link: a damaged link is a plain error, exit 2', { skip }, async () => {
  for (const link of ['https://fledgetone.com/app/#s=%%%***', 'https://fledgetone.com/app/#s=AAAA']) {
    const r = await cli('from-link', link, '-o', join(tmp, 'bad-link.fledgetone.json'));
    assert.equal(r.code, 2, link);
    assert.match(r.stderr, /^fledgetone: that link can't be read/, link);
  }
});

test('writeFileSafe writes plain files only, and checks what it opened before writing', { skip }, async () => {
  // (the hook that lets the command line's TypeScript load here, as the helper runs from source)
  await import(pathToFileURL(join(CLI, 'src/tsHook.mjs')).href);
  const { writeFileSafe } = await import(pathToFileURL(join(CLI, 'src/files.ts')).href);
  const { symlinkSync } = await import('node:fs');
  const plain = join(tmp, 'plain.json');
  writeFileSync(plain, 'a much longer text than what replaces it');
  writeFileSafe(plain, 'short');
  assert.equal(readFileSync(plain, 'utf8'), 'short', 'written over and cut to the new length');
  const real = join(tmp, 'real.json');
  writeFileSync(real, 'keep');
  const link = join(tmp, 'link.json');
  symlinkSync(real, link);
  assert.throws(() => writeFileSafe(link, 'nope'), /is a link/);
  assert.equal(readFileSync(real, 'utf8'), 'keep');
});

test('measure: under 0.4 seconds there is no balance to read', { skip }, async () => {
  const wav = join(tmp, 'blip.wav');
  writeFileSync(wav, makeWav({ seconds: 0.1 }));
  const m = JSON.parse((await cli('measure', wav, '--json')).stdout);
  assert.equal(m.silent, false);
  assert.deepEqual(m.regions, []);
  assert.match(m.note, /shorter than 0\.4 seconds/);
});

/** ffmpeg's ebur128 loudest short-term reading (whole 3-second windows only), or null without ffmpeg. */
function ffmpegShortTermMax(path) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  const lines = r.stderr.split('\n').filter((l) => /\bt: *([\d.]+)/.test(l) && /S: *(-?[\d.]+)/.test(l));
  // (ffmpeg prints a reading every 100 ms, a hair before each tenth; from 3 seconds on its short-term covers a whole 3 seconds)
  const whole = lines.filter((l) => Number(/\bt: *([\d.]+)/.exec(l)[1]) >= 3 - 0.01).map((l) => Number(/S: *(-?[\d.]+)/.exec(l)[1]));
  return whole.length ? Math.max(...whole) : null;
}

test('measure: the loudest 3 seconds counts whole 3-second windows only (a loud start is not overstated); under 3 seconds there are none', { skip }, async () => {
  // A second of a loud sine, then five quiet: the loudest 3 seconds are the first three, about 4.8 LU under the loud second
  const start = join(tmp, 'loud-start.wav');
  writeFileSync(start, makeWav({ seconds: 6, level: (t) => (t < 1 ? 0.5 : 0.005) }));
  const loud = join(tmp, 'loud-second.wav');
  writeFileSync(loud, makeWav({ seconds: 1 }));
  const a = JSON.parse((await cli('measure', start, '--json')).stdout);
  const b = JSON.parse((await cli('measure', loud, '--json')).stdout);
  assert.ok(Math.abs(a.shortTermMaxLufs - (b.lufs - 10 * Math.log10(3))) < 0.3, `loudest 3 s ${a.shortTermMaxLufs}, the loud second ${b.lufs}`);
  const ref = ffmpegShortTermMax(start);
  if (ref !== null) assert.ok(Math.abs(a.shortTermMaxLufs - ref) < 0.3, `ffmpeg's ebur128 says ${ref}`);
  // A second long: no whole 3 seconds, said plainly
  assert.equal(b.shortTermMaxLufs, null);
  const text = await cli('measure', loud);
  assert.match(text.stdout, /too short for the loudest 3 seconds: under 3 seconds long/);
  assert.match((await cli('measure', start)).stdout, /loudest 3 seconds -\d+\.\d LUFS/);
});

test('info: meter changes listed, as tempo changes are', { skip }, async () => {
  const song = JSON.parse(readFileSync(SONG, 'utf8'));
  song.meterPoints = [{ id: 'm1', bar: 5, num: 3, den: 4 }, { id: 'm2', bar: 9, num: 7, den: 8 }];
  const path = join(tmp, 'meters.fledgetone.json');
  writeFileSync(path, JSON.stringify(song));
  const r = await cli('info', path);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Meter changes: 3\/4 at bar 5\.0, 7\/8 at bar 9\.0$/m);
});

test('what the command line prints carries no terminal escapes or hidden characters from a song or a suggestion file', { skip }, async () => {
  const esc = '\u001b]0;pwned\u0007\u001b[2K\r\u009b31m\u202e\u200b';
  const song = JSON.parse(readFileSync(SONG, 'utf8'));
  song.name = `Demo${esc}`;
  song.tracks[0].name = `Bass${esc}\u{e0049}\u{e0047}`;
  const path = join(tmp, 'esc.fledgetone.json');
  writeFileSync(path, JSON.stringify(song));
  // eslint-disable-next-line no-control-regex
  const unsafe = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}]/u;
  for (const args of [['info', path], ['info', path, '--json'], ['notes', path], ['check', path], ['diff', path, SONG]]) {
    const r = await cli(...args);
    assert.ok(!unsafe.test(r.stdout), `${args[0]}: ${JSON.stringify(r.stdout.match(unsafe))}`);
    assert.ok(r.stdout.length > 0, args.join(' '));
  }
  // An error quoting a name from the song
  const bad = await cli('notes', path, '--track', `Nope${esc}`);
  assert.equal(bad.code, 2);
  assert.ok(!unsafe.test(bad.stderr), JSON.stringify(bad.stderr));
  // A suggestion file with escapes in its title (anyone can write one): apply prints it plain
  const sug = JSON.parse(readFileSync(SUGGESTION, 'utf8'));
  sug.title = `Quieter${esc}\nfledgetone: all checks passed`;
  const sugPath = join(tmp, 'esc.suggestion.json');
  writeFileSync(sugPath, JSON.stringify(sug));
  const applied = await cli('apply', SONG, sugPath, '-o', join(tmp, 'esc-out.fledgetone.json'), '--force');
  assert.ok(!unsafe.test(applied.stdout), JSON.stringify(applied.stdout));
  assert.ok(!/^fledgetone: all checks passed/m.test(applied.stdout), 'the title stays on its line');
});

test('nor invisible characters: variation selectors, fillers, blank braille, the other default-ignorable ones (an emoji, a flag and a joined word kept)', { skip }, async () => {
  // Hidden: variation selectors (U+FE00, U+E0100...), combining grapheme joiner, Hangul fillers, blank braille, a word joiner
  const hidden = '\uFE00\u{E0100}\u{E01EF}\u034F\u115F\u1160\u3164\uFFA0\u2800\u2060\u180E';
  // Kept: an emoji with its presentation selector and joiners, the Welsh flag, a Persian word with its ZWNJ
  const kept = ['\u2764\uFE0F', '\u{1F469}\u200D\u{1F4BB}', '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}', '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645'];
  const song = JSON.parse(readFileSync(SONG, 'utf8'));
  song.name = `Se${hidden}cret ${kept.join(' ')}`;
  song.tracks[0].name = `B${hidden}ass`;
  song.markers = [{ id: 'mk1', bar: 3, name: `Dro${hidden}p` }];
  const path = join(tmp, 'hidden.fledgetone.json');
  writeFileSync(path, JSON.stringify(song));
  const invisible = /[\p{Default_Ignorable_Code_Point}\u2800]/u;
  for (const args of [['info', path], ['info', path, '--json'], ['notes', path], ['notes', path, '--json'], ['check', path], ['diff', SONG, path], ['diff', SONG, path, '--json']]) {
    const r = await cli(...args);
    assert.ok(r.stdout.length > 0, args.join(' '));
    // (what's left: only the joiners and selectors the kept words need)
    const left = r.stdout.replace(new RegExp(kept.join('|'), 'gu'), '');
    assert.ok(!invisible.test(left), `${args.join(' ')}: ${JSON.stringify(left.match(invisible))}`);
    if (args[0] === 'info' && args.length === 2) {
      assert.match(r.stdout, /Secret /);
      for (const k of kept) assert.ok(r.stdout.includes(k), `${JSON.stringify(k)} kept`);
    }
    if (args[0] === 'notes' && args.length === 2) assert.match(r.stdout, /Bass/);
  }
  await import(pathToFileURL(join(CLI, 'src/tsHook.mjs')).href);
  const { safeText } = await import(pathToFileURL(join(CLI, 'src/print.ts')).href);
  assert.equal(safeText(`a${hidden}b\r\n\tc`), 'ab\n\tc');
  assert.equal(safeText('plain text, as it is'), 'plain text, as it is');
});

test('a file whose name only starts with two dots is inside the folder (the helper and the studio server)', { skip }, async () => {
  await import(pathToFileURL(join(CLI, 'src/tsHook.mjs')).href);
  const { fileInRoot } = await import(pathToFileURL(join(CLI, 'src/files.ts')).href);
  const { fileInside } = await import(pathToFileURL(join(CLI, 'src/staticServer.ts')).href);
  const root = mkdtempSync(join(tmp, 'root-'));
  copyFileSync(SONG, join(root, '..dots.fledgetone.json'));
  writeFileSync(join(root, '..page.html'), '<p>hi</p>');
  assert.equal(fileInRoot(root, '..dots.fledgetone.json', { mustExist: true }), join(realpathSync(root), '..dots.fledgetone.json'));
  assert.throws(() => fileInRoot(join(root), '../outside.fledgetone.json'), /outside the folder/);
  assert.equal(fileInside(root, '..page.html'), join(realpathSync(root), '..page.html'));
  assert.equal(fileInside(root, '../cli.test.mjs'), null);
});

// ---------- Hearing more on the command line: measure --sound, --pictures, --against, --save ----------

/** A 32-bit float WAV of one or two Float32Array channels. */
function floatWav(channels, rate = 48000) {
  const frames = channels[0].length;
  const size = frames * channels.length * 4;
  const buf = Buffer.alloc(44 + size);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + size, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);
  buf.writeUInt16LE(channels.length, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels.length * 4, 28);
  buf.writeUInt16LE(channels.length * 4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(size, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels.length; c++) buf.writeFloatLE(channels[c][i], 44 + (i * channels.length + c) * 4);
  return buf;
}

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** The made signals and the hearing code, loaded through the command line's TypeScript hook. */
const hearingKit = async () => {
  await import(pathToFileURL(join(CLI, 'src/tsHook.mjs')).href);
  const S = await import('./fixtures/hearingSignals.mjs');
  const { parseSavedHearing } = await import(pathToFileURL(join(ROOT, 'src/audio/hearing/hearingOf.ts')).href);
  return { S, parseSavedHearing };
};

test("measure's hearing options: checked before anything is read, times as seconds or minutes and seconds", { skip }, async () => {
  await import(pathToFileURL(join(CLI, 'src/tsHook.mjs')).href);
  const { hearPlan, UsageError, AUDIO_TYPES } = await import(pathToFileURL(join(CLI, 'src/commands.ts')).href);
  assert.deepEqual([...AUDIO_TYPES], ['.wav', '.mp3', '.flac', '.ogg', '.opus', '.m4a', '.aac']);
  assert.equal(hearPlan(['a.wav'], { pictures: 'out' }).sound, true);
  assert.equal(hearPlan(['a.wav'], {}).sound, false);
  for (const flags of [{ against: 'b.wav' }, { save: 'a.hearing.json' }, { close: ['1'] }, { sound: true }]) assert.equal(hearPlan(['a.wav'], flags).sound, true, JSON.stringify(flags));
  assert.throws(() => hearPlan(['a.txt'], {}), (err) => err instanceof UsageError && /\.wav, \.mp3, \.flac/.test(err.message));
  const plan = hearPlan(['a.wav'], { from: '1:30', to: '100' });
  assert.equal(plan.fromSeconds, 90);
  assert.equal(plan.toSeconds, 100);
  assert.equal(hearPlan(['a.wav'], { from: '1:30.5', to: '90.75' }).fromSeconds, 90.5);
  assert.deepEqual(hearPlan(['a.wav'], { close: ['0:01', '2.5'] }).closeUps, [1, 2.5]);
  assert.equal(hearPlan(['a.wav'], { bpm: '120' }).bpm, 120);
  assert.throws(() => hearPlan(['a.wav'], { from: '100', to: '1:30' }), UsageError);
  assert.throws(() => hearPlan(['a.wav'], { from: '5', to: '5' }), UsageError);
  for (const [flags, re] of [
    [{ from: 'soon' }, /--from/],
    [{ to: '1:75' }, /--to/],
    [{ close: ['x'] }, /--close/],
    [{ bpm: 'fast' }, /--bpm/],
    [{ against: 'b.txt' }, /--against/],
    [{ 'against-from': '1' }, /--against-from/],
    [{ save: 'a.txt' }, /--save/],
  ])
    assert.throws(() => hearPlan(['a.wav'], flags), (err) => err instanceof UsageError && re.test(err.message), JSON.stringify(flags));
  // A --pictures path that is there and not a folder
  const afile = join(tmp, 'not-a-folder');
  writeFileSync(afile, 'x');
  assert.throws(() => hearPlan(['a.wav'], { pictures: afile }), /isn't a folder/);
});

test('measure without the hearing options prints what it did before, text and --json', { skip }, async () => {
  const wav = join(tmp, 'snapshot-sine.wav');
  writeFileSync(wav, makeWav());
  const j = await cli('measure', wav, '--json');
  assert.equal(j.code, 0, j.stderr);
  assert.deepEqual(JSON.parse(j.stdout), JSON.parse(readFileSync(join(FIX, 'cli-measure-snapshot.json'), 'utf8')));
  assert.ok(!('sound' in JSON.parse(j.stdout)));
  const t = await cli('measure', wav);
  assert.equal(t.stdout.replace(wav, 'sine.wav'), readFileSync(join(FIX, 'cli-measure-snapshot.txt'), 'utf8'));
});

test('measure --sound --pictures --save: the sound report, its pictures as PNG files, a saved hearing of measurements only', { skip, timeout: 240_000 }, async (t) => {
  const { S, parseSavedHearing } = await hearingKit();
  const dir = mkdtempSync(join(tmp, 'hear-'));
  const tone = S.sine(1000, 30, -6);
  writeFileSync(join(dir, 'a.wav'), floatWav([tone, tone]));
  const pictures = join(dir, 'pictures');
  const saved = join(dir, 'a.hearing.json');
  const started = Date.now();
  const r = await cli('measure', join(dir, 'a.wav'), '--sound', '--pictures', pictures, '--save', saved, '--json');
  t.diagnostic(`measure --sound --pictures --save of 30 seconds: ${Date.now() - started} ms`);
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  near(m.sound.tone.centreHz, 1000, 30, 'centre');
  assert.ok(Array.isArray(m.sound.words) && m.sound.words.length > 0);
  assert.equal('along' in m.sound, false, '--json leaves the per-second grids out');
  const spectrogram = join(pictures, 'spectrogram.png');
  assert.ok(readFileSync(spectrogram).subarray(0, 8).equals(PNG_SIGNATURE), 'a PNG file');
  assert.ok(m.pictures.some((p) => p.path === spectrogram && p.kind === 'spectrogram' && !('id' in p)), JSON.stringify(m.pictures.map((p) => p.path)));
  for (const p of m.pictures) assert.ok(existsSync(p.path), p.path);
  // The saved hearing: measurements only, no audio
  const text = readFileSync(saved, 'utf8');
  const hearing = parseSavedHearing(JSON.parse(text));
  assert.equal(hearing.of, 'a.wav');
  assert.deepEqual(hearing.range, { fromSeconds: 0, toSeconds: 30 });
  const sampleData = (x) => (Array.isArray(x) ? x.some(sampleData) : x && typeof x === 'object' ? Object.entries(x).some(([k, v]) => (k === 'channels' && typeof v === 'object') || sampleData(v)) : false);
  assert.ok(!sampleData(JSON.parse(text)), 'no channels of samples');
  assert.ok(Buffer.byteLength(text) < 2 * 1024 * 1024, `${Buffer.byteLength(text)} bytes`);
  // It keeps the per-second grids (what a stretch of it is read from), and is written without indentation
  assert.equal(hearing.sound.along.mid.length, 30);
  assert.equal(text.trimEnd().split('\n').length, 1, 'one line');
  // In plain words: the report's lines, then the sound, then the pictures
  const words = await cli('measure', join(dir, 'a.wav'), '--pictures', pictures);
  assert.equal(words.code, 0, words.stderr);
  assert.match(words.stdout, /^Loudness [^]*\nSound:\n {2}\S/m);
  assert.match(words.stdout, /\nPictures:\n {2}.*spectrogram\.png: /);
  assert.doesNotMatch(words.stdout, /\b(good|bad|too|should)\b/i);
  // A saved hearing isn't written over unasked
  const again = await cli('measure', join(dir, 'a.wav'), '--save', saved);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already exists/);
});

test('measure --against: another sound or a saved hearing, read as this one against it, a stretch of either', { skip, timeout: 240_000 }, async () => {
  const { S } = await hearingKit();
  const dir = mkdtempSync(join(tmp, 'against-'));
  const tone = S.sine(1000, 30, -6);
  writeFileSync(join(dir, 'a.wav'), floatWav([tone, tone]));
  assert.equal((await cli('measure', join(dir, 'a.wav'), '--save', join(dir, 'a.hearing.json'))).code, 0);
  // b: a with a band of noise added up high
  const added = S.mix(tone, S.band(S.pink(30, -24, 4), 4000, 9000));
  writeFileSync(join(dir, 'b.wav'), floatWav([added, added]));
  const b = await cli('measure', join(dir, 'b.wav'), '--against', join(dir, 'a.hearing.json'));
  assert.equal(b.code, 0, b.stderr);
  assert.match(b.stdout, /^Against a\.hearing\.json:$/m);
  assert.match(b.stdout, /^ {2}Read as b\.wav against a\.hearing\.json\.$/m);
  const json = JSON.parse((await cli('measure', join(dir, 'b.wav'), '--against', join(dir, 'a.hearing.json'), '--json')).stdout);
  const tones = json.against.differences.filter((d) => d.group === 'tone');
  assert.ok(tones.length > 0, 'a tone difference');
  assert.ok(b.stdout.includes(`  ${tones[0].words}`), 'said in words');
  // Against a stretch of a saved hearing: 20 seconds of low noise, then high
  const low = S.band(S.pink(10, -18, 1), 40, 400);
  const high = S.band(S.pink(10, -18, 2), 2000, 12000);
  const long = S.at(20, [[0, low], [10, high]]);
  writeFileSync(join(dir, 'long.wav'), floatWav([long, long]));
  assert.equal((await cli('measure', join(dir, 'long.wav'), '--save', join(dir, 'long.hearing.json'))).code, 0);
  const c = S.band(S.pink(10, -18, 3), 2000, 12000);
  writeFileSync(join(dir, 'c.wav'), floatWav([c, c]));
  const same = await cli('measure', join(dir, 'c.wav'), '--against', join(dir, 'long.hearing.json'), '--against-from', '10', '--against-to', '20', '--json');
  assert.equal(same.code, 0, same.stderr);
  const sameJson = JSON.parse(same.stdout);
  assert.ok(!sameJson.against.differences.some((d) => d.group === 'tone' && d.size >= 2), JSON.stringify(sameJson.against.differences));
  const other = await cli('measure', join(dir, 'c.wav'), '--against', join(dir, 'long.hearing.json'), '--against-from', '0', '--against-to', '10');
  assert.equal(other.code, 0, other.stderr);
  assert.match(other.stdout, /^ {2}Centre: /m);
  assert.match(other.stdout, /Compared from saved measurements of a stretch/);
  // A stretch the saved hearing doesn't hold
  const outside = await cli('measure', join(dir, 'c.wav'), '--against', join(dir, 'long.hearing.json'), '--against-from', '40');
  assert.equal(outside.code, 2);
  assert.equal(outside.stderr.trim(), 'fledgetone: that stretch is outside the file');
  // A .json that isn't a saved hearing
  const notOne = await cli('measure', join(dir, 'c.wav'), '--against', SONG);
  assert.equal(notOne.code, 2);
  assert.match(notOne.stderr, /isn't a saved hearing/);
  // One that only looks like one at a glance (no settings, grids without their fields): the same line, not a crash
  const whole = JSON.parse(readFileSync(join(dir, 'long.hearing.json'), 'utf8'));
  const { settings: _settings, ...noSettings } = whole.sound;
  const shallow = [
    { ...whole, sound: noSettings },
    { ...whole, sound: { ...whole.sound, along: {} } },
    { ...whole, sound: { ...whole.sound, along: { ...whole.sound.along, mid: 'x' } } },
    { ...whole, sound: { ...whole.sound, versions: { tone: 'one' } } },
    { fledgetoneHearing: 1, of: 'x.wav', range: { fromSeconds: 0, toSeconds: 1 }, sound: { versions: {}, along: {}, seconds: 1, faults: [], words: [] } },
  ];
  for (const [i, bad] of shallow.entries()) {
    const path = join(dir, `shallow-${i}.json`);
    writeFileSync(path, JSON.stringify(bad));
    for (const extra of [[], ['--against-from', '0', '--against-to', '5']]) {
      const r = await cli('measure', join(dir, 'c.wav'), '--against', path, ...extra);
      assert.equal(r.code, 2, `shallow ${i}`);
      assert.ok(r.stderr.startsWith(`fledgetone: shallow-${i}.json isn't a saved hearing (fledgetone measure --save makes one)\n`), `shallow ${i}: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /Cannot read|undefined|\n\s+at /, `shallow ${i}`);
    }
  }
});

test('measure --from --to: a stretch of the file; outside it, or over 15 minutes heard, one plain line', { skip, timeout: 120_000 }, async () => {
  const wav = join(tmp, 'stretch-sine.wav');
  writeFileSync(wav, makeWav());
  const part = await cli('measure', wav, '--from', '0.5', '--to', '1.5', '--json');
  assert.equal(part.code, 0, part.stderr);
  assert.equal(JSON.parse(part.stdout).seconds, 1);
  const outside = await cli('measure', wav, '--from', '5');
  assert.equal(outside.code, 2);
  assert.equal(outside.stderr.trim(), 'fledgetone: that stretch is outside the file');
  assert.doesNotMatch(outside.stderr, /\n\s+at /);
  // 16 minutes of silence at 8 kHz, mono, 16-bit (about 15 MB): refused when heard, measured as before when not
  const long = join(tmp, 'sixteen-minutes.wav');
  writeFileSync(long, makeWav({ channels: 1, rate: 8000, seconds: 960, level: () => 0 }));
  try {
    const heard = await cli('measure', long, '--sound');
    assert.equal(heard.code, 2);
    assert.equal(heard.stderr.trim(), 'fledgetone: At most 15 minutes at a time (this is 16:00); name a stretch.');
    const plain = await cli('measure', long, '--json');
    assert.equal(plain.code, 0, plain.stderr);
    assert.equal(JSON.parse(plain.stdout).seconds, 960);
    assert.equal((await cli('measure', long, '--sound', '--from', '0', '--to', '15:00', '--json')).code, 0);
  } finally {
    rmSync(long, { force: true });
  }
});

test('measure --from --to: every time read or given is a time in the file (the words, the header, the close-ups, a saved hearing and a stretch of it)', { skip, timeout: 240_000 }, async () => {
  const { S, parseSavedHearing } = await hearingKit();
  const dir = mkdtempSync(join(tmp, 'file-time-'));
  // 24 seconds with a click 12.5 s in
  const bed = (seed) => S.mix(S.sine(110, 24, -12), S.sine(440, 24, -18), S.band(S.pink(24, -30, seed), 100, 4000));
  const l = bed(3), r = bed(4);
  l[12.5 * 48000] += 0.3; r[12.5 * 48000] += 0.3;
  const wav = join(dir, 'click.wav');
  writeFileSync(wav, floatWav([l, r]));
  const pictures = join(dir, 'pictures');
  const saved = join(dir, 'ten-to-twenty.hearing.json');
  const heard = await cli('measure', wav, '--from', '10', '--to', '20', '--close', '12', '--pictures', pictures, '--save', saved);
  assert.equal(heard.code, 0, heard.stderr);
  assert.match(heard.stdout, /click\.wav: 0:10 to 0:20 of 0:24, 2 channels\n/);
  assert.match(heard.stdout, /^ {2}A click, a jump of -?\d+\.\d dBFS, at 0:12\.50\.$/m);
  assert.doesNotMatch(heard.stdout, /0:02\.5/);
  for (const name of ['closeup-12.50s.png', 'closeup-12.00s.png']) assert.ok(existsSync(join(pictures, name)), name);
  assert.match(heard.stdout, /spectrogram\.png: .* over 0:10\.0 to 0:20\.0 /);
  // --json: the fault, the range and the pictures' ranges in file time
  const j = JSON.parse((await cli('measure', wav, '--from', '10', '--to', '20', '--sound', '--json')).stdout);
  assert.deepEqual(j.range, { fromSeconds: 10, toSeconds: 20 });
  assert.equal(j.fileSeconds, 24);
  near(j.sound.faults.find((f) => f.kind === 'click').seconds, 12.5, 0.001, 'the click');
  assert.deepEqual(j.sound.settings.stretch, { fromSeconds: 10, toSeconds: 20 });
  // A close-up is given in file time too: 12 is inside the stretch, 2.5 is not
  const outside = await cli('measure', wav, '--from', '10', '--to', '20', '--close', '2.5');
  assert.equal(outside.code, 2);
  assert.match(outside.stderr, /--close 2\.5 is outside the stretch heard/);
  // The whole file says no stretch
  const whole = await cli('measure', wav, '--sound');
  assert.match(whole.stdout, /click\.wav: 0:24, 2 channels\n/);
  assert.match(whole.stdout, /^ {2}A click, a jump of -?\d+\.\d dBFS, at 0:12\.50\.$/m);
  // The saved hearing is of 10 to 20 s: a stretch of it is asked for in file time
  assert.deepEqual(parseSavedHearing(JSON.parse(readFileSync(saved, 'utf8'))).range, { fromSeconds: 10, toSeconds: 20 });
  const inFile = await cli('measure', wav, '--from', '12', '--to', '18', '--against', saved, '--against-from', '12', '--against-to', '18');
  assert.equal(inFile.code, 0, inFile.stderr);
  assert.match(inFile.stdout, /Compared from saved measurements of a stretch/);
  const before = await cli('measure', wav, '--against', saved, '--against-from', '2', '--against-to', '8');
  assert.equal(before.code, 2);
  assert.equal(before.stderr.trim(), 'fledgetone: that stretch is outside the file');
  // Read against the same sound without the click: the click is said, after the notes and before the differences
  const clean = join(dir, 'clean.wav');
  writeFileSync(clean, floatWav([bed(3), bed(4)]));
  const faults = await cli('measure', wav, '--against', clean);
  assert.equal(faults.code, 0, faults.stderr);
  assert.match(faults.stdout, /\nAgainst clean\.wav:\n {2}Read as click\.wav against clean\.wav\.\n {2}Clicks: 1 in click\.wav \(at 0:12\.50\), none in clean\.wav\.\n/);
  const nothing = await cli('measure', clean, '--against', clean);
  assert.match(nothing.stdout, /\nAgainst clean\.wav:\n {2}Read as clean\.wav against clean\.wav\.\n {2}Nothing differs by more than a step\.\n?$/);
  // An audio file read against, a stretch of it: in its own file time
  const other = await cli('measure', wav, '--from', '0', '--to', '6', '--against', wav, '--against-from', '12', '--against-to', '18', '--json');
  assert.equal(other.code, 0, other.stderr);
  assert.equal(JSON.parse(other.stdout).against.notes[0], 'Read as click.wav against click.wav.');
});

test('measure: negative numbers, a missing file and folders that are not there are one plain line each, before any hearing', { skip, timeout: 120_000 }, async () => {
  const wav = join(tmp, 'follow-up.wav');
  writeFileSync(wav, makeWav());
  for (const option of ['from', 'to', 'close', 'bpm']) {
    const r = await cli('measure', wav, `--${option}`, '-1');
    assert.equal(r.code, 2, option);
    assert.match(r.stderr, new RegExp(`^fledgetone: --${option} takes .*\\(got -1\\)\\n`), option);
  }
  for (const option of ['against-from', 'against-to']) {
    const r = await cli('measure', wav, '--against', wav.replace(/\.wav$/, '.hearing.json'), `--${option}`, '-1');
    assert.equal(r.code, 2, option);
    assert.match(r.stderr, new RegExp(`^fledgetone: --${option} takes seconds, like 90, 90\\.5 or 1:30 \\(got -1\\)\\n`), option);
  }
  for (const extra of [[], ['--sound']]) {
    const r = await cli('measure', join(tmp, 'nothere.wav'), ...extra);
    assert.equal(r.code, 2);
    assert.equal(r.stderr.trim(), `fledgetone: can't read ${join(tmp, 'nothere.wav')}`);
  }
  const afile = join(tmp, 'a-plain-file');
  writeFileSync(afile, 'x');
  const pictures = await cli('measure', wav, '--pictures', join(afile, 'sub'));
  assert.equal(pictures.code, 2);
  assert.match(pictures.stderr, /^fledgetone: --pictures .*sub: .*a-plain-file is a file, not a folder\n/);
  // --save under a file: the file is named, not the path to save in
  const saveUnder = await cli('measure', wav, '--save', join(afile, 'h.json'));
  assert.equal(saveUnder.code, 2);
  assert.match(saveUnder.stderr, /^fledgetone: --save .*h\.json: .*a-plain-file is a file, not a folder\n/);
  assert.doesNotMatch(saveUnder.stderr, /h\.json isn't a folder/);
  const save = await cli('measure', wav, '--save', join(tmp, 'nodir', 'h.json'));
  assert.equal(save.code, 2);
  assert.match(save.stderr, /^fledgetone: --save .*h\.json: the folder .*nodir isn't there\n/);
  // The subject is checked before the sound it is read against is heard (that one isn't audio at all)
  writeFileSync(join(tmp, 'not-audio.mp3'), 'These are not sounds.\n');
  const close = await cli('measure', wav, '--close', '99', '--against', join(tmp, 'not-audio.mp3'));
  assert.equal(close.code, 2);
  assert.match(close.stderr, /^fledgetone: --close 99 is past the end of follow-up\.wav\n/);
});
