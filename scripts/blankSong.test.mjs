// The blank song (blankSong in demoSong.ts): the one the app opens with and the one New makes are
// built by the same function, so the first song is set up as every new one (Expressive playing on
// every track, Mono below 120 Hz and Headroom on the master). A starter is made new the same way
// (asNewSong) but keeps its levels; a song opened from a file keeps what it saved. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const T = await import('../src/store/timelineTypes.ts');
const D = await import('../src/store/demoSong.ts');

test('the blank song plays expressively on every track', () => {
  const song = D.blankSong();
  assert.deepEqual(song.tracks.map((t) => t.name), ['Drums', 'Slap Bass', 'Space Clav', 'Brass Stabs']);
  for (const t of song.tracks) assert.equal(t.expressive, true, t.name);
});

test('the blank song keeps its lows in the middle and leaves 6 dB of Headroom', () => {
  const { master } = D.blankSong();
  assert.equal(master.monoLow, true);
  assert.equal(master.headroom, 6);
  // The rest of the master is the default one
  assert.deepEqual({ ...master, monoLow: undefined, headroom: undefined }, { ...T.defaultMasterSettings(), monoLow: undefined, headroom: undefined });
});

test('the blank song is empty, called Untitled, at 122 BPM with the first four bars looping', () => {
  const song = D.blankSong();
  assert.equal(song.name, 'Untitled');
  assert.equal(song.bpm, 122);
  assert.equal(song.swing, 0.2);
  assert.deepEqual(song.loopRegion, { inBar: 1, outBar: 5, enabled: true });
  assert.deepEqual(song.clips, []);
  assert.deepEqual(song.masterFx, T.DEFAULT_MASTER_FX);
});

test('every blank song is the same, and none shares a track or its effects with another', () => {
  const a = D.blankSong();
  const b = D.blankSong();
  assert.deepEqual(a, b);
  a.tracks.forEach((t, i) => {
    assert.notEqual(t, b.tracks[i]);
    assert.notEqual(t.fx, b.tracks[i].fx);
    assert.notEqual(t, D.INITIAL_TRACKS[i]);
    assert.notEqual(t.fx, D.INITIAL_TRACKS[i].fx);
  });
});

test('a starter made new plays expressively and keeps its lows in the middle, at the levels it was mixed at', async () => {
  const { createStarter } = await import('../src/store/starters.ts');
  const starter = createStarter('lofi');
  const song = T.asNewSong(starter, false);
  for (const t of song.tracks) assert.equal(t.expressive, true, t.name);
  assert.equal(song.master.monoLow, true);
  assert.equal(song.master.headroom, undefined);
  assert.deepEqual({ ...song.master, monoLow: undefined }, { ...starter.master, monoLow: undefined });
  // Nothing else of it changes
  assert.deepEqual(song.clips, starter.clips);
  assert.deepEqual(song.tracks.map((t) => ({ ...t, expressive: undefined })), starter.tracks.map((t) => ({ ...t, expressive: undefined })));
  assert.equal(song.bpm, starter.bpm);
});

test('a song saved before Expressive playing and Mono below 120 Hz opens without them, and a saved blank song keeps them', async () => {
  const P = await import('../src/store/project.ts');
  const file = JSON.parse(JSON.stringify(P.serializeProject(D.blankSong())));
  const saved = P.parseProject(file);
  for (const t of saved.tracks) assert.equal(t.expressive, true, t.name);
  assert.equal(saved.master.monoLow, true);
  assert.equal(saved.master.headroom, 6);
  // The same file as an older version wrote it
  const older = JSON.parse(JSON.stringify(file));
  for (const t of older.tracks) delete t.expressive;
  delete older.master.monoLow;
  delete older.master.headroom;
  const opened = P.parseProject(older);
  for (const t of opened.tracks) assert.ok(!t.expressive, t.name);
  assert.ok(!opened.master.monoLow);
  assert.equal(opened.master.headroom, undefined);
});

test('the store starts in the blank song and New loads it: both from blankSong, neither written out again', async () => {
  const { readFileSync } = await import('node:fs');
  const store = readFileSync(new URL('../src/store/timelineStore.ts', import.meta.url), 'utf8');
  for (const s of [
    'const opening = blankSong();',
    'tracks: opening.tracks,',
    'clips: opening.clips,',
    'bpm: opening.bpm,',
    'swing: opening.swing,',
    'loopRegion: opening.loopRegion,',
    'projectName: opening.name,',
    'master: opening.master,',
    'isStarterId(template) ? asNewSong(createStarter(template), false) : blankSong();',
  ]) assert.ok(store.includes(s), s);
  // The default tracks reach the store only through blankSong
  assert.ok(!store.includes('INITIAL_TRACKS'));
});
