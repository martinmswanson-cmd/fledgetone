// Check the master's Headroom (MasterSettings.headroom: the mix turned down where it enters the
// master section, ahead of the compressor), in exports and live.
//
//   npx vite --port 5200                 (in another terminal)
//   node scripts/audio-check/headroom.cjs
//
// A plain five-track song (drums, bass, chords, a pattern and a lead at the faders' default, 4 bars
// at 128 BPM), once on built-in synths and once on recorded instruments:
// 1. It reaches the master over full scale, which is what the Headroom is for (the peak with the
//    master bypassed is printed; over 0 dBFS or the check says so).
// 2. With 6 dB of Headroom the export is the one made with every fader 6 dB down and no Headroom
//    (no sample further apart than -60 dBFS), rendered in one piece and in parts (with the lush
//    reverb, which sends every render the parts' way: the parts' sum is fed to the master where
//    the mix bus would feed it).
// 3. The master then leaves more of the peaks: the export's peak over its average level is at
//    least 2 dB more than without Headroom.
// 4. Songs: the one the app opens with and a blank new one have 6 dB; a starter has none (it keeps
//    the levels it was mixed at); a file saved without it opens without it, and with it, with it.
// 5. Live, with a starter playing: the gain ahead of the compressor follows the slider (none, 12,
//    3, none again), and Undo takes the last recorded change back.
// It exits with 1 when any of these fails. APP_URL overrides http://localhost:5200/. Needs
// Playwright with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';
const SETS = {
  synths: ['drums', 'reeseBass', 'supersaw', 'pluck', 'lead'],
  recorded: ['studioKit', 'realElectricBass', 'realGrandPiano', 'realNylonGuitar', 'realViolins'],
};

// In the page: the song on `set`, rendered each way; what's measured of each
const RENDER = async (set) => {
  const ex = await import('/src/audio/exportWav.ts');
  const { DEFAULT_MASTER_FX, defaultMasterSettings } = await import('/src/store/timelineTypes.ts');
  const { DRUM_NOTES } = await import('/src/store/drumNotes.ts');
  const { makeTrack } = await import('/src/store/trackFactory.ts');
  const bpm = 128, bars = 4;
  let nid = 0;
  const song = (faderDb) => {
    const tracks = [], clips = [];
    const add = (id, key, notes) => {
      const t = makeTrack(key, []);
      tracks.push({ ...t, id, volume: t.volume + faderDb });
      clips.push({ id: 'c' + id, trackId: id, name: id, startBar: 1, lengthBars: bars, isSelected: false, notes: notes.map((n) => ({ id: 'n' + nid++, ...n })) });
    };
    const drums = [];
    for (let s = 0; s < bars * 16; s++) {
      if (s % 4 === 0) drums.push({ note: DRUM_NOTES.kick, startOffset: s / 16, duration: '16n', velocity: 1 });
      if (s % 8 === 4) drums.push({ note: DRUM_NOTES.snare, startOffset: s / 16, duration: '16n', velocity: 0.9 });
      if (s % 2 === 0) drums.push({ note: DRUM_NOTES.hihat ?? DRUM_NOTES.closedHat ?? 'F#1', startOffset: s / 16, duration: '16n', velocity: 0.6 });
    }
    const chords = [['A3', 'C4', 'E4', 'G4'], ['F3', 'A3', 'C4', 'E4'], ['C4', 'E4', 'G4', 'B4'], ['G3', 'B3', 'D4', 'F4']];
    const roots = ['A1', 'F1', 'C2', 'G1'];
    const up = (n) => n.replace(/\d/, (o) => +o + 1);
    const [d, b, c, k, l] = set;
    add('d', d, drums);
    add('b', b, roots.flatMap((n, bar) => [0, 1, 2, 3].map((q) => ({ note: n, startOffset: bar + q / 4, duration: '8n', velocity: 0.9 }))));
    add('c', c, chords.flatMap((ch, bar) => ch.map((n) => ({ note: n, startOffset: bar, duration: '1m', velocity: 0.8 }))));
    add('k', k, chords.flatMap((ch, bar) => Array.from({ length: 16 }, (_, s) => ({ note: up(ch[s % 4]), startOffset: bar + s / 16, duration: '16n', velocity: 0.7 }))));
    add('l', l, chords.flatMap((ch, bar) => [0, 2].map((q) => ({ note: up(ch[q]), startOffset: bar + q / 4, duration: '2n', velocity: 0.85 }))));
    return { tracks, clips };
  };
  const render = async ({ faderDb = 0, headroom = 0, lush = false, bypass = false }) => {
    const a = await ex.renderArrangement({
      ...song(faderDb), bpm, swing: 0, startBar: 1, endBar: bars + 1, ending: 'exact', sampleRate: 44100,
      masterFx: lush ? { ...DEFAULT_MASTER_FX, roomStyle: 'lush' } : DEFAULT_MASTER_FX,
      master: { ...defaultMasterSettings(), ...(headroom ? { headroom } : {}) },
      // (Bypassed: never turned down to its peak, so the level reaching the master can be read)
      ...(bypass ? { bypassMaster: true, peakCeilingDbtp: 60 } : {}),
    });
    return [a.getChannelData(0), a.getChannelData(a.numberOfChannels > 1 ? 1 : 0)];
  };
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
  const peak = (x) => { let m = 0; for (const c of x) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i])); return db(m); };
  const crest = (x) => { let s = 0, n = 0; for (const c of x) { for (let i = 0; i < c.length; i++) s += c[i] * c[i]; n += c.length; } return peak(x) - 10 * Math.log10(s / n); };
  const apart = (x, y) => { let m = 0; for (let c = 0; c < 2; c++) for (let i = 0; i < Math.min(x[c].length, y[c].length); i++) m = Math.max(m, Math.abs(x[c][i] - y[c][i])); return x[0].length === y[0].length ? db(m) : Infinity; };
  const reaches = peak(await render({ bypass: true }));
  const now = await render({});
  const room = await render({ headroom: 6 });
  const faders = await render({ faderDb: -6 });
  const onePiece = apart(room, faders);
  const crests = [crest(now), crest(room)];
  const inParts = apart(await render({ headroom: 6, lush: true }), await render({ faderDb: -6, lush: true }));
  return { reaches, onePiece, inParts, crests };
};

// In the page: which songs have it, and the live gain following the slider
const LIVE = async () => {
  const store = await import('/src/store/timelineStore.ts');
  const E = await import('/src/audio/engine.ts');
  const P = await import('/src/store/project.ts');
  const s = store.useTimelineStore;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const has = () => s.getState().master.headroom ?? 0;
  const out = { opening: has() };
  s.getState().newProject('blank');
  out.blank = has();
  const file = JSON.parse(JSON.stringify(P.serializeProject(store.currentProject())));
  const older = JSON.parse(JSON.stringify(file));
  delete older.master.headroom;
  s.getState().loadProject(P.parseProject(older));
  out.olderFile = has();
  s.getState().loadProject(P.parseProject(file));
  out.savedFile = has();
  s.getState().newProject('lofi');
  out.starter = has();
  // (A gain's value is only kept up while sound runs through it: a starter, playing)
  await sleep(4000);
  await s.getState().togglePlay();
  await sleep(2500);
  const gain = async () => { await sleep(500); return E.liveMix.masterIn.gain.value; };
  out.gains = [await gain()];
  s.getState().setMasterHeadroom(12, true);
  out.gains.push(await gain());
  s.getState().setMasterHeadroom(3, true);
  out.gains.push(await gain());
  s.getState().setMasterHeadroom(0, true);
  out.gains.push(await gain());
  s.getState().undo();
  out.gains.push(await gain());
  out.undone = has();
  await s.getState().togglePlay();
  return out;
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let failed = false;
  const say = (ok, text) => {
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`);
  };
  const open = async () => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
    // The files of the recorded instruments, where the network reaches their mirrors only
    for (const [re, base] of [[/tonejs\.github\.io\/audio\/(.+)$/, 'https://raw.githubusercontent.com/Tonejs/audio/master/'], [/gleitz\.github\.io\/midi-js-soundfonts\/(.+)$/, 'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/']]) {
      await page.route(re, async (r) => {
        try {
          const response = await r.fetch({ url: base + r.request().url().match(re)[1] });
          return r.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
        } catch { return r.abort(); }
      });
    }
    await page.goto(APP, { waitUntil: 'load', timeout: 120000 });
    await page.waitForTimeout(1000);
    return page;
  };
  const f = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
  try {
    for (const [name, set] of Object.entries(SETS)) {
      const page = await open();
      const r = await page.evaluate(RENDER, set);
      await page.close();
      say(r.reaches > 0, `${name}: reaches the master at ${f(r.reaches)} dBFS (over full scale: what the Headroom is for)`);
      say(r.onePiece < -60, `${name}: 6 dB of Headroom is the faders 6 dB down: furthest apart ${f(r.onePiece)} dBFS`);
      say(r.inParts < -60, `${name}: the same rendered in parts: furthest apart ${f(r.inParts)} dBFS`);
      say(r.crests[1] - r.crests[0] >= 2, `${name}: peaks over the average level ${f(r.crests[0])} dB without, ${f(r.crests[1])} dB with (${f(r.crests[1] - r.crests[0])} dB more left of the peaks)`);
    }
    const page = await open();
    const r = await page.evaluate(LIVE);
    await page.close();
    say(r.opening === 6 && r.blank === 6, `the song the app opens with has ${r.opening} dB, a blank new one ${r.blank} dB`);
    say(r.starter === 0, `a starter has ${r.starter || 'none'}`);
    say(r.olderFile === 0 && r.savedFile === 6, `a file saved without it opens with ${r.olderFile || 'none'}, one saved with 6 dB opens with ${r.savedFile} dB`);
    const want = [1, 10 ** (-12 / 20), 10 ** (-3 / 20), 1, 10 ** (-3 / 20)];
    say(r.gains.every((g, i) => Math.abs(g - want[i]) < 1e-3) && r.undone === 3, `live, the gain ahead of the compressor: ${r.gains.map((g) => g.toFixed(4)).join(', ')} (a starter, then 12 dB, 3 dB, none, and Undo back to 3 dB)`);
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
