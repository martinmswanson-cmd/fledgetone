// The agent tools (`fledgetone mcp`, tools/cli/src/mcpServer.ts) through the MCP SDK's own client
// over stdio, run from source: the tools listed (no accept tool), get_song and suggest in file
// mode, the live tools saying plainly that no studio is connected, files kept inside --root, the
// ops guide served, and stdout carrying nothing but the protocol. Needs tools/cli's dependencies
// (npm install in tools/cli): skipped without them. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'tools/cli');
const SDK = join(CLI, 'node_modules/@modelcontextprotocol/sdk');
const haveCli = existsSync(join(SDK, 'package.json'));
const skip = haveCli ? false : 'tools/cli dependencies are not installed (run npm install in tools/cli)';
const ARGS = ['--import', join(CLI, 'src/tsHook.mjs'), join(CLI, 'src/fledgetone.ts'), 'mcp', '--port', '0'];

const work = mkdtempSync(join(tmpdir(), 'fledgetone-mcp-'));
copyFileSync(join(ROOT, 'scripts/fixtures/agent-song.fledgetone.json'), join(work, 'song.fledgetone.json'));
test.after(() => rmSync(work, { recursive: true, force: true }));

const text = (r) => r.content.map((c) => c.text).join('');

async function connect() {
  const { Client } = await import(pathToFileURL(join(SDK, 'dist/esm/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(join(SDK, 'dist/esm/client/stdio.js')).href);
  const transport = new StdioClientTransport({ command: process.execPath, args: [...ARGS, '--root', work], cwd: ROOT, stderr: 'pipe' });
  const client = new Client({ name: 'test agent', version: '1' });
  await client.connect(transport);
  return client;
}

test('the tools, file mode, the live tools without a studio, and the guide', { skip, timeout: 60_000 }, async () => {
  const client = await connect();
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ['studio_status', 'connect_studio', 'get_song', 'get_notes', 'get_automation', 'get_view', 'wait_for_changes', 'listen', 'suggest', 'preview_suggestion', 'get_suggestion', 'withdraw_suggestion', 'say', 'point_at', 'list_instruments', 'list_presets', 'list_starters', 'list_params', 'check_file', 'diff_files'])
      assert.ok(names.includes(n), `no ${n} tool`);
    assert.ok(!names.some((n) => /accept/.test(n)), 'there is never an accept tool');

    const song = JSON.parse(text(await client.callTool({ name: 'get_song', arguments: { file: 'song.fledgetone.json' } })));
    assert.equal(song.schema, 'fledgetone.agent-song/1');
    assert.equal(song.name, 'Agent test song');
    const kalimba = song.clips.find((c) => c.name === 'Kalimba');

    const ops = [{ op: 'add_notes', clipId: kalimba.id, notes: [{ pitch: 'A5', start: 3.5, length: 0.5 }] }, { op: 'set_track', trackId: song.tracks[0].id, volumeDb: -9 }];
    const preview = JSON.parse(text(await client.callTool({ name: 'preview_suggestion', arguments: { file: 'song.fledgetone.json', ops } })));
    assert.equal(preview.ok, true);
    assert.ok(preview.warnings.some((w) => /goes up by 9\.5 dB/.test(w)), JSON.stringify(preview));

    const made = await client.callTool({ name: 'suggest', arguments: { file: 'song.fledgetone.json', out: 'answer.suggestion.json', title: 'An answer', explanation: 'One note answers the phrase.', ops } });
    assert.ok(!made.isError, text(made));
    const file = JSON.parse(readFileSync(join(work, 'answer.suggestion.json'), 'utf8'));
    assert.equal(file.format, 'fledgetone-suggestion');
    assert.equal(file.songId, 'agent-test-song');
    assert.deepEqual(file.ops, ops);
    assert.ok(file.touchedHashes[`clip:${kalimba.id}`]);

    const badOps = await client.callTool({ name: 'suggest', arguments: { file: 'song.fledgetone.json', out: 'x.json', title: 'x', explanation: '', ops: [{ op: 'add_notes', clipId: 'nope', notes: [] }] } });
    assert.ok(badOps.isError);
    assert.match(text(badOps), /op 0 \(ops\[0\]\.clipId\): no clip "nope"/);
    const overSong = await client.callTool({ name: 'suggest', arguments: { file: 'song.fledgetone.json', out: 'song.fledgetone.json', title: 'x', explanation: '', ops } });
    assert.ok(overSong.isError);

    for (const [name, args] of [['get_view', {}], ['get_song', {}], ['say', { text: 'hello' }], ['suggest', { title: 'x', explanation: 'y', ops }], ['listen', { fromBar: 1, toBar: 5 }]]) {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(r.isError, name);
      assert.equal(text(r), 'No studio is connected — call connect_studio and ask the user to type the code in Fledgetone.', name);
    }
    const connect = JSON.parse(text(await client.callTool({ name: 'connect_studio', arguments: {} })));
    assert.match(connect.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.match(connect.say, new RegExp(connect.code));
    const again = JSON.parse(text(await client.callTool({ name: 'connect_studio', arguments: { waitSeconds: 0.2 } })));
    assert.equal(again.connected, false);
    assert.equal(again.code, connect.code, 'the same code until it is used');

    // The song under another case is still the song
    copyFileSync(join(work, 'song.fledgetone.json'), join(work, 'plain.json'));
    const sameName = await client.callTool({ name: 'suggest', arguments: { file: 'plain.json', out: 'PLAIN.JSON', title: 'x', explanation: '', ops } });
    assert.ok(sameName.isError);
    assert.match(text(sameName), /never the song itself/);

    // A link planted where the suggestion goes (pointing out of the folder, at nothing yet) is refused
    const outside = mkdtempSync(join(tmpdir(), 'fledgetone-outside-'));
    symlinkSync(join(outside, 'planted.json'), join(work, 'planted.suggestion.json'));
    const planted = await client.callTool({ name: 'suggest', arguments: { file: 'song.fledgetone.json', out: 'planted.suggestion.json', title: 'x', explanation: '', ops } });
    assert.ok(planted.isError);
    assert.ok(!existsSync(join(outside, 'planted.json')), 'nothing written outside the folder');
    rmSync(outside, { recursive: true, force: true });

    // Files outside the folder the helper works in, or of other kinds, are refused
    for (const file of ['../outside.fledgetone.json', '/etc/passwd', 'notes.txt']) {
      const r = await client.callTool({ name: 'get_song', arguments: { file } });
      assert.ok(r.isError, file);
    }

    const { resources } = await client.listResources();
    assert.ok(resources.some((r) => r.uri === 'fledgetone://docs/ops'));
    const guide = await client.readResource({ uri: 'fledgetone://docs/ops' });
    assert.match(guide.contents[0].text, /add_notes/);
    assert.match(guide.contents[0].text, /Fledgetone sends nothing anywhere\. Your agent sends what it reads to whoever runs it\./);
    const listed = JSON.parse(text(await client.callTool({ name: 'list_presets', arguments: {} })));
    assert.ok(listed.includes('Supersaw lead'));
  } finally {
    await client.close();
  }
});

test('stdout carries the protocol and nothing else', { skip, timeout: 60_000 }, async () => {
  const child = spawn(process.execPath, [...ARGS, '--root', work], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const send = (m) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  send({ id: 3, method: 'tools/call', params: { name: 'get_song', arguments: { file: 'song.fledgetone.json' } } });
  send({ id: 4, method: 'tools/call', params: { name: 'get_song', arguments: { file: 'missing.fledgetone.json' } } });
  const end = Date.now() + 30_000;
  while (!out.includes('"id":4') && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  child.stdin.end();
  await new Promise((r) => child.once('exit', r));
  const lines = out.split('\n').filter(Boolean);
  assert.ok(lines.length >= 4, out);
  for (const line of lines) assert.equal(JSON.parse(line).jsonrpc, '2.0', `not protocol on stdout: ${line.slice(0, 80)}`);
  assert.deepEqual(lines.map((l) => JSON.parse(l).id).sort(), [1, 2, 3, 4]);
  // The helper's own words go to stderr
  assert.match(err, /agent tools ready/);
  assert.match(err, /waiting for the studio on 127\.0\.0\.1:\d+/);
});
