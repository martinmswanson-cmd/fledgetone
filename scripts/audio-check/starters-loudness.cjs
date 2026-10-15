// Measure how loud each starter song plays, for the table in src/store/startersLoudness.ts.
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/audio-check/starters-loudness.cjs > levels.jsonl
//   IDS=epic,riddim node scripts/audio-check/starters-loudness.cjs
//
// Each starter (all of them, or IDS) is built with createStarter and rendered in full through the
// app's own export path (renderArrangement), in a fresh page each, with the master limiter passed
// through. The page then runs the limiter's own kernel over that sound, so one render gives both
// sides of the limiter: the loudness and true peak the song plays at, and how much the limiter
// takes off (its most, and the loudness it costs). One JSON line per starter: its integrated
// loudness (LUFS) and true peak (dBTP) after the limiter, the gain reduction, its target
// (startersLoudness.ts) and the trim that would land it there, its current trim included.
// A trim (the master Level) changes what reaches the limiter, so measure again after changing one.
// APP_URL overrides http://localhost:5200/. Needs Playwright with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';
// How long one starter may take (ms; TIMEOUT overrides) before it's tried again
const TIMEOUT = Number(process.env.TIMEOUT || 300000);
// The two places the page is changed so the limiter's input can be read: the export's master
// section (run after the render, masterAfter.ts) skips the limiter, and renderArrangement doesn't
// turn the result down to its peak
const PATCHES = [
  [/\/src\/audio\/effects\/masterAfter\.ts/, 'limitChannels(left, right, sampleRate, ceilingDbtp);', ''],
  [/\/src\/audio\/exportWav\.ts/, 'scale(channels, peakGain(peakOf(channels)));', ''],
];

// In the page: render starter `id` and measure it (see above)
const MEASURE = async (id) => {
  const ex = await import('/src/audio/exportWav.ts');
  const T = await import('/src/store/timelineTypes.ts');
  const { STARTERS, createStarter } = await import('/src/store/starters.ts');
  const L = await import('/src/store/startersLoudness.ts');
  const { measureLoudness } = await import('/src/audio/loudness.ts');
  const { createLimiterKernel, LIMITER_CEILING_DBTP } = await import('/src/audio/effects/limiter.ts');
  const sr = 44100;
  const p = createStarter(id);
  const a = await ex.renderArrangement({ tracks: p.tracks, clips: p.clips, bpm: p.bpm, tempoPoints: p.tempoPoints, swing: p.swing ?? 0, startBar: 1, endBar: p.loopRegion.outBar, masterFx: p.masterFx ?? T.DEFAULT_MASTER_FX, master: p.master, ending: 'ringOut', sampleRate: sr, markers: p.markers });
  const pre = ex.channelsOf(a);
  const n = pre[0].length;
  const post = [new Float32Array(n), new Float32Array(n)];
  const kernel = createLimiterKernel(sr);
  const gains = [];
  for (let i = 0; i < n; i += 128) {
    const f = Math.min(128, n - i);
    kernel.process(pre[0].subarray(i, i + f), (pre[1] ?? pre[0]).subarray(i, i + f), post[0].subarray(i, i + f), post[1].subarray(i, i + f), f, 10 ** (LIMITER_CEILING_DBTP / 20), 0.06);
    gains.push(-20 * Math.log10(Math.max(1e-6, kernel.gain())));
  }
  const before = await measureLoudness(pre, sr);
  const after = await measureLoudness(post, sr);
  const sorted = [...gains].sort((x, y) => x - y);
  const r1 = (v) => Math.round(v * 10) / 10;
  const group = STARTERS.find((s) => s.id === id).group;
  const target = L.starterLoudness(id, group);
  const trim = L.starterTrimDb(id);
  return {
    id,
    group,
    lufs: r1(after.integrated),
    truePeak: r1(after.truePeakMax),
    // The limiter's gain reduction: its most, the most it holds for 1% of the song, and the loudness it costs
    maxGr: r1(sorted[sorted.length - 1]),
    gr99: r1(sorted[Math.floor(sorted.length * 0.99)]),
    lufsLost: r1(before.integrated - after.integrated),
    target,
    trim,
    // About right while the limiter takes little; it takes some of a bigger change
    suggestedTrim: r1(trim + target - after.integrated),
  };
};

let browser = null;
async function open() {
  browser ??= await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  for (const [re, from, to] of PATCHES) {
    await page.route(re, async (r) => {
      const response = await r.fetch();
      const body = await response.text();
      if (!body.includes(from)) console.error(`[patch] ${from} not found in ${r.request().url()}: the measurement would be wrong`);
      return r.fulfill({ response, body: body.replace(from, to) });
    });
  }
  // Recorded instruments from mirrors (some networks block the usual hosts)
  for (const [re, base] of [[/tonejs\.github\.io\/audio\/(.+)$/, 'https://raw.githubusercontent.com/Tonejs/audio/master/'], [/gleitz\.github\.io\/midi-js-soundfonts\/(.+)$/, 'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/']]) {
    await page.route(re, async (r) => {
      try {
        const response = await r.fetch({ url: base + r.request().url().match(re)[1] });
        return r.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
      } catch {
        return r.abort();
      }
    });
  }
  await page.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
  await page.goto(APP, { waitUntil: 'networkidle' });
  page.setDefaultTimeout(1800000);
  return page;
}

(async () => {
  let page = await open();
  const ids = process.env.IDS ? process.env.IDS.split(',') : await page.evaluate(async () => (await import('/src/store/starters.ts')).STARTERS.map((s) => s.id));
  for (const id of ids) {
    // A fresh page per starter (the browser keeps the recordings it has downloaded), and up to
    // three tries: a download can fail, and then the browser starts again
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.close().catch(() => {});
        page = await open();
        let timer;
        const late = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT)));
        console.log(JSON.stringify(await Promise.race([page.evaluate(MEASURE, id), late]).finally(() => clearTimeout(timer))));
        break;
      } catch (e) {
        console.error(id, `try ${attempt} failed:`, String(e).slice(0, 300));
        await browser?.close().catch(() => {});
        browser = null;
      }
    }
  }
  await browser?.close();
})();
