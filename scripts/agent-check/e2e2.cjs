// Replying to your agent, end to end in a real browser: the studio (the dev server) paired with
// the agent helper (`fledgetone mcp`, run from source) driven by the MCP SDK's own client, as an
// agent would. It checks, in order:
//
//   1. keys typed in the message box stay there: Space doesn't play, Delete doesn't delete the
//      selected clip, Ctrl+Z doesn't undo the song, letters don't reach the shortcuts; Shift+Enter
//      is a new line and sends nothing
//   2. Enter sends: the message shows as "You", the agent gets it from wait_for_changes and
//      get_messages, and it reads "Seen by your agent"
//   3. the agent's say with replyTo shows as a reply to it, after it, from the agent; the focus
//      stays where the musician left it
//   4. "Ask about this" on a card ties the next message to the suggestion (the agent gets its id)
//   5. the selection goes along only when "Include what I've selected" is ticked (for that message
//      only) and the agent may see the selection: never once that's switched off
//   6. at 360 px wide the panel fits (nothing in it scrolls sideways or goes past the edge, the box
//      and Send on screen)
//   1b. Ctrl/Cmd+S saves the song and Ctrl/Cmd+K searches from the box (Esc or Ctrl+K again gives
//      the focus back to the box; opened from the Help menu, back to its button); Esc while an input
//      method composes doesn't close the panel; text with nothing visible can't be sent
//   5b. "see" allowed again doesn't tick the box again; a message the helper never got, retried
//      after "see" is off, goes without the selection
//   7. sent with no agent connected: "Not sent — the agent isn't connected" with Retry; another
//      agent pairs: no Retry into that connection ("that connection ended", put it back in the box
//      after what's being written, and send it as a new message), and the earlier agent's messages keep its name under a line
//
// Needs the dev server on a port from 5960 to 5969 (PORT=5960 by default), Playwright's Chromium,
// and tools/cli's packages (npm install in tools/cli):
//
//   setsid nohup npx vite --port 5960 --strictPort > /tmp/vite.log 2>&1 &
//   node scripts/agent-check/e2e2.cjs            (SHOTS=dir saves screenshots there)
//
// Exit code 0 when every step passes.
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'tools', 'cli');
const SDK = path.join(CLI, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm');
const PORT = Number(process.env.PORT || 5960);
const APP = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS || null;

let failures = 0;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
};

async function until(check, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

(async () => {
  if (PORT < 5960 || PORT > 5969) throw new Error('PORT must be 5960 to 5969');
  const { Client } = await import(pathToFileURL(path.join(SDK, 'client', 'index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(path.join(SDK, 'client', 'stdio.js')).href);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fledgetone-e2e2-'));
  // An agent: its own helper, driven by the MCP SDK's client under `name`
  const startAgent = async (name) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', path.join(CLI, 'src', 'tsHook.mjs'), path.join(CLI, 'src', 'fledgetone.ts'), 'mcp', '--port', '0', '--root', work, '--allow-origin', APP.replace(/\/$/, '')],
      cwd: ROOT,
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (d) => process.env.VERBOSE && process.stderr.write(`[${name}] ${d}`));
    const client = new Client({ name, version: '1' });
    await client.connect(transport);
    const call = async (tool, args = {}) => {
      const r = await client.callTool({ name: tool, arguments: args });
      const text = r.content.map((c) => c.text).join('');
      if (r.isError) throw new Error(`${tool}: ${text}`);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    };
    return { client, call };
  };
  const first = await startAgent('E2E agent');
  const agents = [first.client];
  const call = first.call;
  // (say and suggest keep to one a second and one every 3 seconds)
  const patiently = async (name, args) => {
    for (;;) {
      try {
        return await call(name, args);
      } catch (e) {
        if (!/Too many/.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  };

  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
  try {
    await page.goto(APP, { waitUntil: 'networkidle' });
    const menu = async (item) => {
      await page.getByRole('menuitem', { name: 'View', exact: true }).first().click();
      await page.locator('[role^="menuitem"]', { hasText: item }).first().click();
    };
    const A = (fn, arg) => page.evaluate(fn, arg);

    await menu('Suggestions');
    await page.waitForFunction(() => window.__fledgetoneAgent?.conv, null, { timeout: 30000 });
    const ids = await A(() => {
      const tl = window.__fledgetoneAgent.tl.useTimelineStore;
      tl.getState().newProject('blank');
      const [drums, bass] = tl.getState().tracks.map((t) => t.id);
      const c = tl.getState().createEmptyClip(bass, 3, 2);
      tl.getState().addNotes(c, [{ note: 'C2', startOffset: 0, duration: '8n', velocity: 0.8 }]);
      return { drums, bass, c };
    });
    await page.getByLabel('Close the Suggestions panel').click();

    const pair = async (ticks, by = call) => {
      const { code, port } = await by('connect_studio');
      await menu('Let an agent connect…');
      await page.getByPlaceholder('K7QM-3XPD-9TBW').fill(code);
      await page.getByLabel('Port the helper listens on').fill(String(port));
      for (const name of ticks) await page.getByRole('checkbox', { name }).check();
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await until(async () => (await by('studio_status')).connected, 15000, 'pairing');
      if (await page.getByRole('button', { name: 'Done' }).count()) await page.getByRole('button', { name: 'Done' }).click();
      if (!(await page.locator('[data-agent-panel]').count())) await page.locator('[data-agent-chip]').click();
      await page.waitForSelector('[data-agent-panel]');
    };
    await pair([/^See what I select/, /^Suggest changes/]);

    const box = page.locator('[data-agent-compose] textarea');
    const own = page.locator('[data-own-message]');
    const lastOwn = () => own.last();
    const ownCount = () => own.count();
    let since = (await call('studio_status')).lastEvent;

    // 1. Keys in the box stay in the box. First an edit the song's Undo would take back, and a clip selected.
    const before = await A(([bass, c]) => {
      const tl = window.__fledgetoneAgent.tl.useTimelineStore;
      tl.getState().setTrackVolume(bass, -7);
      tl.getState().selectClip(c, false);
      const s = tl.getState();
      return { past: s.past.length, clips: s.clips.length, vol: s.tracks.find((t) => t.id === bass).volume };
    }, [ids.bass, ids.c]);
    await box.click();
    await page.keyboard.type('a b c mute solo ');
    await page.keyboard.press('Space');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Control+z');
    await page.keyboard.type('qwerty');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second line');
    await page.waitForTimeout(400);
    const during = await A((bass) => {
      const s = window.__fledgetoneAgent.tl.useTimelineStore.getState();
      return { past: s.past.length, clips: s.clips.length, vol: s.tracks.find((t) => t.id === bass).volume, playing: s.isPlaying || s.loadingToPlay, focus: document.activeElement?.tagName };
    }, ids.bass);
    const typed = await box.inputValue();
    step(
      '1 keys typed in the box stay there',
      !during.playing && during.past === before.past && during.clips === before.clips && during.vol === before.vol && during.focus === 'TEXTAREA' && /qwerty\nsecond line$/.test(typed) && (await ownCount()) === 0,
      `playing ${during.playing}, undo steps ${before.past} → ${during.past}, clips ${before.clips} → ${during.clips}, volume ${before.vol} → ${during.vol}, ${JSON.stringify(typed)}`
    );

    // 1b. Ctrl+S saves the song (never the page) and Ctrl+K searches, as everywhere; Esc while an
    // input method composes stays the method's; text with nothing visible can't be sent
    await A(() => {
      // (no real file picker in the check: Save says it couldn't, which is enough)
      window.showSaveFilePicker = () => Promise.reject(new DOMException('cancelled', 'AbortError'));
      window.__keysSeen = [];
      window.addEventListener('keydown', (e) => (e.ctrlKey || e.metaKey) && window.__keysSeen.push({ key: e.key, prevented: e.defaultPrevented }));
    });
    await box.focus();
    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+k');
    const palette = await page.locator('[role="dialog"]').filter({ has: page.locator('input') }).count();
    const keysSeen = await A(() => window.__keysSeen);
    await page.keyboard.press('Escape');
    // (the palette gives the focus back to the box it was opened from)
    await page.waitForTimeout(100);
    const inBox = () => A(() => !!document.activeElement?.matches('[data-agent-compose] textarea'));
    const backToBox = await inBox();
    // Ctrl+K again closes it: back to the box too
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(150);
    const backAfterToggle = await inBox();
    // Opened from the Help menu (its item gone once the menu closes): back to that menu's button
    await page.getByRole('menuitem', { name: 'Help', exact: true }).first().click();
    await page.locator('[role^="menuitem"]', { hasText: 'Search everything' }).first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const toMenu = await A(() => ({ role: document.activeElement?.getAttribute('role'), text: document.activeElement?.textContent?.trim() }));
    await box.focus();
    await A(() => document.querySelector('[data-agent-compose] textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true })));
    await page.waitForTimeout(100);
    const openAfterIme = await page.locator('[data-agent-panel]').count();
    const keepDraft = await box.inputValue();
    await box.fill('\u200b\u200d \u200e ');
    const invisibleOff = await page.getByRole('button', { name: 'Send', exact: true }).isDisabled();
    await box.fill(keepDraft);
    step(
      '1b Ctrl+S saves the song, Ctrl+K searches; Esc while composing keeps the panel; nothing visible, no Send',
      keysSeen.some((k) => k.key === 's' && k.prevented) && keysSeen.some((k) => k.key === 'k' && k.prevented) && palette > 0 && backToBox && backAfterToggle && toMenu.role === 'menuitem' && toMenu.text === 'Help' && openAfterIme === 1 && invisibleOff && (await ownCount()) === 0,
      `${JSON.stringify(keysSeen)}, palette ${palette} (focus back to the box ${backToBox}, after Ctrl+K again ${backAfterToggle}, from the Help menu to ${JSON.stringify(toMenu)}), panel open ${openAfterIme}, Send off for invisible text ${invisibleOff}`
    );

    // 2. Enter sends it
    await box.fill('Is the bass too busy in bar 3?\nI want it simpler.');
    await page.keyboard.press('Enter');
    await lastOwn().waitFor({ timeout: 5000 });
    const ownText = await lastOwn().textContent();
    const sentId = await lastOwn().getAttribute('data-own-message');
    const sentStatus = await until(async () => {
      const d = await lastOwn().getAttribute('data-delivery');
      return d !== 'sending' && d;
    }, 6000, 'the helper to have it');
    const waited = await call('wait_for_changes', { since, timeoutSeconds: 5 });
    since = waited.last;
    const got = waited.events.find((e) => e.event === 'user_message' && e.params.id === sentId);
    await until(async () => (await lastOwn().getAttribute('data-delivery')) === 'seen', 5000, 'seen');
    const seenWords = await lastOwn().locator('[data-delivery-words]').textContent();
    const conv = await call('get_messages');
    const inConv = conv.messages.find((m) => m.id === sentId);
    step(
      '2 Enter sends: shown as You, the agent gets it, seen',
      /^You/.test(ownText) && sentStatus !== 'not_sent' && got?.params.text === 'Is the bass too busy in bar 3?\nI want it simpler.' && !got.params.context && !got.params.suggestionId && inConv?.from === 'musician' && seenWords === 'Seen by your agent' && (await box.inputValue()) === '',
      `delivery ${sentStatus} then ${seenWords}; get_messages ${conv.messages.length}`
    );

    // 3. The agent's reply, shown as one, after the message; the focus stays put
    await page.locator('[data-agent-panel] h2').click();
    await box.focus();
    await patiently('say', { text: 'A little: the notes in bar 3 crowd the kick. Shall I suggest a simpler line?', replyTo: sentId });
    const reply = page.locator(`[data-agent-message][data-reply-to="${sentId}"]`);
    await reply.waitFor({ timeout: 5000 });
    const replyText = await reply.textContent();
    const order = await A(([sid]) => {
      const all = [...document.querySelectorAll('[data-agent-conversation] > figure')];
      return { mine: all.findIndex((f) => f.dataset.ownMessage === sid), reply: all.findIndex((f) => f.dataset.replyTo === sid), focus: document.activeElement?.tagName };
    }, [sentId]);
    const badReply = await call('say', { text: 'x', replyTo: 'u-nope' }).then(() => 'accepted', (e) => e.message);
    step(
      '3 say with replyTo shows as a reply, after it; the focus stays',
      /From your agentE2E agent“E2E agent”/.test(replyText) && /Replying to you: “Is the bass too busy/.test(replyText) && order.reply > order.mine && order.focus === 'TEXTAREA' && /replyTo/.test(badReply),
      JSON.stringify(order)
    );

    // 4. Ask about this
    const made = await patiently('suggest', { title: 'A simpler bass in bar 3', explanation: 'Fewer notes, so the kick comes through.', ops: [{ op: 'set_track', trackId: ids.bass, volumeDb: -9 }] });
    const card = page.locator(`[data-suggestion="${made.id}"]`);
    await card.waitFor({ timeout: 5000 });
    await card.locator(`[data-ask-about="${made.id}"]`).click();
    await page.waitForTimeout(100);
    const askFocus = await A(() => document.activeElement?.matches('[data-agent-compose] textarea'));
    const chip = await page.locator(`[data-asking-about="${made.id}"]`).textContent();
    await page.keyboard.type('Why lower it rather than take notes out?');
    await page.keyboard.press('Enter');
    await until(async () => (await ownCount()) === 2, 5000, 'the second message');
    const asked = await call('wait_for_changes', { since, timeoutSeconds: 5 });
    since = asked.last;
    const askedEv = asked.events.find((e) => e.event === 'user_message');
    const shownAbout = await lastOwn().textContent();
    step(
      '4 Ask about this: the agent gets the suggestion id',
      askFocus && /Asking about “A simpler bass in bar 3”/.test(chip) && askedEv?.params.suggestionId === made.id && /About the suggestion “A simpler bass/.test(shownAbout) && (await page.locator('[data-asking-about]').count()) === 0,
      `focus in the box ${askFocus}, id ${askedEv?.params.suggestionId}`
    );
    if (SHOTS) {
      await page.locator('[data-agent-panel]').screenshot({ path: path.join(SHOTS, 'conversation-1280.png') });
      await page.screenshot({ path: path.join(SHOTS, 'studio-1280.png') });
    }

    // 5. The selection goes along only when ticked, for that message only, and only while the agent may see it
    const include = page.getByRole('checkbox', { name: /Include what I’ve selected/ });
    const sendText = async (t) => {
      await box.fill(t);
      await page.keyboard.press('Enter');
      // (other events may come first: wait until the message is among them)
      const end = Date.now() + 8000;
      for (;;) {
        const w = await call('wait_for_changes', { since, timeoutSeconds: 3 });
        since = w.last ?? since;
        const m = w.events.find((e) => e.event === 'user_message')?.params;
        if (m || Date.now() > end) return m;
      }
    };
    const plain = await sendText('Without my selection');
    await include.check();
    const withSel = await sendText('With my selection');
    const afterTick = await include.isChecked();
    await page.locator('[data-agent-panel]').getByRole('button', { name: 'Change' }).click();
    await page.getByRole('checkbox', { name: /^See what I select/ }).uncheck();
    await page.getByRole('button', { name: 'Done' }).click();
    await until(async () => !(await call('studio_status')).permissions.see, 5000, 'the permission off');
    const disabled = await include.isDisabled();
    // (even with the box ticked behind the scenes, nothing of the selection goes)
    await A(() => window.__fledgetoneAgent.conv.useConversation.setState({ include: true }));
    const notPermitted = await sendText('Not allowed to see');
    const shownContext = await own.nth(3).textContent();
    step(
      '5 the selection only when ticked and allowed',
      !!plain && !plain.context && withSel?.context?.selectedClipIds?.includes(ids.c) && withSel.context.bars?.fromBar === 3 && !afterTick && disabled && !!notPermitted && !notPermitted.context && /With your selection: 1 selected clip, bars 3-4/.test(shownContext),
      `plain ${JSON.stringify(plain?.context)}, ticked ${JSON.stringify(withSel?.context)}, unticked after ${!afterTick}, off ${disabled} ${JSON.stringify(notPermitted?.context)}`
    );

    // 5b. "See" allowed again: the box isn't ticked again by itself. A message the helper never got
    // (dropped on its way), retried after "see" is switched off: it goes without the selection
    const allowSee = async (on) => {
      await page.locator('[data-agent-panel]').getByRole('button', { name: 'Change' }).click();
      await page.getByRole('checkbox', { name: /^See what I select/ }).setChecked(on);
      await page.getByRole('button', { name: 'Done' }).click();
      await until(async () => (await call('studio_status')).permissions.see === on, 5000, `"see" ${on ? 'on' : 'off'}`);
    };
    await allowSee(true);
    const reticked = await include.isChecked();
    await A(() => {
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (d) {
        if (window.__dropMessages && typeof d === 'string' && d.includes('"user_message"')) return;
        return send.call(this, d);
      };
      window.__dropMessages = true;
    });
    await include.check();
    await box.fill('With my selection, lost on the way');
    await page.keyboard.press('Enter');
    const dropped = lastOwn();
    const droppedId = await dropped.getAttribute('data-own-message');
    await until(async () => (await dropped.getAttribute('data-delivery')) === 'not_sent', 8000, 'no answer from the helper');
    const noAnswer = await dropped.locator('[data-delivery-words]').textContent();
    await allowSee(false);
    await A(() => (window.__dropMessages = false));
    since = (await call('studio_status')).lastEvent;
    await dropped.locator('[data-retry]').click();
    const retriedEv = (await call('wait_for_changes', { since, timeoutSeconds: 5 })).events.find((e) => e.event === 'user_message' && e.params.id === droppedId);
    since = (await call('studio_status')).lastEvent;
    const droppedShown = await dropped.textContent();
    step(
      '5b allowed again: not ticked again; a retry after "see" is off goes without the selection',
      !reticked && /didn’t answer/.test(noAnswer) && !!retriedEv && !retriedEv.params.context && !/With your selection/.test(droppedShown),
      `ticked again ${reticked}; ${noAnswer}; retried ${JSON.stringify(retriedEv?.params)}`
    );

    // 6. At 360 px
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(300);
    await page.locator('[data-agent-panel] [data-agent-conversation]').evaluate((el) => el.closest('.overflow-y-auto').scrollTo(0, 1e6));
    const narrow = await A(() => {
      const panel = document.querySelector('[data-agent-panel]').getBoundingClientRect();
      const send = [...document.querySelectorAll('[data-agent-compose] button')].find((b) => b.textContent.includes('Send')).getBoundingClientRect();
      const ta = document.querySelector('[data-agent-compose] textarea').getBoundingClientRect();
      const wide = [...document.querySelectorAll('[data-agent-panel] *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5).length;
      // (nothing in the panel scrolls sideways; the studio under it is the studio's business)
      const scrollers = [document.querySelector('[data-agent-panel]'), ...document.querySelectorAll('[data-agent-panel] .overflow-y-auto, [data-agent-compose]')];
      return { sideways: scrollers.some((e) => e.scrollWidth > e.clientWidth + 1), panel: Math.round(panel.width), send: send.right <= window.innerWidth && send.bottom <= window.innerHeight, box: ta.bottom <= window.innerHeight && ta.width > 250, wide };
    });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'conversation-360.png') });
    step('6 at 360 px the panel fits', !narrow.sideways && narrow.panel === 360 && narrow.send && narrow.box && narrow.wide === 0, JSON.stringify(narrow));
    await page.setViewportSize({ width: 1280, height: 800 });

    // 7. Not connected: Not sent, with Retry. Then another agent pairs: the message can't be
    // retried into that connection (put back in the box instead, sent as a new message only when
    // the musician sends it), and the earlier agent's messages keep its name under a line
    await page.locator('[data-agent-panel]').getByRole('button', { name: 'Disconnect' }).click();
    await until(async () => !(await call('studio_status')).connected, 5000, 'the disconnect');
    await box.fill('Are you still there?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const lost = lastOwn();
    const lostId = await lost.getAttribute('data-own-message');
    const lostWords = await lost.locator('[data-delivery-words]').textContent();
    const retryShown = await lost.locator('[data-retry]').isVisible();
    const focusAfterSend = await A(() => document.activeElement?.matches('[data-agent-compose] textarea'));
    if (SHOTS) await page.locator('[data-agent-panel]').screenshot({ path: path.join(SHOTS, 'conversation-not-sent-1280.png') });
    step('7 not connected: Not sent, with Retry', lostWords === 'Not sent — the agent isn’t connected' && retryShown && focusAfterSend, lostWords);

    const second = await startAgent('Second agent');
    agents.push(second.client);
    await pair([], second.call);
    await page.waitForTimeout(1500);
    const ended = {
      status: await lost.getAttribute('data-delivery'),
      words: await lost.locator('[data-delivery-words]').textContent(),
      retry: await lost.locator('[data-retry]').count(),
      putBack: await lost.locator('[data-put-back]').count(),
    };
    const helperB = await second.call('get_messages');
    const quietB = await second.call('wait_for_changes', { since: 0, timeoutSeconds: 1 });
    const oldLabel = await page.locator(`[data-agent-message][data-reply-to="${sentId}"] figcaption`).textContent();
    // (what the musician is writing stays: the old words come after it)
    await box.fill('First, a new question');
    await lost.locator('[data-put-back]').click();
    // (the box takes the focus, with the words in it: nothing is sent until Enter)
    await page.waitForFunction(() => document.activeElement?.matches('[data-agent-compose] textarea'), null, { timeout: 3000 });
    const putBack = await box.inputValue();
    const caretAtEnd = await box.evaluate((el) => el.selectionStart === el.value.length && el.selectionEnd === el.value.length);
    const sinceB = (await second.call('studio_status')).lastEvent;
    await page.keyboard.press('Enter');
    // (other events may come first: wait until the message is among them)
    const resent = await until(async () => (await second.call('wait_for_changes', { since: sinceB, timeoutSeconds: 2 })).events.find((e) => e.event === 'user_message'), 8000, 'the message sent anew');
    const lines = await page.locator('[data-connection-line]').allTextContents();
    step(
      '7b another pairing: no Retry into it, put back and sent anew; names and a line for the earlier connection',
      ended.status === 'not_sent' && ended.words === 'Not sent — that connection ended' && ended.retry === 0 && ended.putBack === 1 && helperB.messages.length === 0 && !quietB.events.some((e) => e.event === 'user_message') &&
        /E2E agent/.test(oldLabel) && lines.some((l) => /Earlier, with your agentE2E agent“E2E agent”/i.test(l)) && lines.some((l) => /This connection: your agentSecond agent“Second agent”/i.test(l)) &&
        putBack === 'First, a new question\n\nAre you still there?' && caretAtEnd && resent?.params.text === putBack && resent.params.id !== lostId && !resent.params.context,
      `${JSON.stringify(ended)}; helper B had ${helperB.messages.length}; old label ${oldLabel}; lines ${JSON.stringify(lines)}; sent anew ${resent?.params.id}`
    );
    if (SHOTS) await page.locator('[data-agent-panel]').screenshot({ path: path.join(SHOTS, 'conversation-new-connection-1280.png') });
    step('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (err) {
    failures++;
    console.log(`FAIL ${err.message}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'failure2.png') }).catch(() => {});
  } finally {
    await browser.close();
    for (const a of agents) await a.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
