// Unit tests for kept versions (versionPolicy.ts, and the song id and packing in project.ts):
// when the next version is due, which old ones thin out, how times read, and a version round trip.
// Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
const { versionDue, versionsToDrop, versionWhen, VERSION_EVERY_MS } = await import('../src/store/versionPolicy.ts');

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 9, 21, 15, 30).getTime();
let n = 0;
const v = (songId, ago, bytes = 1000) => ({ id: `v${n++}`, songId, savedAt: NOW - ago, bytes });

test('a version is due at the first save, then every couple of minutes', () => {
  assert.equal(versionDue(null, NOW), true);
  assert.equal(versionDue(NOW - MIN, NOW), false);
  assert.equal(versionDue(NOW - VERSION_EVERY_MS, NOW), true);
});

test('every version from the last hour is kept', () => {
  const list = Array.from({ length: 30 }, (_, i) => v('a', i * 2 * MIN));
  assert.deepEqual(versionsToDrop(list, NOW), []);
});

test('after an hour, one per 10 minutes for a day, the newest of each', () => {
  // Every 2 minutes from 1 h to 2 h ago: 30 versions in six 10-minute stretches
  const list = Array.from({ length: 30 }, (_, i) => v('a', HOUR + i * 2 * MIN));
  const dropped = new Set(versionsToDrop([v('a', 0), ...list], NOW));
  const kept = list.filter((x) => !dropped.has(x.id));
  assert.equal(kept.length, 6);
  for (const x of kept) assert.equal((NOW - x.savedAt) % (10 * MIN), 0, 'the newest in its stretch');
});

test('after a day, one per day for 30 days; older ones go', () => {
  const list = Array.from({ length: 40 }, (_, i) => [v('a', DAY + i * DAY), v('a', DAY + i * DAY + HOUR)]).flat();
  const newest = v('a', 0);
  const dropped = new Set(versionsToDrop([newest, ...list], NOW));
  const kept = list.filter((x) => !dropped.has(x.id));
  assert.equal(kept.length, 29, 'days 1 to 29');
  assert.ok(kept.every((x) => NOW - x.savedAt < 30 * DAY));
  assert.ok(!dropped.has(newest.id));
});

test("each song's newest version is kept however old, and songs thin apart", () => {
  const old = v('gone', 90 * DAY);
  const older = v('gone', 91 * DAY);
  const recent = [v('b', 5 * MIN), v('b', 6 * MIN)];
  const dropped = versionsToDrop([old, older, ...recent], NOW);
  assert.deepEqual(dropped, [older.id]);
});

test('over the caps the oldest go first, songs\' newest last, and the newest of all stays', () => {
  const a = [v('a', 1 * MIN), v('a', 2 * MIN), v('a', 3 * MIN)];
  const b = [v('b', 4 * MIN), v('b', 5 * MIN)];
  assert.deepEqual(new Set(versionsToDrop([...a, ...b], NOW, { count: 3, bytes: 1e9 })), new Set([b[1].id, a[2].id]));
  // Room for one: only the newest of all is left
  assert.deepEqual(new Set(versionsToDrop([...a, ...b], NOW, { count: 1, bytes: 1e9 })), new Set([a[1].id, a[2].id, b[0].id, b[1].id]));
  // By size too
  const big = [v('a', 1 * MIN, 600), v('a', 2 * MIN, 600)];
  assert.deepEqual(versionsToDrop(big, NOW, { count: 100, bytes: 1000 }), [big[1].id]);
});

test('times read as the list says them', () => {
  assert.equal(versionWhen(NOW - 20_000, NOW), 'just now');
  assert.equal(versionWhen(NOW - 10 * MIN, NOW), '10 min ago');
  assert.equal(versionWhen(NOW - 2 * HOUR - 5 * MIN, NOW), '2 h ago');
  assert.equal(versionWhen(new Date(2026, 9, 21, 9, 5).getTime(), NOW), 'today 09:05');
  assert.equal(versionWhen(new Date(2026, 9, 20, 14, 2).getTime(), NOW), 'yesterday 14:02');
  assert.equal(versionWhen(new Date(2026, 9, 17, 8, 0).getTime(), NOW), 'Sat 08:00');
  assert.equal(versionWhen(new Date(2026, 8, 12, 14, 2).getTime(), NOW), '12 Sep 14:02');
  assert.equal(versionWhen(new Date(2025, 11, 31, 23, 59).getTime(), NOW), '31 Dec 2025 23:59');
});

test('a song keeps its id through packing, files and parsing; a bad id is left out', async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { packedProject, unpackProject, parseProject, serializeProject, newSongId } = await import('../src/store/project.ts');
  const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');
  const track = { id: 't1', name: 'Drums', color: '#fff', instrumentKey: 'drums', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0 };
  const clip = { id: 'c1', trackId: 't1', name: 'Beat', startBar: 1, lengthBars: 2, notes: [{ id: 'n1', note: 'C2', startOffset: 0, duration: '16n', velocity: 0.9 }], isSelected: false };
  const songId = newSongId();
  const p = { name: 'Song', songId, bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 3, enabled: true }, tracks: [track], clips: [clip], sounds: [{ id: 'x', name: 'x', type: 'audio/wav', data: 'AAAA' }] };
  const json = packedProject(p);
  assert.ok(!json.includes('"sounds"'), 'no embedded sounds in a version');
  const back = unpackProject(json);
  assert.equal(back.songId, songId);
  assert.equal(back.clips[0].notes[0].note, 'C2');
  assert.equal(parseProject(serializeProject(p)).songId, songId);
  assert.equal(parseProject({ ...serializeProject(p), songId: 'no spaces <b>' }).songId, undefined);
  assert.equal(parseProject(serializeProject({ ...p, songId: undefined })).songId, undefined);
});
