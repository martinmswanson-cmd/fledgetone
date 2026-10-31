// Check, in live playback, that Stop and Pause let nothing new sound: notes due just after the
// press (inside the Transport's look-ahead) must not be handed to the instrument after it, where
// they would ring their whole length once every voice was let go.
//
//   npx vite --port 5200                 (in another terminal)
//   node scripts/audio-check/stop-leak.cjs
//
// A clip of eighth notes, each two bars long, on a built-in synth. Stop (then Pause) is pressed a
// little before a note is due, at several distances inside the look-ahead, with the usual and the
// Stable look-ahead. Each run counts the notes the instrument is given after the press and the level
// 0.5-2 s after it. It exits with 1 when any note comes after the press or that level is above
// -120 dBFS. APP_URL overrides http://localhost:5200/. Needs Playwright with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';

const notes = [...Array(16)].map((_, i) => ({ id: `n${i}`, note: 'C4', startOffset: i / 8, duration: '2m', velocity: 0.8 }));
const SONG = { format: 'fledgetone-project', version: 1, name: 'Stop', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [{ id: 't1', name: 'Synth', instrumentKey: 'synthDesigner', volume: -12, pan: 0, reverbSend: 0, delaySend: 0 }], clips: [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 4, notes }] };

const RUN = async ({ text, before, how }) => {
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const engine = await (await fetch('/src/audio/engine.ts')).text();
  const T = await import(engine.match(/from "([^"]*\/deps\/tone\.js[^"]*)"/)[1]);
  const LT = await import('/src/audio/liveTracks.ts');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = store.useTimelineStore;
  s.getState().loadProject(P.parseProject(JSON.parse(text)));
  await sleep(5000);
  await T.start();
  const raw = T.getContext().rawContext;
  const inst = LT.scheduledInstrument('t1');
  let first = null;
  let pressed = Infinity;
  let late = 0;
  for (const k of ['play', 'noteOn', 'attack', 'trigger']) {
    if (!inst || typeof inst[k] !== 'function') continue;
    const f = inst[k].bind(inst);
    inst[k] = (...a) => {
      const at = typeof a[1] === 'number' ? a[1] : a[2];
      if (first === null) first = at;
      if (raw.currentTime >= pressed - 0.001) late++;
      return f(...a);
    };
  }
  const rec = new T.Recorder();
  T.getDestination().connect(rec);
  s.getState().seek(1);
  await sleep(300);
  rec.start();
  await sleep(50);
  const r0 = raw.currentTime;
  await s.getState().togglePlay();
  while (first === null) await sleep(1);
  // A note a few eighths in, pressed `before` seconds ahead of it
  const due = first + 4 * 0.25;
  while (raw.currentTime < due - before) await sleep(1);
  pressed = raw.currentTime;
  if (how === 'pause') s.getState().pause();
  else s.getState().stop();
  await sleep(2600);
  const b = await new AudioContext().decodeAudioData(await (await rec.stop()).arrayBuffer());
  const x = b.getChannelData(0);
  const sr = b.sampleRate;
  const base = pressed - r0;
  let e = 0;
  let n = 0;
  for (let i = Math.round((base + 0.5) * sr); i < Math.min(x.length, Math.round((base + 2) * sr)); i++) { e += x[i] * x[i]; n++; }
  return { lookAhead: T.getContext().lookAhead, late, after: +(10 * Math.log10(e / Math.max(1, n) + 1e-20)).toFixed(1) };
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let bad = 0;
  for (const stable of [false, true]) {
    for (const how of ['stop', 'pause']) {
      for (const before of stable ? [0.07, 0.15, 0.22] : [0.03, 0.065, 0.09]) {
        const pg = await browser.newPage();
        pg.on('pageerror', (e) => console.error('[pageerror]', e.message));
        await pg.addInitScript((st) => {
          localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
          if (st) localStorage.setItem('bosBeatbox.playbackMode', 'stable');
        }, stable);
        await pg.goto(APP, { waitUntil: 'load', timeout: 120000 });
        await pg.waitForTimeout(1000);
        const r = await pg.evaluate(RUN, { text: JSON.stringify(SONG), before, how });
        const ok = r.late === 0 && r.after <= -120;
        if (!ok) bad++;
        console.log(`${ok ? 'ok  ' : 'FAIL'} ${how} ${before}s before a note (look-ahead ${r.lookAhead}s): ${r.late} note(s) after the press, ${r.after} dBFS 0.5-2 s after`);
        await pg.close();
      }
    }
  }
  await browser.close();
  console.log(bad ? `${bad} failed` : 'all ok');
  process.exit(bad ? 1 : 0);
})();
