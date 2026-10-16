// Screenshots and examples for learn/05-arrange-a-song.md (taken by scripts/guide-shots/capture.mjs --learn).
// Everything is built through the UI from File › New › Blank timeline, as the lesson does it.

/** The lane row of a track (its name in the track headers, not the Inspector or the mixer) */
async function laneY(s, name) {
  const ys = await s.page.getByText(name, { exact: true }).evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).filter((r) => r.x < 250 && r.width > 0).map((r) => r.y)
  );
  return Math.min(...ys) + 20;
}

const ppb = async (s) => parseFloat(await s.page.getByText(/px\/bar$/).first().innerText());
/** Where a bar starts on screen (the lanes start at x 258, scrolled to bar 1) */
const barX = async (s, bar) => 258 + (bar - 1) * (await ppb(s));

async function closeInspector(s) {
  const x = s.page.locator('[title="Close Inspector"]');
  if (await x.count()) {
    await x.first().click();
    await s.wait(400);
  }
}

async function chords(s, track, style) {
  await s.page.mouse.click(270, await laneY(s, track), { button: 'right' });
  await s.page.getByText(/^Chord progression/).first().click();
  const dlg = s.page.locator('[role=dialog]').last();
  await dlg.getByLabel('Key root').selectOption({ label: 'A' });
  await dlg.getByLabel('Major or minor').selectOption('minor');
  await dlg.locator('select').nth(2).selectOption({ label: 'i – VI – III – VII (epic)' });
  if (style) await dlg.locator('select').nth(5).selectOption({ label: style });
  await dlg.getByRole('button', { name: /Make clip/ }).click();
  await s.wait(800);
}

/** The 8-bar loop: Drummer on Drums, chords on Space Clav, an arpeggio on Brass Stabs, a bass line from the chords */
async function loop(s) {
  await s.blank();
  await chords(s, 'Space Clav');
  await chords(s, 'Brass Stabs', 'Arpeggio (16ths)');
  await s.page.mouse.click(270, await laneY(s, 'Drums'), { button: 'right' });
  await s.page.getByText(/^Drummer/).first().click();
  const dlg = s.page.locator('[role=dialog]').last();
  await dlg.locator('select').nth(1).selectOption({ label: '8 bars' });
  await dlg.getByRole('button', { name: /Make clip/ }).click();
  await s.wait(800);
  // The blank timeline's own Slap Bass track stays empty: delete it, and make the bass from the chords
  await s.page.getByText('Slap Bass', { exact: true }).first().click();
  await s.menu('Track', /^Delete/);
  await s.page.getByText('Am F C G', { exact: true }).first().click({ button: 'right' });
  await s.page.getByText('Bass line from these chords').first().click();
  await s.wait(800);
  await closeInspector(s);
}

async function repeatMenu(s) {
  await s.page.keyboard.press('Control+a');
  await s.page.getByText('Am F C G', { exact: true }).first().click({ button: 'right' });
  await s.page.getByText(/^Repeat ×N/).click();
  await s.wait(200);
  await s.page.keyboard.type('6');
  await s.wait(200);
}

async function zoomTo(s, max) {
  for (let i = 0; i < 20 && (await ppb(s)) > max; i++) {
    await s.page.getByTitle(/^Zoom out/).first().click();
    await s.wait(150);
  }
}

// The clips taken out for contrast: [track, the bar its 8-bar clip starts on]
const CUTS = [['Drums', 1], ['Bass line', 1], ['Brass Stabs', 9], ['Brass Stabs', 17], ['Drums', 33], ['Brass Stabs', 33], ['Drums', 49], ['Bass line', 49], ['Brass Stabs', 49]];
// The markers added by hand (Build and Drop come from Build-up & drop)
const SECTIONS = [[1, 'Intro'], [9, 'Verse'], [33, 'Breakdown'], [41, 'Last drop'], [49, 'Outro']];

/** Type a bar into BAR.BEAT.TICK, press M, and rename the new marker by double-clicking its flag */
async function marker(s, bar, name) {
  await s.page.getByTitle(/^Click to type a bar position/).first().click();
  await s.page.keyboard.press('Control+a');
  await s.page.keyboard.type(String(bar));
  await s.page.keyboard.press('Enter');
  await s.wait(200);
  await s.page.keyboard.press('m');
  await s.wait(300);
  await s.page.getByText(/^Marker \d+$/).last().dblclick();
  await s.wait(200);
  await s.page.keyboard.press('Control+a');
  await s.page.keyboard.type(name);
  await s.page.keyboard.press('Enter');
  await s.wait(300);
}

/** Right-click the ruler on a bar line (its number's label starts 4 px after the line) */
async function rulerMenu(s, bar) {
  const label = await s.page.getByText(`${bar}.1`, { exact: true }).first().boundingBox();
  await s.page.mouse.click(label.x - 4, 250, { button: 'right' });
  await s.wait(300);
}

async function rulerItem(s, re) {
  await s.page.getByText(re).first().click();
  await s.wait(800);
}

/** Copied, thinned out and marked: the sections without the build, the speed-up or the key change */
async function sections(s) {
  await loop(s);
  await repeatMenu(s);
  await s.page.keyboard.press('Enter');
  await s.wait(800);
  await zoomTo(s, 21);
  for (const [t, b] of CUTS) {
    await s.page.mouse.click((await barX(s, b)) + 30, (await laneY(s, t)) + 30);
    await s.wait(150);
    await s.page.keyboard.press('Delete');
    await s.wait(250);
  }
  for (const [b, n] of SECTIONS) await marker(s, b, n);
}

async function finished(s) {
  await sections(s);
  await rulerMenu(s, 25);
  await rulerItem(s, /^Build-up & drop here/);
  const y = (await laneY(s, 'Drums')) + 30;
  await s.page.mouse.click((await barX(s, 17)) + 30, y);
  await s.page.mouse.click((await barX(s, 17)) + 30, y, { button: 'right' });
  await s.page.getByText('Speed up the end', { exact: true }).first().click();
  await s.wait(800);
  await rulerMenu(s, 41);
  await rulerItem(s, /^Key change here: up a whole step/);
  await s.page.keyboard.press('Escape');
  // The loop off, so the whole song plays; the playhead back to the start
  await s.page.keyboard.press('l');
  await s.page.keyboard.press('Home');
  await s.wait(400);
  await s.page.mouse.move(700, 4);
}

export const SHOTS = [
  {
    file: 'arrange-loop',
    alt: 'An 8-bar loop on the timeline: a Drummer clip on Drums, Am F C G chords on Space Clav, a Bass line track and an arpeggio on Brass Stabs.',
    caption: 'The starting point: eight bars with drums, chords, bass and an arpeggio.',
    setup: async (s) => {
      await loop(s);
      await s.zoomOut(1);
      return s.timeline();
    },
  },
  {
    file: 'arrange-repeat',
    alt: 'The clip menu with Repeat × open and 6 typed in its box, next to an OK button.',
    caption: 'Select every clip, right-click one, and Repeat ×N… lays copies end to end.',
    setup: async (s) => {
      await loop(s);
      await repeatMenu(s);
      return s.popover();
    },
  },
  {
    file: 'arrange-sections',
    alt: 'The timeline zoomed out over 56 bars with violet marker flags Intro, Verse, Breakdown, Last drop and Outro, and gaps where clips were deleted: no drums or bass in the intro, no arpeggio in the verse, chords alone in the outro.',
    caption: 'Seven copies of the loop, thinned out section by section and named with markers.',
    setup: async (s) => {
      await sections(s);
      await s.page.keyboard.press('Home');
      await s.page.mouse.move(700, 4);
      await s.wait(300);
      return s.timeline();
    },
  },
  {
    file: 'arrange-ruler-menu',
    alt: 'The ruler menu at bar 25, headed At 025.01.00, with Add marker here, the tempo items, Build-up & drop here, Speed up into here and the three key changes.',
    caption: 'Right-click the ruler on a bar line: the arranging tools act on every track from there.',
    setup: async (s) => {
      await sections(s);
      await rulerMenu(s, 25);
      return s.popover();
    },
  },
  {
    file: 'arrange-build',
    alt: 'Bars 1 to 28 of the song: Build and Drop markers at bars 21 and 25, a Build FX track with the riser and impact, a Snare Roll track over bars 21 to 24, and tempo flags on the ruler where it speeds up.',
    caption: 'Build-up & drop adds the riser, the snare roll, the impact and two markers; Speed up the end rushes the tempo into bar 25.',
    setup: async (s) => {
      await finished(s);
      for (let i = 0; i < 20 && (await ppb(s)) < 30; i++) {
        await s.page.getByTitle(/^Zoom in/).first().click();
        await s.wait(150);
      }
      await s.page.mouse.move(700, 4);
      await s.wait(300);
      return s.timeline();
    },
  },
  {
    file: 'arrange-overview',
    alt: 'The whole song zoomed out: 56 bars from Intro to Outro with every marker on the ruler, the build tracks under the four parts, and the Overview strip below.',
    caption: 'The finished arrangement, zoomed out to show the whole song.',
    setup: async (s) => {
      await finished(s);
      return s.timeline();
    },
  },
  {
    file: 'arrange-song-form',
    alt: 'The Arrange a beat dialog on its Song form tab: the loop starts at bar 1 and is 8 bars, with lengths for Intro, Hook, Verse, Bridge and Outro and a summary of the song it will lay out.',
    caption: 'Song › Arrange a beat… › Song form lays out a whole song from a loop in one go.',
    setup: async (s) => {
      await loop(s);
      await s.menu('Song', /^Arrange a beat/);
      const dlg = s.page.locator('[role=dialog]').last();
      await dlg.getByText('Song form', { exact: true }).first().click();
      await s.wait(300);
      await dlg.locator('select').first().selectOption({ label: '8 bars' });
      await s.wait(300);
      return s.dialog();
    },
  },
];

export const EXAMPLES = [
  {
    name: 'arrange-a-song',
    label: 'The 56-bar song: intro, verse, build, drop, breakdown, a last drop a whole step up, and an outro.',
    setup: finished,
  },
];
