// A song that stopped the app from showing doesn't open again by itself: a song is noted as
// opening until the app has shown it (markOpening / markOpened in src/store/project.ts), and a
// startup that finds the autosaved song still noted offers it back (the Restore banner, Pocket's
// start screen) instead, marked, with the autosave cleared so later startups don't reopen it
// either. The recovery screen's "set it aside" keeps the song and starts fresh. Each startup is a
// fresh copy of project.ts over the same browser storage. Run with `npm test`.
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
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };
const AUTOSAVE = 'bos-beat-box.autosave.v1';
const PREVIOUS = 'bos-beat-box.autosave.previous';
const OPENING = 'fledgetone.opening';

let startups = 0;
/** The app starting in this browser: project.ts loaded afresh (it reads the storage as it loads). */
const startup = () => import(`../src/store/project.ts?startup=${++startups}`);
const { createStarter } = await import('../src/store/starters.ts');
const songA = { ...createStarter('lofi'), songId: 'song-a' };
const songB = { ...createStarter('celtic'), songId: 'song-b' };

test('a song that showed opens again; one still noted as opening is offered, never opened by itself', async () => {
  stored.clear();
  let p = await startup();
  // The song opens and shows: it's autosaved, and the note is cleared
  p.markOpening('song-a');
  assert.ok(p.writeAutosave(songA).ok);
  p.markOpened('song-a');
  p = await startup();
  let session = p.preservePreviousSession();
  assert.equal(session.project.songId, 'song-a');
  assert.equal(session.stopped, undefined, 'a song that showed opens again by itself');

  // Opened again, autosaved, and the app stopped showing before it was shown: still noted
  p.markOpening('song-a');
  assert.ok(p.writeAutosave(songA).ok);
  p = await startup();
  session = p.preservePreviousSession();
  assert.equal(session.project.songId, 'song-a');
  assert.equal(session.stopped, true);
  assert.equal(session.stoppedNow, true, 'found this startup: kept as a version once');
  assert.equal(stored.get(AUTOSAVE), undefined, 'the autosave is cleared, so a later startup does not take it for a session to open');
  assert.equal(JSON.parse(stored.get(PREVIOUS)).stopped, true);

  // The empty song this startup shows leaves song A's note; the next startup still offers it, marked
  p.markOpened('empty-song');
  assert.equal(stored.get(OPENING), 'song-a');
  p = await startup();
  session = p.preservePreviousSession();
  assert.equal(session.project.songId, 'song-a');
  assert.equal(session.stopped, true);
  assert.equal(session.stoppedNow, undefined);
});

test("a note for another song doesn't hold back the autosaved one", async () => {
  stored.clear();
  let p = await startup();
  assert.ok(p.writeAutosave(songA).ok);
  // A link's song was opening (not autosaved yet) when the app stopped showing
  p.markOpening('song-from-a-link');
  p = await startup();
  const session = p.preservePreviousSession();
  assert.equal(session.project.songId, 'song-a');
  assert.equal(session.stopped, undefined);
});

test("set aside from the recovery screen: kept where it's offered, marked, and the app starts fresh", async () => {
  stored.clear();
  let p = await startup();
  assert.ok(p.writeAutosave(songB).ok);
  p.markOpening('song-b');
  assert.equal(p.setAsideStoppedSong(songB), true);
  assert.equal(stored.get(AUTOSAVE), undefined);
  assert.equal(stored.get(OPENING), undefined);
  p = await startup();
  const session = p.preservePreviousSession();
  assert.equal(session.project.songId, 'song-b');
  assert.equal(session.stopped, true);
  assert.equal(session.project.clips.length, songB.clips.length, 'the whole song is kept');
});

test('set aside keeps an autosave of another song (the one a link replaced before its own autosave)', async () => {
  stored.clear();
  let p = await startup();
  assert.ok(p.writeAutosave(songA).ok);
  assert.equal(p.setAsideStoppedSong(songB), true);
  assert.ok(stored.get(AUTOSAVE), 'the other song stays autosaved');
  p = await startup();
  const session = p.preservePreviousSession();
  // The autosaved song is the session (it opens again): song B, set aside in the slot, gives way to
  // it as any older session does (it's kept as a version too: reopenLastSong.ts setAsideAndStartFresh)
  assert.equal(session.project.songId, 'song-a');
  assert.equal(session.stopped, undefined);
});
