// Check that exporting the same song twice gives exactly the same file.
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/audio-check/repeat.cjs                         (every case below)
//   KEYS=synth node scripts/audio-check/repeat.cjs              (every generated instrument)
//   KEYS=drums,reeseBass FX=none STARTERS=none node scripts/audio-check/repeat.cjs
//   STARTERS=trap,drill THREADS=1 KEYS=none FX=none node scripts/audio-check/repeat.cjs
//
// Each case is rendered RUNS times (default 2) in one page through the app's own export path
// (renderArrangement, master section included), and every render is compared with the first:
// the largest difference between their samples (dBFS; "same" when there is none), where it is and
// where the first is (seconds into the file), and whether the 16-bit WAV files are the same bytes. The cases:
// - KEYS: instruments, each playing a short phrase alone (chords, legato, a range of
//   velocities; every drum of the kit for a kit). "synth", "drums", "sampled" and "all" stand for
//   those kinds in the instrument catalog; "none" for no instruments. Default: synth,drums.
// - FX: inserts, each switched on alone on a reference instrument (FX_KEY, default reeseBass;
//   the Pump on a kick-led pair). Default: every insert; "none" for none.
// - STARTERS: starter songs, their first STARTER_BARS bars (default 8). Default:
//   trap,drill,phonk,dubstep,classical; "none" for none.
// THREADS sets how many parts a mix may render in at once (1: in one piece; default: the
// browser's choice). Each line also carries a hash of the render, so two runs of this script (say
// with THREADS=1 and without, or in two fresh pages) can be compared too.
// It exits with 1 when any case differs. APP_URL overrides http://localhost:5200/. Needs Playwright
// with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';
const RUNS = Math.max(2, Number(process.env.RUNS || 2));
const list = (v, fallback) => (v === undefined || v === '' ? fallback : v === 'none' ? [] : v.split(','));
const INSERTS = ['distortion', 'compressor', 'chorus', 'filter', 'pump', 'lofi', 'gate', 'echo', 'reverb', 'human', 'peq', 'mbc', 'bassDrive', 'saturate', 'monoLow'];

// In the page: build case `c`, render it `runs` times, and compare
const RENDER = async ({ c, runs, threads }) => {
  const ex = await import('/src/audio/exportWav.ts');
  const T = await import('/src/store/timelineTypes.ts');
  const { INSTRUMENTS, isDrumKind } = await import('/src/audio/instrumentCatalog.ts');
  const { DRUM_NOTES } = await import('/src/audio/instruments.ts');
  const { loadSamples } = await import('/src/audio/samplers/samplerManager.ts');
  const { defaultBassDrive } = await import('/src/store/bassTools.ts');
  const sr = 44100;
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
  const track = (id, key, extra = {}) => ({ id, name: id, color: '#888', instrumentKey: key, isMuted: false, isSoloed: false, isArmed: false, volume: -6, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: T.defaultTrackFx(), reverbSend: 0.15, delaySend: 0.1, expressive: true, ...extra });
  let n = 0;
  const note = (m, startOffset, duration, velocity) => ({ id: 'n' + n++, note: typeof m === 'number' ? name(m) : m, startOffset, duration, velocity });
  // A phrase over 4 bars (positions in bars): a line up the range, a held chord, legato steps, repeats
  const phrase = (key) => {
    const [lo, hi] = INSTRUMENTS[key].range;
    const mid = Math.round((lo + hi) / 2);
    const out = [];
    for (let i = 0; i < 8; i++) out.push(note(Math.round(lo + ((hi - lo) * i) / 7), i / 8, '8n', 0.5 + 0.06 * i));
    for (const m of [mid - 5, mid, mid + 4]) out.push(note(Math.max(lo, Math.min(hi, m)), 1, '2n', 0.8));
    for (let i = 0; i < 6; i++) out.push(note(Math.max(lo, Math.min(hi, mid - 7 + 2 * i)), 1.5 + i / 16, '8n', 0.7));
    for (let i = 0; i < 8; i++) out.push(note(mid, 2 + i / 8, '16n', 0.3 + 0.08 * i));
    out.push(note(Math.max(lo, mid - 12), 3, '1n', 0.9));
    return out;
  };
  const beat = () => {
    const rows = Object.values(DRUM_NOTES);
    const out = [];
    for (let s = 0; s < 64; s++) {
      if (s % 4 === 0) out.push(note(DRUM_NOTES.kick, s / 16, '16n', 0.9));
      if (s % 8 === 4) out.push(note(DRUM_NOTES.snare, s / 16, '16n', 0.85));
      if (s % 2 === 0) out.push(note(DRUM_NOTES.closedHat, s / 16, '32n', 0.4 + (s % 4) * 0.1));
      out.push(note(rows[s % rows.length], s / 16 + 1 / 32, '16n', 0.35 + (s % 5) * 0.12));
    }
    return out;
  };
  const clip = (id, trackId, notes, lengthBars = 4) => ({ id, trackId, name: id, startBar: 1, lengthBars, notes, isSelected: false });
  const ON = {
    distortion: { on: true, amount: 0.5 }, compressor: { on: true, threshold: -24, ratio: 4, makeup: 3 }, chorus: { on: true, rate: 1.5, depth: 0.6, mix: 0.5 },
    filter: { on: true, type: 'lowpass', cutoff: 1200, resonance: 2, slope: 24 }, pump: { on: true, depth: 0.7, release: 300, trigger: 'kick' },
    lofi: { on: true, crush: 0.5, tone: 5000, wow: 0.5, mix: 1 }, gate: { on: true, rate: '1/16', depth: 0.9, length: 0.5 },
    echo: { on: true, time: '1/8d', feedback: 0.4, tone: 6000, pingPong: true, mix: 0.35 }, reverb: { on: true, decay: 2.2, preDelay: 20, tone: 9000, mix: 0.3 },
    human: { on: true, timing: 0.5, dynamics: 0.5, pitch: 0.5 }, mbc: { ...T.defaultTrackFx().mbc, on: true },
    peq: { on: true, bands: T.defaultPeqBands().map((b, i) => ({ ...b, on: true, gain: i % 2 ? 6 : -4 })) },
    bassDrive: { ...defaultBassDrive(), on: true }, saturate: { on: true, amount: 0.6, mix: 0.7 }, monoLow: { on: true, freq: 150 },
  };

  let song;
  if (c.kind === 'starter') {
    const { createStarter } = await import('/src/store/starters.ts');
    const p = createStarter(c.id);
    song = { tracks: p.tracks, clips: p.clips, bpm: p.bpm, tempoPoints: p.tempoPoints, swing: p.swing ?? 0, startBar: 1, endBar: 1 + c.bars, masterFx: p.masterFx ?? T.DEFAULT_MASTER_FX, master: p.master };
  } else if (c.kind === 'insert') {
    const t = track('t', c.key, { fx: { ...T.defaultTrackFx(), [c.fx]: ON[c.fx] } });
    const tracks = [t];
    const clips = [clip('c', 't', isDrumKind(c.key) ? beat() : phrase(c.key))];
    // The Pump follows a kit's kick
    if (c.fx === 'pump') {
      tracks.push(track('k', 'drums'));
      clips.push(clip('ck', 'k', beat()));
    }
    song = { tracks, clips, bpm: 120, swing: 0, startBar: 1, endBar: 5, masterFx: T.DEFAULT_MASTER_FX, master: T.defaultMasterSettings() };
  } else {
    song = { tracks: [track('t', c.key)], clips: [clip('c', 't', isDrumKind(c.key) ? beat() : phrase(c.key))], bpm: 120, swing: 0.2, startBar: 1, endBar: 5, masterFx: T.DEFAULT_MASTER_FX, master: T.defaultMasterSettings() };
  }
  for (const t of song.tracks) await loadSamples(t.instrumentKey).catch(() => {});
  const hashOf = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
  const renders = [];
  for (let r = 0; r < runs; r++) {
    const a = await ex.renderArrangement({ ...song, ending: 'ringOut', sampleRate: sr, threads });
    const channels = ex.channelsOf(a).map((ch) => ch.slice());
    const wav = new Uint8Array(await ex.encodeChannels(channels, sr, 16).arrayBuffer());
    const all = new Float32Array(channels.reduce((s, ch) => s + ch.length, 0));
    channels.reduce((at, ch) => (all.set(ch, at), at + ch.length), 0);
    renders.push({ channels, wav, hash: await hashOf(all.buffer) });
  }
  const first = renders[0];
  let worst = 0, worstAt = -1, firstAt = Infinity, sameWav = true, sameLength = true;
  for (const r of renders.slice(1)) {
    if (r.channels[0].length !== first.channels[0].length) sameLength = false;
    for (let ch = 0; ch < first.channels.length; ch++) {
      const a = first.channels[ch], b = r.channels[ch];
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > 0 && i < firstAt) firstAt = i;
        if (d > worst) [worst, worstAt] = [d, i];
      }
    }
    sameWav &&= r.wav.length === first.wav.length && r.wav.every((v, i) => v === first.wav[i]);
  }
  let peak = 0;
  for (const ch of first.channels) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const at = (i) => Math.round((i / sr) * 1000) / 1000;
  return { maxDiffDb: worst ? Math.round(200 * Math.log10(worst)) / 10 : null, ...(worst ? { firstAt: at(firstAt), worstAt: at(worstAt) } : {}), sameWav, sameLength, peakDb: Math.round(200 * Math.log10(peak || 1e-10)) / 10, hashes: renders.map((r) => r.hash) };
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  // gleitz.github.io is the same files as the repository's gh-pages branch, which some networks reach when the site isn't
  for (const [re, base] of [[/tonejs\.github\.io\/audio\/(.+)$/, 'https://raw.githubusercontent.com/Tonejs/audio/master/'], [/gleitz\.github\.io\/midi-js-soundfonts\/(.+)$/, 'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/']]) {
    await page.route(re, async (r) => {
      try {
        const response = await r.fetch({ url: base + r.request().url().match(re)[1] });
        return r.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
      } catch { return r.abort(); }
    });
  }
  page.on('pageerror', (e) => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(1, 5).join(' | ')));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 300)); });
  await page.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
  await page.goto(APP, { waitUntil: 'networkidle' });
  page.setDefaultTimeout(1800000);

  const catalog = await page.evaluate(async () => {
    const { INSTRUMENTS, INSTRUMENT_KEYS } = await import('/src/audio/instrumentCatalog.ts');
    return INSTRUMENT_KEYS.map((k) => ({ key: k, kind: INSTRUMENTS[k].kind }));
  });
  const keys = list(process.env.KEYS, ['synth', 'drums']).flatMap((k) => (['synth', 'drums', 'sampled'].includes(k) ? catalog.filter((i) => i.kind === k).map((i) => i.key) : k === 'all' ? catalog.filter((i) => ['synth', 'drums', 'sampled'].includes(i.kind)).map((i) => i.key) : [k]));
  const fxKey = process.env.FX_KEY || 'reeseBass';
  const cases = [
    ...[...new Set(keys)].map((key) => ({ kind: 'instrument', key, label: key })),
    ...list(process.env.FX, INSERTS).map((fx) => ({ kind: 'insert', key: fxKey, fx, label: `${fxKey}+${fx}` })),
    ...list(process.env.STARTERS, ['trap', 'drill', 'phonk', 'dubstep', 'classical']).map((id) => ({ kind: 'starter', id, bars: Number(process.env.STARTER_BARS || 8), label: `starter:${id}` })),
  ];
  const threads = process.env.THREADS ? Number(process.env.THREADS) : undefined;
  let differs = 0;
  for (const c of cases) {
    try {
      const r = await page.evaluate(RENDER, { c, runs: RUNS, threads });
      const same = r.maxDiffDb === null && r.sameWav && r.sameLength;
      if (!same) differs++;
      console.log(JSON.stringify({ case: c.label, same, ...r }));
    } catch (e) {
      differs++;
      console.log(JSON.stringify({ case: c.label, error: String(e.message || e).slice(0, 300) }));
    }
  }
  console.log(`${cases.length - differs} of ${cases.length} cases render the same every time`);
  await browser.close();
  process.exit(differs ? 1 : 0);
})();
