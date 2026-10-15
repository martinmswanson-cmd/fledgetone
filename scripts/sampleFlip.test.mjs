// Unit tests for flipping a sample (src/store/sampleFlip.ts): chopping into up to 16, moving the
// markers by hand, the chops on a Drum Rack's pads (and reading them back from a project file),
// the "Chop and play" pattern and the bass cut; and the clip fields a key move adds
// (src/store/audioClips.ts). Run with `npm test`.
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
const F = await import('../src/store/sampleFlip.ts');
const { chopSpan, normalizeRack, padOfNote } = await import('../src/store/sampleKits.ts');
const { ENVELOPE_HOP, envelopeOf } = await import('../src/audio/slicing.ts');
const { durationToBars, defaultTrackFx, normalizeTrackFx } = await import('../src/store/timelineTypes.ts');
const { normalizeClipAudio, referencedSoundIds } = await import('../src/store/audioClips.ts');
const M = await import('./flip-material.mjs');

const SR = 22050;

test('chopStarts: equal parts, and at most the 16 strongest hits', () => {
  assert.deepEqual(F.chopStarts(new Float32Array(0), ENVELOPE_HOP, 1, 3, 'equal', 4), [1, 1.5, 2, 2.5]);
  assert.equal(F.chopStarts(new Float32Array(0), ENVELOPE_HOP, 0, 8, 'equal', 40).length, 16);
  // A 4-bar boom-bap loop at 90 has 44 hits (kicks, snares, 8th hats): the 16 strongest are kept,
  // and they're the kicks and snares (on 16ths 0, 4, 6, 10, 12 of each bar), not the hats
  const loop = M.drumLoop({ bpm: 90, bars: 4, seed: 3, noise: 0 });
  const env = envelopeOf([loop], SR);
  const cuts = F.chopStarts(env, ENVELOPE_HOP, 0, loop.length / SR, 'transients', 0, 1);
  assert.equal(cuts.length, 16);
  assert.equal(cuts[0], 0);
  const sixteenth = 60 / 90 / 4;
  const onDrum = cuts.filter((t) => [0, 4, 6, 10, 12].includes(Math.round(t / sixteenth) % 16) && Math.abs(t / sixteenth - Math.round(t / sixteenth)) < 0.2);
  assert.ok(onDrum.length >= 14, `${onDrum.length} of 16 chops on the kicks and snares`);
  for (let i = 1; i < cuts.length; i++) assert.ok(cuts[i] > cuts[i - 1]);
  // Fewer hits than that: every one
  const few = F.chopStarts(env, ENVELOPE_HOP, 0, 60 / 90, 'transients', 0, 0.5);
  assert.ok(few.length >= 2 && few.length <= 4, `${few.length} chops in a beat`);
});

test('markers by hand: move between neighbours, add, remove', () => {
  const cuts = [0, 1, 2, 3];
  assert.deepEqual(F.moveChop(cuts, 2, 1.5, 4), [0, 1, 1.5, 3]);
  assert.deepEqual(F.moveChop(cuts, 2, 0.2, 4), [0, 1, 1 + F.MIN_CHOP, 3]);
  assert.deepEqual(F.moveChop(cuts, 3, 9, 4), [0, 1, 2, 4 - F.MIN_CHOP]);
  assert.deepEqual(F.moveChop(cuts, 0, 0.5, 4), cuts, 'the first marker is the start: it stays');
  assert.deepEqual(F.addChop(cuts, 2.5, 4), [0, 1, 2, 2.5, 3]);
  assert.deepEqual(F.addChop(cuts, 2.01, 4), cuts, 'too close to another');
  assert.deepEqual(F.addChop(cuts, 3.99, 4), cuts, 'too close to the end');
  const full = Array.from({ length: 16 }, (_, i) => i);
  assert.deepEqual(F.addChop(full, 15.5, 17), full, 'sixteen is the most');
  assert.deepEqual(F.removeChop(cuts, 1), [0, 2, 3]);
  assert.deepEqual(F.removeChop(cuts, 0), cuts);
  assert.equal(F.chopEnd(cuts, 3, 4), 4);
});

test('chopsToRack: a chop per pad, saved and read back; a chop reversed plays its mirror', () => {
  const rack = F.chopsToRack({ id: 'snd', name: 'loop' }, [0, 0.5, 1.25], 2, { fade: 0.01, choke: true });
  assert.equal(rack.pads.length, 16);
  assert.deepEqual(
    rack.pads.slice(0, 3).map((p) => [p.name, p.soundId, p.start, p.end, p.fade, p.choke]),
    [
      ['Chop 1', 'snd', 0, 0.5, 0.01, 1],
      ['Chop 2', 'snd', 0.5, 1.25, 0.01, 1],
      ['Chop 3', 'snd', 1.25, 2, 0.01, 1],
    ]
  );
  assert.equal(rack.pads[3].soundId, undefined);
  assert.equal(F.chopsToRack({ id: 's', name: 'n' }, [0, 1], 2, { choke: false }).pads[0].choke, 0);
  // Through a project file and back
  assert.deepEqual(normalizeRack(JSON.parse(JSON.stringify(rack))), rack);
  // Broken chop fields are dropped, not kept half-way
  const broken = normalizeRack({ pads: [{ soundId: 'a', start: 2, end: 1 }, { soundId: 'b', start: 0 }, { soundId: 'c', start: 0, end: 1, fade: 9 }] });
  assert.equal(broken.pads[0].start, undefined);
  assert.equal(broken.pads[1].start, undefined);
  assert.equal(broken.pads[2].fade, 0.25);
  // Where the pad plays in its buffer
  assert.deepEqual(chopSpan({ start: 0.5, end: 1.25 }, 2), { offset: 0.5, seconds: 0.75 });
  assert.deepEqual(chopSpan({ start: 0.5, end: 1.25, reverse: true }, 2), { offset: 0.75, seconds: 0.75 });
  assert.deepEqual(chopSpan({}, 2), { offset: 0, seconds: 2 });
  assert.deepEqual(chopSpan({ start: 1.5, end: 9 }, 2), { offset: 1.5, seconds: 0.5 });
});

test('flipPattern: the chops in a new order on the 16th grid, the same for the same seed', () => {
  const seed = F.flipSeed('sound-1', 0);
  const a = F.flipPattern(8, seed);
  assert.deepEqual(F.flipPattern(8, seed), a, 'repeatable');
  assert.notDeepEqual(F.flipPattern(8, F.flipSeed('sound-1', 1)), a, 'a new idea is new');
  const pads = a.map((n) => padOfNote(n.note));
  assert.ok(pads.every((p) => p >= 0 && p < 8), 'only the pads with chops');
  assert.ok(new Set(pads).size >= 5, `${new Set(pads).size} different chops used`);
  assert.notDeepEqual(pads.slice(0, 8), [0, 1, 2, 3, 4, 5, 6, 7], 'not the sample as it was');
  for (const n of a) {
    assert.ok(Math.abs(n.startOffset * 16 - Math.round(n.startOffset * 16)) < 1e-9, 'on the 16th grid');
    assert.ok(n.startOffset >= 0 && n.startOffset < 2);
    assert.ok(n.velocity > 0.6 && n.velocity <= 1);
  }
  // Each hit lasts to the next; the downbeats of both bars play the same anchor chop
  for (let i = 0; i + 1 < a.length; i++) assert.ok(Math.abs(a[i].startOffset + durationToBars(a[i].duration) - a[i + 1].startOffset) < 1e-6);
  const downbeats = a.filter((n) => n.startOffset % 1 === 0);
  assert.equal(downbeats.length, 2);
  assert.equal(downbeats[0].note, downbeats[1].note);
  // Ideas across many seeds and sizes stay inside their pads and bars
  for (let k = 0; k < 50; k++) {
    const count = 1 + (k % 16);
    const p = F.flipPattern(count, F.flipSeed('s', k), 1 + (k % 4));
    assert.ok(p.every((n) => padOfNote(n.note) < count && n.startOffset < 1 + (k % 4)));
  }
});

test('the bass cut: a steep high-pass on the Filter insert, read back as on', () => {
  const fx = defaultTrackFx();
  assert.equal(F.hasBassCut(fx), false);
  const on = normalizeTrackFx({ ...fx, filter: { ...fx.filter, ...F.bassCutFilter(true) } });
  assert.equal(F.hasBassCut(on), true);
  assert.equal(on.filter.cutoff, F.BASS_CUT_HZ);
  assert.equal(on.filter.slope, 24);
  assert.equal(F.hasBassCut({ ...on, filter: { ...on.filter, ...F.bassCutFilter(false) } }), false);
});

test('a clip moved into another key keeps its original sound, through a project file', () => {
  const audio = normalizeClipAudio({ soundId: 'moved', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, shiftedFrom: 'orig', shift: 3 });
  assert.equal(audio.shiftedFrom, 'orig');
  assert.equal(audio.shift, 3);
  assert.equal(normalizeClipAudio({ soundId: 'x', shiftedFrom: 'orig' }).shiftedFrom, undefined, 'no shift, no original');
  assert.equal(normalizeClipAudio({ soundId: 'x', shiftedFrom: 'o', shift: 40 }).shift, 12);
  assert.deepEqual(referencedSoundIds({ clips: [{ audio }], tracks: [] }).sort(), ['moved', 'orig']);
});
