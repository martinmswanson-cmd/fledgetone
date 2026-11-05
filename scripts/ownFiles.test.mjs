// A song as it leaves the machine without the names of the person's own files (src/store/ownFiles.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  try { return await next(specifier, context); } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  } }`)
);
const { nameFromFile, withoutFileNames, withNeutralSoundIds, SOUND_NAME } = await import('../src/store/ownFiles.ts');

const pad = (name, soundId) => ({ name, ...(soundId ? { soundId } : {}), gain: 0, pan: 0, pitch: 0, decay: 0, lowpass: 20000, highpass: 20, drive: 0, choke: 0 });
const audio = (soundId) => ({ soundId, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 });

const SONG = {
  name: 'Song',
  tracks: [
    { id: 't1', name: 'Keys', instrumentKey: 'sampler', sample: { name: 'Voice memo.m4a', soundId: 'h1', root: 'C4' } },
    { id: 't2', name: 'Chops', instrumentKey: 'slicer', slicer: { soundId: 'h2', name: 'Holiday.wav', start: 0, end: 1, slices: [0] } },
    { id: 't3', name: 'Rack', instrumentKey: 'drumRack', rack: { pads: [pad('kick from desktop', 'h3'), pad('Snare'), pad('Kick', 'h3')] } },
    { id: 't4', name: 'Multi', instrumentKey: 'multiSampler', multi: { zones: [{ soundId: 'h4', name: 'piano C4', root: 60, lo: 0, hi: 63, velLo: 1, velHi: 127 }, { soundId: 'h4', name: 'Bright keys', root: 72, lo: 64, hi: 127, velLo: 1, velHi: 127 }], attack: 0, release: 0.3 } },
    { id: 't5', name: 'Vox', instrumentKey: 'audio', slots: [{ scene: 0, clip: { name: 'Voice memo', lengthBars: 1, notes: [], audio: audio('h1') } }] },
    { id: 't6', name: 'Lead', instrumentKey: 'rhodes' },
  ],
  clips: [
    { id: 'c1', trackId: 't5', name: 'Voice memo', startBar: 1, lengthBars: 1, notes: [], audio: audio('h1') },
    { id: 'c2', trackId: 't5', name: 'My chorus', startBar: 2, lengthBars: 1, notes: [], audio: audio('h1') },
    { id: 'c3', trackId: 't6', name: 'Voice memo', startBar: 1, lengthBars: 1, notes: [] },
  ],
};
const files = { h1: 'Voice memo.m4a', h2: 'Holiday.wav', h3: 'kick from desktop.wav', h4: 'piano C4.wav' };

test("the sounds' file names are replaced by plain ones, and each sound keeps its id", () => {
  const out = withoutFileNames(SONG, (id) => files[id]);
  const [sampler, slicer, rack, multi, vox, lead] = out.tracks;
  assert.deepEqual(sampler.sample, { name: SOUND_NAME, soundId: 'h1', root: 'C4' });
  assert.equal(slicer.slicer.name, SOUND_NAME);
  assert.equal(slicer.slicer.soundId, 'h2');
  assert.deepEqual(rack.rack.pads.map((p) => p.name), ['Pad 1', 'Snare', 'Kick']);
  assert.deepEqual(multi.multi.zones.map((z) => z.name), ['Sound 1', 'Bright keys']);
  assert.equal(vox.slots[0].clip.name, 'Audio');
  // A track with no sound of its own is the same object
  assert.equal(lead, SONG.tracks[5]);
  // Only an audio clip still named after its file is renamed
  assert.deepEqual(out.clips.map((c) => c.name), ['Audio', 'My chorus', 'Voice memo']);
  assert.ok(out.clips.every((c, i) => c.audio?.soundId === SONG.clips[i].audio?.soundId));
  // The song it came from is unchanged
  assert.equal(SONG.tracks[0].sample.name, 'Voice memo.m4a');
  const text = JSON.stringify(out);
  for (const own of ['.m4a', '.wav', 'desktop', 'Holiday']) assert.ok(!text.includes(own), own);
});

test('without the file names known, only the Sampler sound (always its file name) changes', () => {
  const out = withoutFileNames(SONG);
  assert.equal(out.clips, SONG.clips);
  assert.equal(out.tracks[0].sample.name, SOUND_NAME);
  for (const i of [1, 2, 3, 4, 5]) assert.equal(out.tracks[i], SONG.tracks[i]);
});

test('a name made from the file: the file name, without its extension, trimmed or cut to a pad or zone; a typed one is not', () => {
  assert.ok(nameFromFile('Voice memo.m4a', 'Voice memo.m4a'));
  assert.ok(nameFromFile('Voice memo', 'Voice memo.m4a'));
  assert.ok(nameFromFile('Kick 01', 'Kick 01'));
  assert.ok(nameFromFile('x'.repeat(40), `${'x'.repeat(60)}.wav`));
  assert.ok(nameFromFile('Snare', ' Snare .wav'));
  assert.ok(!nameFromFile('Kick', 'kick from desktop.wav'));
  assert.ok(!nameFromFile('Voice', 'Voice memo.m4a'));
  assert.ok(!nameFromFile('voice memo', 'Voice memo.m4a'));
});

test('a song with no sounds of its own comes back as it was', () => {
  const plain = { name: 'Song', tracks: [SONG.tracks[5]], clips: [SONG.clips[2]] };
  const out = withoutFileNames(plain, (id) => files[id]);
  assert.equal(JSON.stringify(out), JSON.stringify(plain));
  assert.equal(out.tracks[0], plain.tracks[0]);
  assert.equal(out.clips, plain.clips);
});

test('sound ids are swapped wherever they appear, one new id per sound', () => {
  const data = { tracks: [{ sample: { soundId: 'h1' } }], clips: [{ audio: { soundId: 'h1', tunedFrom: 'h2' } }], other: 'h1x' };
  const out = withNeutralSoundIds(data, ['h1', 'h2']);
  assert.deepEqual(out, { tracks: [{ sample: { soundId: 'sound-1' } }], clips: [{ audio: { soundId: 'sound-1', tunedFrom: 'sound-2' } }], other: 'h1x' });
  assert.equal(data.tracks[0].sample.soundId, 'h1');
});

// ---------- Names marked as made from a file or folder (nameFromFile) ----------

const { fileMade, typedName, withName, sharedTrackName } = await import('../src/store/ownFiles.ts');
const { parseProject, serializeProject, PROJECT_FORMAT, PROJECT_VERSION } = await import('../src/store/project.ts');
const { mapZones, normalizeRack } = await import('../src/store/sampleKits.ts');
const { fillPad, padFromClip } = await import('../src/store/bounceToPad.ts');

const T = (id, name, instrumentKey, extra = {}) => ({ id, name, instrumentKey, ...extra });
const C = (id, trackId, name, extra = {}) => ({ id, trackId, name, startBar: 1, lengthBars: 1, notes: [], ...extra });

/** Every marked name the app makes, as each flow makes it, and the names the person typed. */
const MARKED = {
  name: 'Song',
  tracks: [
    // A sample pack's tracks are named after its folders
    T('k', 'Ex voice notes kit', 'drumRack', { nameFromFile: true, rack: { pads: [pad('Ex voice kick', 'h1'), pad('Snare 1', 'h2'), pad('Kick')].map((p, i) => (i < 2 ? { ...p, nameFromFile: true } : p)) } }),
    T('o', 'Ex voice notes one-shots', 'drumRack', { nameFromFile: true }),
    T('l', 'Ex voice notes loops', 'audio', { nameFromFile: true }),
    T('m', 'Rhodes samples', 'multiSampler', { nameFromFile: true, multi: { zones: [{ soundId: 'h3', name: 'Rhodes C3', nameFromFile: true, root: 48, lo: 0, hi: 60, velLo: 1, velHi: 127 }, { soundId: 'h3', name: 'Bright', root: 72, lo: 61, hi: 127, velLo: 1, velHi: 127 }], attack: 0, release: 0.3 } }),
    // A Slicer loaded from a file, its Stutter clip, a voice chop and a double, all named after the file
    T('s', 'Slicer', 'slicer', { slicer: { soundId: 'h4', name: 'Therapy session.wav', nameFromFile: true, start: 0, end: 1, slices: [0] } }),
    T('vc', 'Divorce call chops', 'multiSampler', { nameFromFile: true }),
    T('d', 'Divorce call double', 'audio', { nameFromFile: true }),
    T('a', 'Vocals', 'audio', { slots: [{ scene: 0, clip: { name: 'Divorce call', nameFromFile: true, lengthBars: 1, notes: [], audio: audio('h5') } }] }),
    T('w', 'Divorce call lead', 'plugin', { nameFromFile: true, plugin: { id: 'p', url: 'builtin:fledge', name: 'Divorce call lead', state: { table: { v: 1, name: 'Divorce call', frames: 16 } } } }),
  ],
  clips: [
    // Dropped, then reversed, moved, mangled and tuned: each keeps its mark (and its name)
    C('c1', 'a', 'Divorce call', { nameFromFile: true, audio: { ...audio('h6'), reversedFrom: 'h5' } }),
    C('c2', 'a', 'Divorce call', { nameFromFile: true, audio: { ...audio('h7'), shiftedFrom: 'h5', shift: 3 } }),
    C('c3', 'a', 'Divorce call', { nameFromFile: true, audio: { ...audio('h8'), mangled: { from: 'h5', offset: 0, bars: 1, steps: ['x'] } } }),
    C('c4', 'a', 'Divorce call', { nameFromFile: true, audio: { ...audio('h9'), tunedFrom: 'h5' } }),
    C('c5', 's', 'Therapy session.wav stutter', { nameFromFile: true }),
    C('c6', 'vc', 'Divorce call chops', { nameFromFile: true }),
    C('c7', 'd', 'Divorce call double', { nameFromFile: true, audio: audio('h10') }),
    C('c8', 'l', 'Loop 120', { nameFromFile: true, audio: audio('h11') }),
    // Typed by the person: kept
    C('c9', 'a', 'Verse take', { audio: audio('h5') }),
    C('c10', 's', 'Chorus chops'),
  ],
};
const OWN = /Ex voice|Ex-|Divorce|Therapy|Rhodes|Loop 120|Snare 1|\.wav/;

test('every name marked as made from a file or folder gets a plain one; typed names are kept', () => {
  const out = withoutFileNames(MARKED);
  assert.deepEqual(out.tracks.map((t) => t.name), ['Kit', 'Kit', 'Audio', 'Sounds', 'Slicer', 'Sounds', 'Audio', 'Vocals', 'Track']);
  assert.deepEqual(out.tracks[0].rack.pads.map((p) => p.name), ['Pad 1', 'Pad 2', 'Kick']);
  assert.deepEqual(out.tracks[3].multi.zones.map((z) => z.name), ['Sound 1', 'Bright']);
  assert.equal(out.tracks[4].slicer.name, SOUND_NAME);
  assert.equal(out.tracks[7].slots[0].clip.name, 'Audio');
  assert.equal(out.tracks[8].plugin.name, 'Track');
  assert.equal(out.tracks[8].plugin.state.table.name, 'User table');
  assert.deepEqual(out.clips.map((c) => c.name), ['Audio', 'Audio', 'Audio', 'Audio', 'Pattern', 'Pattern', 'Audio', 'Audio', 'Verse take', 'Chorus chops']);
  const text = JSON.stringify(out);
  assert.ok(!OWN.test(text), text.match(OWN)?.[0]);
  // (A plain name says nothing of a file: the mark goes with the old name)
  assert.ok(!text.includes('nameFromFile'));
  // Only the names change
  assert.deepEqual(out.clips.map((c) => c.audio), MARKED.clips.map((c) => c.audio));
  assert.equal(MARKED.tracks[0].name, 'Ex voice notes kit');
});

test('a typed name clears the mark, and is kept wherever the song goes', () => {
  const clip = MARKED.clips[0];
  const typed = typedName(clip, 'Divorce call');
  assert.equal(typed.nameFromFile, undefined);
  assert.ok(!('nameFromFile' in typed));
  assert.equal(typed.name, 'Divorce call');
  // (in its place among the fields, as before)
  assert.deepEqual(Object.keys(typed), Object.keys(clip).filter((k) => k !== 'nameFromFile'));
  const track = typedName(MARKED.tracks[0], 'My kit');
  const pads = { ...track.rack, pads: track.rack.pads.map((p, i) => (i === 0 ? typedName(p, 'Boom') : p)) };
  const out = withoutFileNames({ ...MARKED, tracks: [{ ...track, rack: pads }], clips: [typed] });
  assert.equal(out.tracks[0].name, 'My kit');
  assert.deepEqual(out.tracks[0].rack.pads.map((p) => p.name), ['Boom', 'Pad 2', 'Kick']);
  // Without its sound's file name known, a typed clip name stays, even one that looks like the file's
  assert.equal(out.clips[0].name, 'Divorce call');
  assert.deepEqual(withName({ name: 'a' }, 'b', true), { name: 'b', nameFromFile: true });
  assert.deepEqual(fileMade(false), {});
  assert.deepEqual(fileMade(true), { nameFromFile: true });
  assert.equal(sharedTrackName(MARKED.tracks[0]), 'Kit');
  assert.equal(sharedTrackName(track), 'My kit');
});

test('the mark goes into a saved song and comes back when it opens, for every kind of item', () => {
  const data = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: 'Song',
    bpm: 120,
    swing: 0,
    loopRegion: { inBar: 1, outBar: 5, enabled: false },
    tracks: MARKED.tracks.filter((t) => t.instrumentKey !== 'plugin').map((t) => ({ color: '#fff', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, reverbSend: 0, delaySend: 0, ...t })),
    clips: MARKED.clips,
  };
  const p = parseProject(data);
  const again = parseProject(JSON.parse(JSON.stringify(serializeProject(p))));
  for (const song of [p, again]) {
    assert.deepEqual(song.tracks.map((t) => !!t.nameFromFile), [true, true, true, true, false, true, true, false]);
    assert.deepEqual(song.tracks[0].rack.pads.slice(0, 3).map((x) => !!x.nameFromFile), [true, true, false]);
    assert.deepEqual(song.tracks[3].multi.zones.map((z) => !!z.nameFromFile), [true, false]);
    assert.equal(song.tracks[4].slicer.nameFromFile, true);
    assert.equal(song.tracks[7].slots[0].clip.nameFromFile, true);
    assert.deepEqual(song.clips.map((c) => !!c.nameFromFile), [true, true, true, true, true, true, true, true, false, false]);
    // ...and nothing else about them changes: what's heard and seen is the same
    assert.deepEqual(song.clips.map((c) => c.name), MARKED.clips.map((c) => c.name));
  }
  assert.deepEqual(serializeProject(again), serializeProject(p));
  // Only `true` marks a name
  const odd = parseProject({ ...data, tracks: [{ ...data.tracks[0], nameFromFile: 'yes' }], clips: [{ ...MARKED.clips[0], trackId: 'k', nameFromFile: 1 }] });
  assert.ok(!('nameFromFile' in odd.tracks[0]));
  assert.ok(!('nameFromFile' in odd.clips[0]));
  // A song from before the mark opens without any
  const old = parseProject({ ...data, tracks: [{ ...data.tracks[1], nameFromFile: undefined }], clips: [] });
  assert.ok(!('nameFromFile' in old.tracks[0]));
});

test("the marks are carried where a name is made from another's: zones laid out again, a pad from a clip", () => {
  const zones = mapZones([{ soundId: 'h1', name: 'Piano C4', nameFromFile: true, root: 60 }, { soundId: 'h2', name: 'Soft', root: 72 }]);
  assert.deepEqual(zones.map((z) => !!z.nameFromFile), [true, false]);
  assert.equal(normalizeRack({ pads: [{ ...pad('Kick 01', 'h1'), nameFromFile: true }] }).pads[0].nameFromFile, true);
  const fromClip = padFromClip({ name: 'Divorce call', nameFromFile: true, lengthBars: 1, audio: audio('h1') }, 4, 120);
  assert.equal(fromClip.nameFromFile, true);
  assert.equal(fillPad(undefined, 0, fromClip).pads[0].nameFromFile, true);
  // A bounce named by its bars is not; a pad that had a file's name loses the mark when it gets a new sound
  const rack = { pads: [{ ...pad('Ex kick', 'h1'), nameFromFile: true }] };
  assert.ok(!('nameFromFile' in fillPad(rack, 0, { soundId: 'h9', name: 'Bars 1–4', gainDb: 0 }).pads[0]));
});

// ---------- Songs saved before the mark: their names checked against the sounds' file names ----------

const OLD_FILES = {
  h5: 'Divorce call 2026-10-02.m4a',
  h6: 'Divorce call 2026-10-02 (reversed).wav',
  h7: 'Divorce call 2026-10-02 (+3 st).wav',
  h8: 'Divorce call 2026-10-02 (mangled).wav',
  h9: 'Divorce call 2026-10-02 (tuned).wav',
  h10: 'Divorce call 2026-10-02 (double).wav',
  h12: 'Divorce call 2026-10-02 (+3 st) (reversed).wav',
  h4: 'Therapy session.wav',
  h13: 'My beat tag (tag).wav',
  h14: 'Producer tag (tag).wav',
};
const OLD = {
  name: 'Song',
  tracks: [
    T('a', 'Vocals', 'audio'),
    T('s', 'Slicer', 'slicer', { slicer: { soundId: 'h4', name: 'Therapy session.wav', start: 0, end: 1, slices: [0] } }),
    T('vc', 'Divorce call 2026-10-02 chops', 'multiSampler'),
    T('d', 'Divorce call 2026-10-02 double', 'audio'),
    T('b', 'Divorce call 2026-10-02 (bounce)', 'audio'),
    T('t', 'Producer tag', 'audio'),
  ],
  clips: [
    // Edited after it was dropped: its sound is named after the file it was made from
    C('c1', 'a', 'Divorce call 2026-10-02', { audio: { ...audio('h6'), reversedFrom: 'h5' } }),
    C('c2', 'a', 'Divorce call 2026-10-02', { audio: { ...audio('h7'), shiftedFrom: 'h5', shift: 3 } }),
    C('c3', 'a', 'Divorce call 2026-10-02', { audio: { ...audio('h8'), mangled: { from: 'h5', offset: 0, bars: 1, steps: ['x'] } } }),
    C('c4', 'a', 'Divorce call 2026-10-02', { audio: { ...audio('h9'), tunedFrom: 'h5' } }),
    C('c5', 'a', 'Divorce call 2026-10-02', { audio: audio('h12') }),
    C('c6', 's', 'Therapy session.wav stutter'),
    C('c7', 's', 'Therapy session.wav shuffle'),
    C('c8', 'vc', 'Divorce call 2026-10-02 chops'),
    C('c9', 'd', 'Divorce call 2026-10-02 double', { audio: audio('h10') }),
    C('c10', 't', 'My beat tag', { audio: audio('h13') }),
    // Typed, or the app's own: kept
    C('c11', 't', 'Producer tag', { audio: audio('h14') }),
    C('c12', 'a', 'Verse take', { audio: { ...audio('h6'), reversedFrom: 'h5' } }),
    C('c13', 's', 'Stutter fill'),
    C('c14', 's', 'Divorce call'),
  ],
};

test("a song from before the mark: edited clips, Stutter and Shuffle clips, chops, doubles and bounces named after a file are found by the sounds' file names", () => {
  const out = withoutFileNames(OLD, (id) => OLD_FILES[id]);
  assert.deepEqual(out.tracks.map((t) => t.name), ['Vocals', 'Slicer', 'Sounds', 'Audio', 'Audio', 'Producer tag']);
  assert.equal(out.tracks[1].slicer.name, SOUND_NAME);
  assert.deepEqual(out.clips.map((c) => c.name), ['Audio', 'Audio', 'Audio', 'Audio', 'Audio', 'Pattern', 'Pattern', 'Pattern', 'Audio', 'Audio', 'Producer tag', 'Verse take', 'Stutter fill', 'Divorce call']);
  assert.ok(!/Divorce call 2026|Therapy|My beat tag/.test(JSON.stringify(out)));
  // Without the file names known, nothing of theirs is touched
  const blind = withoutFileNames(OLD);
  assert.equal(blind.clips, OLD.clips);
  assert.deepEqual(blind.tracks.map((t) => t.name), OLD.tracks.map((t) => t.name));
});
