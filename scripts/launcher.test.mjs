// Unit tests for the clip launcher's view of the song (src/store/launcherView.ts). Run with `npm test`.
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
const { launcherClips, slotCopies, arrangementWindow, segmentAt, queuedAfter } = await import('../src/store/launcherView.ts');

const note = (startOffset, n = 'C3') => ({ id: `n${startOffset}`, note: n, startOffset, duration: '16n', velocity: 0.8 });
// The notes a clip plays (those past its end don't)
const heard = (c) => c.notes.filter((n) => n.startOffset < c.lengthBars).map((n) => n.startOffset);
const clip = (id, trackId, startBar, lengthBars, offsets) => ({ id, trackId, name: id, startBar, lengthBars, isSelected: false, notes: offsets.map((o) => note(o)) });

test('slot copies run end to end, the last cut short', () => {
  const copies = slotCopies('t', { name: 'A', lengthBars: 2, notes: [note(0)] }, 3, 8, 'k');
  assert.deepEqual(copies.map((c) => [c.startBar, c.lengthBars]), [[3, 2], [5, 2], [7, 1]]);
  assert.equal(new Set(copies.map((c) => c.id)).size, 3);
});

test('a window of the arrangement drops notes before it and cuts clips at its end', () => {
  const own = [clip('a', 't', 1, 4, [0, 1, 2, 3]), clip('b', 't', 6, 2, [0])];
  const w = arrangementWindow(own, 3, 7);
  assert.deepEqual(w.map((c) => [c.startBar, c.lengthBars, heard(c)]), [[1, 4, [2, 3]], [6, 1, [0]]]);
  // An audio clip already going isn't picked up part-way
  const audio = { ...clip('c', 't', 1, 4, []), audio: { soundId: 's', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 } };
  assert.equal(arrangementWindow([audio], 2, 6).length, 0);
});

test('a launched track plays its arrangement up to the launch, then its slot', () => {
  const tracks = [
    { id: 't', slots: [{ scene: 0, clip: { name: 'Loop', lengthBars: 1, notes: [note(0)] } }] },
    { id: 'u' },
  ];
  const clips = [clip('a', 't', 1, 8, [0, 2, 4, 6]), clip('b', 'u', 1, 8, [0])];
  const out = launcherClips(tracks, clips, { t: [{ from: 3, kind: 'slot', scene: 0 }] });
  const mine = out.filter((c) => c.trackId === 't').sort((x, y) => x.startBar - y.startBar);
  assert.equal(mine[0].lengthBars, 2); // the arrangement, cut at bar 3
  assert.deepEqual(heard(mine[0]), [0]);
  assert.equal(mine[1].startBar, 3);
  assert.equal(mine.length, 1 + 398); // bar 3 to the end of the timeline, a bar a copy
  // The other track is untouched, and nothing changes: the same array
  assert.ok(out.includes(clips[1]));
  assert.equal(launcherClips(tracks, clips, {}), clips);
});

test('stop and back to arrangement segments', () => {
  const tracks = [{ id: 't', slots: [{ scene: 1, clip: { name: 'L', lengthBars: 2, notes: [note(0)] } }] }];
  const clips = [clip('a', 't', 1, 16, [0, 4, 8, 12])];
  const segs = [{ from: 2, kind: 'slot', scene: 1 }, { from: 4, kind: 'stop' }, { from: 9, kind: 'arr' }];
  const out = launcherClips(tracks, clips, { t: segs });
  assert.deepEqual(out.map((c) => [c.startBar, c.lengthBars]), [[1, 1], [2, 2], [1, 16]]);
  // Before the launch, the first bar; back from bar 9, only the notes from there on
  assert.deepEqual(heard(out[0]), [0]);
  assert.deepEqual(heard(out[2]), [8, 12]);
  assert.equal(segmentAt(segs, 5).kind, 'stop');
  assert.equal(segmentAt(segs, 1.5), null);
  assert.deepEqual(queuedAfter(segs, 3).map((s) => s.from), [4, 9]);
});
