// Hits played by hand against the export of the same hits, for the built-in Tone synths that start
// their oscillators ahead of a note (src/audio/presets/toneStart.ts): the Groove Drum Kit's closed
// and open hats (six FM pairs each), its kick and its snare's snap (the noise muted, live and in the
// file), the Drum Machine's kick, and the Space Clav (its FM voices measured dry: its chorus moves
// with the clock, so it isn't the same live and in a file). Each case is played by hand (the MIDI
// input's path, as a pad or key is) at a steady rate with up to 12 ms of jitter, and the page is
// held up once a hit if asked: just before the oscillator start after K have started early (K from
// 0 up), or just before the hit's attack is set ("env"), until the audio clock has moved on three
// render blocks. A hit held up starts later, but it must still sound as it does in the export: a
// hat's pairs started for the first time and the rest for the moved time came out of step (up to
// 2.5 dB louder or 4.5 dB quieter, about one in four hats played by hand, most with the processor
// slowed four times), and a kick's first moment changed shape.
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/audio-check/hand-hits.cjs
//   CASES=hat,kick HOLDS=none,0,3,env THROTTLE=4 N=40 node scripts/audio-check/hand-hits.cjs
//
// CASES: hat, ohat, kick, snap, dmkick, fm (default all). HOLDS: none, a number of oscillators
// started first, env (default none,0,3,5,env; a number past a synth's oscillators is skipped).
// N: hits a case (default 24; half that for the snap, whose hits are far apart). THROTTLE slows
// the page's processor that many times. Every hit's peak and RMS over its first 50 ms must be
// within 0.3 dB of the export's same hit, and its wave close to it: the largest difference over
// its first 60 ms (at the best of a few whole-frame shifts) at least 20 dB under the export hit's
// peak. A hit the audio device was late around (a block of its sound not where the clock said) is
// counted apart and not judged. It exits with 1 when a hit is off. APP_URL overrides
// http://localhost:5200/. Needs Playwright with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';
const CASES = {
  hat: { inst: 'drums', cls: 'MetalSynth', sources: 6, midi: 42, row: 'F#1', every: 2, dur: '32n' },
  ohat: { inst: 'drums', cls: 'MetalSynth', sources: 6, midi: 46, row: 'A#1', every: 8, dur: '8n' },
  kick: { inst: 'drums', cls: 'MembraneSynth', sources: 1, midi: 36, row: 'C1', every: 8, dur: '8n' },
  snap: { inst: 'drums', cls: 'MembraneSynth', sources: 1, midi: 26, row: 'D1', every: 16, dur: '16n', muteNoise: true, fewer: true },
  dmkick: { inst: 'drumMachine', cls: 'MembraneSynth', sources: 1, midi: 36, row: 'C1', every: 8, dur: '8n' },
  fm: { inst: 'keys', cls: 'FMSynth', sources: 2, midi: 60, row: 'C4', every: 8, dur: '32n', dry: true },
};
const BPM = 100;

/** In the page: the hits played by hand, then the same in the export; each hit's level and wave against the export's. */
const PAGE = async (cfg) => {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const yieldNow = () => new Promise((r) => { const mc = new MessageChannel(); mc.port1.onmessage = () => r(); mc.port2.postMessage(0); });
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const LT = await import('/src/audio/liveTracks.ts');
  const LC = await import('/src/audio/liveContext.ts');
  const LI = await import('/src/audio/liveInput.ts');
  const NN = await import('/src/audio/nativeNodes.ts');
  const EX = await import('/src/audio/exportWav.ts');
  const LS = await import('/src/audio/listen.ts');
  const SN = await import('/src/agent/listenSnapshot.ts');
  // (Tone as the app has it: the same module, its fixes applied)
  const fixes = await (await fetch('/src/audio/toneFixes.ts')).text();
  const Tone = await import(fixes.match(/from\s*"([^"]*tone\.js[^"]*)"/)[1]);
  const s = store.useTimelineStore;
  const raw = NN.nativeContextOf(LC.liveContext);
  const sr = raw.sampleRate;
  const fr = (t) => Math.round(t * sr);
  const KP = Tone[cfg.cls].prototype;

  // The synth alone: the snare's noise muted; the FM voices dry, live and in the file
  if (cfg.muteNoise) Tone.NoiseSynth.prototype.triggerAttackRelease = function () { return this; };
  const capture = new Map();
  const captureFor = (ctx) => {
    let g = capture.get(ctx);
    if (!g) {
      g = new Tone.Gain({ context: ctx });
      if (ctx.isOffline) Tone.connect(g, ctx.rawContext.destination);
      capture.set(ctx, g);
    }
    return g;
  };
  if (cfg.dry) KP.connect = function () { return Tone.ToneAudioNode.prototype.connect.call(this, captureFor(this.context)); };

  // Each live note of the synth: the hit it's for, and where its envelope went (the last strike of a hit is the one heard)
  const live = new Map();
  let hand = -1;
  const triggerAttack = KP.triggerAttack;
  KP.triggerAttack = function (...a) {
    if (this.context.isOffline) return triggerAttack.apply(this, a);
    // (Where its envelope went is read once the hit is struck: its attack is set as its strike's last step)
    const h = { asked: this.toSeconds(a[1]), env: this.envelope };
    live.set(hand, h);
    return triggerAttack.apply(this, a);
  };

  // The hold-up: the page busy until the clock has moved on three blocks past the press
  let count = 0;
  let held = true;
  let press = 0;
  const holdUp = () => {
    held = true;
    const p0 = performance.now();
    while (raw.currentTime < press + 384 / sr - 1e-9 && performance.now() - p0 < 60) {}
  };
  if (cfg.hold !== 'none') {
    for (const C of [Tone.FMOscillator, Tone.OmniOscillator]) {
      const start = C.prototype.start;
      C.prototype.start = function (...a) {
        if (!this.context.isOffline && !held && cfg.hold !== 'env' && ++count === cfg.hold + 1) holdUp();
        return start.apply(this, a);
      };
    }
    const attack = Tone.Envelope.prototype.triggerAttack;
    Tone.Envelope.prototype.triggerAttack = function (...a) {
      if (!this.context.isOffline && !held && cfg.hold === 'env') holdUp();
      return attack.apply(this, a);
    };
  }

  const step = 60 / cfg.bpm / 4;
  const steps = Array.from({ length: cfg.n }, (_, i) => 4 + cfg.every * i);
  const bars = Math.ceil((steps[steps.length - 1] + 1) / 16) + 2;
  const clip = { id: 'c1', trackId: 't1', name: 'Hits', startBar: 1, lengthBars: bars, isSelected: false, notes: steps.map((st, i) => ({ id: `n${i}`, note: cfg.row, startOffset: st / 16, duration: cfg.dur, velocity: 0.8 })) };
  s.getState().loadProject(P.parseProject({ format: 'fledgetone-project', version: 1, name: 'Hits', bpm: cfg.bpm, swing: 0, tracks: [{ id: 't1', name: 'Part', instrumentKey: cfg.inst, volume: -6, pan: 0, reverbSend: 0, delaySend: 0, expressive: false }], clips: [] }));
  await (await import('/src/audio/engine.ts')).initAudio();
  for (let w = 0; w < 50 && raw.state !== 'running'; w++) await sleep(100);
  await sleep(800);
  let inst = LT.getLiveInstrument('t1');
  for (let w = 0; w < 50 && !inst; w++) { await sleep(100); inst = LT.getLiveInstrument('t1'); }
  if (inst?.ready) await inst.ready;
  s.getState().selectTrack('t1');

  // The tap: every block it's given, in order, and the frame each was said to be (a frame said
  // again while the device is late is the block after the last), so a context frame is found in it
  const cap = Math.ceil((steps[steps.length - 1] * step + 5) * sr);
  const TAP = `registerProcessor('hand-hits-tap', class extends AudioWorkletProcessor {
    constructor(o) { super(); this.cap = o.processorOptions.cap; this.L = new Float32Array(this.cap); this.R = new Float32Array(this.cap); this.cf = new Float64Array(Math.ceil(this.cap / 128) + 1); this.n = 0; this.last = -1; this.odd = [];
      const idx = (F) => { let lo = 0, hi = this.n - 1; if (hi < 0 || F < this.cf[0]) return -1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.cf[mid] <= F) lo = mid; else hi = mid - 1; } return lo * 128 + Math.min(127, F - this.cf[lo]); };
      this.port.onmessage = ({ data }) => this.port.postMessage({ odd: this.odd, seg: data.at.map((a) => { const o = new Float32Array(2 * data.n); const i0 = idx(a); if (i0 >= 0) for (let j = 0; j < data.n && i0 + j < this.n * 128; j++) { o[2 * j] = this.L[i0 + j]; o[2 * j + 1] = this.R[i0 + j]; } return o; }) });
    }
    process(inputs) { const i = inputs[0];
      if (this.last >= 0 && currentFrame !== this.last + 128 && this.odd.length < 1000) this.odd.push(currentFrame); this.last = currentFrame;
      if ((this.n + 1) * 128 > this.cap) return true;
      this.cf[this.n] = this.n > 0 && currentFrame <= this.cf[this.n - 1] ? this.cf[this.n - 1] + 128 : currentFrame;
      if (i && i.length) { this.L.set(i[0], this.n * 128); this.R.set(i[1] || i[0], this.n * 128); }
      this.n++; return true; }
  });`;
  await raw.audioWorklet.addModule(URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' })));
  const tap = new AudioWorkletNode(raw, 'hand-hits-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { cap } });
  (cfg.dry ? NN.nativeOutputOf(captureFor(LC.liveContext)) : NN.nativeOutputOf(LC.liveDestination)).connect(tap);
  const sink = raw.createGain();
  sink.gain.value = 0;
  tap.connect(sink).connect(raw.destination);
  await sleep(300);

  // Played by hand
  const presses = [];
  const t0 = performance.now() + 300;
  for (let i = 0; i < steps.length; i++) {
    const due = t0 + steps[i] * step * 1000 + 12 * rnd();
    for (;;) {
      const left = due - performance.now();
      if (left <= 0) break;
      if (left > 20) await sleep(left - 15);
      else await yieldNow();
    }
    hand = i;
    press = raw.currentTime;
    count = 0;
    held = cfg.hold === 'none';
    LI.playMidi({ kind: 'noteOn', note: cfg.midi, velocity: 0.8 }, press);
    const h = live.get(i);
    if (h) h.struck = h.env._struckAt ?? h.asked;
    LI.playMidi({ kind: 'noteOff', note: cfg.midi }, raw.currentTime);
    presses.push(press);
  }
  await sleep(1500);

  // Each live hit from where it begins (the first sample over -50 dB, from 1 ms before its attack)
  const SEG = fr(0.12);
  const looked = await new Promise((r) => { tap.port.onmessage = (e) => r(e.data); tap.port.postMessage({ at: steps.map((_, i) => fr(Math.min(live.get(i)?.asked ?? Infinity, live.get(i)?.struck ?? Infinity) - 0.001)), n: SEG }); });
  const onset = (seg, from = 0) => { for (let j = from; j < seg.length / 2; j++) if (Math.abs(seg[2 * j]) > 10 ** (-50 / 20) || Math.abs(seg[2 * j + 1]) > 10 ** (-50 / 20)) return j; return -1; };

  // The export of the same hits
  const audio = await EX.renderArrangement(LS.renderOptionsFor({ ...SN.listenSnapshot(store.currentProject()), clips: [clip] }, 1, 1 + bars));
  const L = audio.getChannelData(0);
  const R = audio.numberOfChannels > 1 ? audio.getChannelData(1) : L;
  const ef = (t) => Math.round(t * audio.sampleRate);
  const exportSeg = (at) => { const o = new Float32Array(2 * SEG); for (let j = 0; j < SEG; j++) { const f = at + j; if (f >= 0 && f < L.length) { o[2 * j] = L[f]; o[2 * j + 1] = R[f]; } } return o; };
  // (Where the export's first hit begins against its place: the dry FM skips the master's look-ahead)
  const first = exportSeg(ef(steps[0] * step) - ef(0.03));
  const shift = onset(first) - ef(0.03);

  const W = fr(0.05);
  const peakOf = (seg, a, n) => { let p = 0; for (let j = Math.max(0, a); j < Math.min(seg.length / 2, a + n); j++) p = Math.max(p, Math.abs(seg[2 * j]), Math.abs(seg[2 * j + 1])); return p; };
  const rmsOf = (seg, a, n) => { let e = 0; for (let j = a; j < a + n; j++) e += (seg[2 * j] ** 2 + seg[2 * j + 1] ** 2) / 2; return Math.sqrt(e / n); };
  const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
  return steps.map((st, i) => {
    const h = live.get(i);
    const seg = looked.seg[i];
    const o = onset(seg);
    const exp = exportSeg(ef(st * step) + shift - fr(0.001));
    const eo = onset(exp);
    if (!h || o < 0 || eo < 0) return { i, silent: true };
    // (live and export from 1 ms before their onsets)
    const a = o - fr(0.001);
    const b = eo - fr(0.001);
    const top = peakOf(exp, b, fr(0.061));
    let res = Infinity;
    for (let sh = -4; sh <= 4; sh++) {
      let m = 0;
      for (let j = 8; j < fr(0.061) - 8; j++) for (let c = 0; c < 2; c++) m = Math.max(m, Math.abs((seg[2 * (a + j + sh) + c] ?? 0) - (exp[2 * (b + j) + c] ?? 0)));
      res = Math.min(res, m);
    }
    const heard = fr(Math.min(h.asked, h.struck) - 0.001) + o;
    return {
      i,
      peak: db(peakOf(seg, a, W + fr(0.001))) - db(peakOf(exp, b, W + fr(0.001))),
      rms: db(rmsOf(seg, a + fr(0.001), W)) - db(rmsOf(exp, b + fr(0.001), W)),
      res: db(res) - db(top),
      at: h.struck - presses[i],
      late: looked.odd.some((f) => f > heard - fr(0.03) && f < heard + fr(0.08)),
    };
  });
};

(async () => {
  const only = (process.env.CASES || Object.keys(CASES).join(',')).split(',');
  const holds = (process.env.HOLDS || 'none,0,3,5,env').split(',').map((h) => (h === 'none' || h === 'env' ? h : Number(h)));
  const throttle = Number(process.env.THROTTLE || 1);
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let failed = 0;
  try {
    for (const name of only) {
      const c = CASES[name];
      if (!c) throw new Error(`No case ${name}`);
      for (const hold of holds) {
        if (typeof hold === 'number' && hold >= c.sources) continue;
        const n = Number(process.env.N || 24) >> (c.fewer ? 1 : 0);
        const page = await browser.newPage();
        if (throttle > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(APP, { waitUntil: 'load' });
        await page.waitForTimeout(2500);
        const rows = await page.evaluate(PAGE, { ...c, hold, n, bpm: BPM });
        await page.close();
        const judged = rows.filter((r) => !r.late);
        const off = judged.filter((r) => r.silent || Math.abs(r.peak) > 0.3 || Math.abs(r.rms) > 0.3 || r.res > -20);
        const at = rows.filter((r) => !r.silent).map((r) => r.at * 1000).sort((x, y) => x - y);
        const worst = (k) => Math.max(...judged.filter((r) => !r.silent).map((r) => Math.abs(r[k])));
        const bad = off.length > 0 || errors.length > 0 || judged.length < rows.length / 2;
        if (bad) failed++;
        console.log(`${bad ? 'FAIL' : 'ok  '} ${name}, held up ${hold === 'none' ? 'never' : hold === 'env' ? 'before the attack' : `after ${hold} started`}${throttle > 1 ? `, ${throttle}x slower` : ''}: ${off.length} of ${judged.length} hits off (worst peak ${worst('peak').toFixed(2)} dB, RMS ${worst('rms').toFixed(2)} dB), ${rows.length - judged.length} by a late device; attack ${at[at.length >> 1]?.toFixed(1)} ms after the press (most ${at[at.length - 1]?.toFixed(1)})${errors.length ? `; page errors: ${errors.slice(0, 2).join(' | ')}` : ''}`);
        for (const r of off.slice(0, 4)) console.log(`       hit ${r.i}: ${r.silent ? 'not found' : `peak ${r.peak.toFixed(2)} dB, RMS ${r.rms.toFixed(2)} dB, wave ${r.res.toFixed(1)} dB off`}`);
      }
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
