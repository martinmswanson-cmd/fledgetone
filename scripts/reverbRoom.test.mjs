// A recorded room on a track's Reverb insert (TrackFx.reverb.room): saved and opened, counted
// among the song's sounds, moved with them, left out of a share link's sounds, and its tail's
// length. Run with `npm test`.
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
const { serializeProject, parseProject } = await import('../src/store/project.ts');
const { defaultTrackFx, normalizeTrackFx } = await import('../src/store/timelineTypes.ts');
const { referencedSoundIds, withSoundsMoved } = await import('../src/store/audioClips.ts');
const tails = await import('../src/audio/effectTails.ts');

const track = (id, reverb = {}) => ({ id, name: id, color: '#fff', instrumentKey: 'piano', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, reverbSend: 0, delaySend: 0, fx: { ...defaultTrackFx(), reverb: { ...defaultTrackFx().reverb, ...reverb } } });

test('a track reverb\'s recorded room survives saving and opening, and older songs have none', () => {
  const p = { name: 'Rooms', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, clips: [], sounds: [] };
  const tracks = [track('a', { on: true, room: 'sound-1' }), track('b', { on: true }), track('c', { room: 7 }), track('d', { room: '' })];
  const back = parseProject(JSON.parse(JSON.stringify(serializeProject({ ...p, tracks }))));
  assert.deepEqual(back.tracks.map((t) => t.fx.reverb.room), ['sound-1', undefined, undefined, undefined]);
  assert.ok(!('room' in back.tracks[1].fx.reverb));
  assert.ok(!('room' in defaultTrackFx().reverb));
  // Taken off again (back to the designed room): the setting is gone, not left empty
  const off = normalizeTrackFx({ ...tracks[0].fx, reverb: { ...tracks[0].fx.reverb, room: undefined } });
  assert.ok(!('room' in off.reverb));
  assert.equal(off.reverb.decay, tracks[0].fx.reverb.decay);
});

test('the recording is one of the song\'s sounds, and moves with them', () => {
  const tracks = [track('a', { room: 'room-1' }), track('b'), track('c', { room: 'room-1' }), track('d', { room: 'room-2' })];
  const song = { clips: [], tracks, masterFx: { room: 'hall' } };
  assert.deepEqual(referencedSoundIds(song).sort(), ['hall', 'room-1', 'room-2']);
  const moved = withSoundsMoved(song, new Map([['room-1', 'room-1b']]));
  assert.deepEqual(moved.tracks.map((t) => t.fx.reverb.room), ['room-1b', undefined, 'room-1b', 'room-2']);
  // What doesn't change stays the same object, and the rest of the reverb's settings stay
  assert.equal(moved.tracks[1], tracks[1]);
  assert.equal(moved.tracks[3], tracks[3]);
  assert.equal(moved.tracks[0].fx.reverb.decay, tracks[0].fx.reverb.decay);
  assert.equal(moved.tracks[0].fx.echo, tracks[0].fx.echo);
  assert.ok(withSoundsMoved(song, new Map([['other', 'x']])).tracks.every((t, i) => t === tracks[i]));
});

test('a recorded room rings as long as its recording, as far as that is known', () => {
  const fx = (reverb) => ({ ...defaultTrackFx(), reverb: { ...defaultTrackFx().reverb, on: true, preDelay: 0, ...reverb } });
  const designed = tails.insertTailSeconds(fx({ decay: 1 }), 120);
  // Not known here (no sound library in Node): as long as a room may be
  assert.equal(tails.insertTailSeconds(fx({ decay: 1, room: 'r' }), 120), tails.ROOM_MAX_SECONDS);
  tails.knowRecordedRooms((id) => ({ short: 1.5, long: 40 })[id]);
  assert.equal(tails.insertTailSeconds(fx({ decay: 1, room: 'short' }), 120), 1.5);
  assert.equal(tails.insertTailSeconds(fx({ decay: 9, room: 'short', preDelay: 100 }), 120), 1.6);
  assert.equal(tails.insertTailSeconds(fx({ room: 'long' }), 120), tails.ROOM_MAX_SECONDS);
  assert.equal(tails.insertTailSeconds(fx({ room: 'gone' }), 120), tails.ROOM_MAX_SECONDS);
  // Switched off, or without one, as before
  assert.equal(tails.insertTailSeconds(fx({ on: false, room: 'short' }), 120), 0);
  assert.equal(tails.insertTailSeconds(fx({ decay: 1 }), 120), designed);
  tails.knowRecordedRooms(() => undefined);
});
