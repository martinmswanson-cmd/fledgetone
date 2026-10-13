// Unit tests for plugins in project files (src/store/project.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
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
const { serializeProject, parseProject } = await import('../src/store/project.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');

test('built-in and web plugins survive saving and opening a project', () => {
  const p = { name: 'Plugins', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [], clips: [] };
  const track = {
    id: 'plug',
    name: 'Organ',
    color: '#fff',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: 0,
    pan: 0,
    eq: { low: 0, mid: 0, high: 0 },
    fx: defaultTrackFx(),
    reverbSend: 0,
    delaySend: 0,
    instrumentKey: 'plugin',
    plugin: { id: 'p1', url: 'builtin:setbfree/Tonewheel Organ', name: 'Tonewheel Organ', state: { builtin: 1, program: 5, values: [0.5] } },
    pluginFx: [
      { id: 'p2', url: 'builtin:plateau/Plateau', name: 'Plateau', bypass: true },
      { id: 'p3', url: 'https://example.com/wam/index.js', name: 'Web' },
      { id: 'p4', url: 'javascript:alert(1)', name: 'Bad' },
    ],
  };
  const back = parseProject(JSON.parse(JSON.stringify(serializeProject({ ...p, tracks: [...p.tracks, track], sounds: [] }))));
  const t = back.tracks.find((x) => x.id === 'plug');
  assert.deepEqual(t.plugin, track.plugin);
  assert.deepEqual(t.pluginFx.map((f) => f.url), ['builtin:plateau/Plateau', 'https://example.com/wam/index.js']);
  assert.equal(t.pluginFx[0].bypass, true);
});
