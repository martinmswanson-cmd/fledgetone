// Screenshots and examples for learn/08-sound-design.md (taken by scripts/guide-shots/capture.mjs --learn).
//
// The lesson's own sounds (a sung phrase for the Slicer, four drum hits for the Drum Rack) are made
// here as WAV files and handed to the studio's own file pickers, as if picked from the computer.
import { voiceWav } from './07-vocals.mjs';

/** Mono samples (-1..1) as a 16-bit WAV file. */
function wav(samples, rate = 44100) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 0.8 * 32767), 44 + i * 2);
  return buf;
}

/** A drum hit made from a formula: `f(t, noise)` for `seconds`. */
function hit(seconds, f, rate = 44100) {
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  return wav(Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => f(i / rate, noise)), rate);
}

/** Four hits for the Drum Rack, as files named like your own would be. */
function drumFiles() {
  let phase = 0, last = 0;
  return [
    { name: 'my-kick.wav', buffer: hit(0.5, (t) => { phase += (45 + 120 * Math.exp(-t / 0.03)) / 44100; return Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.18); }) },
    { name: 'my-snare.wav', buffer: hit(0.3, (t, n) => (0.5 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.05) + 0.6 * n() * Math.exp(-t / 0.09))) },
    { name: 'my-hat.wav', buffer: hit(0.12, (t, n) => { const x = n(); const y = x - last; last = x; return 0.7 * y * Math.exp(-t / 0.025); }) },
    { name: 'my-clap.wav', buffer: hit(0.35, (t, n) => n() * ([0, 0.012, 0.024].some((d) => t >= d && t < d + 0.01) ? 0.9 : 0.5 * Math.exp(-(t - 0.03) / 0.08) * (t > 0.03 ? 1 : 0))) },
  ];
}

const SD = 'section[aria-label="Synth Designer"]';


/** Set a range slider to `value` (for a log slider, `log` is its [low, high] and `value` the real value). */
async function slide(locator, value, log) {
  await locator.evaluate((el, [value, log]) => {
    const v = log ? Math.log(value / log[0]) / Math.log(log[1] / log[0]) : value;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [value, log ?? null]);
  await locator.page().waitForTimeout(60);
}

/** The slider called `label` in the block of a panel whose heading starts with `block` (Osc 2, Filter envelope...). */
function knob(s, root, block, label) {
  return s.page
    .locator(`${root} div.flex-col`)
    .filter({ has: s.page.locator(`xpath=./*[1][starts-with(normalize-space(.), "${block}")]`) })
    .filter({ has: s.page.getByLabel(label, { exact: true }) })
    .last()
    .getByLabel(label, { exact: true });
}

/** Switch a track's instrument (SOUND GENERATOR in the Inspector), from its mixer strip. */
async function instrument(s, track, search) {
  await s.title(`${track}: open in the Inspector`).click();
  await s.wait(500);
  await s.text('SOUND GENERATOR').locator('xpath=../..').locator('button').last().click();
  await s.wait(400);
  await s.page.keyboard.type(search);
  await s.wait(300);
  await s.page.keyboard.press('Enter');
  await s.wait(800);
}

/** A new track from + Add Track, found by name. */
async function addTrack(s, search) {
  await s.text('Add Track').first().click();
  await s.wait(400);
  await s.page.getByPlaceholder(/Search: name/).fill(search);
  await s.wait(300);
  await s.page.keyboard.press('Enter');
  await s.wait(1000);
}

/** Scroll the panel this element is in (not the page) so the element is at its top. */
async function scrollTo(locator, gap = 8) {
  await locator.first().evaluate((el, gap) => {
    let p = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
    if (p) p.scrollTop += el.getBoundingClientRect().top - p.getBoundingClientRect().top - gap;
  }, gap);
  await locator.page().waitForTimeout(300);
}

/** The visible part of the Inspector (its scrolling panel) this element is in. */
async function inspectorBox(locator) {
  return locator.first().evaluate((el) => {
    let p = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
    const r = p.getBoundingClientRect();
    return { x: r.x + scrollX - 1, y: r.y + scrollY - 4, width: r.width + 2, height: r.height + 8 };
  });
}

/** The pluck: Init saw, a second saw an octave up, a low filter its envelope snaps open, no sustain. */
async function pluck(s) {
  await instrument(s, 'Arp', 'synth designer');
  await s.q(SD).getByLabel('Preset').selectOption('Init saw');
  await s.q(SD).locator('label', { hasText: 'Osc 2' }).locator('input').check();
  await s.q(SD).getByLabel('Osc 2 wave').selectOption('sawtooth');
  await slide(knob(s, SD, 'Osc 2', 'Octave'), 1);
  await slide(knob(s, SD, 'Osc 2', 'Level'), 0.4);
  await slide(knob(s, SD, 'Filter', 'Cutoff'), 500, [20, 20000]);
  await slide(knob(s, SD, 'Filter', 'Reso'), 4);
  await slide(knob(s, SD, 'Filter', 'Env amt'), 4);
  await slide(knob(s, SD, 'Filter envelope', 'Decay'), 0.18, [0.001, 10]);
  await slide(knob(s, SD, 'Filter envelope', 'Sustain'), 0);
  await slide(knob(s, SD, 'Amp envelope', 'Decay'), 0.35, [0.001, 10]);
  await slide(knob(s, SD, 'Amp envelope', 'Sustain'), 0);
  await slide(knob(s, SD, 'Amp envelope', 'Release'), 0.2, [0.005, 10]);
  await s.wait(300);
}

/** The pad: two saws in a 5-voice unison through the warm Ladder filter, slow to swell and to fade. */
async function pad(s) {
  await instrument(s, 'Pad', 'synth designer');
  await s.q(SD).getByLabel('Preset').selectOption('Init saw');
  await s.q(SD).locator('label', { hasText: 'Osc 2' }).locator('input').check();
  await s.q(SD).getByLabel('Osc 2 wave').selectOption('sawtooth');
  await slide(knob(s, SD, 'Sub, noise', 'Unison'), 5);
  await slide(knob(s, SD, 'Sub, noise', 'Spread'), 25);
  await slide(knob(s, SD, 'Sub, noise', 'Width'), 0.9);
  await s.q(SD).getByLabel('Filter type').selectOption('ladder');
  await slide(knob(s, SD, 'Filter', 'Cutoff'), 1200, [20, 20000]);
  await slide(knob(s, SD, 'Filter', 'Env amt'), 1);
  await slide(knob(s, SD, 'Filter', 'Drift'), 0.3);
  await slide(knob(s, SD, 'Filter envelope', 'Attack'), 1.5, [0.001, 10]);
  await slide(knob(s, SD, 'Filter envelope', 'Decay'), 1.8, [0.001, 10]);
  await slide(knob(s, SD, 'Filter envelope', 'Sustain'), 0.6);
  await slide(knob(s, SD, 'Filter envelope', 'Release'), 2, [0.005, 10]);
  await slide(knob(s, SD, 'Amp envelope', 'Attack'), 1.2, [0.001, 10]);
  await slide(knob(s, SD, 'Amp envelope', 'Decay'), 1.8, [0.001, 10]);
  await slide(knob(s, SD, 'Amp envelope', 'Sustain'), 0.9);
  await slide(knob(s, SD, 'Amp envelope', 'Release'), 2, [0.005, 10]);
  await s.q(SD).getByLabel('LFO target').selectOption('filter');
  await s.q(SD).getByLabel('LFO rate').selectOption('1/1');
  await slide(knob(s, SD, 'LFO', 'Depth'), 0.2);
  await s.wait(300);
}

const DD = 'section[aria-label="Drum Designer"]';

/** The Designed Kit's snare: Crisp snare with a clap layered 8 ms behind it; the kick a Punchy short kick, a little deeper. */
async function drums(s) {
  await instrument(s, 'Drums', 'designed kit');
  const dd = s.q(DD);
  await dd.locator('[aria-label="Drum row"] button', { hasText: /^Kick$/ }).click();
  await dd.getByLabel('Preset').selectOption({ label: 'Punchy short kick' });
  await slide(knob(s, DD, 'Layer 1', 'Pitch'), 48, [25, 120]);
  await slide(knob(s, DD, 'Layer 1', 'Decay'), 0.4, [0.05, 3]);
  await dd.locator('[aria-label="Drum row"] button', { hasText: /^Snare$/ }).click();
  await dd.getByLabel('Preset').selectOption({ label: 'Crisp snare' });
  await dd.getByText('ADD LAYER').click();
  await s.wait(300);
  await slide(knob(s, DD, 'Layer 2', 'Delay'), 8);
  await s.wait(400);
}

const LAYERS = 'section[aria-label="Layers"]';

/** A coin: Retro › Coin, then one square layer jumping up a fourth. */
async function coin(s) {
  await s.view('Sound effects');
  await s.q('[aria-label="Kinds of sound"] button').filter({ hasText: 'Retro' }).click();
  await s.q('[aria-label="Make a new sound"] button').filter({ hasText: /^Coin$/ }).click();
  await s.wait(600);
  const l = s.q(LAYERS);
  await l.locator('[aria-label="Source"] button').filter({ hasText: /^square$/ }).click();
  const set = (label, v) => slide(l.getByLabel(label, { exact: true }), v);
  await set('Pitch', Math.log2(988));
  await set('Slide', 0);
  await set('Jump', 5);
  await set('Jump at', 0.15);
  await set('Attack', 0);
  await set('Hold', 0.08);
  await set('Punch', 0.5);
  await set('Decay', 0.3);
  await set('Width', 0.5);
  await s.wait(600);
}

export const SHOTS = [
  {
    file: 'sound-pluck',
    alt: 'The Synth Designer in the Inspector: Osc 1 a saw, Osc 2 a saw an octave up at 40%, and the Low-pass filter at 500 Hz with Reso 4.0 and Env amt +4.0 oct.',
    caption: 'The pluck: two saws an octave apart, through a low filter that its envelope snaps open.',
    setup: async (s) => {
      await s.starter('Space Station');
      await pluck(s);
      await scrollTo(s.q(SD));
      return inspectorBox(s.q(SD));
    },
  },
  {
    file: 'sound-pad',
    alt: 'The Synth Designer further down: the Ladder filter at 1.2 kHz with Drift 30%, the filter envelope (1.50 s, 1.80 s, 60%, 2.00 s), the amp envelope (1.20 s, 1.80 s, 90%, 2.00 s) and the LFO on the filter at 1/1, depth 20%.',
    caption: 'The pad: slow envelopes, a warm Ladder filter and a slow LFO moving it once a bar.',
    setup: async (s) => {
      await s.starter('Space Station');
      await pad(s);
      await scrollTo(s.q(SD).getByLabel('Filter type'), 20);
      return inspectorBox(s.q(SD));
    },
  },
  {
    file: 'sound-drum-designer',
    alt: 'The Drum Designer with the Snare row picked: Layer 1 the Crisp snare (Tone 230 Hz, Noise 100%, Snap 70%), Layer 2 a clap at -8 dB with Delay 8.0 ms. The preset box now reads Your own sound.',
    caption: 'A designed snare: Crisp snare with a clap layered 8 ms behind.',
    setup: async (s) => {
      await s.starter('Space Station');
      await drums(s);
      await scrollTo(s.q(DD));
      return inspectorBox(s.q(DD));
    },
  },
  {
    file: 'sound-coin',
    alt: 'The Sound FX tab making Coin 1: one square layer at 990 Hz, Jump +5 st at 15%, Hold 80 ms, Punch 50%, Decay 300 ms, Width 50%.',
    caption: 'A coin from the sound effects maker: a square wave that jumps up a fourth.',
    setup: async (s) => {
      await s.starter('Platformer');
      await coin(s);
      await scrollTo(s.page.getByLabel('Sound name'));
      return s.union([s.page.getByLabel('Sound name'), s.q(LAYERS)], 10);
    },
  },
  {
    file: 'sound-slicer',
    alt: 'The Slicer panel with my-vocal.wav loaded: its waveform cut into 9 slices, from C3, with CUT set to Auto and SENS at 50.',
    caption: 'A sung phrase in the Slicer, cut at each word: 9 slices, one per key from C3.',
    setup: async (s) => {
      await s.starter('Space Station');
      await addTrack(s, 'slicer');
      const chooser = s.page.waitForEvent('filechooser');
      await s.page.getByRole('button', { name: /Load a sound/ }).first().click();
      await (await chooser).setFiles({ name: 'my-vocal.wav', mimeType: 'audio/wav', buffer: voiceWav() });
      await s.wait(2500);
      const panel = s.page.getByLabel('Slice sensitivity').locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');
      await scrollTo(panel);
      return s.union(panel, 8);
    },
  },
  {
    file: 'sound-drum-rack',
    alt: 'The Drum Rack panel: the bottom row of pads holds my-kick, my-snare, my-hat and my-clap; my-hat is selected, with its Level, Pan, Pitch, Decay, filters, Drive and Choke.',
    caption: 'Your own hits on the Drum Rack: Load sounds… fills the pads in order from pad 1.',
    setup: async (s) => {
      await s.starter('Space Station');
      await addTrack(s, 'drum rack');
      const chooser = s.page.waitForEvent('filechooser');
      await s.page.getByRole('button', { name: /Load sounds/ }).first().click();
      await (await chooser).setFiles(drumFiles().map((f) => ({ ...f, mimeType: 'audio/wav' })));
      await s.wait(2500);
      await s.text('my-hat').first().click();
      await s.wait(400);
      const panel = s.q('[data-search="drum rack pads"]');
      await scrollTo(panel);
      return s.union(panel, 8);
    },
  },
  {
    file: 'sound-plugins',
    alt: 'The plugin browser: a search box, the groups down the side (Instruments, Recommended, Basic and each kind of effect), and a list of plugins with Add buttons.',
    caption: 'Plugins › Browse plugins…: hundreds of built-in effects and instruments.',
    setup: async (s) => {
      await s.starter('Space Station');
      await s.menu('Plugins', 'Browse plugins');
      await s.wait(2500);
      return s.dialog();
    },
  },
];

export const EXAMPLES = [
  {
    name: 'space-station-designed',
    label: 'The Space Station starter with this lesson\'s sounds: the pluck on the arp, the pad, and the designed kick and snare.',
    setup: async (s) => {
      await s.starter('Space Station');
      await pluck(s);
      await pad(s);
      await drums(s);
    },
  },
];
