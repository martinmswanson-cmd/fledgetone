// Screenshots and examples for learn/11-export-and-share.md (taken by scripts/guide-shots/capture.mjs --learn).

/** The Synthwave starter, named as in the lesson. */
async function song(s) {
  await s.starter('Synthwave');
  const name = s.page.getByLabel('Project name');
  await name.fill('Night drive');
  await name.press('Enter');
  await s.wait(300);
  await s.page.mouse.move(700, 4);
}

/** The Export dialog (Ctrl+E), with its choices clicked in order. */
async function exportDialog(s, choices = [], target) {
  await s.page.keyboard.press('Control+e');
  await s.wait(800);
  const d = s.page.locator('[role=dialog]').last();
  for (const c of choices) {
    await d.getByRole('button', { name: c, exact: true }).click();
    await s.wait(200);
  }
  const match = d.getByRole('checkbox', { name: /Match a loudness target/ }).or(d.locator('label', { hasText: 'Match a loudness target' }).locator('input[type=checkbox]'));
  if (target && (await match.count())) {
    if (!(await match.first().isChecked())) await match.first().check();
    await s.wait(200);
    await d.locator('select').filter({ has: s.page.locator('option', { hasText: target }) }).first().selectOption({ label: target });
    await s.wait(200);
  }
  return d;
}

/** Back to the top of a dialog that scrolls, so a shot starts at its title. */
async function top(s) {
  await s.page.evaluate(() => document.querySelectorAll('[role=dialog], [role=dialog] *').forEach((e) => { if (e.scrollTop > 0) e.scrollTop = 0; }));
  await s.wait(200);
}

export const SHOTS = [
  {
    file: 'export-project-bar',
    alt: 'The right end of the menu bar: "Saved in this browser" with the time, the project name "Night drive", and the Save, Export and Share buttons.',
    caption: 'The project name, then Save, Export and Share, at the right of the menu bar.',
    setup: async (s) => {
      await song(s);
      return s.union([s.page.getByText(/^Saved in this browser/).first(), s.page.getByTitle(/^Share the song/)], 8);
    },
  },
  {
    file: 'export-restore',
    alt: 'The top of the studio after a reload: under the header, a banner says "Your last session, Night drive (6 clips, saved today), can be restored", with Restore and Dismiss.',
    caption: 'Come back later and the banner offers your last session.',
    setup: async (s) => {
      await song(s);
      await s.wait(1500);
      await s.page.reload({ waitUntil: 'networkidle' });
      await s.wait(1500);
      // The menu bar, the header and the banner under them, full width
      const b = await s.union([s.page.getByRole('button', { name: 'Dismiss', exact: true })], 10);
      return { x: 0, y: 0, width: 1440, height: b.y + b.height + 8 };
    },
  },
  {
    file: 'export-mixdown',
    alt: 'The Export dialog set to Whole song, Mixdown, Ring out and WAV, with Match a loudness target ticked and Streaming (-14 LUFS) chosen.',
    caption: 'A mixdown for streaming: Whole song, Mixdown, Ring out, WAV, matched to -14 LUFS.',
    setup: async (s) => {
      await song(s);
      const d = await exportDialog(s, ['Whole song', 'Mixdown', 'Ring out', 'WAV', '44.1 kHz', '24-bit'], 'Streaming (-14 LUFS)');
      await top(s);
      return s.union([d], 0);
    },
  },
  {
    file: 'export-loop',
    alt: 'The Export dialog set to Loop region, Mixdown, Seamless loop and OGG: exactly one loop long, ready to repeat without a gap.',
    caption: 'A seamless loop for a game: Loop region, Seamless loop, OGG.',
    setup: async (s) => {
      await song(s);
      const d = await exportDialog(s, ['Loop region', 'Mixdown', 'Seamless loop', 'OGG'], 'Games (-16 LUFS)');
      await top(s);
      return s.union([d], 0);
    },
  },
  {
    file: 'export-share',
    alt: 'The Share dialog: a link to this song with Copy link, the song as an MP3, and the project file.',
    caption: 'Share: a link that opens the song, an MP3, or the project file.',
    setup: async (s) => {
      await song(s);
      await s.page.getByTitle(/^Share the song/).click();
      await s.page.getByLabel('Song link').waitFor({ timeout: 20000 });
      // The link as it reads on fledgetone.com, not the local test server
      await s.page.getByLabel('Song link').evaluate((el) => { el.value = el.value.replace(/^https?:\/\/[^#]*/, 'https://fledgetone.com/app/'); });
      await s.wait(500);
      return s.dialog();
    },
  },
  {
    file: 'export-video',
    alt: 'The Export dialog set to Video (MP4): Portrait 9:16, Smooth 60 fps, the Showcase picture, the title and marks, and a loudness target for streaming.',
    caption: 'A showcase video: the notes playing, tall for phones, at 60 fps.',
    setup: async (s) => {
      await song(s);
      const d = await exportDialog(s, ['Whole song', 'Video (MP4)', 'Portrait 9:16', 'Smooth 60 fps'], 'Streaming (-14 LUFS)');
      await d.locator('select').filter({ has: s.page.locator('option', { hasText: 'Showcase: the notes playing' }) }).first().selectOption('showcase');
      await s.wait(200);
      await top(s);
      return s.union([d], 0);
    },
  },
  {
    file: 'export-cut',
    alt: 'The Cut to length dialog with 30 s chosen: the sections it keeps, in order, and the tempo nudge that makes it last exactly 30 seconds.',
    caption: 'File › Cut song to length…: a 30-second version, ending on the song\'s own ending.',
    setup: async (s) => {
      await song(s);
      await s.menu('File', 'Cut song to length');
      await s.page.locator('[role=dialog]').last().getByRole('button', { name: '30 s', exact: true }).click();
      await s.wait(400);
      return s.dialog();
    },
  },
];

export const EXAMPLES = [
  {
    name: 'night-drive-30s',
    label: 'The Synthwave starter as "Night drive", cut to exactly 30 seconds.',
    setup: async (s) => {
      await song(s);
      await s.menu('File', 'Cut song to length');
      const d = s.page.locator('[role=dialog]').last();
      await d.getByRole('button', { name: '30 s', exact: true }).click();
      await s.wait(300);
      await d.getByRole('button', { name: /^Cut to/ }).click();
      await s.wait(1000);
    },
  },
];
