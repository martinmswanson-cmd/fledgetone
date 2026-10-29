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
//   8. a suggestion whose clip is edited meanwhile goes out of date (Accept off), and the agent hears
//      so; one being heard stops; one heard before the swing changed is heard again before Accept
//   9. listen gives a finite loudness and true peak; the agent takes no focus and opens no panel;
//      a new card goes at the end, ignores presses for a second, and Space presses its buttons
//  10. point_at rings a track (said in the live region); another song opened: the suggestion can't
//      go in, and stops being heard
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
      // (hats on every sixteenth: the swing moves some of them)
      const d = clip(drums, 1, 12, [...steps(48, 'C1', 0.25, '16n'), ...steps(24, 'D1', 0.5, '16n').map((n) => ({ ...n, startOffset: n.startOffset + 0.25 })), ...steps(192, 'F#1', 0.0625, '32n')]);
      const b = clip(bass, 1, 12, steps(24, 'C2', 0.5, '8n'));
      const c = clip(clav, 1, 8, steps(16, 'E4', 0.5, '8n'));
      const r = clip(brass, 9, 4, steps(8, 'G4', 0.5, '8n'));
      window.__fledgetoneAgent.tl.useTimelineStore.getState().setTrackVolume(brass, -12);
      return { drums, bass, clav, brass, d, b, c, r };
    });
    await page.getByLabel('Close the Suggestions panel').click();

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
    const strip = (p) => JSON.stringify({ tracks: p.tracks, clips: p.clips.map(({ isSelected, ...c }) => c), bpm: p.bpm, tempoPoints: p.tempoPoints, markers: p.markers, master: p.master });
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
    step('3 card, caution and tint', /goes up by 9 dB/.test(cardText) && /Turns "Brass Stabs" up by 9 dB/.test(cardText) && /From your agent \(E2E agent\)/.test(cardText) && tinted > 0 && overHeaders === 0, `${tinted} tinted boxes, ${overHeaders} over the headers or ruler`);
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

    // 8. Out of date
    const second = await suggest({ title: 'Busier bass', explanation: 'A pickup into bar 5.', ops: [{ op: 'add_notes', clipId: ids.b, notes: [{ pitch: 'G2', start: 3.75, length: 0.25 }] }] });
    await page.locator(`[data-suggestion="${second.id}"]`).waitFor();
    await A((clipId) => window.__fledgetoneAgent.tl.useTimelineStore.getState().addNotes(clipId, [{ note: 'C3', startOffset: 2.25, duration: '16n', velocity: 0.7 }]), ids.b);
    await statusIs(second.id, 'out_of_date');
    const disabled = await page.locator(`[data-suggestion="${second.id}"] [data-accept]`).isDisabled();
    const heard = await events(since, 5);
    since = heard.last;
    step('8 out of date', disabled && heard.events.some((e) => e.event === 'suggestion' && e.params.id === second.id && e.params.status === 'out_of_date'), 'Accept is off, the agent was told');

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
      heard1 === 1 && refused.past === pastSwing && refused.s.status === 'changed' && /hasn’t been heard/.test(refused.text) && s4.heard === s4.version && s4.version === 2 && moved > 1e-4 && accepted4.s.status === 'accepted' && strip(accepted4.now) === strip(expect4) && accepted4.now.swing === 0.45,
      `version ${s4.version}, B rendered again (differs by ${moved.toFixed(4)})${process.env.VERBOSE ? JSON.stringify({ heard1, refused: [refused.past, pastSwing, refused.s.status, refused.text], s4: [s4.heard, s4.version], acc: accepted4.s.status, same: strip(accepted4.now) === strip(expect4), swing: accepted4.now.swing }) : ''}`
    );

    // 9. Listen
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
    await sixthCard.locator('[data-dismiss]').focus();
    await page.keyboard.press('Space');
    await statusIs(sixth.id, 'dismissed');
    const playing = await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().isPlaying);
    step('9c appended, a fresh card ignores presses, Space presses', layout.a === topBefore && layout.b > layout.a && early.s.status === 'waiting' && /just appeared/.test(early.text) && !playing, `first card at ${topBefore} → ${layout.a}, new at ${layout.b}`);

    // 10. point_at a track
    await page.waitForTimeout(1100);
    await call('point_at', { target: { track: ids.bass }, note: 'The bass' });
    const ringed = await until(() => page.locator('[data-agent-highlight] .border-2').count(), 3000, 'the track ring').catch(() => 0);
    const said = await until(() => A(() => /points at a track/.test(document.querySelector('[data-agent-live]')?.textContent ?? '')), 3000, 'the live region').catch(() => false);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'point-at.png') });
    step('10 point_at', ringed > 0 && !!said);

    // 10b. Another song opened: a waiting suggestion is for another song (being heard, it stops),
    // can't be accepted, and the agent hears so
    await hear(fifth.id);
    since = (await call('studio_status')).lastEvent;
    await A(() => window.__fledgetoneAgent.tl.useTimelineStore.getState().newProject('blank'));
    await statusIs(fifth.id, 'other_song');
    const phase = await A(() => window.__fledgetoneAgent.audition.useAudition.getState().phase);
    const off = await page.locator(`[data-suggestion="${fifth.id}"] [data-accept]`).isDisabled();
    const toldSong = await events(since, 5);
    since = toldSong.last;
    const kept = (await sgOf(fourth.id)).status;
    step(
      '10b another song: not acceptable, stopped, the agent told',
      phase === 'idle' && off && toldSong.events.some((e) => e.event === 'suggestion' && e.params.id === fifth.id && e.params.status === 'other_song') && kept === 'accepted' && !toldSong.events.some((e) => e.params?.id === fourth.id),
      `phase ${phase}; the one accepted earlier stays accepted`
    );
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'other-song.png') });

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
