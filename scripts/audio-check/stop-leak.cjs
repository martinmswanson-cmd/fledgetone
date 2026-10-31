// Check, in live playback, that Stop and Pause let nothing new sound: notes due just after the
// press were handed to the instrument already (inside the Transport's look-ahead), and each
// instrument must call those off; a Pause's must then play once, and only once, on Play.
//
//   npx vite --port 5200                 (in another terminal)
//   node scripts/audio-check/stop-leak.cjs [instrument,instrument...]
//
// 1. A clip of eighth notes, each two bars long, on the Synth Designer: Stop (then Pause) pressed a
//    little before a note is due, at several distances inside the look-ahead, with the usual and the
//    Stable look-ahead. The notes already sounding fade: the level 0.5-2 s after the press must be
//    below -120 dBFS, and no note may be handed out after the press.
// 2. One note (on a kit, a hit on every row) at bar 2 of a silent song, on each instrument family:
//    synthesized kits, keys and pads from a pool of voices, mono synths, recorded instruments, the
//    retro soundfont ones, the Slicer. Stop and Pause are pressed a little before it, once it was
//    handed out: nothing may sound after the press (-90 dBFS). After a Pause, Play must hand the
//    note out once and it must sound about as loud as when played through (within 4.5 dB, the
//    RMS level over 0.7 s around it: the Space Clav's chorus alone moves it by up to 4 dB from one
//    play to the next; twice at once would be 6 dB louder, none silent. Either way the note handed
//    out before the press would have been heard during the pause). Some again with the Stable look-ahead.
// It exits with 1 when any check fails. APP_URL overrides http://localhost:5200/. Needs Playwright
// with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';

// ---------- 1. eighth notes on the Synth Designer ----------

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

// ---------- 2. one note at bar 2, on each instrument family ----------

/** Instruments checked, and (`stable`) the ones checked again with the Stable look-ahead. */
const FAMILIES = [
  'drums', 'drumMachine', 'chipDrums', 'studioKit', // synthesized and recorded kits
  'keys', 'brass', 'wavetable', // a pool of voices (keys: Space Clav)
  'bass', 'subBass', 'lead', 'bass808', // mono synths (bass: Slap Bass)
  'synthDesigner', 'chipLead', 'supersaw',
  'realCello', 'realGrandPiano', 'piano', // recorded
  'rhodes', 'electricGuitar', 'warmPad', // retro soundfonts
  'slicer',
];
const STABLE = ['drums', 'keys', 'bass', 'realCello', 'slicer'];
const KITS = new Set(['drums', 'drumMachine', 'chipDrums', 'studioKit']);
const LOW = new Set(['bass', 'subBass', 'bass808', 'realCello']);

const oneNote = (key) => {
  const track = { id: 't1', name: key, instrumentKey: key, volume: -6, pan: 0, reverbSend: 0, delaySend: 0 };
  let clipNotes = KITS.has(key)
    ? ['C1', 'D1', 'F#1', 'A#1', 'D#2'].map((note, i) => ({ id: `n${i}`, note, startOffset: 1, duration: '4n', velocity: 0.9 }))
    : [{ id: 'a', note: LOW.has(key) ? 'C2' : 'C4', startOffset: 1, duration: '2m', velocity: 0.9 }];
  if (key === 'slicer') {
    track.slicer = { soundId: 'stop-leak-sound', name: 'Tone', start: 0, end: 4, slices: [0, 1, 2, 3], mode: 'equal', count: 4, sensitivity: 0.5, pitch: false, focus: 0 };
    clipNotes = [{ id: 'a', note: 'C3', startOffset: 1, duration: '2m', velocity: 0.9 }];
  }
  return { format: 'fledgetone-project', version: 1, name: 'Stop', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [track], clips: [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 4, notes: clipNotes }] };
};

const RUN_ONE = async ({ text, cases }) => {
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const LT = await import('/src/audio/liveTracks.ts');
  const LC = await import('/src/audio/liveContext.ts');
  const TR = await import('/src/audio/transport.ts');
  const SL = await import('/src/audio/soundLibrary.ts');
  const NN = await import('/src/audio/nativeNodes.ts');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raw = NN.nativeContextOf(LC.liveContext);
  const sr = raw.sampleRate;
  // 4 s of a steady tone, for the Slicer
  const tone = new AudioBuffer({ numberOfChannels: 1, length: 4 * sr, sampleRate: sr });
  const d = tone.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr) + 0.2 * Math.sin((2 * Math.PI * 660 * i) / sr);
  SL.provideMemorySound('stop-leak-sound', tone);
  const s = store.useTimelineStore;
  s.getState().loadProject(P.parseProject(JSON.parse(text)));
  await LC.liveContext.resume?.();
  await sleep(1500);
  const loading = LT.scheduledInstrument('t1');
  if (loading) await Promise.race([loading.ready, sleep(30000)]);
  await sleep(2500);
  // Every note handed to the instrument: its time, and when
  const calls = [];
  const inst = LT.scheduledInstrument('t1');
  for (const k of ['play', 'noteOn', 'noteVoice']) {
    if (!inst || typeof inst[k] !== 'function') continue;
    const f = inst[k].bind(inst);
    inst[k] = (...a) => {
      calls.push({ at: a[1], made: raw.currentTime });
      return f(...a);
    };
  }
  // The live output's level, each block placed on the audio clock
  const blocks = [];
  const tap = raw.createScriptProcessor(1024, 2, 2);
  tap.onaudioprocess = (ev) => {
    const l = ev.inputBuffer.getChannelData(0);
    const r = ev.inputBuffer.getChannelData(1);
    const m = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) m[i] = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    blocks.push({ t: ev.playbackTime - 1024 / sr, m });
  };
  NN.nativeOutputOf(LC.liveDestination).connect(tap);
  tap.connect(raw.destination);
  const peakDb = (from, to) => {
    let p = 0;
    for (const b of blocks) for (let i = 0; i < b.m.length; i++) {
      const t = b.t + i / sr;
      if (t >= from && t < to && b.m[i] > p) p = b.m[i];
    }
    return +(20 * Math.log10(p + 1e-12)).toFixed(1);
  };
  // (Steadier than the peak, which a kit's noise or a chorus moves by a few dB from one play to the next)
  const rmsDb = (from, to) => {
    let e = 0;
    let n = 0;
    for (const b of blocks) for (let i = 0; i < b.m.length; i++) {
      const t = b.t + i / sr;
      if (t >= from && t < to) { e += b.m[i] * b.m[i]; n++; }
    }
    return +(10 * Math.log10(e / Math.max(1, n) + 1e-20)).toFixed(1);
  };
  const out = [];
  for (const { how, before } of cases) {
    s.getState().seek(1);
    await sleep(400);
    // (The last run's tail rung out first: a pad's release can be long)
    for (let waited = 0; waited < 8000 && peakDb(raw.currentTime - 0.3, raw.currentTime) > -110; waited += 200) await sleep(200);
    blocks.length = 0;
    calls.length = 0;
    await s.getState().togglePlay();
    const due = (TR.transportStartsAt() ?? raw.currentTime) + 2;
    if (how === 'through') {
      while (raw.currentTime < due + 0.8) await sleep(5);
      s.getState().stop();
      await sleep(400);
      out.push({ how, db: rmsDb(due - 0.1, due + 0.6) });
      continue;
    }
    while (raw.currentTime < due - before) await sleep(1);
    const pressed = raw.currentTime;
    if (how === 'pause') s.getState().pause();
    else s.getState().stop();
    const handedOut = calls.some((c) => c.made < pressed && c.at > pressed);
    await sleep(1500);
    const r = { how, before, handedOut, after: peakDb(pressed + 0.003, pressed + 1.4), ahead: peakDb(pressed - 0.5, pressed) };
    if (how === 'pause') {
      const n0 = calls.length;
      await s.getState().togglePlay();
      const resumed = TR.transportStartsAt() ?? raw.currentTime;
      await sleep(1200);
      s.getState().stop();
      await sleep(300);
      r.again = calls.length - n0;
      // (the note comes `before` after the Transport starts again)
      r.againDb = rmsDb(resumed + before - 0.1, resumed + before + 0.6);
    }
    out.push(r);
  }
  return { lookAhead: LC.liveContext.lookAhead, out };
};

(async () => {
  const only = process.argv[2] ? process.argv[2].split(',') : null;
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const page = async (stable) => {
    const pg = await browser.newPage();
    pg.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await pg.addInitScript((st) => {
      localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
      if (st) localStorage.setItem('bosBeatbox.playbackMode', 'stable');
    }, stable);
    await pg.goto(APP, { waitUntil: 'load', timeout: 120000 });
    await pg.waitForTimeout(1000);
    return pg;
  };
  let bad = 0;
  if (!only) {
    for (const stable of [false, true]) {
      for (const how of ['stop', 'pause']) {
        for (const before of stable ? [0.07, 0.15, 0.22] : [0.03, 0.065, 0.09]) {
          const pg = await page(stable);
          const r = await pg.evaluate(RUN, { text: JSON.stringify(SONG), before, how });
          const ok = r.late === 0 && r.after <= -120;
          if (!ok) bad++;
          console.log(`${ok ? 'ok  ' : 'FAIL'} eighths ${how} ${before}s before a note (look-ahead ${r.lookAhead}s): ${r.late} note(s) after the press, ${r.after} dBFS 0.5-2 s after`);
          await pg.close();
        }
      }
    }
  }
  const runs = [...(only ?? FAMILIES).map((key) => [key, false]), ...(only ?? STABLE).filter((k) => STABLE.includes(k)).map((key) => [key, true])];
  for (const [key, stable] of runs) {
    const pg = await page(stable);
    const befores = stable ? [0.08, 0.2] : [0.03, 0.07];
    const cases = [{ how: 'through' }, ...befores.map((before) => ({ how: 'stop', before })), ...befores.map((before) => ({ how: 'pause', before }))];
    try {
      const r = await pg.evaluate(RUN_ONE, { text: JSON.stringify(oneNote(key)), cases });
      const through = r.out[0].db;
      for (const c of r.out.slice(1)) {
        const fails = [];
        if (c.after > -90) fails.push(`${c.after} dBFS after the press (${c.ahead} dBFS in the half second before it)`);
        if (c.how === 'pause' && c.again !== 1) fails.push(`handed out ${c.again} time(s) on Play`);
        if (c.how === 'pause' && Math.abs(c.againDb - through) > 4.5) fails.push(`${c.againDb} dBFS on Play, ${through} played through`);
        if (through < -70) fails.push(`silent played through (${through} dBFS)`);
        if (fails.length) bad++;
        const note = c.handedOut ? 'handed out before the press' : 'not yet handed out';
        console.log(`${fails.length ? 'FAIL' : 'ok  '} ${key} ${c.how} ${c.before}s before it (look-ahead ${r.lookAhead}s, ${note}): ${fails.length ? fails.join(', ') : `${c.after} dBFS after${c.how === 'pause' ? `, once on Play at ${c.againDb} dBFS (${through} played through)` : ''}`}`);
      }
    } catch (e) {
      bad++;
      console.log(`FAIL ${key}: ${e.message.slice(0, 200)}`);
    }
    await pg.close();
  }
  await browser.close();
  console.log(bad ? `${bad} failed` : 'all ok');
  process.exit(bad ? 1 : 0);
})();
