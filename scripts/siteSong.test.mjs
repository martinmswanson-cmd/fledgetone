// The home page's songs section (site/index.html, #songs, .scored-song): each song as a video of the
// studio playing it, with the song's export as its sound (an exception to keeping audio out of the
// site, for this showcase), loaded as the films are; and its project to download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);
const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const home = src('site/index.html');
const card = home.match(/<figure class="scored scored-song">[\s\S]*?<\/figure>/)?.[0] ?? '';
const video = card.match(/<video[^>]* src="([^"]+)"/)?.[1];
const song = card.match(/<a class="scored-link" href="([^"]+)" download>/)?.[1];

test('the song card points at a project file the site has, and offers it to download', () => {
  assert.ok(song, 'the home page has a song card');
  assert.ok(existsSync(new URL(`../site${song}`, import.meta.url)), `site${song}`);
  assert.ok(home.includes(`<a class="scored-link" href="${song}" download>Download the project</a>`));
});

test("every instrument the song plays is one the player knows", async () => {
  const { INSTRUMENTS } = await import('../src/audio/instrumentCatalog.ts');
  const p = JSON.parse(src(`site${song}`));
  assert.equal(p.format, 'fledgetone-project');
  for (const t of p.tracks) assert.ok(INSTRUMENTS[t.instrumentKey], `${t.name}: ${t.instrumentKey}`);
  assert.ok(p.tracks.every((t) => !t.plugin), 'no plugins (the site player has none)');
});

test("the song's video is a reasonable size, and the site has no audio file of its own", () => {
  assert.ok(video, 'the song card has its video');
  const file = new URL(`../site${video}`, import.meta.url);
  assert.ok(existsSync(file), `site${video}`);
  assert.ok(statSync(file).size < 10 * 1024 * 1024, `${statSync(file).size} bytes`);
  const poster = card.match(/<video[^>]* poster="([^"]+)"/)?.[1];
  assert.ok(poster && existsSync(new URL(`../site${poster}`, import.meta.url)), 'its first frame shows before it loads');
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const root = new URL('../site', import.meta.url).pathname;
  const files = walk(root).filter((f) => /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|weba)$/i.test(f)).map((f) => f.slice(root.length));
  assert.deepEqual(files, []);
});

test('the song video loads as the films do, and its own button plays it', () => {
  const main = src('site/main.js');
  // Nothing before it's on screen: preload none, muted, inline (phones), played by the clips' observer
  assert.match(card, /<video[^>]*\bmuted loop playsinline preload="none" data-autoplay/);
  // The films' sound buttons leave it out; its own fades it through Web Audio
  assert.match(main, /document\.querySelectorAll\('\.scored:not\(\.scored-song\)'\)/);
  assert.match(main, /ctx\.createMediaElementSource\(video\)\.connect\(out\)/);
  // A song played with sound isn't paused or restarted by scrolling
  assert.match(main, /if \(v\.dataset\.held\) return;/);
  assert.ok(!existsSync(new URL('../src/runtime/sitePlayer.ts', import.meta.url)), 'the live player is gone');
});
