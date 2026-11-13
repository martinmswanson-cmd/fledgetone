// Check the fixes found making a lofi song, in the app:
//
// - The Brush Kit's closed hat sits with the Session and Studio Kits' hats: at velocity 0.26 and 1, its level (each hit's first
//   100 ms) within 3 dB of theirs (it was 6 dB under at 0.26, 4 dB at 1); its kick, snare and open hat as they were.
// - A Glide Pad track starts with no reverb send (it has its own room), made new or switched to, and a switch away gives back
//   its kind of part's send; each switch is one undo step and Undo gives the track back exactly.
// - For the record: the track compressor (threshold -30 dB, ratio 4, no make-up) on each recorded kit's kick, its peak dry and
//   compressed (no pass or fail: see the report).
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/audio-check/lofi-fixes.cjs
//
// It exits with 1 when one is off. APP_URL overrides http://localhost:5200/. Needs Playwright with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';
const results = [];
const report = (ok, what) => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'OFF '} ${what}`);
};

// In the page: `kit`'s `row` played 8 times at `velocity` (track at -8 dB, `fx` its inserts): its peak and its level over each
// hit's first 100 ms (dB)
const HITS = async ({ kit, row, velocity, fx }) => {
  const P = await import('/src/store/project.ts');
  const E = await import('/src/audio/exportWav.ts');
  const T = await import('/src/store/timelineTypes.ts');
  const { loadSamples } = await import('/src/audio/samplers/samplerManager.ts');
  await loadSamples(kit);
  const notes = Array.from({ length: 8 }, (_, i) => ({ id: 'n' + i, note: row, startOffset: i / 4, duration: '16n', velocity }));
  const p = P.parseProject({ format: 'fledgetone-project', version: 1, name: 'k', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 3, enabled: false }, tracks: [{ id: 't', name: 'D', instrumentKey: kit, volume: -8, pan: 0, reverbSend: 0, delaySend: 0, fx: fx ?? {} }], clips: [{ id: 'c', trackId: 't', name: 'B', startBar: 1, lengthBars: 2, notes }] });
  const a = await E.renderArrangement({ tracks: p.tracks, clips: p.clips, bpm: 120, swing: 0, startBar: 1, endBar: 3, masterFx: T.DEFAULT_MASTER_FX, master: p.master, ending: 'cut', sampleRate: 44100, markers: [] });
  const ch = E.channelsOf(a);
  let pk = 0, e = 0, n = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) {
    pk = Math.max(pk, Math.abs(c[i]));
    if (i % 22050 < 4410) {
      e += c[i] * c[i];
      n++;
    }
  }
  return { peak: 20 * Math.log10(pk), level: 10 * Math.log10(e / n) };
};

// In the page: a Glide Pad track as the studio makes it and switches it, and Undo
const STORE = async () => {
  const S = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const s = S.useTimelineStore;
  s.getState().loadProject(P.parseProject({ format: 'fledgetone-project', version: 1, name: 'Sends', bpm: 90, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [], clips: [] }));
  const snap = () => JSON.stringify(P.serializeProject(S.currentProject()));
  const out = {};
  const id = s.getState().addTrack('glidePad');
  out.added = s.getState().tracks.find((t) => t.id === id).reverbSend;
  const wid = s.getState().addTrack('wavetable');
  out.wavetable = s.getState().tracks.find((t) => t.id === wid).reverbSend;
  let before = snap();
  s.getState().setTrackInstrument(wid, 'glidePad');
  out.switchedTo = s.getState().tracks.find((t) => t.id === wid).reverbSend;
  let after = snap();
  s.getState().undo();
  out.undoTo = snap() === before;
  s.getState().redo();
  out.redoTo = snap() === after;
  before = snap();
  s.getState().setTrackInstrument(wid, 'wavetable');
  out.switchedBack = s.getState().tracks.find((t) => t.id === wid).reverbSend;
  after = snap();
  s.getState().undo();
  out.undoBack = snap() === before;
  s.getState().redo();
  out.redoBack = snap() === after;
  return out;
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
  await page.goto(APP, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(3000);
  page.setDefaultTimeout(900000);

  // The Brush Kit's closed hat against the other recorded kits'
  for (const velocity of [0.26, 1]) {
    const lv = {};
    for (const kit of ['brushKit', 'sessionKit', 'studioKit']) lv[kit] = (await page.evaluate(HITS, { kit, row: 'F#1', velocity })).level;
    const lo = Math.min(lv.sessionKit, lv.studioKit) - 3;
    const hi = Math.max(lv.sessionKit, lv.studioKit) + 3;
    report(lv.brushKit >= lo && lv.brushKit <= hi, `Brush Kit closed hat at velocity ${velocity}: ${lv.brushKit.toFixed(1)} dB (Session Kit ${lv.sessionKit.toFixed(1)} dB, Studio Kit ${lv.studioKit.toFixed(1)} dB)`);
  }
  // Its other rows as they were (measured before the fix, same settings)
  const WAS = { 'C1@1': -25.6, 'D1@1': -29.4, 'D1@0.26': -55.2, 'A#1@0.26': -63.0 };
  for (const [k, was] of Object.entries(WAS)) {
    const [row, v] = k.split('@');
    const now = (await page.evaluate(HITS, { kit: 'brushKit', row, velocity: Number(v) })).level;
    report(Math.abs(now - was) < 0.15, `Brush Kit ${row} at velocity ${v} as it was: ${now.toFixed(1)} dB (was ${was} dB)`);
  }

  // The Glide Pad's reverb send, made new and switched, Undo exact
  const st = await page.evaluate(STORE);
  report(st.added === 0 && st.switchedTo === 0 && st.switchedBack === st.wavetable && st.wavetable > 0, `Glide Pad's reverb send: a new track ${st.added}, a Wavetable track (${st.wavetable}) switched to it ${st.switchedTo}, and back ${st.switchedBack}`);
  report(st.undoTo && st.redoTo && st.undoBack && st.redoBack, `each switch one undo step, Undo and Redo exact (to: ${st.undoTo}/${st.redoTo}, back: ${st.undoBack}/${st.redoBack})`);

  // For the record: the compressor on each kit's kick
  const COMP = { compressor: { on: true, threshold: -30, ratio: 4, makeup: 0 } };
  for (const kit of ['brushKit', 'sessionKit', 'studioKit']) {
    const dry = await page.evaluate(HITS, { kit, row: 'C1', velocity: 0.62 });
    const comp = await page.evaluate(HITS, { kit, row: 'C1', velocity: 0.62, fx: COMP });
    console.log(`info ${kit} kick at 0.62: dry peak ${dry.peak.toFixed(1)} dB, level ${dry.level.toFixed(1)} dB; through the compressor (threshold -30, ratio 4, make-up 0) peak ${comp.peak.toFixed(1)} dB, level ${comp.level.toFixed(1)} dB`);
  }

  await browser.close();
  const bad = results.filter((r) => !r).length;
  console.log(`${results.length - bad} of ${results.length} ok`);
  process.exit(bad ? 1 : 0);
})();
