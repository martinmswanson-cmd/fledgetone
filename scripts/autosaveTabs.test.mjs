// The app open in two tabs (src/store/project.ts): they share one autosave, and an autosave
// another tab wrote is told apart from this page's own (a reload's included). Run with `npm test`.
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

// The autosave writes to browser storage: a stand-in for it
const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => void stored.set(k, String(v)),
  removeItem: (k) => void stored.delete(k),
  key: (i) => [...stored.keys()][i] ?? null,
  get length() {
    return stored.size;
  },
};

// Two pages: the module loaded twice, each with its own page id
const here = await import('../src/store/project.ts');
const there = await import('../src/store/project.ts?other-tab');

const KEY = 'bos-beat-box.autosave.v1';
const song = (name, clips) => ({
  name,
  songId: 'song-1',
  bpm: 120,
  swing: 0,
  loopRegion: { inBar: 1, outBar: 5, enabled: false },
  tracks: [{ id: 't1', name: 'Keys', color: '#fff', instrumentKey: 'piano', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, reverbSend: 0, delaySend: 0 }],
  clips: Array.from({ length: clips }, (_, i) => ({ id: `c${i}`, trackId: 't1', name: 'x', startBar: 1 + i, lengthBars: 1, notes: [{ id: `n${i}`, note: 'C4', startOffset: 0, duration: '8n', velocity: 0.8 }], isSelected: false })),
});
const event = (key, newValue) => ({ key, newValue });

test("this page's own autosave is never another tab's; one written by another page is, song and all", () => {
  assert.equal(here.writeAutosave(song('Mine', 2)).ok, true);
  assert.equal(here.songFromAnotherTab(stored.get(KEY)), null);
  assert.equal(there.writeAutosave(song('Theirs', 7)).ok, true);
  const theirs = here.songFromAnotherTab(stored.get(KEY));
  assert.equal(theirs.name, 'Theirs');
  assert.equal(theirs.clips.length, 7);
  // ...and the other way round
  assert.equal(there.songFromAnotherTab(stored.get(KEY)), null);
  // An autosave from before pages were told apart (no page id) is another's too
  const old = JSON.parse(stored.get(KEY));
  delete old.tab;
  assert.equal(here.songFromAnotherTab(JSON.stringify(old)).clips.length, 7);
  assert.equal(here.songFromAnotherTab('not json'), null);
});

test('only a write of the autosave counts as another tab autosaving', () => {
  assert.equal(here.autosaveWrittenBy(event(KEY, '{}')), '{}');
  assert.equal(here.autosaveWrittenBy(event(KEY, null)), null);
  assert.equal(here.autosaveWrittenBy(event('fledgetone.mySounds', '[]')), null);
});

test('the page id stays out of the song as opened', () => {
  here.writeAutosave(song('Mine', 1));
  const raw = JSON.parse(stored.get(KEY));
  assert.equal(typeof raw.tab, 'string');
  assert.equal('tab' in there.songFromAnotherTab(stored.get(KEY)), false);
});

test("the autosave's song can be read back (Free unused keeps another tab's sounds by it)", () => {
  there.writeAutosave({ ...song('Theirs', 1), clips: [{ id: 'a1', trackId: 't1', name: 'kick', startBar: 1, lengthBars: 1, notes: [], isSelected: false, audio: { soundId: 'kick-sound', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 } }], tracks: [{ ...song('x', 0).tracks[0], instrumentKey: 'audio' }] });
  assert.equal(here.storedAutosave().clips[0].audio.soundId, 'kick-sound');
  stored.delete(KEY);
  assert.equal(here.storedAutosave(), null);
});
