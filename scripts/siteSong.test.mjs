// The home page's song (site/index.html, .scored-song): its export as one small MP3, the only audio
// file on the site (an exception made for this showcase), fetched only when Play is pressed; and
// its project to download.
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
const audio = home.match(/<figure class="scored scored-song" data-audio="([^"]+)"/)?.[1];
const song = home.match(/<figure class="scored scored-song"[\s\S]*?<a class="scored-link" href="([^"]+)" download>/)?.[1];

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

test("the song's MP3 is small, and the only audio file on the site", () => {
  assert.ok(audio, 'the song card names its MP3');
  const file = new URL(`../site${audio}`, import.meta.url);
  assert.ok(existsSync(file), `site${audio}`);
  assert.ok(statSync(file).size < 3 * 1024 * 1024, `${statSync(file).size} bytes`);
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const root = new URL('../site', import.meta.url).pathname;
  const files = walk(root).filter((f) => /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|weba)$/i.test(f)).map((f) => f.slice(root.length));
  assert.deepEqual(files, [audio]);
});

test('nothing of the song loads before Play', () => {
  const main = src('site/main.js');
  assert.ok(!/<audio/.test(home), 'no audio element in the page');
  assert.match(main, /audio\.preload = 'none';/);
  // The address is given only inside play(), which only the button's press calls
  const set = main.indexOf('audio.src = url;');
  assert.ok(set > main.indexOf('const play = () => {') && set < main.indexOf('const pause = () => {'));
  assert.ok(!existsSync(new URL('../src/runtime/sitePlayer.ts', import.meta.url)), 'the live player is gone');
});
