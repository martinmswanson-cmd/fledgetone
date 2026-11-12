// Check glide between chords (src/store/chordGlide.ts) in renders and live playback:
//
// - The same export twice: the very same samples.
// - Each voice glides in the time set (eased: 10% to 90% of the way in about 0.61 of it), at any
//   tempo (a tempo change in the middle of the progression), the bass in its own time; it ends on
//   the next note's pitch.
// - At each chord change, with glide: no step in level over 1 dB from one 10 ms to the next (the level over 50 ms around each), and
//   no peak above the same chords played as written (a softer chord too).
// - Live as in the export: a voice's pitch over its glides, and its glide times.
// - Begun part way: a render from between two chords (as Export from a bar, and as the agent's
//   listening begins held notes again) glides from the next chord on, one voice (as loud as in the
//   whole song's render), never two.
// - Live, round a loop whose Out cuts a voice part way, then Stop: each pass as loud as the first
//   (no voices left over), and after Stop it fades as the chords played as written do.
// - An instrument whose voices don't glide (Pluck; a Wavetable track given Supersaw): the very
//   same render as the chords without glide.
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/audio-check/chord-glide.cjs
//
// It exits with 1 when one is off. APP_URL overrides http://localhost:5200/. Needs Playwright with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';
const track = (key, extra = {}) => ({ id: 't1', name: key, instrumentKey: key, volume: -6, pan: 0, reverbSend: 0, delaySend: 0, ...extra });
const song = (key, clips, extra = {}) => ({ format: 'fledgetone-project', version: 1, name: 'Glide', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 3, enabled: false }, tracks: [track(key)], clips, ...extra });
let ids = 0;
const n = (note, startOffset, duration = '2n', velocity = 0.8) => ({ id: `n${++ids}`, note, startOffset, duration, velocity });
const clip = (notes, lengthBars, glide) => ({ id: 'c1', trackId: 't1', name: 'Chords', startBar: 1, lengthBars, notes, ...(glide ? { glide } : {}) });
const text = (s) => JSON.stringify(s);
const hz = (name) => 440 * 2 ** ((({ C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 })[name[0]] + (name[1] === '#' ? 1 : name[1] === 'b' ? -1 : 0) + 12 * (Number(name.at(-1)) - 4)) / 12);
const cents = (a, b) => 1200 * Math.log2(a / b);

// One voice, a chord each half bar (1 s at 120 BPM): C4 E4 D4 C4
const LINE = ['C4', 'E4', 'D4', 'C4'];
const line = (glide, extra) => song('wavetable', [clip(LINE.map((m, i) => n(m, i / 2)), 2, glide)], extra);
// Four chords voiced to move by steps, a bass under them, the third chord softer
const CHORDS = [
  ['F2', 'A3', 'C4', 'E4', 'G4'],
  ['D2', 'A3', 'C4', 'F4', 'A4'],
  ['G2', 'A#3', 'D4', 'F4', 'A4'],
  ['C2', 'A#3', 'E4', 'G4', 'C5'],
];
const chords = (glide, key = 'wavetable') => song(key, [clip(CHORDS.flatMap((ch, i) => ch.map((m) => n(m, i / 2, '2n', i === 2 ? 0.5 : 0.8))), 2, glide)]);

// In the page: render `text` (from `startBar`, to `toBar`; `restart`: notes held over it begun again there, as the agent's
// listening does) as Export does, and measure: `pitch` (autocorrelation, 20 ms, every 2 ms over [t0, t1] in band [lo, hi] Hz),
// `peakIn` (the strongest frequency in a band, every 5 ms with `win`-second windows), `rms` (dB over 10 ms windows over [t0, t1]),
// the peak and a hash of the samples
const RENDER = async ({ text, startBar = 1, toBar, restart, pitch, peakIn, rms }) => {
  const P = await import('/src/store/project.ts');
  const X = await import('/src/audio/exportWav.ts');
  const T = await import('/src/store/timelineTypes.ts');
  const p = P.parseProject(JSON.parse(text));
  let clips = p.clips;
  if (restart) clips = (await import('/src/audio/auditionMath.ts')).restartHeldNotes(clips, startBar, startBar);
  const audio = await X.renderArrangement({ tracks: p.tracks, clips, bpm: p.bpm, tempoPoints: p.tempoPoints, swing: p.swing, startBar, endBar: toBar, masterFx: p.masterFx ?? T.DEFAULT_MASTER_FX, master: p.master, ending: 'ringOut', sampleRate: 44100, markers: [] });
  const sr = audio.sampleRate;
  const x = audio.getChannelData(0);
  const out = {};
  const all = new Float32Array(x.length * audio.numberOfChannels);
  for (let c = 0; c < audio.numberOfChannels; c++) all.set(audio.getChannelData(c), c * x.length);
  out.hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', all.buffer))].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
  let peak = 0;
  for (let c = 0; c < audio.numberOfChannels; c++) for (const v of audio.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  out.peakDb = 20 * Math.log10(peak + 1e-20);
  if (pitch) {
    const [lo, hi] = pitch.band;
    const w = Math.round(0.02 * sr);
    out.pitch = [];
    for (let t = pitch.t0; t < pitch.t1; t += 0.002) {
      const i0 = Math.round(t * sr);
      const a = x.subarray(i0, i0 + w + Math.ceil(sr / lo) + 2);
      const corr = (L) => {
        let c = 0, e1 = 0, e2 = 0;
        for (let i = 0; i < w; i++) {
          c += a[i] * a[i + L];
          e1 += a[i] * a[i];
          e2 += a[i + L] * a[i + L];
        }
        return c / Math.sqrt(e1 * e2 + 1e-30);
      };
      let best = -Infinity, at = 0;
      const cs = new Map();
      for (let L = Math.floor(sr / hi); L <= Math.ceil(sr / lo); L++) {
        const c = corr(L);
        cs.set(L, c);
        if (c > best) [best, at] = [c, L];
      }
      const l = cs.get(at - 1) ?? corr(at - 1), r = cs.get(at + 1) ?? corr(at + 1);
      const d = (l - r) / (2 * (l - 2 * best + r) || 1);
      out.pitch.push(sr / (at + Math.max(-1, Math.min(1, d))));
    }
  }
  if (peakIn) {
    out.peakIn = [];
    const w = Math.round(peakIn.win * sr);
    for (let t = peakIn.t0; t < peakIn.t1; t += 0.005) {
      const i0 = Math.round((t - peakIn.win / 2) * sr);
      const a = x.subarray(Math.max(0, i0), i0 + w);
      let best = 0, bf = 0;
      for (let f = peakIn.band[0]; f <= peakIn.band[1]; f += 0.25) {
        const k = (2 * Math.PI * f) / sr, c = 2 * Math.cos(k);
        let s1 = 0, s2 = 0;
        for (let i = 0; i < a.length; i++) {
          const s0 = a[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (a.length - 1))) + c * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        const pw = s1 * s1 + s2 * s2 - c * s1 * s2;
        if (pw > best) [best, bf] = [pw, f];
      }
      out.peakIn.push(bf);
    }
  }
  if (rms) {
    // (each 10 ms, the level over the 50 ms around it: a pad's lowest notes beat inside a shorter window)
    out.rms = [];
    const w = Math.round(0.05 * sr);
    const hop = Math.round(0.01 * sr);
    for (let i = Math.round((rms.t0 - 0.02) * sr); i + w <= Math.round((rms.t1 + 0.03) * sr); i += hop) {
      let e = 0;
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const ch = audio.getChannelData(c);
        for (let j = i; j < i + w; j++) e += ch[j] * ch[j];
      }
      out.rms.push(10 * Math.log10(e / (w * audio.numberOfChannels) + 1e-20));
    }
  }
  return out;
};

// In the page: play `text` live from bar 1 (with `loop`: round the loop, Stop after `stopAfter` seconds), record what's heard, and
// measure from the first sound: `pitch` as RENDER's, `rms` every 10 ms over [t0, t1]
const LIVE = async ({ text, seconds, loop, pitch, rms }) => {
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const engine = await (await fetch('/src/audio/engine.ts')).text();
  const T = await import(engine.match(/from "([^"]*\/deps\/tone\.js[^"]*)"/)[1]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = store.useTimelineStore;
  s.getState().loadProject(P.parseProject(JSON.parse(text)));
  await sleep(3000);
  await T.start();
  const rec = new T.Recorder();
  T.getDestination().connect(rec);
  s.getState().seek(1);
  await sleep(300);
  rec.start();
  await s.getState().togglePlay();
  await sleep(seconds * 1000);
  if (s.getState().isPlaying) s.getState().stop();
  await sleep(loop ? 3500 : 800);
  const b = await new AudioContext().decodeAudioData(await (await rec.stop()).arrayBuffer());
  const x = b.getChannelData(0);
  const sr = b.sampleRate;
  const onset = Math.max(0, x.findIndex((v) => Math.abs(v) > 0.002));
  const out = { onset: onset / sr, load: undefined };
  if (pitch) {
    const [lo, hi] = pitch.band;
    const w = Math.round(0.02 * sr);
    out.pitch = [];
    for (let t = pitch.t0; t < pitch.t1; t += 0.002) {
      const i0 = onset + Math.round(t * sr);
      const corr = (L) => {
        let c = 0, e1 = 0, e2 = 0;
        for (let i = 0; i < w; i++) {
          c += x[i0 + i] * x[i0 + i + L];
          e1 += x[i0 + i] ** 2;
          e2 += x[i0 + i + L] ** 2;
        }
        return c / Math.sqrt(e1 * e2 + 1e-30);
      };
      let best = -Infinity, at = 0;
      for (let L = Math.floor(sr / hi); L <= Math.ceil(sr / lo); L++) {
        const c = corr(L);
        if (c > best) [best, at] = [c, L];
      }
      const l = corr(at - 1), r = corr(at + 1);
      const d = (l - r) / (2 * (l - 2 * best + r) || 1);
      out.pitch.push(sr / (at + Math.max(-1, Math.min(1, d))));
    }
  }
  if (rms) {
    out.rms = [];
    const w = Math.round(0.01 * sr);
    for (let i = onset + Math.round(rms.t0 * sr); i + w <= Math.min(x.length, onset + Math.round(rms.t1 * sr)); i += w) {
      let e = 0;
      for (let j = i; j < i + w; j++) e += x[j] * x[j];
      out.rms.push(10 * Math.log10(e / w + 1e-20));
    }
  }
  return out;
};

/**
 * A glide's measured time from a pitch track (Hz, every `step` s from `t0`): where it's 10% and 90% of the way from `from` to `to`
 * (in cents), after `at` (s), as the eased curve has it (smoothstep: 10% to 90% in 0.608 of it); and where it settles.
 */
function glideTime(track, t0, step, at, from, to) {
  const c = track.map((f) => cents(f, from));
  const span = cents(to, from);
  const i0 = Math.max(0, Math.round((at - 0.05 - t0) / step));
  const frac = (i) => c[i] / span;
  let i10 = -1, i90 = -1;
  for (let i = i0; i < c.length; i++) {
    if (i10 < 0 && frac(i) >= 0.1) i10 = i;
    if (i90 < 0 && frac(i) >= 0.9) {
      i90 = i;
      break;
    }
  }
  if (i10 < 0 || i90 < 0) return null;
  const settled = c.slice(i90 + Math.round(0.15 / step), i90 + Math.round(0.3 / step));
  const end = settled.length ? settled.reduce((a, b) => a + b, 0) / settled.length : NaN;
  return { ms: ((i90 - i10) * step * 1000) / 0.608, starts: t0 + i10 * step - at, endCents: end - span };
}

const results = [];
const report = (ok, what) => {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'OFF '} ${what}`);
};
const load = () => require('fs').readFileSync('/proc/loadavg', 'utf8').split(' ')[0];

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
  await page.goto(APP, { waitUntil: 'networkidle' });
  page.setDefaultTimeout(900000);
  const render = (args) => page.evaluate(RENDER, args);

  // The same export twice
  const a1 = await render({ text: text(chords({ ms: 150 })), toBar: 3 });
  const a2 = await render({ text: text(chords({ ms: 150 })), toBar: 3 });
  report(a1.hash === a2.hash, `the same export twice: ${a1.hash} ${a2.hash}`);

  // Glide times, one voice, at 120 BPM (a chord a second) and over a tempo change (120 to 60 at bar 2: the third change 2 s after the second)
  const band = [240, 350];
  for (const ms of [60, 150, 300]) {
    const r = await render({ text: text(line({ ms })), toBar: 3, pitch: { t0: 0.3, t1: 3.6, band } });
    for (let k = 1; k < 4; k++) {
      const g = glideTime(r.pitch, 0.3, 0.002, k, hz(LINE[k - 1]), hz(LINE[k]));
      report(!!g && Math.abs(g.ms - ms) <= Math.max(12, 0.15 * ms) && Math.abs(g.endCents) < 5, `glide ${ms} ms, ${LINE[k - 1]} to ${LINE[k]}: measured ${g ? `${g.ms.toFixed(0)} ms, starting ${(g.starts * 1000).toFixed(0)} ms after the change, ending ${g.endCents.toFixed(1)} cents off` : 'none'}`);
    }
  }
  const tempo = line({ ms: 150 }, { tempoPoints: [{ id: 'tp', bar: 2, bpm: 60, ramp: false }] });
  const tr = await render({ text: text(tempo), toBar: 3, pitch: { t0: 0.3, t1: 4.8, band } });
  // (changes at 1 s, 2 s and, at 60 BPM after bar 2, 4 s)
  for (const [k, at] of [[1, 1], [2, 2], [3, 4]]) {
    const g = glideTime(tr.pitch, 0.3, 0.002, at, hz(LINE[k - 1]), hz(LINE[k]));
    report(!!g && Math.abs(g.ms - 150) <= 22 && Math.abs(g.endCents) < 5, `glide 150 ms over a tempo change, the change at ${at} s: measured ${g ? `${g.ms.toFixed(0)} ms, ending ${g.endCents.toFixed(1)} cents off` : 'none'}`);
  }

  // The bass in its own time: G2 and D4 to C2 and E4, the bass 300 ms, the rest 80 ms
  const bassSong = song('wavetable', [clip([n('G2', 0), n('D4', 0), n('C2', 0.5), n('E4', 0.5)], 1, { ms: 80, bassMs: 300 })]);
  const bb = await render({ text: text(bassSong), toBar: 2, peakIn: { t0: 0.5, t1: 1.8, band: [55, 110], win: 0.06 } });
  const bu = await render({ text: text(bassSong), toBar: 2, peakIn: { t0: 0.5, t1: 1.8, band: [280, 345], win: 0.03 } });
  const gb = glideTime(bb.peakIn, 0.5, 0.005, 1, hz('G2'), hz('C2'));
  const gu = glideTime(bu.peakIn, 0.5, 0.005, 1, hz('D4'), hz('E4'));
  report(!!gb && !!gu && Math.abs(gb.ms - 300) < 60 && gu.ms < 150 && gb.ms > 2 * gu.ms, `the bass glides in its own time: bass ${gb ? gb.ms.toFixed(0) : '?'} ms (300 set), the voice above ${gu ? gu.ms.toFixed(0) : '?'} ms (80 set; both seen through 60 and 30 ms windows)`);

  // Level at the chord changes (1 s, 2 s, 3 s), with glide and as written; the third chord is softer
  const steps = (r) => {
    let most = 0;
    for (const at of [1, 2, 3]) {
      const i0 = Math.round((at - 0.1 - 0.5) / 0.01);
      for (let i = i0 + 1; i < i0 + 40; i++) most = Math.max(most, Math.abs(r.rms[i] - r.rms[i - 1]));
    }
    return most;
  };
  const steady = (r) => {
    let most = 0;
    for (const at of [1.5, 2.5]) {
      const i0 = Math.round((at - 0.2 - 0.5) / 0.01);
      for (let i = i0 + 1; i < i0 + 40; i++) most = Math.max(most, Math.abs(r.rms[i] - r.rms[i - 1]));
    }
    return most;
  };
  for (const ms of [60, 150, 300]) {
    const on = await render({ text: text(chords({ ms })), toBar: 3, rms: { t0: 0.5, t1: 3.6 } });
    const off = await render({ text: text(chords()), toBar: 3, rms: { t0: 0.5, t1: 3.6 } });
    report(steps(on) <= 1 && on.peakDb <= off.peakDb + 0.05, `chords gliding ${ms} ms: the biggest step in level at a change ${steps(on).toFixed(2)} dB (mid-chord ${steady(on).toFixed(2)} dB; as written ${steps(off).toFixed(2)} dB), peak ${on.peakDb.toFixed(2)} dB (as written ${off.peakDb.toFixed(2)} dB)`);
  }

  // Begun part way, between the first two chords (bar 1.25): from Export's start bar, and with held notes begun again
  const whole = await render({ text: text(line({ ms: 150 })), toBar: 3, pitch: { t0: 1.3, t1: 3.6, band }, rms: { t0: 1.3, t1: 3.6 } });
  for (const restart of [false, true]) {
    const part = await render({ text: text(line({ ms: 150 })), startBar: 1.25, toBar: 3, restart, pitch: { t0: 0.8, t1: 3.1, band }, rms: { t0: 0.8, t1: 3.1 } });
    // (the render from bar 1.25 is 0.5 s behind the whole one)
    let worst = 0;
    for (let i = 100; i < whole.pitch.length; i++) worst = Math.max(worst, Math.abs(cents(part.pitch[i], whole.pitch[i])));
    // (its level once the voice begun at the next chord has settled from its attack: from the chord after)
    let level = 0;
    for (let i = 70; i < whole.rms.length - 5; i++) level = Math.max(level, Math.abs(part.rms[i] - whole.rms[i]));
    report(worst < 10 && level < 1.5, `begun part way (bar 1.25${restart ? ', its held note begun again there' : ''}): from the next chord its pitch is within ${worst.toFixed(1)} cents of the whole song's, and from the chord after its level within ${level.toFixed(2)} dB (one voice)`);
  }

  // Live as in the export: one voice gliding 150 ms
  const lt = text(line({ ms: 150 }));
  const ex = await render({ text: lt, toBar: 3, pitch: { t0: 0.3, t1: 3.6, band } });
  const live = await page.evaluate(LIVE, { text: lt, seconds: 4.5, pitch: { t0: 0.3, t1: 3.6, band } });
  let off = 0;
  for (let i = 0; i < ex.pitch.length; i++) {
    const t = 0.3 + i * 0.002;
    // (beside a change the live recording's place can be a few ms off: compared away from the glides' steep middles)
    if ([1, 2, 3].some((at) => t > at - 0.01 && t < at + 0.2)) continue;
    off = Math.max(off, Math.abs(cents(live.pitch[i], ex.pitch[i])));
  }
  const liveTimes = [1, 2, 3].map((k) => glideTime(live.pitch, 0.3, 0.002, k, hz(LINE[k - 1]), hz(LINE[k])));
  report(off < 8 && liveTimes.every((g) => g && Math.abs(g.ms - 150) <= 22), `live as in the export: its pitch within ${off.toFixed(1)} cents outside the glides, glides of ${liveTimes.map((g) => (g ? g.ms.toFixed(0) : '?')).join(', ')} ms live (load ${load()})`);

  // Live round a loop whose Out (bar 1.75) cuts the second chord's voices, three times round, then Stop; the same as written
  const loopRun = async (glide) => page.evaluate(LIVE, { text: text({ ...chords(glide), loopRegion: { inBar: 1, outBar: 1.75, enabled: true } }), seconds: 4.5 + 0.2, loop: true, rms: { t0: 0, t1: 8 } });
  const lg = await loopRun({ ms: 150 });
  const lp = await loopRun(undefined);
  const mean = (r, a, b) => 10 * Math.log10(r.rms.slice(Math.round(a / 0.01), Math.round(b / 0.01)).reduce((s, v) => s + 10 ** (v / 10), 0) / Math.max(1, Math.round((b - a) / 0.01)));
  // (each pass 1.5 s: the first chord of each pass)
  const passes = [0, 1.5, 3].map((p) => mean(lg, p + 0.2, p + 0.9));
  const after = (r) => [0.5, 2].map((d) => mean(r, 4.7 + d, 4.7 + d + 0.3));
  const ag = after(lg), ap = after(lp);
  report(Math.max(...passes) - Math.min(...passes) < 1.5 && ag.every((v, i) => v < ap[i] + 3), `live round a loop that cuts a gliding voice: each pass ${passes.map((v) => v.toFixed(1)).join(', ')} dB; after Stop ${ag.map((v) => v.toFixed(1)).join(', ')} dB at 0.5 and 2 s (as written ${ap.map((v) => v.toFixed(1)).join(', ')} dB) (load ${load()})`);

  // An instrument whose voices don't glide: the chords as written, the very same render
  for (const [key, label] of [['pluck', 'Pluck'], ['supersaw', 'a Wavetable clip on a track given Supersaw']]) {
    const g = await render({ text: text(chords({ ms: 150 }, key)), toBar: 3 });
    const p = await render({ text: text(chords(undefined, key)), toBar: 3 });
    report(g.hash === p.hash, `${label}: the chords as written (${g.hash}, without glide ${p.hash})`);
  }

  await browser.close();
  const bad = results.filter((r) => !r).length;
  console.log(`${results.length - bad} of ${results.length} ok`);
  process.exit(bad ? 1 : 0);
})();
