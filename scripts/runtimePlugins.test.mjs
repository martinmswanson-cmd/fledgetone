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
