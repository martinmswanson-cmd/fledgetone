// Screenshots and examples for learn/06-mix-and-master.md (taken by scripts/guide-shots/capture.mjs --learn).
// Every setup builds the lesson's mix of the Synthwave starter through the UI, as far as its step.

/** The lesson's mix, step by step (the worked examples in the lesson). */
const LEVELS = { Drums: -4, Bass: -6, Lead: -8, Arp: -12, Strings: -14, 'Poly pad': -16 };
const PANS = { Strings: -0.3, Arp: 0.3 };
const SENDS = { Drums: [0.1, 0], Bass: [0, 0], 'Poly pad': [0.4, 0], Strings: [0.3, 0], Arp: [0, 0.25], Lead: [0.3, 0.2] };
/** Pro EQ moves: [band (1-6), on, frequency slider position, gain, Q slider position] */
const hz = (f) => Math.round((1000 * Math.log(f / 20)) / Math.log(1000));
const EQ = {
  'Poly pad': [[1, hz(150)], [3, hz(300), -3, Math.log(1.4)]],
  Strings: [[1, hz(120)]],
  Arp: [[1, hz(250)]],
  Lead: [[1, hz(200)], [4, hz(2500), 2]],
};
const STAGES = ['levels', 'pan', 'eq', 'comp', 'sends', 'bus', 'master'];

/** A slider (or checkbox) by its exact label. */
const range = (scope, label) => scope.locator(`input[aria-label="${label}"]`);

/** Set a range slider to a value with the arrow keys, as a reader can. */
async function setRange(s, locator, target) {
  const el = locator.first();
  await el.scrollIntoViewIfNeeded();
  await el.focus();
  const step = Number((await el.getAttribute('step')) ?? 1) || 1;
  for (let i = 0; i < 4; i++) {
    const v = Number(await el.inputValue());
    const n = Math.round((target - v) / step);
    if (!n) break;
    for (let k = 0; k < Math.abs(n); k++) await s.page.keyboard.press(n > 0 ? 'ArrowRight' : 'ArrowLeft');
    await s.wait(50);
  }
  await el.blur();
}

/**
 * Set the Pro EQ's FREQ slider: a click along it for the rough place, as dragging does, then the
 * arrow keys (alone they can't move a low band: a step there is under a hertz and rounds back).
 */
async function setFreq(s, slider, target) {
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  await s.page.mouse.click(box.x + 8 + ((box.width - 16) * target) / 1000, box.y + box.height / 2);
  await s.wait(80);
  await setRange(s, slider, target);
  if (process.env.DEBUG) console.log('freq', target, await slider.inputValue());
}

/** Open a track in the Inspector (Track FX). */
async function inspect(s, name) {
  await s.page.getByTitle(`${name}: open in the Inspector`, { exact: true }).last().click();
  await s.wait(600);
  const tab = s.page.locator('button', { hasText: /^\s*Track FX\s*$/ }).last();
  if (await tab.count()) await tab.click();
  await s.wait(300);
}

/** An insert panel of the Inspector, switched on. */
async function insert(s, title) {
  const panel = s.page.locator(`[data-search="${title}"]`).last();
  await panel.scrollIntoViewIfNeeded();
  const off = panel.getByRole('switch', { name: `${title} off` }).or(panel.locator(`[aria-label="${title} off"]`));
  if (await off.count()) { await off.first().click(); await s.wait(300); }
  return panel;
}

/** The Synthwave starter, its recordings allowed to download, mixed up to `upto`. */
async function build(s, upto = 'master') {
  const T = Date.now();
  await s.page.unroute(/github\.io|githubusercontent/);
  await s.starter('Synthwave');
  await s.wait(4000);
  const done = (st) => STAGES.indexOf(st) <= STAGES.indexOf(upto);
  await s.view('Mixer');
  if (done('levels')) for (const [t, v] of Object.entries(LEVELS)) await setRange(s, range(s.page, `${t} volume`), v);
  if (done('pan')) for (const [t, v] of Object.entries(PANS)) await setRange(s, range(s.page, `${t} pan`), v);
  if (done('eq')) {
    for (const [t, moves] of Object.entries(EQ)) {
      await inspect(s, t);
      const panel = await insert(s, 'Pro EQ');
      await panel.getByTitle('Back to the starting bands, all flat').click();
      await s.wait(200);
      for (const [band, freq, gain, q] of moves) {
        await panel.locator('circle').nth(band - 1).click({ force: true });
        await s.wait(150);
        const on = range(panel, `Band ${band} on`);
        if (!(await on.isChecked())) await on.check();
        await setFreq(s, range(panel, 'Band frequency'), freq);
        if (gain !== undefined) await setRange(s, range(panel, 'Band gain'), gain);
        if (q !== undefined) await setRange(s, range(panel, 'Band width (Q)'), q);
      }
    }
  }
  if (done('comp')) {
    await inspect(s, 'Bass');
    const c = await insert(s, 'Compressor');
    await setRange(s, range(c, 'Threshold'), -18);
    await setRange(s, range(c, 'Ratio'), 3);
    await setRange(s, range(c, 'Makeup'), 2);
  }
  if (done('sends')) {
    for (const [t, [rev, dly]] of Object.entries(SENDS)) {
      await setRange(s, range(s.page, `${t} reverb send`), rev);
      await setRange(s, range(s.page, `${t} delay send`), dly);
    }
    await inspect(s, 'Lead');
    await s.tab('Master');
    await s.page.getByRole('button', { name: '1/8D', exact: true }).click();
    await s.wait(200);
  }
  if (done('bus')) await s.menu('Track', 'Bus preset: Drum bus');
  if (done('master')) {
    await inspect(s, 'Lead');
    await s.tab('Master');
    await s.page.locator('select').filter({ has: s.page.locator('option', { hasText: 'Punchy' }) }).first().selectOption({ label: 'Punchy' });
    await setRange(s, range(s.page.locator('[data-search="OTT"]'), 'Depth'), 0.2);
    await setRange(s, range(s.page.locator('[data-search="Stereo Width"]'), 'Width'), 1.2);
    await setRange(s, range(s.page, 'Level'), 3);
    const clip = await insert(s, 'Clipper');
    await setRange(s, range(clip, 'Drive'), 4);
  }
  await s.page.mouse.move(700, 4);
  if (process.env.DEBUG) {
    console.log('built', upto, (Date.now() - T) / 1000);
    console.log(await s.page.evaluate(() => [...document.querySelectorAll('input[type=range],select')].filter((e) => e.offsetParent).map((e) => `${e.getAttribute('aria-label') ?? e.closest('label')?.innerText?.slice(0, 12)}=${e.value}`).join(' ; ')));
  }
}

/** Play from the start of the Groove section (bar 5) for a while. */
async function play(s, ms) {
  const bar5 = await s.page.getByText('5.1', { exact: true }).first().boundingBox();
  await s.page.mouse.click(bar5.x + 4, bar5.y + bar5.height / 2);
  await s.wait(200);
  await s.page.keyboard.press('Space');
  await s.wait(ms);
}

export const SHOTS = [
  {
    file: 'mix-levels',
    alt: 'The Mixer with the Synthwave starter: Drums at -4 dB, Bass -6, Poly pad -16, Strings -14 panned L30, Arp -12 panned R30, Lead -8, and the master on the right.',
    caption: 'The levels from the worked example: drums loudest, the pad furthest back.',
    setup: async (s) => {
      await build(s, 'pan');
      await play(s, 4000);
      return s.union([s.q('[aria-label="Drums channel"]'), s.q('[aria-label="Master channel"]')], 10);
    },
  },
  {
    file: 'mix-eq',
    alt: 'The Pro EQ of the Poly pad, open big in the EQ & Dynamics tab: a low cut at 150 Hz and a 3 dB dip at 300 Hz.',
    caption: 'The pad\'s Pro EQ: a low cut at 150 Hz and 3 dB less mud at 300 Hz.',
    setup: async (s) => {
      await build(s, 'eq');
      await inspect(s, 'Poly pad');
      await s.page.locator('[data-search="Pro EQ"] circle').nth(2).click({ force: true });
      await s.view('EQ & Dynamics');
      await play(s, 5000);
      return s.panel();
    },
  },
  {
    file: 'mix-compressor',
    alt: 'The Compressor in the Bass track\'s Inspector, switched on: Threshold -18 dB, Ratio 3:1, Makeup +2 dB.',
    caption: 'A compressor on the bass: Threshold -18 dB, Ratio 3:1, Makeup +2 dB.',
    setup: async (s) => {
      await build(s, 'comp');
      await inspect(s, 'Bass');
      const c = s.page.locator('[data-search="Compressor"]').last();
      await c.scrollIntoViewIfNeeded();
      return s.union([c], 8);
    },
  },
  {
    file: 'mix-drum-bus',
    alt: 'The track headers: Drums now shows "→ Drum bus", and a new Drum bus track sits under it, marked BUS · 1.',
    caption: 'Track › Bus preset: Drum bus puts the drums through one bus with glue compression.',
    setup: async (s) => {
      await build(s, 'bus');
      const b = await s.union([s.own('Tracks'), s.page.getByText('BUS · 1', { exact: true })], 12);
      return { ...b, height: b.height + 70 };
    },
  },
  {
    file: 'mix-master',
    alt: 'The Master tab while the song plays: the Loudness readings, Glue set to Punchy, OTT on at 20% and Stereo Width at 120%.',
    caption: 'The Master tab while the song plays: loudness at the top, then Glue, OTT and Stereo Width.',
    setup: async (s) => {
      await build(s, 'master');
      await play(s, 9000);
      const top = s.page.getByText('Loudness', { exact: true }).first();
      await top.scrollIntoViewIfNeeded();
      return s.union([top, s.page.locator('[data-search="Stereo Width"]')], 12);
    },
  },
  {
    file: 'mix-clipper',
    alt: 'The master Level at +3 dB and the Clipper switched on with Drive +2 dB, its meter showing the dB it takes off the peaks.',
    caption: 'Level pushes the mix into the limiter; the Clipper shaves the drum peaks first.',
    setup: async (s) => {
      await build(s, 'master');
      await play(s, 9000);
      const clip = s.page.locator('[data-search="Clipper"]').last();
      await clip.scrollIntoViewIfNeeded();
      return s.union([range(s.page, 'Level').locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), clip], 8);
    },
  },
];

export const EXAMPLES = [
  {
    name: 'synthwave-mix',
    label: 'The Synthwave starter with this lesson\'s mix: levels, pans, EQ, compression, sends, a drum bus and the master.',
    setup: async (s) => { await build(s, 'master'); },
  },
];
