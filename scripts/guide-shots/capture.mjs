// Take the guide's screenshots (shots.mjs) from the real studio, into site/guide/img/ as WebP, with
// their sizes in site/guide/img/sizes.json for the pages' width and height. Run it after a UI change:
//
//   npm run build:site                      # the studio under dist-site/app/
//   npx http-server dist-site -p 8765       # or any static server on that port
//   node scripts/guide-shots/capture.mjs [file ...]   # all shots, or just the named ones
//   node scripts/guide-shots/capture.mjs --learn [lesson ...]   # the Learn lessons' shots
//
// With --learn it takes the shots of learn/shots/<lesson>.mjs (all lessons, or the ones named, e.g.
// 01-tour) into site/learn/img/, with their sizes in <lesson>.sizes.json, and makes each lesson's
// EXAMPLES: it builds the example in the studio, opens File › Share and keeps the song's link in
// <lesson>.links.json (pointing at fledgetone.com). A shot with `phone: true` is taken in Pocket on a
// phone-sized screen.
//
// Needs Playwright with Chromium (it isn't a dependency: `npx playwright install chromium`, or set
// PLAYWRIGHT to where it's installed) and ffmpeg for the WebP. Recordings that can't download are
// muted from view (their red "!" is hidden), so the shots work offline too.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOTS } from './shots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LEARN = process.argv[2] === '--learn';
const LEARN_DIR = join(HERE, '..', '..', 'learn', 'shots');
const OUT = join(HERE, '..', '..', 'site', LEARN ? 'learn' : 'guide', 'img');
const URL_ = process.env.STUDIO_URL ?? 'http://localhost:8765/app/';
const TRAILER = join(HERE, 'trailer.webm'); // a 15-second film (made with Higgsfield) with three hard cuts
// Tall enough that the whole studio fits without scrolling: a full-page shot resizes the window,
// which closes open menus and popovers
const W = 1440, H = 1250, SCALE = 2;
const pw = await import(process.env.PLAYWRIGHT ?? 'playwright');
const { chromium } = pw.chromium ? pw : pw.default;

const only = process.argv.slice(LEARN ? 3 : 2);
mkdirSync(OUT, { recursive: true });
/** The sets of shots to take: the guide's, or each lesson's (with its examples). */
const sets = LEARN
  ? await Promise.all(
      readdirSync(LEARN_DIR)
        .filter((f) => f.endsWith('.mjs') && (!only.length || only.includes(f.replace(/\.mjs$/, ''))))
        .sort()
        .map(async (f) => {
          const m = await import(join(LEARN_DIR, f));
          const name = f.replace(/\.mjs$/, '');
          return { shots: m.SHOTS ?? [], examples: m.EXAMPLES ?? [], sizesFile: join(OUT, `${name}.sizes.json`), linksFile: join(OUT, `${name}.links.json`) };
        })
    )
  : [{ shots: SHOTS.filter((s) => s.setup && (!only.length || only.includes(s.file))), examples: [], sizesFile: join(OUT, 'sizes.json') }];
const PHONE = { viewport: { width: 412, height: 860 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

/** A page box in document pixels, from one element or several. */
async function boxOf(page, locators, pad = 0) {
  const boxes = [];
  for (const l of [].concat(locators)) {
    const b = await l.first().boundingBox();
    if (b) boxes.push(b);
  }
  if (!boxes.length) throw new Error('nothing to frame');
  const [sx, sy] = await page.evaluate(() => [scrollX, scrollY]);
  const x0 = Math.min(...boxes.map((b) => b.x)) - pad, y0 = Math.min(...boxes.map((b) => b.y)) - pad;
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad, y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  return { x: Math.max(0, x0 + sx), y: Math.max(0, y0 + sy), width: Math.min(W, x1) - Math.max(0, x0), height: y1 - Math.max(0, y0) };
}

/** The box of the nearest ancestor of a locator that is at least this big. */
async function around(page, locator, minW, minH) {
  const r = await locator.first().evaluate((el, [mw, mh]) => {
    let e = el;
    while (e.parentElement && (e.getBoundingClientRect().width < mw || e.getBoundingClientRect().height < mh)) e = e.parentElement;
    const b = e.getBoundingClientRect();
    return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height };
  }, [minW, minH]);
  return r;
}

function helpers(page) {
  const s = {
    page,
    wait: (ms) => page.waitForTimeout(ms),
    q: (sel) => page.locator(sel),
    title: (prefix) => page.locator(`[title^="${prefix.replace(/"/g, '\\"')}"]`),
    text: (t) => page.getByText(t, { exact: true }),
    /** An element by its own text, ignoring the controls inside it (e.g. the Tracks header) */
    own: (t) => page.locator(`xpath=//*[normalize-space(text())="${t}"]`),
    union: (ls, pad = 0) => boxOf(page, ls, pad),
    viewport: async () => ({ x: 0, y: 0, width: W, height: 900 }),
    /** The whole phone screen, for a Pocket shot */
    phoneScreen: async () => ({ x: 0, y: 0, width: PHONE.viewport.width, height: PHONE.viewport.height }),
    async starter(name) {
      await page.getByRole('menuitem', { name: 'File', exact: true }).click();
      await page.getByRole('menuitem', { name: /^New/ }).click();
      await page.getByPlaceholder(/starter/i).fill(name);
      await page.locator('[role=dialog] button', { hasText: name }).first().click();
      await page.waitForTimeout(2500);
      await page.mouse.move(W / 2, 4);
    },
    async zoomOut(n) { for (let i = 0; i < n; i++) await page.getByTitle(/^Zoom out/).first().click(); await page.waitForTimeout(300); },
    async menu(name, item) {
      await page.getByRole('menuitem', { name, exact: true }).click();
      await page.waitForTimeout(250);
      if (item) {
        const name = typeof item === 'string' ? new RegExp(`^${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : item;
        const it = page.locator('[role=menu] [role^=menuitem]').filter({ hasText: name }).first();
        // A ticked View item is already showing: clicking it again would hide it
        if ((await it.getAttribute('aria-checked')) === 'true') await page.keyboard.press('Escape');
        else await it.click();
        await page.waitForTimeout(600);
      }
    },
    view: (item) => s.menu('View', item),
    async tab(name) { await page.locator('button', { hasText: new RegExp(`^\\s*${name}\\s*$`) }).last().click(); await page.waitForTimeout(600); },
    async loadVideo() {
      await s.view('Video');
      await page.locator('input[type=file][accept*="video"]').first().setInputFiles(TRAILER);
      await page.waitForTimeout(2500);
    },
    async findCuts() {
      await page.getByLabel('Find cuts in the video').first().click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Stop looking for cuts"]'), null, { timeout: 120000, polling: 250 });
      await page.waitForTimeout(4500); // the toast goes
      await page.evaluate(() => document.querySelectorAll('*').forEach((e) => { if (e.scrollLeft > 0) e.scrollLeft = 0; }));
    },
    /** File › New › Blank timeline (four empty tracks) */
    async blank() {
      await page.getByRole('menuitem', { name: 'File', exact: true }).click();
      await page.getByRole('menuitem', { name: /^New/ }).click();
      await page.locator('[role=dialog] button', { hasText: 'Blank timeline' }).first().click();
      await page.waitForTimeout(1200);
    },
    async openClip(name) { await page.getByText(name, { exact: true }).first().dblclick(); await page.waitForTimeout(1200); },
    dialog: () => boxOf(page, page.locator('[role=dialog]').last(), 0),
    async popover() {
      const l = page.locator('[role=dialog], [role=menu], [role=listbox], [data-popover]').last();
      if (await l.count()) return boxOf(page, l, 8);
      return { x: 0, y: 0, width: W, height: 420 };
    },
    async timeline() {
      return boxOf(page, [s.own('Tracks'), s.own('Overview'), page.getByTitle(/^Zoom in/)], 14);
    },
    async ruler() {
      const left = await boxOf(page, s.own('Tracks'));
      const top = await boxOf(page, page.locator('[title^="The song\'s tempo"]'));
      // The start of the ruler and the first track under it, short enough to read on the page
      return { x: Math.max(0, left.x - 18), y: top.y - 6, width: 820, height: left.y + left.height - top.y + 70 };
    },
    panel: () => around(page, page.locator('button[title^="Sound effects maker: UI"]'), 1000, 220),
    pianoRoll: () => around(page, s.own('NEW NOTE'), 1000, 260),
    /** The panel docked on the right of the timeline (the Inspector, the Synth Designer) */
    async inspector() {
      return page.evaluate(([w, h]) => {
        const all = [...document.querySelectorAll('body *')].map((e) => [e, e.getBoundingClientRect()])
          .filter(([, r]) => r.x > w * 0.55 && r.width >= 260 && r.width <= 560 && r.height >= 500 && r.bottom <= h && r.top > 120);
        all.sort((a, b) => b[1].height - a[1].height || a[1].width - b[1].width);
        const r = all[0][1];
        return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 };
      }, [W, H]);
    },
  };
  return s;
}

/** A context and a page with the studio open (or Pocket, on a phone-sized screen). */
async function open(phone) {
  const ctx = await browser.newContext(phone ? PHONE : { viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('bosBeatbox.welcomeSeen', 'true');
    localStorage.setItem('fledgetone.pocketNoticeHidden', '1');
  });
  await page.route(/github\.io|githubusercontent/, (r) => r.abort());
  await page.goto(phone ? `${URL_}?pocket` : `${URL_}?studio`, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: 'button.rounded-full.bg-red-500{display:none!important} *{caret-color:transparent!important}' });
  return { ctx, page };
}

for (const set of sets) {
  const sizes = existsSync(set.sizesFile) ? JSON.parse(readFileSync(set.sizesFile, 'utf8')) : {};
  for (const shot of set.shots) {
    const { ctx, page } = await open(shot.phone);
    try {
      const vw = shot.phone ? PHONE.viewport.width : W;
      const scale = shot.phone ? PHONE.deviceScaleFactor : SCALE;
      const clip = await shot.setup(helpers(page));
      clip.width = Math.round(Math.min(clip.width, vw - clip.x)); clip.height = Math.round(clip.height);
      clip.x = Math.round(clip.x); clip.y = Math.round(clip.y);
      const png = join(OUT, `${shot.file}.png`);
      // Past the bottom of the window (a big song pushes the bottom panel down): the whole page
      const vh = shot.phone ? PHONE.viewport.height : H;
      await page.screenshot({ path: png, clip, fullPage: clip.y + clip.height > vh });
      const webp = join(OUT, `${shot.file}.webp`);
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-vf', "scale='min(1600,iw)':-2:flags=lanczos", '-c:v', 'libwebp', '-quality', '82', webp]);
      rmSync(png);
      // Phone shots are kept as if taken at twice the size, like the others, so the page shows them phone-sized
      const w = Math.min(1600, Math.round(clip.width * scale));
      const h = Math.round((clip.height * scale * w) / (clip.width * scale));
      sizes[shot.file] = shot.phone ? [clip.width * 2, clip.height * 2] : [w, h];
      console.log(`${shot.file}: ${clip.width}x${clip.height}`);
    } catch (e) {
      console.error(`${shot.file}: ${e.message.split('\n')[0]}`);
    }
    await ctx.close();
  }
  writeFileSync(set.sizesFile, `${JSON.stringify(sizes, null, 2)}\n`);
  if (!set.examples.length) continue;
  const links = existsSync(set.linksFile) ? JSON.parse(readFileSync(set.linksFile, 'utf8')) : {};
  for (const ex of set.examples) {
    const { ctx, page } = await open(false);
    try {
      const s = helpers(page);
      await ex.setup(s);
      await s.menu('File', 'Share');
      const field = page.getByLabel('Song link');
      await field.waitFor({ timeout: 20000 });
      const url = (await field.inputValue()).replace(/^https?:\/\/[^#]*/, 'https://fledgetone.com/app/');
      links[ex.name] = { url, ...(ex.label ? { label: ex.label } : {}) };
      console.log(`example ${ex.name}: ${url.length} characters`);
    } catch (e) {
      console.error(`example ${ex.name}: ${e.message.split('\n')[0]}`);
    }
    await ctx.close();
  }
  writeFileSync(set.linksFile, `${JSON.stringify(links, null, 2)}\n`);
}
await browser.close();
