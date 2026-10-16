// Screenshots and examples for learn/12-pocket.md (taken by scripts/guide-shots/capture.mjs --learn).
// Every shot is taken in Pocket on a phone-sized screen. The helpers below build the lesson's song
// step by step, the way the lesson does it, by tapping and sliding on Pocket's own buttons.

/** One of the six tabs along the bottom. */
async function tab(s, name) {
  await s.page.locator('nav button', { hasText: name }).click();
  await s.page.waitForTimeout(600);
}

/** A button in the screen (not the tabs) by its whole text. */
const button = (s, text) => s.page.locator('main button', { hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();

/** A box in the phone's window (not the page): what a shot keeps once the page has scrolled. */
async function inView(s, locators, pad = 8) {
  const boxes = [];
  for (const l of [].concat(locators)) {
    const b = await l.first().boundingBox();
    if (b) boxes.push(b);
  }
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad), y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const x1 = Math.min(412, Math.max(...boxes.map((b) => b.x + b.width)) + pad), y1 = Math.min(860, Math.max(...boxes.map((b) => b.y + b.height)) + pad);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Scroll the page so an element sits just under the transport. */
async function scrollTo(s, locator) {
  await locator.first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 72));
  await s.page.waitForTimeout(300);
}

/** The card a heading belongs to. */
const card = (s, title) => s.page.locator('main section').filter({ has: s.page.locator('h2', { hasText: title }) }).first();

/** Song › New › Empty song. */
async function emptySong(s) {
  await s.page.getByRole('button', { name: 'New' }).first().click();
  await s.page.waitForTimeout(400);
  await s.page.getByText('Empty song').click();
  await s.page.waitForTimeout(1500);
  await s.page.getByLabel('Song name').fill('Pocket House');
}

/** A cell's middle, for a finger. */
async function cell(s, row, step) {
  const b = await s.page.getByLabel(`${row}, step ${step}`, { exact: true }).boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
}
async function tapCell(s, row, step) {
  const [x, y] = await cell(s, row, step);
  await s.page.mouse.click(x, y);
}
/** Press a cell and slide along its row to another. */
async function slide(s, row, from, to) {
  const [x0, y] = await cell(s, row, from);
  const [x1] = await cell(s, row, to);
  await s.page.mouse.move(x0, y);
  await s.page.mouse.down();
  for (let i = 1; i <= 60; i++) await s.page.mouse.move(x0 + ((x1 - x0) * i) / 60, y);
  await s.page.mouse.up();
}

/** Beat: a new one-bar pattern with the lesson's beat painted in, and a little swing. */
async function paintBeat(s) {
  await tab(s, 'Beat');
  await button(s, 'New').click();
  await s.page.waitForTimeout(500);
  await scrollTo(s, card(s, 'Steps'));
  for (const st of [1, 5, 9, 13]) await tapCell(s, 'Kick', st);
  for (const st of [5, 13]) await tapCell(s, 'Clap', st);
  await slide(s, 'Hat', 1, 16);
  await s.page.getByLabel('Swing').fill('0.2');
  await s.page.waitForTimeout(300);
}

/** Beat: Repeat, tap the copy, three times over (bars 1 to 4), then a snare roll at the end of bar 4. */
async function repeatAndFill(s) {
  await s.page.evaluate(() => window.scrollTo(0, 0));
  for (let n = 2; n <= 4; n++) {
    await button(s, 'Repeat').click();
    await s.page.waitForTimeout(400);
    // The copy, to repeat next (and, after the last, the bar the fill goes in)
    await s.page.locator('main button', { hasText: new RegExp(`^Bar ${n}1 bar$`) }).first().click();
    await s.page.waitForTimeout(300);
  }
  await button(s, 'Fill').click();
  await s.page.waitForTimeout(400);
  await s.page.getByRole('dialog').getByText('Snare roll (last beat)').click();
  await s.page.waitForTimeout(400);
}

/** Notes: a new part on a track, four bars long. */
async function newPart(s, track) {
  await tab(s, 'Notes');
  await s.page.locator('main button', { hasText: track }).first().click();
  await s.page.waitForTimeout(300);
  await s.page.getByText('Start a part').click();
  await s.page.waitForTimeout(400);
  await s.page.getByLabel('Length in bars').selectOption('4');
  await s.page.waitForTimeout(400);
}

/** Notes: Space Clav plays the chords as off-beat stabs. */
async function chords(s, open = false) {
  await newPart(s, 'Space Clav');
  // The key picked, so the rows stay put as notes go in (else they follow the key worked out from the notes)
  await s.page.getByLabel('Key').selectOption('9-minor');
  await s.page.waitForTimeout(300);
  await button(s, 'Chords').click();
  await s.page.waitForTimeout(400);
  await s.page.getByRole('dialog').locator('button', { hasText: 'Off-beat stabs' }).click();
  if (open) return;
  await s.page.getByRole('dialog').getByText('i – VI – III – VII (epic)').click();
  await s.page.waitForTimeout(400);
}

/** Notes: the bass, a quarter note at a time: A, F, C and G, a bar each. */
async function bass(s, bars = 4) {
  await newPart(s, 'Slap Bass');
  await button(s, '1/4').click();
  const roots = ['A2', 'F2', 'C3', 'G2'];
  for (let b = 0; b < bars; b++) {
    await s.page.locator('main button', { hasText: new RegExp(`^${b + 1}$`) }).first().click();
    await s.page.waitForTimeout(250);
    const row = s.page.getByLabel(`${roots[b]}, step ${b * 16 + 1}`, { exact: true });
    await row.scrollIntoViewIfNeeded();
    await slide(s, roots[b], b * 16 + 1, b * 16 + 16);
    await s.page.waitForTimeout(200);
  }
}

/** Song: Repeat the loop twice, loop the part at bar 5, then a build-up into a drop at bar 9. */
async function arrange(s) {
  await tab(s, 'Song');
  for (let i = 0; i < 2; i++) {
    await s.page.getByText('Repeat the loop', { exact: true }).click();
    await s.page.waitForTimeout(500);
  }
  await s.page.getByRole('button', { name: /^Space Clav: .*bar 5$/ }).click();
  await s.page.waitForTimeout(500);
  await s.page.evaluate(() => window.scrollTo(0, 0));
  await s.page.getByLabel('Loop this clip').click();
  await s.page.waitForTimeout(300);
  await tab(s, 'Song');
  await s.page.getByText('Build-up and drop', { exact: true }).click();
  await s.page.waitForTimeout(800);
}

/** The whole song, as the lesson makes it. */
async function wholeSong(s) {
  await emptySong(s);
  await paintBeat(s);
  await repeatAndFill(s);
  await chords(s);
  await bass(s);
  await arrange(s);
}

export const SHOTS = [
  {
    file: 'pocket-new',
    phone: true,
    alt: 'Pocket on a phone with the New song sheet open: Empty song at the top, then the starters in groups such as Game Worlds and Electronic.',
    caption: 'Song › New: an empty song, or any starter.',
    setup: async (s) => {
      await s.page.getByRole('button', { name: 'New' }).first().click();
      await s.page.waitForTimeout(400);
      await s.page.getByRole('dialog').locator('button', { hasText: 'Electronic' }).click();
      await s.page.waitForTimeout(400);
      return s.phoneScreen();
    },
  },
  {
    file: 'pocket-steps',
    phone: true,
    alt: 'The Steps grid on the Beat tab: kicks on every beat, claps on beats 2 and 4, a hat on every 16th, and the Swing slider at 20%.',
    caption: 'Tap a step, or slide along a row to paint a run of them.',
    setup: async (s) => {
      await emptySong(s);
      await paintBeat(s);
      const steps = card(s, 'Steps');
      await scrollTo(s, steps);
      return inView(s, steps, 6);
    },
  },
  {
    file: 'pocket-chords',
    phone: true,
    alt: 'The Chords sheet over the Notes tab: the styles Held chords, Quarter-note pulse, Off-beat stabs and Arpeggio, then progressions in A minor.',
    caption: 'Chords: pick a style, then a progression in the song\'s key.',
    setup: async (s) => {
      await emptySong(s);
      await chords(s, true);
      return s.phoneScreen();
    },
  },
  {
    file: 'pocket-bass',
    phone: true,
    alt: 'The Notes tab with the Slap Bass part: only the notes of A minor down the side, and four quarter notes painted on A2 in bar 1.',
    caption: 'The Notes grid only has the notes of the key, so every note fits.',
    setup: async (s) => {
      await emptySong(s);
      await chords(s);
      await bass(s, 1);
      const key = s.page.locator('main section').filter({ has: s.page.getByLabel('Key') });
      await scrollTo(s, key);
      return inView(s, key, 6);
    },
  },
  {
    file: 'pocket-vocals',
    phone: true,
    alt: 'The Vocals tab: a big Record button, then the vocal track\'s sounds: Clean lead, Aggressive lead, Ad-lib, Phone / radio, Dark and wide and Backing stack.',
    caption: 'Vocals: Record over the loop, and pick the take\'s sound.',
    setup: async (s) => {
      await emptySong(s);
      await tab(s, 'Vocals');
      await s.page.locator('main button', { hasText: 'Track' }).click();
      await s.page.waitForTimeout(600);
      return inView(s, [card(s, 'Record'), card(s, 'Vocal track')], 6);
    },
  },
  {
    file: 'pocket-mix',
    phone: true,
    alt: 'The Mix tab: the master\'s level and Clipper, then a card for each track with its level, M and S, its sound and its reverb.',
    caption: 'Mix: each track\'s level, sound and reverb, the master at the top.',
    setup: async (s) => {
      await emptySong(s);
      await tab(s, 'Mix');
      return inView(s, [card(s, 'Master'), card(s, 'Drums'), card(s, 'Slap Bass')], 6);
    },
  },
  {
    file: 'pocket-arrange',
    phone: true,
    alt: 'The Tracks card on the Song tab: twelve bars of drums, bass and chords, a build-up on new tracks before bar 9, and the Arrange tools below.',
    caption: 'Repeat the loop, then a build-up and drop at bar 9.',
    setup: async (s) => {
      await wholeSong(s);
      await s.page.evaluate(() => window.scrollTo(0, 0));
      await scrollTo(s, card(s, 'Tracks'));
      return inView(s, [card(s, 'Tracks'), s.page.getByText('Repeat the loop', { exact: true })], 6);
    },
  },
  {
    file: 'pocket-share',
    phone: true,
    alt: 'The Share tab: Export an MP3, Share a link to the song, Save and Open for the project file, and Use the full studio here.',
    caption: 'Share: an MP3 for the share sheet, or a link to the song.',
    setup: async (s) => {
      await emptySong(s);
      await paintBeat(s);
      await tab(s, 'Share');
      await s.page.evaluate(() => window.scrollTo(0, 0));
      return inView(s, [card(s, 'Share the song'), card(s, 'On a computer')], 6);
    },
  },
];

export const EXAMPLES = [
  {
    name: 'pocket-house',
    label: 'Pocket House, the song from this lesson.',
    // Made in Pocket (on the studio's window), then opened in the studio the way the lesson ends
    setup: async (s) => {
      await s.page.goto(s.page.url().replace(/\?studio.*$/, '?pocket'), { waitUntil: 'networkidle' });
      await s.page.waitForTimeout(800);
      await wholeSong(s);
      await s.page.waitForTimeout(1500); // the autosave
      await tab(s, 'Share');
      await s.page.getByText('Use the full studio here').click();
      await s.page.waitForLoadState('networkidle');
      await s.page.waitForTimeout(1500);
      const restore = s.page.getByRole('button', { name: /^Restore/ });
      if (await restore.count()) await restore.first().click();
      await s.page.waitForTimeout(1500);
    },
  },
];
