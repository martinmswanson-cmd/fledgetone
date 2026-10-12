// Render a chromatic scale over each instrument's whole range (one key a second) to scales/<key>.wav,
// and save which recordings each instrument has.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, process.env.DIR || 'scales'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.route(/tonejs\.github\.io\/audio\//, async (r) => { const m = r.request().url().match(/tonejs\.github\.io\/audio\/(.+)$/); const response = await r.fetch({ url: `https://raw.githubusercontent.com/Tonejs/audio/master/${m[1]}` }); return r.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } }); });
  await page.route(/gleitz\.github\.io/, async (r) => { const m = r.request().url().match(/midi-js-soundfonts\/(.+)$/); const response = await r.fetch({ url: `https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/${m[1]}` }); return r.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } }); });
  page.on('console', (m) => { if (m.type() === 'log' && m.text().startsWith('{')) { const d = JSON.parse(m.text()); fs.writeFileSync(path.join(OUT, d.file), Buffer.from(d.wav, 'base64')); } });
  await page.goto('http://localhost:5200/', { waitUntil: 'networkidle' });
  await page.getByText('START AUDIO').click(); await page.waitForTimeout(300);
  const meta = await page.evaluate(async (keys) => {
    const ex = await import('/src/audio/exportWav.ts'); const T = await import('/src/store/timelineTypes.ts');
    const { INSTRUMENTS } = await import('/src/audio/instrumentCatalog.ts');
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const meta = {};
    for (const key of keys) {
      const [lo, hi] = INSTRUMENTS[key].range;
      meta[key] = { lo, hi, samples: Object.keys(INSTRUMENTS[key].samples.samples), tune: INSTRUMENTS[key].samples.tune ?? {} };
      const notes = []; for (let m = lo; m <= hi; m++) notes.push({ id: 'n' + m, note: names[m % 12] + (Math.floor(m / 12) - 1), startOffset: (m - lo) * 0.5, duration: '4n', velocity: 0.8 });
      const bars = Math.ceil((hi - lo + 2) * 0.5);
      const track = { id: 't', name: key, color: '#fff', instrumentKey: key, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: T.defaultTrackFx(), reverbSend: 0, delaySend: 0 };
      const clip = { id: 'c', trackId: 't', name: 'c', startBar: 1, lengthBars: bars, notes, isSelected: false };
      try {
        const mix = await ex.renderArrangement({ tracks: [track], clips: [clip], bpm: 120, swing: 0, masterFx: T.DEFAULT_MASTER_FX, master: T.defaultMasterSettings(), startBar: 1, endBar: bars + 1, ending: 'exact', sampleRate: 44100, bypassMaster: true });
        const bytes = new Uint8Array(await new Blob([ex.encodeWav(mix, 16, [])]).arrayBuffer());
        let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        console.log(JSON.stringify({ file: `${key}.wav`, wav: btoa(bin) }));
      } catch (e) { meta[key].error = String(e); }
    }
    return meta;
  }, process.argv.slice(2));
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log('done', Object.keys(meta).length, Object.entries(meta).filter(([, v]) => v.error).map(([k]) => k));
  await browser.close();
})();
