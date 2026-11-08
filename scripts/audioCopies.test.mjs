// Copies and moves of an audio clip that plays its recording at its own speed, in a song whose tempo
// changes: Duplicate, Repeat, Fill to loop Out, a mixed Duplicate linked, Paste (in the song or into
// another) and both kinds of move keep the clip as long in seconds as it was (its bars follow the
// tempo where it lands, along the tempo map where it plays across a change), and its comp keeps its
// places in the sound (src/store/audioClips.ts audioClipAt / placedClip, used by the store and the
// agent's ops). Clips that follow the tempo, and note clips, keep their bars. Run with `npm test`.
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
const { audioClipAt, placedClip, secondsInto, audioLengthLimitAt } = await import('../src/store/audioClips.ts');
const { secondsBetween } = await import('../src/audio/tempoMap.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const near = (a, b, what = '') => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} is not ${b}`);

// 120 BPM (2 s a bar), 160 from bar 5 (1.5 s a bar)
const SONG = { bpm: 120, points: [{ id: 'tp1', bar: 5, bpm: 160, ramp: false }] };
const FLAT_160 = { bpm: 160, points: [] };
const END = 401;
const audio = (extra = {}) => ({ soundId: 's1', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, ...extra });
/** A clip of a 2 s sound, `lengthBars` long at `startBar`. */
const clip = (startBar, lengthBars, extra = {}) => ({ id: 'c', trackId: 't', name: 'Tone', startBar, lengthBars, notes: [], isSelected: false, audio: audio(), ...extra });
const seconds = (c, tempo = SONG) => secondsBetween(c.startBar, c.startBar + c.lengthBars, tempo);

test('a copy into a faster stretch keeps its seconds (was cut short: 1 bar = 1.5 s of a 2 s phrase)', () => {
  const at4 = clip(4, 1);
  near(seconds(at4), 2, 'the original');
  const copy = { ...at4, startBar: 5, ...audioClipAt(at4, 5, SONG, SONG, END) };
  near(copy.lengthBars, 4 / 3, 'bars at 160');
  near(seconds(copy), 2, 'seconds');
  // ...and it stays within its sound (trimming never lets a clip run past it)
  assert.ok(copy.lengthBars <= audioLengthLimitAt(copy, 2, SONG) + 1e-9);
});

test('a copy into a slower stretch keeps its seconds (was 2.667 s, past the end of a 2 s sound)', () => {
  const at6 = clip(6, 4 / 3);
  near(seconds(at6), 2, 'the original');
  const copy = { ...at6, startBar: 2, ...audioClipAt(at6, 2, SONG, SONG, END) };
  near(copy.lengthBars, 1, 'bars at 120');
  near(seconds(copy), 2, 'seconds');
  assert.ok(copy.lengthBars <= audioLengthLimitAt(copy, 2, SONG) + 1e-9);
});

test('across a tempo change, the seconds are counted along the map, where it is and where it lands', () => {
  // From a place where it plays across the change (1 s at 120, 1 s at 160)
  const across = clip(4.5, 0.5 + 2 / 3);
  near(secondsInto(across, across.lengthBars, SONG), 2, 'seconds where it is');
  const copy = { ...across, startBar: 5 + 2 / 3, ...audioClipAt(across, 5 + 2 / 3, SONG, SONG, END) };
  near(seconds(copy), 2, 'a copy after the change (was 1.75 s)');
  // To a place where it plays across the change (the drag move was 1 bar = 1.75 s)
  const at2 = clip(2, 1);
  const moved = { ...at2, startBar: 4.5, ...audioClipAt(at2, 4.5, SONG, SONG, END) };
  near(moved.lengthBars, 0.5 + 2 / 3, 'bars');
  near(seconds(moved), 2, 'seconds');
});

test('a take folder\'s comp keeps its places in the sound (it stayed put in bars when moved by keyboard)', () => {
  const folder = clip(2, 1, { takes: [{ id: 'a', name: 'Take 1', audio: audio() }, { id: 'b', name: 'Take 2', audio: audio() }], comp: [{ at: 0, take: 0 }, { at: 0.5, take: 1 }] });
  const moved = audioClipAt(folder, 5, SONG, SONG, END);
  near(moved.comp[1].at, 2 / 3, 'the cut, 1 s in');
  near(moved.lengthBars, 4 / 3, 'the clip');
  // Along the map: from a place across the change, the cut 1 s in (at the change) lands 1 s in
  const across = clip(4.5, 0.5 + 2 / 3, { takes: folder.takes, comp: [{ at: 0, take: 0 }, { at: 0.5, take: 1 }] });
  const back = audioClipAt(across, 2, SONG, SONG, END);
  near(back.comp[1].at, 0.5, 'the cut');
  near(back.lengthBars, 1, 'the clip');
  assert.equal(back.comp[0].at, 0);
});

test('clips that follow the tempo, note clips, and copies at the same tempo keep their bars exactly', () => {
  const stretched = clip(4, 1, { audio: audio({ stretchBpm: 120 }), comp: [{ at: 0, take: 0 }] });
  const s = audioClipAt(stretched, 5, SONG, SONG, END);
  assert.equal(s.lengthBars, 1);
  assert.equal(s.comp, stretched.comp);
  const notes = { ...clip(4, 1), audio: undefined, notes: [{ id: 'n', note: 'C4', startOffset: 0, duration: '4n', velocity: 0.8 }] };
  assert.equal(audioClipAt(notes, 5, SONG, SONG, END).lengthBars, 1);
  assert.equal(placedClip(notes, 7.25, SONG, FLAT_160, END).lengthBars, 1);
  assert.equal(placedClip(notes, 7.25, SONG, FLAT_160, END).startBar, 7.25);
  // In one tempo the bars are the same number, not a rounding of it
  for (const len of [0.1, 0.3, 1 / 3, 2.7]) {
    assert.equal(audioClipAt(clip(1, len), 3, 120, 120, END).lengthBars, len);
    assert.equal(audioClipAt(clip(6, len), 7.5, SONG, SONG, END).lengthBars, len);
  }
});

test('never past the end of the timeline; a paste is pulled back to fit, measured where it lands', () => {
  const at6 = clip(6, 4 / 3);
  assert.equal(audioClipAt(at6, 400.5, SONG, SONG, END).lengthBars, 0.5);
  const placed = placedClip(clip(2, 1), 400.5, SONG, SONG, END);
  near(placed.startBar, END - 4 / 3, 'start');
  near(placed.lengthBars, 4 / 3, 'length');
  assert.equal(placedClip(clip(2, 1), -3, SONG, SONG, END).startBar, 1);
});

test('a paste into another song keeps the seconds it had where it was copied (was scaled by the two songs\' first tempos)', () => {
  // Copied at bar 6 of SONG (its 160 stretch), pasted at bar 2 of a song at 160 all through
  const placed = placedClip(clip(6, 4 / 3), 2, SONG, FLAT_160, END);
  near(placed.lengthBars, 4 / 3, 'bars');
  near(placed.lengthBars * 1.5, 2, 'seconds');
  // ...and from a plain 120 song into one at 90: as before, the bars scale with the tempos
  near(placedClip(clip(3, 2), 1, 120, 90, END).lengthBars, 1.5, 'plain tempos');
});

test('the store and the agent copy and move audio clips through these rules (Cut to length keeps its own)', () => {
  const store = src('src/store/timelineStore.ts');
  const body = (name) => {
    const at = store.indexOf(`    ${name}: (`);
    assert.ok(at > 0, name);
    return store.slice(at, store.indexOf('\n    },\n', at));
  };
  for (const name of ['repeatSelection', 'fillSelectionToLoopOut', 'duplicateLinked']) assert.match(body(name), /copyClipAt\(/, name);
  assert.doesNotMatch(body('repeatSelection'), /copyClip\(/);
  assert.doesNotMatch(body('fillSelectionToLoopOut'), /copyClip\(/);
  // Fill times a copy first, then cuts it at Out
  assert.match(body('fillSelectionToLoopOut'), /Math\.min\(copy\.lengthBars, out - copy\.startBar\)/);
  assert.match(body('pasteClips'), /placedClip\(/);
  assert.doesNotMatch(body('pasteClips'), /retimeAudioClips/);
  assert.match(body('copySelectedClips'), /clipboardFrom: \{ bar: origin, tempo: songTempo\(get\(\)\) \}/);
  assert.match(store.slice(store.indexOf('    moveClips: (moves)'), store.indexOf('    duplicateSelection:')), /audioClipAt\(c, startBar, tempo, tempo, TOTAL_BARS \+ 1\)/);
  assert.match(store.slice(store.indexOf('    moveClip: (clipId, startBar)'), store.indexOf('    trimClipStart:')), /audioClipAt\(c, start, tempo, tempo, TOTAL_BARS \+ 1\)/);
  // Cut to length lays each section's own tempos under its copies and times them afterwards
  assert.match(body('cutToLength'), /copyClip\(part, cursor - sec\.from\)/);
  const ops = src('src/agent/ops.ts');
  const op = (name) => ops.slice(ops.indexOf(`case '${name}': {`), ops.indexOf('return;', ops.indexOf(`case '${name}': {`)));
  assert.match(op('move_clip'), /audioClipAt\(clip, startBar, tempoOf\(w\), tempoOf\(w\)\)/);
  assert.match(op('duplicate_clip'), /audioClipAt\(clip, startBar, tempoOf\(w\), tempoOf\(w\)\)/);
});
