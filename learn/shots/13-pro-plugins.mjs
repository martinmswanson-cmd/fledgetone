// Screenshots for learn/13-pro-plugins.md (taken by scripts/guide-shots/capture.mjs --learn).
// Every setup opens the Lo-Fi starter, turns the sound on (a plugin takes a preset only once the
// audio runs) and adds the lesson's plugins through the plugin browser, as a reader does.

const WINDOW = '[data-plugin-window]';

/** The Lo-Fi starter, played for a moment so the audio is running. */
async function open(s) {
  await s.starter('Lo-Fi');
  await s.page.keyboard.press('Space');
  await s.wait(1500);
  await s.page.keyboard.press('Space');
  await s.wait(400);
}

/** Select a track by its name in the track list. */
async function select(s, track) {
  await s.q('[data-tour="track-header"]').filter({ hasText: track }).first().click({ position: { x: 60, y: 14 } });
  await s.wait(300);
}

/** Add a built-in effect to `track` from the plugin browser; with a preset, and a sidechain, chosen in its window. */
async function add(s, track, search, { preset, sidechain } = {}) {
  await select(s, track);
  await s.menu('Plugins', 'Browse plugins');
  const dialog = s.page.getByRole('dialog', { name: 'Plugins' });
  await dialog.getByRole('textbox', { name: 'Search plugins' }).fill(search);
  await s.wait(400);
  await dialog.getByRole('button', { name: 'Add', exact: true }).first().click();
  await s.wait(1500);
  const win = s.q(WINDOW).last();
  if (sidechain) {
    await win.locator('select[aria-label="Sidechain from track"]').selectOption({ label: sidechain });
    await s.wait(500);
  }
  if (preset) {
    const menu = win.locator('select[aria-label="Preset"]');
    const options = await menu.locator('option').allTextContents();
    await menu.selectOption({ index: options.findIndex((o) => o.includes(preset)) });
    await s.wait(1500);
  }
  return win;
}

/** A slider of a plugin window, by its label, set with the arrow keys as a reader can. */
async function nudge(s, win, label, key, times) {
  const row = win.locator('label, div').filter({ hasText: new RegExp(`^${label}`) }).locator('input[type=range]').first();
  await row.focus();
  for (let i = 0; i < times; i++) await s.page.keyboard.press(key);
  await s.wait(500);
}

const windowBox = (s) => s.union(s.q(WINDOW).last(), 10);

export const SHOTS = [
  {
    file: 'pro-carve',
    alt: 'Fledge Carve’s window on the Keys track: Sidechain from set to Flute, the preset Pads under the lead, and sliders for Amount (9.0 dB), Threshold, Attack, Release, From (300 Hz), To and Removed only.',
    caption: 'Fledge Carve on the Keys, listening to the Flute: the keys give way only where the flute is.',
    setup: async (s) => {
      await open(s);
      await add(s, 'Keys', 'carve', { sidechain: 'Flute', preset: 'Pads under the lead' });
      return windowBox(s);
    },
  },
  {
    file: 'pro-analyser',
    alt: 'The Spectrum analyser window showing the Keys as a filled shape with the Flute drawn over it as a line, from 20 Hz to 20 kHz.',
    caption: 'Tools › Spectrum analyser (Shift+A): the Keys, with the Flute drawn against them.',
    setup: async (s) => {
      await open(s);
      await s.menu('Tools', 'Spectrum analyser');
      const win = s.q('[data-floating-window][aria-label="Spectrum analyser"]');
      await win.locator('select[aria-label="Show the spectrum of"]').selectOption({ label: 'Keys' });
      await win.locator('select[aria-label="Compare against"]').selectOption({ label: 'Flute' });
      await s.page.keyboard.press('Space');
      // (Far enough into the song that the flute is playing)
      await s.wait(9000);
      const box = await s.union(win, 10);
      return box;
    },
  },
  {
    file: 'pro-smooth',
    alt: 'Fledge Smooth’s window on the Flute track: the preset Soften a vocal, with Depth 40 %, Stands out by 4.0 dB, Attack, Release, From 2.0 kHz, To 10.0 kHz and Removed only.',
    caption: 'Fledge Smooth on the Flute: only the bands that ring out, only while they do.',
    setup: async (s) => {
      await open(s);
      await add(s, 'Flute', 'smooth', { preset: 'Soften a vocal' });
      return windowBox(s);
    },
  },
  {
    file: 'pro-dyneq',
    alt: 'Fledge Dynamic EQ’s window on the Bass track with the preset Tame the boom, only when it booms: Band 1 at 120 Hz with a gain of 0 dB, moves by -8.0 dB, threshold -26.0 dB, works on Stereo; the other bands flat.',
    caption: 'A band that moves: nothing at 120 Hz until the bass booms, then up to 8 dB down.',
    setup: async (s) => {
      await open(s);
      await add(s, 'Bass', 'dynamic', { preset: 'Tame the boom' });
      return windowBox(s);
    },
  },
  {
    file: 'pro-heat',
    alt: 'Fledge Heat’s window on the Bass track with the preset Bass that speaks on small speakers: Low / mid 120 Hz, Mid / high 2.5 kHz, Low style Tube with 20 dB of drive, Mid style Warm with 8 dB, High style Clean.',
    caption: 'Fledge Heat on the Bass: a tube low end, a little warmth in the middle, a clean top.',
    setup: async (s) => {
      await open(s);
      await add(s, 'Bass', 'heat', { preset: 'Bass that speaks' });
      return windowBox(s);
    },
  },
  {
    file: 'pro-shape',
    alt: 'Fledge Shape’s window on the Rain track: Moves Volume, Shape Duck, Every 1/4, Depth 50 %, Smooth and Starts at 0 %.',
    caption: 'Fledge Shape on the Rain: a Duck on the volume every quarter note, half way down.',
    setup: async (s) => {
      await open(s);
      const win = await add(s, 'Rain', 'shape', { preset: 'Pump on every beat' });
      // Depth from 80 % to 50 % (a press is a thousandth of the slider)
      await nudge(s, win, 'Depth', 'ArrowLeft', 300);
      return windowBox(s);
    },
  },
];
