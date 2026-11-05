// A song as it leaves the machine without the names of the person's own files (src/store/ownFiles.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

// ---------- Wavetables, melody variations and reversed clips named after a file or folder ----------

const { normalizeUserTable, packUserTable, linkUserTable } = await import('../src/audio/plugins/userTable.ts');

test("a user table made from a clip named after a file, and a resample's synth, lose the name on every track, whatever the track is called", async () => {
  const cycles = new Float32Array(2048 * 2).map((_, i) => Math.sin((i / 2048) * 2 * Math.PI));
  const table = { ...(await packUserTable(cycles, 2, 'Voicemail 2026-03-02')), nameFromFile: true };
  // (The mark is kept in a saved song and in a link's lighter copy of the table)
  assert.equal(normalizeUserTable(JSON.parse(JSON.stringify(table))).nameFromFile, true);
  assert.equal((await linkUserTable(table)).nameFromFile, true);
  assert.ok(!('nameFromFile' in normalizeUserTable({ ...table, nameFromFile: 'yes' })));
  const fledge = (name, extra = {}) => ({ id: 'p', url: 'builtin:fledge/Fledge Synth', name, state: { builtin: 1, table }, ...extra });
  const song = {
    name: 'Song',
    tracks: [
      // A synth's own name: its table made in the panel from a marked clip
      T('a', 'Fledge Synth', 'plugin', { plugin: fledge('Fledge Synth') }),
      // Resample to a wavetable, then the track renamed by the person (its mark gone, the synth's kept)
      T('b', 'Bass', 'plugin', { plugin: fledge('Voicemail 2026-03-02 lead', { nameFromFile: true }) }),
      // A table with a name the person typed for its clip: kept
      T('c', 'Pad', 'plugin', { plugin: { ...fledge('Fledge Synth'), state: { builtin: 1, table: { ...table, nameFromFile: undefined, name: 'Warm pad' } } } }),
    ],
    clips: [],
  };
  const out = withoutFileNames(song);
  assert.deepEqual(out.tracks.map((t) => t.name), ['Fledge Synth', 'Bass', 'Pad']);
  assert.deepEqual(out.tracks.map((t) => t.plugin.name), ['Fledge Synth', 'Track', 'Fledge Synth']);
  assert.deepEqual(out.tracks.map((t) => t.plugin.state.table.name), ['User table', 'User table', 'Warm pad']);
  assert.ok(!/Voicemail|nameFromFile/.test(JSON.stringify(out)));
  assert.equal(out.tracks[2], song.tracks[2]);
  // Saved and opened, the plugin's mark is where it was
  const data = { format: PROJECT_FORMAT, version: PROJECT_VERSION, name: 'Song', bpm: 120, tracks: song.tracks.map((t) => ({ color: '#fff', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, reverbSend: 0, delaySend: 0, ...t })), clips: [] };
  const opened = parseProject(JSON.parse(JSON.stringify(serializeProject(parseProject(data)))));
  assert.equal(opened.tracks[1].plugin.nameFromFile, true);
  assert.equal(opened.tracks[0].plugin.state.table.nameFromFile, true);
  assert.ok(!('nameFromFile' in opened.tracks[2].plugin.state.table));
  // A song from before the mark: the synth and table named after a clip named after a file
  const old = {
    name: 'Song',
    tracks: [T('v', 'Audio 1', 'audio'), T('b', 'Bass', 'plugin', { plugin: { ...fledge('Voicemail 2026-03-02 lead'), state: { table: { ...table, nameFromFile: undefined } } } })],
    clips: [C('c1', 'v', 'Voicemail 2026-03-02', { audio: audio('h1') })],
  };
  const back = withoutFileNames(old, (id) => (id === 'h1' ? 'Voicemail 2026-03-02.m4a' : undefined));
  assert.equal(back.tracks[1].plugin.name, 'Track');
  assert.equal(back.tracks[1].plugin.state.table.name, 'User table');
  assert.ok(!/Voicemail/.test(JSON.stringify(back)));
});

test('melody variations and reversed clips named after a marked track or clip are renamed, and so they are in a song from before the mark', () => {
  const marked = {
    name: 'Song',
    tracks: [
      T('p', 'Grandpa piano', 'multiSampler', { nameFromFile: true }),
      T('h', 'Grandpa piano harmony', 'multiSampler', { nameFromFile: true }),
      T('k', 'Family photos kit', 'drumRack', { nameFromFile: true }),
      T('r', 'Family photos kit (reversed)', 'audio', { nameFromFile: true }),
    ],
    clips: [
      C('c1', 'p', 'Grandpa piano 1', { nameFromFile: true }),
      C('c2', 'p', 'Grandpa piano 1 (answer phrase)', { nameFromFile: true }),
      C('c3', 'h', 'Grandpa piano 1 (harmony a third above)', { nameFromFile: true }),
      C('c4', 'r', 'Family photos kit 1 (reversed)', { nameFromFile: true, audio: audio('h1') }),
    ],
  };
  const out = withoutFileNames(marked);
  assert.deepEqual(out.tracks.map((t) => t.name), ['Sounds', 'Sounds', 'Kit', 'Audio']);
  assert.deepEqual(out.clips.map((c) => c.name), ['Pattern', 'Pattern', 'Pattern', 'Audio']);
  // The same song saved before the mark: the names made from the folder's are found from the track's
  const unmarked = JSON.parse(JSON.stringify(marked), (k, v) => (k === 'nameFromFile' ? undefined : v));
  unmarked.tracks[0].multi = { zones: [{ soundId: 'h2', name: 'C4', root: 60, lo: 0, hi: 127, velLo: 1, velHi: 127 }], attack: 0, release: 0.3 };
  // (A kit the app named after a folder has the folder's sounds on its pads)
  unmarked.tracks[2].rack = { pads: [pad('Kick', 'h3')] };
  const old = withoutFileNames(unmarked, (id) => ({ h2: 'C4.wav', h3: 'Kick.wav', h1: 'Family photos kit 1 (reversed).wav' })[id]);
  assert.deepEqual(old.tracks.map((t) => t.name), ['Sounds', 'Sounds', 'Kit', 'Audio']);
  assert.deepEqual(old.clips.map((c) => c.name), ['Pattern', 'Pattern', 'Pattern', 'Audio']);
  assert.ok(!/Grandpa|Family/.test(JSON.stringify(old)));
  // A variation of a clip the person named is kept
  const typed = withoutFileNames({ ...marked, clips: [C('c5', 'p', 'Verse (variation)'), C('c6', 'p', 'Hook 2 (answer phrase)')] });
  assert.deepEqual(typed.clips.map((c) => c.name), ['Verse (variation)', 'Hook 2 (answer phrase)']);
});

test("a song from before the mark: a sample pack's kits, one-shots, loops and instruments are taken for its folder's; names people type are kept", () => {
  const files = { h1: 'Kick 01.wav', h2: 'C4.wav', h3: 'E4.wav', h4: 'Loop 90.wav', h5: 'kick from desktop.wav' };
  const zone = (soundId, name, root) => ({ soundId, name, root, lo: 0, hi: 127, velLo: 1, velHi: 127 });
  const song = {
    name: 'Song',
    tracks: [
      T('k', 'Smith family photos kit', 'drumRack', { rack: { pads: [pad('Kick 01', 'h1')] } }),
      T('k2', 'Smith family photos kit 2', 'drumRack'),
      T('o', 'Smith family photos one-shots', 'drumRack', { rack: { pads: [pad('Kick 01', 'h1')] } }),
      T('l', 'Smith family photos loops', 'audio'),
      T('m', 'JDoe private piano', 'multiSampler', { multi: { zones: [zone('h2', 'C4', 60), zone('h3', 'E4', 64)], attack: 0, release: 0.3 } }),
      // A rack of the folder's sounds named as the folder is (it had "kit" in it)
      T('f', 'Kit from the Smith wedding', 'drumRack', { rack: { pads: [pad('Kick 01', 'h1')] } }),
      // Typed, or the app's own: kept
      T('d', 'Drums', 'drumRack', { rack: { pads: [pad('Kick 01', 'h1')] } }),
      T('my', 'My kit', 'drumRack'),
      T('808', '808 kit 2', 'drumRack'),
      T('sp', 'Sample pack kit', 'drumRack'),
      T('vl', 'Vocal loops', 'audio'),
      T('pi', 'Piano', 'multiSampler', { multi: { zones: [zone('h2', 'C4', 60)], attack: 0, release: 0.3 } }),
      T('mix', 'Rack', 'drumRack', { rack: { pads: [pad('Kick 01', 'h1'), pad('Snare', 'h5')] } }),
      T('ms', 'Multi Sampler 2', 'multiSampler', { multi: { zones: [zone('h2', 'C4', 60)], attack: 0, release: 0.3 } }),
      // Since the mark: a track whose sounds carry it was named by the person
      T('ex', 'Ex kit', 'drumRack', { rack: { pads: [{ ...pad('Kick 01', 'h1'), nameFromFile: true }] } }),
      T('lead', 'Lead', 'rhodes'),
    ],
    clips: [C('c1', 'l', 'Loop 90', { audio: audio('h4') }), C('c2', 'k', 'Smith family photos kit 3'), C('c3', 'lead', 'Lead 1')],
  };
  for (const fileNameOf of [(id) => files[id], undefined]) {
    const out = withoutFileNames(song, fileNameOf);
    const names = out.tracks.map((t) => t.name);
    assert.deepEqual(names.slice(0, 4), ['Kit', 'Kit', 'Kit', 'Audio']);
    assert.deepEqual(names.slice(6), ['Drums', 'My kit', '808 kit 2', 'Sample pack kit', 'Vocal loops', 'Piano', 'Rack', 'Multi Sampler 2', 'Ex kit', 'Lead']);
    assert.deepEqual(out.clips.map((c) => c.name).slice(1), ['Pattern', 'Lead 1']);
    if (fileNameOf) {
      // (An instrument or a rack known only by its sounds' file names)
      assert.deepEqual(names.slice(4, 6), ['Sounds', 'Kit']);
      assert.ok(!/Smith|JDoe|Loop 90/.test(JSON.stringify(out)), JSON.stringify(out).match(/Smith|JDoe|Loop 90/)?.[0]);
    }
  }
});

test('every flow that makes a name from another carries its mark', () => {
  const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const has = (path, ...snippets) => {
    const text = src(path);
    for (const s of snippets) assert.ok(text.includes(s), `${path}: ${s}`);
  };
  has('src/components/timeline/FledgeSynthPanel.tsx', 'audioSourceSeconds(clip, bpm), clip.nameFromFile);');
  has('src/store/resampleActions.ts', "req.cycle ?? 'pitch', named.nameFromFile);", '() => !elsewhere(), named.nameFromFile);', 'addPluginTrack(FLEDGE_URL, name.slice(0, 40), state, fileMade(nameFromFile))');
  has('src/store/timelineStore.ts', 'plugin: { id: uid(\'plugin\'), url, name, ...mark,');
  has('src/store/smartActions.ts', 'const named = fileMade(clip.nameFromFile);', '{ name, ...named, startBar: clip.startBar, lengthBars: clip.lengthBars, notes }, fileMade(track.nameFromFile));', 'placeClip(track.id, at, clip.lengthBars, notes, name, named);', 'const id = s.addTrack(instrument, name, named);');
  has('src/store/reverseActions.ts', '...fileMade(only && (sourceTrack ? sourceTrack.nameFromFile : only.nameFromFile)),', '...fileMade(only?.nameFromFile),');
  // Every flow that sends a song out asks for the sounds' file names (a song from before the marks needs them)
  has('src/audio/gameKit.ts', 'fileNameOf: FileNameOf;', 'const listed = sharedTrackNames(song, song.fileNameOf);');
  has('src/components/timeline/gameKitSong.ts', 'fileNameOf: soundFileName,');
  has('src/runtime/player.ts', 'fileNameOf: songFileNames(p.sounds),');
  has('src/store/shareLink.ts', 'const nameOf = songFileNames(project.sounds, fileNameOf);', 'withoutFileNames(withFileMarks({ ...project, masterFx, tracks }, nameOf), nameOf)');
  has('src/audio/runtimeKit.ts', 'withoutFileNames(withFileMarks(project, fileNameOf), fileNameOf)');
  for (const path of ['src/components/timeline/ShareDialog.tsx', 'src/pocket/PocketShare.tsx']) has(path, ', soundFileName)');
  // ...and no call leaves them out
  const calls = (text) => [...text.matchAll(/withoutFileNames\(/g)].map((m) => {
    let depth = 0;
    for (let i = m.index + 'withoutFileNames'.length; i < text.length; i++) {
      if (text[i] === '(' || text[i] === '{' || text[i] === '[') depth++;
      if (text[i] === ')' || text[i] === '}' || text[i] === ']') depth--;
      if (depth === 0) return text.slice(m.index, i + 1);
    }
    return '';
  });
  for (const path of ['src/audio/gameKit.ts', 'src/audio/runtimeKit.ts', 'src/store/shareLink.ts', 'src/store/ownFiles.ts']) {
    for (const call of calls(src(path))) {
      if (call.startsWith('withoutFileNames(song: T')) continue;
      let depth = 0;
      const top = [...call.slice('withoutFileNames('.length, -1)].filter((ch) => ((depth += '({['.includes(ch) ? 1 : ')}]'.includes(ch) ? -1 : 0), depth === 0 && ch === ',')).length;
      assert.ok(top >= 1, `${path}: ${call} has no file names`);
    }
  }
  // The store: a new song is marked, an opened one checked, and both go out saying so
  has('src/store/timelineStore.ts', 'fileMarks: FILE_MARKS, tracks', 'const p = withFileMarks(opened, soundFileName);', 'fileMarks: !!p.fileMarks,', "...(s.fileMarks ? { fileMarks: FILE_MARKS } : {}),");
  has('src/components/timeline/gameKitSong.ts', '...(s.fileMarks ? { fileMarks: FILE_MARKS } : {}),');
});

// ---------- The game kit, and songs saved since the marks ----------

const { sharedTrackNames, withFileMarks, songFileNames, FILE_MARKS } = await import('../src/store/ownFiles.ts');

/** A song from before the mark, as the game kit gets it from the store: no marks, the sounds' names in the library. */
const zone = (soundId, name, root) => ({ soundId, name, root, lo: 0, hi: 127, velLo: 1, velHi: 127 });
const BEFORE = {
  name: 'Song',
  tracks: [
    T('b', 'Grandma voicemail (bounce)', 'audio', { stemGroup: 'Voice' }),
    T('s', 'Grandma voicemail stutter', 'audio', { stemGroup: 'Voice' }),
    T('v', 'Grandma voicemail 1 (variation)', 'rhodes'),
    T('m', 'Grandpa keys', 'multiSampler', { multi: { zones: [zone('z1', 'Grandpa keys C4', 60), zone('z2', 'Grandpa keys E4', 64)], attack: 0, release: 0.3 } }),
    T('r', 'Wedding', 'drumRack', { rack: { pads: [pad('Kick 01', 'p1'), pad('Snare 01', 'p2')] } }),
    T('l', 'Lead', 'rhodes'),
  ],
  clips: [C('c1', 'b', 'Grandma voicemail', { audio: audio('h1') }), C('c2', 'l', 'Lead 1')],
};
const BEFORE_FILES = { h1: 'Grandma voicemail.wav', z1: 'Grandpa keys C4.wav', z2: 'Grandpa keys E4.wav', p1: 'Kick 01.wav', p2: 'Snare 01.wav' };

test("the game kit lists a song from before the mark's tracks with the sounds' file names, as a share link names them", () => {
  const fileNameOf = (id) => BEFORE_FILES[id];
  // (The game kit's song from the store: the library's names; it has its own `fileNameOf`)
  const song = { ...BEFORE, fileNameOf };
  const listed = sharedTrackNames(song, song.fileNameOf);
  const names = song.tracks.map(listed);
  assert.deepEqual(names, ['Audio', 'Audio', 'Track', 'Sounds', 'Kit', 'Lead']);
  // The same names as the link's
  assert.deepEqual(names, withoutFileNames(BEFORE, fileNameOf).tracks.map((t) => t.name));
  assert.ok(!/Grandma|Grandpa|Wedding/.test(JSON.stringify(names)));
  // (Without the file names, as it was asked before, they'd go out as they are)
  assert.ok(/Grandma voicemail \(bounce\)/.test(JSON.stringify(BEFORE.tracks.map(sharedTrackNames(BEFORE, () => undefined)))));
  // The song's own embedded sounds are asked too
  const embedded = songFileNames([{ id: 'h1', name: 'Grandma voicemail.wav' }], () => undefined);
  assert.equal(embedded('h1'), 'Grandma voicemail.wav');
  assert.equal(songFileNames([{ id: 'h1', name: 'x.wav' }], (id) => (id === 'h1' ? 'y.wav' : undefined))('h1'), 'y.wav');
});

/** Names people type for a kit or loops, in a song with sounds dropped and the pads renamed by typing, and mic takes. */
const TYPED_KITS = {
  name: 'Song',
  tracks: [
    T('a', 'My drum kit', 'drumRack', { rack: { pads: [pad('Kick', 'h1'), pad('Snare', 'h2')] } }),
    T('b', 'Acoustic drum kit', 'drumRack', { rack: { pads: [pad('Kick', 'h1')] } }),
    T('c', 'Live drum kit', 'drumRack', { rack: { pads: [pad('Kick', 'h1')] } }),
    T('d', "Dad's kit", 'drumRack', { rack: { pads: [pad('Kick', 'h1')] } }),
    T('e', 'Breakbeat loops', 'audio'),
    T('f', 'Night loops', 'audio'),
    T('g', 'Ghost kit', 'drumRack', { rack: { pads: [pad('Kick'), pad('Snare')] } }),
    T('h', 'Bass 2', 'slapBass'),
  ],
  clips: [C('c1', 'f', 'Take 1', { audio: audio('m1') }), C('c2', 'e', 'Break', { audio: audio('l1') }), C('c3', 'h', 'Bass 2 1')],
};
const TYPED_FILES = { h1: 'kick.wav', h2: 'snare.wav', m1: 'Mic take 1.wav', l1: 'amen break.wav' };

test('a song saved since the marks is judged by them alone: names people type for a kit or loops are kept', () => {
  const song = { ...TYPED_KITS, fileMarks: FILE_MARKS };
  for (const fileNameOf of [(id) => TYPED_FILES[id], undefined]) {
    const out = withoutFileNames(song, fileNameOf);
    assert.deepEqual(out.tracks.map((t) => t.name), song.tracks.map((t) => t.name));
    assert.equal(out.clips, song.clips);
  }
  // Its marks still go
  const marked = { ...song, tracks: [...song.tracks, T('x', 'Smith family kit', 'drumRack', { nameFromFile: true })], clips: [...song.clips, C('c4', 'x', 'Smith family kit 1', { nameFromFile: true })] };
  const out = withoutFileNames(marked, (id) => TYPED_FILES[id]);
  assert.equal(out.tracks.at(-1).name, 'Kit');
  assert.equal(out.clips.at(-1).name, 'Pattern');
});

test('a song from before the marks: a kit by its name needs sounds from files on its pads, a set of loops clips from files, not mic takes', () => {
  const out = withoutFileNames(TYPED_KITS, (id) => TYPED_FILES[id]);
  // (privacy first: a kit of dropped sounds named "X kit" may be a folder's)
  assert.deepEqual(out.tracks.map((t) => t.name), ['Kit', 'Kit', 'Kit', 'Kit', 'Audio', 'Night loops', 'Ghost kit', 'Bass 2']);
  assert.deepEqual(out.clips.map((c) => c.name), ['Take 1', 'Break', 'Bass 2 1']);
  // A set of loops whose sounds aren't known may be a folder's too
  assert.equal(withoutFileNames(TYPED_KITS).tracks[5].name, 'Audio');
});

test('a song from before the marks gets them once its sounds are known: it goes out the same, and names typed after are kept', () => {
  const fileNameOf = (id) => BEFORE_FILES[id];
  const marked = withFileMarks(BEFORE, fileNameOf);
  assert.equal(marked.fileMarks, FILE_MARKS);
  // What the old check found is marked, and nothing else
  assert.deepEqual(marked.tracks.map((t) => !!t.nameFromFile), [true, true, true, true, true, false]);
  assert.deepEqual(marked.tracks[3].multi.zones.map((z) => !!z.nameFromFile), [true, true]);
  assert.deepEqual(marked.tracks[4].rack.pads.map((p) => !!p.nameFromFile), [true, true]);
  assert.deepEqual(marked.clips.map((c) => !!c.nameFromFile), [true, false]);
  // The names themselves are as they were (only marked)
  assert.deepEqual(marked.tracks.map((t) => t.name), BEFORE.tracks.map((t) => t.name));
  // Going out, it's named as the old check names it, with or without the file names
  const old = JSON.stringify(withoutFileNames(BEFORE, fileNameOf));
  for (const f of [fileNameOf, undefined]) assert.equal(JSON.stringify(withoutFileNames(marked, f), (k, v) => (k === 'fileMarks' ? undefined : v)), old);
  // A name the person types after is theirs
  const typed = { ...marked, tracks: [...marked.tracks, ...TYPED_KITS.tracks.slice(0, 6)], clips: [...marked.clips, ...TYPED_KITS.clips] };
  const out = withoutFileNames(typed, (id) => ({ ...BEFORE_FILES, ...TYPED_FILES })[id]);
  assert.deepEqual(out.tracks.slice(6).map((t) => t.name), ['My drum kit', 'Acoustic drum kit', 'Live drum kit', "Dad's kit", 'Breakbeat loops', 'Night loops']);
  // Not every sound's name known (a sound not in this browser): it stays an old song, checked the old way
  assert.equal(withFileMarks(BEFORE, (id) => (id === 'p2' ? undefined : BEFORE_FILES[id])), BEFORE);
  // ...its embedded sounds count (a saved file carries them)
  const withSounds = { ...BEFORE, sounds: Object.entries(BEFORE_FILES).map(([id, name]) => ({ id, name })) };
  assert.equal(withFileMarks(withSounds).fileMarks, FILE_MARKS);
  // A song already marked comes back as it was
  assert.equal(withFileMarks(marked, fileNameOf), marked);
});

test('the mark that a song is marked is saved, opened, kept by the browser and the command line, and a link carries it', async () => {
  const fileTrack = (t) => ({ color: '#fff', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, reverbSend: 0, delaySend: 0, ...t });
  const file = (song, extra = {}) => ({ format: PROJECT_FORMAT, version: PROJECT_VERSION, name: song.name, bpm: 120, tracks: song.tracks.map(fileTrack), clips: song.clips, ...extra });
  const { packedProject, unpackProject } = await import('../src/store/project.ts');
  const { songLink, projectFromHash } = await import('../src/store/shareLink.ts');
  // A song saved since: the mark goes through a file, the browser's copy and a link
  const since = parseProject(file(TYPED_KITS, { fileMarks: 1 }));
  assert.equal(since.fileMarks, 1);
  assert.equal(parseProject(JSON.parse(JSON.stringify(serializeProject(since)))).fileMarks, 1);
  assert.equal(unpackProject(packedProject(since)).fileMarks, 1);
  const link = await projectFromHash(await songLink(since, '', (id) => TYPED_FILES[id]));
  assert.equal(link.fileMarks, 1);
  assert.deepEqual(link.tracks.map((t) => t.name), since.tracks.map((t) => t.name));
  assert.ok(link.tracks.length >= 6);
  // (A newer file's number is read as this one)
  assert.equal(parseProject(file(TYPED_KITS, { fileMarks: 2 })).fileMarks, 1);
  assert.ok(!('fileMarks' in parseProject(file(TYPED_KITS, { fileMarks: 'yes' }))));
  // A song from before, saved with its sounds (Save embeds them): saved marked, and opens so
  const sounds = Object.entries(BEFORE_FILES).map(([id, name]) => ({ id, name, type: 'audio/wav', size: 4, seconds: 1, data: 'AAAA' }));
  const before = parseProject(file(BEFORE));
  assert.ok(!('fileMarks' in before));
  const saved = parseProject(JSON.parse(JSON.stringify(serializeProject({ ...before, sounds }))));
  assert.equal(saved.fileMarks, 1);
  assert.equal(saved.tracks[0].nameFromFile, true);
  const named = withoutFileNames(saved);
  assert.ok(!/Grandma|Grandpa|Wedding/.test(JSON.stringify([named.tracks, named.clips])));
  // ...without them (the browser's copy, its sounds in the library): still a song from before, not marked by halves
  const kept = unpackProject(packedProject(before));
  assert.ok(!('fileMarks' in kept));
  assert.ok(!kept.tracks.some((t) => t.nameFromFile));
  // A link from it: renamed as before, and marked when the sounds' names are known
  const back = await projectFromHash(await songLink(before, '', (id) => BEFORE_FILES[id]));
  assert.equal(back.fileMarks, 1);
  assert.ok(!/Grandma|Grandpa|Wedding/.test(JSON.stringify(back)));
  const blind = await projectFromHash(await songLink(before, ''));
  assert.ok(!('fileMarks' in blind));
  // A song with no sounds of its own is marked as it's saved (nothing to check: a new song, a starter)
  assert.equal(serializeProject(parseProject(file({ name: 'S', tracks: [T('l', 'Lead', 'rhodes')], clips: [] }))).fileMarks, 1);
});
