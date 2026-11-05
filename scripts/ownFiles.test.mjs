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
const { withoutFileNames, withNeutralSoundIds, SOUND_NAME } = await import('../src/store/ownFiles.ts');

const pad = (name, soundId) => ({ name, ...(soundId ? { soundId } : {}), gain: 0, pan: 0, pitch: 0, decay: 0, lowpass: 20000, highpass: 20, drive: 0, choke: 0 });
const audio = (soundId) => ({ soundId, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 });

const SONG = {
  name: 'Song',
  tracks: [
    { id: 't1', name: 'Keys', instrumentKey: 'sampler', sample: { name: 'Voice memo.m4a', soundId: 'h1', root: 'C4' } },
    { id: 't2', name: 'Chops', instrumentKey: 'slicer', slicer: { soundId: 'h2', name: 'Holiday.wav', start: 0, end: 1, slices: [0] } },
    { id: 't3', name: 'Rack', instrumentKey: 'drumRack', rack: { pads: [pad('kick from desktop', 'h3'), pad('Snare')] } },
    { id: 't4', name: 'Multi', instrumentKey: 'multiSampler', multi: { zones: [{ soundId: 'h4', name: 'piano C4.wav', root: 60, lo: 0, hi: 127, velLo: 1, velHi: 127 }], attack: 0, release: 0.3 } },
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
  assert.deepEqual(rack.rack.pads.map((p) => p.name), ['Pad 1', 'Snare']);
  assert.equal(multi.multi.zones[0].name, 'Sound 1');
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

test('without the file names known, only the names that are file names by kind change', () => {
  const out = withoutFileNames(SONG);
  assert.equal(out.clips, SONG.clips);
  assert.equal(out.tracks[0].sample.name, SOUND_NAME);
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
