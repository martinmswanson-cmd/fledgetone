// Check pitch bends in renders and live playback, case by case (each one a bug found before):
//
// - Two bent notes overlapping on an instrument that bends as a whole: when the first ends, the
//   one still sounding keeps its own bend (it was sent back to centre).
// - A bend curve longer than 30 seconds, sent whole when its note starts: a note starting early
//   in it starts at the bend in force then (the curve's start had been dropped).
// - Fledge Synth with a wide bend (more than 2 semitones) still to come: the bends before it play
//   as written, not twelve times too wide, nor ones sent before it too narrow after it.
// - A recorded piano under a clip's bend while a later note's own bend is sent ahead: every note
//   follows the clip's bend (the earlier ones had stopped following it).
// - A note longer than a seamless loop ends where the loop goes round, live and in the file: the
//   loop file is as loud as with a note that just fills the loop (copies piled up pass by pass).
// - The cost: a 16-bar note with a 256-point vibrato under 8th-note chords, played live, doesn't
//   hold the page up for more than a couple of seconds (it froze it for half a minute).
//
//   npx vite --port 5200                 (in another terminal)
//   node scripts/audio-check/bends.cjs
//
// Pitches are the strongest frequency in a band holding the right one and the wrong ones found
// before; each must be within 0.3% of the right one. It exits
// with 1 when one is off. APP_URL overrides http://localhost:5200/. Needs Playwright with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';
const FLEDGE = { id: 'p1', url: 'builtin:fledge/Fledge Synth', name: 'Fledge Synth', state: { builtin: 1 } };
const track = (key) => ({ id: 't1', name: key, instrumentKey: key, volume: -12, pan: 0, reverbSend: 0, delaySend: 0, ...(key === 'plugin' ? { plugin: FLEDGE } : {}) });
const song = (key, clips, loop) => ({ format: 'fledgetone-project', version: 1, name: 'Bends', bpm: 120, swing: 0, loopRegion: loop ?? { inBar: 1, outBar: 3, enabled: false }, tracks: [track(key)], clips });
const n = (id, note, startOffset, duration, velocity, bend) => ({ id, note, startOffset, duration, velocity, ...(bend ? { expr: { bend } } : {}) });
const hz = (name) => 440 * 2 ** ((({ C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 })[name[0]] + (name[1] === '#' ? 1 : 0) + 12 * (Number(name.at(-1)) - 4)) / 12);
const bent = (name, semis) => hz(name) * 2 ** (semis / 12);

const cases = [];
// Overlapping bent notes: C4 +2 for a beat, G4 -2 from half a beat for two; G4 alone after 0.5 s
for (const key of ['keys', 'synthDesigner', 'realViolin', 'wavetable', 'brass'])
  cases.push({ what: `${key}, two bent notes overlapping, the later one after the first ends`, song: song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 1, notes: [n('n1', 'C4', 0, '4n', 0.3, [{ at: 0, value: 2 }]), n('n2', 'G4', 0.125, '2n', 0.9, [{ at: 0, value: -2 }])] }]), at: [0.6, 1.1], want: bent('G4', -2), band: [320, 420] });
// A 24-bar slide (48 s) up 2 semitones under an E4 at bar 3: bent by 2/24 of a tone and a little more there
for (const key of ['keys', 'synthDesigner', 'wavetable'])
  cases.push({ what: `${key}, an E4 starting early in a 48-second bend`, song: song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 24, notes: [n('n1', 'A2', 0, '24m', 0.15, [{ at: 0, value: 0 }, { at: 24, value: 2 }]), n('n2', 'E4', 2, '1m', 1)] }]), toBar: 4, at: [4.3, 5.5], want: bent('E4', (2 * 4.9) / 48), band: [310, 350] });
// Fledge Synth: a G4 bent +1 for a beat over a C4 that dives an octave later; and a slow C4 slide with a G5 diving later
cases.push({ what: 'Fledge Synth, a bend before a wide dive to come', song: song('plugin', [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [n('n1', 'C4', 0, '1m', 0.3, [{ at: 0, value: 0 }, { at: 0.75, value: 0 }, { at: 1, value: -12 }]), n('n2', 'G4', 0.25, '4n', 0.9, [{ at: 0, value: 1 }])] }]), at: [0.6, 0.95], want: bent('G4', 1), band: [380, 430] });
const later = song('plugin', [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [n('n1', 'C4', 0, '2m', 0.9, [{ at: 0, value: 0 }, { at: 2, value: 1 }]), n('n2', 'G5', 1, '4n', 0.2, [{ at: 0, value: 0 }, { at: 0.2, value: 0 }, { at: 0.25, value: -12 }])] }]);
cases.push({ what: 'Fledge Synth, a slide after a wide dive was sent', song: later, at: [3.4, 3.8], want: bent('C4', 0.9), band: [262, 295] });
// A recorded piano: a clip bend up a semitone over bar 1's second half, and a G4 with its own short scoop
cases.push({ what: 'Grand piano, an earlier note under a clip bend', song: song('realGrandPiano', [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 4, expression: { bend: [{ at: 0, value: 0 }, { at: 0.5, value: 0 }, { at: 1, value: 1 }, { at: 4, value: 1 }] }, notes: [n('a', 'C4', 0, '2m', 0.9), n('b', 'G4', 0.25, '3m', 0.4, [{ at: 0, value: -1 }, { at: 0.05, value: 0 }])] }]), toBar: 5, at: [2.5, 3.5], want: bent('C4', 1), band: [250, 290] });

// In the page: render `text` (bars 1..toBar, `ending`) as Export does and return the strongest frequency in `band` over `at`, or the RMS (dB)
const RENDER = async ({ text, toBar, ending, at, band }) => {
  const P = await import('/src/store/project.ts');
  const X = await import('/src/audio/exportWav.ts');
  const T = await import('/src/store/timelineTypes.ts');
  const p = P.parseProject(JSON.parse(text));
  const opts = { tracks: p.tracks, clips: p.clips, bpm: p.bpm, tempoPoints: p.tempoPoints, swing: p.swing, startBar: 1, endBar: toBar, masterFx: p.masterFx ?? T.DEFAULT_MASTER_FX, ending, sampleRate: 44100, markers: [] };
  const audio = await X.renderArrangement(opts);
  const x = audio.getChannelData(0);
  if (!at) {
    let e = 0;
    for (const v of x) e += v * v;
    return 10 * Math.log10(e / x.length + 1e-20);
  }
  const sr = audio.sampleRate;
  const a = x.subarray(Math.round(at[0] * sr), Math.round(at[1] * sr));
  // Goertzel over the band (the right pitch and the wrong ones found before), a hann window, 0.05 Hz steps
  const w = a.map((v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (a.length - 1))));
  let best = 0;
  let bestF = 0;
  for (let f = band[0]; f <= band[1]; f += 0.05) {
    const k = (2 * Math.PI * f) / sr;
    const c = 2 * Math.cos(k);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < w.length; i++) {
      const s0 = w[i] + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const pow = s1 * s1 + s2 * s2 - c * s1 * s2;
    if (pow > best) {
      best = pow;
      bestF = f;
    }
  }
  return bestF;
};

// Play `text` live for `seconds` and return the longest main-thread task (ms)
const PLAY = async ({ text, seconds }) => {
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const engine = await (await fetch('/src/audio/engine.ts')).text();
  const T = await import(engine.match(/from "([^"]*\/deps\/tone\.js[^"]*)"/)[1]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = store.useTimelineStore;
  s.getState().loadProject(P.parseProject(JSON.parse(text)));
  await sleep(3000);
  await T.start();
  const tasks = [];
  const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => tasks.push(e.duration)));
  po.observe({ type: 'longtask' });
  s.getState().seek(1);
  await s.getState().togglePlay();
  await sleep(seconds * 1000);
  if (s.getState().isPlaying) s.getState().stop();
  await sleep(300);
  po.disconnect();
  return Math.max(0, ...tasks);
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let failed = 0;
  const page = async () => {
    const pg = await browser.newPage();
    pg.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await pg.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
    await pg.goto(APP, { waitUntil: 'load', timeout: 120000 });
    await pg.waitForTimeout(1500);
    return pg;
  };
  const report = (ok, line) => {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
  };
  for (const c of cases) {
    const pg = await page();
    const got = await pg.evaluate(RENDER, { text: JSON.stringify(c.song), toBar: c.toBar ?? 3, ending: 'ringOut', at: c.at, band: c.band });
    report(Math.abs(got / c.want - 1) < 0.003, `${c.what}: ${got.toFixed(1)} Hz, want ${c.want.toFixed(1)} Hz`);
    await pg.close();
  }
  // Seamless loop files of bars 1-3 with an A3 from beat 2 of bar 2 held 4 bars, or 100: as loud as each other
  const seam = (dur) => song('synthDesigner', [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [n('n1', 'C4', 0, '2n', 0.6), n('n2', 'E4', 1, '2n', 0.6), n('n3', 'A3', 1.5, dur, 0.6)] }], { inBar: 1, outBar: 3, enabled: true });
  const levels = [];
  for (const dur of ['4m', '100m']) {
    const pg = await page();
    levels.push(await pg.evaluate(RENDER, { text: JSON.stringify(seam(dur)), toBar: 3, ending: 'seamless' }));
    await pg.close();
  }
  report(Math.abs(levels[0] - levels[1]) < 0.5, `seamless loop, a note held 100 bars as loud as one held 4: ${levels[1].toFixed(1)} dB, ${levels[0].toFixed(1)} dB`);
  // The cost, live
  const L = 16;
  const vib = [...Array(256)].map((_, i) => ({ at: +((i * L) / 255).toFixed(6), value: i % 2 ? 0.3 : -0.3 }));
  const chords = [...Array(L * 8)].flatMap((_, k) => ['C4', 'E4', 'G4', 'B4'].map((x, j) => n(`c${k}_${j}`, x, k / 8, '8n', 0.5)));
  for (const key of ['keys', 'synthDesigner', 'realViolin']) {
    const pg = await page();
    const ms = await pg.evaluate(PLAY, { text: JSON.stringify(song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: L, notes: [n('n1', 'A2', 0, `${L}m`, 0.6, vib), ...chords] }])), seconds: 10 });
    report(ms < 2000, `${key}, a long vibrato under chords played live: longest hold-up ${Math.round(ms)} ms`);
    await pg.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
