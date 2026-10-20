// Screenshots and examples for learn/02-first-beat.md (taken by scripts/guide-shots/capture.mjs --learn).

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

/** The piano roll's grid: where beat 1 starts and how wide a 16th is, from its ruler. */
async function grid(s) {
  const ruler = s.page.locator('[aria-label="Piano roll"]').last();
  const one = await ruler.locator('xpath=.//*[not(*) and normalize-space(.)="1.1"]').first().boundingBox();
  const two = await ruler.locator('xpath=.//*[not(*) and normalize-space(.)="1.2"]').first().boundingBox();
  return { x0: one.x - 2, step: (two.x - one.x) / 4 };
}

/** A drum row's y in the piano roll. */
async function rowY(s, name) {
  // (In STEPS a row's name has a ▶ before it: click it to hear the sound)
  const b = await s.page.locator('button', { hasText: new RegExp(`^(▶\\s*)?${name}$`) }).last().boundingBox();
  return b.y + b.height / 2;
}

/** Click a step pattern into the open drum clip: { Kick: 'x...x...', ... } (X: an accent, Shift-click). */
async function steps(s, rows) {
  const g = await grid(s);
  for (const [name, pattern] of Object.entries(rows)) {
    const y = await rowY(s, name);
    const p = pattern.replace(/[| ]/g, '');
    for (let i = 0; i < p.length; i++) {
      if (p[i] === '.') continue;
      const x = g.x0 + g.step * i + g.step / 2;
      if (p[i] === 'X') await s.page.keyboard.down('Shift');
      await s.page.mouse.click(x, y);
      if (p[i] === 'X') await s.page.keyboard.up('Shift');
      await s.wait(50);
    }
  }
}

/** Scroll the drum rows to the bottom, so the Kick row shows whole. */
async function kickInView(s) {
  await s.page.evaluate(() => {
    const k = [...document.querySelectorAll('button')].filter((b) => b.textContent.replace('▶', '').trim() === 'Kick').pop();
    let e = k;
    while (e && !/(auto|scroll)/.test(getComputedStyle(e).overflowY)) e = e.parentElement;
    if (e) e.scrollTop = e.scrollHeight;
  });
  await s.wait(200);
}

const BACKBEAT = {
  Kick: 'x...|....|x...|....',
  Snare: '....|x...|....|x...',
  'Closed Hat': 'X.x.|X.x.|X.x.|X.x.',
};

/** A blank timeline with a one-bar drum clip open at bar 1 holding the backbeat. */
async function backbeat(s) {
  await s.blank();
  await s.page.mouse.dblclick(264, await laneY(s, 'Drums'));
  await s.wait(1200);
  await steps(s, BACKBEAT);
}

/** The backbeat filled over bars 1 to 4 with a snare-roll fill in bar 4, the piano roll closed. */
async function filled(s) {
  await backbeat(s);
  await s.page.keyboard.press('Escape');
  await s.wait(400);
  const y = await laneY(s, 'Drums');
  await context(s, 330, y, /^Fill to loop Out/);
  await context(s, 820, y, /^Fill: snare roll/);
}

export const SHOTS = [
  {
    file: 'first-beat-new',
    alt: 'The New arrangement dialog, with Blank timeline (four empty tracks) as the first choice.',
    caption: 'File › New… › Blank timeline: four empty tracks to start from.',
    setup: async (s) => {
      await s.page.getByRole('menuitem', { name: 'File', exact: true }).click();
      await s.page.getByRole('menuitem', { name: /^New/ }).click();
      await s.wait(600);
      const d = await s.dialog();
      const b = await s.page.locator('[role=dialog] button', { hasText: 'Blank timeline' }).first().boundingBox();
      return { x: d.x, y: d.y, width: d.width, height: b.y + b.height + 16 - d.y };
    },
  },
  {
    file: 'first-beat-backbeat',
    alt: 'The piano roll of a drum clip: rows for each drum, with the kick on beats 1 and 3, the snare on 2 and 4 and closed hats on every 8th, the hats on the beat brighter.',
    caption: 'A backbeat in the drum rows: kick on 1 and 3, snare on 2 and 4, hats on every 8th.',
    setup: async (s) => {
      await backbeat(s);
      for (let i = 0; i < 4; i++) await s.page.locator('[aria-label="Piano roll"] [title="Zoom in"]').click();
      await s.page.mouse.move(1300, 120);
      await kickInView(s);
      return s.pianoRoll();
    },
  },
  {
    file: 'first-beat-roll',
    alt: 'A rap beat pattern in the piano roll, a beat-long closed hat selected on beat 4 and the ROLL panel open with the rate set to 1/32.',
    caption: 'ROLL… turns the selected hat into a roll: 1/32 here, rising.',
    setup: async (s) => {
      await s.blank();
      await s.page.mouse.dblclick(264, await laneY(s, 'Drums'));
      await s.wait(1200);
      await steps(s, {
        Kick: 'x...|...x|..x.|....',
        Snare: '....|....|x...|....',
        'Closed Hat': 'x.x.|x.x.|x.x.|....',
      });
      // A beat-long hat on beat 4 (Alt-click adds a NEW NOTE-long note), then Alt-click it to select it
      await s.page.locator('select').filter({ hasText: '1/8 dotted' }).first().selectOption({ label: '1/4' });
      const g = await grid(s);
      const y = await rowY(s, 'Closed Hat');
      for (const dx of [4, 30]) {
        await s.page.keyboard.down('Alt');
        await s.page.mouse.click(g.x0 + g.step * 12 + dx, y);
        await s.page.keyboard.up('Alt');
        await s.wait(300);
      }
      await kickInView(s);
      await s.page.getByText('ROLL…', { exact: true }).click();
      await s.wait(400);
      const pop = s.page.locator('[role=dialog]').last();
      await pop.locator('select').first().selectOption({ label: '1/32' });
      await s.page.mouse.move(1300, 1000);
      await s.wait(300);
      return s.pianoRoll();
    },
  },
  {
    file: 'first-beat-filled',
    alt: 'The Drums track with four copies of the one-bar clip filling bars 1 to 4 under the amber loop, the last ending in a snare roll.',
    caption: 'Fill to loop Out repeats the bar up to the loop\'s end; bar 4 ends in a snare-roll fill.',
    setup: async (s) => {
      await filled(s);
      await s.page.mouse.click(1300, await laneY(s, 'Brass Stabs'));
      await s.page.mouse.move(1300, 120);
      await s.wait(300);
      const top = await s.q('[title^="The song\'s tempo"]').first().boundingBox();
      const lane = await laneY(s, 'Drums');
      return { x: 17, y: top.y - 8, width: 900, height: lane + 52 - (top.y - 8) };
    },
  },
  {
    file: 'first-beat-fill-menu',
    alt: 'The right-click menu of a drum clip, with Fill to loop Out and the four Fill items: snare roll, tom run, build-up and kick pickup.',
    caption: 'Right-click a drum clip for Fill to loop Out and the four fills.',
    setup: async (s) => {
      await backbeat(s);
      await s.page.keyboard.press('Escape');
      await s.wait(400);
      await s.page.mouse.click(330, await laneY(s, 'Drums'), { button: 'right' });
      await s.wait(500);
      const menu = s.page.locator('[role=menu]').last();
      return s.union([menu, s.text('Drums 1').first()], 10);
    },
  },
  {
    file: 'first-beat-drummer',
    alt: 'The Drummer dialog: Style set to Backbeat, Length 8 bars, a fill every 4 bars, the Energy slider at steady and Make clip at bar 1.',
    caption: 'The Drummer writes a whole part in a style you pick.',
    setup: async (s) => {
      await s.blank();
      await context(s, 264, await laneY(s, 'Drums'), /^Drummer/);
      return s.dialog();
    },
  },
];

export const EXAMPLES = [
  {
    name: 'first-beat',
    label: 'The finished beat: the backbeat with shuffled hats, four bars, and a snare-roll fill at the end.',
    setup: async (s) => {
      await backbeat(s);
      await s.page.locator('select').filter({ hasText: "Song's swing" }).first().selectOption({ label: 'Swing 8ths: shuffle' });
      await s.wait(300);
      await s.page.keyboard.press('Escape');
      await s.wait(400);
      const y = await laneY(s, 'Drums');
      await context(s, 330, y, /^Fill to loop Out/);
      await context(s, 820, y, /^Fill: snare roll/);
    },
  },
];
