// The home page's song (site/index.html, .scored-song): it plays from its project file through the
// site player (src/runtime/sitePlayer.ts), so the site carries no audio file of it, and the player
// is fetched only when Play is pressed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
const song = home.match(/<figure class="scored scored-song" data-song="([^"]+)"/)?.[1];

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

test('the site has no audio file: the song is made in the browser', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const audio = walk(new URL('../site', import.meta.url).pathname).filter((f) => /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i.test(f));
  assert.deepEqual(audio, []);
});

test('the player is fetched only when Play is pressed, and the site build copies it', () => {
  const main = src('site/main.js');
  const click = main.indexOf("btn.addEventListener('click', async () => {");
  const load = main.indexOf("import('/player/fledgetone-site-player.js')");
  assert.ok(click > 0 && load > click, 'the import is inside the click');
  assert.equal(main.split("import('/player/").length, 2, 'loaded from one place only');
  assert.ok(!home.includes('fledgetone-site-player'), 'the page itself never names the player');
  assert.match(src('scripts/build-site.mjs'), /dist-runtime', 'fledgetone-site-player\.js'\), join\(OUT, 'player', 'fledgetone-site-player\.js'\)/);
  assert.match(src('package.json'), /vite build -c vite\.site\.config\.ts/);
});
