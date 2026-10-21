// Screenshots and examples for learn/06-mix-and-master.md (taken by scripts/guide-shots/capture.mjs --learn).
// Every setup builds the lesson's mix of the Lo-Fi starter through the UI, as far as its step.

/** The lesson's mix, step by step (the worked examples in the lesson). */
const LEVELS = { Drums: -4, Bass: -6, Flute: -10, Keys: -12, Rain: -24 };
const PANS = { Keys: -0.3, Flute: 0.2 };
const SENDS = { Drums: [0.1, 0], Bass: [0, 0], Keys: [0.3, 0], Flute: [0.35, 0.2], Rain: [0.3, 0] };
/** Pro EQ moves: [band (1-6), FREQ slider position, gain, Q slider position] */
const hz = (f) => Math.round((1000 * Math.log(f / 20)) / Math.log(1000));
const EQ = {
  Keys: [[1, hz(150)], [3, hz(300), -3, Math.log(1.4)]],
  Flute: [[1, hz(250)], [4, hz(2500), 2]],
  Rain: [[1, hz(300)]],
};
/** A fix the Mix check may ask for: the keys give way to the bass at 300 Hz (on a free band) */
const FIX = [[2, hz(300), -3]];
const STAGES = ['levels', 'pan', 'eq', 'comp', 'sends', 'bus', 'master', 'fix', 'club'];

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

/** Pro EQ moves on a track, from flat when `reset`. */
async function eq(s, track, moves, reset = false) {
  await inspect(s, track);
  const panel = await insert(s, 'Pro EQ');
  if (reset) {
    await panel.getByTitle('Back to the starting bands, all flat').click();
    await s.wait(200);
  }
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

/** The Lo-Fi starter, mixed up to `upto`. Its recordings may download (the meters and loudness need the real sound). */
async function build(s, upto = 'master') {
  await s.page.unroute(/github\.io|githubusercontent/);
  await s.starter('Lo-Fi');
  await s.wait(4000);
  const done = (st) => STAGES.indexOf(st) <= STAGES.indexOf(upto);
  await s.view('Mixer');
  if (done('levels')) for (const [t, v] of Object.entries(LEVELS)) await setRange(s, range(s.page, `${t} volume`), v);
  if (done('pan')) for (const [t, v] of Object.entries(PANS)) await setRange(s, range(s.page, `${t} pan`), v);
  if (done('eq')) for (const [t, moves] of Object.entries(EQ)) await eq(s, t, moves, true);
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
    await inspect(s, 'Flute');
    await s.tab('Master');
    await s.page.getByRole('button', { name: '1/8D', exact: true }).click();
    await s.wait(200);
  }
  if (done('bus')) await s.menu('Track', 'Bus preset: Drum bus');
  if (done('master')) {
    await inspect(s, 'Flute');
    await s.tab('Master');
    await s.page.locator('select').filter({ has: s.page.locator('option', { hasText: 'Gentle' }) }).first().selectOption({ label: 'Gentle' });
    await insert(s, 'OTT');
    await setRange(s, range(s.page.locator('[data-search="OTT"]'), 'Depth'), 0.2);
    await setRange(s, range(s.page.locator('[data-search="Stereo Width"]'), 'Width'), 1.2);
    await setRange(s, range(s.page, 'Level'), 4);
  }
  if (done('fix')) {
    await eq(s, 'Keys', FIX);
    await inspect(s, 'Keys');
    await s.tab('Master');
  }
  if (done('club')) {
    await setRange(s, range(s.page, 'Level'), 7);
    const clip = await insert(s, 'Clipper');
    await setRange(s, range(clip, 'Drive'), 4);
  }
  await s.page.mouse.move(700, 4);
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
    alt: 'The Mixer with the Lo-Fi starter: Drums at -4 dB, Bass -6, Flute -10 panned R20, Keys -12 panned L30, Rain -24, and the master on the right.',
    caption: 'The levels from the worked example: drums loudest, the rain furthest back.',
    setup: async (s) => {
      await build(s, 'pan');
      // A taller bottom panel, so the strips show whole
      const grip = await s.page.getByRole('separator', { name: 'Resize the bottom panel' }).boundingBox();
      await s.page.mouse.move(grip.x + grip.width / 2, grip.y + 2);
      await s.page.mouse.down();
      await s.page.mouse.move(grip.x + grip.width / 2, grip.y - 160, { steps: 8 });
      await s.page.mouse.up();
      await play(s, 8000);
      await s.page.keyboard.press('Space');
      await play(s, 3000);
      return s.union([s.q('[aria-label="Drums channel"]'), s.q('[aria-label="Master channel"]')], 10);
    },
  },
  {
    file: 'mix-eq',
    alt: 'The Pro EQ of the Keys, open big in the EQ & Dynamics tab: a low cut at 150 Hz and a 3 dB dip at 300 Hz.',
    caption: 'The keys\' Pro EQ: a low cut at 150 Hz and 3 dB less mud at 300 Hz.',
    setup: async (s) => {
      await build(s, 'eq');
      await inspect(s, 'Keys');
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
      const b = await s.union([s.own('Tracks'), s.page.getByText(/^bus · 1$/i)], 12);
      return { ...b, width: b.width - 12, height: b.height + 82 };
    },
  },
  {
    file: 'mix-master',
    alt: 'The Master tab while the song plays: the Loudness readings, Glue set to Gentle, OTT on at 20% and Stereo Width at 120%.',
    caption: 'The Master tab while the song plays: loudness at the top, then Glue, OTT and Stereo Width.',
    setup: async (s) => {
      await build(s, 'master');
      // A first play lets every instrument's recordings arrive; the second is the one measured
      await play(s, 8000);
      await s.page.keyboard.press('Space');
      await s.page.getByTitle('Start measuring again').click();
      await play(s, 10000);
      const top = s.page.getByText('Loudness', { exact: true }).first();
      await top.scrollIntoViewIfNeeded();
      return s.union([top, s.page.locator('[data-search="Stereo Width"]')], 12);
    },
  },
  {
    file: 'mix-check',
    alt: 'The Mix check after a check of the mix, listing what it found, with buttons to select each track.',
    caption: 'Check the mix: it lists what to look at, track by track.',
    setup: async (s) => {
      await build(s, 'master');
      const run = s.page.getByTestId('mix-check-run');
      await run.scrollIntoViewIfNeeded();
      await run.click();
      const found = s.page.getByTestId('mix-check-findings');
      await found.waitFor({ timeout: 120000 });
      await found.scrollIntoViewIfNeeded();
      return s.union([s.page.locator('[data-search^="mix check"]').last()], 8);
    },
  },
  {
    file: 'mix-clipper',
    alt: 'The master Level turned up and the Clipper switched on with Drive +4 dB, its meter showing how much it takes off the peaks.',
    caption: 'For a loud club master: the Level up and the Clipper at +4 dB, shaving the drum peaks.',
    setup: async (s) => {
      await build(s, 'club');
      await play(s, 9000);
      const clip = s.page.locator('[data-search="Clipper"]').last();
      await clip.scrollIntoViewIfNeeded();
      return s.union([range(s.page, 'Level').locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), clip], 8);
    },
  },
];

export const EXAMPLES = [
  {
    name: 'lofi-mix',
    label: 'The Lo-Fi starter with this lesson\'s mix: levels, pans, EQ, compression, sends, a drum bus and the master.',
    setup: async (s) => { await build(s, 'fix'); },
  },
];
