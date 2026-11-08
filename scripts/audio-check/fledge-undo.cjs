// Fledge Synth, undo and redo of a preset chosen from "(your own sound)", in the studio's plugin
// window and in Pocket's Sound tool. Undo must be exact: the shown name goes back to "(your own
// sound)", the track's saved settings have no preset again (also after the live settings are next
// read onto the track), every setting is as before, Previous/Next start from "(your own sound)"
// (Next: the first preset), and Redo brings the preset back. The sound: a chord held through the
// undo plays on (not cut, no click), live and in an offline render, where the undo sounds exactly
// as setting the same values one by one does.
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/audio-check/fledge-undo.cjs
//
// APP_URL overrides http://localhost:5200/. Needs Playwright with Chromium. Exit code 0 when every
// step passes. The live part is timing-sensitive: run it on a quiet machine (it prints the load).
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}
const os = require('os');

const APP = process.env.APP_URL || 'http://localhost:5200/';
const load = () => os.loadavg().map((x) => x.toFixed(2)).join(' ');
let failures = 0;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
};
const NEURO = 5;
const OWN = '(your own sound)';

(async () => {
  console.log('load', load());
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  // --- The studio's plugin window ---
  {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
      } catch {}
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => step('studio: no page error', false, e.message));
    await page.goto(APP + '?studio');
    await page.waitForFunction(() => !!document.querySelector('#menu-file'), null, { timeout: 60000 });
    await page.mouse.click(800, 980);
    // A Fledge Synth track as the Add Track picker makes one: on "(your own sound)"
    await page.evaluate(async () => {
      (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().newProject('blank');
      await (await import('/src/audio/engine.ts')).initAudio();
      const B = await import('/src/store/builtinPlugins.ts');
      window.__tid = B.addBuiltinPlugin(B.allBuiltinPlugins().find((x) => x.info.name === 'Fledge Synth'), null);
    });
    await page.waitForSelector('select[aria-label="Preset"]', { timeout: 30000 });
    await page.waitForTimeout(1200);
    const snap = () =>
      page.evaluate(async () => {
        const T = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState();
        const W = await import('/src/audio/wamHost.ts');
        // (Read onto the track now, as the next read would)
        await W.captureWamStates();
        const t = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().tracks.find((x) => x.id === window.__tid);
        const live = W.liveWam(t.plugin.id);
        const st = live?.audioNode.getStateNow();
        const sel = document.querySelector('select[aria-label="Preset"]');
        return { steps: T.past.length, shows: sel?.options[sel.selectedIndex]?.text, live: st?.program ?? null, saved: t.plugin.state?.program ?? null, values: st?.values };
      });
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    const start = await snap();
    step('studio: a new Fledge Synth starts on "(your own sound)"', start.shows === OWN && start.live === null && start.saved === null, JSON.stringify({ ...start, values: start.values.length }));
    await page.selectOption('select[aria-label="Preset"]', String(NEURO));
    await page.waitForTimeout(1000);
    const preset = await snap();
    step('studio: a preset chosen', preset.shows === 'Neuro' && preset.live === NEURO && preset.saved === NEURO && preset.steps === start.steps + 1);
    const undo = async () => {
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(800);
    };
    const redo = async () => {
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.keyboard.press('Control+y');
      await page.waitForTimeout(800);
    };
    await undo();
    let s = await snap();
    step('studio: Ctrl+Z shows "(your own sound)" again', s.shows === OWN, s.shows);
    step('studio: Ctrl+Z, no preset live or on the track', s.live === null && s.saved === null, JSON.stringify({ live: s.live, saved: s.saved }));
    step('studio: Ctrl+Z, every setting as before', same(s.values, start.values) && s.steps === start.steps);
    // The track's settings are read again every few seconds: still none
    await page.waitForTimeout(3500);
    s = await snap();
    step('studio: after the next read, still no preset on the track', s.saved === null && s.shows === OWN, JSON.stringify({ saved: s.saved, shows: s.shows }));
    await redo();
    s = await snap();
    step('studio: Ctrl+Y brings the preset back', s.shows === 'Neuro' && s.live === NEURO && s.saved === NEURO && same(s.values, preset.values), JSON.stringify({ shows: s.shows, live: s.live, saved: s.saved }));
    await undo();
    // Next from "(your own sound)": the first preset; Previous: the last
    const names = await page.evaluate(() => [...document.querySelector('select[aria-label="Preset"]').options].map((o) => o.text));
    await page.click('button[aria-label="Next preset"]');
    await page.waitForTimeout(800);
    s = await snap();
    step('studio: Next after the undo goes to the first preset', s.live === 0, `${s.shows} (${s.live})`);
    await undo();
    await page.click('button[aria-label="Previous preset"]');
    await page.waitForTimeout(800);
    s = await snap();
    const last = names.length - 2;
    step('studio: Previous after the undo goes to the last preset', s.live === last, `${s.shows} (${s.live})`);
    await undo();

    // Live: a chord held through Ctrl+Z after a preset plays on (no window of it silent, no jump)
    console.log('load', load());
    await page.selectOption('select[aria-label="Preset"]', String(NEURO));
    await page.waitForTimeout(800);
    const levels = await page.evaluate(async () => {
      const T = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState();
      const W = await import('/src/audio/wamHost.ts');
      const node = W.liveWam(T.tracks.find((x) => x.id === window.__tid).plugin.id).audioNode;
      const ac = node.context;
      // (One tap for the whole check, kept for the reads after the undo)
      const tap = (window.__tap = ac.createAnalyser());
      tap.fftSize = 2048;
      node.connect(tap);
      const buf = new Float32Array(tap.fftSize);
      const rms = () => {
        tap.getFloatTimeDomainData(buf);
        let e = 0;
        for (const v of buf) e += v * v;
        return Math.sqrt(e / buf.length);
      };
      for (const n of [45, 52, 57]) node.scheduleEvents({ type: 'wam-midi', time: ac.currentTime + 0.05, data: { bytes: [0x90, n, 110] } });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(600);
      const before = [];
      for (let i = 0; i < 6; i++) {
        before.push(rms());
        await wait(40);
      }
      return { before };
    });
    await undo();
    const after = await page.evaluate(async () => {
      const T = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState();
      const W = await import('/src/audio/wamHost.ts');
      const node = W.liveWam(T.tracks.find((x) => x.id === window.__tid).plugin.id).audioNode;
      const ac = node.context;
      const tap = window.__tap;
      const buf = new Float32Array(tap.fftSize);
      const out = [];
      for (let i = 0; i < 8; i++) {
        tap.getFloatTimeDomainData(buf);
        let e = 0;
        for (const v of buf) e += v * v;
        out.push(Math.sqrt(e / buf.length));
        await new Promise((r) => setTimeout(r, 40));
      }
      for (const n of [45, 52, 57]) node.scheduleEvents({ type: 'wam-midi', time: ac.currentTime, data: { bytes: [0x80, n, 0] } });
      node.disconnect(tap);
      return out;
    });
    const lo = Math.min(...levels.before);
    step('live: the chord sounds before the undo', lo > 0.01, levels.before.map((x) => x.toFixed(3)).join(' '));
    step('live: the held chord plays on through the undo (no window silent)', Math.min(...after) > lo * 0.2, after.map((x) => x.toFixed(3)).join(' '));
    s = await snap();
    step('live: and the undo shows "(your own sound)"', s.shows === OWN && s.live === null, s.shows);
    console.log('load', load());

    // Offline: the undo while a chord holds sounds exactly as setting the values one by one does
    const offline = await page.evaluate(async (NEURO) => {
      const W = await import('/src/audio/wamHost.ts');
      const sr = 48000;
      const run = async (how) => {
        const ctx = new OfflineAudioContext(2, sr * 2, sr);
        const inst = await W.loadWam(ctx, 'builtin:fledge/Fledge Synth', { builtin: 1 }, false);
        const node = inst.audioNode;
        node.connect(ctx.destination);
        const own = node.getStateNow();
        await inst.controls.setProgram(NEURO);
        await new Promise((r) => setTimeout(r, 300));
        for (const n of [45, 52, 57]) node.scheduleEvents({ type: 'wam-midi', time: 0.1, data: { bytes: [0x90, n, 110] } });
        await new Promise((r) => setTimeout(r, 300));
        let program = null;
        ctx.suspend(1.0).then(async () => {
          if (how === 'undo') await node.setState(own);
          else own.values.forEach((v, i) => inst.controls.set(i, v));
          await new Promise((r) => setTimeout(r, 300));
          program = inst.controls.program();
          ctx.resume();
        });
        const x = (await ctx.startRendering()).getChannelData(0);
        node.destroy?.();
        const rms = (a, b) => {
          let e = 0;
          for (let i = a; i < b; i++) e += x[i] * x[i];
          return Math.sqrt(e / (b - a));
        };
        const step = (a, b) => {
          let m = 0;
          for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
          return m;
        };
        return { x, program, before: rms(sr - 9600, sr), after: rms(sr + 2400, sr + 12000), stepAt: step(sr - 256, sr + 256), stepHeld: step(sr - 24000, sr - 256) };
      };
      const a = await run('undo');
      const b = await run('values');
      let diff = 0;
      for (let i = 0; i < a.x.length; i++) diff = Math.max(diff, Math.abs(a.x[i] - b.x[i]));
      return { program: a.program, before: a.before, after: a.after, stepAt: a.stepAt, stepHeld: a.stepHeld, diff };
    }, NEURO);
    step('offline: the undo goes back to no preset', offline.program === -1, String(offline.program));
    step('offline: the held chord plays on through the undo', offline.after > offline.before * 0.3, `rms ${offline.before.toFixed(4)} -> ${offline.after.toFixed(4)}`);
    step('offline: the undo sounds exactly as setting the same values does', offline.diff === 0, `largest difference ${offline.diff}`);
    await ctx.close();
  }

  // --- Pocket's Sound tool ---
  {
    const song = {
      format: 'fledgetone-project',
      version: 1,
      name: 'Undo',
      bpm: 120,
      swing: 0,
      loopRegion: { inBar: 1, outBar: 5, enabled: false },
      tracks: [{ id: 'tf', name: 'Synth', instrumentKey: 'plugin', volume: -30, pan: 0, reverbSend: 0, delaySend: 0, plugin: { id: 'pf', url: 'builtin:fledge/Fledge Synth', name: 'Fledge Synth' } }],
      clips: [],
    };
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
      } catch {}
    });
    const pk = await ctx.newPage();
    pk.on('pageerror', (e) => step('Pocket: no page error', false, e.message));
    await pk.goto(APP + '?pocket');
    await pk.waitForTimeout(3000);
    const cont = pk.getByRole('button', { name: 'Continue' });
    if (await cont.count()) await cont.first().click();
    await pk.evaluate(async (song) => {
      const T = await import('/src/store/timelineStore.ts');
      const P = await import('/src/store/project.ts');
      T.useTimelineStore.getState().loadProject(P.parseProject(song));
      T.useTimelineStore.setState({ selectedTrackId: 'tf' });
    }, song);
    await pk.waitForTimeout(800);
    if (await cont.count()) await cont.first().click();
    await pk.getByRole('button', { name: 'Sound', exact: true }).click();
    await pk.waitForTimeout(600);
    const startBtn = pk.getByRole('button', { name: /Start the sound/ });
    if (await startBtn.count()) await startBtn.click();
    await pk.waitForSelector('select[aria-label="Preset"]', { timeout: 30000 });
    await pk.waitForTimeout(1200);
    const snap = () =>
      pk.evaluate(async () => {
        const W = await import('/src/audio/wamHost.ts');
        await W.captureWamStates();
        const t = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().tracks.find((x) => x.id === 'tf');
        const st = W.liveWam('pf')?.audioNode.getStateNow();
        const sel = document.querySelector('select[aria-label="Preset"]');
        const note = [...document.querySelectorAll('p')].map((p) => p.innerText).find((x) => /no macros/.test(x)) || '';
        const macros = [...document.querySelectorAll('label span.font-semibold')].map((e) => e.innerText).join(', ');
        return { shows: sel?.options[sel.selectedIndex]?.text, live: st?.program ?? null, saved: t.plugin.state?.program ?? null, macros, note, values: st?.values };
      });
    const start = await snap();
    step('Pocket: the Sound tool starts on "(your own sound)"', start.shows === OWN && start.live === null, JSON.stringify({ ...start, values: undefined }));
    await pk.selectOption('select[aria-label="Preset"]', String(NEURO));
    await pk.waitForTimeout(1200);
    const preset = await snap();
    step('Pocket: a preset chosen shows its macros', preset.shows === 'Neuro' && !!preset.macros && !preset.note, JSON.stringify({ ...preset, values: undefined }));
    await pk.getByRole('button', { name: 'Undo', exact: true }).click();
    await pk.waitForTimeout(1200);
    let s = await snap();
    step('Pocket: Undo shows "(your own sound)" again', s.shows === OWN && s.live === null && s.saved === null, JSON.stringify({ ...s, values: undefined }));
    step('Pocket: Undo, every setting as before', s.values.every((v, i) => v === start.values[i]));
    const redo = pk.getByRole('button', { name: 'Redo', exact: true });
    if (await redo.count()) {
      await redo.click();
      await pk.waitForTimeout(1200);
      s = await snap();
      step('Pocket: Redo brings the preset and its macros back', s.shows === 'Neuro' && s.live === NEURO && !!s.macros, JSON.stringify({ ...s, values: undefined }));
      await pk.getByRole('button', { name: 'Undo', exact: true }).click();
      await pk.waitForTimeout(1200);
    }
    await pk.click('button[aria-label="Next preset"]');
    await pk.waitForTimeout(1200);
    s = await snap();
    step('Pocket: Next after the undo goes to the first preset', s.live === 0, `${s.shows} (${s.live})`);
    await ctx.close();
  }

  console.log('load', load());
  console.log(failures ? `${failures} step(s) failed` : 'every step passed');
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
