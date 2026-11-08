// Tab and the app's popups, in a real browser: each family opened with the keyboard and with the
// mouse, then left with Tab and with Shift+Tab. Each time it checks that the popup closed, that
// focus went where it should (Shift+Tab off the top: back on what opened it; Tab off the end: on to
// the next stop, or for a popup moved to the end of the page, the stop after what opened it), and
// that a global shortcut works right after (L switches the loop; while any menu or dialog is open
// every shortcut is off, see src/components/keyboard.ts and src/components/popupKeys.ts). It also
// checks that the mouse works as before (a click on the menu's button closes it; a click on a
// popup's text keeps it open) and that a right-click menu opened from the keyboard takes focus on
// its first item, moves with the arrow keys and gives focus back when Esc closes it. Families:
//   - the menu bar's menus (File)
//   - the floating pickers (Add Track)
//   - every popover on the main screen (Recording, MIDI input, Fit tempo, Loop range, Markers,
//     Performance) and in the piano roll (Drum groove, Groove feel, Roll painter, when shown)
//   - the right-click menus (a clip's, a marker's, a track's, the ruler's) and the tempo editor
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/ui-check/popup-tab.cjs
//
// APP_URL overrides http://localhost:5200/. Needs Playwright with Chromium. Exit code 0 when every
// step passes.
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}

const APP = process.env.APP_URL || 'http://localhost:5200/';
let failures = 0;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
};

const SONG = {
  format: 'fledgetone-project',
  version: 1,
  name: 'Popups',
  bpm: 120,
  swing: 0,
  loopRegion: { inBar: 1, outBar: 5, enabled: false },
  markers: [{ id: 'm1', bar: 3, name: 'Verse' }],
  tracks: [
    { id: 't1', name: 'Lead', instrumentKey: 'lead', volume: -8, pan: 0, reverbSend: 0, delaySend: 0 },
    { id: 't2', name: 'Drums', instrumentKey: 'drums', volume: -8, pan: 0, reverbSend: 0, delaySend: 0 },
  ],
  clips: [
    { id: 'c1', trackId: 't1', name: 'Lead', startBar: 1, lengthBars: 2, isSelected: false, notes: [{ id: 'n1', note: 'C4', startOffset: 0, duration: '4n', velocity: 0.8 }] },
    { id: 'c2', trackId: 't2', name: 'Beat', startBar: 1, lengthBars: 1, isSelected: false, notes: [{ id: 'd1', note: 'C2', startOffset: 0, duration: '16n', velocity: 0.8 }] },
  ],
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => step('no page error', false, e.message));
  await page.goto(APP + '?studio');
  await page.waitForFunction(() => !!document.querySelector('#menu-file'), null, { timeout: 60000 });
  const load = async () =>
    page.evaluate(async (song) => {
      const T = await import('/src/store/timelineStore.ts');
      const P = await import('/src/store/project.ts');
      T.useTimelineStore.getState().loadProject(P.parseProject(song));
    }, SONG);
  await load();
  // (Sound on: the Performance badge shows while it runs)
  await page.evaluate(async () => (await import('/src/audio/engine.ts')).initAudio());
  await page.waitForTimeout(800);
  const key = (k) => page.keyboard.press(k);

  /** What's open, where focus is, and whether the loop is on */
  const state = () =>
    page.evaluate(async () => {
      const s = (await import('/src/store/timelineStore.ts')).useTimelineStore.getState();
      const e = document.activeElement;
      const name = (el) => (!el || el === document.body ? 'BODY' : `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().slice(0, 40)}"`);
      return {
        popups: [...document.querySelectorAll('[role="menu"], [role="dialog"]')].map((p) => `${p.getAttribute('role')}:${p.getAttribute('aria-label') || '?'}`),
        focus: name(e),
        inPopup: !!e?.closest('[role="menu"], [role="dialog"]'),
        loop: s.loopRegion.enabled,
        scrollY: window.scrollY,
      };
    });
  /** The element focus is on, as a handle (to compare with an expected one) */
  const focused = () => page.evaluateHandle(() => document.activeElement);
  const same = (a, b) => page.evaluate(([x, y]) => x === y, [a, b]);
  /** L switches the loop (twice: back as it was); focus on a text field: the key goes to the window as if typed elsewhere */
  const shortcutWorks = async () => {
    const before = (await state()).loop;
    const typing = await page.evaluate(() => {
      const e = document.activeElement;
      return e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement || e instanceof HTMLSelectElement || !!e?.isContentEditable;
    });
    const press = typing
      ? () => page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', bubbles: true })))
      : () => key('l');
    await press();
    await page.waitForTimeout(120);
    const after = (await state()).loop;
    await press();
    await page.waitForTimeout(120);
    return after !== before;
  };
  /** Tab (or Shift+Tab) until focus leaves the popup (at most `max` presses): how many it took */
  const tabOut = async (shift, max = 80) => {
    for (let n = 1; n <= max; n++) {
      await key(shift ? 'Shift+Tab' : 'Tab');
      await page.waitForTimeout(40);
      const s = await state();
      if (!s.inPopup && s.focus !== 'BODY') return n;
    }
    return max;
  };
  /** The stop Tab goes to from `selector` with nothing open */
  const stopAfter = async (selector) => {
    await page.locator(selector).first().focus();
    await key('Tab');
    await page.waitForTimeout(60);
    return focused();
  };
  const closeAll = async () => {
    for (let i = 0; i < 3 && (await state()).popups.length; i++) {
      await key('Escape');
      await page.waitForTimeout(120);
    }
  };
  /** One popup, opened by `open`, left by Tab (`shift`: Shift+Tab): closed, focus where `expect` says, L works */
  const leave = async (name, open, shift, expect) => {
    await closeAll();
    await open();
    await page.waitForTimeout(250);
    const opened = await state();
    if (!opened.popups.length) return step(`${name}: opens`, false, JSON.stringify(opened));
    const n = await tabOut(shift);
    await page.waitForTimeout(150);
    const s = await state();
    step(`${name}: ${shift ? 'Shift+Tab' : 'Tab'} out (${n} presses) closes it`, s.popups.length === 0, JSON.stringify(s));
    if (expect) {
      const want = await expect();
      const ok = await same(await focused(), want.handle);
      const wanted = await page.evaluate((el) => (el && el.tagName ? `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().slice(0, 40)}"` : String(el && el.nodeName)), want.handle);
      step(`${name}: focus goes ${want.where}`, ok, ok ? s.focus : `${s.focus}, not ${wanted}`);
    }
    step(`${name}: L works right after`, await shortcutWorks());
  };
  const opener = (selector) => async () => ({ where: 'back on what opened it', handle: await page.locator(selector).first().elementHandle() });

  // --- The menu bar's menus (in their place, after the menu bar's buttons) ---
  const FILE = '#menu-file';
  const byKeys = (selector) => async () => {
    await page.locator(selector).first().focus();
    await key('Enter');
  };
  const byMouse = (selector) => () => page.locator(selector).first().click();
  await leave('File menu (Enter)', byKeys(FILE), false, null);
  await leave('File menu (Enter)', byKeys(FILE), true, opener(FILE));
  await leave('File menu (click)', byMouse(FILE), false, null);
  await leave('File menu (click)', byMouse(FILE), true, opener(FILE));
  // A Tab from the menu's button while it's open goes into the menu
  await closeAll();
  await page.locator(FILE).click();
  await page.waitForTimeout(200);
  await page.locator(FILE).focus();
  await key('Tab');
  await page.waitForTimeout(80);
  step('File menu: Tab from its button goes into it', (await state()).inPopup, JSON.stringify(await state()));
  // The mouse as before: its button toggles it, another button opens that menu
  await closeAll();
  await page.locator(FILE).click();
  await page.waitForTimeout(150);
  await page.locator(FILE).click();
  await page.waitForTimeout(150);
  step('File menu: a second click on its button closes it', (await state()).popups.length === 0, JSON.stringify(await state()));
  await page.locator(FILE).click();
  await page.waitForTimeout(150);
  await page.locator('#menu-edit').click();
  await page.waitForTimeout(150);
  step('File menu: a click on Edit opens the Edit menu', JSON.stringify((await state()).popups) === '["menu:Edit"]', JSON.stringify(await state()));
  await closeAll();

  // --- The floating pickers (moved to the end of the page) ---
  const ADD = 'button[title="Add a new instrument track"]';
  const after = (selector) => async () => {
    await closeAll();
    return { where: 'to the stop after what opened it', handle: await stopAfter(selector) };
  };
  // (The stop after the button, found before opening)
  const addNext = await after(ADD)();
  const expectAddNext = async () => addNext;
  await leave('Add Track picker (Enter)', byKeys(ADD), false, expectAddNext);
  await leave('Add Track picker (Enter)', byKeys(ADD), true, opener(ADD));
  await leave('Add Track picker (click)', byMouse(ADD), false, expectAddNext);
  await leave('Add Track picker (click)', byMouse(ADD), true, opener(ADD));
  // The mouse as before: a click on its own heading keeps it open, a second click on the button closes it
  await closeAll();
  await page.locator(ADD).click();
  await page.waitForTimeout(250);
  const heading = await page.evaluate(() => {
    const box = document.querySelector('[role="dialog"][aria-label="Add instrument track"]');
    const all = box ? [...box.querySelectorAll('*')] : [];
    const el = all.find((x) => x.children.length === 0 && x.textContent.trim() && !x.closest('button, input, [tabindex]'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: el.textContent.trim().slice(0, 30) };
  });
  if (heading) {
    await page.mouse.click(heading.x, heading.y);
    await page.waitForTimeout(200);
    step(`Add Track picker: a click on its text ("${heading.text}") keeps it open`, (await state()).popups.includes('dialog:Add instrument track'));
  }
  await page.locator(ADD).click();
  await page.waitForTimeout(200);
  step('Add Track picker: a second click on its button closes it', (await state()).popups.length === 0, JSON.stringify(await state()));

  // --- Popovers (in their place, after their button) ---
  const POPOVERS = [
    ['Recording', 'button[title^="Recording settings"]'],
    ['MIDI input', 'button[title^="MIDI input"]'],
    ['Fit tempo', 'button[title^="Fit to time"]'],
    ['Loop range', 'button[title^="Loop In, Out and Length"]'],
    ['Markers', 'button[title^="Markers: list"]'],
    ['Performance', 'button[title="Performance and memory"], button[title^="Playback is lagging"]'],
  ];
  const popovers = async (list) => {
    for (const [name, sel] of list) {
      if (!(await page.locator(sel).count())) {
        step(`${name} popover: its button is on the screen`, false);
        continue;
      }
      // (Where Tab goes from the popover's end with it open: the stop after it, as the browser takes it)
      await leave(`${name} popover (Enter)`, byKeys(sel), false, null);
      // (Focus stays on its button: into it first, if it has anything to stop on)
      await closeAll();
      await byKeys(sel)();
      await page.waitForTimeout(200);
      const stops = await page.evaluate(async () => {
        const { tabStops } = await import('/src/components/popupKeys.ts');
        const box = [...document.querySelectorAll('[role="dialog"]')].pop();
        return box ? tabStops(box).length : -1;
      });
      if (stops > 0)
        await leave(`${name} popover (Enter)`, async () => {
          await byKeys(sel)();
          await page.waitForTimeout(150);
          if (!(await state()).inPopup) await key('Tab');
        }, true, opener(sel));
      else console.log(`(${name} popover: nothing in it to stop on now, so no Shift+Tab from inside it)`);
      await leave(`${name} popover (click)`, byMouse(sel), false, null);
      // Shift+Tab from its button while it's open leaves it too
      await closeAll();
      await page.locator(sel).first().click();
      await page.waitForTimeout(200);
      await page.locator(sel).first().focus();
      await key('Shift+Tab');
      await page.waitForTimeout(150);
      step(`${name} popover: Shift+Tab from its button closes it`, (await state()).popups.length === 0, JSON.stringify(await state()));
    }
  };
  await popovers(POPOVERS);
  // The mouse as before: a click on a popover's text keeps it open
  await closeAll();
  await page.locator(POPOVERS[0][1]).click();
  await page.waitForTimeout(250);
  const text = await page.evaluate(() => {
    const box = document.querySelector('[role="dialog"][aria-label="Recording"]');
    const el = box && [...box.querySelectorAll('*')].find((x) => x.children.length === 0 && x.textContent.trim().length > 3 && !x.closest('button, input, select, label, [tabindex]'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + 4, y: r.top + r.height / 2 };
  });
  if (text) {
    await page.mouse.click(text.x, text.y);
    await page.waitForTimeout(200);
    step('Recording popover: a click on its text keeps it open', (await state()).popups.includes('dialog:Recording'), JSON.stringify(await state()));
  }
  await closeAll();

  // --- Right-click menus ---
  const CLIP = '[data-clip-id="c1"]';
  // (The stop after the clip once it's selected, as Shift+F10 leaves it)
  await page.locator(CLIP).click();
  await page.waitForTimeout(150);
  const clipNext = await after(CLIP)();
  const shiftF10 = (selector) => async () => {
    await page.locator(selector).first().focus();
    await key('Shift+F10');
  };
  // Opened from the keyboard: focus on its first item, the arrows move, Esc gives focus back
  await closeAll();
  await shiftF10(CLIP)();
  await page.waitForTimeout(250);
  let s = await state();
  step('clip menu (Shift+F10): focus on its first item', s.inPopup && s.popups.includes('menu:?'), JSON.stringify(s));
  const firstItem = s.focus;
  const y0 = s.scrollY;
  await key('ArrowDown');
  await page.waitForTimeout(150);
  s = await state();
  step('clip menu: ArrowDown moves to the next item, the menu stays', s.inPopup && s.focus !== firstItem && s.popups.length === 1 && s.scrollY === y0, JSON.stringify(s));
  await key('ArrowUp');
  await page.waitForTimeout(100);
  step('clip menu: ArrowUp moves back', (await state()).focus === firstItem);
  await key('Escape');
  await page.waitForTimeout(150);
  s = await state();
  step('clip menu: Esc closes it, focus back on the clip', s.popups.length === 0 && (await same(await focused(), await page.locator(CLIP).elementHandle())), JSON.stringify(s));
  step('clip menu: L works right after Esc', await shortcutWorks());
  await leave('clip menu (Shift+F10)', shiftF10(CLIP), false, async () => ({ where: 'to the stop after the clip', handle: clipNext.handle }));
  await leave('clip menu (Shift+F10)', shiftF10(CLIP), true, opener(CLIP));
  // Opened with the mouse: as before, it doesn't take focus; a Tab goes into it
  await closeAll();
  await page.locator(CLIP).click({ button: 'right' });
  await page.waitForTimeout(250);
  s = await state();
  step('clip menu (right-click): opens without taking focus, as before', s.popups.length === 1 && !s.inPopup, JSON.stringify(s));
  await key('Tab');
  await page.waitForTimeout(100);
  step('clip menu (right-click): a Tab goes into it', (await state()).inPopup, JSON.stringify(await state()));
  await leave('clip menu (right-click)', () => page.locator(CLIP).click({ button: 'right' }), false, null);
  await leave('clip menu (right-click)', async () => {
    await page.locator(CLIP).click({ button: 'right' });
    await page.waitForTimeout(150);
    await key('Tab');
  }, true, opener(CLIP));
  // A marker's menu, a track's menu, the ruler's menu
  const flagSel = '[aria-label^="Marker Verse at"]';
  if (await page.locator(flagSel).count()) {
    await leave('marker menu (Shift+F10)', shiftF10(flagSel), false, null);
    await leave('marker menu (Shift+F10)', shiftF10(flagSel), true, opener(flagSel));
  } else step('marker menu: its flag is on the screen', false);
  const HEADER = '[data-tour="track-header"]';
  await leave('track menu (right-click)', () => page.locator(HEADER).first().click({ button: 'right', position: { x: 60, y: 8 } }), false, null);
  await leave('ruler menu (right-click)', async () => {
    const box = await page.evaluate(() => {
      const b = document.querySelector('[data-tour="ruler"]')?.getBoundingClientRect();
      return b ? { x: b.left + 300, y: b.top + b.height - 4 } : null;
    });
    if (box) await page.mouse.click(box.x, box.y, { button: 'right' });
  }, false, null);
  // The tempo editor, opened from the keyboard on the song's tempo flag
  const TEMPO = 'button[title^="The song\'s tempo:"]';
  if (await page.locator(TEMPO).count()) {
    await leave('tempo editor (Shift+F10)', shiftF10(TEMPO), false, null);
    await leave('tempo editor (Shift+F10)', shiftF10(TEMPO), true, opener(TEMPO));
  } else step("tempo editor: the song's tempo flag is on the screen", false);

  // --- The piano roll's popovers (open the clip's editor first) ---
  await closeAll();
  await page.locator('[data-clip-id="c2"]').focus();
  await key('Enter');
  await page.waitForTimeout(1000);
  const inRoll = [
    ['Drum groove', 'button[title^="Swing per drum"]'],
    ['Groove feel', 'button[title^="How much of the feel"]'],
    ['Roll painter', 'button[title^="Hat roll painter"]'],
  ];
  const shown = [];
  for (const [name, sel] of inRoll) if (await page.locator(sel).count()) shown.push([name, sel]);
  console.log(`(in the piano roll: ${shown.map((x) => x[0]).join(', ') || 'none of them shown'})`);
  await popovers(shown);

  console.log(failures ? `${failures} step(s) failed` : 'every step passed');
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
