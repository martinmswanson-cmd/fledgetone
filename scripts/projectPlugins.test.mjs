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
const { defaultTrackFx, defaultMasterSettings, LEVEL_MAX } = await import('../src/store/timelineTypes.ts');

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

test('a recorded room for the master reverb survives saving and opening, and is kept with the sounds', async () => {
  const { referencedSoundIds } = await import('../src/store/audioClips.ts');
  const masterFx = { reverbDecay: 3, delayTime: '8n', delayFeedback: 0.3, room: 'hall-sound' };
  const p = { name: 'Room', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [], clips: [], masterFx };
  const back = parseProject(JSON.parse(JSON.stringify(serializeProject(p))));
  assert.equal(back.masterFx.room, 'hall-sound');
  assert.deepEqual(referencedSoundIds(back), ['hall-sound']);
  const plain = parseProject(JSON.parse(JSON.stringify(serializeProject({ ...p, masterFx: { ...masterFx, room: "" } }))));
  assert.equal(plain.masterFx.room, undefined);
});

test('the master Level survives saving and opening; files without one open at 0 dB', () => {
  const p = { name: 'Level', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [], clips: [], masterFx: { reverbDecay: 2, delayTime: '8n', delayFeedback: 0.3 } };
  const loud = parseProject(JSON.parse(JSON.stringify(serializeProject({ ...p, master: { ...defaultMasterSettings(), level: 3.5 } }))));
  assert.equal(loud.master.level, 3.5);
  // At 0 dB a file doesn't carry it, and one without it (an older file) opens at 0
  const file = serializeProject({ ...p, master: defaultMasterSettings() });
  assert.equal('level' in file.master, false);
  assert.equal(parseProject(JSON.parse(JSON.stringify(file))).master.level, 0);
  // Out of range is brought into range
  const wild = JSON.parse(JSON.stringify(file));
  wild.master.level = 99;
  assert.equal(parseProject(wild).master.level, LEVEL_MAX);
});

test("a file with a track or clip this version can't read opens without it, and says how many were left out", () => {
  const track = (id, instrumentKey) => ({ id, name: id, color: '#fff', instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0 });
  const clip = (id, trackId) => ({ id, trackId, name: id, startBar: 1, lengthBars: 1, notes: [] });
  const p = { name: 'Newer', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [track('a', 'piano'), track('b', 'piano')], clips: [clip('c1', 'a'), clip('c2', 'b')] };
  const file = JSON.parse(JSON.stringify(serializeProject(p)));
  // Everything read: nothing said
  assert.equal('unread' in parseProject(structuredClone(file)), false);
  file.tracks[1].instrumentKey = 'instrumentFromTheFuture';
  file.clips.push({ id: 'c3', trackId: 'a' });
  // (A clip whose track went long ago is left out quietly, as before)
  file.clips.push(clip('c4', 'gone'));
  const back = parseProject(file);
  assert.deepEqual(back.tracks.map((t) => t.id), ['a']);
  assert.deepEqual(back.clips.map((c) => c.id), ['c1']);
  assert.deepEqual(back.unread, { tracks: 1, clips: 1 });
});
