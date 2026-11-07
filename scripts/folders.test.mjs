// Unit tests for track folders (src/store/folders.ts). Run with `npm test`.
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
const { foldersOf, tidyFolders, groupTracks, ungroup, updateFolder, moveToFolder, moveTrack, trackRows, folderName, FOLDER_NAME_MAX, isTrackColor, trackColor, DEFAULT_TRACK_COLOR } = await import('../src/store/folders.ts');
const { parseProject, parseTrack, PROJECT_FORMAT, PROJECT_VERSION } = await import('../src/store/project.ts');
const { projectFromHash, songLink } = await import('../src/store/shareLink.ts');
const { TRACK_COLORS } = await import('../src/store/timelineTypes.ts');
const { INSTRUMENTS } = await import('../src/audio/instrumentCatalog.ts');
const { readFileSync } = await import('node:fs');

const T = (id, folder) => ({ id, name: id, color: '#ffffff', ...(folder ? { folder } : {}) });
const ids = (tracks) => tracks.map((t) => t.id + (t.folder ? `:${t.folder.id}` : '')).join(' ');
const F = { id: 'f', name: 'Drums', color: '#ff0000' };

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
  const out = updateFolder(tracks, 'f', { color: '#00ff00' }, true);
  assert.deepEqual(out.map((t) => t.color), ['#00ff00', '#00ff00', '#ffffff']);
  assert.ok(out.slice(0, 2).every((t) => t.folder.color === '#00ff00'));
  const folded = updateFolder(tracks, 'f', { collapsed: true });
  assert.equal(folded[0].folder.collapsed, true);
  assert.equal('collapsed' in updateFolder(folded, 'f', { collapsed: false })[0].folder, false);
  assert.equal(updateFolder(tracks, 'nope', { name: 'x' }), tracks);
});

test('a change to what the folder already is changes nothing (so the store makes no undo step)', () => {
  const tracks = [T('a', F), T('b', F)];
  // Same colour, but its tracks aren't that colour yet: a real change
  const recoloured = updateFolder(tracks, 'f', { color: '#ff0000' }, true);
  assert.notEqual(recoloured, tracks);
  assert.deepEqual(recoloured.map((t) => t.color), ['#ff0000', '#ff0000']);
  // Again: nothing to change
  assert.equal(updateFolder(recoloured, 'f', { color: '#ff0000' }, true), recoloured);
  assert.equal(updateFolder(tracks, 'f', { color: '#ff0000' }), tracks);
  assert.equal(updateFolder(tracks, 'f', { name: 'Drums' }), tracks);
  assert.equal(updateFolder(tracks, 'f', { collapsed: false }), tracks);
  const folded = updateFolder(tracks, 'f', { collapsed: true });
  assert.notEqual(folded, tracks);
  assert.equal(updateFolder(folded, 'f', { collapsed: true }), folded);
  // A member's colour changed on its own: recolouring with the folder's colour brings it back
  const odd = [T('a', F), { ...T('b', F), color: '#0000ff' }];
  assert.deepEqual(updateFolder(odd, 'f', { color: '#ff0000' }, true).map((t) => t.color), ['#ff0000', '#ff0000']);
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

test("a folder's name is cut to what a saved song keeps (60), as it's given, not only on reopening", () => {
  const long = 'Strings and pads for the slow middle part of the song, the bridge before the last chorus';
  assert.equal(FOLDER_NAME_MAX, 60);
  assert.equal(folderName(`  ${long}  `), long.slice(0, 60).trim());
  assert.equal(folderName('  Drums  '), 'Drums');
  assert.equal(folderName('   '), '');
  assert.equal(folderName(undefined), '');
  const tracks = [T('a', F), T('b', F)];
  const out = updateFolder(tracks, 'f', { name: long });
  assert.ok(out.every((t) => t.folder.name === long.slice(0, 60).trim()));
  // An empty name keeps the one it has; the same one, cut, changes nothing
  assert.equal(updateFolder(tracks, 'f', { name: '  ' }), tracks);
  assert.equal(updateFolder(out, 'f', { name: long }), out);
  // The store's New folder cuts it the same way, and the fields take no more
  const store = readFileSync(new URL('../src/store/timelineStore.ts', import.meta.url), 'utf8');
  assert.match(store, /name: folderName\(name\) \|\| `Folder /);
  for (const f of ['FolderRow.tsx', 'TrackMenu.tsx']) {
    const src = readFileSync(new URL(`../src/components/timeline/${f}`, import.meta.url), 'utf8');
    const at = src.indexOf('aria-label="Folder name"');
    assert.ok(at > 0 && src.slice(src.lastIndexOf('<input', at), at).includes('maxLength={FOLDER_NAME_MAX}'), f);
  }
});

/** Colours that aren't a plain hex colour: as CSS they'd fetch something, run something or read something. */
const HOSTILE = [
  'url(http://127.0.0.1:5921/beacon)',
  'URL( "https://example.com/x.png" )',
  'red url(//example.com/x)',
  '#fff url(http://example.com/x)',
  'image-set("http://example.com/x" 1x)',
  'expression(alert(1))',
  'var(--x)',
  'rgb(1 2 3) ; background-image: url(x)',
  'red',
  '#ggg',
  '#12345',
  '#1234567',
  '#123456789',
  ' #fff',
  '#fff\n',
  '#' + 'a'.repeat(10000),
  'x'.repeat(100000),
  '',
  12,
  null,
  {},
];

test('a track or folder colour is a hex colour only, and every colour the app gives is one', () => {
  for (const c of ['#fff', '#FFF', '#a855f7', '#A855F7cc', DEFAULT_TRACK_COLOR]) assert.ok(isTrackColor(c), c);
  for (const c of HOSTILE) {
    assert.ok(!isTrackColor(c), String(c).slice(0, 40));
    assert.equal(trackColor(c), DEFAULT_TRACK_COLOR);
  }
  for (const c of TRACK_COLORS) assert.ok(isTrackColor(c), c);
  for (const [key, meta] of Object.entries(INSTRUMENTS)) assert.ok(isTrackColor(meta.color), `${key}: ${meta.color}`);
});

test('every colour kept is lowercase #rrggbb, so the studio can add its own alpha to it', () => {
  const six = /^#[0-9a-f]{6}$/;
  assert.equal(trackColor('#fff'), '#ffffff');
  assert.equal(trackColor('#F0a'), '#ff00aa');
  assert.equal(trackColor('#A855F7'), '#a855f7');
  assert.equal(trackColor('#A855F7cc'), '#a855f7');
  assert.equal(trackColor('#a855f700'), '#a855f7');
  for (const c of [...TRACK_COLORS, ...Object.values(INSTRUMENTS).map((m) => m.color), DEFAULT_TRACK_COLOR]) assert.match(trackColor(c), six, c);
  for (const c of HOSTILE) assert.match(trackColor(c), six);
});

const fileTrack = (extra) => ({ id: 't1', name: 'Bass', instrumentKey: 'piano', ...extra });
const fileSong = (tracks) => ({ format: PROJECT_FORMAT, version: PROJECT_VERSION, name: 'Colours', bpm: 120, tracks, clips: [] });

test('a colour from a file, a link or a shared sound that is not a hex colour opens as the default', async () => {
  for (const c of HOSTILE) {
    const t = parseTrack(fileTrack({ color: c, folder: { id: 'f', name: 'Drums', color: c } }));
    assert.equal(t.color, DEFAULT_TRACK_COLOR);
    assert.equal(t.folder.color, DEFAULT_TRACK_COLOR);
  }
  const fine = parseTrack(fileTrack({ color: '#a855f7', folder: { id: 'f', name: 'Drums', color: '#22c55e' } }));
  assert.equal(fine.color, '#a855f7');
  assert.equal(fine.folder.color, '#22c55e');
  // A link carries the song as a file does
  const song = parseProject(fileSong([fileTrack({ color: '#ef4444', folder: { id: 'f', name: 'Drums', color: '#3b82f6' } })]));
  const back = await projectFromHash(new URL(await songLink(song, 'https://example.com/app')).hash);
  assert.equal(back.tracks[0].color, '#ef4444');
  assert.equal(back.tracks[0].folder.color, '#3b82f6');
});

test('a short or see-through colour from a file, a link or the folder menu is kept as six digits', () => {
  const t = parseTrack(fileTrack({ color: '#F0A', folder: { id: 'f', name: 'Drums', color: '#22C55E80' } }));
  assert.equal(t.color, '#ff00aa');
  assert.equal(t.folder.color, '#22c55e');
  const tracks = [T('a', F), T('b', F)];
  const out = updateFolder(tracks, 'f', { color: '#00FF0080' }, true);
  assert.ok(out.every((x) => x.folder.color === '#00ff00' && x.color === '#00ff00'));
  // (The same colour spelled another way is no change)
  const same = [T('a', { ...F, color: '#00ff00' })].map((x) => ({ ...x, color: '#00ff00' }));
  assert.equal(updateFolder(same, 'f', { color: '#0F0' }, true), same);
});

test('setting a colour that is not a hex colour changes nothing', () => {
  const tracks = [T('a', F), T('b', F)];
  for (const c of HOSTILE) assert.equal(updateFolder(tracks, 'f', { color: c }, true), tracks);
  const renamed = updateFolder(tracks, 'f', { name: 'Kit', color: 'url(x)' }, true);
  assert.ok(renamed.every((t) => t.folder.name === 'Kit' && t.folder.color === '#ff0000' && t.color === '#ffffff'));
  const store = readFileSync(new URL('../src/store/timelineStore.ts', import.meta.url), 'utf8');
  assert.match(store, /setTrackColor: \(trackId, color\) => \{\n\s+if \(isTrackColor\(color\)\)/);
});

test("a folder's name from a file is on one line, trimmed and cut at a whole character, as a link's is", async () => {
  assert.equal(folderName(' '.repeat(60) + 'Drums'), 'Drums');
  assert.equal(folderName('Dr\nums\u0007\u202E'), 'Dr ums');
  const emoji = 'a'.repeat(59) + '\u{1F941}';
  assert.equal(folderName(emoji), emoji);
  const cut = folderName('a'.repeat(59) + '\u{1F941}\u{1F941}');
  assert.equal(cut, emoji);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(folderName('a'.repeat(59) + '\u{1F941}x')));
  const names = [' '.repeat(60) + 'Drums', 'Dr\nums', '\u0000\u0007', 'a'.repeat(59) + '\u{1F941}\u{1F941}', '   '];
  for (const name of names) {
    const fromFile = parseProject(fileSong([fileTrack({ folder: { id: 'f', name, color: '#3b82f6' } })]));
    const fromLink = await projectFromHash(new URL(await songLink(fromFile, 'https://example.com/app')).hash);
    assert.equal(fromFile.tracks[0].folder.name, folderName(name) || 'Folder', JSON.stringify(name));
    assert.equal(fromLink.tracks[0].folder.name, fromFile.tracks[0].folder.name, JSON.stringify(name));
  }
});
