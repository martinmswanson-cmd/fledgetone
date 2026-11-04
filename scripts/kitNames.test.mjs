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

const { kitFileName, notReserved, uniqueKitNames } = await import('../src/store/kitNames.ts');
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
