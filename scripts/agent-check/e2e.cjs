// The agent connection end to end, in a real browser: the studio (the dev server) paired with the
// agent helper (`fledgetone mcp`, run from source) driven by the MCP SDK's own client, as an agent
// would. It checks, in order:
//
//   1. pairing by the code the helper gives, typed in "Let an agent connect…" (pasted with a label,
//      a wrong code first): the helper gets the permission boxes as ticked at the retry
//   2. get_song lists the very tracks and clips the studio has
//   3. a suggestion (+notes, a track up 9 dB) shows as a card from the agent with its caution, and
//      its tracks and bars are tinted on the lanes (not over the headers or the ruler)
//   4. its before-and-after's own renders differ where it changes things and match before that
//   5. hearing it changes nothing: no undo step, no autosave (past the autosave's timer)
//   6. Accept is one undo step, the song then exactly the ops applied to the song as it was, and the
//      agent hears "accepted" and nothing before it
//   7. Ctrl+Z puts the song back exactly, and the suggestion is undone (the agent hears); Ctrl+Y
//   8. a suggestion whose clip is edited meanwhile goes out of date (Accept off, the focus kept on
//      it), and the agent hears so; the clip put back, it waits again; withdrawn under the focus,
//      the focus goes to its card; one being heard stops; one heard before the swing changed is
//      heard again before Accept
//   9. listen gives a finite loudness and true peak; the agent takes no focus and opens no panel;
//      a new card goes at the end, ignores presses for a second, and Space presses its buttons when
//      reached from the keyboard
//  10. point_at rings a track (said in the live region); another song opened: the suggestion can't
//      go in, and stops being heard
//  11. closing the tab disconnects
//  12. the agent's chunk failing to load leaves the studio up (the panel's space given back), with
//      a note on top and Reload
//
// Along the way (0, 7b, 8a, 9a, 9d-9i, 10c-10f): focus goes back somewhere sensible when the panel
// closes; the old values put back by hand aren't an undo; no listening while the song plays, and
// held notes are heard; a suggestion not heard needs a separate second press ("Accept without
// listening": never a double-click, never Space, gone after 5 seconds); point_at can't reach the
// panel; quick switches keep playing; the live region says agents' words short and at most one
// every few seconds; messages never move the cards and are marked new; an assistive tool's press
// counts and focus goes on after it; a second tab is told another is connected; a new pairing
// starts from reading only (after Disconnect in the Change dialog too), and sees none of the
// suggestions of the pairing before.
//
// Needs the dev server on a port from 5960 to 5969 (PORT=5960 by default), Playwright's Chromium,
// and tools/cli's packages (npm install in tools/cli):
//
//   setsid nohup npx vite --port 5960 --strictPort > /tmp/vite.log 2>&1 &
//   node scripts/agent-check/e2e.cjs            (SHOTS=dir saves screenshots there)
//
// It writes no audio files. Exit code 0 when every step passes.
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
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fledgetone-e2e-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', path.join(CLI, 'src', 'tsHook.mjs'), path.join(CLI, 'src', 'fledgetone.ts'), 'mcp', '--port', '0', '--root', work, '--allow-origin', APP.replace(/\/$/, '')],
    cwd: ROOT,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (d) => process.env.VERBOSE && process.stderr.write(`[helper] ${d}`));
  const agent = new Client({ name: 'E2E agent', version: '1' });
  await agent.connect(transport);
  const call = async (name, args = {}) => {
    const r = await agent.callTool({ name, arguments: args });
    const text = r.content.map((c) => c.text).join('');
    if (r.isError) throw new Error(`${name}: ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
  try {
    await page.goto(APP, { waitUntil: 'networkidle' });
    const menu = async (item) => {
      await page.getByRole('menuitem', { name: 'View', exact: true }).first().click();
      // (a checked item is a menuitemcheckbox)
      await page.locator('[role^="menuitem"]', { hasText: item }).first().click();
    };

    // The agent code loads with the panel; then a song of synthesized instruments (nothing to download)
    await menu('Suggestions');
    await page.waitForFunction(() => window.__fledgetoneAgent, null, { timeout: 30000 });
    const ids = await page.evaluate(() => {
      const tl = window.__fledgetoneAgent.tl.useTimelineStore.getState();
      tl.newProject('blank');
      const s = window.__fledgetoneAgent.tl.useTimelineStore.getState();
      const [drums, bass, clav, brass] = s.tracks.map((t) => t.id);
      const clip = (track, at, len, notes) => {
        const id = window.__fledgetoneAgent.tl.useTimelineStore.getState().createEmptyClip(track, at, len);
        window.__fledgetoneAgent.tl.useTimelineStore.getState().addNotes(id, notes);
        return id;
      };
      const steps = (n, note, every, len) => Array.from({ length: n }, (_, i) => ({ note, startOffset: i * every, duration: len, velocity: 0.8 }));
      // (hats on every sixteenth: the swing moves some of them)
      const d = clip(drums, 1, 12, [...steps(48, 'C1', 0.25, '16n'), ...steps(24, 'D1', 0.5, '16n').map((n) => ({ ...n, startOffset: n.startOffset + 0.25 })), ...steps(192, 'F#1', 0.0625, '32n')]);
      const b = clip(bass, 1, 12, steps(24, 'C2', 0.5, '8n'));
      const c = clip(clav, 1, 8, steps(16, 'E4', 0.5, '8n'));
      const r = clip(brass, 9, 4, steps(8, 'G4', 0.5, '8n'));
      window.__fledgetoneAgent.tl.useTimelineStore.getState().setTrackVolume(brass, -12);
      return { drums, bass, clav, brass, d, b, c, r };
    });
    await page.getByLabel('Close the Suggestions panel').click();
    // (opened from the View menu, with no Suggestions button in the header yet: focus goes to the View menu's button)
    await page.waitForTimeout(100);
    const back = await page.evaluate(() => ({ role: document.activeElement?.getAttribute('role'), text: document.activeElement?.textContent?.trim() }));
    step('0 closing the panel gives focus back somewhere sensible', back.role === 'menuitem' && back.text === 'View', JSON.stringify(back));

    const A = (fn, arg) => page.evaluate(fn, arg);
    const sgOf = (sid) => A((x) => window.__fledgetoneAgent.sg.useSuggestions.getState().suggestions.find((s) => s.id === x), sid);
    const statusIs = (sid, status, ms = 5000) => page.waitForFunction(([x, st]) => window.__fledgetoneAgent.sg.useSuggestions.getState().suggestions.find((s) => s.id === x)?.status === st, [sid, status], { timeout: ms });
    const pastLen = () => A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().past.length);
    // A suggestion, waiting out the agent's limit of one every 3 seconds
    const suggest = async (args) => {
      for (;;) {
        try {
          return await call('suggest', args);
        } catch (e) {
          if (!/Too many suggest/.test(e.message)) throw e;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    };
    // A new card ignores presses for a second (it may have slid under the pointer)
    const settle = () => page.waitForTimeout(1100);
    // A button on a card brought into the list's view as the musician would, by the wheel over the
    // list (a scroll made any other way, as Playwright's own before a click, moves the cards
    // under the pointer, and a press then is ignored), then a moment for it to settle
    const wheelInto = async (button) => {
      const list = page.locator('[data-agent-panel] .overflow-y-auto').first();
      let wheeled = false;
      for (let i = 0; i < 40; i++) {
        const off = await button.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const l = el.closest('.overflow-y-auto').getBoundingClientRect();
          return r.top < l.top + 4 ? r.top - l.top - 40 : r.bottom > l.bottom - 4 ? r.bottom - l.bottom + 40 : 0;
        });
        if (!off) break;
        const box = await list.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 120));
        await page.mouse.wheel(0, Math.max(-300, Math.min(300, off)));
        await page.waitForTimeout(80);
        wheeled = true;
      }
      if (wheeled) await settle();
    };
    const hear = async (sid) => {
      await page.locator(`[data-suggestion="${sid}"] [data-hear="suggested"]`).click();
      await page.waitForFunction((x) => {
        const a = window.__fledgetoneAgent.audition.useAudition.getState();
        return (a.key === x && a.phase === 'playing') || a.error;
      }, sid, { timeout: 120000 });
      const st = await A(() => window.__fledgetoneAgent.audition.useAudition.getState());
      if (st.error) throw new Error(`the before-and-after didn't play: ${st.error}`);
      // (once it plays, that version counts as heard)
      await page.waitForFunction((x) => {
        const s = window.__fledgetoneAgent.sg.useSuggestions.getState().suggestions.find((y) => y.id === x);
        return s.heard === s.version;
      }, sid, { timeout: 2000 });
    };
    // The song as the store has it, what Accept puts in and Undo takes out
    const strip = (p) => JSON.stringify({ tracks: p.tracks, clips: p.clips.map(({ isSelected: _isSelected, ...c }) => c), bpm: p.bpm, tempoPoints: p.tempoPoints, markers: p.markers, master: p.master });
    const events = async (since, ms = 3) => call('wait_for_changes', { since, timeoutSeconds: ms });

    // 1. Pairing: a wrong code first, then the right one with the boxes changed in between (what's
    // ticked at the second try is what the agent gets)
    const { code, port } = await call('connect_studio');
    const wrong = code.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
    await menu('Let an agent connect…');
    await page.getByPlaceholder('K7QM-3XPD-9TBW').fill(`Code: ${wrong}`);
    const typed = await page.getByPlaceholder('K7QM-3XPD-9TBW').inputValue();
    await page.getByLabel('Port the helper listens on').fill('');
    const offWithoutPort = await page.getByRole('button', { name: 'Connect' }).isDisabled();
    await page.getByLabel('Port the helper listens on').fill(String(port));
    for (const name of [/^See what I select/, /^Suggest changes/, /^Listen/]) await page.getByRole('checkbox', { name }).check();
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 15000 });
    await page.getByRole('checkbox', { name: /^See what I select/ }).uncheck();
    await page.getByPlaceholder('K7QM-3XPD-9TBW').fill(code);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'connect-dialog.png') });
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.waitForSelector('[data-agent-chip]', { timeout: 15000 });
    const status = await call('studio_status');
    step('1 pairing (a wrong code, then the right one)', status.connected === true && typed === wrong && offWithoutPort, `label dropped from the pasted code, Connect off without a port`);
    step('1b the boxes as ticked at the retry', status.permissions.see === false && status.permissions.suggest && status.permissions.listen, JSON.stringify(status.permissions));
    await page.waitForSelector('[data-agent-panel]');

    // 2. get_song matches the studio
    const song = await call('get_song');
    const here = await A(() => {
      const p = window.__fledgetoneAgent.tl.currentProject();
      return { tracks: p.tracks.map((t) => t.id), clips: p.clips.map((c) => c.id) };
    });
    step('2 get_song ids', JSON.stringify(song.tracks.map((t) => t.id)) === JSON.stringify(here.tracks) && JSON.stringify(song.clips.map((c) => c.id)) === JSON.stringify(here.clips), `${here.tracks.length} tracks, ${here.clips.length} clips`);

    // 3. A suggestion: two notes in the brass clip and the brass up 9 dB
    let since = (await call('studio_status')).lastEvent;
    const firstOps = [
      { op: 'set_track', trackId: ids.brass, volumeDb: -3 },
      { op: 'add_notes', clipId: ids.r, notes: [{ pitch: 'B4', start: 1.25, length: 0.25 }, { pitch: 'D5', start: 1.5, length: 0.5 }] },
    ];
    // (heard from bar 7: two bars before the brass comes in, which must sound the same in both)
    const made = await suggest({ title: 'An answer in the brass', explanation: 'Two notes answer the bass in bar 10, and the brass comes up so they are heard.', ops: firstOps, focus: { fromBar: 7, toBar: 11 } });
    const card = page.locator(`[data-suggestion="${made.id}"]`);
    await card.waitFor({ timeout: 10000 });
    const cardText = await card.textContent();
    await card.hover();
    const tinted = await until(() => page.locator('[data-agent-highlight] > div').count(), 3000, 'the tint');
    // The tint stays on the lanes: never over the track headers or the ruler
    const overHeaders = await A(() => {
      const ruler = document.querySelector('[data-timeline-ruler]').getBoundingClientRect();
      const corner = document.querySelector('[data-timeline-ruler]').firstElementChild.getBoundingClientRect();
      return [...document.querySelectorAll('[data-agent-highlight] > div')].filter((d) => {
        const r = d.getBoundingClientRect();
        return r.left < corner.right - 0.5 || r.top < ruler.bottom - 0.5;
      }).length;
    });
    // (the names an agent may have written are chips of their own, quoted for screen readers)
    const chips = await card.locator('[data-name-chip]').allTextContents();
    step('3 card, caution and tint', /goes up by 9 dB/.test(cardText) && /Turns “Brass Stabs” up by 9 dB/.test(cardText) && chips.includes('“E2E agent”') && chips.includes('“Brass Stabs”') && tinted > 0 && overHeaders === 0, `${tinted} tinted boxes, ${overHeaders} over the headers or ruler, chips ${JSON.stringify(chips)}`);
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, 'panel-and-highlight.png') });
      await card.screenshot({ path: path.join(SHOTS, 'card.png') });
    }

    // 4 and 5. The before-and-after: its own A and B differ where the suggestion changes things and
    // match before that; and hearing it changes nothing (waiting past the autosave's timer)
    const before = await A(() => ({ autosave: localStorage.getItem('bos-beat-box.autosave.v1'), past: window.__fledgetoneAgent.tl.useTimelineStore.getState().past.length }));
    await settle();
    await hear(made.id);
    await page.locator(`[data-suggestion="${made.id}"] [data-hear="now"]`).click();
    await page.waitForTimeout(300);
    const ab = await A(() => {
      const X = window.__fledgetoneAgent;
      const { a, b } = X.audition.auditionBuffers();
      const st = X.audition.useAudition.getState();
      const bpm = X.tl.useTimelineStore.getState().bpm;
      // The brass clip starts at bar 9: before it, A and B are the same (up to the limiter's look-ahead)
      const quiet = Math.floor(((9 - st.bars[0]) * 240 * a.sampleRate) / bpm - a.sampleRate * 0.05);
      const diff = (from, to) => {
        let m = 0;
        for (let c = 0; c < Math.min(a.numberOfChannels, b.numberOfChannels); c++) {
          const p = a.getChannelData(c);
          const q = b.getChannelData(c);
          for (let i = from; i < Math.min(to, p.length, q.length); i++) m = Math.max(m, Math.abs(p[i] - q[i]));
        }
        return m;
      };
      return { inside: diff(Math.max(0, quiet), a.length), outside: diff(0, quiet), quiet, bars: st.bars, hearing: st.hearing };
    });
    step('4 before and after (its own renders)', ab.quiet > 0 && ab.inside > 1e-3 && ab.outside < 1e-6, `bars ${ab.bars.join('-')}: after bar 9 ${ab.inside.toFixed(4)}, before ${ab.outside}`);
    await page.waitForTimeout(1500);
    const during = await A(() => ({ autosave: localStorage.getItem('bos-beat-box.autosave.v1'), past: window.__fledgetoneAgent.tl.useTimelineStore.getState().past.length }));
    step('5 hearing changes nothing', during.autosave === before.autosave && during.past === before.past, `undo steps ${before.past} → ${during.past}, autosave the same 1.5 s on`);

    // 6. Accept: one undo step, the song exactly the ops applied to the song as it was (an
    // independent applyOps, master and tempo too), and the agent hears "accepted" with nothing before it
    const prior = await A(() => window.__fledgetoneAgent.tl.currentProject());
    const expected = await A(([ops, sid]) => {
      const X = window.__fledgetoneAgent;
      const s = X.sg.useSuggestions.getState().suggestions.find((x) => x.id === sid);
      return X.ops.applyOps(X.tl.currentProject(), { opsVersion: 1, ops }, { idBase: s.idBase }).song;
    }, [firstOps, made.id]);
    await card.locator('[data-accept]').click();
    const after = await A((sid) => {
      const X = window.__fledgetoneAgent;
      const s = X.sg.useSuggestions.getState().suggestions.find((x) => x.id === sid);
      return { now: X.tl.currentProject(), status: s.status, past: X.tl.useTimelineStore.getState().past.length };
    }, made.id);
    await page.waitForTimeout(800);
    const told = await events(since);
    since = told.last;
    const order = told.events.filter((e) => e.event === 'suggestion' && e.params.id === made.id).map((e) => e.params.status);
    step('6 accept: one undo step, the song as applied', after.status === 'accepted' && after.past === before.past + 1 && strip(after.now) === strip(expected), `undo steps ${before.past} → ${after.past}`);
    step('6b the agent hears "accepted" only', JSON.stringify(order) === '["accepted"]', order.join(', '));

    // 7. Undo, and the suggestion says so (and the agent hears); Redo puts it back
    await page.locator('body').click({ position: { x: 5, y: 880 } });
    await page.keyboard.press('Control+z');
    const undone = await A(() => window.__fledgetoneAgent.tl.currentProject());
    await statusIs(made.id, 'undone');
    const toldUndo = await events(since);
    since = toldUndo.last;
    await page.keyboard.press('Control+y');
    await statusIs(made.id, 'accepted');
    step('7 Ctrl+Z restores exactly, the card says undone, Ctrl+Y accepted', strip(undone) === strip(prior) && toldUndo.events.some((e) => e.event === 'suggestion' && e.params.id === made.id && e.params.status === 'undone'));
    // Putting the old level back by hand isn't an undo of the suggestion
    await A((brass) => window.__fledgetoneAgent.tl.useTimelineStore.getState().setTrackVolume(brass, -12), ids.brass);
    await page.waitForTimeout(500);
    const byHand = (await sgOf(made.id)).status;
    await A((brass) => window.__fledgetoneAgent.tl.useTimelineStore.getState().setTrackVolume(brass, -3), ids.brass);
    step('7b the old values back by hand: still accepted', byHand === 'accepted', byHand);

    // 8. Out of date
    const second = await suggest({ title: 'Busier bass', explanation: 'A pickup into bar 5.', ops: [{ op: 'add_notes', clipId: ids.b, notes: [{ pitch: 'G2', start: 3.75, length: 0.25 }] }] });
    await page.locator(`[data-suggestion="${second.id}"]`).waitFor();
    const accept2 = page.locator(`[data-suggestion="${second.id}"] [data-accept]`);
    // (the keyboard on its Accept as it goes out of date: the focus stays there)
    await accept2.focus();
    await A(() => (window.__clipsBefore = window.__fledgetoneAgent.tl.useTimelineStore.getState().clips));
    await A((clipId) => window.__fledgetoneAgent.tl.useTimelineStore.getState().addNotes(clipId, [{ note: 'C3', startOffset: 2.25, duration: '16n', velocity: 0.7 }]), ids.b);
    await statusIs(second.id, 'out_of_date');
    const disabled = (await accept2.getAttribute('aria-disabled')) === 'true';
    const focusKept = await A((sid) => document.activeElement?.getAttribute('data-accept') === sid, second.id);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const pressedOff = (await sgOf(second.id)).status;
    const heard = await events(since, 5);
    since = heard.last;
    step(
      '8 out of date',
      disabled && focusKept && pressedOff === 'out_of_date' && heard.events.some((e) => e.event === 'suggestion' && e.params.id === second.id && e.params.status === 'out_of_date'),
      `Accept is off (focus kept on it: ${focusKept}, a press does nothing: ${pressedOff}), the agent was told`
    );
    // 8a. What it changes put back as it was: it waits again (the agent hears); then the agent
    // withdraws it with the keyboard on its Dismiss: the focus goes to the card, not the page
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.setState({ clips: window.__clipsBefore }));
    const putBack = await statusIs(second.id, 'waiting').then(
      () => 'waiting',
      async () => (await sgOf(second.id)).status
    );
    const heardBack = await events(since, 5);
    since = heardBack.last;
    await page.locator(`[data-suggestion="${second.id}"] [data-dismiss]`).focus();
    await call('withdraw_suggestion', { id: second.id });
    await statusIs(second.id, 'withdrawn');
    await page.waitForTimeout(200);
    const focusAfterWithdraw = await A(() => (document.activeElement?.getAttribute('data-suggestion') ?? document.activeElement?.tagName) || 'none');
    step(
      '8a put back: it waits again; withdrawn under the focus: the focus on its card',
      putBack === 'waiting' && heardBack.events.some((e) => e.event === 'suggestion' && e.params.id === second.id && e.params.status === 'waiting') && focusAfterWithdraw === second.id,
      `${putBack}, focus on ${focusAfterWithdraw}`
    );

    // 8b. Out of date while it's being heard: the before-and-after stops
    const third = await suggest({ title: 'Clav lower', explanation: '', ops: [{ op: 'transpose_notes', clipId: ids.c, semitones: -12 }] });
    await page.locator(`[data-suggestion="${third.id}"]`).waitFor();
    await hear(third.id);
    await A((clipId) => window.__fledgetoneAgent.tl.useTimelineStore.getState().addNotes(clipId, [{ note: 'G4', startOffset: 0.25, duration: '16n', velocity: 0.7 }]), ids.c);
    await statusIs(third.id, 'out_of_date');
    await page.waitForTimeout(200);
    const stopped = await A(() => window.__fledgetoneAgent.audition.useAudition.getState().phase);
    step('8b out of date while heard: it stops', stopped === 'idle', `phase ${stopped}`);

    // 8c. The swing changes after it was heard: Accept asks to hear it again (nothing goes in), a
    // second hearing renders it again with the swing, and then Accept puts in what was heard
    const bassOps = [{ op: 'set_track', trackId: ids.bass, volumeDb: -2 }];
    const fourth = await suggest({ title: 'Bass a touch down', explanation: '', ops: bassOps });
    await page.locator(`[data-suggestion="${fourth.id}"]`).waitFor();
    await settle();
    await hear(fourth.id);
    await A(() => (window.__firstB = window.__fledgetoneAgent.audition.auditionBuffers().b));
    await A(() => window.__fledgetoneAgent.audition.stopAudition());
    const heard1 = (await sgOf(fourth.id)).heard;
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().setSwing(0.45));
    await statusIs(fourth.id, 'changed');
    const pastSwing = await pastLen();
    await settle();
    await page.locator(`[data-suggestion="${fourth.id}"] [data-accept]`).click();
    const refused = { past: await pastLen(), s: await sgOf(fourth.id), text: await page.locator(`[data-suggestion="${fourth.id}"] [data-card-status]`).textContent() };
    await hear(fourth.id);
    const moved = await A(() => {
      const [p, q] = [window.__firstB.getChannelData(0), window.__fledgetoneAgent.audition.auditionBuffers().b.getChannelData(0)];
      let m = 0;
      for (let i = 0; i < Math.min(p.length, q.length); i++) m = Math.max(m, Math.abs(p[i] - q[i]));
      return m;
    });
    const s4 = await sgOf(fourth.id);
    const expect4 = await A(([ops, base]) => window.__fledgetoneAgent.ops.applyOps(window.__fledgetoneAgent.tl.currentProject(), { opsVersion: 1, ops }, { idBase: base }).song, [bassOps, s4.idBase]);
    await page.locator(`[data-suggestion="${fourth.id}"] [data-accept]`).click();
    const accepted4 = { s: await sgOf(fourth.id), now: await A(() => window.__fledgetoneAgent.tl.currentProject()) };
    step(
      '8c the swing changed: heard again before it goes in',
      heard1 === 1 && refused.past === pastSwing && refused.s.status === 'changed' && /Accept without listening/.test(refused.text) && s4.heard === s4.version && s4.version === 2 && moved > 1e-4 && accepted4.s.status === 'accepted' && strip(accepted4.now) === strip(expect4) && accepted4.now.swing === 0.45,
      `version ${s4.version}, B rendered again (differs by ${moved.toFixed(4)})${process.env.VERBOSE ? JSON.stringify({ heard1, refused: [refused.past, pastSwing, refused.s.status, refused.text], s4: [s4.heard, s4.version], acc: accepted4.s.status, same: strip(accepted4.now) === strip(expect4), swing: accepted4.now.swing }) : ''}`
    );

    // 9. Listen
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().togglePlay());
    await until(() => A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().isPlaying), 5000, 'playback').catch(() => false);
    const busy = await call('listen', { fromBar: 1, toBar: 5 }).then(() => 'answered', (e) => e.message);
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().pause());
    step('9a no listening while the song plays', /The song is playing/.test(busy), busy);
    // A note held from bar 13 into bar 15 is heard in bars 15-16 (nothing else plays there)
    const held = await call('listen', { fromBar: 15, toBar: 16, ops: [{ op: 'add_clip', trackId: ids.bass, startBar: 13, lengthBars: 4, notes: [{ pitch: 'C2', start: 0, length: 4 }] }] });
    step('9a held notes are heard', Number.isFinite(held.mix.lufs) && !held.findings.some((f) => /silent/.test(f)), `${held.mix.lufs} LUFS in bars 15-16`);
    // A drone held over 40 bars sounds the same from bar 5, 12 and 30 (longer than any run-in)
    const drone = [
      { op: 'add_track', instrument: 'synthDesigner', ref: 'drone' },
      { op: 'set_track', trackId: '$drone', solo: true },
      { op: 'add_clip', trackId: '$drone', startBar: 1, lengthBars: 40, notes: [{ pitch: 'C3', start: 0, length: 40 }] },
    ];
    const droneAt = [];
    for (const at of [5, 12, 30]) droneAt.push((await call('listen', { fromBar: at, toBar: at + 1, ops: drone })).mix.lufs);
    step('9a a drone held for 40 bars is heard the same anywhere', droneAt.every((v) => Number.isFinite(v)) && Math.max(...droneAt) - Math.min(...droneAt) < 1.5, droneAt.join(', '));
    // Heard from part way, the start sounds as in the song: a crash over before bar 5 isn't struck
    // again (only a bass note held into it begins again, in the run-in)
    const oneShot = await A(async (ids) => {
      const X = window.__fledgetoneAgent;
      const tm = await import('/src/audio/tempoMap.ts');
      const ops = [
        { op: 'set_track', trackId: ids.clav, mute: true },
        { op: 'set_track', trackId: ids.brass, mute: true },
        { op: 'remove_notes', clipId: ids.d, all: true },
        { op: 'add_notes', clipId: ids.d, notes: [{ pitch: 'crash', start: 3, length: 0.9, velocity: 1 }] },
        { op: 'remove_notes', clipId: ids.b, all: true },
        { op: 'add_notes', clipId: ids.b, notes: [{ pitch: 'C2', start: 3.75, length: 2, velocity: 0.05 }] },
      ];
      const d = X.ops.applyOps(X.tl.currentProject(), { opsVersion: 1, ops }, { idBase: 'oneshot' });
      const snap = X.snap.listenSnapshot(d.song);
      const tempo = { bpm: snap.bpm, points: snap.tempoPoints ?? [] };
      const full = await X.listen.renderRange(snap, 1, 7);
      const part = await X.listen.renderRange(snap, 5, 7);
      const off = Math.round((tm.barToSeconds(5, tempo) - tm.barToSeconds(1, tempo)) * full.sampleRate);
      const n = Math.round(0.5 * full.sampleRate);
      const db = (x) => {
        let e = 0;
        for (const v of x) e += v * v;
        return 20 * Math.log10(Math.sqrt(e / x.length));
      };
      return { song: db(full.getChannelData(0).subarray(off, off + n)), heard: db(part.getChannelData(0).subarray(0, n)) };
    }, ids);
    step('9a from part way, the start sounds as in the song (no one-shot struck again)', Math.abs(oneShot.song - oneShot.heard) < 1, `song ${oneShot.song.toFixed(1)} dB, heard ${oneShot.heard.toFixed(1)} dB`);
    // Play pressed during a listen: the listen stops (busy), the song plays
    const playLate = call('listen', { fromBar: 1, toBar: 30 }).then(() => 'answered', (e) => e.message);
    await page.waitForTimeout(400);
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().togglePlay());
    const stoppedListen = await playLate;
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().pause());
    step('9a Play during a listen stops the listen', /started playing/.test(stoppedListen), stoppedListen);
    await page.waitForTimeout(6100);
    const listened = await call('listen', { fromBar: 1, toBar: 5 });
    step('9 listen', Number.isFinite(listened.mix.lufs) && Number.isFinite(listened.mix.truePeakDbtp), `${listened.mix.lufs} LUFS, ${listened.mix.truePeakDbtp} dBTP`);

    // 9b. The agent never takes the keyboard or opens the panel: a suggestion with the panel closed
    // is counted on the header's button, and pointing at a control rings it without focusing it
    await page.getByLabel('Close the Suggestions panel').click();
    const search = page.getByRole('button', { name: /SEARCH/ }).first();
    await search.focus();
    const fifth = await suggest({ title: 'Drums lower', explanation: '', ops: [{ op: 'set_track', trackId: ids.drums, volumeDb: -3 }] });
    await page.waitForFunction(() => document.querySelector('[data-agent-waiting]')?.textContent === '1', null, { timeout: 5000 });
    await call('point_at', { target: { control: 'Listening volume' }, note: 'This is how loud you hear it.' });
    const rung = await until(() => A(() => !!document.querySelector('.search-flash')), 3000, 'the ring').catch(() => false);
    const focus = await A(() => ({ search: /SEARCH/.test(document.activeElement?.textContent ?? ''), panel: !!document.querySelector('[data-agent-panel]') }));
    step('9b no focus taken, the panel not opened', focus.search && !focus.panel && !!rung, JSON.stringify(focus));

    // 9c. A new card goes at the end (the others stay put); pressed within a second of appearing it
    // ignores the press; Space on a focused card button presses it and never plays the song
    await page.locator('[data-agent-chip]').click();
    await page.waitForSelector('[data-agent-panel]');
    const topBefore = await A((sid) => document.querySelector(`[data-suggestion="${sid}"]`).offsetTop, fifth.id);
    const sixth = await suggest({ title: 'Clav up', explanation: '', ops: [{ op: 'set_track', trackId: ids.clav, volumeDb: 1 }] });
    const sixthCard = page.locator(`[data-suggestion="${sixth.id}"]`);
    await sixthCard.waitFor();
    await sixthCard.locator('[data-accept]').click();
    const early = { s: await sgOf(sixth.id), text: await sixthCard.locator('[data-card-status]').textContent() };
    const layout = await A(([a, b]) => ({ a: document.querySelector(`[data-suggestion="${a}"]`).offsetTop, b: document.querySelector(`[data-suggestion="${b}"]`).offsetTop }), [fifth.id, sixth.id]);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'two-cards.png') });
    await settle();
    // (reached from the keyboard: Tab from Accept)
    await sixthCard.locator('[data-accept]').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Space');
    await statusIs(sixth.id, 'dismissed');
    const playing = await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().isPlaying);
    // Focus went on to a card (not a button: a Space or a held key must press nothing), and Space plays the song
    await page.waitForTimeout(100);
    const focusedOn = await A(() => ({ tag: document.activeElement?.tagName, card: document.activeElement?.hasAttribute('data-suggestion') ?? false }));
    await page.keyboard.press('Space');
    const spaceSong = await until(() => A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().isPlaying), 2000, 'playback').catch(() => false);
    const spaceAudition = await A(() => window.__fledgetoneAgent.audition.useAudition.getState().phase);
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().pause());
    step('9c after a keyboard answer: focus on the next card, Space plays the song (nothing heard)', focusedOn.card && focusedOn.tag !== 'BUTTON' && !!spaceSong && spaceAudition === 'idle', `${JSON.stringify(focusedOn)}, song ${!!spaceSong}, audition ${spaceAudition}`);
    step('9c appended, a fresh card ignores presses, Space presses', layout.a === topBefore && layout.b > layout.a && early.s.status === 'waiting' && /just appeared/.test(early.text) && !playing, `first card at ${topBefore} → ${layout.a}, new at ${layout.b}`);

    // 9d. Not heard: one press of Accept doesn't accept, it offers "Accept without listening"; a
    // double-click never accepts; Space plays the song (focus left the button) and never accepts;
    // after 5 seconds it's Accept again; a separate second press accepts
    const seventh = await suggest({ title: 'Brass a little lower', explanation: '', ops: [{ op: 'set_track', trackId: ids.brass, volumeDb: -14 }] });
    const seventhCard = page.locator(`[data-suggestion="${seventh.id}"]`);
    const accept7 = seventhCard.locator('[data-accept]');
    await seventhCard.waitFor();
    await settle();
    await wheelInto(accept7);
    await accept7.click();
    const armedText = (await accept7.textContent()).trim();
    if (SHOTS) await seventhCard.screenshot({ path: path.join(SHOTS, 'card-accept-without-listening.png') });
    const armedStatus = (await sgOf(seventh.id)).status;
    await page.keyboard.press('Space');
    const spacePlays = await until(() => A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().isPlaying), 2000, 'playback').catch(() => false);
    await page.keyboard.press('Space');
    await until(() => A(() => !window.__fledgetoneAgent.tl.useTimelineStore.getState().isPlaying), 2000, 'the stop').catch(() => false);
    const afterSpace = (await sgOf(seventh.id)).status;
    await page.waitForTimeout(4500);
    const expired = await until(async () => ((await accept7.textContent()).trim() === 'Accept' ? 'Accept' : null), 2000, 'Accept again').catch(async () => (await accept7.textContent()).trim());
    // (the card changed back, and may have moved: let it settle)
    await settle();
    await wheelInto(accept7);
    await accept7.dblclick();
    await page.waitForTimeout(300);
    const afterDouble = { status: (await sgOf(seventh.id)).status, text: (await accept7.textContent()).trim() };
    // The agent can't point at (or scroll) anything in the panel
    const scrollBefore = await A(() => document.querySelector('[data-agent-panel] .overflow-y-auto').scrollTop);
    const pointed = await call('point_at', { target: { control: 'Suggestion from your agent' } }).then(() => 'found', (e) => (/No control/.test(e.message) ? 'not found' : e.message));
    const scrollAfter = await A(() => document.querySelector('[data-agent-panel] .overflow-y-auto').scrollTop);
    await page.waitForTimeout(800);
    await wheelInto(accept7);
    await accept7.click();
    await statusIs(seventh.id, 'accepted').catch(async () => {
      throw new Error(`9d: the second press didn't accept: "${(await accept7.textContent()).trim()}", ${await seventhCard.locator('[data-card-status]').textContent()}`);
    });
    step(
      '9d unheard: "Accept without listening", a separate second press',
      armedText === 'Accept without listening' && armedStatus === 'waiting' && spacePlays && afterSpace === 'waiting' && expired === 'Accept' && afterDouble.status === 'waiting' && afterDouble.text === 'Accept without listening',
      `first press: "${armedText}" (${armedStatus}), space played: ${spacePlays} (${afterSpace}), after 5 s: "${expired}", after a double-click: ${afterDouble.status} "${afterDouble.text}"`
    );
    step('9e point_at never reaches the panel', pointed === 'not found' && scrollBefore === scrollAfter, pointed);

    // 9f. A quick run of switches between Now and Suggested keeps playing (each restart fades)
    await hear(fifth.id);
    for (let i = 0; i < 6; i++) await page.locator(`[data-suggestion="${fifth.id}"] [data-hear="${i % 2 ? 'suggested' : 'now'}"]`).click({ delay: 0 });
    const quick = await A(() => window.__fledgetoneAgent.audition.useAudition.getState());
    step('9f quick switches', quick.phase === 'playing' && quick.hearing === 'b', `${quick.phase}, hearing ${quick.hearing}${quick.error ? `, ${quick.error}` : ''}`);

    // 9g. What's said to screen readers: an agent's long message is said short, a burst merged, at
    // most one announcement every ANNOUNCE_EVERY_MS (waited for by the throttle's own state, never
    // by a guess at how long things take: under load a say can take longer than its second)
    const EVERY = await A(() => window.__fledgetoneAgent.sg.ANNOUNCE_EVERY_MS);
    const quietNow = () => A((every) => { const p = window.__fledgetoneAgent.sg.announcePending(); return p.waiting === 0 && Date.now() - p.lastSaid >= every; }, EVERY);
    await until(quietNow, 30000, 'the live region to be free');
    await A(() => {
      window.__live = [];
      const el = document.querySelector('[data-agent-live]');
      new MutationObserver(() => {
        const last = window.__live.at(-1);
        if (!last || last.text !== el.textContent) window.__live.push({ at: Date.now(), text: el.textContent });
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
    const firstCardTop = () => A(() => document.querySelector('[data-agent-panel] [data-suggestion]').getBoundingClientRect().top);
    const topBeforeSays = await firstCardTop();
    await call('say', { text: `Here is a long thought: ${'the bass could move more '.repeat(60)}` });
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(1050);
      await call('say', { text: `Short note ${i}.` });
    }
    await page.waitForTimeout(300);
    const topAfterSays = await firstCardTop();
    const unreadShown = await page.locator('[data-agent-unread]').count();
    // Everything said: nothing waiting any more
    await until(() => A(() => window.__fledgetoneAgent.sg.announcePending().waiting === 0), 30000, 'every announcement to be said');
    const liveAfter = (await A(() => window.__live)).filter((x) => x.text);
    const gaps = liveAfter.slice(1).map((x, i) => x.at - liveAfter[i].at);
    const all = liveAfter.map((x) => x.text).join(' ');
    // (four messages: each said, or counted in a merge's "and N more")
    const counted = (all.match(/Your agent sent a message/g) ?? []).length + [...all.matchAll(/And (\d+) more update/g)].reduce((n, m) => n + Number(m[1]), 0);
    step('9g messages never move the cards', topBeforeSays === topAfterSays, `first card at ${topBeforeSays} → ${topAfterSays}, new-messages button shown: ${unreadShown > 0}`);
    step(
      '9g live region: short, at most one a few seconds, every message said',
      liveAfter.length >= 2 && liveAfter[0].text.length < 140 && /^Your agent sent a message: Here is a long thought/.test(liveAfter[0].text) && gaps.every((g) => g >= EVERY - 100) && /Short note 0/.test(all) && counted === 4,
      `${liveAfter.length} said, gaps ${JSON.stringify(gaps)}, counted ${counted}: ${JSON.stringify(liveAfter.map((x) => x.text)).slice(0, 200)}`
    );

    // 9h. A message while the panel is closed shows on the header's button until it's been seen
    await page.getByLabel('Close the Suggestions panel').click();
    await page.waitForTimeout(1100);
    await call('say', { text: 'One more thing: the clav is a touch bright.' });
    const dot = await until(() => page.locator('[data-agent-unread-dot]').count(), 3000, 'the unread dot').catch(() => 0);
    await page.locator('[data-agent-chip]').click();
    const newButton = page.locator('[data-agent-unread]');
    if (await newButton.count()) await newButton.click();
    const cleared = await until(async () => (await page.locator('[data-agent-unread-dot]').count()) === 0, 3000, 'the dot to clear').catch(() => false);
    step('9h unread messages marked, then seen', dot > 0 && !!cleared);

    // 9i. An assistive tool's press (a trusted click with no pointer or key behind it, as screen
    // readers and voice control send; here through a label) counts, even on a card that just
    // appeared; the separate-second-press rule still holds; focus then goes on, never nowhere
    const eighth = await suggest({ title: 'Clav a touch lower', explanation: '', ops: [{ op: 'set_track', trackId: ids.clav, volumeDb: -2 }] });
    const eighthCard = page.locator(`[data-suggestion="${eighth.id}"]`);
    await eighthCard.waitFor();
    await A((sid) => {
      const b = document.querySelector(`[data-suggestion="${sid}"] [data-accept]`);
      b.id = 'e2e-accept';
      const l = document.createElement('label');
      l.htmlFor = 'e2e-accept';
      l.id = 'e2e-label';
      l.textContent = 'press';
      l.style.cssText = 'position:fixed;left:4px;top:4px;z-index:100;background:#000;color:#fff';
      document.body.append(l);
    }, eighth.id);
    await page.locator('#e2e-label').click();
    const firstAssist = { s: await sgOf(eighth.id), text: (await eighthCard.locator('[data-accept]').textContent()).trim() };
    await page.waitForTimeout(800);
    await page.locator('#e2e-label').click();
    await statusIs(eighth.id, 'accepted').catch(() => {});
    const afterAssist = await sgOf(eighth.id);
    await page.waitForTimeout(100);
    const focusAfter = await A(() => (document.activeElement === document.body ? 'body' : document.activeElement?.closest('[data-agent-panel]') ? 'panel' : document.activeElement?.tagName));
    await A(() => document.getElementById('e2e-label')?.remove());
    step('9i assistive presses count (twice when not heard)', firstAssist.s.status === 'waiting' && firstAssist.text === 'Accept without listening' && afterAssist.status === 'accepted', `${firstAssist.text} → ${afterAssist.status}`);
    step('9i focus goes on after the card is answered', focusAfter !== 'body', focusAfter);

    // 10. point_at a track
    await page.waitForTimeout(1100);
    await call('point_at', { target: { track: ids.bass }, note: 'The bass' });
    const ringed = await until(() => page.locator('[data-agent-highlight] .border-2').count(), 3000, 'the track ring').catch(() => 0);
    // (said once the throttle lets it: on its own, or merged with others said meanwhile, as "and N more")
    await A(() => {
      window.__said10 = [];
      const el = document.querySelector('[data-agent-live]');
      window.__said10.push(el.textContent);
      new MutationObserver(() => window.__said10.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    });
    const said = await until(() => A(() => window.__said10.some((t) => /points at a track|And \d+ more update/.test(t ?? ''))), 15000, 'the live region').catch(() => false);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'point-at.png') });
    step('10 point_at', ringed > 0 && !!said);

    // 10b. Another song opened: a waiting suggestion is for another song (being heard, it stops),
    // can't be accepted, and the agent hears so
    await hear(fifth.id);
    since = (await call('studio_status')).lastEvent;
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().newProject('blank'));
    await statusIs(fifth.id, 'other_song');
    const phase = await A(() => window.__fledgetoneAgent.audition.useAudition.getState().phase);
    const off = (await page.locator(`[data-suggestion="${fifth.id}"] [data-accept]`).getAttribute('aria-disabled')) === 'true';
    const toldSong = await events(since, 5);
    since = toldSong.last;
    const kept = (await sgOf(fourth.id)).status;
    step(
      '10b another song: not acceptable, stopped, the agent told',
      phase === 'idle' && off && toldSong.events.some((e) => e.event === 'suggestion' && e.params.id === fifth.id && e.params.status === 'other_song') && kept === 'accepted' && !toldSong.events.some((e) => e.params?.id === fourth.id),
      `phase ${phase}; the one accepted earlier stays accepted`
    );
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'other-song.png') });

    // 10c. Another tab can't connect while this one is: it says so plainly
    const { code: code3, port: port3 } = await call('connect_studio').catch(() => ({}));
    const page3 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page3.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
    await page3.goto(APP, { waitUntil: 'networkidle' });
    await page3.getByRole('menuitem', { name: 'View', exact: true }).first().click();
    await page3.locator('[role^="menuitem"]', { hasText: 'Let an agent connect' }).first().click();
    await page3.getByPlaceholder('K7QM-3XPD-9TBW').fill(code3 ?? 'K7QM-3XPD-9TBW');
    await page3.getByLabel('Port the helper listens on').fill(String(port3 ?? port));
    await page3.getByRole('button', { name: 'Connect', exact: true }).click();
    const other = await until(() => page3.locator('#agent-connect-status').textContent().then((t) => (/already connected/.test(t) ? t : null)), 8000, 'the message').catch(async () => page3.locator('#agent-connect-status').textContent());
    await page3.close();
    step('10c a second tab: told another is connected', /Another tab or studio is already connected/.test(other), other);

    // 10d. After Disconnect, a new pairing starts from reading only
    await page.locator('[data-agent-panel]').getByRole('button', { name: 'Disconnect' }).click();
    await page.locator('[data-agent-panel]').getByRole('button', { name: 'Let an agent connect…' }).click();
    const ticked = await Promise.all([/^See what I select/, /^Suggest changes/, /^Listen/].map((name) => page.getByRole('checkbox', { name }).isChecked()));
    step('10d a new pairing starts from reading only', ticked.every((t) => !t), JSON.stringify(ticked));
    const again = await call('connect_studio');
    await page.getByPlaceholder('K7QM-3XPD-9TBW').fill(again.code);
    await page.getByLabel('Port the helper listens on').fill(String(again.port));
    // (allowed to suggest and listen, so what it may not reach is only for being another pairing's)
    await page.getByRole('checkbox', { name: /^Suggest changes/ }).check();
    await page.getByRole('checkbox', { name: /^Listen/ }).check();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await until(async () => (await call('studio_status')).connected, 10000, 'the reconnection');

    // 10e. A new pairing is a new connection: the agent there sees, withdraws and listens to only
    // what it suggests in it, never the suggestions of the pairing before
    const listedNow = (await call('get_suggestion')).suggestions;
    const oldOne = await call('get_suggestion', { id: fourth.id }).then(() => 'found', (e) => (/no suggestion with that id/i.test(e.message) ? 'not found' : e.message));
    const withdrawOld = await call('withdraw_suggestion', { id: fifth.id }).then(() => 'withdrawn', (e) => (/no suggestion with that id/i.test(e.message) ? 'not found' : e.message));
    const listenOld = await call('listen', { fromBar: 1, toBar: 2, suggestionId: fifth.id }).then(() => 'heard', (e) => (/no suggestion with that id/i.test(e.message) ? 'not found' : e.message));
    step(
      "10e a new pairing doesn't see the suggestions of the one before",
      listedNow.length === 0 && oldOne === 'not found' && withdrawOld === 'not found' && listenOld === 'not found' && (await sgOf(fifth.id)).status === 'other_song',
      `listed ${listedNow.length}, get ${oldOne}, withdraw ${withdrawOld}, listen ${listenOld}`
    );

    // 10f. Disconnect inside the Change dialog: the boxes go back to reading only for the next pairing
    await page.locator('[data-agent-panel]').getByRole('button', { name: 'Change', exact: true }).click();
    await page.getByRole('checkbox', { name: /^Suggest changes/ }).check();
    await page.locator('form[data-agent-ui]').getByRole('button', { name: 'Disconnect' }).click();
    await until(async () => !(await call('studio_status')).connected, 5000, 'the disconnect');
    const tickedAfter = await Promise.all([/^See what I select/, /^Suggest changes/, /^Listen/].map((name) => page.getByRole('checkbox', { name }).isChecked()));
    const third2 = await call('connect_studio');
    await page.getByPlaceholder('K7QM-3XPD-9TBW').fill(third2.code);
    await page.getByLabel('Port the helper listens on').fill(String(third2.port));
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await until(async () => (await call('studio_status')).connected, 10000, 'the reconnection');
    const permsThen = (await call('studio_status')).permissions;
    step('10f Disconnect in the dialog: the next pairing starts from reading only', tickedAfter.every((t) => !t) && !permsThen.see && !permsThen.suggest && !permsThen.listen, `${JSON.stringify(tickedAfter)} ${JSON.stringify(permsThen)}`);

    // 11. Closing the tab
    await page.close();
    const gone = await until(async () => !(await call('studio_status')).connected, 5000, 'the disconnect').catch(() => false);
    step('11 closing the tab disconnects', !!gone);
    step('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    // 12. The agent's chunk can't be loaded (offline): a plain note with Reload, the panel's space
    // given back, the studio carries on; Reload (the song saved first) loads it
    const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page2.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
    await page2.route(/components\/agent\/AgentStudio\.tsx/, (r) => r.abort('internetdisconnected'));
    await page2.goto(APP, { waitUntil: 'networkidle' });
    await page2.getByRole('menuitem', { name: 'View', exact: true }).first().click();
    await page2.locator('[role^="menuitem"]', { hasText: 'Suggestions' }).first().click();
    const note = await page2.locator('[data-agent-failed]').waitFor({ timeout: 10000 }).then(() => true, () => false);
    const studioUp = await page2.locator('[data-timeline-scroll]').count();
    const padding = await page2.evaluate(() => getComputedStyle(document.getElementById('root').firstElementChild).paddingRight);
    const noteOnTop = await page2.evaluate(() => {
      const r = document.querySelector('[data-agent-failed]').getBoundingClientRect();
      return !!document.elementFromPoint(r.left + 10, r.top + 10)?.closest('[data-agent-failed]');
    });
    if (SHOTS) await page2.screenshot({ path: path.join(SHOTS, 'chunk-failed.png') });
    await page2.unroute(/components\/agent\/AgentStudio\.tsx/);
    await Promise.all([page2.waitForNavigation({ waitUntil: 'networkidle' }), page2.getByRole('button', { name: 'Reload' }).click()]);
    await page2.getByRole('menuitem', { name: 'View', exact: true }).first().click();
    await page2.locator('[role^="menuitem"]', { hasText: 'Suggestions' }).first().click();
    const loaded = await page2.locator('[data-agent-panel]').waitFor({ timeout: 15000 }).then(() => true, () => false);
    // 12b. The panel failing once loaded, while an agent is connected: a note; Close keeps it away
    // (the studio up) until the musician opens the panel again
    await page2.evaluate(async () => {
      const { useUiStore } = await import('/src/store/uiStore.ts');
      window.__agentCrash = true;
      useUiStore.setState({ agentStatus: { state: 'connected' } });
      useUiStore.getState().setAgentPanelOpen(false);
    });
    const crashNote = await page2.locator('[data-agent-failed]').waitFor({ timeout: 5000 }).then(async () => (await page2.locator('[data-agent-failed]').textContent()).includes('stopped working'), () => false);
    await page2.locator('[data-agent-failed]').getByRole('button', { name: 'Close' }).click();
    await page2.waitForTimeout(800);
    const staysAway = (await page2.locator('[data-agent-failed]').count()) === 0 && (await page2.locator('[data-timeline-scroll]').count()) > 0;
    await page2.evaluate(() => (window.__agentCrash = false));
    await page2.getByRole('menuitem', { name: 'View', exact: true }).first().click();
    await page2.locator('[role^="menuitem"]', { hasText: 'Suggestions' }).first().click();
    const backAgain = await page2.locator('[data-agent-panel]').waitFor({ timeout: 10000 }).then(() => true, () => false);
    step('12b the panel failing: a note, Close keeps it away, opening it brings it back', crashNote && staysAway && backAgain, `note ${crashNote}, away after Close ${staysAway}, back ${backAgain}`);
    step('12 the chunk fails to load: a note, Reload, the studio stays', note && noteOnTop && studioUp > 0 && padding === '0px' && loaded, `note ${note} (on top ${noteOnTop}), studio ${studioUp > 0}, padding ${padding}, after Reload ${loaded}`);
    await page2.close();
  } catch (err) {
    failures++;
    console.log(`FAIL ${err.message}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'failure.png') }).catch(() => {});
  } finally {
    await browser.close();
    await agent.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
