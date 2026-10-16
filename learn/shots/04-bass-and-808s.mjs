// Screenshots and examples for learn/04-bass-and-808s.md (taken by scripts/guide-shots/capture.mjs --learn).

/** The y of a track's lane (the middle of its row), from its name in the track header. */
async function laneY(s, name) {
  const b = await s.own(name).first().boundingBox();
  return b.y + 30;
}

/** Right-click at a point and choose a menu item. */
async function context(s, x, y, item) {
  await s.page.mouse.click(x, y, { button: 'right' });
  await s.wait(400);
  await s.page.locator('[role=menu] [role^=menuitem]').filter({ hasText: item }).first().click();
  await s.wait(800);
}

const pianoRollEl = (s) => s.page.locator('[aria-label="Piano roll"]').last();

/** Choose an option in the open piano roll's select that has `has` among its options. */
async function rollSelect(s, has, label) {
  await pianoRollEl(s).locator('select').filter({ hasText: has }).first().selectOption({ label });
  await s.wait(200);
}

/**
 * The open piano roll's grid: x of a beat (0 = bar 1 beat 1) and y of a pitch in semitones from C2,
 * scrolled so G2 down to F1 all show.
 */
async function pitchGrid(s) {
  const pr = pianoRollEl(s);
  await s.page.evaluate(() => {
    const k = [...document.querySelectorAll('[aria-label="Piano roll"] button')].find((b) => b.textContent.trim() === 'C2');
    let e = k;
    while (e && !/(auto|scroll)/.test(getComputedStyle(e).overflowY)) e = e.parentElement;
    const kr = k.getBoundingClientRect();
    e.scrollTop += kr.y + kr.height / 2 - 7 * kr.height - (e.getBoundingClientRect().y + 30);
  });
  await s.wait(300);
  const c2 = await pr.locator('button', { hasText: /^C2$/ }).first().boundingBox();
  const one = await pr.locator('xpath=.//*[not(*) and normalize-space(.)="1.1"]').first().boundingBox();
  const two = await pr.locator('xpath=.//*[not(*) and normalize-space(.)="1.2"]').first().boundingBox();
  const beat = two.x - one.x;
  return { x: (b) => one.x - 2 + b * beat + 4, y: (semis) => c2.y + c2.height / 2 - semis * c2.height };
}

/** Click notes into the open piano roll: [beat from the clip's start, semitones from C2]. */
async function notes(s, list) {
  const g = await pitchGrid(s);
  for (const [beat, semis] of list) {
    await s.page.mouse.click(g.x(beat), g.y(semis));
    await s.wait(80);
  }
}

/** Set the open piano roll's SCALE to A minor. */
async function aMinor(s) {
  await pianoRollEl(s).locator('select[aria-label="Scale root"]').selectOption({ label: 'A' });
  await pianoRollEl(s).locator('select[aria-label="Scale"]').selectOption({ label: 'Minor' });
  await s.wait(200);
}

/** A blank timeline at 140 BPM with a 4-bar trap beat (the Drummer) and Am – F – C – G on the Space Clav. */
async function song(s) {
  await s.blank();
  await s.page.locator('[title^="Click to type a tempo"]').click();
  await s.page.keyboard.press('Control+a');
  await s.page.keyboard.type('140');
  await s.page.keyboard.press('Enter');
  await s.wait(300);
  await context(s, 262, await laneY(s, 'Drums'), /^Drummer/);
  {
    const d = s.page.locator('[role=dialog]').last();
    const ss = d.locator('select');
    const trap = await ss.nth(0).evaluate((sel) => [...sel.options].find((o) => o.text.startsWith('Trap')).text);
    await ss.nth(0).selectOption({ label: trap });
    await ss.nth(1).selectOption({ label: '4 bars' });
    await ss.nth(2).selectOption({ label: 'no fills' });
    await d.getByRole('button', { name: /^Make clip/ }).click();
    await s.wait(1000);
  }
  await s.page.keyboard.press('Escape');
  await chordsDialog(s);
  await s.page.locator('[role=dialog]').last().getByRole('button', { name: /^Make clip/ }).click();
  await s.wait(1000);
  await s.page.keyboard.press('Escape');
  await s.wait(300);
}

/** The Chord progression dialog on the Space Clav, set to A minor, i – VI – III – VII, a bar each, once through. */
async function chordsDialog(s) {
  await context(s, 262, await laneY(s, 'Space Clav'), /^Chord progression/);
  const d = s.page.locator('[role=dialog]').last();
  await d.locator('select').nth(0).selectOption({ label: 'A' });
  await d.locator('select').nth(1).selectOption({ label: 'minor' });
  await d.locator('select').nth(2).selectOption({ label: 'i – VI – III – VII (epic)' });
  await d.locator('select').nth(3).selectOption({ label: '1 bar' });
  await d.locator('select').nth(4).selectOption({ label: '1× (4 bars)' });
  await s.wait(300);
}

// The bass line on the roots: A, F, C, G (semitones from C2), the same rhythm each bar
const ROOTS = [-3, -7, 0, -5];
const RHYTHM = [0, 0.75, 1.5, 2, 3]; // beats: 1, the last 16th of 1, the "and" of 2, 3, 4

/** The song, with the roots written on the Slap Bass in a 4-bar clip (left open in the piano roll). */
async function roots(s) {
  await song(s);
  await context(s, 262, await laneY(s, 'Slap Bass'), /4 bars/);
  await aMinor(s);
  await notes(s, ROOTS.flatMap((r, bar) => RHYTHM.map((b) => [bar * 4 + b, r])));
}

// The 808: half-bar notes on the roots, and G1 sliding up to G2 in bar 4
const EIGHT08 = [[0, -3], [2, -3], [4, -7], [6, -7], [8, 0], [10, 0], [12, -5], [13.5, 7]];

/** The song with the Slap Bass muted and an 808 Bass track playing EIGHT08 (left open in the piano roll). */
async function eight08(s, { withRoots = false } = {}) {
  if (withRoots) await roots(s);
  else await song(s);
  await s.page.keyboard.press('Escape');
  await s.wait(300);
  if (withRoots) {
    await s.own('Slap Bass').first().locator('xpath=ancestor::div[.//button[normalize-space(.)="M"]][1]//button[normalize-space(.)="M"]').first().click();
    await s.wait(200);
  }
  await s.page.getByText('Add Track', { exact: true }).click();
  await s.wait(400);
  await s.page.keyboard.type('808 Bass');
  await s.wait(300);
  await s.page.keyboard.press('Enter');
  await s.wait(1500);
  await context(s, 262, await laneY(s, '808 Bass'), /4 bars/);
  await aMinor(s);
  await rollSelect(s, '1/8 dotted', '1/2');
  await notes(s, EIGHT08);
}

/** The 808's Track Inspector open, with its designer on, the Drill slide preset and Tune to key in A minor. */
async function designed(s) {
  const toggle = s.page.locator('xpath=//*[normalize-space(text())="808 designer"]/ancestor::div[.//button][1]//button').first();
  if (!(await toggle.count())) {
    await s.page.getByTitle('808 Bass: open in the Inspector').first().click();
    await s.wait(600);
  }
  await toggle.click();
  await s.wait(400);
  await s.page.locator('select[aria-label="808 preset"]').selectOption('Drill slide');
  await s.wait(300);
  const tune = s.page.locator('label', { hasText: 'Tune to key' });
  await tune.scrollIntoViewIfNeeded();
  await tune.click();
  await s.wait(300);
  const row = tune.locator('xpath=ancestor::div[.//select[@aria-label="Key"]][1]');
  await row.locator('select[aria-label="Key"]').selectOption({ label: 'A' });
  await row.locator('select[aria-label="Scale"]').selectOption({ label: 'Minor' });
  await s.wait(300);
}

/** The panel round a title in the Inspector. */
const panelOf = (s, title, up = 'ancestor::div[.//button][2]') =>
  s.page.locator(`xpath=//*[normalize-space(text())="${title}" or normalize-space(text())="${title.toUpperCase()}"]/${up}`).first();

export const SHOTS = [
  {
    file: 'bass-and-808s-chords',
    alt: 'The Chord progression dialog: key A minor, i – VI – III – VII (epic), a bar per chord, once through, held chords, Am – F – C – G.',
    caption: 'Four chords to follow: Am – F – C – G, a bar each.',
    setup: async (s) => {
      await s.blank();
      await chordsDialog(s);
      return s.dialog();
    },
  },
  {
    file: 'bass-and-808s-roots',
    alt: 'A Slap Bass clip in the piano roll with the scale set to A minor: five short notes a bar on A, then F, then C, then G.',
    caption: 'The roots of the chords, one bar each: A, F, C, G, in the same rhythm.',
    setup: async (s) => {
      await roots(s);
      await s.page.mouse.move(1300, 120);
      return s.pianoRoll();
    },
  },
  {
    file: 'bass-and-808s-slide',
    alt: 'An 808 Bass clip in the piano roll: half-bar notes on A, F, C and G, and in bar 4 a high G starting before the low G ends.',
    caption: 'Two notes on each root, and a slide: the high G starts before the low G ends.',
    setup: async (s) => {
      await eight08(s);
      await s.page.mouse.move(1300, 120);
      return s.pianoRoll();
    },
  },
  {
    file: 'bass-and-808s-designer',
    alt: 'The 808 designer in the Track Inspector, switched on with the Drill slide settings: drive, tone, punch, glide 160 ms, decay, and Tune to key set to A minor.',
    caption: 'The 808 designer after loading Drill slide, tuned to A minor.',
    setup: async (s) => {
      await eight08(s);
      await designed(s);
      const panel = panelOf(s, '808 designer');
      // Scroll the Inspector (not the page) so the designer's top is at the top of it
      await panel.evaluate((e) => {
        let c = e.parentElement;
        while (c && !/(auto|scroll)/.test(getComputedStyle(c).overflowY)) c = c.parentElement;
        c.scrollTop += e.getBoundingClientRect().y - c.getBoundingClientRect().y - 8;
      });
      await s.wait(300);
      return s.union([panel], 6);
    },
  },
  {
    file: 'bass-and-808s-kick',
    alt: 'The Kick and bass panel for the 808 track: it counts the kicks that land on a low 808 note, with a Duck under the kick button.',
    caption: 'The kick and bass check, with its one-click fix.',
    setup: async (s) => {
      await eight08(s);
      await designed(s);
      const p = panelOf(s, 'Kick and bass', 'ancestor::div[2]');
      await p.scrollIntoViewIfNeeded();
      await s.wait(300);
      return s.union([p], 8);
    },
  },
  {
    file: 'bass-and-808s-pump',
    alt: 'The Pump insert switched on: Trigger Kick, Depth 80%, Release 150 ms.',
    caption: 'After Duck under the kick: the Pump, following the kick.',
    setup: async (s) => {
      await eight08(s);
      await designed(s);
      await s.page.getByRole('button', { name: 'Duck under the kick' }).click();
      await s.wait(500);
      const p = panelOf(s, 'Pump');
      await p.scrollIntoViewIfNeeded();
      await s.wait(300);
      return s.union([p], 8);
    },
  },
];

export const EXAMPLES = [
  {
    name: 'bass-and-808s',
    label: 'The finished low end: a trap beat, Am – F – C – G, the root line muted on the Slap Bass and the 808 sliding, tuned and ducked.',
    setup: async (s) => {
      await eight08(s, { withRoots: true });
      await designed(s);
      await s.page.getByRole('button', { name: 'Duck under the kick' }).click();
      await s.wait(500);
    },
  },
];
