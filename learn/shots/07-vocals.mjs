// Screenshots and examples for learn/07-vocals.md (taken by scripts/guide-shots/capture.mjs --learn).
//
// A screenshot can't sing into a real microphone, so the shots that record give the page a stand-in
// one: navigator.mediaDevices.getUserMedia is replaced (in that shot's page only) by a stream that
// plays a short sung "ah" phrase made here, a little off the notes, as a real take would be. The
// studio records it through its own Mic button exactly as it would a voice.

/** A short sung-like phrase ("ah", 140 BPM, 4 bars per pass), a little off the notes, as a 16-bit WAV. */
export function voiceWav({ bpm = 140, beats = 16, rate = 44100, passes = 1 } = {}) {
  const beat = 60 / bpm;
  // [start beat, length in beats, MIDI note, cents off]: around C minor
  const phrase = [[0, 1.5, 63, -38], [2, 0.75, 60, 32], [3, 1, 62, -45], [4, 2.5, 63, 28], [7, 0.75, 67, -30], [8, 1.5, 65, 40], [10, 1, 63, -35], [11.5, 0.5, 62, 25], [12, 3, 60, -28]];
  const notes = [];
  for (let p = 0; p < passes; p++) {
    // Each pass sung a little differently: later or earlier, shorter or longer, off the other way
    for (const [b, len, midi, cents] of phrase) notes.push([b + p * beats + (p % 2 ? 0.25 : 0), len * (p % 2 ? 0.75 : 1), midi, p % 2 ? -cents * 0.6 : cents]);
  }
  const n = Math.round(beats * passes * beat * rate);
  const out = new Float32Array(n);
  const formants = [[730, 90, 1], [1090, 110, 0.5], [2440, 160, 0.25]];
  const res = (f) => formants.reduce((a, [fc, bw, g]) => a + g / Math.sqrt(1 + ((f - fc) / bw) ** 2), 0);
  for (const [b, len, midi, cents] of notes) {
    const dur = len * beat * 0.92;
    const i0 = Math.round(b * beat * rate), m = Math.round(dur * rate);
    let phase = 0;
    for (let i = 0; i < m && i0 + i < n; i++) {
      const t = i / rate;
      const scoop = -60 * Math.exp(-t / 0.05); // sliding up into the note
      const vib = t > 0.25 ? 28 * Math.sin(2 * Math.PI * 5.5 * t) : 0;
      const f0 = 440 * 2 ** ((midi - 69 + (cents + scoop + vib) / 100) / 12);
      phase += f0 / rate;
      let s = 0;
      for (let k = 1; k * f0 < 5000; k++) s += (res(k * f0) / k) * Math.sin(2 * Math.PI * k * phase);
      out[i0 + i] += 0.35 * s * Math.min(1, t / 0.03) * Math.min(1, (dur - t) / 0.06);
    }
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round((out[i] / peak) * 0.7 * 32767), 44 + i * 2);
  return buf;
}

/** The page's microphone becomes the sung phrase (passes of it, back to back). */
async function fakeMic(s, passes = 1) {
  await s.page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = (window.__fakeMicCtx = new AudioContext());
      const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
      const dest = ctx.createMediaStreamDestination();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      src.start(ctx.currentTime + 0.05);
      window.__fakeMicSrc = src;
      return dest.stream;
    };
  }, voiceWav({ passes }).toString('base64'));
}

/** Hide the "Playback is lagging" notice: the headless browser can't keep up while it records. */
const quiet = (s) => s.page.addStyleTag({ content: '[role=alert]:has(button[title^="Hide until playback"]){display:none!important}' });

/** The Rap Beat starter with an Audio track added (+ Add Track, "audio", Enter): it opens in the Inspector. */
async function rapWithAudio(s) {
  await s.starter('Rap Beat');
  await quiet(s);
  await s.text('Add Track').first().click();
  await s.wait(400);
  await s.page.getByPlaceholder(/Search: name/).fill('audio');
  await s.wait(300);
  await s.page.keyboard.press('Enter');
  await s.wait(1000);
}

/** The loop round bars 5 to 9 (the beat's first four bars), from the Loop range box. */
async function loop5to9(s) {
  await s.title('Loop In, Out and Length').click();
  await s.wait(300);
  await s.page.getByLabel('Loop In').fill('5');
  await s.page.keyboard.press('Enter');
  await s.page.getByLabel('Loop Out').fill('9');
  await s.page.keyboard.press('Enter');
  await s.page.keyboard.press('Escape');
  await s.wait(200);
}

/** Record `passes` times round the loop from its In point, then Stop (`early` ms before the end). */
async function record(s, passes = 1, early = -150) {
  await fakeMic(s, passes);
  await s.title('Go to In point').click();
  await s.page.getByRole('button', { name: /^Mic$/ }).click();
  await s.wait(passes * 6857 - early);
  await s.page.getByRole('button', { name: /^Stop/ }).filter({ hasText: 'Stop' }).first().click();
  await s.wait(2500);
  // Back to the take's start (the view follows the playhead), with the page at its top
  await s.title('Go to In point').click();
  await s.page.evaluate(() => scrollTo(0, 0));
  await s.wait(500);
}

/** Scroll the Inspector (not the page) so this element is at its top. */
async function scrollInspectorTo(locator) {
  await locator.first().evaluate((el) => {
    let p = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
    if (p) p.scrollTop += el.getBoundingClientRect().top - p.getBoundingClientRect().top - 8;
  });
  await locator.page().waitForTimeout(300);
}

/** Two boxes together. */
const merge = (a, b, pad = 0) => {
  const x = Math.min(a.x, b.x) - pad, y = Math.min(a.y, b.y) - pad;
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) + pad - x, height: Math.max(a.y + a.height, b.y + b.height) + pad - y };
};

export const SHOTS = [
  {
    file: 'vocals-settings',
    alt: 'The Recording settings popover open under the toolbar: 1-bar count-in, Quantize, Metronome while playing, Loop passes are takes ticked, Punch in / out and Click level.',
    caption: 'The recording settings, behind the arrow next to Record. Tick Loop passes are takes to sing a line several times.',
    setup: async (s) => {
      await rapWithAudio(s);
      await s.title('Recording settings').click();
      await s.wait(300);
      await s.page.locator('label', { hasText: 'Loop passes are takes' }).click();
      await s.wait(300);
      const pop = await s.popover();
      const bar = await s.union([s.title('Go to In point'), s.title('Record from the microphone')], 8);
      return merge(pop, bar);
    },
  },
  {
    file: 'vocals-recording',
    alt: 'The toolbar while recording: the Mic button has turned into a red Stop button with a green level meter, and the playhead readout is counting through bar 6.',
    caption: 'Recording: Mic turns into Stop, with a level meter beside it.',
    setup: async (s) => {
      await rapWithAudio(s);
      await loop5to9(s);
      await fakeMic(s, 1);
      await s.title('Go to In point').click();
      await s.page.getByRole('button', { name: /^Mic$/ }).click();
      await s.wait(2600);
      return s.union([s.title('Go to In point'), s.title('Toggle Track Inspector'), s.text('Add Track')], 10);
    },
  },
  {
    file: 'vocals-takes',
    alt: 'The Takes window for Mic take 1: three passes as waveform rows; Pass 2 is lit for the first three bars and Pass 3 for the last, and a Flatten button at the bottom.',
    caption: 'Three passes round the loop, comped: Pass 2 for three bars, Pass 3 for the last one.',
    setup: async (s) => {
      await rapWithAudio(s);
      await loop5to9(s);
      await s.title('Recording settings').click();
      await s.wait(300);
      await s.page.locator('label', { hasText: 'Loop passes are takes' }).click();
      await s.page.keyboard.press('Escape');
      // Stopped just before the third pass ends, so no sliver of a fourth pass becomes a take
      await record(s, 3, 250);
      await s.page.getByText(/^3T$/).first().click();
      await s.wait(1500);
      const dlg = s.page.locator('[role=dialog]').last();
      // Pass 2 all the way through, then Pass 3 dragged along the last bar
      await dlg.getByText('Pass 2', { exact: true }).click();
      await s.wait(500);
      // The take rows' waveforms (the wide drawings; the icons are small)
      const rows = [];
      for (const svg of await dlg.locator('svg').all()) {
        const b = await svg.boundingBox();
        if (b && b.width > 300) rows.push(b);
      }
      const row3 = rows[2];
      await s.page.mouse.move(row3.x + row3.width * 0.75 + 2, row3.y + row3.height / 2);
      await s.page.mouse.down();
      await s.page.mouse.move(row3.x + row3.width - 2, row3.y + row3.height / 2, { steps: 6 });
      await s.page.mouse.up();
      await s.wait(800);
      return s.dialog();
    },
  },
  {
    file: 'vocals-chain',
    alt: 'The Inspector of the Audio track: the Vocal chain panel with Clean lead lit and the Ad-lib track button, and under it Duck others under this switched on with Dip at -3 dB.',
    caption: 'A vocal chain in one click, and the beat ducking 3 dB under the vocal.',
    setup: async (s) => {
      await rapWithAudio(s);
      await s.page.getByRole('button', { name: 'Clean lead' }).click();
      await s.wait(400);
      await s.page.getByRole('switch', { name: 'Duck others under this off' }).click();
      await s.wait(300);
      const duck = s.page.locator('[data-search="Duck others under this"]');
      await duck.getByLabel('Dip').evaluate((el) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '3');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await s.wait(300);
      const chain = s.page.locator('[data-search="vocal chain"]');
      await scrollInspectorTo(chain);
      return s.union([chain, duck], 10);
    },
  },
  {
    file: 'vocals-tune',
    alt: 'The Tune vocal dialog: key C minor, Natural selected, Strength 80%, Speed 40 ms, and a graph of the sung pitch, wavering around the notes, with the tuned pitch in colour.',
    caption: 'Tune vocal: Natural pulls the voice most of the way onto C minor and keeps its slides and vibrato.',
    setup: async (s) => {
      await rapWithAudio(s);
      await loop5to9(s);
      await record(s, 1);
      await s.text('Mic take 1').first().click({ button: 'right' });
      await s.text('Tune vocal…').click();
      await s.wait(3000);
      return s.dialog();
    },
  },
  {
    file: 'vocals-hard-tune',
    alt: 'The Hard tune dialog: Strength 100%, Speed at instant (0 ms), and the tuned pitch drawn as flat steps on the notes of C minor.',
    caption: 'Hard tune: all the way, instantly. The pitch steps from note to note.',
    setup: async (s) => {
      await rapWithAudio(s);
      await loop5to9(s);
      await record(s, 1);
      await s.text('Mic take 1').first().click({ button: 'right' });
      await s.text('Hard tune…').click();
      await s.wait(3000);
      return s.dialog();
    },
  },
  {
    file: 'vocals-stack',
    alt: 'The timeline with three vocal tracks under the beat: Audio with the lead take, Ad-libs with a short take in bar 7, and Audio double with the double of the lead.',
    caption: 'The finished stack: the lead, an ad-lib track and a double of the lead.',
    setup: async (s) => {
      await rapWithAudio(s);
      await loop5to9(s);
      await s.page.getByRole('button', { name: 'Clean lead' }).click();
      await record(s, 1);
      await s.text('Mic take 1').first().click({ button: 'right' });
      await s.text('Double this take').click();
      await s.wait(6000);
      // Back to the lead, then an Ad-lib track under it, and a short take on it from bar 7
      await s.text('Audio').first().click();
      await s.wait(400);
      await s.page.getByRole('button', { name: /Ad-lib track/ }).click();
      await s.wait(1000);
      await fakeMic(s, 1);
      await s.title('Click to type a bar position').click();
      await s.page.keyboard.press('Control+a');
      await s.page.keyboard.type('7');
      await s.page.keyboard.press('Enter');
      await s.page.getByRole('button', { name: /^Mic$/ }).click();
      await s.wait(1900);
      await s.page.getByRole('button', { name: /^Stop/ }).filter({ hasText: 'Stop' }).first().click();
      await s.wait(2500);
      await s.title('Go to In point').click();
      await s.wait(500);
      return s.timeline();
    },
  },
];

export const EXAMPLES = [
  {
    name: 'vocal-ready',
    label: 'The Rap Beat starter with a lead vocal track (Clean lead, ducking the beat 3 dB) and an Ad-lib track, ready for you to record.',
    setup: async (s) => {
      await rapWithAudio(s);
      await loop5to9(s);
      await s.page.getByRole('button', { name: 'Clean lead' }).click();
      await s.wait(300);
      await s.page.getByRole('switch', { name: 'Duck others under this off' }).click();
      const duck = s.page.locator('[data-search="Duck others under this"]');
      await duck.getByLabel('Dip').evaluate((el) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '3');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await s.wait(300);
      await s.page.getByRole('button', { name: /Ad-lib track/ }).click();
      await s.wait(800);
    },
  },
];
