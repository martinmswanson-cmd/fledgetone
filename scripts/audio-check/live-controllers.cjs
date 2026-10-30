// Check, in live playback, that a plugin's controllers are what the song says wherever it plays
// from (src/audio/ccHold.ts): Fledge Synth's organ, whose mod wheel opens it up above 5 kHz, with
// the wheel turned up by a clip's CC 1 lane.
//
//   npx vite --port 5200                 (in another terminal)
//   node scripts/audio-check/live-controllers.cjs
//
// - Stop and play again: a song whose wheel goes up at bar 3, played to its end, stopped and played
//   from bar 1 again: bars 1-2 sound as they did the first time (the wheel back down at Stop).
// - A loop of bars 1-5 on the same song: going round, bars 1-2 sound as the first time.
// - Unmuted mid-clip: a song with the wheel up from bar 1, its track muted for the first 3 seconds:
//   once heard again it sounds as it does played through (its held value sent again).
// Each compares the level of the sound's slope (its highs) over a stretch, recorded from the live
// output. It exits with 1 when one is off by more than 1 dB. APP_URL overrides
// http://localhost:5200/. Needs Playwright with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';

const notes = (from, n) => [...Array(n)].flatMap((_, b) => ['C4', 'E4', 'G4'].map((x, i) => ({ id: `n${from}_${b}${i}`, note: x, startOffset: b, duration: '2n', velocity: 0.7 })));
const song = (clips) => ({
  format: 'fledgetone-project',
  version: 1,
  modWheel: 'dynamics',
  name: 'Organ wheel',
  bpm: 120,
  swing: 0,
  loopRegion: { inBar: 1, outBar: 9, enabled: false },
  tracks: [{ id: 't1', name: 'Organ', instrumentKey: 'plugin', volume: -12, pan: 0, reverbSend: 0, delaySend: 0, plugin: { id: 'p1', url: 'builtin:fledge/Fledge Synth', name: 'Fledge Synth', state: { builtin: 1, program: 23 } } }],
  clips,
});
const LATE = song([
  { id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: notes(1, 2) },
  { id: 'c2', trackId: 't1', name: 'B', startBar: 3, lengthBars: 2, notes: notes(3, 2), expression: { cc1: [{ at: 0, value: 1 }] } },
]);
const HELD = song([{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 8, notes: notes(1, 8), expression: { cc1: [{ at: 0, value: 1 }] } }]);

// In the page: play `steps` and return the highs' level (dB) over each stretch asked for
const RUN = async ({ text, loop, steps }) => {
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const engine = await (await fetch('/src/audio/engine.ts')).text();
  const T = await import(engine.match(/from "([^"]*\/deps\/tone\.js[^"]*)"/)[1]);
  const s = store.useTimelineStore;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const p = P.parseProject(JSON.parse(text));
  if (loop) p.loopRegion = { ...loop, enabled: true };
  s.getState().loadProject(p);
  await sleep(3000);
  await T.start();
  const rec = new T.Recorder();
  T.getDestination().connect(rec);
  const highs = (b, s0, s1) => {
    const a = b.getChannelData(0).subarray(Math.round(s0 * b.sampleRate), Math.round(s1 * b.sampleRate));
    let d = 0;
    for (let i = 1; i < a.length; i++) d += (a[i] - a[i - 1]) ** 2;
    return 10 * Math.log10(d / a.length + 1e-20);
  };
  const out = [];
  for (const step of steps) {
    s.getState().seek(1);
    if (step.mutedFor) s.getState().toggleMute('t1');
    await sleep(300);
    rec.start();
    await s.getState().togglePlay();
    if (step.mutedFor) {
      await sleep(step.mutedFor * 1000);
      s.getState().toggleMute('t1');
      await sleep((step.seconds - step.mutedFor) * 1000);
    } else await sleep(step.seconds * 1000);
    if (s.getState().isPlaying) await s.getState().togglePlay();
    await sleep(600);
    const b = await new AudioContext().decodeAudioData(await (await rec.stop()).arrayBuffer());
    out.push(step.at.map(([a, z]) => highs(b, a, z)));
  }
  return out;
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let failed = false;
  const check = (name, got, want) => {
    const ok = Math.abs(got - want) <= 1;
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${got.toFixed(1)} dB, as ${want.toFixed(1)} dB`);
  };
  const run = async (arg) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await page.goto(APP, { waitUntil: 'load', timeout: 120000 });
    await page.waitForTimeout(1500);
    const out = await page.evaluate(RUN, arg);
    await page.close();
    return out;
  };
  // Bars 1-2 are 0-4 s, bars 3-4 4-8 s (120 BPM)
  const [[down, up], [again]] = await run({ text: JSON.stringify(LATE), steps: [{ seconds: 9.6, at: [[0.5, 3.5], [4.5, 7.5]] }, { seconds: 4.6, at: [[0.5, 3.5]] }] });
  if (up - down < 1.5) {
    failed = true;
    console.log(`FAIL the wheel isn't heard (${up.toFixed(1)} dB with it, ${down.toFixed(1)} dB without)`);
  }
  check('played again after Stop, bars 1-2', again, down);
  const [[first, , round]] = await run({ text: JSON.stringify(LATE), loop: { inBar: 1, outBar: 5 }, steps: [{ seconds: 12.5, at: [[0.5, 3.5], [4.5, 7.5], [8.5, 11.5]] }] });
  check('a loop going round, bars 1-2', round, first);
  // (Muted first, in a fresh page: the plugin's wheel has never been up)
  const [[unmuted], [plain]] = await run({ text: JSON.stringify(HELD), steps: [{ seconds: 8, mutedFor: 3, at: [[4.2, 7.4]] }, { seconds: 8, at: [[4.2, 7.4]] }] });
  check('unmuted mid-clip', unmuted, plain);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
