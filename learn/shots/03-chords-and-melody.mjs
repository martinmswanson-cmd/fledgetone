// Screenshots and examples for learn/03-chords-and-melody.md (taken by scripts/guide-shots/capture.mjs --learn).
// Everything is built through the UI from File › New › Blank timeline, as the lesson does it.

/** The lane row of a track (its name in the track headers, not the Inspector or the mixer) */
async function laneY(s, name) {
  const ys = await s.page.getByText(name, { exact: true }).evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect()).filter((r) => r.x < 250 && r.width > 0).map((r) => r.y)
  );
  return Math.min(...ys) + 20;
}

/** Right-click a track's lane at bar 1 and open the Chord progression dialog set to A minor, i – VI – III – VII */
async function chordDialog(s) {
  await s.page.mouse.click(270, await laneY(s, 'Space Clav'), { button: 'right' });
  await s.page.getByText(/^Chord progression/).first().click();
  const dlg = s.page.locator('[role=dialog]').last();
  await dlg.getByLabel('Key root').selectOption({ label: 'A' });
  await dlg.getByLabel('Major or minor').selectOption('minor');
  await dlg.locator('select').nth(2).selectOption({ label: 'i – VI – III – VII (epic)' });
  await s.wait(300);
  return dlg;
}

async function chords(s) {
  const dlg = await chordDialog(s);
  await dlg.getByRole('button', { name: /Make clip/ }).click();
  await s.wait(800);
}

async function accompanyDialog(s) {
  await s.page.getByText('Am F C G', { exact: true }).first().click({ button: 'right' });
  await s.page.getByText(/^Accompaniment for these chords/).first().click();
  const dlg = s.page.locator('[role=dialog]').last();
  await dlg.locator('label', { hasText: 'Alberti bass' }).click();
  await s.wait(300);
  return dlg;
}

async function accompany(s) {
  const dlg = await accompanyDialog(s);
  await dlg.getByRole('button', { name: 'Make the track' }).click();
  await s.wait(1000);
}

async function closeInspector(s) {
  const x = s.page.locator('[title="Close Inspector"]');
  if (await x.count()) {
    await x.first().click();
    await s.wait(400);
  }
}

/** SCALE in the open piano roll */
async function setScale(s, root = 'A', scale = 'Minor') {
  const roll = s.page.locator('[data-piano-roll]');
  await roll.getByLabel('Scale root').selectOption({ label: root });
  await roll.getByLabel('Scale', { exact: true }).selectOption({ label: scale });
  await s.wait(300);
}

// The melody, a quarter note a beat (null: a rest)
const MELODY = [
  ['E5', 'D5', 'C5', 'D5'], // Am
  ['A4', 'C5', 'F5', 'E5'], // F
  ['E5', 'D5', 'C5', 'G4'], // C
  ['B4', 'C5', 'D5', null], // G
];

/** Add a Pluck track, a 4-bar clip on it, and click the melody in with NEW NOTE at 1/4 */
async function melody(s) {
  await s.page.getByText('Add Track', { exact: false }).last().click();
  await s.wait(400);
  await s.page.keyboard.type('pluck');
  await s.wait(300);
  await s.page.keyboard.press('Enter');
  await s.wait(1000);
  await closeInspector(s);
  await s.page.mouse.click(270, await laneY(s, 'Pluck'), { button: 'right' });
  await s.page.getByText('New empty clip (4 bars)').click();
  await s.wait(1000);
  await setScale(s);
  const roll = s.page.locator('[data-piano-roll]');
  await roll.locator('select').nth(1).selectOption({ label: '1/4' });
  const ruler = roll.locator('[title="Click to move the playhead"]');
  const x1 = (await ruler.getByText('1.1', { exact: true }).boundingBox()).x;
  const beatW = (await ruler.getByText('1.2', { exact: true }).boundingBox()).x - x1;
  for (let b = 0; b < MELODY.length; b++)
    for (let q = 0; q < 4; q++) {
      const n = MELODY[b][q];
      if (!n) continue;
      const key = roll.locator(`button[title="Preview ${n}"]`);
      await key.scrollIntoViewIfNeeded();
      const kb = await key.boundingBox();
      await s.page.mouse.click(kb.x + kb.width + 8 + (b * 4 + q) * beatW, kb.y + kb.height / 2);
      await s.wait(80);
    }
  // Scrolling the keys into view can scroll the page too: back to the top, so the shots frame right
  await s.page.evaluate(() => window.scrollTo(0, 0));
  await s.wait(300);
}

async function variationsDialog(s) {
  await s.page.getByText('Pluck 1', { exact: true }).first().click({ button: 'right' });
  await s.page.getByText(/^Melody variations/).first().click();
  const dlg = s.page.locator('[role=dialog]').last();
  await dlg.getByLabel('Key root').selectOption({ label: 'A' });
  await dlg.getByLabel('Major or minor').selectOption('minor');
  await dlg.locator('label', { hasText: 'Answer phrase' }).first().click();
  await s.wait(300);
  return dlg;
}

async function finished(s) {
  await s.blank();
  await chords(s);
  await accompany(s);
  await melody(s);
  const dlg = await variationsDialog(s);
  await dlg.getByRole('button', { name: 'Make it' }).click();
  await s.wait(1000);
  await closeInspector(s);
  // Close the piano roll, and turn the loop off so all 8 bars play
  await s.page.locator('[title="Close editor (Esc)"]').first().click();
  await s.wait(400);
  await s.page.keyboard.press('Escape');
  await s.page.keyboard.press('l');
  await s.wait(400);
}

export const SHOTS = [
  {
    file: 'chords-progression',
    alt: 'The Chord progression dialog on the Space Clav track: key A minor, progression i – VI – III – VII, each chord 1 bar, twice through, held chords, and the chords Am – F – C – G spelled out.',
    caption: 'Right-click a lane, choose Chord progression…, and pick a key and a progression.',
    setup: async (s) => {
      await s.blank();
      await chordDialog(s);
      return s.dialog();
    },
  },
  {
    file: 'chords-scale',
    alt: 'The piano roll with the Am F C G clip open and SCALE set to A Minor: the rows outside the key shaded dark, the A rows lit, three-note chords in each bar.',
    caption: 'SCALE set to A Minor: notes outside the key are shaded, every A is lit.',
    setup: async (s) => {
      await s.blank();
      await chords(s);
      await s.openClip('Am F C G');
      await setScale(s);
      return s.pianoRoll();
    },
  },
  {
    file: 'chords-accompaniment',
    alt: 'The Accompaniment for these chords dialog with Alberti bass chosen, on a Concert Grand (Real) piano.',
    caption: 'Right-click the chord clip for an accompaniment that follows each chord.',
    setup: async (s) => {
      await s.blank();
      await chords(s);
      await accompanyDialog(s);
      return s.dialog();
    },
  },
  {
    file: 'chords-melody',
    alt: 'The piano roll of the Pluck 1 clip in A minor: sixteen quarter-note boxes making a tune over four bars, with a rest at the end.',
    caption: 'The tune: a quarter note a beat, chord notes on beats 1 and 3.',
    setup: async (s) => {
      await s.blank();
      await chords(s);
      await accompany(s);
      await melody(s);
      return s.pianoRoll();
    },
  },
  {
    file: 'chords-variations',
    alt: 'The Melody variations dialog: key A minor, Answer phrase chosen, and Put it set to after it, on its track.',
    caption: 'Melody variations… writes the tune another way. Set the key to A minor first.',
    setup: async (s) => {
      await s.blank();
      await chords(s);
      await accompany(s);
      await melody(s);
      await variationsDialog(s);
      return s.dialog();
    },
  },
  {
    file: 'chords-timeline',
    alt: 'The timeline: Am F C G chords on Space Clav, an Alberti bass track under them, and on the Pluck track the tune in bars 1 to 4 followed by its answer phrase in bars 5 to 8.',
    caption: 'Eight bars: chords, an accompaniment, the tune and its answer.',
    setup: async (s) => {
      await finished(s);
      await s.page.evaluate(() => window.scrollTo(0, 0));
      await s.zoomOut(1);
      return s.timeline();
    },
  },
];

export const EXAMPLES = [
  {
    name: 'chords-and-melody',
    label: 'Am – F – C – G with an Alberti bass, the tune and its answer phrase.',
    setup: finished,
  },
];
