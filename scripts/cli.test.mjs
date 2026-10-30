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

test('diff: what changed, in plain words', { skip }, async () => {
  const r = await cli('diff', SONG, EDITED);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /- Turns "Glass" down by 2\.5 dB \(-23\.5 dB to -26 dB\)\./);
  assert.match(r.stdout, /- In "Kalimba" on "Kalimba": adds 2 notes in bar 8\./);
  assert.match(r.stdout, /- Adds the marker "Coda" at bar 13\./);
  const same = await cli('diff', SONG, SONG);
  assert.match(same.stdout, /No differences/);
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
