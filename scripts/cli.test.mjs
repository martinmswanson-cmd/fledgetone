// The command line (tools/cli): info, check, diff, notes, list, new, apply and measure on the
// fixtures in scripts/fixtures, run from its TypeScript source as `node --import
// tools/cli/src/tsHook.mjs tools/cli/src/fledgetone.ts`. apply never writes over the song it
// reads. Needs tools/cli's dependencies (npm install in tools/cli): skipped without them. Run with
// `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
function makeWav({ channels = 2, rate = 48000, seconds = 2, truncate } = {}) {
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
    const v = Math.round(0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate) * 32767);
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
