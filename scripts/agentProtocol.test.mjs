// The studio connection (src/agent/protocol.ts, the studio's end in src/agent/bridgeProtocolClient.ts
// and the helper's in tools/cli/src/bridgeServer.ts): pairing codes and proofs, which pages and
// addresses may connect, a helper that can't prove it knows the code refused before anything is
// sent, and the real helper and studio client paired in this process: wrong codes, the attempt
// limits, requests, permissions, events and the frame cap. The parts with the real helper need
// tools/cli's dependencies (npm install in tools/cli) and are skipped without them. Run with `npm test`.
import { register, createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
const P = await import('../src/agent/protocol.ts');
const { createBridgeClient, HandlerError } = await import('../src/agent/bridgeProtocolClient.ts');
const { songReadHandlers } = await import('../src/agent/studioReads.ts');
const { createStarter } = await import('../src/store/starters.ts');

const CLI = new URL('../tools/cli/', import.meta.url);
const haveCli = existsSync(new URL('node_modules/ws/package.json', CLI));
const skipCli = haveCli ? false : 'tools/cli dependencies are not installed (run npm install in tools/cli)';

async function until(check, ms = 3000, what = 'the condition') {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ---------- Pure parts ----------

test('pairing codes: 12 letters of 32 (60 bits), typed any way', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const code = P.newPairingCode();
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.equal(P.normalizeCode(code.toLowerCase().replace(/-/g, ' ')), code.replace(/-/g, ''));
    for (const c of code.replace(/-/g, '')) seen.add(c);
  }
  assert.equal(P.CODE_ALPHABET.length ** P.CODE_LENGTH >= 2 ** 60, true);
  assert.equal(seen.size, 32, 'every letter turns up');
  assert.equal(P.normalizeCode('K7QM-3XPD-9TB'), null);
  assert.equal(P.normalizeCode('K7QM-3XPD-9TBU'), null, 'U is not in the alphabet');
  // Lookalikes are read as what they look like
  assert.equal(P.normalizeCode('KOQM-3XPD-9TBI'), 'K0QM3XPD9TB1');
  assert.equal(P.normalizeCode('k7qm-3xpd-9tbl'), 'K7QM3XPD9TB1');
});

test('proofs: the studio and the helper prove the same code differently, and a wrong code proves nothing', async () => {
  const code = 'K7QM-3XPD-9TBW';
  const s = P.newNonce();
  const c = P.newNonce();
  const a = P.pairingAddress(47123);
  assert.equal(a, '127.0.0.1:47123');
  const studio = await P.studioProof(code, s, c, a);
  const server = await P.serverProof(code, s, c, a);
  assert.notEqual(studio, server);
  assert.equal(await P.studioProof('k7qm 3xpd 9tbw', s, c, a), studio);
  assert.notEqual(await P.studioProof('K7QM-3XPD-9TBX', s, c, a), studio);
  assert.notEqual(await P.studioProof(code, P.newNonce(), c, a), studio);
  // Bound to the helper's address: the same code and nonces on another port prove nothing
  assert.notEqual(await P.studioProof(code, s, c, P.pairingAddress(47124)), studio);
  assert.notEqual(await P.serverProof(code, s, c, P.pairingAddress(47124)), server);
  assert.ok(P.sameProof(studio, studio));
  assert.ok(!P.sameProof(studio, server));
  assert.ok(!P.sameProof(studio, undefined));
});

test('which pages may connect, and at which address', () => {
  assert.ok(P.originAllowed('https://fledgetone.com'));
  for (const o of ['https://evil.example', 'http://fledgetone.com', 'https://fledgetone.com.evil.example', undefined, '']) assert.ok(!P.originAllowed(o), String(o));
  assert.ok(!P.originAllowed('http://localhost:5173'));
  assert.ok(P.originAllowed('http://localhost:5173', { dev: true }));
  assert.ok(!P.originAllowed('http://localhost:3000', { dev: true }));
  assert.ok(!P.originAllowed('null'));
  // (never a page with no origin of its own: any website's sandboxed frame reads so too)
  assert.ok(!P.originAllowed('null', { allowNull: true, dev: true, studioOrigins: ['null'] }));
  assert.ok(P.originAllowed('http://127.0.0.1:47200', { studioOrigins: ['http://127.0.0.1:47200'] }));
  assert.ok(P.hostAllowed('127.0.0.1:47123', 47123));
  for (const h of ['localhost:47123', 'evil.example:47123', '127.0.0.1:47124', '127.0.0.1', undefined]) assert.ok(!P.hostAllowed(h, 47123), String(h));
});

test('messages: only our version and shape are read', () => {
  assert.deepEqual(P.parseMessage(P.encodeMessage({ kind: 'req', id: 'a', method: 'get_song', params: {} })), { v: 1, kind: 'req', id: 'a', method: 'get_song', params: {} });
  for (const bad of ['nope', '{}', JSON.stringify({ v: 2, kind: 'event', method: 'hello' }), JSON.stringify({ v: 1, kind: 'req', method: 'get_song' }), JSON.stringify({ v: 1, kind: 'event', method: 'Bad Name' }), 'x'.repeat(P.LIMITS.frameBytes + 1)])
    assert.equal(P.parseMessage(bad), null, bad.slice(0, 40));
});

test('a rate limiter lets through so many in a window', () => {
  const r = new P.RateLimiter(2, 1000);
  assert.equal(r.take(0), 0);
  assert.equal(r.take(10), 0);
  assert.equal(r.take(20), 980);
  assert.equal(r.take(1000), 0);
});

/** A studio client wired to an in-memory helper of the test's own (honest or not). */
function memoryStudio({ handlers = {}, permissions } = {}) {
  const sent = [];
  const closes = [];
  const states = [];
  const client = createBridgeClient({
    send: (t) => sent.push(JSON.parse(t)),
    close: (code, reason) => closes.push([code, reason]),
    handlers,
    port: 47123,
    app: { version: 'test' },
    permissions,
    onState: (i) => states.push(i.state),
  });
  return { client, sent, closes, states };
}
const msg = (m) => P.encodeMessage(m);

test('a helper that can\'t prove it knows the code gets nothing from the code, and no handler ever runs', async () => {
  let reads = 0;
  const { client, sent, closes } = memoryStudio({ handlers: { get_song: () => (reads++, { secret: true }) } });
  client.pair('K7QM-3XPD-9TBW');
  await client.receive(msg({ kind: 'event', method: 'hello', params: { protocol: 1, nonce: P.newNonce(), server: { name: 'fledgetone', version: 'x' } } }));
  await until(() => sent.length === 1, 1000, 'the pair request');
  assert.equal(sent[0].method, 'pair');
  // The studio's first step carries only its nonce: nothing worked out from the code
  assert.deepEqual(Object.keys(sent[0].params).sort(), ['app', 'nonce', 'permissions', 'protocol']);
  // Asked for the song before pairing is done: refused, the handler not run
  await client.receive(msg({ kind: 'req', id: 'early', method: 'get_song', params: {} }));
  assert.deepEqual(sent[1], { v: 1, kind: 'res', id: 'early', error: { code: 'not_paired', message: 'Not paired yet.' } });
  // A rogue helper answers with a proof it can't have made: the studio doesn't prove itself back
  await client.receive(msg({ kind: 'res', id: sent[0].id, result: { proof: 'A'.repeat(43), nonce: P.newNonce(), attemptsLeft: 4 } }));
  assert.equal(client.state, 'wrong_code');
  assert.equal(sent.length, 2);
  // Typing it again: a new first step, still no proof, and when the tries run out it's refused
  client.pair('K7QM-3XPD-9TBW');
  await until(() => sent.length === 3, 1000, 'the second pair request');
  assert.ok(!('proof' in sent[2].params));
  await client.receive(msg({ kind: 'res', id: sent[2].id, result: { proof: 'B'.repeat(43), nonce: P.newNonce(), attemptsLeft: 0 } }));
  assert.equal(client.state, 'refused');
  assert.equal(closes.length, 1);
  await client.receive(msg({ kind: 'req', id: 'late', method: 'get_song', params: {} }));
  assert.equal(reads, 0);
  assert.equal(sent.length, 3);
  assert.ok(sent.every((m) => m.method !== 'pair_confirm'), 'never a proof from the studio');
  assert.ok(!client.emit('changed', { revision: 1 }));
});

test('a program on the port that answers the pair with words of its own: the studio says its own, never those', async () => {
  const { pairErrorMessage } = await import('../src/agent/bridgeProtocolClient.ts');
  const lure = 'Fledgetone: your helper is out of date. Download the new one from https://helper.example/get \u202Eevil\u202C';
  for (const code of ['no_code', 'too_many_tries', 'busy', 'version', 'bad_request', 'refused', 'x', undefined, 42]) {
    const { client, sent, closes } = memoryStudio();
    client.pair('K7QM-3XPD-9TBW');
    await client.receive(msg({ kind: 'event', method: 'hello', params: { protocol: 1, nonce: P.newNonce(), server: { name: lure, version: 'x' } } }));
    await until(() => sent.length === 1, 1000, 'the pair request');
    await client.receive(msg({ kind: 'res', id: sent[0].id, error: { code, message: lure } }));
    const said = client.info().message;
    assert.equal(client.state, 'refused', String(code));
    // (an error without a string code isn't even read as one: "another version")
    if (typeof code === 'string') assert.equal(said, pairErrorMessage(code), String(code));
    assert.ok(!/helper\.example|Download|evil/.test(said), said);
    // (and nothing of it in the close reason either)
    assert.ok(closes.every(([, reason]) => !/helper\.example|evil/.test(reason)));
  }
  // Each known code has words of its own; anything else, one plain sentence
  const words = ['no_code', 'too_many_tries', 'busy', 'version', 'bad_request', 'refused'].map(pairErrorMessage);
  assert.equal(new Set(words).size, words.length);
  assert.equal(pairErrorMessage('made up'), pairErrorMessage(undefined));
});

test('a program on the port that speaks something else, or another version: said for what it is', async () => {
  const { NOT_THE_HELPER, OTHER_VERSION, isOtherVersionHello } = await import('../src/agent/bridgeProtocolClient.ts');
  const cases = [
    ['hello there', NOT_THE_HELPER],
    [JSON.stringify({ type: 'connected' }), NOT_THE_HELPER],
    [JSON.stringify({ v: 1, kind: 'event', method: 'hello', params: { protocol: 1, nonce: 'short' } }), NOT_THE_HELPER],
    [JSON.stringify({ v: 1, kind: 'event', method: 'hello', params: {} }), NOT_THE_HELPER],
    [JSON.stringify({ v: 2, kind: 'event', method: 'hello', params: { protocol: 2, nonce: P.newNonce() } }), OTHER_VERSION],
    [JSON.stringify({ v: 1, kind: 'event', method: 'hello', params: { protocol: 2, nonce: P.newNonce() } }), OTHER_VERSION],
  ];
  for (const [frame, want] of cases) {
    const { client, closes } = memoryStudio();
    client.pair('K7QM-3XPD-9TBW');
    await client.receive(frame);
    assert.equal(client.state, 'refused', frame);
    assert.equal(client.info().message, want, frame);
    assert.equal(closes.length, 1);
  }
  assert.ok(!isOtherVersionHello('{"v":1,"kind":"event","method":"hello","params":{"protocol":1}}'));
  assert.ok(!isOtherVersionHello('nonsense'));
});

test("a program on the port that opens but never says hello: the studio stops waiting and says so", async (t) => {
  const { HELLO_TIMEOUT_MS, NO_HELLO } = await import('../src/agent/bridgeProtocolClient.ts');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { client, closes } = memoryStudio();
  client.pair('K7QM-3XPD-9TBW');
  client.opened();
  t.mock.timers.tick(HELLO_TIMEOUT_MS - 1);
  assert.equal(client.state, 'waiting');
  t.mock.timers.tick(1);
  assert.equal(client.state, 'refused');
  assert.equal(client.info().message, NO_HELLO);
  assert.equal(closes.length, 1);
  // One that does say hello in time goes on as before
  const ok = memoryStudio();
  ok.client.pair('K7QM-3XPD-9TBW');
  ok.client.opened();
  t.mock.timers.tick(HELLO_TIMEOUT_MS / 2);
  await ok.client.receive(msg({ kind: 'event', method: 'hello', params: { protocol: 1, nonce: P.newNonce() } }));
  t.mock.timers.tick(HELLO_TIMEOUT_MS / 2 + 1);
  assert.equal(ok.client.state, 'proving', 'the pair step has a timer of its own');
});

test('the tries left as the other end says them: only a whole number from 0 to 5, and never more than the studio counts', async () => {
  const { readAttemptsLeft } = await import('../src/agent/bridgeProtocolClient.ts');
  for (const v of [4.5e15, 2.5, -1, 6, NaN, '3', null, undefined, Infinity]) assert.equal(readAttemptsLeft(v), undefined, String(v));
  for (const v of [0, 1, 5]) assert.equal(readAttemptsLeft(v), v);
  // A program that says a huge number: none shown, and after five wrong codes the connection's over all the same
  const { client, sent } = memoryStudio();
  client.pair('K7QM-3XPD-9TBW');
  await client.receive(msg({ kind: 'event', method: 'hello', params: { protocol: 1, nonce: P.newNonce() } }));
  for (let i = 0; i < P.LIMITS.triesPerConnection; i++) {
    await until(() => sent.filter((m) => m.method === 'pair').length === i + 1, 1000, 'a pair request');
    const pair = sent.filter((m) => m.method === 'pair').at(-1);
    await client.receive(msg({ kind: 'res', id: pair.id, result: { proof: 'A'.repeat(43), nonce: P.newNonce(), attemptsLeft: i === 0 ? 4.5e15 : 5 } }));
    if (i < P.LIMITS.triesPerConnection - 1) {
      assert.equal(client.state, 'wrong_code');
      if (i === 0) assert.equal(client.info().attemptsLeft, undefined, 'a number no helper says is not shown');
      else assert.equal(client.info().attemptsLeft, P.LIMITS.triesPerConnection - 1 - i, 'never more than the studio has left');
      client.pair('K7QM-3XPD-9TBW');
    }
  }
  assert.equal(client.state, 'refused');
});

test('an honest helper pairs; requests then reach the handlers the musician allowed', async () => {
  const code = P.newPairingCode();
  const { client, sent } = memoryStudio({ handlers: { get_song: () => ({ name: 'Song' }), suggest: () => ({ id: 's1' }), get_view: () => { throw new HandlerError('busy', 'Not now.'); } } });
  const nonce = P.newNonce();
  await client.receive(msg({ kind: 'event', method: 'hello', params: { protocol: 1, nonce, server: { name: 'fledgetone', version: 'x' } } }));
  client.pair(code);
  await until(() => sent.length === 1, 1000, 'the pair request');
  const pair = sent[0];
  assert.deepEqual(pair.params.permissions, P.DEFAULT_PERMISSIONS);
  await client.receive(msg({ kind: 'res', id: pair.id, result: { proof: await P.serverProof(code, nonce, pair.params.nonce, P.pairingAddress(47123)), nonce: P.newNonce(), attemptsLeft: 4 } }));
  await until(() => sent.length === 2, 1000, 'the confirm');
  const confirm = sent[1];
  assert.equal(confirm.method, 'pair_confirm');
  assert.ok(P.sameProof(confirm.params.proof, await P.studioProof(code, nonce, pair.params.nonce, P.pairingAddress(47123))));
  assert.equal(client.state, 'proving');
  await client.receive(msg({ kind: 'res', id: confirm.id, result: { server: { name: 'fledgetone', version: 'x' }, agent: 'An agent' } }));
  assert.equal(client.state, 'paired');
  assert.equal(client.info().agent, 'An agent');
  await client.receive(msg({ kind: 'req', id: 'r1', method: 'get_song', params: {} }));
  assert.deepEqual(sent.at(-1), { v: 1, kind: 'res', id: 'r1', result: { name: 'Song' } });
  await client.receive(msg({ kind: 'req', id: 'r2', method: 'suggest', params: {} }));
  assert.equal(sent.at(-1).error.code, 'not_allowed');
  client.setPermissions({ read: true, see: true, suggest: true, listen: false });
  assert.deepEqual(sent.at(-1), { v: 1, kind: 'event', method: 'permissions', params: { read: true, see: true, suggest: true, listen: false } });
  await client.receive(msg({ kind: 'req', id: 'r3', method: 'suggest', params: {} }));
  assert.deepEqual(sent.at(-1).result, { id: 's1' });
  await client.receive(msg({ kind: 'req', id: 'r4', method: 'get_view', params: {} }));
  assert.deepEqual(sent.at(-1).error, { code: 'busy', message: 'Not now.' });
  await client.receive(msg({ kind: 'req', id: 'r5', method: 'format_disk', params: {} }));
  assert.equal(sent.at(-1).error.code, 'unknown_method');
  await client.receive(msg({ kind: 'req', id: 'r6', method: 'listen', params: {} }));
  assert.equal(sent.at(-1).error.code, 'not_allowed');
  assert.ok(client.emit('changed', { revision: 2 }));
});

test('a listen under way when "Listen" is unticked: its result doesn\'t go, the agent hears not_allowed', async () => {
  const code = P.newPairingCode();
  let finish;
  const { client, sent } = memoryStudio({
    permissions: { read: true, see: false, suggest: false, listen: true },
    handlers: { listen: () => new Promise((r) => (finish = r)), get_view: () => new Promise((r) => (finish = r)) },
  });
  const nonce = P.newNonce();
  await client.receive(msg({ kind: 'event', method: 'hello', params: { protocol: 1, nonce, server: { name: 'fledgetone', version: 'x' } } }));
  client.pair(code);
  await until(() => sent.length === 1, 1000, 'the pair request');
  const pair = sent[0];
  await client.receive(msg({ kind: 'res', id: pair.id, result: { proof: await P.serverProof(code, nonce, pair.params.nonce, P.pairingAddress(47123)), nonce: P.newNonce(), attemptsLeft: 4 } }));
  await until(() => sent.length === 2, 1000, 'the confirm');
  await client.receive(msg({ kind: 'res', id: sent[1].id, result: { server: { name: 'fledgetone', version: 'x' } } }));
  assert.equal(client.state, 'paired');
  const answered = client.receive(msg({ kind: 'req', id: 'l1', method: 'listen', params: { fromBar: 1, toBar: 5 } }));
  await until(() => typeof finish === 'function', 1000, 'the listen to start');
  client.setPermissions({ read: true, see: false, suggest: false, listen: false });
  finish({ mix: { lufs: -14 }, secret: 'the render' });
  await answered;
  const res = sent.find((m) => m.kind === 'res' && m.id === 'l1');
  assert.equal(res.error.code, 'not_allowed');
  assert.equal(res.result, undefined);
  assert.ok(!JSON.stringify(sent).includes('the render'));
  // Allowed again: a listen answers as usual
  client.setPermissions({ read: true, see: false, suggest: false, listen: true });
  finish = undefined;
  const again = client.receive(msg({ kind: 'req', id: 'l2', method: 'listen', params: { fromBar: 1, toBar: 5 } }));
  await until(() => typeof finish === 'function', 1000, 'the second listen');
  finish({ mix: { lufs: -14 } });
  await again;
  assert.deepEqual(sent.find((m) => m.id === 'l2').result, { mix: { lufs: -14 } });
  // The connection gone while one is under way: nothing is sent at all
  finish = undefined;
  const late = client.receive(msg({ kind: 'req', id: 'l3', method: 'listen', params: { fromBar: 1, toBar: 5 } }));
  await until(() => typeof finish === 'function', 1000, 'the third listen');
  const count = sent.length;
  client.closed();
  finish({ mix: { lufs: -14 } });
  await late;
  assert.equal(sent.length, count);
});

// ---------- The real helper ----------

const cliImport = (path) => import(new URL(path, CLI).href);
const WebSocket = haveCli ? createRequire(new URL('package.json', CLI))('ws') : null;
const ORIGIN = 'https://fledgetone.com';

async function startHelper(opts = {}) {
  const { BridgeServer } = await cliImport('src/bridgeServer.ts');
  const logs = [];
  const helper = new BridgeServer({ port: 0, version: 'test', log: (t) => logs.push(t), agentName: () => 'Test agent', ...opts });
  await helper.start();
  return { helper, logs };
}

/**
 * A WebSocket to the helper, open or refused: resolves with { ws, early } or { refused: status }.
 * The helper says hello as soon as the socket opens (in the same packet, often), so messages are
 * caught from the start: `early` holds those that came before the caller listened.
 */
function openSocket(port, { origin = ORIGIN, host, headers = {} } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${host ?? `127.0.0.1:${port}`}`, { ...(origin ? { origin } : {}), headers });
    const early = [];
    const keep = (d) => early.push(d.toString());
    ws.on('message', keep);
    ws.listen = (fn) => {
      ws.off('message', keep);
      ws.on('message', (d) => fn(d.toString()));
      for (const t of early.splice(0)) fn(t);
    };
    ws.once('open', () => resolve({ ws }));
    ws.once('unexpected-response', (_req, res) => resolve({ refused: res.statusCode }));
    ws.once('error', (e) => resolve({ refused: e.message }));
  });
}

/** A studio: a real socket and the real client, with the read handlers on a starter. */
async function studio(port, { permissions, handlers = {} } = {}) {
  const song = createStarter('lofi');
  const { ws } = await openSocket(port);
  assert.ok(ws, 'the socket opened');
  const closed = { code: null };
  const client = createBridgeClient({
    send: (t) => ws.send(t),
    close: (code, reason) => ws.close(code, reason),
    handlers: { ...songReadHandlers({ song: () => song, revision: () => 3, appVersion: 'test' }), ...handlers },
    port,
    app: { version: 'test' },
    permissions,
  });
  ws.listen((t) => void client.receive(t));
  ws.on('close', (code) => {
    closed.code = code;
    client.closed();
  });
  return { ws, client, closed, song };
}

test('the real helper and the studio pair, and the agent reads the song through them', { skip: skipCli }, async () => {
  const { helper } = await startHelper();
  try {
    const { BridgeError, NOT_CONNECTED } = await cliImport('src/bridgeServer.ts');
    await assert.rejects(helper.request('get_song'), (e) => e instanceof BridgeError && e.code === 'not_connected' && e.message === NOT_CONNECTED);
    const { code } = helper.pairingCode();
    const s = await studio(helper.port, { handlers: { get_view: () => new Promise(() => {}) } });
    s.client.pair(code);
    await until(() => s.client.state === 'paired', 3000, 'pairing');
    assert.equal(s.client.info().agent, 'Test agent');
    assert.ok(helper.isPaired);
    const song = await helper.request('get_song');
    assert.equal(song.schema, 'fledgetone.agent-song/1');
    assert.equal(song.revision, 3);
    assert.deepEqual(song.tracks.map((t) => t.id), s.song.tracks.map((t) => t.id));
    const notes = await helper.request('get_notes', { clipId: s.song.clips[2].id });
    assert.equal(notes.notes.length, s.song.clips[2].notes.length);
    const preview = await helper.request('preview_suggestion', { ops: [{ op: 'set_tempo', bpm: 90 }] });
    assert.deepEqual(preview.changes, ['Changes the tempo from 82 to 90 BPM.']);
    // What the musician hasn't allowed is refused by the studio
    await assert.rejects(helper.request('suggest', { title: 'x', explanation: '', ops: [] }), (e) => e.code === 'not_allowed');
    // A request the studio never answers times out
    s.client.setPermissions({ read: true, see: true, suggest: false, listen: false });
    await assert.rejects(helper.request('get_view', {}, 150), (e) => e.code === 'timeout');
    // Events reach wait_for_changes
    const since = helper.status().lastEvent;
    s.client.emit('changed', { revision: 4 });
    const { events } = await helper.waitForEvents(since, 2000);
    assert.ok(events.some((e) => e.event === 'changed' && e.params.revision === 4));
    assert.equal(helper.permissions().see, true);
    // A second studio while one is paired is turned away
    const other = await openSocket(helper.port);
    const otherClose = await new Promise((r) => other.ws.once('close', (c) => r(c)));
    assert.equal(otherClose, 4009);
    // The code is used up
    const late = await studio(helper.port);
    late.client.pair(code);
    await until(() => late.closed.code !== null, 3000, 'the late studio to be turned away');
    // Leaving
    const before = helper.status().lastEvent;
    s.client.disconnect();
    await until(() => !helper.isPaired, 3000, 'the helper to see the studio go');
    const { events: after } = await helper.waitForEvents(before, 100);
    assert.ok(after.some((e) => e.event === 'bye') && after.some((e) => e.event === 'disconnected'));
  } finally {
    await helper.close();
  }
});

test('a wrong code: told so with the tries left, then the right code pairs', { skip: skipCli }, async () => {
  const { helper } = await startHelper();
  try {
    const { code } = helper.pairingCode();
    const s = await studio(helper.port);
    s.client.pair(code === 'AAAA-AAAA-AAAA' ? 'BBBB-BBBB-BBBB' : 'AAAA-AAAA-AAAA');
    await until(() => s.client.state === 'wrong_code', 3000, 'the wrong code answer');
    assert.equal(s.client.info().attemptsLeft, P.LIMITS.triesPerConnection - 1);
    s.client.pair(code);
    await until(() => s.client.state === 'paired', 3000, 'pairing');
    s.client.disconnect();
  } finally {
    await helper.close();
  }
});

test('a program on another port that relays to the real helper can\'t pair: the proofs are bound to the port dialed', { skip: skipCli }, async () => {
  const { helper } = await startHelper();
  // The relay: a WebSocket server of its own; each studio that dials it gets a connection to the
  // helper (Origin faked, as any program can) with every frame passed on both ways, and read
  const seen = [];
  const relay = new WebSocket.WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => relay.once('listening', r));
  const relayPort = relay.address().port;
  relay.on('connection', (down) => {
    const up = new WebSocket(`ws://127.0.0.1:${helper.port}`, { origin: ORIGIN });
    const queue = [];
    up.on('open', () => queue.splice(0).forEach((t) => up.send(t)));
    up.on('message', (d) => (seen.push(['to studio', d.toString()]), down.send(d.toString())));
    down.on('message', (d) => (seen.push(['to helper', d.toString()]), up.readyState === 1 ? up.send(d.toString()) : queue.push(d.toString())));
    up.on('close', () => down.close());
    down.on('close', () => up.close());
  });
  try {
    const { code } = helper.pairingCode();
    let reads = 0;
    const s = await studio(relayPort, { handlers: { get_song: () => (reads++, { secret: true }) } });
    s.client.pair(code);
    await until(() => s.client.state === 'wrong_code' || s.client.state === 'refused' || s.client.state === 'paired', 3000, 'an answer through the relay');
    assert.equal(s.client.state, 'wrong_code', 'the helper\'s proof, made for its own port, doesn\'t check out on the port dialed');
    assert.match(s.client.info().message, /port/);
    assert.ok(!helper.isPaired);
    assert.ok(seen.every(([, t]) => JSON.parse(t).method !== 'pair_confirm'), 'the studio never proved itself through the relay');
    await assert.rejects(helper.request('get_song'), (e) => e.code === 'not_connected');
    assert.equal(reads, 0);
    s.ws.close();
    // The same code on the helper's own port pairs
    const direct = await studio(helper.port);
    direct.client.pair(code);
    await until(() => direct.client.state === 'paired', 3000, 'pairing on the helper\'s own port');
    direct.client.disconnect();
  } finally {
    relay.close();
    await helper.close();
  }
});

test('the usual port taken: the helper doesn\'t move to another by itself, says so, and takes it once it\'s free', { skip: skipCli }, async () => {
  const { BridgeServer, DEFAULT_PORT } = await cliImport('src/bridgeServer.ts');
  const net = await import('node:net');
  // Hold the usual port (or find it held already)
  const hold = net.createServer();
  const held = await new Promise((r) => {
    hold.once('error', () => r(false));
    hold.listen(DEFAULT_PORT, '127.0.0.1', () => r(true));
  });
  const logs = [];
  const helper = new BridgeServer({ version: 'test', log: (t) => logs.push(t) });
  try {
    assert.equal(await helper.start(), 0);
    const st = helper.status();
    assert.equal(st.listening, false);
    assert.equal(st.portTaken, true);
    assert.equal(st.port, DEFAULT_PORT);
    assert.match(st.problem, new RegExp(`Port ${DEFAULT_PORT} .*taken.*--port 0`));
    assert.ok(logs.some((l) => /taken/.test(l)));
    assert.equal(await helper.tryListen(), 0, 'still taken');
    if (held) {
      await new Promise((r) => hold.close(r));
      assert.equal(await helper.tryListen(), DEFAULT_PORT);
      assert.equal(helper.status().listening, true);
      assert.equal(helper.status().portTaken, undefined);
    }
  } finally {
    if (held && hold.listening) await new Promise((r) => hold.close(r));
    await helper.close();
  }
  // A port asked for with --port that's taken is an error, not another port
  const a = await startHelper();
  try {
    const b = new BridgeServer({ port: a.helper.port, version: 'test', log: () => {} });
    await assert.rejects(b.start(), (e) => e.code === 'EADDRINUSE');
    await b.close();
  } finally {
    await a.helper.close();
  }
});

/** Raw tries on one connection, one after another, until it closes: how many answers came, and the close code. */
async function wrongTries(port) {
  const { ws } = await openSocket(port);
  let answers = 0;
  return new Promise((resolve) => {
    const tryOnce = () => ws.send(msg({ kind: 'req', id: `p${answers}`, method: 'pair', params: { protocol: 1, nonce: P.newNonce(), app: { name: 'x', version: 'x' }, permissions: P.DEFAULT_PERMISSIONS } }));
    ws.listen((t) => {
      const m = JSON.parse(t);
      if (m.method === 'hello') return tryOnce();
      answers++;
      if (m.result?.proof) tryOnce();
    });
    ws.on('close', (code) => resolve({ answers, code }));
  });
}

test('five tries close a connection; twenty retire the code', { skip: skipCli }, async () => {
  const { helper } = await startHelper();
  try {
    const { code } = helper.pairingCode();
    // Five proofs given, then the sixth try is refused and the connection closed
    for (let i = 0; i < 3; i++) assert.deepEqual(await wrongTries(helper.port), { answers: 6, code: 4001 });
    assert.ok(helper.status().codeWaiting, 'still waiting after 15 tries');
    // The last five tries spend the code: the sixth finds none waiting
    assert.deepEqual(await wrongTries(helper.port), { answers: 6, code: 4010 });
    assert.ok(!helper.status().codeWaiting, 'retired after 20');
    const { events } = await helper.waitForEvents(0, 0);
    assert.equal(events.filter((e) => e.event === 'code_retired').length, 1, 'retired once');
    // The old code no longer pairs
    const s = await studio(helper.port);
    s.client.pair(code);
    await until(() => s.client.state === 'refused' || s.client.state === 'closed', 3000, 'the refusal');
    assert.match(s.client.info().message, /isn’t waiting for a code/i);
    assert.notEqual(helper.pairingCode().code, code);
  } finally {
    await helper.close();
  }
});

test('a burst of tries sent at once costs one proof and spends the budget', { skip: skipCli }, async () => {
  const { helper } = await startHelper();
  try {
    const { code } = helper.pairingCode();
    const { ws } = await openSocket(helper.port);
    const got = [];
    const closed = new Promise((r) => ws.on('close', (c) => r(c)));
    ws.listen((t) => {
      const m = JSON.parse(t);
      if (m.method !== 'hello') return got.push(m);
      ws._socket.cork();
      for (let i = 0; i < 40; i++) ws.send(msg({ kind: 'req', id: `b${i}`, method: 'pair', params: { protocol: 1, nonce: P.newNonce(), app: { name: 'x', version: 'x' }, permissions: P.DEFAULT_PERMISSIONS } }));
      ws._socket.uncork();
    });
    assert.equal(await closed, 4001);
    assert.ok(got.filter((m) => m.result?.proof).length <= 1, 'at most one proof given');
    assert.ok(got.length <= P.LIMITS.triesPerConnection + 1, `${got.length} answers`);
    assert.deepEqual(got.filter((m) => m.error).map((m) => m.error.code), ['busy', 'busy', 'busy', 'busy', 'too_many_tries']);
    // A guessing studio's confirm is refused and the connection closed
    const second = await openSocket(helper.port);
    const secondClosed = new Promise((r) => second.ws.on('close', (c) => r(c)));
    second.ws.listen((t) => {
      const m = JSON.parse(t);
      if (m.method === 'hello') return second.ws.send(msg({ kind: 'req', id: 'q', method: 'pair', params: { protocol: 1, nonce: P.newNonce(), app: { name: 'x', version: 'x' }, permissions: P.DEFAULT_PERMISSIONS } }));
      if (m.result?.proof) second.ws.send(msg({ kind: 'req', id: 'c', method: 'pair_confirm', params: { proof: 'A'.repeat(43) } }));
    });
    assert.equal(await secondClosed, 4003);
    // The code still pairs a real studio (it was never confirmed)
    const s = await studio(helper.port);
    s.client.pair(code);
    await until(() => s.client.state === 'paired', 3000, 'pairing');
    s.client.disconnect();
  } finally {
    await helper.close();
  }
});

test('pages from other sites, other addresses and no page at all are refused', { skip: skipCli }, async () => {
  const { helper, logs } = await startHelper();
  const dev = await startHelper({ dev: true });
  try {
    const port = helper.port;
    assert.deepEqual(await openSocket(port, { origin: 'https://evil.example' }), { refused: 403 });
    assert.deepEqual(await openSocket(port, { origin: null }), { refused: 403 });
    assert.deepEqual(await openSocket(port, { origin: 'null' }), { refused: 403 });
    assert.deepEqual(await openSocket(port, { origin: 'http://localhost:5173' }), { refused: 403 });
    assert.deepEqual(await openSocket(port, { host: `localhost:${port}` }), { refused: 403 });
    assert.deepEqual(await openSocket(port, { headers: { Host: `evil.example:${port}` } }), { refused: 403 });
    assert.ok(logs.some((l) => /evil\.example/.test(l)));
    const ok = await openSocket(port);
    assert.ok(ok.ws);
    ok.ws.close();
    // The dev server's pages only with --dev
    const devOk = await openSocket(dev.helper.port, { origin: 'http://localhost:5173' });
    assert.ok(devOk.ws);
    devOk.ws.close();
    assert.deepEqual(await openSocket(dev.helper.port, { origin: 'https://evil.example' }), { refused: 403 });
  } finally {
    await helper.close();
    await dev.helper.close();
  }
});

test('a frame over the cap closes the connection', { skip: skipCli }, async () => {
  const { helper } = await startHelper();
  try {
    const { ws } = await openSocket(helper.port);
    const code = await new Promise((resolve) => {
      ws.on('close', (c) => resolve(c));
      ws.listen(() => ws.send('x'.repeat(P.LIMITS.frameBytes + 10)));
    });
    assert.equal(code, 1009);
  } finally {
    await helper.close();
  }
});
