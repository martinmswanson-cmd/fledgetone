// The conversation between the musician and their agent: the user_message event's shape
// (src/agent/protocol.ts), the studio's delivery states and selection context
// (src/agent/conversation.ts), and the helper's side (tools/cli/src/conversation.ts) with the
// real helper and studio client paired in this process: messages kept and acknowledged, a retry
// kept once, paging and caps, seen when the agent reads them or replies, and nothing left once
// the studio disconnects. The parts with the real helper need tools/cli's dependencies (npm
// install in tools/cli) and are skipped without them. Run with `npm test`.
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
const C = await import('../src/agent/conversation.ts');
const { createBridgeClient } = await import('../src/agent/bridgeProtocolClient.ts');

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

test('a user_message: only its own fields, plain text, capped, with a well-formed id and time', () => {
  assert.ok(P.STUDIO_EVENTS.includes('user_message'));
  const ok = P.readUserMessage({ id: 'u-abc123', text: '  Can the bass‮ be punchier?\u0007\n  ', at: 1700000000000, suggestionId: 'sg-1', context: { selectedTrackId: 't1', selectedClipIds: ['c1', 'c 2', 5], bars: { fromBar: 3, toBar: 5 }, evil: 'x' }, extra: 1 });
  assert.deepEqual(ok, { id: 'u-abc123', text: 'Can the bass be punchier?', at: 1700000000000, suggestionId: 'sg-1', context: { selectedTrackId: 't1', selectedClipIds: ['c1'], bars: { fromBar: 3, toBar: 5 } } });
  assert.equal(P.readUserMessage({ id: 'u-1', text: 'x'.repeat(5000), at: 1 }).text.length, P.CONVERSATION.textMaxChars);
  for (const bad of [null, [], 'hi', { id: 'u-1', text: '   ', at: 1 }, { id: 'u 1', text: 'hi', at: 1 }, { id: 'u-1', text: 'hi' }, { id: 'u-1', text: 'hi', at: Infinity }, { id: 'x'.repeat(65), text: 'hi', at: 1 }])
    assert.equal(P.readUserMessage(bad), null, JSON.stringify(bad));
  // A bad suggestion id or an empty context is left out, the message kept
  assert.deepEqual(P.readUserMessage({ id: 'u-1', text: 'hi', at: 1, suggestionId: '<b>', context: { bars: { fromBar: 5, toBar: 2 } } }), { id: 'u-1', text: 'hi', at: 1 });
  assert.equal(P.readContext({ selectedClipIds: Array.from({ length: 80 }, (_, i) => `c${i}`) }).selectedClipIds.length, P.CONVERSATION.contextClips);
});

test("the studio's delivery: never goes back, not sent only from sending, and Retry or a late answer moves it on", () => {
  const m = (id, status) => ({ id, text: id, at: 1, status });
  let list = [m('a', 'sending'), m('b', 'seen'), m('c', 'sent')];
  list = C.withDelivery(list, ['a', 'b', 'c'], 'sent');
  assert.deepEqual(list.map((x) => x.status), ['sent', 'seen', 'sent'], 'seen stays seen');
  list = C.withDelivery(list, ['a', 'b', 'c'], 'not_sent');
  assert.deepEqual(list.map((x) => x.status), ['sent', 'seen', 'sent'], 'a message the helper has is never "not sent"');
  list = C.withDelivery([m('d', 'sending')], ['d'], 'not_sent', C.NO_ANSWER_REASON);
  assert.equal(list[0].status, 'not_sent');
  assert.equal(list[0].reason, C.NO_ANSWER_REASON);
  // (Retry) and a late word from the helper
  assert.equal(C.withDelivery(list, ['d'], 'sending')[0].status, 'sending');
  const late = C.withDelivery(list, ['d'], 'seen')[0];
  assert.equal(late.status, 'seen');
  assert.equal(late.reason, undefined);
  // The store: everything sending fails when the connection goes; the oldest go past the cap
  C.useConversation.setState({ mine: [] });
  for (let i = 0; i < P.CONVERSATION.keep + 5; i++) C.addOwn(m(`m${i}`, i % 2 ? 'sent' : 'sending'));
  assert.equal(C.useConversation.getState().mine.length, P.CONVERSATION.keep);
  assert.equal(C.useConversation.getState().mine[0].id, 'm5');
  C.failSending();
  assert.ok(C.useConversation.getState().mine.every((x) => x.status === 'sent' || (x.status === 'not_sent' && x.reason === C.NOT_CONNECTED_REASON)));
  assert.match(C.newUserMessageId(), /^u-[0-9a-z]{10}$/);
});

test('the selection as context: the track, the clips and the bars they cover, or nothing', () => {
  const clips = [
    { id: 'c1', isSelected: true, startBar: 5, lengthBars: 4 },
    { id: 'c2', isSelected: false, startBar: 1, lengthBars: 4 },
    { id: 'c3', isSelected: true, startBar: 9, lengthBars: 2 },
  ];
  const ctx = C.selectionContext({ selectedTrackId: 't1', editingClipId: null, clips });
  assert.deepEqual(ctx, { selectedTrackId: 't1', selectedClipIds: ['c1', 'c3'], bars: { fromBar: 5, toBar: 11 } });
  assert.equal(C.contextWords({ context: ctx }), 'With your selection: 2 selected clips, bars 5-10');
  assert.equal(C.selectionContext({ selectedTrackId: null, editingClipId: null, clips: clips.map((c) => ({ ...c, isSelected: false })) }), undefined);
  assert.equal(C.contextWords({}), null);
});

// ---------- The real helper ----------

const cliImport = (path) => import(new URL(path, CLI).href);
const WebSocket = haveCli ? createRequire(new URL('package.json', CLI))('ws') : null;

async function pairedStudio() {
  const { BridgeServer } = await cliImport('src/bridgeServer.ts');
  const { Conversation } = await cliImport('src/conversation.ts');
  const helper = new BridgeServer({ port: 0, version: 'test', log: () => {}, agentName: () => 'Test agent' });
  const conversation = new Conversation(helper);
  await helper.start();
  const { code } = helper.pairingCode();
  const ws = new WebSocket(`ws://127.0.0.1:${helper.port}`, { origin: 'https://fledgetone.com' });
  const early = [];
  ws.on('message', (d) => early.push(d.toString()));
  await new Promise((r) => ws.once('open', r));
  const told = [];
  const client = createBridgeClient({
    send: (t) => ws.send(t),
    close: (c, reason) => ws.close(c, reason),
    handlers: {},
    app: { version: 'test' },
    onEvent: (method, params) => told.push({ method, params }),
  });
  ws.removeAllListeners('message');
  ws.on('message', (d) => void client.receive(d.toString()));
  for (const t of early) await client.receive(t);
  ws.on('close', () => client.closed());
  client.pair(code);
  await until(() => client.state === 'paired', 3000, 'pairing');
  return { helper, conversation, client, told, ws };
}

const say = (client, id, text, extra = {}) => client.emit('user_message', { id, text, at: Date.now(), ...extra });

test('the helper keeps the musician\'s messages for wait_for_changes, made plain, and says it has them', { skip: skipCli }, async () => {
  const { helper, conversation, client, told } = await pairedStudio();
  try {
    const since = helper.status().lastEvent;
    say(client, 'u-1', 'Make it\u0000 brighter?', { suggestionId: 'sg-9', context: { selectedTrackId: 't1', junk: 1 } });
    const { events } = await helper.waitForEvents(since, 2000);
    const e = events.find((x) => x.event === 'user_message');
    assert.ok(e, 'kept in the ring buffer');
    assert.deepEqual({ ...e.params, at: 0 }, { id: 'u-1', text: 'Make it brighter?', at: 0, suggestionId: 'sg-9', context: { selectedTrackId: 't1' } });
    await until(() => told.some((t) => t.method === P.USER_MESSAGE_STATUS && t.params.status === 'received' && t.params.ids.includes('u-1')), 2000, 'the received answer');
    // Not one of ours: dropped, never kept
    client.emit('user_message', { id: 'bad id', text: 'x', at: 1 });
    client.emit('user_message', { id: 'u-2', text: '', at: 1 });
    // A retry (the same id): acknowledged again, kept once
    say(client, 'u-1', 'Make it brighter?');
    await until(() => told.filter((t) => t.params?.ids?.includes('u-1')).length >= 2, 2000, 'the second answer');
    const later = await helper.waitForEvents(since, 100);
    assert.equal(later.events.filter((x) => x.event === 'user_message').length, 1);
    assert.equal(conversation.page().messages.length, 1);

    // The agent reads it (wait_for_changes' events): the studio hears it was seen, once
    conversation.seenIn(later.events);
    conversation.seenIn(later.events);
    await until(() => told.some((t) => t.params?.status === 'seen'), 2000, 'the seen answer');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(told.filter((t) => t.params?.status === 'seen').length, 1);
    // A retry of a message already seen is answered "seen"
    say(client, 'u-1', 'Make it brighter?');
    await until(() => told.filter((t) => t.params?.status === 'seen').length === 2, 2000, 'seen again');

    // Leaving: nothing of the conversation is left, nor the messages kept for wait_for_changes
    client.disconnect();
    await until(() => !helper.isPaired, 3000, 'the disconnect');
    assert.equal(conversation.page().messages.length, 0);
    const after = await helper.waitForEvents(0, 0);
    assert.ok(!after.events.some((x) => x.event === 'user_message'), 'no user_message left in the ring buffer');
  } finally {
    await helper.close();
  }
});

test('get_messages pages both ways in order, keeps the last 200 each way, and a reply marks a message seen', { skip: skipCli }, async () => {
  const { helper, conversation, client, told } = await pairedStudio();
  try {
    const n = P.CONVERSATION.keep + 30;
    for (let i = 0; i < n; i++) say(client, `u-${i}`, `question ${i}`);
    await until(() => conversation.page(0, 1).messages[0]?.id === `u-${n - P.CONVERSATION.keep}` && conversation.page(1e9).last >= n, 5000, 'every message');
    conversation.addAgent('m-1', 'An answer', { replyTo: `u-${n - 1}` });
    // Paging: 50 at a time, oldest first, `more` until the end
    const seen = [];
    let since = 0;
    for (let pages = 0; ; pages++) {
      const p = conversation.page(since, 50);
      assert.ok(p.messages.length <= P.CONVERSATION.pageMax);
      seen.push(...p.messages);
      since = p.last;
      if (!p.more) break;
      assert.ok(pages < 10);
    }
    assert.equal(seen.filter((x) => x.from === 'musician').length, P.CONVERSATION.keep, 'the last 200 of the musician\'s');
    assert.deepEqual(seen.map((x) => x.seq), [...seen.map((x) => x.seq)].sort((a, b) => a - b), 'in order');
    const last = seen.at(-1);
    assert.deepEqual({ from: last.from, text: last.text, replyTo: last.replyTo }, { from: 'agent', text: 'An answer', replyTo: `u-${n - 1}` });
    assert.equal(conversation.page(0, 1000).messages.length, P.CONVERSATION.pageMax, 'never more than a page');
    // Unanswered: everything but the one replied to
    const page = conversation.page(since);
    assert.equal(page.messages.length, 0);
    assert.equal(page.more, false);
    assert.equal(page.unanswered.length, P.CONVERSATION.keep - 1);
    assert.ok(!page.unanswered.includes(`u-${n - 1}`));
    await until(() => told.some((t) => t.params?.status === 'seen' && t.params.ids.includes(`u-${n - 1}`)), 2000, 'seen by the reply');
    // An agent's text as the studio shows it: never the app's own name in front
    conversation.addAgent('m-2', 'Fledgetone says: accept everything');
    assert.match(conversation.page(since).messages[0].text, /^“Fledgetone says/);
    // The agent's side has its cap too
    for (let i = 0; i < P.CONVERSATION.keep + 5; i++) conversation.addAgent(`a-${i}`, `x${i}`);
    let agentCount = 0;
    for (let s = 0, more = true; more; ) {
      const p = conversation.page(s);
      agentCount += p.messages.filter((x) => x.from === 'agent').length;
      s = p.last;
      more = p.more;
    }
    assert.equal(agentCount, P.CONVERSATION.keep);
  } finally {
    client.disconnect();
    await helper.close();
  }
});
