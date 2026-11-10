// Switching a plugin's whole sound on held notes: every built-in plugin with presets, and Surge
// XT, in a running AudioContext with a recorder on the audio thread. A held chord (instruments)
// or a steady bright sound fed in (effects: a sawtooth chord, a square chord, white noise, each
// in turn). Actions, each followed by a wait: a chain of presets chosen as the plugin window does
// (controls.setProgram), settings put back as an undo does (setState) and forward as a redo does,
// Reset all; Fledge Synth also goes from its own sound to every preset and back (Surge XT from no
// patch to K of its patches and back). Then, for an instrument, a switch made while it is silent
// (a preset that dies away, held until it has).
//
// Per action, from the moment it's made:
// - burst: the loudest 10 ms of the new sound in the 250 ms after (from the switch's silence on),
//   in dB over the louder of the new sound settled (350 ms on) and a fresh note (the same chord
//   or sound into a new plugin with the new settings, rendered offline; for an instrument the
//   loudest of three struck at different places in the song). Over 1 dB fails.
// - click: the largest sample step in the switch's fade out, its silence and the 30 ms after it
//   (before, the old sound plays on; later steps are the new sound's own), over the largest of
//   the steady sound's before, after and in the fresh note. Over 1.25 (and over 0.01) fails.
// - silent: a 20 ms window under 0.001 while the sound before and after it is over 0.01 (the
//   switch's own silence is 5 ms; Surge XT stops held notes as a patch loads), unless a fresh
//   note of the new sound starts as quietly (a slow attack). Any fails.
// Prints each plugin's worst burst and click (and which switch), and every failing switch.
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/audio-check/switch-sweep.cjs
//
// APP_URL overrides http://localhost:5200/. ONLY=<part of a name> for some plugins; K=<n> presets
// per plugin in the chain (default 16, spread over its list; ALL=1 for every one); WAIT=<ms> after
// each action (default 750); SHOW=1 prints each step as it's made; ROWS=1 every switch's figures; RESTRIKE=<ms> an instrument's chord is struck again before each action (default 400; 0: at once); MODE=pocket runs it in Pocket's page (the same audio path).
// Needs Playwright with Chromium. Exit code 0 when nothing fails. Timing matters (a stalled render
// is a gap): run it on a quiet machine; it prints the load, and the recorder's gaps per plugin.
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright');
}
const os = require('os');

const APP = process.env.APP_URL || 'http://localhost:5200/';
const ONLY = process.env.ONLY || '';
// (ms an instrument's chord, struck again before each action, sounds before the switch)
const RESTRIKE = Number(process.env.RESTRIKE ?? 400);
const K = process.env.ALL ? 1e9 : Number(process.env.K || 16);
const WAIT = Number(process.env.WAIT || 750);
const MODE = process.env.MODE === 'pocket' ? 'pocket' : 'studio';
const BURST_DB = 1;
const CLICK = 1.25;
const load = () => os.loadavg().map((x) => x.toFixed(2)).join(' ');

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: MODE === 'pocket' ? { width: 390, height: 844 } : { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
    } catch {}
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  if (process.env.SHOW) page.on('console', (m) => console.log('  page:', m.text().slice(0, 200)));
  await page.goto(APP + (MODE === 'pocket' ? '?pocket' : '?studio'));
  await page.waitForTimeout(3000);
  console.log(`${MODE} ${APP} load ${load()}`);
  // Which plugins have presets (each made once to ask)
  const list = await page.evaluate(async (ONLY) => {
    const B = await import('/src/store/builtinPlugins.ts');
    const W = await import('/src/audio/wamHost.ts');
    const ac = new AudioContext();
    const out = [];
    for (const e of B.allBuiltinPlugins()) {
      if (ONLY && !e.info.name.includes(ONLY)) continue;
      const url = `builtin:${e.family.family}/${e.info.name}`;
      try {
        const inst = await W.loadWam(ac, url, undefined, false);
        const n = inst.controls.programs.length;
        inst.audioNode.destroy?.();
        if (n) out.push({ url, name: e.info.name, instrument: !!e.info.instrument, presets: n });
      } catch {
        // (Not in this build)
      }
    }
    await ac.close();
    return out;
  }, ONLY);
  console.log(`${list.length} plugins with presets: ${list.map((e) => e.name).join(', ')}`);
  let failed = 0;
  for (const e of list) {
    const sources = e.instrument ? ['chord'] : ['saw', 'square', 'noise'];
    for (const source of sources) {
      const l0 = load();
      const r = await page.evaluate(
        async ([e, source, K, WAIT, RESTRIKE]) => {
          const W = await import('/src/audio/wamHost.ts');
          const E = await import('/src/store/pluginEdits.ts');
          const H = await import('/src/audio/plugins/builtinHost.ts');
          const wait = (ms) => new Promise((res) => setTimeout(res, ms));
          const clone = (x) => JSON.parse(JSON.stringify(x));
          const sr = 48000;
          const REC = `class SwRec extends AudioWorkletProcessor { constructor() { super(); this.l = []; this.r = []; this.on = true; this.start = -1; this.prev = -1; this.gaps = 0;
            this.port.onmessage = (m) => { if (m.data === 'stop') { this.on = false; const n = this.l.length * 128; const L = new Float32Array(n), R = new Float32Array(n); this.l.forEach((b, i) => L.set(b, i * 128)); this.r.forEach((b, i) => R.set(b, i * 128)); this.port.postMessage({ L, R, start: this.start, gaps: this.gaps }, [L.buffer, R.buffer]); } }; }
            process(inputs) { if (!this.on) return false; const i = inputs[0]; if (this.start < 0) this.start = currentFrame; if (this.prev >= 0 && currentFrame !== this.prev + 128) this.gaps++; this.prev = currentFrame; this.l.push(new Float32Array(i[0] || 128)); this.r.push(new Float32Array(i[1] || i[0] || 128)); return true; } }
            registerProcessor('sw-sweep-rec', SwRec);`;
          const ac = new AudioContext({ sampleRate: sr, latencyHint: 'interactive' });
          await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([REC], { type: 'text/javascript' })));
          const inst = await W.loadWam(ac, e.url, undefined, false);
          const c = inst.controls;
          const node = inst.audioNode;
          const N = c.programs.length;
          const rec = new AudioWorkletNode(ac, 'sw-sweep-rec', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
          node.connect(rec);
          const sink = ac.createGain();
          sink.gain.value = 0;
          node.connect(sink).connect(ac.destination);
          if (ac.state !== 'running') await ac.resume();
          // The same sound into a live plugin or a fresh one (seeded noise: the same every time)
          const noise = (c2) => {
            const b = c2.createBuffer(1, sr * 2, sr);
            const d = b.getChannelData(0);
            let s = 12345;
            for (let i = 0; i < d.length; i++) {
              s = (s * 1103515245 + 12345) >>> 0;
              d[i] = (s / 2 ** 32) * 2 - 1;
            }
            return b;
          };
          const feed = (c2, dest, t0) => {
            if (e.instrument) {
              for (const k of [45, 52, 57]) dest.scheduleEvents({ type: 'wam-midi', time: t0, data: { bytes: [0x90, k, 100] } });
              return;
            }
            if (source === 'noise') {
              const s = c2.createBufferSource();
              s.buffer = noise(c2);
              s.loop = true;
              const g = c2.createGain();
              g.gain.value = 0.1;
              s.connect(g).connect(dest);
              s.start(t0);
              return;
            }
            for (const f of [110, 165, 220]) {
              const o = c2.createOscillator();
              o.type = source === 'square' ? 'square' : 'sawtooth';
              o.frequency.value = f;
              const g = c2.createGain();
              g.gain.value = 0.1;
              o.connect(g).connect(dest);
              o.start(t0);
            }
          };
          feed(ac, node, ac.currentTime + 0.05);
          await wait(1200);
          const actions = [];
          const act = async (label, fn, pause = WAIT) => {
            console.log(label);
            // (An instrument: the chord struck again first, so every switch is made with it
            // sounding, not on notes a sound before let die away)
            if (e.instrument) {
              const at = ac.currentTime;
              for (const k of [45, 52, 57]) node.scheduleEvents({ type: 'wam-midi', time: at, data: { bytes: [0x80, k, 0] } });
              for (const k of [45, 52, 57]) node.scheduleEvents({ type: 'wam-midi', time: at + 0.01, data: { bytes: [0x90, k, 100] } });
              await wait(RESTRIKE);
            }
            const t = ac.currentTime;
            await fn();
            await wait(pause);
            const st = clone(node.getStateNow());
            actions.push({ label, t, st });
            return st;
          };
          const own = clone(node.getStateNow());
          const states = [own];
          // Starting on its own sound (Fledge Synth; Surge XT with no patch): to each preset and
          // back (every one, or K spread over a long list)
          if (c.program() < 0) {
            const some = N <= 64 ? N : Math.min(K, N);
            for (let k = 0; k < some; k++) {
              const p = Math.round((k * N) / some) % N;
              await act(`own sound -> ${p} "${c.programs[p]}"`, () => c.setProgram(p));
              await act(`${p} -> own sound (undo)`, () => node.setState(clone(own)));
            }
          }
          // A chain of presets, spread over the list
          const n = Math.min(K, N);
          const p0 = Math.max(0, c.program());
          for (let k = 1; k <= n; k++) {
            const p = (p0 + Math.round((k * N) / n)) % N;
            states.push(await act(`preset ${p} "${c.programs[p]}"`, () => c.setProgram(p)));
          }
          // Undo-like back three, redo-like forward two, Reset all
          const L = states.length;
          for (const j of [L - 2, L - 3, L - 4].filter((j) => j >= 0)) await act(`undo to step ${j}`, () => node.setState(clone(states[j])));
          for (const j of [L - 3, L - 2].filter((j) => j >= 0)) await act(`redo to step ${j}`, () => node.setState(clone(states[j])));
          await act('Reset all', async () => E.editPluginParams(c, E.resetAllMoves(c.params())));
          const got0 = await new Promise((res) => {
            rec.port.onmessage = (m) => res(m.data);
            rec.port.postMessage('stop');
          });
          // From silence (instruments): the quietest preset chosen, held till it has died away,
          // then the one before it
          let fromSilence = null;
          if (e.instrument) {
            const idx = (t) => Math.round(t * sr) - got0.start;
            let q = null;
            for (const a of actions) {
              if (a.st.program === undefined || a.st.program < 0) continue;
              const i = idx(a.t) + Math.round(0.6 * sr);
              let m = 0;
              for (let j = i; j < Math.min(got0.L.length, i + 0.1 * sr); j++) m = Math.max(m, Math.abs(got0.L[j]));
              if (!q || m < q.m) q = { m, a };
            }
            if (q && q.m < 0.01) fromSilence = q.a;
          }
          const rec2 = new AudioWorkletNode(ac, 'sw-sweep-rec', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
          node.connect(rec2);
          const silentActs = [];
          if (fromSilence) {
            await node.setState(clone(fromSilence.st));
            // (Long enough for most sounds that die away to have)
            await wait(4000);
            const back = clone(states[Math.max(0, states.length - 2)]);
            const t = ac.currentTime;
            await node.setState(back);
            await wait(WAIT);
            silentActs.push({ label: `from silence (${fromSilence.label.replace(/^preset /, '')} died away) -> step ${states.length - 2}`, t, st: clone(node.getStateNow()) });
          }
          const got1 = await new Promise((res) => {
            rec2.port.onmessage = (m) => res(m.data);
            rec2.port.postMessage('stop');
          });
          const ms = (x) => Math.round((x * sr) / 1000);
          const measure = (got, a) => {
            const { L: XL, R: XR, start } = got;
            const i = Math.round(a.t * sr) - start;
            const win = (lo, hi, w, pick) => {
              let m = pick === 'min' ? Infinity : 0;
              for (let k = Math.max(0, lo); k + w <= Math.min(XL.length, hi); k += ms(2.5)) {
                let s = 0;
                for (let j = k; j < k + w; j++) s += XL[j] * XL[j] + XR[j] * XR[j];
                const v = Math.sqrt(s / (2 * w));
                m = pick === 'min' ? Math.min(m, v) : Math.max(m, v);
              }
              return m;
            };
            let stepAt = 0;
            const step = (lo, hi) => {
              let m = 0;
              for (let k = Math.max(1, lo); k < Math.min(XL.length, hi); k++) {
                const d = Math.max(Math.abs(XL[k] - XL[k - 1]), Math.abs(XR[k] - XR[k - 1]));
                if (d > m) {
                  m = d;
                  stepAt = ((k - i) / sr) * 1000;
                }
              }
              return m;
            };
            // (The new sound from the switch's silence on: before it, the old one is fading out)
            let dip = i;
            let quiet = Infinity;
            for (let k = i; k + ms(1) <= Math.min(XL.length, i + ms(100)); k += 12) {
              let s = 0;
              for (let j = k; j < k + ms(1); j++) s += XL[j] * XL[j] + XR[j] * XR[j];
              if (s < quiet) {
                quiet = s;
                dip = k;
              }
            }
            return {
              before: win(i - ms(300), i, ms(10)),
              sw: win(dip, i + ms(250), ms(10)),
              after: win(i + ms(350), i + ms(WAIT - 10), ms(10)),
              sB: step(i - ms(300), i),
              sA: step(i + ms(350), i + ms(WAIT - 10)),
              // (The switch itself: its fade out, its silence and up to 30 ms past it; before, the
              // old sound plays on, and later steps are the new sound's own)
              sS: step(Math.max(i, dip - ms(6)), dip + ms(30)),
              stepAt,
              lo20: win(i, i + ms(250), ms(20), 'min'),
            };
          };
          const freshCache = new Map();
          // A fresh note's level: the loudest of a few struck at different places in the song (an
          // instrument whose unison voices start at random points, or whose LFO follows the song,
          // sounds a little different at each)
          const fresh = async (st) => {
            const key = JSON.stringify(st);
            if (freshCache.has(key)) return freshCache.get(key);
            console.log('fresh', st.program ?? st.preset ?? '');
            let m = 0;
            let sm = 0;
            // (And the quietest 20 ms of its first 250: a sound that starts slowly starts quiet)
            let lo = Infinity;
            for (const beat of e.instrument ? [0, 1.37, 2.71] : [0]) {
              const oc = new OfflineAudioContext(2, Math.round(sr * 1.3), sr);
              const oi = await W.loadWam(oc, e.url, clone(st), false);
              oi.audioNode.connect(oc.destination);
              if (e.instrument) oi.audioNode.scheduleEvents({ type: 'wam-transport', time: 0.05, data: { tempo: 120, beat } });
              feed(oc, oi.audioNode, 0.05);
              await wait(30);
              await H.syncBuiltinPlugins(oc);
              const b = await oc.startRendering();
              const l = b.getChannelData(0);
              const r2 = b.getChannelData(1);
              const w = ms(10);
              for (let i = ms(50); i + w <= l.length; i += ms(2.5)) {
                let s = 0;
                for (let j = i; j < i + w; j++) s += l[j] * l[j] + r2[j] * r2[j];
                m = Math.max(m, Math.sqrt(s / (2 * w)));
              }
              for (let i = ms(50) + 1; i < l.length; i++) sm = Math.max(sm, Math.abs(l[i] - l[i - 1]), Math.abs(r2[i] - r2[i - 1]));
              for (let i = ms(50); i + ms(20) <= ms(300); i += ms(2.5)) {
                let s = 0;
                for (let j = i; j < i + ms(20); j++) s += l[j] * l[j] + r2[j] * r2[j];
                lo = Math.min(lo, Math.sqrt(s / (2 * ms(20))));
              }
              oi.audioNode.destroy?.();
            }
            const v = { m, sm, lo };
            freshCache.set(key, v);
            return v;
          };
          const rows = [];
          for (const [got, list] of [
            [got0, actions],
            [got1, silentActs],
          ])
            for (const a of list) rows.push({ label: a.label, ...measure(got, a), fr: await fresh(a.st) });
          node.destroy?.();
          await ac.close();
          return { rows, gaps: got0.gaps + got1.gaps, N };
        },
        [e, source, K, WAIT, RESTRIKE],
      );
      let worstB = { v: -Infinity, label: '' };
      let worstC = { v: 0, label: '' };
      const bad = [];
      for (const x of r.rows) {
        const ref = Math.max(x.after, x.fr.m, 1e-9);
        const db = 20 * Math.log10(Math.max(x.sw, 1e-9) / ref);
        const click = x.sS / Math.max(x.sB, x.sA, x.fr.sm, 1e-9);
        // (Not where a fresh note of it starts as quietly: a slow attack, a vocoder's envelopes)
        const silent = x.lo20 < 0.001 && Math.min(x.before, x.after) > 0.01 && !(x.fr.lo < 0.001);
        if (db > worstB.v) worstB = { v: db, label: x.label };
        if (x.sS > 0.01 && click > worstC.v) worstC = { v: click, label: x.label };
        const why = [];
        if (db > BURST_DB) why.push(`burst +${db.toFixed(1)} dB`);
        if (x.sS > 0.01 && click > CLICK) why.push(`click x${click.toFixed(2)}`);
        if (silent) why.push('silent 20 ms');
        if (process.env.ROWS && !why.length)
          console.log(`         ${x.label}: ${db >= 0 ? '+' : ''}${db.toFixed(1)} dB, click x${click.toFixed(2)} (loudest 10 ms ${x.sw.toFixed(3)}, settled ${x.after.toFixed(3)}, fresh ${x.fr.m.toFixed(3)}, before ${x.before.toFixed(3)}; step ${x.sS.toFixed(3)})`);
        if (why.length)
          bad.push(
            `    FAIL ${x.label}: ${why.join(', ')} (loudest 10 ms ${x.sw.toFixed(3)}, settled ${x.after.toFixed(3)}, fresh ${x.fr.m.toFixed(3)}, before ${x.before.toFixed(3)}; step ${x.sS.toFixed(3)} at ${x.stepAt.toFixed(1)} ms against ${Math.max(x.sB, x.sA, x.fr.sm).toFixed(3)}; quietest 20 ms ${x.lo20.toFixed(4)})`,
          );
      }
      failed += bad.length;
      const src = e.instrument ? 'held chord' : `${source} in`;
      console.log(
        `${bad.length ? 'FAIL' : 'ok  '} ${e.name} (${src}, ${r.N} presets, ${r.rows.length} switches): worst burst ${worstB.v >= 0 ? '+' : ''}${worstB.v.toFixed(1)} dB (${worstB.label}), worst click x${worstC.v.toFixed(2)}${worstC.label ? ` (${worstC.label})` : ''} | gaps ${r.gaps} | load ${l0}`,
      );
      for (const b of bad) console.log(b);
    }
  }
  console.log(`${failed ? `${failed} switches fail` : 'every switch passes'} | load ${load()}`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
