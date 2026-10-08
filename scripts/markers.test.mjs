// Unit tests for the marker maths (src/store/markers.ts) and WAV cue points (src/audio/wavCues.ts). Run with `npm test`.
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
const {
  MARKER_NAME_MAX,
  adjacentMarker,
  anchorMarker,
  cleanMarkerName,
  createMarker,
  insertMarkerBars,
  markerPushedPastEnd,
  nextMarkerName,
  parseMarkers,
  placeMarker,
  removeMarkerBars,
  retimeMarkers,
} = await import('../src/store/markers.ts');
const { cueChunks, markerCues } = await import('../src/audio/wavCues.ts');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const M = (id, bar, anchor = 'bar', bpm = 120) => ({ ...createMarker(bar, bpm, id, id), anchor });
const names = (markers) => markers.map((m) => m.name);

test('new markers are numbered past the highest "Marker N"', () => {
  assert.equal(nextMarkerName([]), 'Marker 1');
  assert.equal(nextMarkerName([M('Marker 1', 2), M('Marker 3', 3), M('Drop', 4)]), 'Marker 4');
  // Renamed ones don't count, so numbers can come round again without repeating a name in use
  assert.equal(nextMarkerName([M('Intro', 2), M('Marker 2x', 3)]), 'Marker 1');
});

test('names are one tidy line, never blank', () => {
  assert.equal(cleanMarkerName('  Drop \n 2 '), 'Drop 2');
  assert.equal(cleanMarkerName('   '), null);
  assert.equal(cleanMarkerName('x'.repeat(200)).length, MARKER_NAME_MAX);
  // Control characters (a NUL would end the name early in a WAV label) become spaces
  assert.equal(cleanMarkerName('\u0000nul\u0007 \u007f\u0085x\u0000'), 'nul x');
  assert.equal(cleanMarkerName('\u0000\u001f'), null);
  // Cut at the limit, an emoji isn't split in two
  const cut = cleanMarkerName('x'.repeat(MARKER_NAME_MAX - 1) + '🎵');
  assert.equal(cut, 'x'.repeat(MARKER_NAME_MAX - 1));
  assert.equal(cleanMarkerName('x'.repeat(MARKER_NAME_MAX - 2) + '🎵'), 'x'.repeat(MARKER_NAME_MAX - 2) + '🎵');
  assert.equal(cleanMarkerName('Drop — é🎵'), 'Drop — é🎵');
});

test('a marker keeps both positions in step, on the timeline', () => {
  const m = createMarker(17, 120, 'A', 'a');
  assert.deepEqual(m, { id: 'a', name: 'A', anchor: 'bar', bar: 17, seconds: 32 });
  assert.equal(placeMarker(m, 0, 120).bar, 1);
  assert.equal(placeMarker(m, 999, 120).bar, 401);
  near(placeMarker(m, 9, 90).seconds, (8 * 240) / 90);
  assert.equal(anchorMarker(m, 'bar'), m);
  assert.equal(anchorMarker(m, 'time').anchor, 'time');
});

test('a tempo change moves time-locked markers along the bars and keeps bar markers on their bar', () => {
  const bar = M('bar', 17); // 32 s at 120
  const time = M('time', 9, 'time'); // 16 s at 120
  const markers = [time, bar];
  const at60 = retimeMarkers(markers, 60);
  // At half the tempo the 16 s marker is at bar 5, the bar-17 one at 64 s
  assert.deepEqual(
    at60.map((m) => [m.name, m.bar, m.seconds]),
    [
      ['time', 5, 16],
      ['bar', 17, 64],
    ]
  );
  // Back again: exactly where they were
  assert.deepEqual(retimeMarkers(at60, 120), markers);
  // Nothing to change: the same array
  assert.equal(retimeMarkers(markers, 120), markers);
  // A faster tempo can carry a time-locked marker past the end: it keeps its time and comes back
  const late = retimeMarkers([M('late', 300, 'time', 60)], 240);
  near(late[0].bar, 1197);
  near(retimeMarkers(late, 60)[0].bar, 300);
});

test('a tempo change re-sorts when a time-locked marker passes a bar one', () => {
  const markers = [M('time', 9, 'time'), M('bar', 12)];
  assert.deepEqual(names(retimeMarkers(markers, 240)), ['bar', 'time']); // time-locked now at bar 17
});

test('inserting bars moves bar markers from the insert point on', () => {
  const markers = [M('before', 4), M('at', 5), M('after', 9), M('time', 7, 'time'), M('near end', 397)].sort((a, b) => a.bar - b.bar);
  const out = insertMarkerBars(markers, 5, 4, 120);
  assert.deepEqual(
    out.map((m) => [m.name, m.bar]),
    [
      ['before', 4],
      ['at', 9],
      ['time', 7], // stays put in time
      ['after', 13],
      ['near end', 401], // exactly at the end is still on the timeline
    ].sort((a, b) => a[1] - b[1])
  );
  assert.equal(markerPushedPastEnd(markers, 5, 4), null);
  assert.equal(out.find((m) => m.name === 'at').seconds, 16);
  assert.equal(insertMarkerBars(markers, 500, 4, 120), markers);
  assert.equal(insertMarkerBars(markers, 5, 0, 120), markers);
});

test('an insert that would push a bar marker past the end is caught', () => {
  const markers = [M('a', 395), M('b', 398), M('c', 400), M('time', 399, 'time')];
  // insertBars refuses these rather than pile the markers up at bar 401
  assert.equal(markerPushedPastEnd(markers, 390, 8).name, 'a');
  assert.equal(markerPushedPastEnd(markers, 396, 4).name, 'b');
  assert.equal(markerPushedPastEnd(markers, 399, 2).name, 'c');
  // Before the insert point, exactly to the end, or held to time: fine
  assert.equal(markerPushedPastEnd(markers, 400.5, 8), null);
  assert.equal(markerPushedPastEnd([M('a', 393)], 390, 8), null);
  assert.equal(markerPushedPastEnd([M('t', 399, 'time')], 390, 8), null);
  // A marker exactly at the insert point (give or take float noise) moves, so it counts
  assert.equal(markerPushedPastEnd([M('a', 400 - 1e-9)], 400, 2).name, 'a');
});

test('removing bars deletes bar markers inside, keeps the one at the end, moves later ones', () => {
  const markers = [M('before', 4.5), M('from', 5), M('inside', 7), M('to', 9), M('after', 12), M('time', 6, 'time')].sort((a, b) => a.bar - b.bar);
  const out = removeMarkerBars(markers, 5, 9, 120);
  assert.deepEqual(
    out.map((m) => [m.name, m.bar]),
    [
      ['before', 4.5],
      ['to', 5],
      ['time', 6],
      ['after', 8],
    ]
  );
  // Float noise at the edges counts as the edge
  const edges = removeMarkerBars([M('from', 5 - 1e-9), M('to', 9 - 1e-9)], 5, 9, 120);
  assert.deepEqual(names(edges), ['to']);
  assert.equal(removeMarkerBars([M('a', 2)], 5, 9, 120).length, 1);
  const untouched = [M('a', 2)];
  assert.equal(removeMarkerBars(untouched, 5, 9, 120), untouched);
});

test('previous / next marker', () => {
  const markers = [M('a', 2), M('b', 5), M('c', 9)];
  assert.equal(adjacentMarker(markers, 5, 1).name, 'c');
  assert.equal(adjacentMarker(markers, 5, -1).name, 'a');
  assert.equal(adjacentMarker(markers, 4.99, 1).name, 'b');
  assert.equal(adjacentMarker(markers, 9, 1), null);
  assert.equal(adjacentMarker(markers, 2, -1), null);
  // Playing just past b: going back skips it
  assert.equal(adjacentMarker(markers, 5.1, -1, 0.25).name, 'a');
  assert.equal(adjacentMarker(markers, 5.3, -1, 0.25).name, 'b');
  // Past the end of the timeline can't be reached
  assert.equal(adjacentMarker([{ ...M('late', 9), bar: 450 }], 400, 1), null);
});

test('markers from a file: the anchored position wins, bad entries are skipped', () => {
  const out = parseMarkers(
    [
      { id: 'a', name: ' Verse ', anchor: 'bar', bar: 9, seconds: 999 },
      { id: 'b', name: 'Hit', anchor: 'time', bar: 1, seconds: 8 },
      { id: 'a', name: 'Same id', bar: 3 },
      { name: '', bar: -5 },
      { id: 'c', anchor: 'time', bar: 5 },
      { id: 'd', name: 'Nowhere' },
      'junk',
      null,
      { id: 'e', name: 'Far', bar: 1e9 },
    ],
    120
  );
  assert.deepEqual(
    out.map((m) => [m.name, m.anchor, m.bar, m.seconds]),
    [
      ['Marker', 'bar', 1, 0],
      ['Same id', 'bar', 3, 4],
      ['Hit', 'time', 5, 8], // ties keep the file's order
      ['Marker', 'time', 5, 8],
      ['Verse', 'bar', 9, 16],
      ['Far', 'bar', 401, 800],
    ]
  );
  assert.equal(new Set(out.map((m) => m.id)).size, out.length);
  assert.deepEqual(parseMarkers(undefined, 120), []);
  assert.deepEqual(parseMarkers({}, 120), []);
});

/** Read a cue/LIST chunk pair back the way a WAV reader would. */
function readCues(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = (o) => String.fromCharCode(...bytes.subarray(o, o + 4));
  const cues = new Map();
  const labels = new Map();
  for (let o = 0; o < bytes.length; ) {
    const size = view.getUint32(o + 4, true);
    if (id(o) === 'cue ') {
      const n = view.getUint32(o + 8, true);
      assert.equal(size, 4 + 24 * n);
      for (let i = 0; i < n; i++) {
        const p = o + 12 + 24 * i;
        assert.equal(id(p + 8), 'data');
        assert.equal(view.getUint32(p + 4, true), view.getUint32(p + 20, true));
        cues.set(view.getUint32(p, true), view.getUint32(p + 20, true));
      }
    } else if (id(o) === 'LIST') {
      assert.equal(id(o + 8), 'adtl');
      for (let p = o + 12; p < o + 8 + size; ) {
        const n = view.getUint32(p + 4, true);
        assert.equal(id(p), 'labl');
        const text = bytes.subarray(p + 12, p + 8 + n);
        assert.equal(text[text.length - 1], 0, 'names end in a NUL');
        labels.set(view.getUint32(p + 8, true), new TextDecoder().decode(text.subarray(0, -1)));
        p += 8 + n + (n & 1);
      }
    }
    o += 8 + size + (size & 1);
  }
  return [...cues].map(([cueId, frame]) => ({ frame, name: labels.get(cueId) }));
}

test('cue chunks read back as written: ids match names, chunks even-sized', () => {
  const cues = [
    { frame: 0, name: 'Intro' },
    { frame: 44100, name: 'Drop' }, // odd label size: padded
    { frame: 1234567, name: 'Brücke ♪' },
  ];
  const bytes = cueChunks(cues);
  assert.equal(bytes.length % 2, 0);
  assert.deepEqual(readCues(bytes), cues);
  assert.equal(cueChunks([]).length, 0);
});

test('markers in the range become cues at their sample from the file start', () => {
  const markers = [M('before', 4), M('start', 5), M('beat 2', 5.25), M('time', 7, 'time'), M('end', 9), M('after', 10)];
  const range = { startBar: 5, endBar: 9, originBar: 5, bpm: 120, sampleRate: 48000, frames: 8 * 48000, includeEnd: false };
  assert.deepEqual(markerCues(markers, range), [
    { frame: 0, name: 'start' },
    { frame: 24000, name: 'beat 2' },
    { frame: 4 * 48000, name: 'time' },
  ]);
  // A ring-out file runs past the end, so a marker right at the end is in it
  assert.deepEqual(
    markerCues(markers, { ...range, frames: 10 * 48000, includeEnd: true }).map((c) => c.name),
    ['start', 'beat 2', 'time', 'end']
  );
  // The file starts where the Transport does (the range start on its nearest tick)
  const tick = 1 / 768;
  assert.equal(markerCues([M('start', 5)], { ...range, originBar: 5 - tick / 2 })[0].frame, Math.round(((tick / 2) * 240 * 48000) / 120));
});
