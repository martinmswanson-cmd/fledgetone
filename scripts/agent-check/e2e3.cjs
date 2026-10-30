// The musician's say over what an agent hears and sees, end to end in a real browser: the studio
// (the dev server) paired with the agent helper (`fledgetone mcp`, run from source) driven by the
// MCP SDK's own client. It checks, in order:
//
//   1. hearing only Now (the song as it is) doesn't count as hearing the suggestion: the card says
//      "Not heard yet." and one press of Accept doesn't put it in; switching to Suggested while it
//      plays does count
//   2. the song changed while the before-and-after plays: pressing Suggested makes it again and
//      renders it again (a new version heard), and the card says it was heard as the song is now
//   3. selecting and clearing clips isn't an edit: the revision stays, the agent gets no "changed",
//      the heard suggestion stays heard, and one press of Accept puts it in with the selection kept
//   4. the panel closed with a card under the pointer takes its tint off the timeline; point_at's
//      note on the timeline says it's from the agent (by name) and quotes it; bars off
//      screen are scrolled to (the focus kept), or, with the musician busy, the note at the lanes'
//      edge says where they are; a control gets the agent's ring and note next to it, said aloud
//   5. a before-and-after playing stops when Game › Try it in a game opens (one preview at a time),
//      when another preview claims the speakers, and it stops another preview when it starts
//   6. "See what I select" unticked just after a selection: the selection doesn't go; with it off,
//      clicking clips sends the agent nothing at all
//   7. "Listen" unticked while a listen renders: the agent gets not_allowed, not the measurements
//   8. arming and MIDI learn aren't edits; a solo or mute of the track a suggestion changes is,
//      and leaves the suggestion good (not out of date)
//   9. a wrong code on the wrong port, then the port corrected and Try again: connected afresh to
//      the helper on that port
//  10. a program on a port that answers the pairing with words of its own: the dialog says the
//      studio's own; with another agent paired, each card still names the agent that made it; a
//      focus away from the changed bars: what plays covers them, and only then is it heard; an
//      agent's value isn't echoed in a caution; a press dragged off Accept doesn't make the next,
//      assistive press do nothing; a selected clip whose id held hidden text goes with a message
//      by the id get_view gives it
//
// Needs the dev server on a port from 5960 to 5969 (PORT=5960 by default; `npm run build:runtime`
// first), Playwright's Chromium, and tools/cli's packages (npm install in tools/cli):
//
//   setsid nohup npx vite --port 5960 --strictPort > /tmp/vite.log 2>&1 &
//   node scripts/agent-check/e2e3.cjs            (SHOTS=dir saves screenshots there)
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
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fledgetone-e2e3-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', path.join(CLI, 'src', 'tsHook.mjs'), path.join(CLI, 'src', 'fledgetone.ts'), 'mcp', '--port', '0', '--root', work, '--allow-origin', APP.replace(/\/$/, '')],
    cwd: ROOT,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (d) => process.env.VERBOSE && process.stderr.write(`[helper] ${d}`));
  const agent = new Client({ name: 'E2E3 agent', version: '1' });
  await agent.connect(transport);
  const raw = async (tool, args = {}) => {
    const r = await agent.callTool({ name: tool, arguments: args });
    const text = r.content.map((c) => c.text).join('');
    let value = text;
    try {
      value = JSON.parse(text);
    } catch {
      // plain text
    }
    return { isError: !!r.isError, value, text };
  };
  const call = async (tool, args = {}) => {
    const r = await raw(tool, args);
    if (r.isError) throw new Error(`${tool}: ${r.text}`);
    return r.value;
  };
  // (suggest keeps to one every 3 seconds, point_at to one a second)
  const patiently = async (tool, args) => {
    for (;;) {
      try {
        return await call(tool, args);
      } catch (e) {
        if (!/Too many/.test(e.message)) throw e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  };

  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
  try {
    await page.goto(APP, { waitUntil: 'networkidle' });
    const A = (fn, arg) => page.evaluate(fn, arg);
    const menu = async (item, top = 'View') => {
      await page.getByRole('menuitem', { name: top, exact: true }).first().click();
      await page.locator('[role^="menuitem"]', { hasText: item }).first().click();
    };
    await menu('Suggestions');
    await page.waitForFunction(() => window.__fledgetoneAgent?.audition, null, { timeout: 30000 });
    // A song: drums, bass, keys and brass, a clip on each
    const ids = await A(() => {
      const T = () => window.__fledgetoneAgent.tl.useTimelineStore.getState();
      T().newProject('blank');
      const [drums, bass, clav, brass] = T().tracks.map((t) => t.id);
      const clip = (track, at, len, notes) => {
        const id = T().createEmptyClip(track, at, len);
        T().addNotes(id, notes);
        return id;
      };
      const steps = (n, note, every, len) => Array.from({ length: n }, (_, i) => ({ note, startOffset: i * every, duration: len, velocity: 0.8 }));
      return {
        drums,
        bass,
        clav,
        brass,
        d: clip(drums, 1, 8, steps(32, 'C1', 0.25, '16n')),
        b: clip(bass, 1, 8, steps(16, 'C2', 0.5, '8n')),
        c: clip(clav, 1, 8, steps(16, 'E4', 0.5, '8n')),
        r: clip(brass, 5, 4, steps(8, 'G4', 0.5, '8n')),
      };
    });
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().clearSelection());

    const { code, port } = await call('connect_studio');
    await page.getByLabel('Close the Suggestions panel').click();
    await menu('Let an agent connect…');
    await page.getByPlaceholder('K7QM-3XPD-9TBW').fill(code);
    await page.getByLabel('Port the helper listens on').fill(String(port));
    for (const name of [/^See what I select/, /^Suggest changes/, /^Listen/]) await page.getByRole('checkbox', { name }).check();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await until(async () => (await call('studio_status')).connected, 15000, 'pairing');
    await page.waitForSelector('[data-agent-panel]', { timeout: 15000 });

    const sg = (id) => A((x) => window.__fledgetoneAgent.sg.useSuggestions.getState().suggestions.find((s) => s.id === x), id);
    const audition = () => A(() => window.__fledgetoneAgent.audition.useAudition.getState());
    const card = (id) => page.locator(`[data-suggestion="${id}"]`);
    const line = (id) => card(id).locator('[data-card-status]').textContent();
    const playingOf = (id) => until(async () => {
      const a = await audition();
      if (a.error) throw new Error(a.error);
      return a.key === id && a.phase === 'playing';
    }, 120000, 'the before-and-after to play');
    const suggestOne = async (title, ops, focus = { fromBar: 1, toBar: 3 }) => {
      const s = await patiently('suggest', { title, explanation: '', ops, focus });
      await card(s.id).waitFor();
      // (a card that just appeared doesn't take a press: let it settle)
      await page.waitForTimeout(1100);
      return s.id;
    };
    const stop = async (id) => {
      if (await card(id).locator('[data-stop]').count()) await card(id).locator('[data-stop]').click();
      await until(async () => (await audition()).phase === 'idle', 3000, 'the audition to stop');
    };

    // 1. Only Now: not heard, and Accept doesn't take it in one press
    const s1 = await suggestOne('Brass up a lot', [{ op: 'set_track', trackId: ids.brass, volumeDb: 4 }], { fromBar: 5, toBar: 7 });
    const pastBefore = await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().past.length);
    await card(s1).locator('[data-hear="now"]').click();
    await playingOf(s1);
    await page.waitForTimeout(500);
    const nowOnly = await sg(s1);
    const nowLine = await line(s1);
    await stop(s1);
    await card(s1).locator('[data-accept]').click();
    await page.waitForTimeout(300);
    const pressed = await sg(s1);
    const pastAfter = await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().past.length);
    // Now, then Suggested while it plays: heard
    await card(s1).locator('[data-hear="now"]').click();
    await playingOf(s1);
    await card(s1).locator('[data-hear="suggested"]').click();
    const heardB = await until(async () => {
      const s = await sg(s1);
      return s.heard === s.version && (await line(s1)) === 'Heard.' && s;
    }, 3000, 'Suggested to count as heard').catch(() => null);
    step(
      '1 only Now isn\'t hearing it; Suggested is',
      nowOnly.heard !== nowOnly.version && nowLine === 'Not heard yet.' && pressed.status === 'waiting' && !!pressed.armed && pastAfter === pastBefore && !!heardB,
      `after Now: heard ${nowOnly.heard} of v${nowOnly.version} "${nowLine}"; one Accept: ${pressed.status}${pressed.armed ? ' (armed)' : ''}, undo steps ${pastBefore} → ${pastAfter}; after Suggested: ${heardB ? `heard v${heardB.heard}` : 'not heard'}`
    );

    // 2. The song changes under it while it plays: Suggested makes it again and renders it again
    await A((id) => window.__fledgetoneAgent.tl.useTimelineStore.getState().setTrackVolume(id, -8), ids.drums);
    const stale = await until(async () => {
      const s = await sg(s1);
      return s.stale && s;
    }, 3000, 'the suggestion to go stale');
    const keyBefore = (await audition()).renderKey;
    await card(s1).locator('[data-hear="suggested"]').click();
    const again = await until(async () => {
      const [s, a] = [await sg(s1), await audition()];
      return a.phase === 'playing' && a.renderKey === `${s1}:${s.version}` && s.heard === s.version && !s.stale && { s, a };
    }, 120000, 'the new version to play').catch(() => null);
    const againLine = await line(s1);
    step(
      '2 changed while playing: Suggested renders it again and that version is heard',
      stale.version === 1 && keyBefore === `${s1}:1` && !!again && again.s.version === 2 && /You heard it as it is now/.test(againLine),
      `stale at v${stale.version}, playing ${keyBefore}; after Suggested: ${again ? `${again.a.renderKey}, heard v${again.s.heard}` : 'not made again'} "${againLine}"`
    );
    await stop(s1);

    // 3. Selecting clips isn't an edit
    const rev0 = (await call('get_song')).revision;
    let since = (await call('studio_status')).lastEvent;
    for (const clip of [ids.b, ids.d, ids.c]) {
      const box = await page.locator(`[data-clip-id="${clip}"]`).first().boundingBox();
      await page.mouse.click(box.x + 30, box.y + box.height / 2);
      await page.waitForTimeout(300);
    }
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().clearSelection());
    await A((id) => window.__fledgetoneAgent.tl.useTimelineStore.getState().selectClip(id, false), ids.c);
    await page.waitForTimeout(900);
    const rev1 = (await call('get_song')).revision;
    const ev3 = await call('wait_for_changes', { since, timeoutSeconds: 1 });
    const kept = await sg(s1);
    const keptLine = await line(s1);
    await card(s1).locator('[data-accept]').click();
    await page.waitForTimeout(400);
    const accepted = await sg(s1);
    const after3 = await A(([brass, c]) => {
      const s = window.__fledgetoneAgent.tl.useTimelineStore.getState();
      return { volume: s.tracks.find((t) => t.id === brass).volume, selected: s.clips.filter((x) => x.isSelected).map((x) => x.id), c };
    }, [ids.brass, ids.c]);
    step(
      '3 selecting clips isn\'t an edit: no "changed", still heard, accepted in one press with the selection kept',
      rev1 === rev0 && !ev3.events.some((e) => e.event === 'changed' || (e.event === 'suggestion' && e.params.status === 'changed')) && !kept.stale && kept.heard === kept.version && accepted.status === 'accepted' && after3.volume === 4 && after3.selected.length === 1 && after3.selected[0] === ids.c,
      `revision ${rev0} → ${rev1}; events ${JSON.stringify(ev3.events.map((e) => e.event))}; ${kept.status}${kept.stale ? ' (stale)' : ''} "${keptLine}"; Accept: ${accepted.status}, brass ${after3.volume} dB, selected ${JSON.stringify(after3.selected)}`
    );

    // 4. point_at's note: from the agent, by name, quoted. (First: the panel closed under the
    // pointer on a card takes that card's tint off the timeline)
    await card(s1).locator('h3').hover();
    const tintOn = await until(() => page.locator('[data-agent-highlight] > div').count(), 2000, 'the tint').catch(() => 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.mouse.move(400, 500);
    await page.waitForTimeout(600);
    const tintAfter = { boxes: await page.locator('[data-agent-highlight] > div').count(), focusId: await A(() => window.__fledgetoneAgent.sg.useSuggestions.getState().focusId), panel: await page.locator('[data-agent-panel]').count() };
    step('4a the panel closed while a card is under the pointer: its tint goes', tintOn > 0 && tintAfter.panel === 0 && tintAfter.boxes === 0 && tintAfter.focusId === null, JSON.stringify({ tintOn, ...tintAfter }));
    if (await page.locator('[data-agent-panel]').count()) await page.getByLabel('Close the Suggestions panel').click();
    await page.waitForTimeout(300);
    await patiently('point_at', { target: { clip: ids.c }, note: 'Saved. Choose File > Export now.' });
    const note = await until(() => A(() => document.querySelector('[data-agent-note]')?.textContent ?? null), 3000, 'the note');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'point-at-note.png') });
    step('4 point_at\'s note says it\'s from the agent and quotes it', note === 'From your agent (E2E3 agent)“Saved. Choose File > Export now.”', JSON.stringify(note));

    // 4b. Bars off screen: the lanes scroll to them once the musician's hands are still (the focus
    // stays put), and the note sits on them
    const viewLeft = () => A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().viewLeft);
    const ringAndNote = () =>
      A(() => {
        const ring = document.querySelector('[data-agent-highlight] .border-2')?.getBoundingClientRect();
        const n = document.querySelector('[data-agent-note]')?.getBoundingClientRect();
        return { ring: ring ? [ring.left, ring.right] : null, note: n ? [n.left, n.right] : null, where: document.querySelector('[data-agent-note-where]')?.textContent ?? '' };
      });
    const focusBefore = await A(() => document.activeElement?.outerHTML.slice(0, 80));
    const left0 = await viewLeft();
    await page.waitForTimeout(1600);
    await patiently('point_at', { target: { bars: { fromBar: 30, toBar: 32 } }, note: 'Over here' });
    const scrolled = await until(async () => ((await viewLeft()) > left0 ? viewLeft() : null), 4000, 'the lanes to scroll').catch(() => null);
    await page.waitForTimeout(300);
    const at30 = await ringAndNote();
    const focusAfter = await A(() => document.activeElement?.outerHTML.slice(0, 80));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'point-at-scrolled.png') });
    step(
      '4b bars off screen: scrolled to (focus kept), the note on them',
      scrolled !== null && !!at30.ring && !!at30.note && at30.note[0] >= at30.ring[0] - 1 && at30.note[0] < at30.ring[1] && !at30.where && focusBefore === focusAfter,
      JSON.stringify({ left0, scrolled, ...at30, focusKept: focusBefore === focusAfter })
    );
    // 4c. The musician busy as it comes (keys pressed just before and after): no scroll; the note at the
    // lanes' edge says where the bars are, never sits over others
    await A(() => {
      const st = window.__fledgetoneAgent.tl.useTimelineStore;
      st.setState({ viewLeft: 0, viewJumps: st.getState().viewJumps + 1 });
    });
    await page.waitForTimeout(1100);
    await page.keyboard.press('Shift');
    await patiently('point_at', { target: { bars: { fromBar: 45, toBar: 46 } }, note: 'And here' });
    await until(() => A(() => !!document.querySelector('[data-agent-note-where]')), 1000, 'the note at the edge').catch(() => null);
    await page.keyboard.press('Shift');
    await page.waitForTimeout(2500);
    const at45 = await ringAndNote();
    const left45 = await viewLeft();
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'point-at-off-screen.png') });
    step('4c the musician busy: not scrolled, the note says where the bars are', left45 === 0 && !at45.ring && /^Bar 45 →$/.test(at45.where), JSON.stringify({ left45, ...at45 }));
    // 4d. A control: the agent's ring and note next to it, and said
    await A(() => {
      window.__live = [];
      const el = document.querySelector('[data-agent-live]');
      new MutationObserver(() => window.__live.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    });
    await patiently('point_at', { target: { control: 'Save' }, note: 'Save first' });
    const byControl = await until(
      () =>
        A(() => {
          const n = document.querySelector('[data-agent-note]');
          const ring = document.querySelector('[data-agent-highlight] .border-2')?.getBoundingClientRect();
          const flashed = document.querySelector('.search-flash')?.getBoundingClientRect();
          if (!n || !ring || !flashed) return null;
          const r = n.getBoundingClientRect();
          return { text: n.textContent, near: Math.abs(r.top - flashed.bottom) < 80 || Math.abs(r.bottom - flashed.top) < 80, ringed: Math.abs(ring.left - flashed.left) < 2 && Math.abs(ring.top - flashed.top) < 2 };
        }),
      3000,
      'the note by the control'
    ).catch(() => null);
    const saidControl = await until(() => A(() => window.__live.some((t) => /points at the control/.test(t) && /Save first/.test(t))), 6000, 'the live region').catch(() => false);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'point-at-control.png') });
    step('4d point_at a control: the agent\'s ring and note by it, said aloud', !!byControl && byControl.near && byControl.ringed && /^From your agent \(E2E3 agent\)“Save first”$/.test(byControl.text) && !!saidControl, JSON.stringify({ byControl, said: !!saidControl }));
    if (!(await page.locator('[data-agent-panel]').count())) await page.locator('[data-agent-chip]').click();
    await page.waitForSelector('[data-agent-panel]');

    // 5. One preview at a time
    const s5 = await suggestOne('Bass down', [{ op: 'set_track', trackId: ids.bass, volumeDb: -6 }]);
    await card(s5).locator('[data-hear="suggested"]').click();
    await playingOf(s5);
    await menu('Try it in a game…', 'Game');
    const byGame = await until(async () => (await audition()).phase === 'idle', 3000, 'the audition to stop for the game').catch(() => false);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    if (await page.locator('[role="dialog"][aria-label="Try it in a game"]').count()) await page.locator('[role="dialog"][aria-label="Try it in a game"] button').last().click();
    await page.waitForTimeout(300);
    if (!(await page.locator('[data-agent-panel]').count())) await page.locator('[data-agent-chip]').click();
    await card(s5).locator('[data-hear="suggested"]').click();
    await playingOf(s5);
    // (the module the app's previews share: exclusivePreview.ts)
    const claimed = await A(async () => {
      const ex = window.__fledgetoneAgent.preview;
      ex.claimPreview('e2e-other');
      await new Promise((r) => setTimeout(r, 200));
      return window.__fledgetoneAgent.audition.useAudition.getState().phase;
    });
    await A(async () => {
      const ex = window.__fledgetoneAgent.preview;
      window.__e2eStopped = 0;
      window.__e2eUnregister = ex.registerPreview('e2e-other', () => window.__e2eStopped++);
    });
    await card(s5).locator('[data-hear="suggested"]').click();
    await playingOf(s5);
    const otherStopped = await A(() => {
      window.__e2eUnregister();
      return window.__e2eStopped;
    });
    step('5 one preview at a time: the game, another preview and the before-and-after stop each other', byGame === true && claimed === 'idle' && otherStopped >= 1, `game ${byGame}, claimed → ${claimed}, other stopped ${otherStopped}`);
    await stop(s5);

    // 6. "See what I select" unticked just after a selection
    await page.locator('[data-agent-panel]').getByRole('button', { name: 'Change', exact: true }).click();
    const see = page.getByRole('checkbox', { name: /^See what I select/ });
    await see.waitFor();
    await page.waitForTimeout(1000);
    since = (await call('studio_status')).lastEvent;
    await A((id) => window.__fledgetoneAgent.tl.useTimelineStore.getState().selectClip(id, false), ids.b);
    await see.uncheck();
    await page.waitForTimeout(1200);
    const ev6 = await call('wait_for_changes', { since, timeoutSeconds: 2 });
    const permAt = ev6.events.findIndex((e) => e.event === 'permissions');
    const leaked = ev6.events.some((e, i) => e.event === 'view' && i > permAt);
    // With it off, clicking clips sends nothing
    since = (await call('studio_status')).lastEvent;
    if (await page.getByRole('button', { name: 'Done' }).count()) await page.getByRole('button', { name: 'Done' }).click();
    for (const clip of [ids.d, ids.c]) {
      const box = await page.locator(`[data-clip-id="${clip}"]`).first().boundingBox();
      await page.mouse.click(box.x + 30, box.y + box.height / 2);
      await page.waitForTimeout(400);
    }
    const ev6b = await call('wait_for_changes', { since, timeoutSeconds: 2 });
    step('6 "See what I select" off: the selection doesn\'t go, not even as "changed"', permAt >= 0 && !leaked && ev6b.events.length === 0, `${JSON.stringify(ev6.events.map((e) => e.event))}; then ${JSON.stringify(ev6b.events.map((e) => e.event))}`);

    // 7. "Listen" unticked while a listen renders
    if (!(await page.locator('[data-agent-panel]').count())) await page.locator('[data-agent-chip]').click();
    const listening = raw('listen', { fromBar: 1, toBar: 40 });
    await page.waitForTimeout(400);
    await page.locator('[data-agent-panel]').getByRole('button', { name: 'Change', exact: true }).click();
    const unticked = Date.now();
    await page.getByRole('checkbox', { name: /^Listen/ }).uncheck();
    const heard = await listening;
    const took = Date.now() - unticked;
    step('7 "Listen" unticked while a listen renders: not_allowed, no measurements', heard.isError && /hasn't allowed the agent to listen/.test(heard.text) && !/lufs/i.test(heard.text), `${took} ms after: ${heard.text.slice(0, 120)}`);

    // 8. Arming, MIDI learn and a freeze aren't edits; a solo or a mute of the very track a
    // suggestion changes is, but it never puts the suggestion out of date
    if (await page.getByRole('button', { name: 'Done' }).count()) await page.getByRole('button', { name: 'Done' }).click();
    if (!(await page.locator('[data-agent-panel]').count())) await page.locator('[data-agent-chip]').click();
    const s8 = await suggestOne('Bass a bit down', [{ op: 'set_track', trackId: ids.bass, volumeDb: -4 }]);
    await page.waitForTimeout(900);
    const rev8 = (await call('get_song')).revision;
    await A((id) => window.__fledgetoneAgent.tl.useTimelineStore.getState().toggleArm(id), ids.clav);
    await A((id) => {
      const st = window.__fledgetoneAgent.tl.useTimelineStore;
      st.setState({ tracks: st.getState().tracks.map((x) => (x.id === id ? { ...x, midiMap: [{ cc: 7, param: 'volume' }] } : x)) });
    }, ids.bass);
    await page.waitForTimeout(900);
    const rev8b = (await call('get_song')).revision;
    const afterArm = (await sg(s8)).status;
    await A((id) => window.__fledgetoneAgent.tl.useTimelineStore.getState().toggleSolo(id), ids.bass);
    await A((id) => window.__fledgetoneAgent.tl.useTimelineStore.getState().toggleMute(id), ids.bass);
    await page.waitForTimeout(900);
    const rev8c = (await call('get_song')).revision;
    const afterSolo = await sg(s8);
    await A((id) => window.__fledgetoneAgent.tl.useTimelineStore.getState().toggleSolo(id), ids.bass);
    await A((id) => window.__fledgetoneAgent.tl.useTimelineStore.getState().toggleMute(id), ids.bass);
    await A((id) => window.__fledgetoneAgent.tl.useTimelineStore.getState().toggleArm(id), ids.clav);
    step(
      '8 arming and MIDI learn aren\'t edits; solo and mute are, and leave the suggestion good',
      rev8b === rev8 && afterArm === 'waiting' && rev8c > rev8b && afterSolo.status === 'changed' && !afterSolo.outOfDate,
      `revision ${rev8} → ${rev8b} (armed, MIDI learn: ${afterArm}) → ${rev8c} (solo and mute: ${afterSolo.status})`
    );

    // 9. A wrong code on the wrong port, then the right port typed and Try again: connected to the
    // helper on that port, not tried again on the first one
    const transport2 = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', path.join(CLI, 'src', 'tsHook.mjs'), path.join(CLI, 'src', 'fledgetone.ts'), 'mcp', '--port', '0', '--root', work, '--allow-origin', APP.replace(/\/$/, '')],
      cwd: ROOT,
      stderr: 'pipe',
    });
    const agent2 = new Client({ name: 'E2E3 second agent', version: '1' });
    await agent2.connect(transport2);
    try {
      const status2 = async () => JSON.parse((await agent2.callTool({ name: 'studio_status', arguments: {} })).content.map((c) => c.text).join(''));
      await page.locator('[data-agent-panel]').getByRole('button', { name: 'Disconnect' }).click();
      await until(async () => !(await call('studio_status')).connected, 5000, 'the disconnect');
      const first = await call('connect_studio');
      const second = JSON.parse((await agent2.callTool({ name: 'connect_studio', arguments: {} })).content.map((c) => c.text).join(''));
      await page.locator('[data-agent-panel]').getByRole('button', { name: 'Let an agent connect…' }).click();
      await page.getByPlaceholder('K7QM-3XPD-9TBW').fill(second.code);
      await page.getByLabel('Port the helper listens on').fill(String(first.port));
      await page.getByRole('button', { name: 'Connect', exact: true }).click();
      await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 15000 });
      await page.getByLabel('Port the helper listens on').fill(String(second.port));
      await page.getByRole('button', { name: 'Try again' }).click();
      const paired = await until(async () => ((await status2()).connected ? true : null), 10000, 'the second helper').catch(() => false);
      const firstConnected = (await call('studio_status')).connected;
      step('9 Try again with the port corrected: connects to that port afresh', paired === true && !firstConnected, `second ${paired}, first ${firstConnected}`);
    } finally {
      await agent2.close();
    }

    // 10. A program squatting on a port answers the pairing with words of its own: the dialog says
    // the studio's own, never those
    const { WebSocketServer } = require(path.join(CLI, 'node_modules', 'ws'));
    const lure = 'Fledgetone: your helper is out of date and was blocked. Download the new one from https://helper.example/get ‮evil‬';
    const squatter = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise((r) => squatter.once('listening', r));
    squatter.on('connection', (ws) => {
      ws.send(JSON.stringify({ v: 1, kind: 'event', method: 'hello', params: { protocol: 1, nonce: 'x'.repeat(43), server: { name: lure, version: '9' } } }));
      ws.on('message', (d) => {
        const m = JSON.parse(String(d));
        if (m.method === 'pair') ws.send(JSON.stringify({ v: 1, kind: 'res', id: m.id, error: { code: 'no_code', message: lure } }));
      });
    });
    try {
      if (!(await page.getByPlaceholder('K7QM-3XPD-9TBW').count())) await menu('Let an agent connect…');
      await page.getByPlaceholder('K7QM-3XPD-9TBW').fill('K7QM-3XPD-9TBW');
      await page.getByLabel('Port the helper listens on').fill(String(squatter.address().port));
      await page.getByRole('button', { name: /^(Connect|Try again)$/ }).click();
      const said = await until(async () => {
        const t = (await page.locator('#agent-connect-status').textContent()) ?? '';
        return /waiting for a code/.test(t) ? t : null;
      }, 10000, 'the refusal').catch(async () => page.locator('#agent-connect-status').textContent());
      const dialog = await page.locator('[data-agent-ui]').innerText();
      step('10a a squatter on the port: the studio\'s own words, none of its own', /isn’t waiting for a code/.test(said) && !/helper\.example|Download|evil/.test(dialog), JSON.stringify(said));
    } finally {
      squatter.close();
    }

    // Another agent paired: the first agent's cards still say they came from it
    const transport3 = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', path.join(CLI, 'src', 'tsHook.mjs'), path.join(CLI, 'src', 'fledgetone.ts'), 'mcp', '--port', '0', '--root', work, '--allow-origin', APP.replace(/\/$/, '')],
      cwd: ROOT,
      stderr: 'pipe',
    });
    const agent3 = new Client({ name: 'E2E3 third agent', version: '1' });
    await agent3.connect(transport3);
    try {
      const call3 = async (tool, args = {}) => {
        for (;;) {
          const r = await agent3.callTool({ name: tool, arguments: args });
          const text = r.content.map((c) => c.text).join('');
          if (r.isError && /Too many/.test(text)) {
            await new Promise((res) => setTimeout(res, 400));
            continue;
          }
          if (r.isError) throw new Error(`${tool}: ${text}`);
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        }
      };
      const third = await call3('connect_studio');
      await page.getByPlaceholder('K7QM-3XPD-9TBW').fill(third.code);
      await page.getByLabel('Port the helper listens on').fill(String(third.port));
      for (const name of [/^See what I select/, /^Suggest changes/, /^Listen/]) await page.getByRole('checkbox', { name }).check();
      await page.getByRole('button', { name: /^(Connect|Try again)$/ }).click();
      await until(async () => (await call3('studio_status')).connected, 15000, 'the third pairing');
      await page.waitForSelector('[data-agent-panel]', { timeout: 15000 });
      const from = async (id) => (await card(id).locator('header p').first().textContent()).trim();
      const oldLabel = await from(s1);
      const s10 = await call3('suggest', { title: 'Brass up an octave', explanation: '', ops: [{ op: 'transpose_notes', clipId: ids.r, semitones: 12 }], focus: { fromBar: 1, toBar: 3 } });
      await card(s10.id).waitFor();
      step('10b each card says which agent made it, whoever is paired now', oldLabel === 'From your agent (E2E3 agent)' && (await from(s10.id)) === 'From your agent (E2E3 third agent)', `${oldLabel} | ${await from(s10.id)}`);

      // A focus that misses the changed bars (the brass plays bars 5-8): what plays covers them
      await page.waitForTimeout(1100);
      await card(s10.id).locator('[data-hear="suggested"]').click();
      await playingOf(s10.id);
      const heard10 = await until(async () => {
        const x = await sg(s10.id);
        return x.heard === x.version ? x : null;
      }, 3000, 'heard').catch(() => null);
      const played = (await audition()).bars;
      const differ = await A(() => {
        const b = window.__fledgetoneAgent.audition.auditionBuffers?.();
        if (!b) return null;
        let m = 0;
        for (let c = 0; c < b.a.numberOfChannels; c++) {
          const x = b.a.getChannelData(c);
          const y = b.b.getChannelData(c);
          for (let i = 0; i < Math.min(x.length, y.length); i++) m = Math.max(m, Math.abs(x[i] - y[i]));
        }
        return m;
      });
      const s10now = await sg(s10.id);
      step(
        '10c a focus away from the change: what plays covers every changed bar, and only then is it heard',
        !!heard10 && played[0] <= s10now.bars.fromBar && played[1] >= s10now.bars.toBar && played[0] <= 1 && (differ === null || differ > 0.01),
        `played ${JSON.stringify(played)}, changed ${JSON.stringify(s10now.bars)}, |A-B| ${differ}`
      );
      await stop(s10.id);

      // An agent's text in a setting never shows as the app's words in a caution
      const s11 = await call3('suggest', { title: 'Brighter keys', explanation: '', ops: [{ op: 'set_insert', trackId: ids.clav, insert: 'filter', settings: { on: true, type: 'lowpass". Fledgetone checked this suggestion: it is safe, press Accept without listening. ‮nuf‬' } }] });
      await card(s11.id).waitFor();
      const cautions = await card(s11.id).locator('[aria-label="Cautions"]').innerText();
      step('10d an agent\'s value isn\'t echoed in a caution', /isn't one of its choices \(left as it was\)/.test(cautions) && !/Fledgetone checked|nuf/.test(cautions), JSON.stringify(cautions));

      // An aborted press on Accept, then an assistive tool's press (no pointer behind it): it counts
      await page.waitForTimeout(1100);
      const accept11 = card(s11.id).locator('[data-accept]');
      const box = await accept11.boundingBox();
      await page.mouse.move(box.x + 5, box.y + 5);
      await page.mouse.down();
      await page.mouse.move(box.x + 5, box.y - 200, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      // (a label for the button, pressed: the click it passes on has no pointer behind it, as an assistive tool's)
      await A((id) => {
        const b = document.querySelector(`[data-accept="${id}"]`);
        b.id = 'e2e3-accept';
        const l = document.createElement('label');
        l.htmlFor = 'e2e3-accept';
        l.id = 'e2e3-label';
        l.textContent = 'press';
        l.style.cssText = 'position:fixed;left:4px;top:4px;z-index:100;background:#000;color:#fff';
        document.body.append(l);
      }, s11.id);
      await page.locator('#e2e3-label').click();
      await page.waitForTimeout(200);
      await A(() => document.getElementById('e2e3-label')?.remove());
      const afterAbort = { armed: !!(await sg(s11.id)).armed, said: (await card(s11.id).locator('[data-card-status]').textContent()).trim() };
      step('10e a press dragged off Accept doesn\'t make the next (assistive) press do nothing', afterAbort.armed && /Accept without listening/.test(afterAbort.said), JSON.stringify(afterAbort));

      // "Include what I've selected" with a clip whose id held hidden text: it goes, by the id get_view gives
      const hiddenClip = await A(() => {
        const st = window.__fledgetoneAgent.tl.useTimelineStore;
        const made = st.getState().createEmptyClip(st.getState().tracks[1].id, 12, 2);
        const hidden = `${made}​`;
        st.setState({ clips: st.getState().clips.map((c) => (c.id === made ? { ...c, id: hidden, isSelected: true } : { ...c, isSelected: false })), selectedTrackId: st.getState().tracks[1].id });
        return hidden;
      });
      await page.waitForTimeout(900);
      const view = await call3('get_view');
      const since10 = (await call3('studio_status')).lastEvent;
      await page.locator('[data-agent-compose] textarea').fill('Can you make this clip busier?');
      await page.getByRole('checkbox', { name: /Include what I/ }).check();
      await page.locator('[data-agent-compose] textarea').press('Enter');
      const sent = await until(async () => {
        const ev = await call3('wait_for_changes', { since: since10, timeoutSeconds: 2 });
        return ev.events.find((e) => e.event === 'user_message')?.params ?? null;
      }, 8000, 'the message');
      step(
        '10f a selected clip whose id held hidden text goes with the message, by get_view\'s id',
        JSON.stringify(sent.context?.selectedClipIds) === JSON.stringify(view.selectedClipIds) && view.selectedClipIds.length === 1 && !view.selectedClipIds[0].includes('​'),
        `${JSON.stringify(sent.context)} vs ${JSON.stringify(view.selectedClipIds)} (${JSON.stringify(hiddenClip)})`
      );
    } finally {
      await agent3.close();
    }

    step('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (err) {
    failures++;
    console.log(`FAIL ${err.message}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'failure3.png') }).catch(() => {});
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
