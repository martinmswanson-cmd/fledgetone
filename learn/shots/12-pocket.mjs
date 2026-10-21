// Screenshots and examples for learn/12-pocket.md (taken by scripts/guide-shots/capture.mjs --learn).
// Every shot is taken in Pocket on a phone-sized screen. The helpers below build the lesson's song
// step by step, the way the lesson does it, by tapping Pocket's own buttons.

const wait = (s, ms = 400) => s.page.waitForTimeout(ms);

/** A button in the drawer (the instrument at the bottom) by its whole text. */
const drawerButton = (s, text) => s.page.locator('.pk-drawer button', { hasText: new RegExp(`^\\s*${text}\\s*$`) }).first();

/** A track's cell in the song's section `i` (0 for the first). */
const cell = (s, track, i) => s.page.locator(`.pk-cell[data-i="${i}"][aria-label^="${track} in"]`).first();

/** Close the sheet that's open. */
async function closeSheet(s) {
  await s.page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
  await wait(s, 300);
}

/** What are we making? › Blank song, then the song's name and key (A minor). */
async function emptySong(s) {
  if (!(await s.page.getByText('What are we making?').count())) {
    await s.page.getByRole('button', { name: /^Your songs/ }).click();
    await wait(s);
  }
  await s.page.locator('button', { hasText: /^Blank song/ }).click();
  await wait(s, 1500);
  await s.page.getByRole('button', { name: 'The song: name, tempo, key' }).click();
  await wait(s);
  await s.page.getByLabel('Song name').fill('Pocket House');
  await s.page.getByLabel('Key', { exact: true }).selectOption('9-minor');
  await closeSheet(s);
}

/** Drums › Draw: the lesson's beat in bar 1, copied to all four bars, with a little swing. */
async function paintBeat(s) {
  await cell(s, 'Drums', 0).click();
  await wait(s, 300);
  await drawerButton(s, 'Draw').click();
  await wait(s);
  const pick = async (drum) => {
    await s.page.locator('.pk-drawer button', { hasText: new RegExp(`^(● )?${drum}$`) }).first().click();
    await wait(s, 200);
  };
  const step = (drum, n) => s.page.getByLabel(`${drum}, step ${n}`, { exact: true }).click();
  await pick('Kick');
  for (const n of [1, 5, 9, 13]) await step('Kick', n);
  await pick('Clap');
  for (const n of [5, 13]) await step('Clap', n);
  await pick('Hat');
  for (let n = 1; n <= 16; n++) await step('Hat', n);
  await drawerButton(s, 'Copy to all bars').click();
  await wait(s, 200);
  await s.page.locator('.pk-drawer button', { hasText: /^Swing/ }).click();
  await wait(s, 200);
}

/** Drums › Fill: a snare roll at the end of the section. */
async function fill(s) {
  await drawerButton(s, 'Fill').click();
  await wait(s);
  await s.page.getByRole('dialog').getByText('Snare roll (last beat)').click();
  await wait(s);
}

/** Space Clav › Draw › Chords: off-beat stabs, i – VI – III – VII. */
async function chords(s, open = false) {
  await cell(s, 'Space Clav', 0).click();
  await wait(s, 300);
  await drawerButton(s, 'Draw').click();
  await wait(s, 600);
  await drawerButton(s, 'Chords').click();
  await wait(s);
  await s.page.getByRole('dialog').locator('button', { hasText: 'Off-beat stabs' }).click();
  if (open) return;
  await s.page.getByRole('dialog').getByText('i – VI – III – VII (epic)').click();
  await wait(s);
}

/** Slap Bass › Draw: a bar-long note on each chord's root, A2, F2, C3 and G2. */
async function bass(s, bars = 4) {
  // (With the piano roll open the drawer fills the screen: the track names stay, and the roll stays open)
  await s.page.locator('.pk-thname', { hasText: 'Slap Bass' }).click();
  await wait(s, 300);
  const draw = drawerButton(s, 'Draw');
  if ((await draw.getAttribute('aria-pressed')) !== 'true') await draw.click();
  await wait(s, 600);
  // The pen's length: 1/8 › 1/4 › 1/2 › 1 bar
  for (let i = 0; i < 3; i++) await s.page.getByRole('button', { name: 'Length of new notes' }).click();
  const roots = ['A2', 'F2', 'C3', 'G2'];
  for (let b = 0; b < bars; b++) {
    const key = s.page.locator('.pk-rkey', { hasText: new RegExp(`^${roots[b]}$`) }).first();
    await s.page.locator('.pk-roll').evaluate((el, b) => (el.scrollLeft = b * 16 * 40), b);
    await key.evaluate((el) => {
      const roll = el.closest('.pk-roll');
      roll.scrollTop = el.offsetTop - roll.clientHeight / 2;
    });
    await wait(s, 200);
    const row = await key.boundingBox();
    const surf = await s.page.locator('.pk-rsurf').boundingBox();
    await s.page.mouse.click(surf.x + b * 16 * 40 + 20, row.y + row.height / 2);
    await wait(s, 300);
  }
}

/** + Track › Vocals. */
async function vocals(s) {
  await s.page.locator('.pk-arr button', { hasText: 'Track' }).click();
  await wait(s);
  await s.page.getByRole('dialog').locator('button', { hasText: /^Vocals/ }).click();
  await wait(s, 600);
}

/** A's ⋯ › Play it twice, twice (A A A), then a build-up into the third. */
async function arrange(s) {
  await drawerButton(s, 'Play').click().catch(() => {});
  await wait(s);
  for (const item of ['Play it twice', 'Play it twice', 'Build-up into it']) {
    await s.page.locator('.pk-chip.sel').click();
    await wait(s);
    await s.page.getByRole('dialog').getByText(item, { exact: true }).click();
    await wait(s, 700);
  }
}

/** The whole song, as the lesson makes it. */
async function wholeSong(s) {
  await emptySong(s);
  await paintBeat(s);
  await fill(s);
  await chords(s);
  await bass(s);
  await arrange(s);
}

export const SHOTS = [
  {
    file: 'pocket-new',
    phone: true,
    alt: 'Pocket on a phone: What are we making?, with Blank song and the starters listed under it.',
    caption: 'What are we making?: a starter, or an empty song.',
    setup: async (s) => s.phoneScreen(),
  },
  {
    file: 'pocket-steps',
    phone: true,
    alt: 'Pocket with the Drums cell of section A selected and Draw open: the hat on every 16th of bar 1, and Drummer, Fill, Swing, Clear and Copy to all bars above it.',
    caption: 'One drum at a time: tap its steps, then copy the bar to all four.',
    setup: async (s) => {
      await emptySong(s);
      await paintBeat(s);
      return s.phoneScreen();
    },
  },
  {
    file: 'pocket-chords',
    phone: true,
    alt: 'The Chords sheet over the piano roll: the styles Held chords, Quarter-note pulse, Off-beat stabs and Arpeggio, then progressions in A minor.',
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
    alt: 'The piano roll with the Slap Bass part: only the notes of A minor down the side, and a bar-long A2.',
    caption: 'The piano roll only has the notes of the key, so every note fits.',
    setup: async (s) => {
      await emptySong(s);
      await chords(s);
      await bass(s, 1);
      await s.page.locator('.pk-roll').evaluate((el) => (el.scrollLeft = 0));
      await wait(s, 300);
      return s.phoneScreen();
    },
  },
  {
    file: 'pocket-vocals',
    phone: true,
    alt: 'Pocket with a Vocals track added: its cell selected, and the drawer showing a big Record button and the voice\'s sounds.',
    caption: 'Vocals: Record over the section, and pick the voice\'s sound.',
    setup: async (s) => {
      await emptySong(s);
      await vocals(s);
      return s.phoneScreen();
    },
  },
  {
    file: 'pocket-mix',
    phone: true,
    alt: 'Mix all: a strip for each track (Drums, Slap Bass, Space Clav, Brass Stabs) with a fader, M and S, and the master with Loud.',
    caption: 'Mix all: every track\'s level, mute and solo, and the master.',
    setup: async (s) => {
      await emptySong(s);
      await s.page.locator('.pk-arr button', { hasText: 'Mix all' }).click();
      await wait(s);
      return s.phoneScreen();
    },
  },
  {
    file: 'pocket-arrange',
    phone: true,
    alt: 'The song grid with three sections, A, A and a third marked BUILD, the drums, bass and chords in each, and the build-up\'s new tracks.',
    caption: 'Play it twice, twice, then a build-up into the third.',
    setup: async (s) => {
      await wholeSong(s);
      return s.phoneScreen();
    },
  },
  {
    file: 'pocket-share',
    phone: true,
    alt: 'The Share sheet: Export an MP3, Share a link to the song, Save and Open for the project file, and Use the full studio here.',
    caption: 'Share: an MP3 for the share sheet, or a link to the song.',
    setup: async (s) => {
      await emptySong(s);
      await paintBeat(s);
      await s.page.getByRole('button', { name: 'Share' }).click();
      await wait(s);
      return s.phoneScreen();
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
      await wait(s, 800);
      await wholeSong(s);
      await wait(s, 1500); // the autosave
      await s.page.getByRole('button', { name: 'The song: name, tempo, key' }).click();
      await wait(s);
      await s.page.getByText('Use the full studio here').click();
      await s.page.waitForLoadState('networkidle');
      await wait(s, 1500);
      const restore = s.page.getByRole('button', { name: /^Restore/ });
      if (await restore.count()) await restore.first().click();
      await wait(s, 1500);
    },
  },
];
