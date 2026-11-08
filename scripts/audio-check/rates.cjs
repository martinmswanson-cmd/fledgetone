// Check that a song sounds the same at every sample rate: live playback runs at the computer's
// rate (often 48 kHz), the default export is 44.1 kHz, WAV exports can be 48, 88.2 or 96 kHz and
// video exports are 48 kHz.
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/audio-check/rates.cjs
//   RATES=44100,48000,88200,96000 node scripts/audio-check/rates.cjs
//   ONLY=bass808,wobbleBass node scripts/audio-check/rates.cjs       (cases whose name starts so)
//
// Each case is a song of one track rendered through the app's own export path (renderArrangement,
// the master section left out unless MASTER=1) at each rate in RATES (default 44.1, 48 and
// 96 kHz), and its level is compared with the 44.1 kHz render's (dB RMS, both sides), window by
// window, measured from the case's first sound. The cases, each a past bug:
// - Sounds with a driven part beside a clean one (the 808 Bass, both voices; Wobble and Growl
//   Bass): the browser's oversampled drive holds its part back a fixed number of samples, a
//   different time at each rate, so the two parts met differently (up to 6 dB on an 808's attack
//   at 96 kHz). The Sub enhancer's clean sine under a driven bass (Reese, Slap Bass) the same.
//   Four hits; the whole, the first 50 ms of each hit and the rest; also where the first sound is
//   (it mustn't move with the rate). Within 0.1 dB.
// - Rooms built from a repeatable noise (a guitar's studio room, a harp's or violin's stage, the
//   song's reverb, a track's Reverb insert): made sample by sample at each rate, each rate had
//   another room (a note's body moved up to 6.5 dB). One note per render: its attack (0-50 ms),
//   body (50-300 ms) and, for the reverbs, 0.3-1 s and 1-1.9 s. Within 0.2 dB.
// It exits with 1 when any case is off by more. APP_URL overrides http://localhost:5200/. Needs
// Playwright with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const fs = require('fs');

const APP = process.env.APP_URL || 'http://localhost:5200/';
const RATES = (process.env.RATES || '44100,48000,96000').split(',').map(Number);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const MASTER = process.env.MASTER === '1';
const load = () => { try { return fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' '); } catch { return '?'; } };

const BASS_LIMIT = 0.1;
const ROOM_LIMIT = 0.2;
const BASS_WINDOWS = [['whole', null, null], ['attack', 0, 0.05], ['rest', 0.05, 0.45]];
const NOTE_WINDOWS = [['attack', 0, 0.05], ['body', 0.05, 0.3]];
const TAIL_WINDOWS = [['body', 0.05, 0.3], ['0.3-1 s', 0.3, 1], ['1-1.9 s', 1, 1.9]];
/** The Sub enhancer on the note itself, full level, held */
const SUB = { mode: 'fundamental', level: 1, decay: 0 };
// [name, instrument, notes, track settings, windows, limit, hits]
const CASES = [
  ['bass808 classic', 'bass808', ['C2', 'A#1'], { expressive: false }, BASS_WINDOWS, BASS_LIMIT, 4],
  ['bass808 Expressive', 'bass808', ['C2', 'A#1'], { expressive: true }, BASS_WINDOWS, BASS_LIMIT, 4],
  ['wobbleBass', 'wobbleBass', ['E1', 'C2'], {}, BASS_WINDOWS, BASS_LIMIT, 4],
  ['growlBass', 'growlBass', ['E1', 'C2'], {}, BASS_WINDOWS, BASS_LIMIT, 4],
  ['reeseBass', 'reeseBass', ['E1'], {}, BASS_WINDOWS, BASS_LIMIT, 4],
  ['reeseBass + Sub enhancer', 'reeseBass', ['E1', 'C2'], { subLayer: SUB }, BASS_WINDOWS, BASS_LIMIT, 4],
  ['bass + Sub enhancer', 'bass', ['C2'], { subLayer: SUB }, BASS_WINDOWS, BASS_LIMIT, 4],
  ['realNylonGuitar studio', 'realNylonGuitar', ['E2', 'B3', 'E4'], {}, NOTE_WINDOWS, ROOM_LIMIT, 1],
  ['guitar studio', 'guitar', ['B3'], {}, NOTE_WINDOWS, ROOM_LIMIT, 1],
  ['nylonGuitar (retro) studio', 'nylonGuitar', ['B3'], {}, NOTE_WINDOWS, ROOM_LIMIT, 1],
  ['realFolkHarp stage', 'realFolkHarp', ['D3', 'G#4', 'D4'], {}, NOTE_WINDOWS, ROOM_LIMIT, 1],
  ['realViolin stage', 'realViolin', ['E4', 'A4'], {}, NOTE_WINDOWS, ROOM_LIMIT, 1],
  ['song reverb', 'realGrandPiano', ['B3', 'E4'], { reverbSend: 1 }, TAIL_WINDOWS, ROOM_LIMIT, 1],
  ['Reverb insert', 'realGrandPiano', ['B3', 'E4'], { reverb: { on: true, mix: 0.3 } }, TAIL_WINDOWS, ROOM_LIMIT, 1],
];

// In the page: render case `c`'s note at every rate; each window's level (dB) and the first sound (ms)
const RENDER = async ({ c, note, rates, master }) => {
  const ex = await import('/src/audio/exportWav.ts');
  const T = await import('/src/store/timelineTypes.ts');
  const { loadSamples } = await import('/src/audio/samplers/samplerManager.ts');
  const [, key, , extra, windows, , hits] = c;
  await loadSamples(key).catch(() => {});
  const fx = T.defaultTrackFx();
  if (extra.reverb) fx.reverb = { ...fx.reverb, ...extra.reverb };
  const track = { id: 't', name: 't', color: '#888888', instrumentKey: key, isMuted: false, isSoloed: false, isArmed: false, volume: -6, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx, reverbSend: extra.reverbSend ?? 0, delaySend: 0, expressive: !!extra.expressive, ...(extra.subLayer ? { subLayer: extra.subLayer } : {}) };
  // Hits a bar apart (2 s at 120 BPM), each a quarter note
  const notes = Array.from({ length: hits }, (_, k) => ({ id: 'n' + k, note, startOffset: k, duration: '4n', velocity: 0.9 }));
  const bars = hits + 1;
  const song = { tracks: [track], clips: [{ id: 'c', trackId: 't', name: 'c', startBar: 1, lengthBars: bars, isSelected: false, notes }], bpm: 120, swing: 0, startBar: 1, endBar: 1 + bars, masterFx: T.DEFAULT_MASTER_FX, master: T.defaultMasterSettings() };
  const out = [];
  for (const sampleRate of rates) {
    const a = await ex.renderArrangement({ ...song, ending: 'exact', sampleRate, bypassMaster: !master });
    const sr = a.sampleRate;
    const L = a.getChannelData(0), R = a.numberOfChannels > 1 ? a.getChannelData(1) : L;
    let on = 0;
    while (on < L.length && Math.abs(L[on]) < 1e-4 && Math.abs(R[on]) < 1e-4) on++;
    const power = (i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += (L[i] * L[i] + R[i] * R[i]) / 2; return s / Math.max(1, i1 - i0); };
    const level = {};
    for (const [name, from, to] of windows) {
      let p = 0;
      if (from === null) p = power(0, L.length);
      else for (let k = 0; k < hits; k++) { const s = on + Math.round(k * 2 * sr); p += power(s + Math.round(from * sr), Math.min(L.length, s + Math.round(to * sr))) / hits; }
      level[name] = 10 * Math.log10(p + 1e-30);
    }
    out.push({ sr, on: (on / sr) * 1000, level });
  }
  return out;
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--mute-audio'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('page error:', String(e).slice(0, 200)));
  await page.addInitScript(() => { try { localStorage.setItem('bosBeatbox.welcomeSeen', 'true'); } catch {} });
  await page.goto(APP + '?blank', { waitUntil: 'networkidle' });
  page.setDefaultTimeout(1800000);
  console.log(`# rates ${APP} | rates ${RATES.join(', ')} | master ${MASTER ? 'on' : 'off'} | load ${load()} | dB against the 44.1 kHz render`);
  let bad = 0;
  for (const c of CASES) {
    if (ONLY && !ONLY.some((o) => c[0].startsWith(o))) continue;
    const [name, , notes, , windows, limit] = c;
    for (const note of notes) {
      const r = await page.evaluate(RENDER, { c, note, rates: [44100, ...RATES.filter((x) => x !== 44100)], master: MASTER });
      const base = r[0];
      let worst = 0;
      const parts = r.slice(1).map((x) => {
        const d = windows.map(([w]) => x.level[w] - base.level[w]);
        worst = Math.max(worst, ...d.map(Math.abs));
        const late = x.on - base.on;
        return `${x.sr / 1000}k ${windows.map(([w], i) => `${w} ${d[i] >= 0 ? '+' : ''}${d[i].toFixed(2)}`).join(' ')}${Math.abs(late) >= 0.05 ? ` (first sound ${late > 0 ? '+' : ''}${late.toFixed(2)} ms)` : ''}`;
      });
      const ok = worst <= limit;
      if (!ok) bad++;
      console.log(`${ok ? 'ok ' : 'OFF'} ${name} ${note}: 44.1k ${windows.map(([w]) => `${w} ${base.level[w].toFixed(1)}`).join(' ')} dB | ${parts.join(' | ')} | worst ${worst.toFixed(2)} dB (limit ${limit})`);
    }
  }
  console.log(`# ${bad ? `${bad} off` : 'all within their limits'} | load ${load()}`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
