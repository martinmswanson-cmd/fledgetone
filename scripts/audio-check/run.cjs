// Run a script inside the running dev app and save any audio it returns.
//
//   npm run dev -- --port 5200          (in another terminal; restart it after editing src/,
//                                        or the page may import stale module copies)
//   node scripts/audio-check/run.cjs scripts/audio-check/phrases.js '{"keys":["violin","cello"]}'
//
// lib.js is prepended to the script (mkTrack, mkClip, spectrum helpers, Tone). The script body
// runs in the page as an async function of `arg` and returns JSON. If the result has `wavs`
// ({name: dataUrl}) and OUT=dir is set, each is written to dir/name.wav.
// START=1 clicks START AUDIO first. APP_URL overrides http://localhost:5200/.
// SAMPLES_DIR=dir serves instrument samples from local copies (dir/<nb folder>/<file>.mp3 and
// dir/gm/<instrument>-mp3/<file>.mp3) instead of the network; files not found there are fetched
// (gleitz.github.io via its raw.githubusercontent.com mirror, for networks that block the site).
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const fs = require('fs');
const path = require('path');
(async () => {
  const lib = fs.readFileSync(path.join(__dirname, 'lib.js'), 'utf8');
  const script = lib + '\n' + fs.readFileSync(process.argv[2], 'utf8');
  const arg = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const samples = process.env.SAMPLES_DIR;
  await page.route(/gleitz\.github\.io|raw\.githubusercontent\.com/, async (r) => {
    const url = r.request().url();
    let local = null;
    let m = url.match(/FluidR3_GM\/(.+\.mp3)$/);
    if (m && samples) local = path.join(samples, 'gm', decodeURIComponent(m[1]));
    m = url.match(/tonejs-instruments\/master\/samples\/(.+\.mp3)$/);
    if (m && samples) local = path.join(samples, decodeURIComponent(m[1]));
    if (local && fs.existsSync(local)) return r.fulfill({ status: 200, contentType: 'audio/mpeg', body: fs.readFileSync(local), headers: { 'access-control-allow-origin': '*' } });
    // gleitz.github.io is the same files as the repository's gh-pages branch, which some networks reach when the site isn't
    m = url.match(/^https:\/\/gleitz\.github\.io\/midi-js-soundfonts\/(.+)$/);
    if (m) {
      const response = await r.fetch({ url: `https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/${m[1]}` });
      return r.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    }
    return r.continue();
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 300)); });
  await page.goto(process.env.APP_URL || 'http://localhost:5200/', { waitUntil: 'networkidle' });
  if (process.env.START) { try { await page.getByText('START AUDIO').click({ timeout: 3000 }); await page.waitForTimeout(500); } catch { console.log('no START AUDIO button'); } }
  const fn = new Function('arg', `return (async () => { ${script} })();`);
  try {
    const res = await page.evaluate(`(${fn.toString()})(${JSON.stringify(arg)})`);
    if (res && res.wavs && process.env.OUT) {
      fs.mkdirSync(process.env.OUT, { recursive: true });
      for (const [name, dataUrl] of Object.entries(res.wavs)) fs.writeFileSync(path.join(process.env.OUT, name + '.wav'), Buffer.from(dataUrl.split(',')[1], 'base64'));
      delete res.wavs;
    }
    console.log('RESULT', JSON.stringify(res, null, 1));
  } catch (e) { console.log('EVAL ERROR', e.message.slice(0, 1500)); }
  await browser.close();
})();
