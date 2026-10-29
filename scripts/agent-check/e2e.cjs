// The agent connection end to end, in a real browser: the studio (the dev server) paired with the
// agent helper (`fledgetone mcp`, run from source) driven by the MCP SDK's own client, as an agent
// would. It checks, in order:
//
//   1. pairing by the code the helper gives, typed in "Let an agent connect…"
//   2. get_song lists the very tracks and clips the studio has
//   3. a suggestion (+notes, a track up 9 dB) shows as a card with its caution, and its tracks
//      and bars are tinted on the timeline
//   4. its before-and-after differs in its bars, and renders the same outside them
//   5. hearing it changes nothing: no undo step, no autosave
//   6. Accept is one undo step, and the song is then exactly the one heard
//   7. Ctrl+Z puts the song back exactly
//   8. a suggestion whose clip is edited meanwhile goes out of date (Accept off), and the agent hears so
//   9. listen gives a finite loudness and true peak
//  10. point_at rings a control
//  11. closing the tab disconnects
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
      const d = clip(drums, 1, 12, [...steps(48, 'C1', 0.25, '16n'), ...steps(24, 'D1', 0.5, '16n').map((n) => ({ ...n, startOffset: n.startOffset + 0.25 }))]);
      const b = clip(bass, 1, 12, steps(24, 'C2', 0.5, '8n'));
      const c = clip(clav, 1, 8, steps(16, 'E4', 0.5, '8n'));
      const r = clip(brass, 9, 4, steps(8, 'G4', 0.5, '8n'));
      window.__fledgetoneAgent.tl.useTimelineStore.getState().setTrackVolume(brass, -12);
      return { drums, bass, clav, brass, d, b, c, r };
    });
    await page.getByLabel('Close the Suggestions panel').click();

    // 1. Pairing
    const { code, port } = await call('connect_studio');
    await menu('Let an agent connect…');
    await page.getByPlaceholder('K7QM-3XPD-9TBW').fill(code);
    await page.getByLabel('Port the helper listens on').fill(String(port));
    for (const name of [/^See what I select/, /^Suggest changes/, /^Listen/]) await page.getByRole('checkbox', { name }).check();
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'connect-dialog.png') });
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.waitForSelector('[data-agent-chip]', { timeout: 15000 });
    const status = await call('studio_status');
    step('1 pairing', status.connected === true && status.permissions.suggest && status.permissions.listen, `agent shown as "${await page.locator('[data-agent-panel]').getByText('Connected:').textContent().catch(() => '?')}"`);

    // 2. get_song matches the studio
    const song = await call('get_song');
    const here = await page.evaluate(() => {
      const p = window.__fledgetoneAgent.tl.currentProject();
      return { tracks: p.tracks.map((t) => t.id), clips: p.clips.map((c) => c.id) };
    });
    step('2 get_song ids', JSON.stringify(song.tracks.map((t) => t.id)) === JSON.stringify(here.tracks) && JSON.stringify(song.clips.map((c) => c.id)) === JSON.stringify(here.clips), `${here.tracks.length} tracks, ${here.clips.length} clips`);

    // 3. A suggestion: two notes in the brass clip and the brass up 9 dB
    let since = (await call('studio_status')).lastEvent;
    const made = await call('suggest', {
      title: 'An answer in the brass',
      explanation: 'Two notes answer the bass in bar 10, and the brass comes up so they are heard.',
      ops: [
        { op: 'set_track', trackId: ids.brass, volumeDb: -3 },
        { op: 'add_notes', clipId: ids.r, notes: [{ pitch: 'B4', start: 1.25, length: 0.25 }, { pitch: 'D5', start: 1.5, length: 0.5 }] },
      ],
    });
    const card = page.locator(`[data-suggestion="${made.id}"]`);
    await card.waitFor({ timeout: 10000 });
    const cardText = await card.textContent();
    await card.hover();
    const tinted = await until(() => page.locator('[data-agent-highlight] > div').count(), 3000, 'the tint');
    step('3 card, caution and tint', /goes up by 9 dB/.test(cardText) && /Turns "Brass Stabs" up by 9 dB/.test(cardText) && tinted > 0, `${tinted} tinted boxes`);
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, 'panel-and-highlight.png') });
      await card.screenshot({ path: path.join(SHOTS, 'card.png') });
    }

    // 4 and 5. The before-and-after
    const before = await page.evaluate(() => ({ autosave: localStorage.getItem('bos-beat-box.autosave.v1'), past: window.__fledgetoneAgent.tl.useTimelineStore.getState().past.length }));
    await card.locator('[data-hear="suggested"]').click();
    await page.waitForFunction(() => {
      const a = window.__fledgetoneAgent.audition.useAudition.getState();
      return a.phase === 'playing' || a.error;
    }, null, { timeout: 120000 });
    const heardState = await page.evaluate(() => window.__fledgetoneAgent.audition.useAudition.getState());
    if (heardState.error) throw new Error(`the before-and-after didn't play: ${heardState.error}`);
    await page.locator('[data-hear="now"]').first().click();
    await page.waitForTimeout(300);
    const ab = await page.evaluate(async (sid) => {
      const A = window.__fledgetoneAgent;
      const { a, b } = A.audition.auditionBuffers();
      const diff = (x, y) => {
        let m = 0;
        for (let c = 0; c < Math.min(x.numberOfChannels, y.numberOfChannels); c++) {
          const p = x.getChannelData(c);
          const q = y.getChannelData(c);
          for (let i = 0; i < Math.min(p.length, q.length); i++) m = Math.max(m, Math.abs(p[i] - q[i]));
        }
        return m;
      };
      const s = A.sg.useSuggestions.getState().suggestions.find((x) => x.id === sid);
      const now = A.handlers.listenSnapshot(A.tl.currentProject());
      const then = A.handlers.listenSnapshot(s.song);
      const [x, y] = [await A.listen.renderRange(now, 2, 5), await A.listen.renderRange(then, 2, 5)];
      return { inside: diff(a, b), outside: diff(x, y), bars: A.audition.useAudition.getState().bars, hearing: A.audition.useAudition.getState().hearing };
    }, made.id);
    step('4 before and after', ab.inside > 1e-3 && ab.outside < 1e-6, `bars ${ab.bars.join('-')}: inside ${ab.inside.toFixed(4)}, outside ${ab.outside}`);
    const during = await page.evaluate(() => ({ autosave: localStorage.getItem('bos-beat-box.autosave.v1'), past: window.__fledgetoneAgent.tl.useTimelineStore.getState().past.length }));
    step('5 hearing changes nothing', during.autosave === before.autosave && during.past === before.past, `undo steps ${before.past} → ${during.past}`);

    // 6. Accept
    const strip = (p) => JSON.stringify({ tracks: p.tracks, clips: p.clips.map(({ isSelected, ...c }) => c), bpm: p.bpm, markers: p.markers });
    const prior = await page.evaluate(() => window.__fledgetoneAgent.tl.currentProject());
    await card.locator('[data-accept]').click();
    const after = await page.evaluate((sid) => {
      const A = window.__fledgetoneAgent;
      const s = A.sg.useSuggestions.getState().suggestions.find((x) => x.id === sid);
      return { now: A.tl.currentProject(), heard: s.song, status: s.status, past: A.tl.useTimelineStore.getState().past.length };
    }, made.id);
    const told = await call('wait_for_changes', { since, timeoutSeconds: 3 });
    since = told.last;
    step('6 accept: one undo step, the song heard', after.status === 'accepted' && after.past === before.past + 1 && strip(after.now) === strip(after.heard) && told.events.some((e) => e.event === 'suggestion' && e.params.status === 'accepted'), `undo steps ${before.past} → ${after.past}`);

    // 7. Undo
    await page.locator('body').click({ position: { x: 5, y: 880 } });
    await page.keyboard.press('Control+z');
    const undone = await page.evaluate(() => window.__fledgetoneAgent.tl.currentProject());
    step('7 Ctrl+Z restores exactly', strip(undone) === strip(prior));

    // 8. Out of date
    const second = await call('suggest', { title: 'Busier bass', explanation: 'A pickup into bar 5.', ops: [{ op: 'add_notes', clipId: ids.b, notes: [{ pitch: 'G2', start: 3.75, length: 0.25 }] }] });
    await page.locator(`[data-suggestion="${second.id}"]`).waitFor();
    await page.evaluate((clipId) => window.__fledgetoneAgent.tl.useTimelineStore.getState().addNotes(clipId, [{ note: 'C3', startOffset: 2.25, duration: '16n', velocity: 0.7 }]), ids.b);
    await page.waitForFunction((sid) => window.__fledgetoneAgent.sg.useSuggestions.getState().suggestions.find((x) => x.id === sid)?.status === 'out_of_date', second.id, { timeout: 5000 });
    const disabled = await page.locator(`[data-suggestion="${second.id}"] [data-accept]`).isDisabled();
    const heard = await call('wait_for_changes', { since, timeoutSeconds: 5 });
    since = heard.last;
    step('8 out of date', disabled && heard.events.some((e) => e.event === 'suggestion' && e.params.id === second.id && e.params.status === 'out_of_date'), 'Accept is off, the agent was told');

    // 9. Listen
    const listened = await call('listen', { fromBar: 1, toBar: 5 });
    step('9 listen', Number.isFinite(listened.mix.lufs) && Number.isFinite(listened.mix.truePeakDbtp), `${listened.mix.lufs} LUFS, ${listened.mix.truePeakDbtp} dBTP`);

    // 10. point_at a control (and a track)
    await call('point_at', { target: { control: 'Listening volume' }, note: 'This is how loud you hear it.' });
    const rung = await until(() => page.evaluate(() => !!document.querySelector('.search-flash')), 3000, 'the ring').catch(() => false);
    await page.waitForTimeout(1100);
    await call('point_at', { target: { track: ids.bass }, note: 'The bass' });
    const ringed = await until(() => page.locator('[data-agent-highlight] .border-2').count(), 3000, 'the track ring').catch(() => 0);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'point-at.png') });
    step('10 point_at', !!rung && ringed > 0);

    // 11. Closing the tab
    await page.close();
    const gone = await until(async () => !(await call('studio_status')).connected, 5000, 'the disconnect').catch(() => false);
    step('11 closing the tab disconnects', !!gone);
    step('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
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
