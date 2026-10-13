// Unit tests for costumes and state options (src/store/costumes.ts). Run with `npm test`.
// Run with `npm test`.
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
const C = await import('../src/store/costumes.ts');
const { isInstrumentKey, INSTRUMENTS } = await import('../src/audio/instrumentCatalog.ts');
const noteTools = await import('../src/store/noteTools.ts');

const track = (id, instrumentKey) => ({ id, name: id, instrumentKey, isMuted: false, isSoloed: false, volume: 0, pan: 0 });
const tracks = [track('drums', 'acousticKit'), track('bass', 'bassGuitar'), track('lead', 'flute'), track('pad', 'warmPad'), track('horn', 'realHorn'), track('bus', 'bus')];
const clips = [
  { id: 'c1', trackId: 'lead', name: 'Tune', startBar: 1, lengthBars: 1, notes: [{ id: 'n1', note: 'C7', startOffset: 0, duration: '4n', velocity: 0.7 }], isSelected: false },
  { id: 'c2', trackId: 'drums', name: 'Beat', startBar: 1, lengthBars: 1, notes: [{ id: 'n2', note: 'C1', startOffset: 0, duration: '16n', velocity: 0.9 }], isSelected: false },
];

test('presets dress each kind of track', () => {
  const eight = C.costumeFromPreset('eightBit', tracks);
  assert.equal(eight.name, '8-bit');
  assert.deepEqual(eight.tracks.drums, { instrument: 'chipDrums' });
  assert.deepEqual(eight.tracks.bass, { instrument: 'chipBass' });
  assert.deepEqual(eight.tracks.lead, { instrument: 'chipLead' });
  assert.deepEqual(eight.tracks.pad, { mute: true });
  assert.equal(eight.tracks.bus, undefined, 'buses play as they are');
  const night = C.costumeFromPreset('night', tracks);
  assert.equal(night.tempo, 0.9);
  assert.deepEqual(night.tracks.drums, { mute: true });
  assert.deepEqual(night.tracks.horn, { instrument: 'slowStrings' });
  assert.equal(night.tracks.lead, undefined);
  assert.equal(C.costumeFromPreset('hurry', tracks).tempo, 1.2);
  // A second of the same is numbered
  assert.equal(C.costumeFromPreset('eightBit', tracks, [eight]).name, '8-bit 2');
});

test('applying a costume swaps instruments, mutes, and fits notes to the new range', () => {
  const box = C.costumeFromPreset('musicBox', tracks);
  const out = C.applyCostume(tracks, clips, box);
  assert.equal(out.tracks.find((t) => t.id === 'lead').instrumentKey, 'musicBox');
  assert.equal(out.tracks.find((t) => t.id === 'drums').isMuted, true);
  const [lo, hi] = INSTRUMENTS.musicBox.range;
  const { midiOf } = noteTools;
  const m = midiOf(out.clips.find((c) => c.id === 'c1').notes[0].note);
  assert.ok(m >= lo && m <= hi, `C7 folded into the music box's range (${m})`);
  // The song itself is untouched
  assert.equal(tracks.find((t) => t.id === 'lead').instrumentKey, 'flute');
  // A drum part can't go to a melodic instrument (its notes are drum names)
  const odd = { id: 'x', name: 'x', tempo: 1, tracks: { drums: { instrument: 'piano' } } };
  assert.equal(C.applyCostume(tracks, clips, odd).tracks.find((t) => t.id === 'drums').instrumentKey, 'acousticKit');
});

test('costumes and state options from a file keep only what makes sense', () => {
  const raw = [
    { id: 'a', name: '8-bit', tempo: 9, tracks: { lead: { instrument: 'chipLead' }, gone: { mute: true }, pad: { instrument: 'nope' }, bass: { mute: true } } },
    { name: '8-bit', tracks: {} },
    { tracks: {} },
  ];
  const got = C.parseCostumes(raw, new Set(tracks.map((t) => t.id)), isInstrumentKey);
  assert.equal(got.length, 2);
  assert.equal(got[0].tempo, C.MAX_COSTUME_TEMPO);
  assert.deepEqual(got[0].tracks, { lead: { instrument: 'chipLead' }, bass: { mute: true } });
  assert.equal(got[1].name, '8-bit 2');
  const opts = C.parseStateOptions({ m1: { shuffleBars: 4, gap: { min: 20, max: 5 } }, m2: { shuffleBars: 3 }, gone: { shuffleBars: 4 } }, new Set(['m1', 'm2']));
  assert.deepEqual(opts, { m1: { shuffleBars: 4, gap: { min: 20, max: 20 } } });
});
