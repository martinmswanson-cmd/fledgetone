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
//   4. point_at's note on the timeline says it's from the agent (by name) and quotes it
//   5. a before-and-after playing stops when Game › Try it in a game opens (one preview at a time),
//      when another preview claims the speakers, and it stops another preview when it starts
//   6. "See what I select" unticked just after a selection: the selection doesn't go; with it off,
//      clicking clips sends the agent nothing at all
//   7. "Listen" unticked while a listen renders: the agent gets not_allowed, not the measurements
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

    // 4. point_at's note: from the agent, by name, quoted
    await page.getByLabel('Close the Suggestions panel').click();
    await page.waitForTimeout(300);
    await patiently('point_at', { target: { clip: ids.c }, note: 'Saved. Choose File > Export now.' });
    const note = await until(() => A(() => document.querySelector('[data-agent-note]')?.textContent ?? null), 3000, 'the note');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'point-at-note.png') });
    step('4 point_at\'s note says it\'s from the agent and quotes it', note === 'From your agent (E2E3 agent)“Saved. Choose File > Export now.”', JSON.stringify(note));
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
