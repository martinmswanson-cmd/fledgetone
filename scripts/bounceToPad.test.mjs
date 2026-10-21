// Unit tests for bounce to pad (src/store/bounceToPad.ts). Run with `npm test`.
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
const b = await import('../src/store/bounceToPad.ts');
const { defaultRack, emptyPad, normalizeRack } = await import('../src/store/sampleKits.ts');

const rackWith = (filled) => ({ pads: defaultRack().pads.map((p, i) => (filled.includes(i) ? { ...p, soundId: `s${i}`, name: `Hit ${i}` } : p)) });
const track = (id, instrumentKey, rack) => ({ id, instrumentKey, ...(rack ? { rack } : {}) });

test('the first empty pad: pad 1 of an empty rack, the gap in a part-filled one, none in a full one', () => {
  assert.equal(b.firstEmptyPad(undefined), 0);
  assert.equal(b.firstEmptyPad(rackWith([0, 1, 3])), 2);
  assert.equal(b.firstEmptyPad(rackWith([...Array(16).keys()])), -1);
});

test('choosing a pad: the one asked for, else that track\'s first empty, else any Drum Rack\'s, else a new track', () => {
  const full = rackWith([...Array(16).keys()]);
  const tracks = [track('kit', 'drumMachine'), track('r1', 'drumRack', full), track('r2', 'drumRack', rackWith([0])), track('lead', 'supersaw')];
  // A pad asked for is used even when it has a sound (it's replaced)
  assert.deepEqual(b.choosePadTarget(tracks, { trackId: 'r1', pad: 5 }), { trackId: 'r1', pad: 5 });
  // A full track asked for without a pad: the next rack with room
  assert.deepEqual(b.choosePadTarget(tracks, { trackId: 'r1' }), { trackId: 'r2', pad: 1 });
  assert.deepEqual(b.choosePadTarget(tracks, { trackId: 'r2' }), { trackId: 'r2', pad: 1 });
  assert.deepEqual(b.choosePadTarget(tracks), { trackId: 'r2', pad: 1 });
  // Not a Drum Rack, or a pad out of range: as if nothing was asked
  assert.deepEqual(b.choosePadTarget(tracks, { trackId: 'kit', pad: 0 }), { trackId: 'r2', pad: 1 });
  assert.deepEqual(b.choosePadTarget(tracks, { trackId: 'r1', pad: 16 }), { trackId: 'r2', pad: 1 });
  // A Drum Rack track with no rack yet is all empty pads
  assert.deepEqual(b.choosePadTarget([track('fresh', 'drumRack')]), { trackId: 'fresh', pad: 0 });
  // Nowhere to go: a new track
  assert.deepEqual(b.choosePadTarget([tracks[0], tracks[1]]), { trackId: null, pad: 0 });
  assert.deepEqual(b.choosePadTarget([]), { trackId: null, pad: 0 });
});

test('filling a pad: only that pad changes, at neutral settings, its gain kept in range, and it reads back from a project file', () => {
  const before = rackWith([0]);
  before.pads[0] = { ...before.pads[0], pitch: 5, choke: 2 };
  before.pads[3] = { ...before.pads[3], pitch: 7, drive: 0.5 };
  const after = b.fillPad(before, 3, { soundId: 'bounce', name: 'A Verse', gainDb: 4.567 });
  assert.equal(after.pads.length, 16);
  assert.deepEqual(after.pads[0], before.pads[0]);
  assert.deepEqual(after.pads[3], { ...emptyPad(3), name: 'A Verse', soundId: 'bounce', gain: 4.57 });
  assert.notEqual(after, before);
  assert.equal(before.pads[3].soundId, undefined, 'the rack it came from is left as it was');
  assert.deepEqual(normalizeRack(JSON.parse(JSON.stringify(after))), after);
  // Gain kept to the pad's range; a stretch and fade carried; no name: the pad's own
  const loud = b.fillPad(undefined, 0, { soundId: 'x', name: '  ', gainDb: 30, start: 0.5, end: 1.25, fade: 1 });
  assert.equal(loud.pads[0].gain, 12);
  assert.equal(loud.pads[0].name, 'Pad 1');
  assert.deepEqual([loud.pads[0].start, loud.pads[0].end, loud.pads[0].fade], [0.5, 1.25, 0.25]);
  assert.equal(b.fillPad(undefined, 0, { soundId: 'x', name: 'q', gainDb: -90 }).pads[0].gain, -60);
  // A long name is cut to the pad's 40 characters
  assert.equal(b.fillPad(undefined, 0, { soundId: 'x', name: 'n'.repeat(60), gainDb: 0 }).pads[0].name.length, 40);
});

test('clearing a pad empties it and leaves the rest', () => {
  const r = b.clearPad(rackWith([0, 1]), 1);
  assert.equal(r.pads[1].soundId, undefined);
  assert.equal(r.pads[0].soundId, 's0');
});

test('a bounce\'s level: stored at the safe peak, the pad\'s gain putting back what that and playback took', () => {
  const playbackDb = 3.93;
  const quiet = b.padLevel(0.25, playbackDb);
  assert.ok(Math.abs(0.25 * quiet.scale - b.BOUNCE_PEAK) < 1e-12, 'peak stored at BOUNCE_PEAK');
  // stored level + pad gain = the level it had, plus the playback correction
  assert.ok(Math.abs(-20 * Math.log10(quiet.scale) + playbackDb - quiet.gainDb) < 1e-9);
  // Never stored over the safe peak, however loud: the pad plays it a little quieter instead
  const loud = b.padLevel(20, playbackDb);
  assert.ok(20 * loud.scale <= b.BOUNCE_PEAK + 1e-12);
  assert.equal(loud.gainDb, 12);
  // Silence is no bounce
  assert.equal(b.padLevel(0, playbackDb), null);
  assert.equal(b.padLevel(NaN, playbackDb), null);
});

test('an audio clip as a pad: its stretch of the sound, its clip gain, its fades', () => {
  const take = { name: 'Vocal take 1', lengthBars: 2, audio: { soundId: 'v1', offset: 0, gain: -3, fadeIn: 0, fadeOut: 0 } };
  // At 120 bpm two bars are 4 s: the whole 4 s sound, so no stretch is set
  assert.deepEqual(b.padFromClip(take, 4, 120), { soundId: 'v1', name: 'Vocal take 1', gainDb: -3 });
  // Trimmed: its stretch, with a short fade so the cut doesn't click
  const trimmed = b.padFromClip({ ...take, lengthBars: 1, audio: { ...take.audio, offset: 1 } }, 4, 120);
  assert.deepEqual(trimmed, { soundId: 'v1', name: 'Vocal take 1', gainDb: -3, start: 1, end: 3, fade: 0.005 });
  // Longer than its sound: up to the sound's end
  assert.equal(b.padFromClip({ ...take, lengthBars: 4, audio: { ...take.audio, offset: 1 } }, 4, 120).end, 4);
  // Its fades (the shorter of the two)
  assert.equal(b.padFromClip({ ...take, audio: { ...take.audio, fadeIn: 0.05, fadeOut: 0.1 } }, 4, 120).fade, 0.05);
  // No audio, or nothing of the sound left: none
  assert.equal(b.padFromClip({ name: 'x', lengthBars: 1 }, 4, 120), null);
  assert.equal(b.padFromClip({ ...take, audio: { ...take.audio, offset: 5 } }, 4, 120), null);
});

test('a bounce\'s name: the section, else the bars; with the track when only one was bounced', () => {
  assert.equal(b.bounceName(5, 9), 'Bars 5–8');
  assert.equal(b.bounceName(3, 4), 'Bar 3');
  assert.equal(b.bounceName(1, 5, 'A Verse'), 'A Verse');
  assert.equal(b.bounceName(1, 5, undefined, 'Keys'), 'Keys bars 1–4');
  assert.ok(b.bounceName(1, 5, 'x'.repeat(50)).length <= 40);
});

test('only Drum Rack tracks take a bounce', () => {
  assert.equal(b.isRackTrack({ instrumentKey: 'drumRack' }), true);
  assert.equal(b.isRackTrack({ instrumentKey: 'drumMachine' }), false);
});
