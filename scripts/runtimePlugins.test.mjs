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
