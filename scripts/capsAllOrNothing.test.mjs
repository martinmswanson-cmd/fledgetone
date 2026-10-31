// The caps on a song while it's edited (songCaps.ts) count what the edit really makes: an edit of
// one linked clip is measured after its copies follow it. Undo and Redo are never refused (they
// put back a song that was). An action made of several changes (a checkpoint, then its edits:
// Bass line, Chords, Bounce in place, the launcher, Arrange, Pocket...) is all or nothing against
// the caps: refused, it leaves no undo step and keeps the redo history. Accept never marks a
// suggestion accepted with nothing changed, and an agent's result past a cap is refused when it's
// made. A recording that crosses a cap keeps what fits and says what was left out. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const { editPastCaps, MAX_CLIP_NOTES, MAX_SONG_NOTES } = await import('../src/store/songCaps.ts');
const { syncPatterns } = await import('../src/store/patterns.ts');
const { applyOps } = await import('../src/agent/ops.ts');
const { PROJECT_FORMAT, PROJECT_VERSION, parseProject } = await import('../src/store/project.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const notes = (n, prefix = 'n') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, note: 'C4', startOffset: (i % 64) / 16, duration: '16n', velocity: 0.8 }));

test('an edit of one linked clip is measured with every copy following it', () => {
  const linked = (id, n) => ({ id, trackId: 't1', name: 'A', startBar: 1, lengthBars: 4, notes: notes(n), isSelected: false, pattern: 'p1' });
  const before = Array.from({ length: 11 }, (_, i) => linked(`c${i}`, 18_000));
  const song = { tracks: [{ id: 't1' }], clips: before };
  // One clip handed in with 1,000 more notes: alone it's under every cap...
  const edited = before.map((c, i) => (i === 0 ? { ...c, notes: notes(19_000) } : c));
  assert.deepEqual(editPastCaps(song, { ...song, clips: edited }), []);
  // ...but its ten copies follow it: 209,000 notes, past the song's most
  const synced = syncPatterns(before, edited);
  assert.equal(synced.reduce((n, c) => n + c.notes.length, 0), 11 * 19_000);
  assert.ok(11 * 19_000 > MAX_SONG_NOTES);
  assert.deepEqual(editPastCaps(song, { ...song, clips: synced }), ['notes']);
  // The store's set syncs first, then checks the synced result
  const wrapper = src('src/store/timelineStore.ts').slice(src('src/store/timelineStore.ts').indexOf('function withLinkedClips'), src('src/store/timelineStore.ts').indexOf('export const useTimelineStore'));
  assert.ok(wrapper.indexOf('syncPatterns(s.clips, next.clips)') < wrapper.indexOf('editPastCaps(s, { ...s, ...next })'));
});

test('measuring never breaks on a list with a missing entry', () => {
  const song = { tracks: [{ id: 't1' }], clips: [] };
  assert.deepEqual(editPastCaps(song, { ...song, tracks: [{ id: 't1' }, undefined], clips: [undefined, { notes: [], takes: [undefined] }], stingers: [undefined] }), []);
  assert.deepEqual(editPastCaps(song, { ...song, tracks: [{ slots: [undefined, { clip: undefined }], automation: [undefined] }] }), []);
});

test('Undo and Redo are never refused by the caps', () => {
  const store = src('src/store/timelineStore.ts');
  const wrapper = store.slice(store.indexOf('function withLinkedClips'), store.indexOf('export const useTimelineStore'));
  assert.match(wrapper, /!puttingBack &&/);
  const undo = store.slice(store.indexOf('    undo: () => {'), store.indexOf('    // ---------- Project ----------'));
  assert.equal((undo.match(/putBackStep\(\{/g) ?? []).length, 2, 'undo and redo both put the step back past the caps check');
  assert.doesNotMatch(undo, /\n {6}set\(\{\n {8}\.\.\.restoreEntry/);
});

test('a song already past a cap can always be made smaller', () => {
  const big = { tracks: [{ id: 't1' }], clips: Array.from({ length: 11 }, () => ({ notes: new Array(19_000).fill(0) })) };
  assert.deepEqual(editPastCaps(big, { ...big, clips: big.clips.slice(1) }), []);
  assert.deepEqual(editPastCaps(big, { ...big, clips: big.clips.map((c, i) => (i ? c : { notes: [] })) }), []);
  assert.deepEqual(editPastCaps(big, { ...big, clips: [...big.clips, { notes: [0] }] }), ['notes']);
});

test('every "checkpoint, then edit" action is all or nothing against the caps', () => {
  // (each of these makes a checkpoint and then changes that could meet a cap: they go through
  // allOrNothing or editStep, never a bare checkpoint followed by the changes)
  const wrapped = {
    'src/store/smartActions.ts': ['function placeClip', 'function trackWithClip', 'function makeDrumClip', 'function fillClipBar', 'function rollClipDrums', 'function varyMelody'],
    'src/store/freezeActions.ts': ['function bounceTrack'],
    'src/store/launcher.ts': ['function setSlots', 'function moveSlot', 'function sendSelectionToLauncher', 'function sceneFromRange', 'function scenesFromSections', 'function writeSessionToArrangement'],
    'src/store/arrangeActions.ts': ['function oneStep'],
    'src/store/reverseActions.ts': ['now plays backwards'],
    'src/store/vocalActions.ts': ['function doubleClipNow'],
    'src/store/speedUpActions.ts': ['function speedUpIntoDrop'],
    'src/store/flipActions.ts': ['function chopToRack', 'function newFlipIdea'],
    'src/store/voiceChopActions.ts': ['function chopVoiceToKeysNow'],
    'src/store/resampleActions.ts': ["req.target === 'audio'", "addTrack('slicer'"],
    'src/pocket/pocketCell.ts': ['function inOneStep'],
    'src/pocket/pocketSections.ts': ['function oneStep'],
    'src/pocket/PocketVocals.tsx': ['function addVocalTrack'],
    'src/components/timeline/samplePackImport.ts': ["addTrack('drumRack', kit.name)"],
  };
  for (const [file, places] of Object.entries(wrapped)) {
    const text = src(file);
    for (const place of places) {
      const at = text.indexOf(place);
      assert.ok(at >= 0, `${file}: ${place}`);
      // The nearest function start before it, to the next top-level function
      const from = text.lastIndexOf('\nfunction ', at) > text.lastIndexOf('\nexport ', at) ? text.lastIndexOf('\nfunction ', at) : text.lastIndexOf('\nexport ', at);
      const ends = ['\nexport ', '\nfunction ', '\nconst ', '\n// '].map((m) => text.indexOf(m, at)).filter((i) => i > 0);
      const body = text.slice(from, ends.length ? Math.min(...ends) : text.length);
      assert.match(body, /allOrNothing\(|editStep[<(]/, `${file}: ${place} is all or nothing`);
    }
  }
  // A new track whose adding was refused is never filled in (no clip on a missing track, no `undefined` in the tracks)
  for (const file of ['src/store/smartActions.ts', 'src/store/freezeActions.ts', 'src/store/flipActions.ts', 'src/store/voiceChopActions.ts', 'src/store/arrangeActions.ts']) {
    const text = src(file);
    for (const m of text.matchAll(/addTrack\(/g)) {
      const after = text.slice(m.index, m.index + 400);
      assert.match(after, /tracks\.(some|find)\(\(t\) => t\.id === \w+\)/, `${file}: checks the track went in`);
    }
  }
});

test('Accept with a song past a cap changes nothing and says it can’t go in', () => {
  const accept = src('src/agent/accept.ts');
  assert.match(accept, /allOrNothing\(\(\) => put\(song, tracks, clips, tl\.selectedTrackId\), true\)/);
  assert.match(accept, /if \(!done\.done\) \{\n\s+mixFollows\(\);\n\s+return false;/);
  assert.match(accept, /can't go into your song: nothing was changed/);
});

test("an agent's suggestion one note past a clip's most is refused when it's made, naming the cap", () => {
  const base = parseProject({ format: PROJECT_FORMAT, version: PROJECT_VERSION, name: 'Big', bpm: 120, swing: 0, tracks: [{ id: 't1', name: 'Keys', instrumentKey: 'piano', volume: -6, pan: 0, reverbSend: 0, delaySend: 0 }], clips: [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 4, notes: notes(MAX_CLIP_NOTES) }] });
  const out = applyOps(base, { opsVersion: 1, ops: [{ op: 'add_notes', clipId: 'c1', notes: [{ pitch: 'E4', start: 0.5, length: 0.25 }] }] }, { idBase: 'sg' });
  assert.equal(out.ok, false);
  assert.match(out.errors[0].message, /20,000 in a clip/);
});

test('a recording that crosses a cap keeps what fits and says what was left out', () => {
  const store = src('src/store/timelineStore.ts');
  const endTake = store.slice(store.indexOf('  const endTake = () => {'), store.indexOf('  const updateClip = '));
  // The latest passes up to a folder's most takes, notes and lane points to a clip's and a lane's most
  assert.match(endTake, /played = played\.slice\(-room\)/);
  assert.match(endTake, /MAX_CLIP_NOTES/);
  assert.match(endTake, /MAX_LANE_POINTS/);
  // Then as much as the song has room for (checked as the store's set checks), told plainly
  assert.match(endTake, /editPastCaps\(now, \{ \.\.\.now, clips \}\)/);
  assert.match(endTake, /The take is in, without/);
});
