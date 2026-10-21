// Screenshots and examples for learn/10-game-music.md (taken by scripts/guide-shots/capture.mjs --learn).

/** Rename a section marker (double-click its flag, type the new name). */
async function rename(s, from, to) {
  await s.q(`[aria-label^="Marker ${from} at"]`).first().dblclick();
  await s.wait(300);
  await s.page.keyboard.press('Control+a');
  await s.page.keyboard.type(to);
  await s.page.keyboard.press('Enter');
  await s.wait(500);
}

/** Plaza with its sections named for the game (Explore, Danger) and a third state: a marker called Travel at bar 5. */
async function plaza(s) {
  await s.starter('Plaza');
  await rename(s, 'Verse', 'Explore');
  await rename(s, 'Montuno', 'Danger');
  // The playhead to bar 5 (typed in BAR.BEAT.TICK), then M drops a marker there
  await s.title('Click to type a bar position').first().click();
  await s.page.keyboard.type('5');
  await s.page.keyboard.press('Enter');
  await s.wait(300);
  await s.page.keyboard.press('m');
  await s.wait(500);
  await rename(s, 'Marker 1', 'Travel');
}

/** The Game tab, with the bottom panel dragged taller so a whole column fits. */
async function gameTab(s, extra = 320) {
  await s.menu('Game', /^Game panel/);
  await s.wait(500);
  const h = await s.page.getByLabel('Resize the bottom panel').boundingBox();
  await s.page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await s.page.mouse.down();
  await s.page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 - extra, { steps: 8 });
  await s.page.mouse.up();
  await s.wait(500);
}

/** Explore → Danger a fill, Danger → Explore a crossfade over 8 beats, Travel → Danger a 2-bar bridge on the next 4-bar phrase. */
async function bridgeRule(s) {
  await s.q('[data-game=transitions] summary').click();
  await s.wait(300);
  await s.page.getByLabel(/^Transition from Explore to Danger/).click();
  await s.wait(300);
  await s.page.getByLabel('Transition kind').selectOption({ label: 'Fill' });
  await s.wait(300);
  await s.page.getByLabel(/^Transition from Danger to Explore/).click();
  await s.wait(300);
  await s.page.getByLabel('Transition kind').selectOption({ label: 'Crossfade' });
  await s.wait(300);
  await s.page.getByLabel('Crossfade length').selectOption({ label: 'over 8 beats' });
  await s.wait(300);
  await s.page.getByLabel(/^Transition from Travel to Danger/).click();
  await s.wait(300);
  await s.page.getByLabel('Transition kind').selectOption({ label: 'Bridge' });
  await s.wait(300);
  await s.page.getByLabel('When').selectOption({ label: 'on the next phrase' });
  await s.wait(200);
  await s.page.getByLabel('Phrase length').selectOption({ label: 'of 4 bars' });
  await s.page.getByLabel('Bridge length').selectOption({ index: 1 });
  await s.wait(300);
}

/** The lesson's stingers: Checkpoint, Item found and Victory. */
async function stingers(s) {
  for (const label of ['Checkpoint: two notes: "got it"', 'Item found: up through two chords to a bright one', 'Victory: a fanfare: a pickup into a big chord']) {
    await s.page.getByLabel('Add a stinger').selectOption({ label });
    await s.wait(800);
  }
}

/** A floating window: the nearest box around a heading at least this big. */
async function windowOf(s, heading, minW, minH) {
  // Windows are fixed on screen: measure them with the page scrolled to the top
  await s.page.evaluate(() => scrollTo(0, 0));
  await s.wait(200);
  return s.text(heading).last().evaluate((el, [mw, mh]) => {
    let e = el;
    while (e.parentElement && (e.getBoundingClientRect().width < mw || e.getBoundingClientRect().height < mh)) e = e.parentElement;
    const b = e.getBoundingClientRect();
    return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height };
  }, [minW, minH]);
}

export const SHOTS = [
  {
    file: 'game-states',
    alt: 'The States column of the Game tab: three state buttons, Explore, Travel and Danger, with Explore lit green as the state playing, and the switch timing menu set to on the next bar.',
    caption: 'Every section between markers is a state. Click one to play it; the playing state is green.',
    setup: async (s) => {
      await plaza(s);
      await gameTab(s);
      await s.q('[data-game=states] button').filter({ hasText: /^Explore$/ }).first().click();
      await s.wait(1500);
      const col = await s.union(s.q('[data-game=states]'), 10);
      const top = await s.union(s.q('[data-game=transitions]'));
      return { ...col, height: top.y + top.height - col.y + 8 };
    },
  },
  {
    file: 'game-transitions',
    alt: 'The transition matrix: rows for Any, Explore, Travel and Danger, columns for each state. Explore to Danger is a Fill, Danger to Explore a crossfade, and Travel to Danger a 2-bar bridge on the next 4-bar phrase, open for editing below.',
    caption: 'The transition matrix: Travel to Danger set to a 2-bar bridge on the next phrase.',
    setup: async (s) => {
      await plaza(s);
      await gameTab(s);
      await bridgeRule(s);
      return s.union(s.q('[data-game=transitions]'), 10);
    },
  },
  {
    file: 'game-intensity',
    alt: 'The Intensity section: a slider at 40 percent, each track with its on switch and stem group (Ambient, Climax, Tension, Percussion, or none), and a curve per group showing how loud it plays at each intensity.',
    caption: 'Stem groups and their curves. The dashed line is the intensity now.',
    setup: async (s) => {
      await plaza(s);
      await gameTab(s, 420);
      await s.page.getByLabel('Nylon guitar: stem group').selectOption({ label: 'Ambient' });
      await s.page.getByLabel('Intensity (Game preview)').fill('0.4');
      await s.wait(600);
      // Down to the end of the last curve, before Parameters
      const col = await s.union(s.q('[data-game=intensity]'), 10);
      const params = await s.union(s.q('[data-game=parameters]'));
      return { ...col, height: params.y - col.y };
    },
  },
  {
    file: 'game-stingers',
    alt: 'The Stingers column: the new Checkpoint, Item found and Victory stingers, each with an instrument, another-version, put-on-timeline and delete button, then Export stingers and the game kit exports: For, Export game kit, Try it in a game, Audition like the game, the web runtime kit and FMOD / Wwise package.',
    caption: 'Stingers, and every way to take the music into a game.',
    setup: async (s) => {
      await plaza(s);
      await gameTab(s);
      await stingers(s);
      const col = await s.union(s.q('[data-game=stingers]'), 10);
      const end = await s.union(s.q('[data-game=export]'), 10);
      return { ...col, height: end.y + end.height - col.y };
    },
  },
  {
    file: 'game-audition',
    alt: 'Audition like the game: big pads for the Explore, Travel and Danger states, smaller pads for the stingers, the Effect buttons (None, Underwater, Muffled, Low health, Dream) and an Intensity slider.',
    caption: 'Audition like the game plays the states the way the game kit will.',
    setup: async (s) => {
      await plaza(s);
      await gameTab(s);
      await bridgeRule(s);
      await s.page.getByRole('button', { name: /Audition like the game/ }).first().click();
      await s.page.waitForFunction(() => {
        const d = [...document.querySelectorAll('[role=dialog]')].pop();
        return d && /Click a state to start/.test(d.textContent) && !/Rendering/.test(d.textContent);
      }, null, { timeout: 400000, polling: 1000 });
      await s.wait(500);
      return windowOf(s, 'Audition like the game', 500, 300);
    },
  },
  {
    file: 'game-try',
    alt: 'Try it in a game: a small 3D field with a little orange robot in the middle, coins around it and a purple one-eyed cube guard at the top. The panel at the top left shows three hearts, the coins, the music state playing and the intensity; Music wiring is open on the right.',
    caption: 'Try it in a game: walk the robot about and hear the music react.',
    setup: async (s) => {
      await plaza(s);
      await gameTab(s);
      await bridgeRule(s);
      await stingers(s);
      await s.menu('Game', /^Try it in a game/);
      await s.page.waitForFunction(() => !/Rendering the music/.test(document.querySelector('[role=dialog]')?.textContent ?? ''), null, { timeout: 400000, polling: 1000 });
      await s.wait(1500);
      await s.page.getByRole('button', { name: /Music wiring/ }).click();
      await s.wait(800);
      return windowOf(s, 'Try it in a game', 1000, 1000);
    },
  },
];

export const EXAMPLES = [
  {
    name: 'plaza-states',
    label: 'Plaza with three states (Explore, Travel, Danger), a fill, a crossfade and a bridge between them, the guitar in the Ambient group and three stingers.',
    setup: async (s) => {
      await plaza(s);
      await gameTab(s);
      await bridgeRule(s);
      await s.page.getByLabel('Nylon guitar: stem group').selectOption({ label: 'Ambient' });
      await stingers(s);
    },
  },
];
