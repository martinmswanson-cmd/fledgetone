// The Tools page (scripts/tools-site.mjs): its zip writer, its README pages, the page itself, the
// synth's description read from fledge.wasm, and the link to it in every page's footer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { crc32, fill, formatSize, HEADER, LICENCE, makeZip, markdownToHtml, notice, readSynth, toolsPage, TOOLS, gameMusicPlayers, instrumentLines, pigeonKeys } from './tools-site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The files in a zip, read back from its central directory. */
function unzip(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(start, start + packed);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, size, name);
    assert.equal(crc32(data), crc, name);
    files[name] = { data, method, mode: zip.readUInt32LE(at + 38) >>> 16 };
    at += 46 + nameLen;
  }
  return files;
}

test('tools: CRC-32 is the zip one', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('tools: a zip reads back as the files that went in, compressed where that helps', () => {
  const text = 'la '.repeat(2000);
  const random = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 7919) % 251));
  const zip = makeZip([
    { name: 'a/README.md', data: text },
    { name: 'a/x.bin', data: random },
    { name: 'a/build.sh', data: '#!/bin/sh\n', executable: true },
    { name: 'a/naïve.txt', data: 'é' },
  ]);
  const files = unzip(zip);
  assert.deepEqual(Object.keys(files), ['a/README.md', 'a/x.bin', 'a/build.sh', 'a/naïve.txt']);
  assert.equal(files['a/README.md'].data.toString(), text);
  assert.equal(files['a/README.md'].method, 8);
  assert.deepEqual(files['a/x.bin'].data, random);
  assert.equal(files['a/build.sh'].mode & 0o777, 0o755);
  assert.equal(files['a/naïve.txt'].data.toString(), 'é');
  // The same files make the same zip
  assert.deepEqual(makeZip([{ name: 'f', data: 'x' }], new Date(2026, 9, 21)), makeZip([{ name: 'f', data: 'x' }], new Date(2026, 9, 21)));
  assert.throws(() => makeZip([{ name: 'f', data: 'x' }, { name: 'f', data: 'y' }]), /twice/);
});

test('tools: sizes in words', () => {
  assert.equal(formatSize(840), '840 bytes');
  assert.equal(formatSize(44373), '44 KB');
  assert.equal(formatSize(1166165), '1.2 MB');
});

test('tools: every README has the header, the licence in plain words, and nothing left to fill', () => {
  for (const t of TOOLS) {
    const template = readFileSync(join(ROOT, 'tools', t.id, 'README.md'), 'utf8');
    assert.match(template, /\{\{HEADER\}\}/, t.id);
    assert.match(template, /\{\{LICENCE\}\}/, t.id);
  }
  assert.match(HEADER, /Part of Fledgetone \(https:\/\/fledgetone\.com\), © Martin Swanson, MIT licence/);
  assert.match(HEADER, /github\.com\/martinmswanson-cmd\/fledgetone/);
  assert.match(LICENCE, /free to use, change and share/i);
  assert.match(LICENCE, /under the MIT licence/);
  assert.match(LICENCE, /In any program, open or closed/);
  assert.doesNotMatch(LICENCE, /must release/);
  assert.match(notice('X'), /under the MIT licence/);
  assert.doesNotMatch(notice('X'), /General Public/);
  assert.equal(fill('a {{HEADER}} b {{X}}', { X: 'x' }), `a ${HEADER} b x`);
  assert.throws(() => fill('{{NOPE}}', {}), /NOPE/);
});

test('tools: a README as a page', () => {
  const md = '# Title\n\nSome `code` and **bold**, see https://fledgetone.com/guide/.\n\n## Use it\n\n```js\nconst a = 1 < 2;\n```\n\n| A | B |\n| --- | --- |\n| `x|y` | 2 |\n\n- one\n  more\n- two\n\n### Deeper\n\n1. first';
  const { title, html, headings } = markdownToHtml(md);
  assert.equal(title, 'Title');
  assert.deepEqual(headings, [{ id: 'use-it', title: 'Use it' }]);
  assert.match(html, /<code>code<\/code> and <strong>bold<\/strong>/);
  assert.match(html, /<a href="https:\/\/fledgetone\.com\/guide\/" rel="noopener">https:\/\/fledgetone\.com\/guide\/<\/a>\.<\/p>/);
  assert.match(html, /<pre class="code"><code>const a = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(html, /<td><code>x\|y<\/code><\/td><td>2<\/td>/);
  assert.match(html, /<ul><li>one more<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<h4 id="deeper">/);
  assert.match(html, /<ol><li>first<\/li><\/ol>/);
});

test('tools: the page has a card per tool with its download, size, README and licence', () => {
  const zips = Object.fromEntries(TOOLS.map((t, i) => [t.id, { file: `fledgetone-${t.id}.zip`, size: 1000 * (i + 2) }]));
  const page = toolsPage(TOOLS, zips);
  for (const [i, t] of TOOLS.entries()) {
    assert.match(page, new RegExp(`href="/tools/fledgetone-${t.id}\\.zip" download`));
    assert.match(page, new RegExp(`href="/tools/${t.id}/"`));
    assert.ok(page.includes(`<span>${formatSize(1000 * (i + 2))}</span>`));
  }
  assert.equal(page.split('<span>MIT</span>').length - 1, TOOLS.length - 1);
  assert.equal(page.split('<span>GPL-3.0-or-later</span>').length - 1, 1, 'the song player keeps the GPL');
  assert.equal(TOOLS.find((t) => t.licence)?.id, 'song-player');
  assert.match(page, /href="\/tools\/LICENSE-GPL\.txt"/);
  assert.match(page, /changed file stays under the GPL/);
  assert.match(page, /In any program, open or closed/);
  assert.match(page, /href="\/tools\/LICENSE\.txt"/);
  assert.match(page, /<link rel="stylesheet" href="\/styles\.css" \/>/);
  assert.match(page, /<a href="\/tools\/">Tools<\/a>/);
});

test('tools: Fledge Synth\'s parameters and presets come from fledge.wasm, and it plays', () => {
  const s = readSynth(readFileSync(join(ROOT, 'public/fledgetone-plugins/fledge.wasm')));
  assert.ok(s.params.length >= 200);
  assert.equal(s.params[0].name, 'A on');
  assert.ok(s.params.some((p) => p.name === 'Cutoff' && /kHz|Hz/.test(p.text)));
  assert.ok(s.presets.includes('Bass/Wobble'));
  assert.ok(s.finite);
  assert.ok(s.peak > 0.001 && s.peak < 1, `peak ${s.peak}`);
});

test('tools: every Fledge effect is in the effects package, described from its own .wasm, and passes sound', async () => {
  const { FLEDGE_EFFECTS, readEffect } = await import('./tools-site.mjs');
  const { PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalog.ts');
  // Every one of Fledgetone's own effect families in the studio is offered here too (a new one
  // must be added to FLEDGE_EFFECTS in tools-site.mjs and EFFECTS in tools/fledge-effects/fledge-effects.js)
  const own = PLUGIN_FAMILIES.filter((f) => f.family.startsWith('fledge-')).map((f) => f.file).sort();
  assert.deepEqual(Object.values(FLEDGE_EFFECTS).sort(), own);
  const wrapper = readFileSync(join(ROOT, 'tools/fledge-effects/fledge-effects.js'), 'utf8');
  const names = [];
  for (const [kind, file] of Object.entries(FLEDGE_EFFECTS)) {
    assert.ok(wrapper.includes(`${kind}: '${file}'`), `${kind} is in the wrapper's EFFECTS`);
    const e = readEffect(readFileSync(join(ROOT, 'public/fledgetone-plugins', file)));
    names.push(e.info.name);
    assert.ok(e.info.about.length > 40 && !e.info.instrument, file);
    assert.ok(e.params.length >= 5 && e.params.every((p) => p.name && p.text && p.value >= 0 && p.value <= 1), file);
    assert.ok(e.presets.length >= 5, file);
    assert.ok(e.finite && e.peak < 4, `${file}: peak ${e.peak}`);
  }
  assert.deepEqual(names, ['Fledge Compressor', 'Fledge Gate', 'Fledge Vocoder', 'Fledge Repeat', 'Fledge Harmony', 'Fledge Shifter', 'Fledge Spectral', 'Fledge Smooth', 'Fledge Carve', 'Fledge Dynamic EQ', 'Fledge Heat', 'Fledge Shape']);
  // The three that listen to a sidechain say so, and the beat repeat says it follows the song
  const say = (file) => readEffect(readFileSync(join(ROOT, 'public/fledgetone-plugins', file))).info;
  for (const kind of ['compressor', 'gate', 'vocoder', 'carve']) assert.equal(say(FLEDGE_EFFECTS[kind]).sidechain, true, kind);
  assert.equal(say(FLEDGE_EFFECTS.repeat).transport, true);
  assert.equal(say(FLEDGE_EFFECTS.shape).transport, true);
  assert.ok(!say(FLEDGE_EFFECTS.shifter).sidechain && !say(FLEDGE_EFFECTS.shifter).transport);
});

test('tools: the effects\' worklet processor runs an effect, hears its sidechain only when told to, and follows the song', () => {
  const src = readFileSync(join(ROOT, 'tools/fledge-effects/fledge-effects-processor.js'), 'utf8');
  const sr = 48000;
  const scope = { frame: 0 };
  let Proc;
  const sent = [];
  new Function('scope', 'sampleRate', 'AudioWorkletProcessor', 'registerProcessor', src.replace(/\bcurrentFrame\b/g, 'scope.frame'))(scope, sr, class { constructor() { this.port = { postMessage: (m) => sent.push(m) }; } }, (_, c) => (Proc = c));
  const make = (file, opts = {}) => {
    sent.length = 0;
    const p = new Proc({ processorOptions: { module: new WebAssembly.Module(readFileSync(join(ROOT, 'public/fledgetone-plugins', file))), ...opts } });
    const ready = sent.find((m) => m.type === 'ready');
    assert.ok(ready, `${file} started: ${JSON.stringify(sent)}`);
    return { p, ready };
  };
  const tone = (hz, amp) => Float32Array.from({ length: 128 }, (_, k) => amp * Math.sin((2 * Math.PI * hz * (scope.frame + k)) / sr));
  /** A quiet tone through it for `seconds`, a loud low one on the second input; the gain over the last tenth, dB */
  const gain = (p, seconds) => {
    let [inE, outE] = [0, 0];
    const blocks = Math.round((seconds * sr) / 128);
    for (let b = 0; b < blocks; b++) {
      const [x, k] = [tone(1000, 0.01), tone(60, 0.5)];
      const out = [new Float32Array(128), new Float32Array(128)];
      p.process([[x], [k, k]], [out]);
      assert.ok(out[0].every(Number.isFinite));
      assert.deepEqual(out[0], out[1], 'a one-channel sound goes to both sides');
      if (b >= blocks - 38) for (let i = 0; i < 128; i++) (inE += x[i] * x[i]), (outE += out[0][i] * out[0][i]);
      scope.frame += 128;
    }
    return 10 * Math.log10(outE / inE);
  };
  const { p, ready } = make('fledge-compressor.wasm', { preset: 1 });
  assert.equal(ready.info.name, 'Fledge Compressor');
  assert.equal(ready.info.sidechain, true);
  assert.equal(ready.presets[ready.preset], 'Duck under the kick');
  assert.equal(ready.params[0].name, 'Threshold');
  // Not told of a sidechain: what's on the second input is not listened to
  assert.ok(Math.abs(gain(p, 0.5)) < 0.05);
  p.port.onmessage({ data: { type: 'sidechain', connected: true } });
  assert.ok(gain(p, 1) < -6);
  p.port.onmessage({ data: { type: 'sidechain', connected: false } });
  assert.ok(Math.abs(gain(p, 2)) < 0.05);
  // A parameter set at a time, a preset chosen, and what it then shows
  p.port.onmessage({ data: { type: 'set', index: 0, value: 1, time: scope.frame / sr } });
  gain(p, 0.1);
  p.port.onmessage({ data: { type: 'describe', id: 7 } });
  assert.equal(sent.find((m) => m.id === 7).params[0].text, '0.0 dB');
  p.port.onmessage({ data: { type: 'preset', index: 0, id: 8 } });
  assert.equal(sent.find((m) => m.id === 8).preset, 0);
  p.port.onmessage({ data: { type: 'destroy' } });
  assert.equal(p.process([[]], [[new Float32Array(128), new Float32Array(128)]]), false);

  // The beat repeat, told where the song is on each beat, fills each bar's last beat (and no other)
  scope.frame = 0;
  const repeat = make('fledge-repeat.wasm', { tempo: 117.1875 }).p;
  assert.equal(sent.find((m) => m.type === 'ready').info.transport, true);
  repeat.port.onmessage({ data: { type: 'set', index: 1, value: 0.3, time: 0 } });
  const changed = [];
  for (let beat = 0; beat < 8; beat++) {
    repeat.port.onmessage({ data: { type: 'position', beats: beat, time: scope.frame / sr } });
    let differs = false;
    // (A beat of 192 blocks at this tempo)
    for (let b = 0; b < 192; b++) {
      const x = Float32Array.from({ length: 128 }, (_, k) => 0.3 * Math.sin((scope.frame + k) * 0.01) + 0.2 * ((((scope.frame + k) % 977) / 977) - 0.5));
      const out = [new Float32Array(128), new Float32Array(128)];
      repeat.process([[x, x], []], [out]);
      for (let i = 0; i < 128; i++) if (Math.abs(out[0][i] - x[i]) > 1e-5) differs = true;
      scope.frame += 128;
    }
    if (differs) changed.push(beat + 1);
  }
  assert.deepEqual(changed, [4, 8]);
});

test('tools: every page of the site links to the Tools page in its footer, and its zips download', async () => {
  for (const page of ['site/index.html', 'site/games/index.html', 'site/creators/index.html', 'site/scoring/index.html', 'site/404.html']) {
    const html = readFileSync(join(ROOT, page), 'utf8');
    const footer = html.slice(html.indexOf('<footer'));
    assert.match(footer, /<a href="\/tools\/">Tools<\/a>/, page);
  }
  const { foot } = await import('./guide-site.mjs');
  assert.match(foot, /<a href="\/tools\/">Tools<\/a>/);
  const { siteHeaders } = await import('./site-headers.mjs');
  const out = siteHeaders('');
  // (Each zip by name: the host matches a * only at the end of an address)
  for (const name of ['game-music-players', 'fledge-synth', 'fledge-effects', 'drop-effects', 'instrument-lines', 'pigeon-keys', 'song-player'])
    assert.match(out, new RegExp(`/tools/fledgetone-${name}\\.zip\\n {2}Content-Type: application/zip\\n {2}Content-Disposition: attachment`));
  assert.doesNotMatch(out, /\/tools\/\*/);
});

test('tools: the Godot example scene finds its scripts wherever its folder is copied', async () => {
  const { files } = await gameMusicPlayers();
  const scene = files.find((f) => f.name === 'godot/music_example.tscn');
  const paths = [...String(scene.data).matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(paths.length, 2);
  for (const p of paths) {
    assert.ok(!p.includes('://'), `${p} is relative to the scene`);
    assert.ok(files.some((f) => f.name === `godot/${p}`), `godot/${p} is in the zip`);
  }
});

test('tools: the instrument lines bundle draws a song with the helper, with no library inside', async () => {
  const { files } = await instrumentLines();
  assert.deepEqual(files.map((f) => f.name), ['instrument-lines.js', 'lines-draw.js', 'lines.ts', 'linesDraw.ts', 'index.html']);
  const text = (name) => files.find((f) => f.name === name).data.toString();
  assert.doesNotMatch(text('lines-draw.js'), /^import /m);
  // The helper, with its import pointed at the bundle
  const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const helper = await import(url(text('instrument-lines.js').replace("'./lines-draw.js'", JSON.stringify(url(text('lines-draw.js'))))));
  // A canvas that counts what's drawn on it
  let strokes = 0;
  const texts = [];
  const gradient = { addColorStop() {} };
  const g = new Proxy({}, {
    get: (_, key) => (key === 'stroke' ? () => strokes++ : key === 'fillText' ? (t) => texts.push(t) : key === 'measureText' ? () => ({ width: 10 }) : /^create.*Gradient$/.test(key) ? () => gradient : () => {}),
    set: () => true,
  });
  const canvas = { width: 1920, height: 1080, getContext: () => g };
  const lines = helper.createLines(canvas, {
    tracks: ['Bass', 'Lead'],
    notes: [{ track: 0, start: 0, end: 2, pitch: 45 }, { track: 1, start: 1, end: 3, pitch: 72 }, { track: 0, start: 0, end: 0.1, pitch: 36, kick: true }, { track: 1, start: 'x', pitch: 60 }],
    sections: [{ at: 0, name: 'Intro' }],
    chords: [{ at: 0, end: 4, name: 'Am' }],
  });
  assert.equal(lines.duration, 3);
  assert.deepEqual(lines.data.tracks.map((t) => t.name), ['Bass', 'Lead']);
  assert.deepEqual(lines.data.hits, [{ t: 0, kick: true }]);
  lines.draw(1.5);
  assert.ok(strokes >= 6, `strokes: ${strokes}`);
  for (const word of ['Bass', 'Lead', 'Drums', 'Am', 'INTRO']) assert.ok(texts.includes(word), word);
  // Extras left out aren't drawn; an empty song still draws
  texts.length = 0;
  lines.set({ look: { chord: false, drums: false }, section: false });
  lines.draw(1.5);
  assert.deepEqual(texts.sort(), ['Bass', 'Lead']);
  helper.createLines(canvas, { notes: [] }).draw(0);
});

test('tools: the pigeons bundle is one module with three.js inside and its licence beside it, and plans a song', async () => {
  const { files, readme, notice } = await pigeonKeys();
  assert.deepEqual(files.map((f) => f.name), ['pigeon-keys.js', 'pigeon-scene.js', 'pigeonScene.ts', 'index.html', 'THIRD-PARTY-LICENSES.txt']);
  const text = (name) => files.find((f) => f.name === name).data.toString();
  // Nothing left to fetch: the library is inside, and says so, with its licence's text
  assert.doesNotMatch(text('pigeon-scene.js'), /^import /m);
  assert.doesNotMatch(text('pigeon-scene.js'), /from\s*["']three["']/);
  assert.match(text('THIRD-PARTY-LICENSES.txt'), /^three \d+\.\d+\.\d+ \(MIT\)/m);
  assert.match(text('THIRD-PARTY-LICENSES.txt'), /Permission is hereby granted, free of charge/);
  assert.match(notice, /three \d+\.\d+\.\d+ \(MIT\)/);
  assert.match(readme, /\| three \| \d+\.\d+\.\d+ \| MIT \|/);
  assert.doesNotMatch(readme, /\{\{/);
  // The helper imports only what the bundle exports, and the example only what the helper does
  const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  const scene = await import(url(text('pigeon-scene.js')));
  const wanted = /import \{([^}]+)\} from '\.\/pigeon-scene\.js'/.exec(text('pigeon-keys.js'))[1].split(',').map((n) => n.trim());
  for (const name of wanted) assert.ok(name in scene, `pigeon-scene.js exports ${name}`);
  assert.match(text('pigeon-keys.js'), /export function createPigeons\(/);
  assert.match(text('index.html'), /import \{ createPigeons, PIGEON_BACKGROUNDS, PIGEON_CAMERAS, everyBars \} from '\.\/pigeon-keys\.js'/);
  // The parts that need no canvas work from the bundle as shipped: a chord's three birds, apart
  const note = (start, end, midi) => ({ start, end, midi, track: 0, color: '#888', drum: false });
  const plan = scene.planPigeons({ notes: [note(1, 3, 60), note(1, 3, 61), note(1, 3, 62)], tracks: [], bars: [] });
  const posed = scene.posedAt(plan, 2);
  assert.equal(posed.filter((b) => b.leg.kind === 'press').length, 3);
  for (let i = 0; i < posed.length; i++) for (let j = i + 1; j < posed.length; j++) assert.ok(scene.overlapOf(posed[i], posed[j]).depth < 0.019);
  // Every background and camera angle is in the README, by its id, and the example fills its menus from the lists
  for (const x of [...scene.PIGEON_BACKGROUNDS, ...scene.PIGEON_CAMERAS]) assert.ok(readme.includes(`\`'${x.id}'\``), `the README lists ${x.id}`);
  assert.deepEqual(scene.everyBars([0, 2, 4, 6, 8], 2), [4, 8]);
  // The helper passes on the kicks and bar lines the backgrounds move to, and how much they move
  for (const word of ['kick: true', 'song.bars', 'motion: options.motion']) assert.ok(text('pigeon-keys.js').includes(word), word);
  for (const word of ['`motion`', '`bars`', 'kick']) assert.ok(readme.includes(word), `the README says ${word}`);
  // The example's script is sound JavaScript (a name declared twice, say, would stop the page)
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(text('index.html'))[1];
  const { SourceTextModule } = await import('node:vm').catch(() => ({}));
  if (SourceTextModule) new SourceTextModule(script);
  else assert.doesNotThrow(() => new Function(script.replace(/^\s*import .*$/m, 'const { createPigeons, PIGEON_BACKGROUNDS, PIGEON_CAMERAS, everyBars } = {};')));
  // The helper's documented calls are the ones it returns
  for (const call of ['draw(time)', 'onKeys(time)', 'setLook(changes)', 'isDark(time)', 'setFloor(color)', 'dispose()']) {
    assert.ok(readme.includes(`\`${call}\``), `the README documents ${call}`);
    assert.match(text('pigeon-keys.js'), new RegExp(`\\b${call.replace(/\(.*/, '')}\\(`));
  }
});
