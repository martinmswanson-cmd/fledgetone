// Glide between chords in a real browser, in the studio and in Pocket: the piano roll's GLIDE
// switched on and off and its time moved (keys held down: one step), Pocket's Glide sheet the
// same; each one exact undo step against the whole song (Undo gives it back as it was, Redo as it
// was after), the studio and Pocket setting the same thing; the lines from each note into the
// note it glides to (as many as the pairing finds, yellow on Wavetable, dashed on Pluck, whose
// voices don't glide, with the note saying so); and playback begun part way through a progression
// and round a loop: as loud as from the start (no voice doubled), and after Stop as quiet as the
// chords played as written.
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/ui-check/chord-glide.cjs
//
// APP_URL overrides http://localhost:5200/; SHOTS=<folder> saves screenshots. Needs Playwright with
// Chromium. Exit code 0 when every step passes.
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const APP = process.env.APP_URL || 'http://localhost:5200/';
const SHOTS = process.env.SHOTS || '';
let failures = 0;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
};
const load1 = () => require('fs').readFileSync('/proc/loadavg', 'utf8').split(' ')[0];

// Four chords a bar each, voiced to move by steps, a bass under them; the same on Pluck
const CHORDS = [
  ['F2', 'A3', 'C4', 'E4', 'G4'],
  ['D2', 'A3', 'C4', 'F4', 'A4'],
  ['G2', 'A#3', 'D4', 'F4', 'A4'],
  ['C2', 'A#3', 'E4', 'G4', 'C5'],
];
const notes = (k) => CHORDS.flatMap((ch, i) => ch.map((note, j) => ({ id: `${k}${i}${j}`, note, startOffset: i, duration: '1m', velocity: 0.7 })));
const SONG = {
  format: 'fledgetone-project',
  version: 1,
  name: 'Glide check',
  bpm: 120,
  swing: 0,
  loopRegion: { inBar: 1, outBar: 9, enabled: false },
  markers: [
    { id: 'm1', bar: 1, name: 'A' },
    { id: 'm2', bar: 5, name: 'B' },
  ],
  tracks: [
    { id: 't1', name: 'Pad', instrumentKey: 'wavetable', volume: -9, pan: 0, reverbSend: 0, delaySend: 0 },
    { id: 't2', name: 'Pluck', instrumentKey: 'pluck', volume: -9, pan: 0, reverbSend: 0, delaySend: 0, isMuted: true },
  ],
  clips: [
    { id: 'c1', trackId: 't1', name: 'Pad', startBar: 1, lengthBars: 4, notes: notes('p') },
    { id: 'c2', trackId: 't2', name: 'Pluck', startBar: 1, lengthBars: 4, notes: notes('q'), glide: { ms: 120 } },
  ],
};

/** In the page: the whole song as text (what Undo must give back exactly) */
const SNAP = async () => {
  const P = await import('/src/store/project.ts');
  const T = await import('/src/store/timelineStore.ts');
  return JSON.stringify(P.serializeProject(T.currentProject()));
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => step('no page error', false, e.message));
  await page.goto(APP + '?studio');
  await page.waitForFunction(() => !!document.querySelector('#menu-file'), null, { timeout: 90000 });
  const load = (p, song = SONG) =>
    p.evaluate(async (s) => {
      const T = await import('/src/store/timelineStore.ts');
      const P = await import('/src/store/project.ts');
      T.useTimelineStore.getState().loadProject(P.parseProject(s));
    }, song);
  await load(page);
  await page.waitForTimeout(800);
  const store = (p, fn, arg) => p.evaluate(async ([f, a]) => new Function('S', 'a', `return (${f})(S, a)`)((await import('/src/store/timelineStore.ts')).useTimelineStore, a), [fn.toString(), arg]);
  const shot = async (p, name) => {
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` });
  };
  const glideOf = (p, id) => store(p, (S, i) => S.getState().clips.find((c) => c.id === i)?.glide ?? null, id);
  /** One user action as one undo step against the whole song */
  const oneStep = async (p, name, before) => {
    const after = await p.evaluate(SNAP);
    step(`${name}: it changed the song`, after !== before);
    await store(p, (S) => S.getState().undo());
    step(`${name}: one Undo gives the whole song back exactly`, (await p.evaluate(SNAP)) === before);
    await store(p, (S) => S.getState().redo());
    step(`${name}: Redo gives it again`, (await p.evaluate(SNAP)) === after);
  };
  const pairsIn = (p, id) => p.evaluate(async (i) => {
    const G = await import('/src/store/chordGlide.ts');
    const c = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState().clips.find((x) => x.id === i);
    return G.clipGlidePairs(c).map((q) => `${q.from.note}>${q.to.note}`).sort();
  }, id);
  const linesIn = async (p) => (await p.locator('svg[data-glide-lines] path').evaluateAll((els) => els.map((e) => ({ glide: e.getAttribute('data-glide'), dashed: !!e.getAttribute('stroke-dasharray') })))).sort((a, b) => (a.glide < b.glide ? -1 : 1));

  // ---------- Studio: the piano roll's GLIDE ----------
  await store(page, (S) => S.getState().openEditor('c1'));
  const toggle = page.getByRole('button', { name: /^GLIDE (ON|OFF)$/ });
  await toggle.waitFor({ timeout: 20000 });
  step('studio: GLIDE starts off, no lines', (await toggle.getAttribute('aria-pressed')) === 'false' && (await linesIn(page)).length === 0);
  let before = await page.evaluate(SNAP);
  await toggle.click();
  await page.waitForTimeout(200);
  step('studio: GLIDE switches it on at 120 ms', JSON.stringify(await glideOf(page, 'c1')) === '{"ms":120}', JSON.stringify(await glideOf(page, 'c1')));
  await oneStep(page, 'studio GLIDE on', before);
  const want = await pairsIn(page, 'c1');
  let lines = await linesIn(page);
  step('studio: a line for each voice gliding, from the same pairing, yellow', lines.length === want.length && lines.every((l, i) => l.glide === want[i] && !l.dashed) && want.length >= 12, `${lines.length} lines, ${want.length} pairs: ${want.slice(0, 6).join(' ')}…`);
  await shot(page, 'studio-glide-lines');
  // Its time: the popover's slider, four presses of the right arrow (one step)
  await page.getByRole('button', { name: 'Glide time' }).click();
  const time = page.locator('input[aria-label="Time"]');
  await time.waitFor();
  before = await page.evaluate(SNAP);
  await time.focus();
  for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  await time.blur();
  step('studio: the time moved by its slider', JSON.stringify(await glideOf(page, 'c1')) === '{"ms":140}', JSON.stringify(await glideOf(page, 'c1')));
  await oneStep(page, 'studio glide time (four key presses)', before);
  before = await page.evaluate(SNAP);
  const bass = page.locator('input[aria-label="Bass"]');
  await bass.focus();
  for (let k = 0; k < 2; k++) await page.keyboard.press('ArrowLeft');
  await bass.blur();
  step('studio: the bass\'s own time', JSON.stringify(await glideOf(page, 'c1')) === '{"ms":140,"bassMs":130}', JSON.stringify(await glideOf(page, 'c1')));
  await oneStep(page, 'studio bass glide time', before);
  await shot(page, 'studio-glide-popover');
  await page.keyboard.press('Escape');
  before = await page.evaluate(SNAP);
  await toggle.click();
  await page.waitForTimeout(200);
  step('studio: GLIDE switches it off, the lines go', (await glideOf(page, 'c1')) === null && (await linesIn(page)).length === 0);
  await oneStep(page, 'studio GLIDE off', before);
  await store(page, (S) => S.getState().undo());
  // Pluck: dashed lines, and the popover says the chords play as written
  await store(page, (S) => S.getState().closeEditor?.());
  await page.keyboard.press('Escape');
  await store(page, (S) => S.getState().openEditor('c2'));
  await page.waitForTimeout(400);
  lines = await linesIn(page);
  step('studio: on Pluck the lines are dashed', lines.length > 0 && lines.every((l) => l.dashed), `${lines.length} lines`);
  await page.getByRole('button', { name: 'Glide time' }).click();
  step('studio: on Pluck it says the chords play as written', (await page.getByText('Pluck plays the chords as written, without gliding').count()) > 0);
  await shot(page, 'studio-glide-pluck');
  await page.keyboard.press('Escape');
  await store(page, (S) => S.getState().closeEditor?.());
  await page.keyboard.press('Escape');

  // ---------- Live: begun part way through the progression, and Stop ----------
  const LIVE = async ({ from, seconds }) => {
    const store = (await import('/src/store/timelineStore.ts')).useTimelineStore;
    const engine = await (await fetch('/src/audio/engine.ts')).text();
    const T = await import(engine.match(/from "([^"]*\/deps\/tone\.js[^"]*)"/)[1]);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await T.start();
    const rec = new T.Recorder();
    T.getDestination().connect(rec);
    store.getState().seek(from);
    await sleep(400);
    rec.start();
    const t0 = performance.now();
    await store.getState().togglePlay();
    await sleep(seconds * 1000);
    store.getState().stop();
    const stopAt = (performance.now() - t0) / 1000;
    await sleep(3000);
    const b = await new AudioContext().decodeAudioData(await (await rec.stop()).arrayBuffer());
    const x = b.getChannelData(0);
    const w = Math.round(b.sampleRate * 0.05);
    const out = [];
    for (let i = 0; i + w <= x.length; i += w) {
      let e = 0;
      for (let j = i; j < i + w; j++) e += x[j] * x[j];
      out.push(10 * Math.log10(e / w + 1e-20));
    }
    return { levels: out, stopAt };
  };
  // (glide on: 120 ms)
  await store(page, (S) => S.getState().setClipGlide('c1', { ms: 120 }));
  const mean = (l, a, b) => 10 * Math.log10(l.slice(Math.round(a / 0.05), Math.round(b / 0.05)).reduce((s, v) => s + 10 ** (v / 10), 0) / Math.max(1, Math.round((b - a) / 0.05)));
  // From bar 1: the third chord sounds 4 to 6 s in; from bar 1.5 (half way through the first chord) it's 3 to 5 s in
  const whole = await page.evaluate(LIVE, { from: 1, seconds: 7 });
  const part = await page.evaluate(LIVE, { from: 1.5, seconds: 6 });
  const a = mean(whole.levels, 4.6, 5.8);
  const b = mean(part.levels, 3.6, 4.8);
  const early = mean(part.levels, 0.4, 0.8);
  step('live: begun half way through a chord, the voices come in at the next chord and are as loud as from the start', Math.abs(a - b) < 1.5 && early < b - 20, `third chord ${b.toFixed(1)} dB (from the start ${a.toFixed(1)} dB), before the next chord ${early.toFixed(1)} dB (load ${load1()})`);
  // Stop: after it, as quiet as the chords played as written
  await store(page, (S) => S.getState().setClipGlide('c1', null));
  const plain = await page.evaluate(LIVE, { from: 1.5, seconds: 6 });
  const tail = (r) => mean(r.levels, r.stopAt + 2.2, r.stopAt + 2.8);
  step('live: after Stop the gliding voices fade as the chords as written do', tail(part) < tail(plain) + 3 && tail(part) < -60, `2.5 s after Stop ${tail(part).toFixed(1)} dB (as written ${tail(plain).toFixed(1)} dB)`);

  // ---------- Pocket ----------
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await pctx.addInitScript(() => {
    try {
      localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
    } catch {}
  });
  const pk = await pctx.newPage();
  pk.on('pageerror', (e) => step('Pocket: no page error', false, e.message));
  await pk.goto(APP + '?pocket');
  await pk.waitForTimeout(3000);
  const cont = pk.getByRole('button', { name: 'Continue' });
  if (await cont.count()) await cont.first().click();
  await load(pk);
  await pk.waitForTimeout(800);
  if (await cont.count()) await cont.first().click();
  const pocket = (patch) => pk.evaluate(async (p) => (await import('/src/pocket/pocketStore.ts')).usePocket.getState().set(p), patch);
  await pocket({ trackId: 't1', section: 0, tool: 'draw', drawer: 'full' });
  await pk.waitForTimeout(600);
  const chip = pk.getByRole('button', { name: /^Glide between chords: (on|off)$/ });
  step('Pocket: the roll has Glide, off, no lines', (await chip.count()) === 1 && (await chip.getAttribute('aria-label')).endsWith('off') && (await linesIn(pk)).length === 0);
  await chip.click();
  await pk.waitForTimeout(300);
  await shot(pk, 'pocket-glide-sheet');
  before = await pk.evaluate(SNAP);
  await pk.getByRole('dialog').getByText('Glide between chords: off').click();
  await pk.waitForTimeout(300);
  step('Pocket: the sheet switches it on, as the studio does', JSON.stringify(await glideOf(pk, 'c1')) === '{"ms":120}', JSON.stringify(await glideOf(pk, 'c1')));
  await oneStep(pk, 'Pocket Glide on', before);
  const ptime = pk.getByRole('dialog').locator('input[aria-label="Glide time"]');
  before = await pk.evaluate(SNAP);
  await ptime.focus();
  for (let k = 0; k < 4; k++) await pk.keyboard.press('ArrowRight');
  await ptime.blur();
  step('Pocket: the time moved by its slider, as the studio\'s', JSON.stringify(await glideOf(pk, 'c1')) === '{"ms":140}', JSON.stringify(await glideOf(pk, 'c1')));
  await oneStep(pk, 'Pocket glide time (four key presses)', before);
  await pocket({ sheet: null });
  await pk.waitForTimeout(400);
  const pwant = await pairsIn(pk, 'c1');
  const plines = await linesIn(pk);
  step('Pocket: the roll draws a line for each voice gliding, from the same pairing', plines.length === pwant.length && plines.every((l, i) => l.glide === pwant[i] && !l.dashed), `${plines.length} lines, ${pwant.length} pairs`);
  await shot(pk, 'pocket-glide-lines');

  await browser.close();
  console.log(failures ? `${failures} failed` : 'all passed');
  process.exit(failures ? 1 : 0);
})();
