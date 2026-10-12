// Unit tests for track folders (src/store/folders.ts). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const { foldersOf, tidyFolders, groupTracks, ungroup, updateFolder, moveToFolder, moveTrack, trackRows } = await import('../src/store/folders.ts');

const T = (id, folder) => ({ id, name: id, color: '#fff', ...(folder ? { folder } : {}) });
const ids = (tracks) => tracks.map((t) => t.id + (t.folder ? `:${t.folder.id}` : '')).join(' ');
const F = { id: 'f', name: 'Drums', color: '#f00' };

test('grouping puts the tracks together, where the first one was', () => {
  const tracks = [T('a'), T('b'), T('c'), T('d')];
  const out = groupTracks(tracks, new Set(['b', 'd']), F);
  assert.equal(ids(out), 'a b:f d:f c');
  assert.deepEqual(foldersOf(out), [{ ...F, count: 2 }]);
  assert.equal(ids(ungroup(out, 'f')), 'a b d c');
  assert.equal(ungroup(tracks, 'f'), tracks);
});

test('tidy keeps members together and sharing one folder', () => {
  const out = tidyFolders([T('a', F), T('b'), T('c', { ...F, name: 'stale' })]);
  assert.equal(ids(out), 'a:f c:f b');
  assert.equal(out[1].folder.name, 'Drums');
  const fine = [T('a', F), T('b', F), T('c')];
  assert.equal(tidyFolders(fine), fine);
});

test('renaming, recolouring and folding reach every member', () => {
  const tracks = [T('a', F), T('b', F), T('c')];
  const out = updateFolder(tracks, 'f', { color: '#0f0' }, true);
  assert.deepEqual(out.map((t) => t.color), ['#0f0', '#0f0', '#fff']);
  assert.ok(out.slice(0, 2).every((t) => t.folder.color === '#0f0'));
  const folded = updateFolder(tracks, 'f', { collapsed: true });
  assert.equal(folded[0].folder.collapsed, true);
  assert.equal('collapsed' in updateFolder(folded, 'f', { collapsed: false })[0].folder, false);
  assert.equal(updateFolder(tracks, 'nope', { name: 'x' }), tracks);
});

test('moving into and out of a folder', () => {
  const tracks = [T('a', F), T('b', F), T('c'), T('d')];
  assert.equal(ids(moveToFolder(tracks, 'd', 'f')), 'a:f b:f d:f c');
  assert.equal(ids(moveToFolder(tracks, 'a', null)), 'b:f a c d');
});

test('moving rows: swap inside a folder, step out at its edge, hop over a whole folder', () => {
  const tracks = [T('x'), T('a', F), T('b', F), T('y')];
  assert.equal(ids(moveTrack(tracks, 'b', -1)), 'x a:f b:f'.replace('a:f b:f', 'b:f a:f') + ' y');
  assert.equal(ids(moveTrack(tracks, 'a', -1)), 'x a b:f y');
  assert.equal(ids(moveTrack(tracks, 'b', 1)), 'x a:f b y');
  assert.equal(ids(moveTrack(tracks, 'x', 1)), 'a:f b:f x y');
  assert.equal(ids(moveTrack(tracks, 'y', -1)), 'x y a:f b:f');
  assert.equal(moveTrack(tracks, 'x', -1), tracks);
});

test('rows: a folder row before its tracks, which fold away', () => {
  const rows = trackRows([T('x'), T('a', F), T('b', F)]);
  assert.deepEqual(rows.map((r) => (r.kind === 'folder' ? `[${r.folder.name} ${r.members.length}]` : r.track.id)), ['x', '[Drums 2]', 'a', 'b']);
  const folded = trackRows([T('x'), T('a', { ...F, collapsed: true }), T('b', { ...F, collapsed: true })]);
  assert.deepEqual(folded.map((r) => (r.kind === 'folder' ? 'F' : r.track.id)), ['x', 'F']);
});
