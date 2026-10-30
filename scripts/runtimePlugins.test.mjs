// The plugins a song carries into the web runtime kit (src/audio/runtimePlugins.ts). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { songPlugins } = await import('../src/audio/runtimePlugins.ts');
const { PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalog.ts');

test("a song's plugin instruments and effects bring their families, once each", () => {
  const fledge = PLUGIN_FAMILIES.find((f) => f.family === 'fledge');
  const other = PLUGIN_FAMILIES.find((f) => f.family !== 'fledge');
  const fx = { id: 'e', url: `builtin:${other.family}/${other.plugins[0].name}`, name: other.plugins[0].name };
  const tracks = [
    { plugin: { id: 'a', url: 'builtin:fledge/Fledge Synth', name: 'Fledge Synth' } },
    { plugin: { id: 'b', url: 'builtin:fledge/Fledge Synth', name: 'Fledge Synth' }, pluginFx: [fx] },
    {},
  ];
  const { families, missing } = songPlugins(tracks, PLUGIN_FAMILIES);
  assert.deepEqual(families.map((f) => f.file).sort(), [fledge.file, other.file].sort());
  assert.deepEqual(missing, []);
});

test("a plugin the runtime hasn't is named, not left to play silent", () => {
  const { families, missing } = songPlugins([{ plugin: { id: 's', url: 'builtin:surge/Surge XT', name: 'Surge XT' } }], PLUGIN_FAMILIES);
  assert.deepEqual(families, []);
  assert.deepEqual(missing, ['Surge XT']);
});

test('a GPL plugin is told apart, and the patch it starts on goes in with it', async () => {
  const { GPL_PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalogGpl.ts');
  const all = [...PLUGIN_FAMILIES, ...GPL_PLUGIN_FAMILIES];
  const tracks = [
    { plugin: { id: 's', url: 'builtin:surge/Surge XT', name: 'Surge XT', state: { builtin: 1, preset: 'Basses/Bass 1' } } },
    { plugin: { id: 'f', url: 'builtin:fledge/Fledge Synth', name: 'Fledge Synth' }, pluginFx: [{ id: 'o', url: 'builtin:setbfree/Tonewheel Organ', name: 'Tonewheel Organ' }] },
  ];
  const r = songPlugins(tracks, all);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.gpl.map((f) => f.family).sort(), ['setbfree', 'surge']);
  assert.deepEqual(r.files.map((f) => [f.path, f.url]).sort(), [
    ['fledge.wasm', 'fledge.wasm'],
    ['gpl/setbfree.wasm', 'gpl/setbfree.wasm'],
    ['gpl/surge-patches/Basses/Bass 1.fxp', 'gpl/surge-patches/Basses/Bass%201.fxp'],
    ['gpl/surge.wasm', 'gpl/surge.wasm'],
  ]);
});

test('every preset file is there, under a plain file name a web server reads as it is', async () => {
  const { existsSync } = await import('node:fs');
  const { GPL_PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalogGpl.ts');
  const { presetFilePath } = await import('../src/audio/runtimePlugins.ts');
  let n = 0;
  for (const f of [...PLUGIN_FAMILIES, ...GPL_PLUGIN_FAMILIES])
    for (const p of f.plugins) {
      if (!p.presetFiles) continue;
      for (const name of p.presetFiles.names) {
        const { path, url } = presetFilePath(p.presetFiles, name);
        assert.ok(existsSync(new URL(`../public/fledgetone-plugins/${path}`, import.meta.url)), path);
        // (Only spaces escaped: what decodeURI and every static server give back as the file)
        assert.match(url, /^[A-Za-z0-9%._/-]+$/, url);
        assert.equal(decodeURI(url), path);
        n++;
      }
    }
  assert.ok(n > 600);
  const surge = GPL_PLUGIN_FAMILIES.find((f) => f.family === 'surge').plugins[0].presetFiles;
  // (Saved songs name the patch as shown: those keep finding it)
  assert.deepEqual(presetFilePath(surge, 'Splits/Bass+Drums'), { path: 'gpl/surge-patches/Splits/Bass and Drums.fxp', url: 'gpl/surge-patches/Splits/Bass%20and%20Drums.fxp' });
  assert.equal(presetFilePath(surge, 'Sequences/S&H Classic').url, 'gpl/surge-patches/Sequences/S%20and%20H%20Classic.fxp');
});
